import { createHmac, randomUUID } from "node:crypto";
import { db, REVENUECAT_SUBJECT_ROLE_MASKS } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  withAccountLocks,
  type AccountLockTransaction,
} from "./accountDeletion.js";
import type { RevenueCatClient, TrustedLocalUid } from "./revenuecatClient.js";
import type {
  PurchaseRedeemedRevenueCatDelivery,
  RevenueCatDelivery,
  RevenueCatParseResult,
  TransferRevenueCatDelivery,
} from "./revenuecatContract.js";
import type { RevenueCatConfig } from "./revenuecatConfig.js";
import { applyTrustedSnapshot } from "./revenuecatReconciler.js";
import {
  projectRevenueCatSnapshot,
  type CanonicalRevenueCatSnapshot,
} from "./revenuecatSnapshot.js";

const EVENT_LEASE_MS = 30_000;
const EVENT_RETENTION_DAYS = 90;
const MAX_POLL_MS = 5_500;
const POLL_INTERVAL_MS = 100;
const MAX_IDENTITY_EXPANSIONS = 3;

class RevenueCatFinalizationFenceLostError extends Error {
  constructor() {
    super("RevenueCat finalization fence was lost.");
    this.name = "RevenueCatFinalizationFenceLostError";
  }
}

type CountMetric = Readonly<{
  type:
    | "identity_set_changed"
    | "identity_conflict"
    | "provider_failure"
    | "event_collision"
    | "ignored_identity_volume"
    | "unsupported_redemption_shape";
  count: number;
}>;

export type RevenueCatProcessorDisposition =
  | "applied"
  | "stale"
  | "ignored_unknown"
  | "ignored_unmapped"
  | "ignored_identity_conflict"
  | "ignored_environment"
  | "ignored_deleted"
  | "event_collision"
  | "processing"
  | "provider_unavailable"
  | "transfer_visibility_lag"
  | "identity_set_changed"
  | "ignored_identity_volume"
  | "unsupported_redemption_shape"
  | "malformed_event";

export type RevenueCatProcessorResult = Readonly<{
  status: 200 | 400 | 503;
  disposition: RevenueCatProcessorDisposition;
  /** Additive transport signal: true only for the delivery that advanced state. */
  applied?: boolean;
  retryAfterSeconds?: number;
}>;

export type RevenueCatProcessorInput = Readonly<{
  delivery: RevenueCatDelivery;
  config: RevenueCatConfig;
  client: RevenueCatClient;
  poll?: (milliseconds: number) => Promise<void>;
  metric?: (metric: CountMetric) => void;
  beforeClaimLocks?: () => Promise<void>;
  afterEventEnvelopeParentRead?: () => Promise<void>;
  leaseDurationMs?: number;
  beforeFinalEventCommit?: () => Promise<void>;
}>;

export type RevenueCatParseProcessorInput = Readonly<{
  parsed: RevenueCatParseResult;
  config?: RevenueCatConfig;
  client?: RevenueCatClient;
  poll?: (milliseconds: number) => Promise<void>;
  metric?: (metric: CountMetric) => void;
}>;

type Subject = {
  raw: string;
  hash: string;
  roleMask: number;
};

type StoredEvent = {
  event_id: string;
  type: string;
  event_at: Date | string;
  environment: string | null;
  disposition: "pending" | "applied" | "stale" | "ignored_unknown";
  metadata: Record<string, unknown>;
  identity_count: number;
  retained_identity_count: number;
  pruned_identity_count: number;
  identity_applied_at: Date | null;
  entitlement_applied_at: Date | null;
  processing_lease_id: string | null;
  processing_lease_until: Date | null;
  lease_current: boolean;
  next_attempt_at: Date;
};

function timestampMilliseconds(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

type StoredSubject = {
  subject_hash: string;
  role_mask: number;
  local_user_id: string | null;
};

type Resolution = {
  owners: Set<string>;
  observedOwners: Set<string>;
  fromOwners: Set<string>;
  toOwners: Set<string>;
  byOwners: Set<string>;
  ownerByHash: Map<string, string>;
  directSelfByHash: Map<string, string>;
};

type Claim = {
  leaseId: string;
  owners: string[];
  lockOwners: string[];
  subjects: Subject[];
  identityAppliedAt: Date | null;
  entitlementAppliedAt: Date | null;
};

type ClaimOutcome =
  | { kind: "claimed"; claim: Claim }
  | { kind: "terminal"; result: RevenueCatProcessorResult }
  | { kind: "collision" }
  | { kind: "processing" }
  | { kind: "expand"; owners: string[] }
  | { kind: "conflict"; owners: string[] }
  | { kind: "deleted" }
  | { kind: "unmapped" };

type FinalizeResult = RevenueCatProcessorResult &
  Readonly<{
    expandedOwners?: readonly string[];
    expandedLockOwners?: readonly string[];
    conflictOwners?: readonly string[];
    survivingSubjects?: readonly Subject[];
  }>;

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byteCompare);
}

function hashSubject(key: string, raw: string): string {
  return createHmac("sha256", key).update(raw, "utf8").digest("hex");
}

function subjectsFor(delivery: RevenueCatDelivery, key: string): Subject[] {
  const subjects = new Map<string, Subject>();
  const add = (raw: string, roleMask: number) => {
    const hash = hashSubject(key, raw);
    const existing = subjects.get(hash);
    if (existing) existing.roleMask |= roleMask;
    else subjects.set(hash, { raw, hash, roleMask });
  };

  if (delivery.kind === "ordinary") {
    add(delivery.userId, REVENUECAT_SUBJECT_ROLE_MASKS.primary);
    if (delivery.originalUserId) {
      add(delivery.originalUserId, REVENUECAT_SUBJECT_ROLE_MASKS.original);
    }
    for (const alias of delivery.aliases) {
      add(alias, REVENUECAT_SUBJECT_ROLE_MASKS.alias);
    }
  } else if (delivery.kind === "transfer") {
    for (const identity of delivery.transferredFrom) {
      add(identity, REVENUECAT_SUBJECT_ROLE_MASKS.transferredFrom);
    }
    for (const identity of delivery.transferredTo) {
      add(identity, REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo);
    }
  } else {
    for (const identity of delivery.redeemedFrom) {
      add(identity, REVENUECAT_SUBJECT_ROLE_MASKS.redeemedFrom);
    }
    for (const identity of delivery.redeemedBy) {
      add(identity, REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy);
    }
  }
  return [...subjects.values()];
}

