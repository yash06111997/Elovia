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
import { RECONCILING_REVENUECAT_EVENTS } from "./revenuecatContract.js";
import {
  applyTrustedSnapshot,
  reconcileTrustedUser,
} from "./revenuecatReconciler.js";
import { logger } from "./logger.js";
import { projectRevenueCatSnapshot } from "./revenuecatSnapshot.js";
import {
  classifyRawlessRevenueCatEvent,
  reconcileRetryDelayMs,
  sanitizeRevenueCatErrorCode,
  type RawlessRevenueCatSubject,
} from "./revenuecatWorkerCore.js";

const CUSTOMER_BATCH_SIZE = 20;
const EVENT_BATCH_SIZE = 20;
const WORKER_INTERVAL_MS = 30_000;
const MAX_EVENT_LOCK_EXPANSIONS = 4;

export type RevenueCatWorkerMetric = Readonly<{
  type:
    | "customer_reconcile_success"
    | "customer_reconcile_failure"
    | "event_recovery_success"
    | "event_recovery_failure"
    | "event_recovery_expansion";
  errorCode?:
    | "applied"
    | "stale"
    | "deleted"
    | "revenuecat_visibility_lag"
    | "revenuecat_request_invalid"
    | "revenuecat_configuration_invalid"
    | "revenuecat_unavailable"
    | "revenuecat_timeout"
    | "canonical_response_invalid"
    | "canonical_mapping_mismatch"
    | "revenuecat_worker_failure"
    | "identity_conflict"
    | "identity_set_changed"
    | "fence_lost";
  count: number;
}>;

type RevenueCatWorkerMetricSink = (metric: RevenueCatWorkerMetric) => void;

function emitMetric(
  sink: RevenueCatWorkerMetricSink | undefined,
  metric: RevenueCatWorkerMetric,
): void {
  sink?.(metric);
}

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
    metric?: RevenueCatWorkerMetricSink;
  }>,
): Promise<{ claimed: number; succeeded: number; retried: number }> {
  const limit = input.limit ?? CUSTOMER_BATCH_SIZE;
  let claimed = 0;
  let succeeded = 0;
  let retried = 0;
  while (claimed < limit) {
    const claim = (await claimDueTrustedUsers(1))[0];
    if (!claim) break;
    claimed += 1;
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
        emitMetric(input.metric, {
          type: "customer_reconcile_success",
          errorCode: "deleted",
          count: 1,
        });
      } else if (
        reconciled.outcome === "applied" ||
        reconciled.outcome === "stale"
      ) {
        if (await finishTrustedClaim(claim, "success")) {
          succeeded += 1;
          emitMetric(input.metric, {
            type: "customer_reconcile_success",
            errorCode: reconciled.outcome,
            count: 1,
          });
        }
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
          emitMetric(input.metric, {
            type: "customer_reconcile_failure",
            errorCode: "revenuecat_visibility_lag",
            count: 1,
          });
        }
      } else if (reconciled.outcome === "fenced_out") {
        emitMetric(input.metric, {
          type: "customer_reconcile_failure",
          errorCode: "fence_lost",
          count: 1,
        });
      }
    } catch (error) {
      const errorCode = sanitizeRevenueCatErrorCode(
        error,
      ) as RevenueCatWorkerMetric["errorCode"];
      if (
        await finishTrustedClaim(
          claim,
          "retry",
          errorCode,
          reconcileRetryDelayMs(claim.attemptCount),
        )
      ) {
        retried += 1;
        emitMetric(input.metric, {
          type: "customer_reconcile_failure",
          errorCode,
          count: 1,
        });
      }
    }
  }
  return { claimed, succeeded, retried };
}

