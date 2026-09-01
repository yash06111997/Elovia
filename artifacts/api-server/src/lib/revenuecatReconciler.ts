import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  withAccountLock,
  type AccountLockTransaction,
} from "./accountDeletion.js";
import {
  RevenueCatClientError,
  type RevenueCatClient,
  type TrustedLocalUid,
} from "./revenuecatClient.js";
import type { RevenueCatConfig } from "./revenuecatConfig.js";
import { canonicalCreatedResponseIsEmpty } from "./revenuecatWorkerCore.js";
import {
  projectRevenueCatSnapshot,
  type CanonicalRevenueCatSnapshot,
  type NormalizedRevenueCatEntitlement,
} from "./revenuecatSnapshot.js";

export type TrustedSnapshotFence = Readonly<{
  eventId?: string;
  leaseId: string;
  customerState?: boolean;
}>;

export type TrustedSnapshotInput = Readonly<{
  userId: string;
  snapshot: CanonicalRevenueCatSnapshot;
  config: RevenueCatConfig;
  operationId: string;
  fence?: TrustedSnapshotFence;
  now?: Date;
}>;

export type TrustedSnapshotResult = Readonly<{
  advanced: boolean;
  deleted: boolean;
  fencedOut: boolean;
}>;

async function liveAndFenced(
  transaction: AccountLockTransaction,
  input: TrustedSnapshotInput,
): Promise<"live" | "deleted" | "fenced_out"> {
  const account = await transaction.execute<{ live: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM "users" AS u
      WHERE u."id" = ${input.userId}
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    ) AS "live"
  `);
  if (account.rows[0]?.live !== true) return "deleted";
  if (!input.fence) return "live";
  if (input.fence.customerState) {
    const fence = await transaction.execute<{ owned: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM "revenuecat_customer_state"
        WHERE "user_id" = ${input.userId}
          AND "reconcile_lease_id" = ${input.fence.leaseId}
          AND "reconcile_lease_until" > clock_timestamp()
        FOR UPDATE
      ) AS "owned"
    `);
    return fence.rows[0]?.owned === true ? "live" : "fenced_out";
  }
  if (!input.fence.eventId) return "fenced_out";
  const fence = await transaction.execute<{ owned: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM "revenuecat_webhook_events"
      WHERE "event_id" = ${input.fence.eventId}
        AND "disposition" = 'pending'
        AND "processing_lease_id" = ${input.fence.leaseId}
        AND "processing_lease_until" > clock_timestamp()
      FOR UPDATE
    ) AS "owned"
  `);
  return fence.rows[0]?.owned === true ? "live" : "fenced_out";
}

async function upsertEntitlement(
  transaction: AccountLockTransaction,
  userId: string,
  entitlement: NormalizedRevenueCatEntitlement,
): Promise<boolean> {
  const result = await transaction.execute<{ advanced: number }>(sql`
    INSERT INTO "subscription_entitlements" (
      "user_id", "entitlement_id", "active", "status", "product_id",
      "store", "period_ends_at", "grace_ends_at", "access_ends_at",
      "will_renew", "source_environment", "source_kind",
      "source_snapshot_at", "source_operation_id", "source_trigger_event_id"
    ) VALUES (
      ${userId}, ${entitlement.entitlementId}, ${entitlement.active},
      ${entitlement.status}, ${entitlement.productId}, ${entitlement.store},
      ${entitlement.periodEndsAt}, ${entitlement.graceEndsAt},
      ${entitlement.accessEndsAt}, ${entitlement.willRenew},
      ${entitlement.sourceEnvironment}, ${entitlement.sourceKind},
      ${entitlement.sourceSnapshotAt}, ${entitlement.sourceOperationId},
      ${entitlement.sourceTriggerEventId}
    )
    ON CONFLICT ("user_id", "entitlement_id") DO UPDATE SET
      "active" = EXCLUDED."active",
      "status" = EXCLUDED."status",
      "product_id" = EXCLUDED."product_id",
      "store" = EXCLUDED."store",
      "period_ends_at" = EXCLUDED."period_ends_at",
      "grace_ends_at" = EXCLUDED."grace_ends_at",
      "access_ends_at" = EXCLUDED."access_ends_at",
      "will_renew" = EXCLUDED."will_renew",
      "source_environment" = EXCLUDED."source_environment",
      "source_kind" = EXCLUDED."source_kind",
      "source_snapshot_at" = EXCLUDED."source_snapshot_at",
      "source_operation_id" = EXCLUDED."source_operation_id",
      "source_trigger_event_id" = EXCLUDED."source_trigger_event_id",
      "updated_at" = now()
    WHERE
      "subscription_entitlements"."source_snapshot_at" < EXCLUDED."source_snapshot_at"
      OR (
        "subscription_entitlements"."source_snapshot_at" = EXCLUDED."source_snapshot_at"
        AND "subscription_entitlements"."source_operation_id" COLLATE "C"
          < EXCLUDED."source_operation_id" COLLATE "C"
      )
    RETURNING 1 AS "advanced"
  `);
  return result.rows.length === 1;
}

function lifetimeProducts(config: RevenueCatConfig): Set<string> {
  return new Set(
    [...config.proProducts, ...config.coachingProducts]
      .filter((product) => product.kind === "lifetime")
      .map((product) => product.id),
  );
}

async function recordCustomerSnapshot(
  transaction: AccountLockTransaction,
  userId: string,
  source: NormalizedRevenueCatEntitlement,
): Promise<void> {
  await transaction.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "source_environment", "last_snapshot_at", "last_operation_id",
      "last_reconciled_at", "reconcile_reason", "reconcile_after"
    ) VALUES (
      ${userId}, 'canonical', ${source.sourceKind},
      ${source.sourceEnvironment}, ${source.sourceSnapshotAt},
      ${source.sourceOperationId}, clock_timestamp(), 'scheduled',
      clock_timestamp() + interval '6 hours'
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "canonicalization_state" = CASE WHEN
        "revenuecat_customer_state"."last_snapshot_at" IS NULL
        OR "revenuecat_customer_state"."last_snapshot_at" < EXCLUDED."last_snapshot_at"
        OR (
          "revenuecat_customer_state"."last_snapshot_at" = EXCLUDED."last_snapshot_at"
          AND COALESCE("revenuecat_customer_state"."last_operation_id", '') COLLATE "C"
            < EXCLUDED."last_operation_id" COLLATE "C"
        ) THEN 'canonical' ELSE "revenuecat_customer_state"."canonicalization_state" END,
      "source_kind" = CASE WHEN
        "revenuecat_customer_state"."last_snapshot_at" IS NULL
        OR "revenuecat_customer_state"."last_snapshot_at" < EXCLUDED."last_snapshot_at"
        OR (
          "revenuecat_customer_state"."last_snapshot_at" = EXCLUDED."last_snapshot_at"
          AND COALESCE("revenuecat_customer_state"."last_operation_id", '') COLLATE "C"
            < EXCLUDED."last_operation_id" COLLATE "C"
        ) THEN EXCLUDED."source_kind" ELSE "revenuecat_customer_state"."source_kind" END,
      "source_environment" = CASE WHEN
        "revenuecat_customer_state"."last_snapshot_at" IS NULL
        OR "revenuecat_customer_state"."last_snapshot_at" < EXCLUDED."last_snapshot_at"
        OR (
          "revenuecat_customer_state"."last_snapshot_at" = EXCLUDED."last_snapshot_at"
          AND COALESCE("revenuecat_customer_state"."last_operation_id", '') COLLATE "C"
            < EXCLUDED."last_operation_id" COLLATE "C"
        ) THEN EXCLUDED."source_environment" ELSE "revenuecat_customer_state"."source_environment" END,
      "last_snapshot_at" = CASE WHEN
        "revenuecat_customer_state"."last_snapshot_at" IS NULL
        OR "revenuecat_customer_state"."last_snapshot_at" < EXCLUDED."last_snapshot_at"
        OR (
          "revenuecat_customer_state"."last_snapshot_at" = EXCLUDED."last_snapshot_at"
          AND COALESCE("revenuecat_customer_state"."last_operation_id", '') COLLATE "C"
            < EXCLUDED."last_operation_id" COLLATE "C"
        ) THEN EXCLUDED."last_snapshot_at" ELSE "revenuecat_customer_state"."last_snapshot_at" END,
      "last_operation_id" = CASE WHEN
        "revenuecat_customer_state"."last_snapshot_at" IS NULL
        OR "revenuecat_customer_state"."last_snapshot_at" < EXCLUDED."last_snapshot_at"
        OR (
          "revenuecat_customer_state"."last_snapshot_at" = EXCLUDED."last_snapshot_at"
          AND COALESCE("revenuecat_customer_state"."last_operation_id", '') COLLATE "C"
            < EXCLUDED."last_operation_id" COLLATE "C"
        ) THEN EXCLUDED."last_operation_id" ELSE "revenuecat_customer_state"."last_operation_id" END,
      "last_reconciled_at" = clock_timestamp(),
      "reconcile_reason" = 'scheduled',
      "reconcile_after" = clock_timestamp() + interval '6 hours',
      "updated_at" = clock_timestamp()
  `);
}

