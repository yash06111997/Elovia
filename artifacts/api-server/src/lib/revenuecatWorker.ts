import { createHmac, randomUUID } from "node:crypto";
import { db, REVENUECAT_SUBJECT_ROLE_MASKS } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  AccountLockTransaction,
  AuthProvisioningCallback,
  ProvisionedAuthUser,
} from "./accountDeletion.js";
import { withAccountLocks } from "./accountDeletion.js";
import {
  createRevenueCatClient,
  type RevenueCatClient,
} from "./revenuecatClient.js";
import {
  loadRevenueCatConfig,
  type RevenueCatConfig,
} from "./revenuecatConfig.js";
import {
  applyTrustedSnapshot,
  reconcileTrustedUser,
} from "./revenuecatReconciler.js";
import { logger } from "./logger.js";
import { projectRevenueCatSnapshot } from "./revenuecatSnapshot.js";
import {
  reconcileRetryDelayMs,
  sanitizeRevenueCatErrorCode,
} from "./revenuecatWorkerCore.js";

const CUSTOMER_LEASE_SECONDS = 60;
const CUSTOMER_BATCH_SIZE = 20;
const EVENT_BATCH_SIZE = 20;
const WORKER_INTERVAL_MS = 30_000;

type TrustedClaim = Readonly<{
  userId: string;
  leaseId: string;
  attemptCount: number;
  reason:
    | "legacy_bootstrap"
    | "webhook_failure"
    | "authenticated"
    | "on_demand"
    | "scheduled";
}>;

type EventClaim = Readonly<{
  eventId: string;
  leaseId: string;
  attemptCount: number;
}>;

export async function claimDueTrustedUsers(
  limit = CUSTOMER_BATCH_SIZE,
): Promise<TrustedClaim[]> {
  const leaseId = randomUUID();
  const claimed = await db.execute<{
    user_id: string;
    reconcile_attempt_count: number;
    reconcile_reason: TrustedClaim["reason"];
  }>(sql`
    WITH due AS (
      SELECT state."user_id"
      FROM "revenuecat_customer_state" AS state
      JOIN "users" AS live_user ON live_user."id" = state."user_id"
      WHERE state."reconcile_after" <= clock_timestamp()
        AND (
          state."reconcile_lease_until" IS NULL
          OR state."reconcile_lease_until" <= clock_timestamp()
        )
      ORDER BY state."reconcile_after", state."user_id" COLLATE "C"
      FOR UPDATE OF state SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "revenuecat_customer_state" AS state
    SET "reconcile_lease_id" = ${leaseId},
        "reconcile_lease_until" = clock_timestamp() + interval '60 seconds',
        "reconcile_attempt_count" = state."reconcile_attempt_count" + 1,
        "updated_at" = clock_timestamp()
    FROM due
    WHERE state."user_id" = due."user_id"
    RETURNING state."user_id", state."reconcile_attempt_count", state."reconcile_reason"
  `);
  return claimed.rows.map((row) => ({
    userId: row.user_id,
    leaseId,
    attemptCount: row.reconcile_attempt_count,
    reason: row.reconcile_reason,
  }));
}

async function finishTrustedClaim(
  claim: TrustedClaim,
  outcome: "success" | "deleted" | "retry",
  errorCode?: string,
  retryDelayMs?: number,
): Promise<boolean> {
  if (outcome === "deleted") {
    const deleted = await db.execute<{ user_id: string }>(sql`
      DELETE FROM "revenuecat_customer_state"
      WHERE "user_id" = ${claim.userId}
        AND "reconcile_lease_id" = ${claim.leaseId}
        AND "reconcile_lease_until" > clock_timestamp()
      RETURNING "user_id"
    `);
    return deleted.rows.length === 1;
  }
  const schedule =
    outcome === "success"
      ? sql`interval '6 hours'`
      : sql`${retryDelayMs ?? 60_000} * interval '1 millisecond'`;
  const finished = await db.execute<{ user_id: string }>(sql`
    UPDATE "revenuecat_customer_state"
    SET "reconcile_after" = clock_timestamp() + ${schedule},
        "reconcile_attempt_count" = CASE WHEN ${outcome === "success"}
          THEN 0 ELSE "reconcile_attempt_count" END,
        "reconcile_last_error_code" = ${outcome === "success" ? null : (errorCode ?? "revenuecat_worker_failure")},
        "reconcile_lease_id" = NULL,
        "reconcile_lease_until" = NULL,
        "updated_at" = clock_timestamp()
    WHERE "user_id" = ${claim.userId}
      AND "reconcile_lease_id" = ${claim.leaseId}
      AND "reconcile_lease_until" > clock_timestamp()
    RETURNING "user_id"
  `);
  return finished.rows.length === 1;
}