export async function reconcileTrustedUserOnDemand(
  input: Readonly<{
    userId: string;
    config: RevenueCatConfig;
    client: RevenueCatClient;
    metric?: RevenueCatWorkerMetricSink;
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
    if (outcome.outcome === "deleted") {
      await finishTrustedClaim(work, "deleted");
      emitMetric(input.metric, {
        type: "customer_reconcile_success",
        errorCode: "deleted",
        count: 1,
      });
    } else if (outcome.outcome === "applied" || outcome.outcome === "stale") {
      if (await finishTrustedClaim(work, "success")) {
        emitMetric(input.metric, {
          type: "customer_reconcile_success",
          errorCode: outcome.outcome,
          count: 1,
        });
      }
    } else if (outcome.outcome === "visibility_lag") {
      if (
        await finishTrustedClaim(
          work,
          "retry",
          "revenuecat_visibility_lag",
          60_000,
        )
      ) {
        emitMetric(input.metric, {
          type: "customer_reconcile_failure",
          errorCode: "revenuecat_visibility_lag",
          count: 1,
        });
      }
    } else {
      emitMetric(input.metric, {
        type: "customer_reconcile_failure",
        errorCode: "fence_lost",
        count: 1,
      });
    }
  } catch (error) {
    const errorCode = sanitizeRevenueCatErrorCode(
      error,
    ) as RevenueCatWorkerMetric["errorCode"];
    if (
      await finishTrustedClaim(
        work,
        "retry",
        errorCode,
        reconcileRetryDelayMs(attemptCount),
      )
    ) {
      emitMetric(input.metric, {
        type: "customer_reconcile_failure",
        errorCode,
        count: 1,
      });
    }
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
      // This exact subject-hash lookup is intentionally first: the forward
      // index makes repeat authentication a bounded no-op when no pending
      // delivery can benefit from relinking or an ownership wake-up.
      const pendingMatches = await transaction.execute<{
        event_id: string;
        local_user_id: string | null;
      }>(sql`
        SELECT subject."event_id", subject."local_user_id"
        FROM "revenuecat_event_subjects" AS subject
        JOIN "revenuecat_webhook_events" AS event
          ON event."event_id" = subject."event_id"
        WHERE subject."subject_hash" = ${hash}
          AND event."disposition" = 'pending'
        ORDER BY subject."event_id" COLLATE "C"
      `);
      const prior = await transaction.execute<{
        local_user_id: string;
        alias_kind: string;
        ownership_source: string;
        source_event_at: Date | null;
        source_event_id: string | null;
        authenticated_at: Date | null;
      }>(sql`
        SELECT "local_user_id", "alias_kind", "ownership_source",
               "source_event_at", "source_event_id", "authenticated_at"
        FROM "revenuecat_customer_aliases"
        WHERE "alias_hash" = ${hash}
        FOR UPDATE
      `);
      const previous = prior.rows[0];
      const displaced = previous?.local_user_id ?? null;
      const aliasNeedsWrite =
        !previous ||
        previous.local_user_id !== user.id ||
        previous.alias_kind !== "authenticated" ||
        previous.ownership_source !== "authenticated" ||
        previous.source_event_at !== null ||
        previous.source_event_id !== null ||
        previous.authenticated_at?.getTime() !== createdAt.getTime();
      if (aliasNeedsWrite) {
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
      }
      const needsRelink = pendingMatches.rows.some(
        (match) => match.local_user_id !== user.id,
      );
      if (needsRelink || (aliasNeedsWrite && pendingMatches.rows.length > 0)) {
        await transaction.execute(sql`
          WITH relinked AS (
            UPDATE "revenuecat_event_subjects" AS subject
            SET "local_user_id" = ${user.id}
            FROM "revenuecat_webhook_events" AS event
            WHERE subject."event_id" = event."event_id"
              AND subject."subject_hash" = ${hash}
              AND subject."local_user_id" IS DISTINCT FROM ${user.id}
              AND event."disposition" = 'pending'
            RETURNING subject."event_id"
          )
          UPDATE "revenuecat_webhook_events" AS event
          SET "next_attempt_at" = LEAST(
            event."next_attempt_at", clock_timestamp()
          )
          WHERE event."disposition" = 'pending'
            AND (
              event."event_id" IN (
                SELECT relinked."event_id" FROM relinked
              )
              OR (
                ${aliasNeedsWrite}
                AND EXISTS (
                  SELECT 1 FROM "revenuecat_event_subjects" AS subject
                  WHERE subject."event_id" = event."event_id"
                    AND subject."subject_hash" = ${hash}
                )
              )
            )
        `);
      }
      const ownershipChanged = Boolean(displaced && displaced !== user.id);
      if (aliasNeedsWrite || ownershipChanged || needsRelink) {
        await enqueueAuthenticatedOwner(transaction, user.id, true);
      }
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
        AND NOT (
          "pruned_identity_count" = "identity_count"
          AND NOT EXISTS (
            SELECT 1 FROM "revenuecat_event_subjects" AS subject
            WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
          )
        )
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

async function retryEvent(
  claim: EventClaim,
  _errorCode: RevenueCatWorkerMetric["errorCode"] = "revenuecat_worker_failure",
): Promise<boolean> {
  const retryDelayMs = reconcileRetryDelayMs(claim.attemptCount);
  const retried = await db.execute<{ event_id: string }>(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = NULL,
        "processing_lease_until" = NULL,
        "next_attempt_at" = clock_timestamp()
          + ${retryDelayMs} * interval '1 millisecond'
    WHERE "event_id" = ${claim.eventId}
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
    RETURNING "event_id"
  `);
  return retried.rows.length === 1;
}

async function settleClaimedFullyPrunedEvent(
  claim: EventClaim,
): Promise<boolean> {
  const deleted = await db.execute<{ event_id: string }>(sql`
    DELETE FROM "revenuecat_webhook_events"
    WHERE "event_id" = ${claim.eventId}
      AND "disposition" = 'pending'
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
      AND "retention_until" <= clock_timestamp()
      AND "pruned_identity_count" = "identity_count"
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
    RETURNING "event_id"
  `);
  if (deleted.rows.length === 1) return true;
  const deferred = await db.execute<{ event_id: string }>(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = NULL,
        "processing_lease_until" = NULL,
        "next_attempt_at" = GREATEST(
          "next_attempt_at", "retention_until",
          clock_timestamp() + interval '1 minute'
        )
    WHERE "event_id" = ${claim.eventId}
      AND "disposition" = 'pending'
      AND "processing_lease_id" = ${claim.leaseId}
      AND "processing_lease_until" > clock_timestamp()
      AND "pruned_identity_count" = "identity_count"
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
    RETURNING "event_id"
  `);
  return deferred.rows.length === 1;
}

async function settleUnclaimedFullyPrunedEvents(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "revenuecat_webhook_events"
    WHERE "disposition" = 'pending'
      AND "retention_until" <= clock_timestamp()
      AND "pruned_identity_count" = "identity_count"
      AND (
        "processing_lease_until" IS NULL
        OR "processing_lease_until" <= clock_timestamp()
      )
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
  `);
  await db.execute(sql`
    UPDATE "revenuecat_webhook_events"
    SET "next_attempt_at" = GREATEST("next_attempt_at", "retention_until")
    WHERE "disposition" = 'pending'
      AND "retention_until" > clock_timestamp()
      AND "next_attempt_at" < "retention_until"
      AND "pruned_identity_count" = "identity_count"
      AND (
        "processing_lease_until" IS NULL
        OR "processing_lease_until" <= clock_timestamp()
      )
      AND NOT EXISTS (
        SELECT 1 FROM "revenuecat_event_subjects" AS subject
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
      )
  `);
}

class EventOwnershipExpansion extends Error {
  constructor(readonly owners: readonly string[]) {
    super("RevenueCat event ownership expanded.");
  }
}

function byteOrdered(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}

export async function recoverClaimedRevenueCatEvent(
  claim: EventClaim,
  config: RevenueCatConfig,
  client: RevenueCatClient,
  metric?: RevenueCatWorkerMetricSink,
  expansionAttempt = 0,
  inheritedLockOwners: readonly string[] = [],
  inheritedLookups?: Map<
    string,
    Awaited<ReturnType<RevenueCatClient["getSubscriber"]>>
  >,
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
  if (!RECONCILING_REVENUECAT_EVENTS.has(event.type)) {
    if (await retryEvent(claim, "identity_set_changed")) {
      emitMetric(metric, {
        type: "event_recovery_failure",
        errorCode: "identity_set_changed",
        count: 1,
      });
    }
    return;
  }
  const subjects = await db.execute<{
    subject_hash: string;
    role_mask: number;
    local_user_id: string | null;
    local_user_exists: boolean;
    alias_owner: string | null;
    ownership_source: "authenticated" | "webhook" | null;
  }>(sql`
    SELECT subject."subject_hash", subject."role_mask", subject."local_user_id",
           EXISTS(
             SELECT 1 FROM "users" AS local_user
             WHERE local_user."id" = subject."local_user_id"
               AND NOT EXISTS (
                 SELECT 1 FROM "account_deletions" AS deletion
                 WHERE deletion."user_id" = local_user."id"
               )
           ) AS "local_user_exists",
           CASE WHEN alias_user."id" IS NOT NULL AND alias_deletion."user_id" IS NULL
             THEN alias."local_user_id" ELSE NULL END AS "alias_owner",
           CASE WHEN alias_user."id" IS NOT NULL AND alias_deletion."user_id" IS NULL
             THEN alias."ownership_source" ELSE NULL END AS "ownership_source"
    FROM "revenuecat_event_subjects" AS subject
    LEFT JOIN "revenuecat_customer_aliases" AS alias
      ON alias."alias_hash" = subject."subject_hash"
    LEFT JOIN "users" AS alias_user ON alias_user."id" = alias."local_user_id"
    LEFT JOIN "account_deletions" AS alias_deletion
      ON alias_deletion."user_id" = alias_user."id"
    WHERE subject."event_id" = ${claim.eventId}
    ORDER BY subject."subject_hash" COLLATE "C"
  `);
  if (
    subjects.rows.length + event.pruned_identity_count !==
    event.identity_count
  ) {
    if (await retryEvent(claim, "identity_set_changed")) {
      emitMetric(metric, {
        type: "event_recovery_failure",
        errorCode: "identity_set_changed",
        count: 1,
      });
    }
    return;
  }
  if (subjects.rows.length === 0) {
    await settleClaimedFullyPrunedEvent(claim);
    return;
  }
  const decision = classifyRawlessRevenueCatEvent({
    eventType: event.type,
    subjects: subjects.rows.map(
      (subject): RawlessRevenueCatSubject => ({
        subjectHash: subject.subject_hash,
        roleMask: subject.role_mask,
        localUserId: subject.local_user_id,
        localUserExists: subject.local_user_exists,
        aliasOwner: subject.alias_owner,
        ownershipSource: subject.ownership_source,
      }),
    ),
  });
  if (decision.kind !== "ready") {
    const errorCode =
      decision.kind === "identity_conflict"
        ? "identity_conflict"
        : "identity_set_changed";
    if (await retryEvent(claim, errorCode)) {
      emitMetric(metric, {
        type: "event_recovery_failure",
        errorCode,
        count: 1,
      });
    }
    return;
  }
  const owners = [...decision.owners];
  const lockOwners = byteOrdered([
    ...inheritedLockOwners,
    ...decision.observedOwners,
  ]);
  const lookups =
    inheritedLookups ??
    new Map<string, Awaited<ReturnType<RevenueCatClient["getSubscriber"]>>>();
  if (event.entitlement_required && event.entitlement_applied_at === null) {
    try {
      for (const owner of owners) {
        if (lookups.has(owner)) continue;
        const lookup = await client.getSubscriber(owner as never);
        if (lookup.lookup !== "existing") {
          if (await retryEvent(claim, "revenuecat_visibility_lag")) {
            emitMetric(metric, {
              type: "event_recovery_failure",
              errorCode: "revenuecat_visibility_lag",
              count: 1,
            });
          }
          return;
        }
        lookups.set(owner, lookup);
      }
    } catch (error) {
      const errorCode = sanitizeRevenueCatErrorCode(
        error,
      ) as RevenueCatWorkerMetric["errorCode"];
      if (await retryEvent(claim, errorCode)) {
        emitMetric(metric, {
          type: "event_recovery_failure",
          errorCode,
          count: 1,
        });
      }
      return;
    }
  }

  try {
    const completedDisposition = await withAccountLocks(
      lockOwners,
      async (transaction) => {
        const lockedEventRows = await transaction.execute<{
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
                 "identity_applied_at", "entitlement_applied_at"
          FROM "revenuecat_webhook_events"
          WHERE "event_id" = ${claim.eventId}
            AND "disposition" = 'pending'
            AND "processing_lease_id" = ${claim.leaseId}
            AND "processing_lease_until" > clock_timestamp()
          FOR UPDATE
        `);
        const lockedEvent = lockedEventRows.rows[0];
        if (!lockedEvent) {
          throw Object.assign(new Error("fence_lost"), {
            code: "fence_lost",
          });
        }
        const locked = await transaction.execute<{
          subject_hash: string;
          role_mask: number;
          local_user_id: string | null;
          local_user_exists: boolean;
          alias_owner: string | null;
          ownership_source: "authenticated" | "webhook" | null;
        }>(sql`
      SELECT subject."subject_hash", subject."role_mask", subject."local_user_id",
             EXISTS(
               SELECT 1 FROM "users" AS local_user
               WHERE local_user."id" = subject."local_user_id"
                 AND NOT EXISTS (
                   SELECT 1 FROM "account_deletions" AS deletion
                   WHERE deletion."user_id" = local_user."id"
                 )
             ) AS "local_user_exists",
             CASE WHEN alias_user."id" IS NOT NULL AND alias_deletion."user_id" IS NULL
               THEN alias."local_user_id" ELSE NULL END AS "alias_owner",
             CASE WHEN alias_user."id" IS NOT NULL AND alias_deletion."user_id" IS NULL
               THEN alias."ownership_source" ELSE NULL END AS "ownership_source"
      FROM "revenuecat_event_subjects" AS subject
      LEFT JOIN "revenuecat_customer_aliases" AS alias
        ON alias."alias_hash" = subject."subject_hash"
      LEFT JOIN "users" AS alias_user ON alias_user."id" = alias."local_user_id"
      LEFT JOIN "account_deletions" AS alias_deletion
        ON alias_deletion."user_id" = alias_user."id"
      WHERE subject."event_id" = ${claim.eventId}
      ORDER BY subject."subject_hash" COLLATE "C"
    `);
        const lockedDecision = classifyRawlessRevenueCatEvent({
          eventType: lockedEvent.type,
          subjects: locked.rows.map(
            (subject): RawlessRevenueCatSubject => ({
              subjectHash: subject.subject_hash,
              roleMask: subject.role_mask,
              localUserId: subject.local_user_id,
              localUserExists: subject.local_user_exists,
              aliasOwner: subject.alias_owner,
              ownershipSource: subject.ownership_source,
            }),
          ),
        });
        if (
          locked.rows.length + lockedEvent.pruned_identity_count !==
            lockedEvent.identity_count ||
          lockedDecision.kind !== "ready"
        ) {
          throw Object.assign(new Error("identity_set_changed"), {
            code:
              lockedDecision.kind === "identity_conflict"
                ? "identity_conflict"
                : "identity_set_changed",
          });
        }
        const expandedOwners = byteOrdered([
          ...lockedDecision.observedOwners.filter(
            (owner) => !lockOwners.includes(owner),
          ),
          ...(lockedEvent.entitlement_required &&
          lockedEvent.entitlement_applied_at === null
            ? lockedDecision.owners.filter((owner) => !lookups.has(owner))
            : []),
        ]);
        if (expandedOwners.length > 0) {
          throw new EventOwnershipExpansion(expandedOwners);
        }
        const fence = { eventId: claim.eventId, leaseId: claim.leaseId };
        let advanced = false;
        if (
          lockedEvent.entitlement_required &&
          lockedEvent.entitlement_applied_at === null
        ) {
          if (lockedEvent.type === "TRANSFER") {
            const sourceOwner = lockedDecision.sourceOwner;
            const destinationOwner = lockedDecision.destinationOwner;
            if (sourceOwner && sourceOwner !== destinationOwner) {
              const sourceLookup = lookups.get(sourceOwner);
              const inactive =
                sourceLookup?.lookup === "existing" &&
                projectRevenueCatSnapshot({
                  snapshot: sourceLookup.snapshot,
                  config,
                  operationId: `webhook:${claim.eventId}`,
                }).every((row) => !row.active);
              if (!inactive) {
                throw Object.assign(new Error("visibility_lag"), {
                  code: "revenuecat_visibility_lag",
                });
              }
            }
          }
          for (const owner of lockedDecision.owners) {
            const projection = await applyTrustedSnapshot(transaction, {
              userId: owner,
              snapshot: lookups.get(owner)!.snapshot,
              config,
              operationId: `webhook:${claim.eventId}`,
              fence,
            });
            if (projection.deleted || projection.fencedOut)
              throw Object.assign(new Error("fence_lost"), {
                code: "fence_lost",
              });
            advanced = projection.advanced || advanced;
          }
        }

        if (
          lockedEvent.identity_required &&
          lockedEvent.identity_applied_at === null
        ) {
          const resolvedByHash = new Map(
            lockedDecision.subjects.map((subject) => [
              subject.subjectHash,
              subject,
            ]),
          );
          for (const subject of locked.rows) {
            const resolved = resolvedByHash.get(subject.subject_hash)!;
            const directOwner = resolved.directOwner;
            const isRedemption = lockedEvent.type === "PURCHASE_REDEEMED";
            const isRedeemer = Boolean(
              subject.role_mask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy,
            );
            const redemptionMayAlias =
              lockedEvent.metadata["redemptionOutcome"] === "alias" ||
              lockedEvent.metadata["redemptionOutcome"] === "redeemer_owns";
            let target: string | null;
            if (directOwner) {
              target = directOwner;
            } else if (lockedEvent.type === "TRANSFER") {
              if (!lockedDecision.destinationOwner) {
                target = resolved.owner;
              } else {
                target = lockedDecision.destinationOwner;
              }
            } else if (isRedemption) {
              target = isRedeemer ? lockedDecision.ordinaryOwner : null;
            } else {
              target = lockedDecision.ordinaryOwner;
            }
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
              (lockedEvent.type !== "TRANSFER" ||
                lockedDecision.destinationOwner !== null) &&
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
              ${lockedEvent.type === "TRANSFER" ? "transferred" : "ordinary"},
              'webhook', ${lockedEvent.event_at}, ${claim.eventId}
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
                advanced = true;
              } else {
                const established = await transaction.execute<{
                  local_user_id: string;
                }>(sql`
              SELECT "local_user_id" FROM "revenuecat_customer_aliases"
              WHERE "alias_hash" = ${subject.subject_hash}
            `);
                const establishedOwner =
                  established.rows[0]?.local_user_id ?? null;
                if (
                  establishedOwner &&
                  !lockOwners.includes(establishedOwner)
                ) {
                  throw new EventOwnershipExpansion([establishedOwner]);
                }
                linkedTarget = establishedOwner;
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
        if (completed.rows.length !== 1) {
          throw Object.assign(new Error("fence_lost"), {
            code: "fence_lost",
          });
        }
        return advanced ? "applied" : "stale";
      },
    );
    emitMetric(metric, {
      type: "event_recovery_success",
      errorCode: completedDisposition,
      count: 1,
    });
  } catch (error) {
    if (
      error instanceof EventOwnershipExpansion &&
      expansionAttempt + 1 < MAX_EVENT_LOCK_EXPANSIONS
    ) {
      emitMetric(metric, {
        type: "event_recovery_expansion",
        errorCode: "identity_set_changed",
        count: 1,
      });
      return recoverClaimedRevenueCatEvent(
        claim,
        config,
        client,
        metric,
        expansionAttempt + 1,
        byteOrdered([...lockOwners, ...error.owners]),
        lookups,
      );
    }
    const errorCode =
      error instanceof EventOwnershipExpansion
        ? "identity_set_changed"
        : (sanitizeRevenueCatErrorCode(
            error,
          ) as RevenueCatWorkerMetric["errorCode"]);
    if (await retryEvent(claim, errorCode)) {
      emitMetric(metric, {
        type: "event_recovery_failure",
        errorCode,
        count: 1,
      });
    }
  }
}