async function removeLegacySentinel(
  transaction: AccountLockTransaction,
  userId: string,
): Promise<void> {
  await transaction.execute(sql`
    DELETE FROM "subscription_entitlements"
    WHERE "user_id" = ${userId}
      AND "entitlement_id" = '__legacy_unverified__'
  `);
}

/**
 * Apply a normalized canonical snapshot inside an already-held account lock.
 * Network I/O belongs outside this primitive. Tuple ordering and the optional
 * event fence make stale/expired workers harmless.
 */
export async function applyTrustedSnapshot(
  transaction: AccountLockTransaction,
  input: TrustedSnapshotInput,
): Promise<TrustedSnapshotResult> {
  const authority = await liveAndFenced(transaction, input);
  if (authority !== "live") {
    return {
      advanced: false,
      deleted: authority === "deleted",
      fencedOut: authority === "fenced_out",
    };
  }

  const entitlements = projectRevenueCatSnapshot({
    snapshot: input.snapshot,
    config: input.config,
    operationId: input.operationId,
  });
  let advanced = false;
  for (const entitlement of entitlements) {
    advanced =
      (await upsertEntitlement(transaction, input.userId, entitlement)) ||
      advanced;
  }
  if (!advanced) {
    await recordCustomerSnapshot(transaction, input.userId, entitlements[0]!);
    await removeLegacySentinel(transaction, input.userId);
    return { advanced: false, deleted: false, fencedOut: false };
  }

  const winner = await transaction.execute<{
    entitlement_id: string;
    status: string;
    product_id: string | null;
    store: string | null;
    access_ends_at: Date | null;
    source_snapshot_at: Date;
  }>(sql`
    SELECT "entitlement_id", "status", "product_id", "store",
           "access_ends_at", "source_snapshot_at"
    FROM "subscription_entitlements"
    WHERE "user_id" = ${input.userId}
      AND "entitlement_id" IN (
        ${input.config.proEntitlementId}, ${input.config.coachingEntitlementId}
      )
      AND "active" = true
      AND ("access_ends_at" IS NULL OR "access_ends_at" > ${input.now ?? new Date()})
    ORDER BY
      CASE WHEN "entitlement_id" = ${input.config.coachingEntitlementId}
        THEN 0 ELSE 1 END,
      "entitlement_id" COLLATE "C"
    LIMIT 1
  `);
  const selected = winner.rows[0] ?? null;
  const tier =
    selected?.product_id &&
    lifetimeProducts(input.config).has(selected.product_id)
      ? "lifetime"
      : null;
  const entitlementActive = selected !== null;
  const trialEndsAt =
    selected?.status === "trial" ? selected.access_ends_at : null;
  const snapshotAt =
    selected?.source_snapshot_at ?? input.snapshot.sourceSnapshotAt;

  await transaction.execute(sql`
    INSERT INTO "subscriptions" (
      "user_id", "revenuecat_user_id", "entitlement_active",
      "entitlement_id", "status", "tier", "product_id", "store",
      "trial_started_at", "trial_ends_at", "current_period_ends_at",
      "last_event", "last_event_at", "updated_at"
    ) VALUES (
      ${input.userId}, ${input.userId}, ${entitlementActive},
      ${selected?.entitlement_id ?? null}, ${selected?.status ?? "expired"},
      ${tier}, ${selected?.product_id ?? null}, ${selected?.store ?? null},
      NULL, ${trialEndsAt}, ${selected?.access_ends_at ?? null},
      NULL, ${snapshotAt}, now()
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "revenuecat_user_id" = EXCLUDED."revenuecat_user_id",
      "entitlement_active" = EXCLUDED."entitlement_active",
      "entitlement_id" = EXCLUDED."entitlement_id",
      "status" = EXCLUDED."status",
      "tier" = EXCLUDED."tier",
      "product_id" = EXCLUDED."product_id",
      "store" = EXCLUDED."store",
      "trial_started_at" = NULL,
      "trial_ends_at" = EXCLUDED."trial_ends_at",
      "current_period_ends_at" = EXCLUDED."current_period_ends_at",
      "last_event" = NULL,
      "last_event_at" = EXCLUDED."last_event_at",
      "updated_at" = now()
  `);

  await recordCustomerSnapshot(transaction, input.userId, entitlements[0]!);
  await removeLegacySentinel(transaction, input.userId);
  return { advanced: true, deleted: false, fencedOut: false };
}