export async function runTrustedUserBatch(
  input: Readonly<{
    config: RevenueCatConfig;
    client: RevenueCatClient;
    limit?: number;
  }>,
): Promise<{ claimed: number; succeeded: number; retried: number }> {
  const claims = await claimDueTrustedUsers(input.limit);
  let succeeded = 0;
  let retried = 0;
  for (const claim of claims) {
    try {
      const reconciled = await reconcileTrustedUser({
        userId: claim.userId,
        reason: claim.reason,
        operationId:
          claim.reason === "authenticated" || claim.reason === "on_demand"
            ? `auth:${randomUUID()}`
            : `worker:${claim.leaseId}`,
        config: input.config,
        client: input.client,
        fence: { leaseId: claim.leaseId, customerState: true },
      });
      if (reconciled.outcome === "deleted") {
        await finishTrustedClaim(claim, "deleted");
      } else if (
        reconciled.outcome === "applied" ||
        reconciled.outcome === "stale"
      ) {
        if (await finishTrustedClaim(claim, "success")) succeeded += 1;
      } else if (reconciled.outcome === "visibility_lag") {
        if (
          await finishTrustedClaim(
            claim,
            "retry",
            "revenuecat_visibility_lag",
            60_000,
          )
        ) {
          retried += 1;
        }
      }
    } catch (error) {
      if (
        await finishTrustedClaim(
          claim,
          "retry",
          sanitizeRevenueCatErrorCode(error),
          reconcileRetryDelayMs(claim.attemptCount),
        )
      ) {
        retried += 1;
      }
    }
  }
  return { claimed: claims.length, succeeded, retried };
}

export async function reconcileTrustedUserOnDemand(
  input: Readonly<{
    userId: string;
    config: RevenueCatConfig;
    client: RevenueCatClient;
  }>,
): Promise<void> {
  const leaseId = randomUUID();
  const claim = await db.execute<{ reconcile_attempt_count: number }>(sql`
    UPDATE "revenuecat_customer_state"
    SET "reconcile_lease_id" = ${leaseId},
        "reconcile_lease_until" = clock_timestamp() + interval '60 seconds',
        "reconcile_attempt_count" = "reconcile_attempt_count" + 1,
        "reconcile_reason" = 'on_demand',
        "updated_at" = clock_timestamp()
    WHERE "user_id" = ${input.userId}
      AND (
        "canonicalization_state" = 'legacy_unverified'
        OR "reconcile_after" <= clock_timestamp()
      )
      AND (
        "reconcile_lease_until" IS NULL
        OR "reconcile_lease_until" <= clock_timestamp()
      )
    RETURNING "reconcile_attempt_count"
  `);
  const attemptCount = claim.rows[0]?.reconcile_attempt_count;
  if (!attemptCount) return;
  const work: TrustedClaim = {
    userId: input.userId,
    leaseId,
    attemptCount,
    reason: "on_demand",
  };
  try {
    const outcome = await reconcileTrustedUser({
      userId: input.userId,
      reason: "on_demand",
      operationId: `auth:${randomUUID()}`,
      config: input.config,
      client: input.client,
      fence: { leaseId, customerState: true },
    });
    if (outcome.outcome === "deleted")
      await finishTrustedClaim(work, "deleted");
    else if (outcome.outcome === "applied" || outcome.outcome === "stale") {
      await finishTrustedClaim(work, "success");
    } else {
      await finishTrustedClaim(
        work,
        "retry",
        "revenuecat_visibility_lag",
        60_000,
      );
    }
  } catch (error) {
    await finishTrustedClaim(
      work,
      "retry",
      sanitizeRevenueCatErrorCode(error),
      reconcileRetryDelayMs(attemptCount),
    );
  }
}