export async function runPendingEventBatch(
  input: Readonly<{
    config: RevenueCatConfig;
    client: RevenueCatClient;
    limit?: number;
    metric?: RevenueCatWorkerMetricSink;
  }>,
): Promise<number> {
  const limit = input.limit ?? EVENT_BATCH_SIZE;
  try {
    await settleUnclaimedFullyPrunedEvents();
  } catch (error) {
    logger.error(
      { errorCode: sanitizeRevenueCatErrorCode(error) },
      "RevenueCat fully-pruned event cleanup failed",
    );
  }
  let claimed = 0;
  while (claimed < limit) {
    const claim = (await claimPendingRevenueCatEvents(1))[0];
    if (!claim) break;
    claimed += 1;
    await recoverClaimedRevenueCatEvent(
      claim,
      input.config,
      input.client,
      input.metric,
    );
  }
  return claimed;
}

type CleanupAuthorityRow = Readonly<{
  subject_hash: string;
  direct_owner: string | null;
  alias_owner: string | null;
}>;

class CleanupAuthorityExpansion extends Error {
  constructor(readonly owners: readonly string[]) {
    super("RevenueCat cleanup authority expanded.");
  }
}

function cleanupAuthorityQuery(eventId: string) {
  return sql`
    SELECT subject."subject_hash",
           CASE WHEN direct_user."id" IS NOT NULL
                  AND direct_deletion."user_id" IS NULL
             THEN subject."local_user_id" ELSE NULL END AS "direct_owner",
           CASE WHEN alias_user."id" IS NOT NULL
                  AND alias_deletion."user_id" IS NULL
             THEN alias."local_user_id" ELSE NULL END AS "alias_owner"
    FROM "revenuecat_event_subjects" AS subject
    LEFT JOIN "users" AS direct_user
      ON direct_user."id" = subject."local_user_id"
    LEFT JOIN "account_deletions" AS direct_deletion
      ON direct_deletion."user_id" = direct_user."id"
    LEFT JOIN "revenuecat_customer_aliases" AS alias
      ON alias."alias_hash" = subject."subject_hash"
    LEFT JOIN "users" AS alias_user ON alias_user."id" = alias."local_user_id"
    LEFT JOIN "account_deletions" AS alias_deletion
      ON alias_deletion."user_id" = alias_user."id"
    WHERE subject."event_id" = ${eventId}
    ORDER BY subject."subject_hash" COLLATE "C"
  `;
}