export type TrustedReconcileReason =
  | "legacy_bootstrap"
  | "authenticated"
  | "on_demand"
  | "scheduled"
  | "webhook_failure";

export type ReconcileTrustedUserResult = Readonly<{
  outcome:
    | "applied"
    | "stale"
    | "deleted"
    | "fenced_out"
    | "visibility_lag";
}>;

/** Fetch outside locks, then project only after the trusted UID is rechecked. */
export async function reconcileTrustedUser(input: Readonly<{
  userId: string;
  reason: TrustedReconcileReason;
  operationId: string;
  allowCreatedEmpty?: boolean;
  config: RevenueCatConfig;
  client: RevenueCatClient;
  fence?: TrustedSnapshotFence;
}>): Promise<ReconcileTrustedUserResult> {
  const live = await db.execute<{ live: boolean }>(sql`
    SELECT EXISTS(
      SELECT 1 FROM "users" AS u
      WHERE u."id" = ${input.userId}
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    ) AS "live"
  `);
  if (live.rows[0]?.live !== true) return { outcome: "deleted" };

  const lookup = await input.client.getSubscriber(
    input.userId as TrustedLocalUid,
  );
  if (lookup.lookup === "created") {
    const empty = canonicalCreatedResponseIsEmpty(
      lookup.snapshot,
      input.config,
    );
    if (!empty) {
      throw new RevenueCatClientError("canonical_response_invalid", true);
    }
    if (
      input.reason !== "legacy_bootstrap" ||
      input.allowCreatedEmpty !== true
    ) {
      return { outcome: "visibility_lag" };
    }
  }

  return withAccountLock(input.userId, async (transaction) => {
    const projected = await applyTrustedSnapshot(transaction, {
      userId: input.userId,
      snapshot: lookup.snapshot,
      config: input.config,
      operationId: input.operationId,
      fence: input.fence,
    });
    if (projected.deleted) return { outcome: "deleted" };
    if (projected.fencedOut) return { outcome: "fenced_out" };
    return { outcome: projected.advanced ? "applied" : "stale" };
  });
}