function uidHash(key: string, userId: string): string {
  return createHmac("sha256", key).update(userId, "utf8").digest("hex");
}

export function createRevenueCatAuthProvisioningCallback(
  user: ProvisionedAuthUser,
  config: RevenueCatConfig,
): AuthProvisioningCallback {
  const hash = uidHash(config.subjectHashKey, user.id);
  return {
    async discoverAdditionalOwners(transaction) {
      const owner = await transaction.execute<{ local_user_id: string }>(sql`
        SELECT "local_user_id" FROM "revenuecat_customer_aliases"
        WHERE "alias_hash" = ${hash}
      `);
      const prior = owner.rows[0]?.local_user_id;
      return prior && prior !== user.id ? [prior] : [];
    },
    async afterProvision(transaction, createdAt) {
      const prior = await transaction.execute<{ local_user_id: string }>(sql`
        SELECT "local_user_id" FROM "revenuecat_customer_aliases"
        WHERE "alias_hash" = ${hash}
        FOR UPDATE
      `);
      const displaced = prior.rows[0]?.local_user_id ?? null;
      await transaction.execute(sql`
        INSERT INTO "revenuecat_customer_aliases" (
          "alias_hash", "local_user_id", "alias_kind", "ownership_source",
          "source_event_at", "source_event_id", "authenticated_at"
        ) VALUES (
          ${hash}, ${user.id}, 'authenticated', 'authenticated', NULL, NULL,
          ${createdAt}
        )
        ON CONFLICT ("alias_hash") DO UPDATE SET
          "local_user_id" = EXCLUDED."local_user_id",
          "alias_kind" = 'authenticated',
          "ownership_source" = 'authenticated',
          "source_event_at" = NULL,
          "source_event_id" = NULL,
          "authenticated_at" = EXCLUDED."authenticated_at",
          "updated_at" = clock_timestamp()
      `);
      await transaction.execute(sql`
        UPDATE "revenuecat_event_subjects" AS subject
        SET "local_user_id" = ${user.id}
        FROM "revenuecat_webhook_events" AS event
        WHERE subject."event_id" = event."event_id"
          AND subject."subject_hash" = ${hash}
          AND event."disposition" = 'pending'
      `);
      await transaction.execute(sql`
        UPDATE "revenuecat_webhook_events" AS event
        SET "next_attempt_at" = LEAST(event."next_attempt_at", clock_timestamp())
        WHERE event."disposition" = 'pending'
          AND EXISTS (
            SELECT 1 FROM "revenuecat_event_subjects" AS subject
            WHERE subject."event_id" = event."event_id"
              AND subject."subject_hash" = ${hash}
          )
      `);
      const ownershipChanged = Boolean(displaced && displaced !== user.id);
      await enqueueAuthenticatedOwner(transaction, user.id, ownershipChanged);
      if (displaced && displaced !== user.id) {
        await enqueueAuthenticatedOwner(transaction, displaced, true);
      }
    },
  };
}