function cleanupAuthorityOwners(
  rows: readonly CleanupAuthorityRow[],
): string[] {
  return byteOrdered(
    rows.flatMap((row) => [
      ...(row.direct_owner ? [row.direct_owner] : []),
      ...(row.alias_owner ? [row.alias_owner] : []),
    ]),
  );
}

async function enqueueWebhookFailureOwners(
  transaction: AccountLockTransaction,
  owners: readonly string[],
): Promise<void> {
  if (owners.length === 0) return;
  await transaction.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "reconcile_reason", "reconcile_after"
    )
    SELECT live_user."id", 'pending', 'none',
           'webhook_failure', clock_timestamp()
    FROM "users" AS live_user
    WHERE live_user."id" IN (${sql.join(
      owners.map((owner) => sql`${owner}`),
      sql`, `,
    )})
      AND NOT EXISTS (
        SELECT 1 FROM "account_deletions" AS deletion
        WHERE deletion."user_id" = live_user."id"
      )
    ON CONFLICT ("user_id") DO UPDATE SET
      "reconcile_reason" = 'webhook_failure',
      "reconcile_after" = LEAST(
        "revenuecat_customer_state"."reconcile_after", clock_timestamp()
      ),
      "updated_at" = clock_timestamp()
  `);
}

async function satisfyThirtyDayEntitlementPhase(
  eventId: string,
  expansionAttempt = 0,
  inheritedOwners: readonly string[] = [],
): Promise<void> {
  const observed = await db.execute<CleanupAuthorityRow>(
    cleanupAuthorityQuery(eventId),
  );
  const lockOwners = byteOrdered([
    ...inheritedOwners,
    ...cleanupAuthorityOwners(observed.rows),
  ]);
  if (lockOwners.length === 0) return;
  try {
    await withAccountLocks(lockOwners, async (transaction) => {
      const eventRows = await transaction.execute<{ received_at: Date }>(sql`
        SELECT "received_at"
        FROM "revenuecat_webhook_events"
        WHERE "event_id" = ${eventId}
          AND "disposition" = 'pending'
          AND "type" <> 'TRANSFER'
          AND "entitlement_required"
          AND "entitlement_applied_at" IS NULL
          AND "received_at" <= clock_timestamp() - interval '30 days'
          AND (
            "processing_lease_until" IS NULL
            OR "processing_lease_until" <= clock_timestamp()
          )
        FOR UPDATE
      `);
      const event = eventRows.rows[0];
      if (!event) return;
      const locked = await transaction.execute<CleanupAuthorityRow>(
        cleanupAuthorityQuery(eventId),
      );
      const lockedOwners = cleanupAuthorityOwners(locked.rows);
      const expanded = lockedOwners.filter(
        (owner) => !lockOwners.includes(owner),
      );
      if (expanded.length > 0) {
        throw new CleanupAuthorityExpansion(expanded);
      }
      const everySubjectHasAuthority =
        locked.rows.length > 0 &&
        locked.rows.every((row) => row.direct_owner || row.alias_owner);
      if (!everySubjectHasAuthority) {
        await enqueueWebhookFailureOwners(transaction, lockedOwners);
        return;
      }
      const canonical = await transaction.execute<{
        user_id: string;
        canonicalization_state: string;
        last_reconciled_at: Date | null;
      }>(sql`
        SELECT "user_id", "canonicalization_state", "last_reconciled_at"
        FROM "revenuecat_customer_state"
        WHERE "user_id" IN (${sql.join(
          lockedOwners.map((owner) => sql`${owner}`),
          sql`, `,
        )})
      `);
      const canonicalAfterEvent = new Set(
        canonical.rows.flatMap((state) =>
          state.canonicalization_state === "canonical" &&
          state.last_reconciled_at !== null &&
          state.last_reconciled_at.getTime() >= event.received_at.getTime()
            ? [state.user_id]
            : [],
        ),
      );
      if (lockedOwners.some((owner) => !canonicalAfterEvent.has(owner))) {
        await enqueueWebhookFailureOwners(transaction, lockedOwners);
        return;
      }
      await transaction.execute(sql`
        UPDATE "revenuecat_webhook_events"
        SET "entitlement_applied_at" = COALESCE(
              "entitlement_applied_at", clock_timestamp()
            ),
            "next_attempt_at" = LEAST(
              "next_attempt_at", clock_timestamp()
            )
        WHERE "event_id" = ${eventId}
          AND "disposition" = 'pending'
          AND "type" <> 'TRANSFER'
          AND "entitlement_required"
          AND "entitlement_applied_at" IS NULL
          AND (
            "processing_lease_until" IS NULL
            OR "processing_lease_until" <= clock_timestamp()
          )
      `);
    });
  } catch (error) {
    if (
      error instanceof CleanupAuthorityExpansion &&
      expansionAttempt + 1 < MAX_EVENT_LOCK_EXPANSIONS
    ) {
      await satisfyThirtyDayEntitlementPhase(
        eventId,
        expansionAttempt + 1,
        byteOrdered([...lockOwners, ...error.owners]),
      );
      return;
    }
    if (error instanceof CleanupAuthorityExpansion) {
      const observedOwners = byteOrdered([...lockOwners, ...error.owners]);
      await withAccountLocks(observedOwners, async (transaction) => {
        await enqueueWebhookFailureOwners(transaction, observedOwners);
      });
      return;
    }
    throw error;
  }
}

async function runThirtyDayCleanup(): Promise<void> {
  let cursor = "";
  while (true) {
    const page = await db.execute<{ event_id: string }>(sql`
      SELECT "event_id"
      FROM "revenuecat_webhook_events"
      WHERE "disposition" = 'pending'
        AND "type" <> 'TRANSFER'
        AND "entitlement_required"
        AND "entitlement_applied_at" IS NULL
        AND "received_at" <= clock_timestamp() - interval '30 days'
        AND "event_id" COLLATE "C" > ${cursor} COLLATE "C"
        AND (
          "processing_lease_until" IS NULL
          OR "processing_lease_until" <= clock_timestamp()
        )
      ORDER BY "event_id" COLLATE "C"
      LIMIT 100
    `);
    if (page.rows.length === 0) return;
    for (const event of page.rows) {
      await satisfyThirtyDayEntitlementPhase(event.event_id);
    }
    cursor = page.rows.at(-1)!.event_id;
  }
}

export async function cleanupRevenueCatEvents(
  options?: Readonly<{
    alert?: (value: Readonly<{ type: string; count: number }>) => void;
  }>,
): Promise<void> {
  // Generic canonical observations may satisfy only non-transfer entitlement
  // work. Current direct and alias authorities are re-read under their ordered
  // account locks; identity and every TRANSFER phase remain event-worker only.
  await runThirtyDayCleanup();
  await db.execute(sql`
    DELETE FROM "revenuecat_webhook_events"
    WHERE (
      "disposition" <> 'pending'
      AND "retention_until" <= clock_timestamp()
    ) OR (
      "disposition" = 'pending'
      AND "retention_until" <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1
        FROM "revenuecat_event_subjects" AS subject
        LEFT JOIN "revenuecat_customer_aliases" AS alias
          ON alias."alias_hash" = subject."subject_hash"
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
          AND (
            EXISTS (
              SELECT 1 FROM "users" AS direct_user
              WHERE direct_user."id" = subject."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS direct_deletion
                  WHERE direct_deletion."user_id" = direct_user."id"
                )
            )
            OR EXISTS (
              SELECT 1 FROM "users" AS alias_user
              WHERE alias_user."id" = alias."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS alias_deletion
                  WHERE alias_deletion."user_id" = alias_user."id"
                )
            )
          )
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
        SELECT 1
        FROM "revenuecat_event_subjects" AS subject
        LEFT JOIN "revenuecat_customer_aliases" AS alias
          ON alias."alias_hash" = subject."subject_hash"
        WHERE subject."event_id" = event."event_id"
          AND (
            EXISTS (
              SELECT 1 FROM "users" AS direct_user
              WHERE direct_user."id" = subject."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS direct_deletion
                  WHERE direct_deletion."user_id" = direct_user."id"
                )
            )
            OR EXISTS (
              SELECT 1 FROM "users" AS alias_user
              WHERE alias_user."id" = alias."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS alias_deletion
                  WHERE alias_deletion."user_id" = alias_user."id"
                )
            )
          )
      )
  `);
  await db.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "reconcile_reason", "reconcile_after"
    )
    SELECT DISTINCT owner."user_id", 'pending', 'none',
           'webhook_failure', clock_timestamp()
    FROM (
      SELECT subject."local_user_id" AS "user_id"
      FROM "revenuecat_event_subjects" AS subject
      JOIN "revenuecat_webhook_events" AS event
        ON event."event_id" = subject."event_id"
      WHERE event."disposition" = 'pending'
        AND event."retention_until" <= clock_timestamp()
      UNION
      SELECT alias."local_user_id" AS "user_id"
      FROM "revenuecat_event_subjects" AS subject
      JOIN "revenuecat_webhook_events" AS event
        ON event."event_id" = subject."event_id"
      JOIN "revenuecat_customer_aliases" AS alias
        ON alias."alias_hash" = subject."subject_hash"
      WHERE event."disposition" = 'pending'
        AND event."retention_until" <= clock_timestamp()
    ) AS owner
    JOIN "users" AS live_user ON live_user."id" = owner."user_id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "account_deletions" AS deletion
      WHERE deletion."user_id" = owner."user_id"
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "reconcile_reason" = 'webhook_failure',
      "reconcile_after" = LEAST(
        "revenuecat_customer_state"."reconcile_after", clock_timestamp()
      ),
      "updated_at" = clock_timestamp()
  `);
  const alerts = await db.execute<{ type: string; count: number }>(sql`
    SELECT "type", count(*)::integer AS "count"
    FROM "revenuecat_webhook_events"
    WHERE "disposition" = 'pending'
      AND "received_at" <= clock_timestamp() - interval '24 hours'
      AND EXISTS (
        SELECT 1
        FROM "revenuecat_event_subjects" AS subject
        LEFT JOIN "revenuecat_customer_aliases" AS alias
          ON alias."alias_hash" = subject."subject_hash"
        WHERE subject."event_id" = "revenuecat_webhook_events"."event_id"
          AND (
            EXISTS (
              SELECT 1 FROM "users" AS direct_user
              WHERE direct_user."id" = subject."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS direct_deletion
                  WHERE direct_deletion."user_id" = direct_user."id"
                )
            )
            OR EXISTS (
              SELECT 1 FROM "users" AS alias_user
              WHERE alias_user."id" = alias."local_user_id"
                AND NOT EXISTS (
                  SELECT 1 FROM "account_deletions" AS alias_deletion
                  WHERE alias_deletion."user_id" = alias_user."id"
                )
            )
          )
      )
    GROUP BY "type"
  `);
  const safeAlerts = new Map<string, number>();
  for (const alert of alerts.rows) {
    const type = RECONCILING_REVENUECAT_EVENTS.has(alert.type)
      ? alert.type
      : "UNKNOWN_RECONCILING_EVENT";
    safeAlerts.set(type, (safeAlerts.get(type) ?? 0) + alert.count);
  }
  for (const [type, count] of safeAlerts) {
    const alert = { type, count };
    if (options?.alert) options.alert(alert);
    else {
      logger.error(
        { type: alert.type, count: alert.count },
        "RevenueCat identity reconciliation requires attention",
      );
    }
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
    metric?: RevenueCatWorkerMetricSink;
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
        const reconciled = await reconcileTrustedUser({
          userId: row.user_id,
          reason: "legacy_bootstrap",
          operationId: `bootstrap:${input.runId}`,
          allowCreatedEmpty: true,
          config: input.config,
          client: input.client,
        });
        emitMetric(input.metric, {
          type: "customer_reconcile_success",
          errorCode:
            reconciled.outcome === "deleted"
              ? "deleted"
              : reconciled.outcome === "stale"
                ? "stale"
                : "applied",
          count: 1,
        });
      } catch (error) {
        const errorCode = sanitizeRevenueCatErrorCode(
          error,
        ) as RevenueCatWorkerMetric["errorCode"];
        await db.execute(sql`
          UPDATE "revenuecat_customer_state"
          SET "reconcile_after" = clock_timestamp() + interval '1 minute',
              "reconcile_last_error_code" = ${errorCode},
              "updated_at" = clock_timestamp()
          WHERE "user_id" = ${row.user_id}
        `);
        emitMetric(input.metric, {
          type: "customer_reconcile_failure",
          errorCode,
          count: 1,
        });
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
    runtime?: Readonly<{
      config: RevenueCatConfig;
      client: RevenueCatClient;
    }>;
    metric?: RevenueCatWorkerMetricSink;
    onCycle?: () => void;
  }>,
): () => void {
  const runtime = options?.runtime ?? revenueCatRuntimeFromEnvironment();
  const intervalMs = options?.intervalMs ?? WORKER_INTERVAL_MS;
  const metric =
    options?.metric ??
    ((value: RevenueCatWorkerMetric) => {
      logger.info(value, "RevenueCat reconciliation metric");
    });
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
      await runTrustedUserBatch({ ...runtime, metric });
      await runPendingEventBatch({ ...runtime, metric });
      await cleanupRevenueCatEvents();
    } catch (error) {
      logger.error(
        { errorCode: sanitizeRevenueCatErrorCode(error) },
        "RevenueCat reconciliation batch failed",
      );
    } finally {
      running = false;
      options?.onCycle?.();
      schedule();
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