function normalizedEnvironment(delivery: RevenueCatDelivery): string | null {
  const raw = delivery.metadata.environment;
  if (typeof raw !== "string") return null;
  const normalized = raw.toLowerCase();
  return normalized === "production" || normalized === "sandbox"
    ? normalized
    : null;
}

function persistedMetadata(
  delivery: RevenueCatDelivery,
  identityCount: number,
): Record<string, string | number> {
  return delivery.kind === "purchase_redeemed"
    ? {
        schemaVersion: 1,
        identityCount,
        redemptionOutcome: delivery.redemptionOutcome,
      }
    : { schemaVersion: 1, identityCount };
}

function metadataEqual(
  left: Record<string, unknown>,
  right: Record<string, string | number>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

function result(
  status: 200 | 400 | 503,
  disposition: RevenueCatProcessorDisposition,
  retryAfterSeconds?: number,
  applied?: boolean,
): RevenueCatProcessorResult {
  return {
    status,
    disposition,
    ...(applied === undefined ? {} : { applied }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

async function loadEvent(
  executor: Pick<AccountLockTransaction, "execute"> | typeof db,
  eventId: string,
): Promise<{ event: StoredEvent; subjects: StoredSubject[] } | null> {
  const envelopes = await executor.execute<
    StoredEvent & { subjects: StoredSubject[] }
  >(sql`
    SELECT e."event_id", e."type", e."event_at", e."environment",
           e."disposition", e."metadata", e."identity_count",
           e."retained_identity_count", e."pruned_identity_count",
           e."identity_applied_at", e."entitlement_applied_at",
           e."processing_lease_id", e."processing_lease_until",
           e."next_attempt_at",
           (
             e."processing_lease_id" IS NOT NULL
             AND e."processing_lease_until" > clock_timestamp()
           ) AS lease_current,
           COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'subject_hash', s."subject_hash",
                 'role_mask', s."role_mask",
                 'local_user_id', s."local_user_id"
               ) ORDER BY s."subject_hash" COLLATE "C"
             )
             FROM "revenuecat_event_subjects" s
             WHERE s."event_id" = e."event_id"
           ), '[]'::jsonb) AS subjects
    FROM "revenuecat_webhook_events" e
    WHERE e."event_id" = ${eventId}
  `);
  const envelope = envelopes.rows[0];
  if (!envelope) return null;
  const { subjects, ...event } = envelope;
  return { event, subjects };
}

function terminalResult(event: StoredEvent): RevenueCatProcessorResult {
  if (event.disposition === "pending") return result(503, "processing", 1);
  return result(200, event.disposition, undefined, false);
}

function envelopeMatches(
  stored: { event: StoredEvent; subjects: StoredSubject[] },
  delivery: RevenueCatDelivery,
  environment: string,
  incomingSubjects: readonly Subject[],
): boolean {
  const metadata = persistedMetadata(delivery, incomingSubjects.length);
  if (
    stored.event.type !== delivery.type ||
    timestampMilliseconds(stored.event.event_at) !==
      delivery.eventAt.getTime() ||
    stored.event.environment !== environment ||
    stored.event.identity_count !== incomingSubjects.length ||
    !metadataEqual(stored.event.metadata, metadata) ||
    stored.subjects.length !== stored.event.retained_identity_count ||
    stored.subjects.length + stored.event.pruned_identity_count !==
      stored.event.identity_count
  ) {
    return false;
  }
  const incoming = new Map(
    incomingSubjects.map((subject) => [subject.hash, subject.roleMask]),
  );
  if (stored.event.pruned_identity_count === 0) {
    return (
      incoming.size === stored.subjects.length &&
      stored.subjects.every(
        (subject) => incoming.get(subject.subject_hash) === subject.role_mask,
      )
    );
  }
  return stored.subjects.every(
    (subject) => incoming.get(subject.subject_hash) === subject.role_mask,
  );
}

async function persistUnknown(
  delivery: RevenueCatDelivery,
  config: RevenueCatConfig,
): Promise<RevenueCatProcessorResult> {
  const metadata = persistedMetadata(delivery, 0);
  await db.execute(sql`
    INSERT INTO "revenuecat_webhook_events" (
      "event_id", "type", "event_at", "environment", "disposition",
      "metadata", "identity_count", "identity_required",
      "entitlement_required", "processed_at", "retention_until"
    ) VALUES (
      ${delivery.eventId}, ${delivery.type}, ${delivery.eventAt},
      ${config.environment}, 'ignored_unknown',
      ${JSON.stringify(metadata)}::jsonb, 0, false, false, now(),
      now() + (${EVENT_RETENTION_DAYS} * interval '1 day')
    )
    ON CONFLICT ("event_id") DO NOTHING
  `);
  const stored = await loadEvent(db, delivery.eventId);
  if (
    !stored ||
    !envelopeMatches(stored, delivery, config.environment, []) ||
    stored.event.disposition !== "ignored_unknown"
  ) {
    return result(400, "event_collision");
  }
  return result(200, "ignored_unknown");
}

async function resolveSubjects(
  transaction: AccountLockTransaction,
  subjects: readonly Subject[],
  fallbackOwnerByHash: ReadonlyMap<string, string> = new Map(),
): Promise<Resolution> {
  const rawValues = sorted(subjects.map((subject) => subject.raw));
  const hashes = sorted(subjects.map((subject) => subject.hash));
  const direct = new Set<string>();
  if (rawValues.length > 0) {
    const directRows = await transaction.execute<{ id: string }>(sql`
      SELECT u."id"
      FROM "users" AS u
      WHERE u."id" IN (${sql.join(
        rawValues.map((value) => sql`${value}`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    `);
    for (const row of directRows.rows) direct.add(row.id);
  }
  const aliasOwner = new Map<string, string>();
  if (hashes.length > 0) {
    const aliasRows = await transaction.execute<{
      alias_hash: string;
      local_user_id: string;
    }>(sql`
      SELECT a."alias_hash", a."local_user_id"
      FROM "revenuecat_customer_aliases" AS a
      JOIN "users" AS u ON u."id" = a."local_user_id"
      WHERE a."alias_hash" IN (${sql.join(
        hashes.map((value) => sql`${value}`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = a."local_user_id"
        )
    `);
    for (const row of aliasRows.rows) {
      aliasOwner.set(row.alias_hash, row.local_user_id);
    }
  }

  const fallbackIds = sorted(fallbackOwnerByHash.values());
  const liveFallbacks = new Set<string>();
  if (fallbackIds.length > 0) {
    const fallbackRows = await transaction.execute<{ id: string }>(sql`
      SELECT u."id"
      FROM "users" AS u
      WHERE u."id" IN (${sql.join(
        fallbackIds.map((value) => sql`${value}`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    `);
    for (const row of fallbackRows.rows) liveFallbacks.add(row.id);
  }

  const ownerByHash = new Map<string, string>();
  const directSelfByHash = new Map<string, string>();
  for (const subject of subjects) {
    const directOwner = direct.has(subject.raw) ? subject.raw : undefined;
    if (directOwner) directSelfByHash.set(subject.hash, directOwner);
    const owner =
      directOwner ??
      aliasOwner.get(subject.hash) ??
      (liveFallbacks.has(fallbackOwnerByHash.get(subject.hash) ?? "")
        ? fallbackOwnerByHash.get(subject.hash)
        : undefined);
    if (owner) ownerByHash.set(subject.hash, owner);
  }
  const ownersForMask = (mask: number) =>
    new Set(
      subjects
        .filter((subject) => (subject.roleMask & mask) !== 0)
        .map((subject) => ownerByHash.get(subject.hash))
        .filter((owner): owner is string => owner !== undefined),
    );
  return {
    owners: new Set(ownerByHash.values()),
    observedOwners: new Set([
      ...direct,
      ...aliasOwner.values(),
      ...liveFallbacks,
    ]),
    fromOwners: ownersForMask(REVENUECAT_SUBJECT_ROLE_MASKS.transferredFrom),
    toOwners: ownersForMask(REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo),
    byOwners: ownersForMask(REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy),
    ownerByHash,
    directSelfByHash,
  };
}

async function tombstonedHashes(
  transaction: AccountLockTransaction,
  subjects: readonly Subject[],
): Promise<Set<string>> {
  const rawValues = sorted(subjects.map((subject) => subject.raw));
  if (rawValues.length === 0) return new Set();
  const rows = await transaction.execute<{ user_id: string }>(sql`
    SELECT "user_id" FROM "account_deletions"
    WHERE "user_id" IN (${sql.join(
      rawValues.map((value) => sql`${value}`),
      sql`, `,
    )})
  `);
  const deleted = new Set(rows.rows.map((row) => row.user_id));
  return new Set(
    subjects
      .filter((subject) => deleted.has(subject.raw))
      .map((subject) => subject.hash),
  );
}

function accountLockIds(
  subjects: readonly Subject[],
  owners: Iterable<string>,
): string[] {
  return sorted([...subjects.map((subject) => subject.raw), ...owners]);
}

async function pruneStoredSubjects(
  transaction: AccountLockTransaction,
  eventId: string,
  hashes: ReadonlySet<string>,
): Promise<void> {
  const orderedHashes = sorted(hashes);
  if (orderedHashes.length === 0) return;
  await transaction.execute(sql`
    DELETE FROM "revenuecat_event_subjects"
    WHERE "event_id" = ${eventId}
      AND "subject_hash" IN (${sql.join(
        orderedHashes.map((hash) => sql`${hash}`),
        sql`, `,
      )})
  `);
}

function resolutionConflict(
  delivery: RevenueCatDelivery,
  resolution: Resolution,
): boolean {
  if (delivery.kind === "ordinary") return resolution.owners.size > 1;
  if (delivery.kind === "transfer") {
    return resolution.fromOwners.size > 1 || resolution.toOwners.size > 1;
  }
  return resolution.byOwners.size > 1;
}

function effectiveOwners(
  delivery: RevenueCatDelivery,
  resolution: Resolution,
): Set<string> {
  if (delivery.kind === "ordinary") return resolution.owners;
  if (delivery.kind === "transfer") {
    return new Set([...resolution.fromOwners, ...resolution.toOwners]);
  }
  return resolution.byOwners;
}

async function enqueueTrustedUid(
  transaction: AccountLockTransaction,
  userId: string,
): Promise<void> {
  await transaction.execute(sql`
    INSERT INTO "revenuecat_customer_state" (
      "user_id", "canonicalization_state", "source_kind",
      "reconcile_reason", "reconcile_after"
    )
    SELECT ${userId}, 'pending', 'none', 'webhook_failure', now()
    WHERE EXISTS (
      SELECT 1 FROM "users" AS u
      WHERE u."id" = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "reconcile_reason" = 'webhook_failure',
      "reconcile_after" = LEAST("revenuecat_customer_state"."reconcile_after", now()),
      "updated_at" = now()
  `);
}

function localUserForSubject(
  delivery: RevenueCatDelivery,
  subject: Subject,
  resolution: Resolution,
): string | null {
  const directSelf = resolution.directSelfByHash.get(subject.hash);
  if (directSelf) return directSelf;
  const resolved = resolution.ownerByHash.get(subject.hash) ?? null;
  if (delivery.kind !== "transfer") return resolved;
  const from =
    (subject.roleMask & REVENUECAT_SUBJECT_ROLE_MASKS.transferredFrom) !== 0;
  const to =
    (subject.roleMask & REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo) !== 0;
  const sourceOwner = sorted(resolution.fromOwners)[0] ?? null;
  const destinationOwner = sorted(resolution.toOwners)[0] ?? null;
  if (to) return destinationOwner;
  if (from) return sourceOwner;
  return resolved;
}

async function insertClaimedEvent(
  transaction: AccountLockTransaction,
  delivery: RevenueCatDelivery,
  config: RevenueCatConfig,
  subjects: readonly Subject[],
  identityCount: number,
  resolution: Resolution,
  leaseId: string,
  leaseDurationMs: number,
): Promise<boolean> {
  const metadata = persistedMetadata(delivery, identityCount);
  const prunedIdentityCount = identityCount - subjects.length;
  const inserted = await transaction.execute<{ event_id: string }>(sql`
    INSERT INTO "revenuecat_webhook_events" (
      "event_id", "type", "event_at", "environment", "disposition",
      "metadata", "identity_count", "pruned_identity_count", "identity_required",
      "entitlement_required", "attempt_count", "processing_lease_id",
      "processing_lease_until", "next_attempt_at", "retention_until"
    ) VALUES (
      ${delivery.eventId}, ${delivery.type}, ${delivery.eventAt},
      ${config.environment}, 'pending', ${JSON.stringify(metadata)}::jsonb,
      ${identityCount}, ${prunedIdentityCount}, true, true, 1, ${leaseId},
      clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond'),
      clock_timestamp(),
      clock_timestamp() + (${EVENT_RETENTION_DAYS} * interval '1 day')
    )
    ON CONFLICT ("event_id") DO NOTHING
    RETURNING "event_id"
  `);
  if (inserted.rows.length === 0) return false;
  for (const subject of subjects) {
    await transaction.execute(sql`
      INSERT INTO "revenuecat_event_subjects" (
        "event_id", "subject_hash", "role_mask", "local_user_id"
      ) VALUES (
        ${delivery.eventId}, ${subject.hash}, ${subject.roleMask},
        ${localUserForSubject(delivery, subject, resolution)}
      )
    `);
  }
  return true;
}

async function claimExistingEvent(
  transaction: AccountLockTransaction,
  eventId: string,
  leaseId: string,
  leaseDurationMs: number,
): Promise<boolean> {
  const claimed = await transaction.execute<{ event_id: string }>(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = ${leaseId},
        "processing_lease_until" = clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond'),
        "attempt_count" = "attempt_count" + 1
    WHERE "event_id" = ${eventId}
      AND "disposition" = 'pending'
      AND "next_attempt_at" <= clock_timestamp()
      AND (
        "processing_lease_id" IS NULL
        OR "processing_lease_until" <= clock_timestamp()
      )
    RETURNING "event_id"
  `);
  return claimed.rows.length === 1;
}

async function stableClaim(
  input: RevenueCatProcessorInput,
  allSubjects: readonly Subject[],
  existing: { event: StoredEvent; subjects: StoredSubject[] } | null,
): Promise<ClaimOutcome> {
  const retainedHashes = existing
    ? new Set(existing.subjects.map((subject) => subject.subject_hash))
    : null;
  const candidateSubjects = retainedHashes
    ? allSubjects.filter((subject) => retainedHashes.has(subject.hash))
    : [...allSubjects];
  const fallbackOwnerByHash = new Map(
    (existing?.subjects ?? [])
      .filter((subject) => subject.local_user_id !== null)
      .map((subject) => [
        subject.subject_hash,
        subject.local_user_id as string,
      ]),
  );
  const leaseDurationMs = input.leaseDurationMs ?? EVENT_LEASE_MS;
  const initial = await db.transaction((transaction) =>
    resolveSubjects(transaction, candidateSubjects, fallbackOwnerByHash),
  );
  if (resolutionConflict(input.delivery, initial)) {
    return { kind: "conflict", owners: sorted(initial.owners) };
  }
  let owners = effectiveOwners(input.delivery, initial);
  let lockSet = accountLockIds(candidateSubjects, initial.observedOwners);
  await input.beforeClaimLocks?.();

  for (let attempt = 0; attempt < MAX_IDENTITY_EXPANSIONS; attempt += 1) {
    const outcome = await withAccountLocks(lockSet, async (transaction) => {
      const deletedHashes = await tombstonedHashes(
        transaction,
        candidateSubjects,
      );
      await pruneStoredSubjects(
        transaction,
        input.delivery.eventId,
        deletedHashes,
      );
      const subjects = candidateSubjects.filter(
        (subject) => !deletedHashes.has(subject.hash),
      );
      if (subjects.length === 0) {
        if (existing) {
          await transaction.execute(sql`
            DELETE FROM "revenuecat_webhook_events"
            WHERE "event_id" = ${input.delivery.eventId}
              AND "disposition" = 'pending'
          `);
        }
        return { kind: "deleted" } as ClaimOutcome;
      }
      const resolved = await resolveSubjects(
        transaction,
        subjects,
        fallbackOwnerByHash,
      );
      if (resolutionConflict(input.delivery, resolved)) {
        return {
          kind: "conflict",
          owners: sorted(resolved.owners),
        } as ClaimOutcome;
      }
      owners = effectiveOwners(input.delivery, resolved);
      if (owners.size === 0) return { kind: "unmapped" } as ClaimOutcome;
      const outside = sorted(
        [...resolved.observedOwners].filter(
          (owner) => !lockSet.includes(owner),
        ),
      );
      if (outside.length > 0) {
        return { kind: "expand", owners: outside } as ClaimOutcome;
      }

      const leaseId = randomUUID();
      const inserted = existing
        ? false
        : await insertClaimedEvent(
            transaction,
            input.delivery,
            input.config,
            subjects,
            allSubjects.length,
            resolved,
            leaseId,
            leaseDurationMs,
          );
      const stored = inserted
        ? await loadEvent(transaction, input.delivery.eventId)
        : await loadEvent(transaction, input.delivery.eventId);
      if (
        !stored ||
        !envelopeMatches(
          stored,
          input.delivery,
          input.config.environment,
          allSubjects,
        )
      ) {
        return { kind: "collision" } as ClaimOutcome;
      }
      if (stored.event.disposition !== "pending") {
        return {
          kind: "terminal",
          result: terminalResult(stored.event),
        } as ClaimOutcome;
      }
      const ownsLease =
        inserted ||
        (await claimExistingEvent(
          transaction,
          input.delivery.eventId,
          leaseId,
          leaseDurationMs,
        ));
      if (!ownsLease) return { kind: "processing" } as ClaimOutcome;
      for (const owner of owners) await enqueueTrustedUid(transaction, owner);
      return {
        kind: "claimed",
        claim: {
          leaseId,
          owners: sorted(owners),
          lockOwners: sorted(resolved.observedOwners),
          subjects,
          identityAppliedAt: stored.event.identity_applied_at,
          entitlementAppliedAt: stored.event.entitlement_applied_at,
        },
      } as ClaimOutcome;
    });
    if (outcome.kind !== "expand") return outcome;
    lockSet = sorted([...lockSet, ...outcome.owners]);
  }
  input.metric?.({ type: "identity_set_changed", count: 1 });
  return { kind: "expand", owners: sorted(owners) };
}

async function waitForOwner(
  input: RevenueCatProcessorInput,
): Promise<RevenueCatProcessorResult> {
  const poll =
    input.poll ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + MAX_POLL_MS;
  do {
    const stored = await loadEvent(db, input.delivery.eventId);
    if (stored && stored.event.disposition !== "pending") {
      return terminalResult(stored.event);
    }
    await poll(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return result(503, "processing", 1);
}

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(3_600, 5 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 9));
}

async function releaseClaim(
  eventId: string,
  leaseId: string,
  disposition:
    | "provider_unavailable"
    | "transfer_visibility_lag"
    | "identity_set_changed",
): Promise<RevenueCatProcessorResult> {
  const released = await db.execute<{ attempt_count: number }>(sql`
    UPDATE "revenuecat_webhook_events"
    SET "processing_lease_id" = NULL,
        "processing_lease_until" = NULL,
        "next_attempt_at" = clock_timestamp() + (
          LEAST(
            3600::numeric,
            5 * power(
              2::numeric,
              LEAST(GREATEST("attempt_count" - 1, 0), 9)
            )
          ) * interval '1 second'
        )
    WHERE "event_id" = ${eventId}
      AND "disposition" = 'pending'
      AND "processing_lease_id" = ${leaseId}
      AND "processing_lease_until" > clock_timestamp()
    RETURNING "attempt_count"
  `);
  return released.rows.length === 1
    ? result(
        503,
        disposition,
        retryDelaySeconds(released.rows[0]?.attempt_count ?? 1),
      )
    : result(503, "processing", 1);
}

async function enqueueExpandedOwners(
  eventId: string,
  leaseId: string,
  owners: readonly string[],
  lockOwners: readonly string[],
  subjects: readonly Subject[],
): Promise<{ owners: string[]; subjects: Subject[] } | null> {
  return withAccountLocks(
    accountLockIds(subjects, lockOwners),
    async (transaction) => {
      const fenced = await loadEvent(transaction, eventId);
      if (
        !fenced ||
        fenced.event.disposition !== "pending" ||
        fenced.event.processing_lease_id !== leaseId ||
        !fenced.event.lease_current
      ) {
        return null;
      }
      const deletedHashes = await tombstonedHashes(transaction, subjects);
      await pruneStoredSubjects(transaction, eventId, deletedHashes);
      const refreshed = await loadEvent(transaction, eventId);
      if (!refreshed) return null;
      const retainedHashes = new Set(
        refreshed.subjects.map((subject) => subject.subject_hash),
      );
      const survivingSubjects = subjects.filter(
        (subject) =>
          !deletedHashes.has(subject.hash) && retainedHashes.has(subject.hash),
      );
      const live = await transaction.execute<{ id: string }>(sql`
      SELECT u."id" FROM "users" AS u
      WHERE u."id" IN (${sql.join(
        sorted(owners).map((owner) => sql`${owner}`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM "account_deletions" AS d
          WHERE d."user_id" = u."id"
        )
    `);
      const liveOwners = sorted(live.rows.map((row) => row.id));
      for (const owner of liveOwners) {
        await enqueueTrustedUid(transaction, owner);
      }
      return { owners: liveOwners, subjects: survivingSubjects };
    },
  );
}

function aliasesForOrdinary(
  subjects: readonly Subject[],
  owner: string,
): Subject[] {
  return subjects.filter((subject) => subject.raw !== owner);
}

function aliasKind(subject: Subject, transfer: boolean): string {
  if (transfer) return "transferred";
  if (subject.raw.startsWith("$RCAnonymousID:")) return "anonymous";
  if ((subject.roleMask & REVENUECAT_SUBJECT_ROLE_MASKS.original) !== 0) {
    return "original";
  }
  return "ordinary";
}

async function bindExistingAliasToDirectSelf(
  transaction: AccountLockTransaction,
  subject: Subject,
  directUserId: string,
): Promise<boolean> {
  const rebound = await transaction.execute<{ alias_hash: string }>(sql`
    UPDATE "revenuecat_customer_aliases"
    SET "local_user_id" = ${directUserId},
        "alias_kind" = 'authenticated',
        "ownership_source" = 'authenticated',
        "source_event_at" = NULL,
        "source_event_id" = NULL,
        "authenticated_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE "alias_hash" = ${subject.hash}
      AND (
        "local_user_id" IS DISTINCT FROM ${directUserId}
        OR "alias_kind" <> 'authenticated'
        OR "ownership_source" <> 'authenticated'
        OR "source_event_at" IS NOT NULL
        OR "source_event_id" IS NOT NULL
        OR "authenticated_at" IS NULL
      )
    RETURNING "alias_hash"
  `);
  const relinked = await transaction.execute<{ event_id: string }>(sql`
    UPDATE "revenuecat_event_subjects" AS s
    SET "local_user_id" = ${directUserId}
    WHERE s."subject_hash" = ${subject.hash}
      AND s."local_user_id" IS DISTINCT FROM ${directUserId}
      AND EXISTS (
        SELECT 1 FROM "revenuecat_customer_aliases" AS a
        WHERE a."alias_hash" = s."subject_hash"
          AND a."local_user_id" = ${directUserId}
          AND a."ownership_source" = 'authenticated'
      )
    RETURNING s."event_id"
  `);
  return rebound.rows.length === 1 || relinked.rows.length > 0;
}

async function assignAlias(
  transaction: AccountLockTransaction,
  delivery: RevenueCatDelivery,
  subject: Subject,
  owner: string,
  transfer: boolean,
): Promise<{ owner: string; advanced: boolean }> {
  const upserted = await transaction.execute<{
    local_user_id: string;
  }>(sql`
    INSERT INTO "revenuecat_customer_aliases" (
      "alias_hash", "local_user_id", "alias_kind", "ownership_source",
      "source_event_at", "source_event_id", "updated_at"
    ) VALUES (
      ${subject.hash}, ${owner}, ${aliasKind(subject, transfer)}, 'webhook',
      ${delivery.eventAt}, ${delivery.eventId}, now()
    )
    ON CONFLICT ("alias_hash") DO UPDATE SET
      "local_user_id" = EXCLUDED."local_user_id",
      "alias_kind" = EXCLUDED."alias_kind",
      "source_event_at" = EXCLUDED."source_event_at",
      "source_event_id" = EXCLUDED."source_event_id",
      "updated_at" = now()
    WHERE
      "revenuecat_customer_aliases"."ownership_source" = 'webhook'
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
  if (upserted.rows[0]) {
    return { owner: upserted.rows[0].local_user_id, advanced: true };
  }
  const established = await transaction.execute<{ local_user_id: string }>(sql`
    SELECT "local_user_id" FROM "revenuecat_customer_aliases"
    WHERE "alias_hash" = ${subject.hash}
  `);
  return {
    owner: established.rows[0]?.local_user_id ?? owner,
    advanced: false,
  };
}

function transferSnapshotsAuthoritative(
  delivery: TransferRevenueCatDelivery,
  resolution: Resolution,
  snapshots: ReadonlyMap<string, CanonicalRevenueCatSnapshot>,
  config: RevenueCatConfig,
): boolean {
  const sources = sorted(resolution.fromOwners);
  const destinations = new Set(resolution.toOwners);
  for (const source of sources) {
    if (destinations.has(source)) continue;
    const snapshot = snapshots.get(source);
    if (!snapshot) return false;
    const projected = projectRevenueCatSnapshot({
      snapshot,
      config,
      operationId: `webhook:${delivery.eventId}`,
    });
    if (projected.some((entitlement) => entitlement.active)) return false;
  }
  return true;
}

async function finalizeClaimTransaction(
  input: RevenueCatProcessorInput,
  claim: Claim,
  lookups: ReadonlyMap<
    string,
    { lookup: "existing" | "created"; snapshot: CanonicalRevenueCatSnapshot }
  >,
): Promise<FinalizeResult> {
  return withAccountLocks(
    accountLockIds(claim.subjects, claim.lockOwners),
    async (transaction) => {
      let stored = await loadEvent(transaction, input.delivery.eventId);
      if (
        !stored ||
        stored.event.disposition !== "pending" ||
        stored.event.processing_lease_id !== claim.leaseId ||
        !stored.event.lease_current
      ) {
        return result(503, "processing", 1);
      }
      const deletedHashes = await tombstonedHashes(transaction, claim.subjects);
      await pruneStoredSubjects(
        transaction,
        input.delivery.eventId,
        deletedHashes,
      );
      if (deletedHashes.size > 0) {
        stored = await loadEvent(transaction, input.delivery.eventId);
        if (
          !stored ||
          stored.event.disposition !== "pending" ||
          stored.event.processing_lease_id !== claim.leaseId ||
          !stored.event.lease_current
        ) {
          throw new RevenueCatFinalizationFenceLostError();
        }
      }
      const surviving = new Set(
        stored.subjects.map((subject) => subject.subject_hash),
      );
      const subjects = claim.subjects.filter((subject) =>
        surviving.has(subject.hash),
      );
      const fallbackOwnerByHash = new Map(
        stored.subjects
          .filter((subject) => subject.local_user_id !== null)
          .map((subject) => [
            subject.subject_hash,
            subject.local_user_id as string,
          ]),
      );
      const resolution = await resolveSubjects(
        transaction,
        subjects,
        fallbackOwnerByHash,
      );
      const finalOwners = effectiveOwners(input.delivery, resolution);
      const outsideLocks = sorted(
        [...resolution.observedOwners].filter(
          (owner) => !claim.lockOwners.includes(owner),
        ),
      );
      if (outsideLocks.length > 0) {
        return {
          ...result(503, "identity_set_changed", 1),
          expandedOwners: sorted(
            [...finalOwners].filter((owner) => !claim.owners.includes(owner)),
          ),
          expandedLockOwners: outsideLocks,
          survivingSubjects: subjects,
        };
      }
      if (resolutionConflict(input.delivery, resolution)) {
        if (
          stored.event.identity_applied_at === null &&
          stored.event.entitlement_applied_at === null
        ) {
          const deleted = await transaction.execute<{ event_id: string }>(sql`
          DELETE FROM "revenuecat_webhook_events"
          WHERE "event_id" = ${input.delivery.eventId}
            AND "processing_lease_id" = ${claim.leaseId}
            AND "processing_lease_until" > clock_timestamp()
          RETURNING "event_id"
        `);
          if (deleted.rows.length !== 1) {
            throw new RevenueCatFinalizationFenceLostError();
          }
          input.metric?.({ type: "identity_conflict", count: 1 });
          return result(200, "ignored_identity_conflict");
        }
        return {
          ...result(503, "identity_set_changed", 1),
          conflictOwners: sorted(resolution.owners),
        };
      }
      if (finalOwners.size === 0) {
        const deleted = await transaction.execute<{ event_id: string }>(sql`
        DELETE FROM "revenuecat_webhook_events"
        WHERE "event_id" = ${input.delivery.eventId}
          AND "processing_lease_id" = ${claim.leaseId}
          AND "processing_lease_until" > clock_timestamp()
        RETURNING "event_id"
      `);
        if (deleted.rows.length !== 1) {
          throw new RevenueCatFinalizationFenceLostError();
        }
        return result(200, "ignored_deleted");
      }
      const outside = [...finalOwners].filter(
        (owner) => !claim.owners.includes(owner),
      );
      if (outside.length > 0) {
        return {
          ...result(503, "identity_set_changed", 1),
          expandedOwners: sorted(outside),
          survivingSubjects: subjects,
        };
      }

      const identityNeeded = stored.event.identity_applied_at === null;
      const entitlementNeeded = stored.event.entitlement_applied_at === null;
      const snapshots = new Map<string, CanonicalRevenueCatSnapshot>();
      if (entitlementNeeded) {
        for (const owner of finalOwners) {
          const lookup = lookups.get(owner);
          if (!lookup || lookup.lookup !== "existing") {
            return result(503, "transfer_visibility_lag", 1);
          }
          snapshots.set(owner, lookup.snapshot);
        }
      }
      if (
        entitlementNeeded &&
        input.delivery.kind === "transfer" &&
        !transferSnapshotsAuthoritative(
          input.delivery,
          resolution,
          snapshots,
          input.config,
        )
      ) {
        return result(503, "transfer_visibility_lag", 1);
      }

      let advanced = false;
      if (entitlementNeeded) {
        for (const owner of sorted(finalOwners)) {
          const ownerSnapshot = snapshots.get(owner);
          if (!ownerSnapshot) {
            return result(503, "transfer_visibility_lag", 1);
          }
          const projected = await applyTrustedSnapshot(transaction, {
            userId: owner,
            snapshot: ownerSnapshot,
            config: input.config,
            operationId: `webhook:${input.delivery.eventId}`,
            fence: {
              eventId: input.delivery.eventId,
              leaseId: claim.leaseId,
            },
          });
          if (projected.deleted) {
            throw new RevenueCatFinalizationFenceLostError();
          }
          if (projected.fencedOut) {
            throw new RevenueCatFinalizationFenceLostError();
          }
          advanced = projected.advanced || advanced;
        }
      }

      const relink = new Map<string, string | null>();
      if (identityNeeded) {
        for (const subject of subjects) {
          const directSelf = resolution.directSelfByHash.get(subject.hash);
          if (!directSelf) continue;
          advanced =
            (await bindExistingAliasToDirectSelf(
              transaction,
              subject,
              directSelf,
            )) || advanced;
          relink.set(subject.hash, directSelf);
        }
      }
      if (identityNeeded && input.delivery.kind === "ordinary") {
        const owner = sorted(finalOwners)[0];
        if (!owner) return result(200, "ignored_deleted");
        for (const subject of aliasesForOrdinary(subjects, owner)) {
          if (relink.has(subject.hash)) continue;
          const directSelf = resolution.directSelfByHash.get(subject.hash);
          if (directSelf) {
            relink.set(subject.hash, directSelf);
            continue;
          }
          const assigned = await assignAlias(
            transaction,
            input.delivery,
            subject,
            owner,
            false,
          );
          advanced = assigned.advanced || advanced;
          relink.set(subject.hash, assigned.owner);
        }
        for (const subject of subjects) {
          if (!relink.has(subject.hash)) {
            relink.set(
              subject.hash,
              resolution.directSelfByHash.get(subject.hash) ?? owner,
            );
          }
        }
      } else if (identityNeeded && input.delivery.kind === "transfer") {
        const destination = sorted(resolution.toOwners)[0] ?? null;
        const source = sorted(resolution.fromOwners)[0] ?? null;
        for (const subject of subjects) {
          if (relink.has(subject.hash)) continue;
          const directSelf = resolution.directSelfByHash.get(subject.hash);
          if (directSelf) {
            relink.set(subject.hash, directSelf);
            continue;
          }
          const from =
            (subject.roleMask &
              REVENUECAT_SUBJECT_ROLE_MASKS.transferredFrom) !==
            0;
          const to =
            (subject.roleMask & REVENUECAT_SUBJECT_ROLE_MASKS.transferredTo) !==
            0;
          if (to) {
            if (!destination) {
              relink.set(subject.hash, null);
              continue;
            }
            const assigned = await assignAlias(
              transaction,
              input.delivery,
              subject,
              destination,
              true,
            );
            advanced = assigned.advanced || advanced;
            relink.set(subject.hash, assigned.owner);
            continue;
          }
          if (from && destination) {
            const assigned = await assignAlias(
              transaction,
              input.delivery,
              subject,
              destination,
              true,
            );
            advanced = assigned.advanced || advanced;
            relink.set(subject.hash, assigned.owner);
          } else {
            relink.set(
              subject.hash,
              resolution.ownerByHash.get(subject.hash) ?? source,
            );
          }
        }
      } else if (
        identityNeeded &&
        input.delivery.kind === "purchase_redeemed"
      ) {
        const owner = sorted(resolution.byOwners)[0] ?? null;
        const mayAlias =
          input.delivery.redemptionOutcome === "alias" ||
          input.delivery.redemptionOutcome === "redeemer_owns";
        for (const subject of subjects) {
          if (relink.has(subject.hash)) continue;
          const isRedeemer =
            (subject.roleMask & REVENUECAT_SUBJECT_ROLE_MASKS.redeemedBy) !== 0;
          const directSelf = resolution.directSelfByHash.get(subject.hash);
          if (directSelf) {
            relink.set(subject.hash, directSelf);
          } else if (owner && mayAlias && isRedeemer) {
            const assigned = await assignAlias(
              transaction,
              input.delivery,
              subject,
              owner,
              false,
            );
            advanced = assigned.advanced || advanced;
            relink.set(subject.hash, assigned.owner);
          } else {
            relink.set(subject.hash, isRedeemer ? owner : null);
          }
        }
      }
      for (const [hash, owner] of relink) {
        await transaction.execute(sql`
        UPDATE "revenuecat_event_subjects"
        SET "local_user_id" = ${owner}
        WHERE "event_id" = ${input.delivery.eventId}
          AND "subject_hash" = ${hash}
      `);
      }

      await input.beforeFinalEventCommit?.();

      const disposition = advanced ? "applied" : "stale";
      const completed = await transaction.execute<{ event_id: string }>(sql`
      UPDATE "revenuecat_webhook_events"
      SET "identity_applied_at" = CASE
            WHEN ${identityNeeded} THEN COALESCE("identity_applied_at", now())
            ELSE "identity_applied_at"
          END,
          "entitlement_applied_at" = CASE
            WHEN ${entitlementNeeded} THEN COALESCE("entitlement_applied_at", now())
            ELSE "entitlement_applied_at"
          END,
          "processed_at" = now(),
          "disposition" = ${disposition},
          "processing_lease_id" = NULL,
          "processing_lease_until" = NULL
      WHERE "event_id" = ${input.delivery.eventId}
        AND "disposition" = 'pending'
        AND "processing_lease_id" = ${claim.leaseId}
        AND "processing_lease_until" > clock_timestamp()
      RETURNING "event_id"
    `);
      if (completed.rows.length !== 1) {
        throw new RevenueCatFinalizationFenceLostError();
      }
      return result(
        200,
        disposition,
        undefined,
        disposition === "applied" ? true : undefined,
      );
    },
  );
}

async function finalizeClaim(
  input: RevenueCatProcessorInput,
  claim: Claim,
  lookups: ReadonlyMap<
    string,
    { lookup: "existing" | "created"; snapshot: CanonicalRevenueCatSnapshot }
  >,
): Promise<FinalizeResult> {
  try {
    return await finalizeClaimTransaction(input, claim, lookups);
  } catch (error) {
    if (error instanceof RevenueCatFinalizationFenceLostError) {
      return result(503, "processing", 1);
    }
    throw error;
  }
}

async function processOwnedClaim(
  input: RevenueCatProcessorInput,
  claim: Claim,
): Promise<RevenueCatProcessorResult> {
  let activeClaim = claim;
  const lookups = new Map<
    string,
    { lookup: "existing" | "created"; snapshot: CanonicalRevenueCatSnapshot }
  >();
  for (let attempt = 0; attempt < MAX_IDENTITY_EXPANSIONS; attempt += 1) {
    if (activeClaim.entitlementAppliedAt === null) {
      try {
        for (const owner of activeClaim.owners) {
          if (!lookups.has(owner)) {
            lookups.set(
              owner,
              await input.client.getSubscriber(owner as TrustedLocalUid),
            );
          }
        }
      } catch {
        input.metric?.({ type: "provider_failure", count: 1 });
        return releaseClaim(
          input.delivery.eventId,
          claim.leaseId,
          "provider_unavailable",
        );
      }
    }
    try {
      const finalized = await finalizeClaim(input, activeClaim, lookups);
      if (
        (finalized.expandedOwners && finalized.expandedOwners.length > 0) ||
        (finalized.expandedLockOwners &&
          finalized.expandedLockOwners.length > 0)
      ) {
        activeClaim = {
          ...activeClaim,
          owners: sorted([
            ...activeClaim.owners,
            ...(finalized.expandedOwners ?? []),
          ]),
          lockOwners: sorted([
            ...activeClaim.lockOwners,
            ...(finalized.expandedLockOwners ?? []),
            ...(finalized.expandedOwners ?? []),
          ]),
          subjects: finalized.survivingSubjects
            ? [...finalized.survivingSubjects]
            : activeClaim.subjects,
        };
        const refreshed = await enqueueExpandedOwners(
          input.delivery.eventId,
          claim.leaseId,
          activeClaim.owners,
          activeClaim.lockOwners,
          activeClaim.subjects,
        );
        if (!refreshed) {
          return result(503, "processing", 1);
        }
        activeClaim = {
          ...activeClaim,
          owners: refreshed.owners,
          subjects: refreshed.subjects,
        };
        continue;
      }
      if (
        finalized.status === 503 &&
        finalized.disposition === "transfer_visibility_lag"
      ) {
        return releaseClaim(
          input.delivery.eventId,
          claim.leaseId,
          "transfer_visibility_lag",
        );
      }
      if (
        finalized.status === 503 &&
        finalized.disposition === "identity_set_changed"
      ) {
        input.metric?.({ type: "identity_set_changed", count: 1 });
        if (finalized.conflictOwners?.length) {
          const conflictOwners = sorted([
            ...activeClaim.owners,
            ...finalized.conflictOwners,
          ]);
          const enqueued = await enqueueExpandedOwners(
            input.delivery.eventId,
            claim.leaseId,
            conflictOwners,
            sorted([...activeClaim.lockOwners, ...finalized.conflictOwners]),
            activeClaim.subjects,
          );
          if (!enqueued) return result(503, "processing", 1);
        }
        return releaseClaim(
          input.delivery.eventId,
          claim.leaseId,
          "identity_set_changed",
        );
      }
      return finalized;
    } catch {
      input.metric?.({ type: "provider_failure", count: 1 });
      return releaseClaim(
        input.delivery.eventId,
        claim.leaseId,
        "provider_unavailable",
      );
    }
  }
  input.metric?.({ type: "identity_set_changed", count: 1 });
  return releaseClaim(
    input.delivery.eventId,
    claim.leaseId,
    "identity_set_changed",
  );
}

/** Process one already-authenticated, bounded RevenueCat delivery. */
export async function processRevenueCatDelivery(
  input: RevenueCatProcessorInput,
): Promise<RevenueCatProcessorResult> {
  if (!input.delivery.requiresReconciliation) {
    return persistUnknown(input.delivery, input.config);
  }
  const environment = normalizedEnvironment(input.delivery);
  if (environment !== input.config.environment) {
    return result(200, "ignored_environment");
  }
  const allSubjects = subjectsFor(input.delivery, input.config.subjectHashKey);
  const existing = await loadEvent(db, input.delivery.eventId);
  await input.afterEventEnvelopeParentRead?.();
  if (
    existing &&
    !envelopeMatches(
      existing,
      input.delivery,
      input.config.environment,
      allSubjects,
    )
  ) {
    input.metric?.({ type: "event_collision", count: 1 });
    return result(400, "event_collision");
  }
  if (
    existing?.event.disposition !== undefined &&
    existing.event.disposition !== "pending"
  ) {
    return terminalResult(existing.event);
  }

  const outcome = await stableClaim(input, allSubjects, existing);
  if (outcome.kind === "terminal") return outcome.result;
  if (outcome.kind === "collision") {
    input.metric?.({ type: "event_collision", count: 1 });
    return result(400, "event_collision");
  }
  if (outcome.kind === "deleted") {
    return result(200, "ignored_deleted");
  }
  if (outcome.kind === "conflict") {
    if (
      existing &&
      (existing.event.identity_applied_at !== null ||
        existing.event.entitlement_applied_at !== null)
    ) {
      input.metric?.({ type: "identity_set_changed", count: 1 });
      await withAccountLocks(outcome.owners, async (transaction) => {
        for (const owner of outcome.owners) {
          await enqueueTrustedUid(transaction, owner);
        }
      });
      await db.execute(sql`
        UPDATE "revenuecat_webhook_events"
        SET "next_attempt_at" = clock_timestamp() + interval '5 seconds'
        WHERE "event_id" = ${input.delivery.eventId}
          AND "disposition" = 'pending'
          AND (
            "processing_lease_id" IS NULL
            OR "processing_lease_until" <= clock_timestamp()
          )
      `);
      return result(503, "identity_set_changed", 1);
    }
    input.metric?.({ type: "identity_conflict", count: 1 });
    if (existing) {
      await db.execute(sql`
        DELETE FROM "revenuecat_webhook_events"
        WHERE "event_id" = ${input.delivery.eventId}
          AND "disposition" = 'pending'
          AND "identity_applied_at" IS NULL
          AND "entitlement_applied_at" IS NULL
      `);
    }
    return result(200, "ignored_identity_conflict");
  }
  if (outcome.kind === "unmapped") {
    if (existing) {
      await db.execute(sql`
        DELETE FROM "revenuecat_webhook_events"
        WHERE "event_id" = ${input.delivery.eventId}
          AND "disposition" = 'pending'
          AND "retained_identity_count" = 0
      `);
      return result(200, "ignored_deleted");
    }
    return result(200, "ignored_unmapped");
  }
  if (outcome.kind === "expand") {
    return result(503, "identity_set_changed", 1);
  }
  if (outcome.kind === "processing") return waitForOwner(input);
  return processOwnedClaim(input, outcome.claim);
}

/**
 * Classify the bounded parser result before any database, HMAC, or provider
 * work. Task 6 supplies configuration/client dependencies only for `ok`.
 */
export async function processRevenueCatParseResult(
  input: RevenueCatParseProcessorInput,
): Promise<RevenueCatProcessorResult> {
  if (!input.parsed.ok) {
    if (
      input.parsed.code === "ignored_identity_volume" ||
      input.parsed.code === "unsupported_redemption_shape"
    ) {
      input.metric?.({ type: input.parsed.code, count: 1 });
      return result(200, input.parsed.code);
    }
    return result(400, "malformed_event");
  }
  if (!input.config || !input.client) {
    throw new Error("RevenueCat processor dependencies are required.");
  }
  return processRevenueCatDelivery({
    delivery: input.parsed.value,
    config: input.config,
    client: input.client,
    poll: input.poll,
    metric: input.metric,
  });
}