async function enqueueAuthenticatedOwner(
  transaction: AccountLockTransaction,
  userId: string,
  force: boolean,
): Promise<void> {
  await transaction.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "reconcile_reason", "reconcile_after"
    )
    SELECT ${userId}, 'pending', 'none', 'authenticated', clock_timestamp()
    WHERE EXISTS (SELECT 1 FROM "users" WHERE "id" = ${userId})
    ON CONFLICT ("user_id") DO UPDATE SET
      "reconcile_reason" = 'authenticated',
      "reconcile_after" = LEAST(
        "revenuecat_customer_state"."reconcile_after", clock_timestamp()
      ),
      "updated_at" = clock_timestamp()
    WHERE ${force}
       OR "revenuecat_customer_state"."canonicalization_state" = 'legacy_unverified'
       OR "revenuecat_customer_state"."reconcile_after" <= clock_timestamp()
  `);
}

export async function enqueueTrustedCustomerState(
  userId: string,
  reason: "authenticated" | "on_demand" | "scheduled" = "on_demand",
): Promise<void> {
  await db.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "reconcile_reason", "reconcile_after"
    )
    SELECT ${userId}, 'pending', 'none', ${reason}, clock_timestamp()
    WHERE EXISTS (
      SELECT 1 FROM "users" AS live_user
      WHERE live_user."id" = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS deletion
          WHERE deletion."user_id" = live_user."id"
        )
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "reconcile_reason" = ${reason},
      "reconcile_after" = LEAST(
        "revenuecat_customer_state"."reconcile_after", clock_timestamp()
      ),
      "updated_at" = clock_timestamp()
    WHERE "revenuecat_customer_state"."canonicalization_state" = 'legacy_unverified'
       OR "revenuecat_customer_state"."reconcile_after" <= clock_timestamp()
  `);
}

export async function claimPendingRevenueCatEvents(
  limit = EVENT_BATCH_SIZE,
): Promise<EventClaim[]> {
  const leaseId = randomUUID();
  const claimed = await db.execute<{
    event_id: string;
    attempt_count: number;
  }>(sql`
    WITH due AS (
      SELECT "event_id"
      FROM "revenuecat_webhook_events"
      WHERE "disposition" = 'pending'
        AND "next_attempt_at" <= clock_timestamp()
        AND (
          "processing_lease_until" IS NULL
          OR "processing_lease_until" <= clock_timestamp()
        )
      ORDER BY "next_attempt_at", "event_id" COLLATE "C"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "revenuecat_webhook_events" AS event
    SET "processing_lease_id" = ${leaseId},
        "processing_lease_until" = clock_timestamp() + interval '60 seconds',
        "attempt_count" = event."attempt_count" + 1
    FROM due
    WHERE event."event_id" = due."event_id"
    RETURNING event."event_id", event."attempt_count"
  `);
  return claimed.rows.map((row) => ({
    eventId: row.event_id,
    leaseId,
    attemptCount: row.attempt_count,
  }));
}

async function retryEvent(claim: EventClaim): Promise<void> {
  const retryDelayMs = reconcileRetryDelayMs(claim.attemptCount);
  await db.execute(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = NULL,
        "processing_lease_until" = NULL,
        "next_attempt_at" = clock_timestamp()
          + ${retryDelayMs} * interval '1 millisecond'
    WHERE "event_id" = ${claim.eventId}
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
  `);
}

async function deferFullyPrunedEvent(claim: EventClaim): Promise<void> {
  await db.execute(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = NULL,
        "processing_lease_until" = NULL,
        "next_attempt_at" = GREATEST("next_attempt_at", "retention_until")
    WHERE "event_id" = ${claim.eventId}
      AND "disposition" = 'pending'
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
      AND "pruned_identity_count" = "identity_count"
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
  `);
}

async function recoverClaimedEvent(
  claim: EventClaim,
  config: RevenueCatConfig,
  client: RevenueCatClient,
): Promise<void> {
  const loaded = await db.execute<{
    type: string;
    event_at: Date;
    metadata: Record<string, unknown>;
    identity_count: number;
    pruned_identity_count: number;
    identity_required: boolean;
    entitlement_required: boolean;
    identity_applied_at: Date | null;
    entitlement_applied_at: Date | null;
  }>(sql`
    SELECT "type", "event_at", "metadata", "identity_count",
           "pruned_identity_count", "identity_required", "entitlement_required",
           "identity_applied_at",
           "entitlement_applied_at"
    FROM "revenuecat_webhook_events"
    WHERE "event_id" = ${claim.eventId}
      AND "disposition" = 'pending'
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
  `);
  const event = loaded.rows[0];
  if (!event) return;
  const subjects = await db.execute<{
    subject_hash: string;
    role_mask: number;
    local_user_id: string | null;
    alias_owner: string | null;
    ownership_source: string | null;
  }>(sql`
    SELECT subject."subject_hash", subject."role_mask", subject."local_user_id",
           alias."local_user_id" AS "alias_owner",
           alias."ownership_source"
    FROM "revenuecat_event_subjects" AS subject
    LEFT JOIN "revenuecat_customer_aliases" AS alias
      ON alias."alias_hash" = subject."subject_hash"
    WHERE subject."event_id" = ${claim.eventId}
  `);
  if (
    subjects.rows.length + event.pruned_identity_count !==
    event.identity_count
  ) {
    await retryEvent(claim);
    return;
  }
  if (subjects.rows.length === 0) {
    await deferFullyPrunedEvent(claim);
    return;
  }
  const ownerFor = (subject: (typeof subjects.rows)[number]) =>
    subject.ownership_source === "authenticated"
      ? subject.alias_owner
      : (subject.alias_owner ?? subject.local_user_id);
  const ownerSubjects =
    event.type === "PURCHASE_REDEEMED"
      ? subjects.rows.filter((subject) =>
          Boolean(subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy),
        )
      : subjects.rows;
  const owners = [
    ...new Set(ownerSubjects.map(ownerFor).filter((v): v is string => !!v)),
  ].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (
    owners.length === 0 ||
    ownerSubjects.some((subject) => !ownerFor(subject))
  ) {
    await retryEvent(claim);
    return;
  }
  const lookups = new Map<
    string,
    Awaited<ReturnType<RevenueCatClient["getSubscriber"]>>
  >();
  if (event.entitlement_required && event.entitlement_applied_at === null) {
    try {
      for (const owner of owners) {
        const lookup = await client.getSubscriber(owner as never);
        if (lookup.lookup !== "existing") {
          await retryEvent(claim);
          return;
        }
        lookups.set(owner, lookup);
      }
    } catch {
      await retryEvent(claim);
      return;
    }
  }

  await withAccountLocks(owners, async (transaction) => {
    const locked = await transaction.execute<{
      subject_hash: string;
      role_mask: number;
      local_user_id: string | null;
      alias_owner: string | null;
      ownership_source: string | null;
    }>(sql`
      SELECT subject."subject_hash", subject."role_mask", subject."local_user_id",
             alias."local_user_id" AS "alias_owner", alias."ownership_source"
      FROM "revenuecat_event_subjects" AS subject
      LEFT JOIN "revenuecat_customer_aliases" AS alias
        ON alias."alias_hash" = subject."subject_hash"
      WHERE subject."event_id" = ${claim.eventId}
    `);
    const lockedOwnerFor = (subject: (typeof locked.rows)[number]) =>
      subject.ownership_source === "authenticated"
        ? subject.alias_owner
        : (subject.alias_owner ?? subject.local_user_id);
    const lockedOwnerSubjects =
      event.type === "PURCHASE_REDEEMED"
        ? locked.rows.filter((subject) =>
            Boolean(
              subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy,
            ),
          )
        : locked.rows;
    const lockedOwners = [
      ...new Set(
        lockedOwnerSubjects
          .map(lockedOwnerFor)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (
      locked.rows.length + event.pruned_identity_count !==
        event.identity_count ||
      lockedOwnerSubjects.some((subject) => !lockedOwnerFor(subject)) ||
      lockedOwners.length !== owners.length ||
      lockedOwners.some((owner) => !owners.includes(owner))
    ) {
      throw new Error("identity_set_changed");
    }
    const fence = { eventId: claim.eventId, leaseId: claim.leaseId };
    let advanced = false;
    if (event.entitlement_required && event.entitlement_applied_at === null) {
      if (event.type === "TRANSFER") {
        const fromOwners = new Set(
          locked.rows
            .filter((subject) =>
              Boolean(
                subject.role_mask &
                REVENUECAT_SUBJECT_ROLE_MASKS.transferredFrom,
              ),
            )
            .map(lockedOwnerFor)
            .filter((v): v is string => !!v),
        );
        const toOwners = new Set(
          locked.rows
            .filter((subject) =>
              Boolean(
                subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo,
              ),
            )
            .map(lockedOwnerFor)
            .filter((v): v is string => !!v),
        );
        const inactive = [...fromOwners]
          .filter((owner) => !toOwners.has(owner))
          .every((owner) =>
            projectRevenueCatSnapshot({
              snapshot: lookups.get(owner)!.snapshot,
              config,
              operationId: `webhook:${claim.eventId}`,
            }).every((row) => !row.active),
          );
        const destinationApplied =
          toOwners.size > 0 &&
          [...toOwners].every((owner) => lookups.has(owner));
        if (!inactive || !destinationApplied) throw new Error("visibility_lag");
      }
      for (const owner of owners) {
        const projection = await applyTrustedSnapshot(transaction, {
          userId: owner,
          snapshot: lookups.get(owner)!.snapshot,
          config,
          operationId: `webhook:${claim.eventId}`,
          fence,
        });
        if (projection.deleted || projection.fencedOut)
          throw new Error("fence_lost");
        advanced = projection.advanced || advanced;
      }
    }

    if (event.identity_required && event.identity_applied_at === null) {
      const toOwner = locked.rows
        .filter((subject) =>
          Boolean(
            subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo,
          ),
        )
        .map(lockedOwnerFor)
        .find((value): value is string => !!value);
      const redeemedBy = locked.rows
        .filter((subject) =>
          Boolean(subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy),
        )
        .map(lockedOwnerFor)
        .find((value): value is string => !!value);
      if (event.type === "TRANSFER" && !toOwner)
        throw new Error("unreconstructable");
      const ordinaryOwner = owners.length === 1 ? owners[0] : null;
      if (event.type !== "TRANSFER" && !redeemedBy && !ordinaryOwner) {
        throw new Error("identity_conflict");
      }
      for (const subject of locked.rows) {
        const directOwner =
          subject.ownership_source === "authenticated"
            ? subject.alias_owner
            : null;
        const isRedemption = event.type === "PURCHASE_REDEEMED";
        const isRedeemer = Boolean(
          subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy,
        );
        const redemptionMayAlias =
          event.metadata["redemptionOutcome"] === "alias" ||
          event.metadata["redemptionOutcome"] === "redeemer_owns";
        const target =
          directOwner ??
          (event.type === "TRANSFER"
            ? toOwner
            : isRedemption
              ? isRedeemer
                ? redeemedBy
                : null
              : ordinaryOwner);
        if (!target && !isRedemption) throw new Error("unreconstructable");
        if (!target) {
          await transaction.execute(sql`
            UPDATE "revenuecat_event_subjects"
            SET "local_user_id" = NULL
            WHERE "event_id" = ${claim.eventId}
              AND "subject_hash" = ${subject.subject_hash}
          `);
          continue;
        }
        let linkedTarget = target;
        if (
          !directOwner &&
          (!isRedemption || (isRedeemer && redemptionMayAlias))
        ) {
          const assigned = await transaction.execute<{
            local_user_id: string;
          }>(sql`
            INSERT INTO "revenuecat_customer_aliases" (
              "alias_hash", "local_user_id", "alias_kind", "ownership_source",
              "source_event_at", "source_event_id"
            ) VALUES (
              ${subject.subject_hash}, ${target},
              ${event.type === "TRANSFER" ? "transferred" : "ordinary"},
              'webhook', ${event.event_at}, ${claim.eventId}
            )
            ON CONFLICT ("alias_hash") DO UPDATE SET
              "local_user_id" = EXCLUDED."local_user_id",
              "alias_kind" = EXCLUDED."alias_kind",
              "source_event_at" = EXCLUDED."source_event_at",
              "source_event_id" = EXCLUDED."source_event_id",
              "updated_at" = clock_timestamp()
            WHERE "revenuecat_customer_aliases"."ownership_source" = 'webhook'
              AND (
                "revenuecat_customer_aliases"."source_event_at" < EXCLUDED."source_event_at"
                OR (
                  "revenuecat_customer_aliases"."source_event_at" = EXCLUDED."source_event_at"
                  AND "revenuecat_customer_aliases"."source_event_id" COLLATE "C"
                    < EXCLUDED."source_event_id" COLLATE "C"
                )
              )
            RETURNING "local_user_id"
          `);
          if (assigned.rows[0]?.local_user_id) {
            linkedTarget = assigned.rows[0].local_user_id;
          } else {
            const established = await transaction.execute<{
              local_user_id: string;
            }>(sql`
              SELECT "local_user_id" FROM "revenuecat_customer_aliases"
              WHERE "alias_hash" = ${subject.subject_hash}
            `);
            if (!established.rows[0]?.local_user_id) {
              throw new Error("identity_set_changed");
            }
            linkedTarget = established.rows[0].local_user_id;
          }
        }
        await transaction.execute(sql`
          UPDATE "revenuecat_event_subjects"
          SET "local_user_id" = ${linkedTarget}
          WHERE "event_id" = ${claim.eventId}
            AND "subject_hash" = ${subject.subject_hash}
        `);
      }
    }
    const completed = await transaction.execute<{ event_id: string }>(sql`
      UPDATE "revenuecat_webhook_events"
      SET "identity_applied_at" = CASE WHEN "identity_required"
            THEN COALESCE("identity_applied_at", clock_timestamp())
            ELSE "identity_applied_at" END,
          "entitlement_applied_at" = CASE WHEN "entitlement_required"
            THEN COALESCE("entitlement_applied_at", clock_timestamp())
            ELSE "entitlement_applied_at" END,
          "processed_at" = clock_timestamp(),
          "disposition" = ${advanced ? "applied" : "stale"},
          "processing_lease_id" = NULL,
          "processing_lease_until" = NULL
      WHERE "event_id" = ${claim.eventId}
        AND "disposition" = 'pending'
        AND "processing_lease_id" = ${claim.leaseId}
        AND "processing_lease_until" > clock_timestamp()
      RETURNING "event_id"
    `);
    if (completed.rows.length !== 1) throw new Error("fence_lost");
  }).catch(async () => retryEvent(claim));
}

export async function runPendingEventBatch(
  input: Readonly<{
    config: RevenueCatConfig;
    client: RevenueCatClient;
    limit?: number;
  }>,
): Promise<number> {
  const claims = await claimPendingRevenueCatEvents(input.limit);
  for (const claim of claims) {
    await recoverClaimedEvent(claim, input.config, input.client);
  }
  return claims.length;
}

export async function cleanupRevenueCatEvents(): Promise<void> {
  // Generic canonical observations may satisfy only non-transfer entitlement
  // work. They never complete identity and never write either TRANSFER phase.
  await db.execute(sql`
    UPDATE "revenuecat_webhook_events" AS event
    SET "entitlement_applied_at" = COALESCE(
          event."entitlement_applied_at", clock_timestamp()
        ),
        "next_attempt_at" = LEAST(event."next_attempt_at", clock_timestamp())
    WHERE event."disposition" = 'pending'
      AND event."type" <> 'TRANSFER'
      AND event."received_at" <= clock_timestamp() - interval '30 days'
      AND (event."processing_lease_until" IS NULL OR event."processing_lease_until" <= clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        LEFT JOIN "revenuecat_customer_state" AS state
          ON state."user_id" = subject."local_user_id"
        WHERE subject."event_id" = event."event_id"
          AND (
            state."canonicalization_state" IS DISTINCT FROM 'canonical'
            OR state."last_reconciled_at" IS NULL
            OR state."last_reconciled_at" < event."received_at"
          )
      )
  `);
  await db.execute(sql`
    DELETE FROM "revenuecat_webhook_events"
    WHERE (
      "disposition" <> 'pending'
      AND "retention_until" <= clock_timestamp()
    ) OR (
      "disposition" = 'pending'
      AND "retention_until" <= clock_timestamp()
      AND "pruned_identity_count" = "identity_count"
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
      AND ("processing_lease_until" IS NULL OR "processing_lease_until" <= clock_timestamp())
    )
  `);
  await db.execute(sql`
    UPDATE "revenuecat_webhook_events" AS event
    SET "next_attempt_at" = LEAST(event."next_attempt_at", clock_timestamp())
    WHERE event."disposition" = 'pending'
      AND event."retention_until" <= clock_timestamp()
      AND (event."processing_lease_until" IS NULL OR event."processing_lease_until" <= clock_timestamp())
      AND EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = event."event_id"
      )
  `);
  await db.execute(sql`
    UPDATE "revenuecat_customer_state" AS state
    SET "reconcile_reason" = 'webhook_failure',
        "reconcile_after" = LEAST(state."reconcile_after", clock_timestamp()),
        "updated_at" = clock_timestamp()
    WHERE EXISTS (
      SELECT 1
      FROM "revenuecat_event_subjects" AS subject
      JOIN "revenuecat_webhook_events" AS event
        ON event."event_id" = subject."event_id"
      WHERE subject."local_user_id" = state."user_id"
        AND event."disposition" = 'pending'
        AND event."retention_until" <= clock_timestamp()
    )
  `);
  const alerts = await db.execute<{ type: string; count: number }>(sql`
    SELECT "type", count(*)::integer AS "count"
    FROM "revenuecat_webhook_events"
    WHERE "disposition" = 'pending'
      AND "received_at" <= clock_timestamp() - interval '24 hours'
      AND EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
    GROUP BY "type"
  `);
  for (const alert of alerts.rows) {
    logger.error(
      { type: alert.type, count: alert.count },
      "RevenueCat identity reconciliation requires attention",
    );
  }
}

export async function countUnreconciledTrustedUsers(): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count(*)::integer AS "count"
    FROM "users" AS live_user
    LEFT JOIN "revenuecat_customer_state" AS state
      ON state."user_id" = live_user."id"
    WHERE state."user_id" IS NULL
       OR state."canonicalization_state" <> 'canonical'
  `);
  return rows.rows[0]?.count ?? 0;
}

export async function bootstrapRevenueCatCustomers(
  input: Readonly<{
    config: RevenueCatConfig;
    client: RevenueCatClient;
    runId: string;
    batchSize: number;
  }>,
): Promise<{ attempted: number; remaining: number }> {
  let cursor = "";
  let attempted = 0;
  while (true) {
    const page = await db.execute<{ user_id: string }>(sql`
      SELECT state."user_id"
      FROM "revenuecat_customer_state" AS state
      JOIN "users" AS live_user ON live_user."id" = state."user_id"
      WHERE state."canonicalization_state" <> 'canonical'
        AND state."user_id" COLLATE "C" > ${cursor} COLLATE "C"
      ORDER BY state."user_id" COLLATE "C"
      LIMIT ${input.batchSize}
    `);
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      attempted += 1;
      try {
        await reconcileTrustedUser({
          userId: row.user_id,
          reason: "legacy_bootstrap",
          operationId: `bootstrap:${input.runId}`,
          allowCreatedEmpty: true,
          config: input.config,
          client: input.client,
        });
      } catch (error) {
        await db.execute(sql`
          UPDATE "revenuecat_customer_state"
          SET "reconcile_after" = clock_timestamp() + interval '1 minute',
              "reconcile_last_error_code" = ${sanitizeRevenueCatErrorCode(error)},
              "updated_at" = clock_timestamp()
          WHERE "user_id" = ${row.user_id}
        `);
      }
    }
    cursor = page.rows.at(-1)!.user_id;
  }
  return { attempted, remaining: await countUnreconciledTrustedUsers() };
}

export function revenueCatRuntimeFromEnvironment(): Readonly<{
  config: RevenueCatConfig;
  client: RevenueCatClient;
}> {
  const config = loadRevenueCatConfig(process.env);
  return { config, client: createRevenueCatClient({ apiKey: config.apiKey }) };
}

export function startRevenueCatWorkers(
  options?: Readonly<{
    intervalMs?: number;
  }>,
): () => void {
  const runtime = revenueCatRuntimeFromEnvironment();
  const intervalMs = options?.intervalMs ?? WORKER_INTERVAL_MS;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runTrustedUserBatch(runtime);
      await runPendingEventBatch(runtime);
      await cleanupRevenueCatEvents();
    } catch (error) {
      logger.error(
        { errorCode: sanitizeRevenueCatErrorCode(error) },
        "RevenueCat reconciliation batch failed",
      );
    } finally {
      running = false;
      schedule();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
