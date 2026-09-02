import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error(
    "CI must provide TEST_DATABASE_URL for RevenueCat integration tests",
  );
}

const migrationNames = [
  "0000_baseline.sql",
  "0001_user_data_sync_integrity.sql",
  "0002_account_deletion_tombstones.sql",
  "0003_account_deletion_identity_outbox.sql",
  "0004_revenuecat_entitlement_integrity.sql",
  "0005_revenuecat_worker_authority.sql",
];
const revenuecatTableNames = [
  "revenuecat_customer_aliases",
  "revenuecat_customer_state",
  "revenuecat_event_subjects",
  "revenuecat_webhook_events",
  "subscription_entitlements",
];
const expectedCheckNames = [
  "revenuecat_alias_hash_valid",
  "revenuecat_alias_kind_valid",
  "revenuecat_alias_ownership_source_valid",
  "revenuecat_alias_provenance_valid",
  "revenuecat_customer_attempt_valid",
  "revenuecat_customer_canonical_consistent",
  "revenuecat_customer_environment_valid",
  "revenuecat_customer_error_code_valid",
  "revenuecat_customer_lease_consistent",
  "revenuecat_customer_operation_source_consistent",
  "revenuecat_customer_operation_valid",
  "revenuecat_customer_reason_valid",
  "revenuecat_customer_schedule_valid",
  "revenuecat_customer_source_kind_valid",
  "revenuecat_customer_state_valid",
  "revenuecat_event_attempt_valid",
  "revenuecat_event_disposition_valid",
  "revenuecat_event_environment_valid",
  "revenuecat_event_identity_count_valid",
  "revenuecat_event_identity_valid",
  "revenuecat_event_lease_consistent",
  "revenuecat_event_metadata_object",
  "revenuecat_event_phase_fields_valid",
  "revenuecat_event_retention_valid",
  "revenuecat_event_schedule_valid",
  "revenuecat_event_state_consistent",
  "revenuecat_subject_hash_valid",
  "revenuecat_subject_role_mask_valid",
  "subscription_entitlement_access_window_valid",
  "subscription_entitlement_active_status_valid",
  "subscription_entitlement_environment_valid",
  "subscription_entitlement_id_valid",
  "subscription_entitlement_operation_source_consistent",
  "subscription_entitlement_operation_valid",
  "subscription_entitlement_renewal_valid",
  "subscription_entitlement_source_consistent",
  "subscription_entitlement_source_kind_valid",
  "subscription_entitlement_status_valid",
  "subscription_entitlement_store_valid",
];
const expectedIndexColumns = {
  IDX_revenuecat_aliases_local: ["local_user_id"],
  IDX_revenuecat_aliases_source: [
    "ownership_source",
    "source_event_at",
    "source_event_id",
  ],
  IDX_revenuecat_customer_reconcile_due: [
    "reconcile_after",
    "reconcile_lease_until",
    "user_id",
  ],
  IDX_revenuecat_event_subjects_local: ["local_user_id", "event_id"],
  IDX_revenuecat_event_subjects_hash: ["subject_hash", "event_id"],
  IDX_revenuecat_events_pending_due: [
    "disposition",
    "next_attempt_at",
    "processing_lease_until",
    "identity_applied_at",
    "entitlement_applied_at",
  ],
  IDX_revenuecat_events_retention: ["retention_until", "disposition"],
  IDX_revenuecat_events_type_time: ["type", "event_at"],
  IDX_subscription_entitlements_active: ["user_id", "active", "access_ends_at"],
  IDX_subscription_entitlements_source: [
    "user_id",
    "source_snapshot_at",
    "source_operation_id",
  ],
};
const expectedColumns = {
  revenuecat_webhook_events: [
    "event_id",
    "type",
    "event_at",
    "received_at",
    "environment",
    "disposition",
    "metadata",
    "identity_count",
    "retained_identity_count",
    "pruned_identity_count",
    "identity_required",
    "identity_applied_at",
    "entitlement_required",
    "entitlement_applied_at",
    "attempt_count",
    "processing_lease_id",
    "processing_lease_until",
    "next_attempt_at",
    "processed_at",
    "retention_until",
  ],
  revenuecat_event_subjects: [
    "event_id",
    "subject_hash",
    "role_mask",
    "local_user_id",
  ],
  revenuecat_customer_aliases: [
    "alias_hash",
    "local_user_id",
    "alias_kind",
    "ownership_source",
    "source_event_at",
    "source_event_id",
    "authenticated_at",
    "created_at",
    "updated_at",
  ],
  revenuecat_customer_state: [
    "user_id",
    "canonicalization_state",
    "source_kind",
    "source_environment",
    "last_snapshot_at",
    "last_operation_id",
    "last_reconciled_at",
    "reconcile_reason",
    "reconcile_after",
    "reconcile_attempt_count",
    "reconcile_lease_id",
    "reconcile_lease_until",
    "reconcile_last_error_code",
    "created_at",
    "updated_at",
  ],
  subscription_entitlements: [
    "user_id",
    "entitlement_id",
    "active",
    "status",
    "product_id",
    "store",
    "period_ends_at",
    "grace_ends_at",
    "access_ends_at",
    "will_renew",
    "source_environment",
    "source_kind",
    "source_snapshot_at",
    "source_operation_id",
    "source_trigger_event_id",
    "updated_at",
  ],
};

const integrationTest = testDatabaseUrl ? test : test.skip;
const suiteDatabaseName = `elovia_revenuecat_suite_${process.pid}_${Date.now()}`;
const baselineMigrationUrl = new URL(
  "../../lib/db/migrations/0000_baseline.sql",
  import.meta.url,
);
const revenuecatMigrationUrl = new URL(
  "../../lib/db/migrations/0004_revenuecat_entitlement_integrity.sql",
  import.meta.url,
);
const revenuecatWorkerAuthorityMigrationUrl = new URL(
  "../../lib/db/migrations/0005_revenuecat_worker_authority.sql",
  import.meta.url,
);
const processorUrl = new URL(
  "../../artifacts/api-server/src/lib/revenuecatProcessor.ts",
  import.meta.url,
);
const reconcilerUrl = new URL(
  "../../artifacts/api-server/src/lib/revenuecatReconciler.ts",
  import.meta.url,
);
const accountDeletionUrl = new URL(
  "../../artifacts/api-server/src/lib/accountDeletion.ts",
  import.meta.url,
);
const requireFromDatabasePackage = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);
const requireFromApiPackage = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);

let Pool;
let adminPool;
let scopedPool;
let workspacePool;
let db;
let eq;
let usersTable;
let revenuecatSchema;
let processRevenueCatDelivery;
let applyTrustedSnapshot;
let reconcileTrustedUser;
let tombstoneAndDeleteAccountData;
let provisionAuthenticatedUserIfActive;
let createRevenueCatAuthProvisioningCallback;
let claimDueTrustedUsers;
let runTrustedUserBatch;
let runPendingEventBatch;
let claimPendingRevenueCatEvents;
let recoverClaimedRevenueCatEvent;
let reconcileTrustedUserOnDemand;
let bootstrapRevenueCatCustomers;
let cleanupRevenueCatEvents;
let startRevenueCatWorkers;
let resolveEntitlement;
let apiApp;
let applyVerifiedFirebaseAuth;
let runMigrations;
let unregisterTsx;
let temporaryDatabaseCounter = 0;

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlFor(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete("options");
  return url.toString();
}

async function withTemporaryDatabase(callback) {
  temporaryDatabaseCounter += 1;
  const databaseName = `elovia_revenuecat_test_${process.pid}_${temporaryDatabaseCounter}`;
  assert.match(databaseName, /^elovia_revenuecat_test_[0-9_]+$/);
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  try {
    return await callback(databaseUrlFor(testDatabaseUrl, databaseName));
  } finally {
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
  }
}

async function insertEvent(pool, overrides = {}) {
  const values = {
    eventId: "event_12345678",
    type: "INITIAL_PURCHASE",
    eventAt: "2026-09-01T10:00:00Z",
    receivedAt: "2026-09-01T10:00:01Z",
    environment: "sandbox",
    disposition: "pending",
    metadata: {},
    identityCount: 0,
    identityRequired: false,
    entitlementRequired: false,
    nextAttemptAt: "2026-09-01T10:00:01Z",
    retentionUntil: "2026-10-01T10:00:01Z",
    ...overrides,
  };
  await pool.query(
    `INSERT INTO revenuecat_webhook_events (
      event_id, type, event_at, received_at, environment, disposition,
      metadata, identity_count, identity_required, entitlement_required,
      next_attempt_at, retention_until
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
    [
      values.eventId,
      values.type,
      values.eventAt,
      values.receivedAt,
      values.environment,
      values.disposition,
      JSON.stringify(values.metadata),
      values.identityCount,
      values.identityRequired,
      values.entitlementRequired,
      values.nextAttemptAt,
      values.retentionUntil,
    ],
  );
}

const processorConfig = Object.freeze({
  webhookSecret: "webhook-secret",
  apiKey: "api-key",
  subjectHashKey: "s".repeat(32),
  proEntitlementId: "elovia_pro",
  coachingEntitlementId: "elovia_coaching",
  proProducts: Object.freeze([
    Object.freeze({ id: "pro_monthly", kind: "auto_renewing" }),
  ]),
  coachingProducts: Object.freeze([
    Object.freeze({ id: "coaching_monthly", kind: "auto_renewing" }),
  ]),
  environment: "sandbox",
  normalizedReads: "strict",
});

function delivery(overrides = {}) {
  return {
    eventId: `processor_${String(Math.random()).slice(2, 14)}`,
    type: "INITIAL_PURCHASE",
    eventAt: new Date("2026-09-01T10:00:00.000Z"),
    disposition: "pending",
    requiresReconciliation: true,
    metadata: { environment: "SANDBOX" },
    kind: "ordinary",
    userId: "processor-user",
    originalUserId: null,
    aliases: [],
    ...overrides,
  };
}

function snapshot(at, options = {}) {
  const expires = options.expires ?? "2026-10-01T10:00:00.000Z";
  const subscriptions = Object.create(null);
  if (options.pro !== false) {
    subscriptions.pro_monthly = {
      productId: "pro_monthly",
      purchaseDate: new Date("2026-08-01T10:00:00.000Z"),
      originalPurchaseDate: new Date("2026-08-01T10:00:00.000Z"),
      expiresDate: new Date(expires),
      gracePeriodExpiresDate: null,
      billingIssuesDetectedAt: null,
      unsubscribeDetectedAt: null,
      refundedAt: null,
      autoResumeDate: null,
      isSandbox: true,
      store: "test_store",
      ownershipType: "purchased",
      periodType: "normal",
    };
  }
  if (options.coaching === true) {
    subscriptions.coaching_monthly = {
      ...subscriptions.pro_monthly,
      productId: "coaching_monthly",
    };
  }
  return Object.freeze({
    sourceSnapshotAt: new Date(at),
    entitlements: Object.freeze(Object.create(null)),
    subscriptions: Object.freeze(subscriptions),
    nonSubscriptions: Object.freeze(Object.create(null)),
  });
}

function fakeClient(lookup, calls) {
  return {
    async getSubscriber(uid) {
      calls.push(uid);
      return typeof lookup === "function" ? lookup(uid) : lookup;
    },
  };
}

function subjectHash(raw) {
  return createHmac("sha256", processorConfig.subjectHashKey)
    .update(raw, "utf8")
    .digest("hex");
}

async function makeOnlyEventDue(eventId) {
  await scopedPool.query(
    `UPDATE revenuecat_webhook_events
     SET next_attempt_at=CASE WHEN event_id=$1
       THEN received_at
       ELSE '2099-01-01T00:00:00Z'::timestamptz END,
         processing_lease_id=NULL,
         processing_lease_until=NULL
     WHERE disposition='pending'`,
    [eventId],
  );
}

async function insertRawlessEvent({
  eventId,
  type = "INITIAL_PURCHASE",
  metadata = {},
  subjects,
  identityApplied = false,
  entitlementApplied = false,
  eventAt = "2026-09-01T10:00:00Z",
  receivedAt = "2026-09-01T10:00:01Z",
  nextAttemptAt = receivedAt,
  retentionUntil = "2099-01-01T00:00:00Z",
}) {
  await insertEvent(scopedPool, {
    eventId,
    type,
    metadata,
    eventAt,
    receivedAt,
    identityCount: subjects.length,
    identityRequired: true,
    entitlementRequired: true,
    nextAttemptAt,
    retentionUntil,
  });
  for (const subject of subjects) {
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES ($1,$2,$3,$4)`,
      [eventId, subject.hash, subject.roleMask, subject.localUserId ?? null],
    );
  }
  if (identityApplied || entitlementApplied) {
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET identity_applied_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END,
           entitlement_applied_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END
       WHERE event_id=$1`,
      [eventId, identityApplied, entitlementApplied],
    );
  }
  await makeOnlyEventDue(eventId);
}

test("processor source contract is fenced, privacy-minimized, and provisioning-neutral", async () => {
  const [processorSource, reconcilerSource, accountDeletionSource] =
    await Promise.all([
      readFile(processorUrl, "utf8"),
      readFile(reconcilerUrl, "utf8"),
      readFile(accountDeletionUrl, "utf8"),
    ]);
  assert.match(
    processorSource,
    /export async function processRevenueCatDelivery/,
  );
  assert.match(processorSource, /createHmac\("sha256"/);
  assert.match(processorSource, /processing_lease_id/);
  assert.match(processorSource, /pruned_identity_count/);
  assert.match(processorSource, /COLLATE "C"/);
  assert.doesNotMatch(processorSource, /insert\s+into\s+["']?users/i);
  assert.doesNotMatch(
    processorSource,
    /console\.|JSON\.stringify\(.*delivery|rawPayload/i,
  );
  assert.doesNotMatch(
    processorSource,
    /Math\.min\(deletedHashes\.size,\s*existing\.event\.pruned_identity_count\)/,
  );
  assert.match(processorSource, /beforeClaimLocks/);
  assert.match(
    processorSource,
    /"metadata", "identity_count", "pruned_identity_count", "identity_required"/,
  );
  assert.doesNotMatch(processorSource, /comparisonIdentityCount/);
  assert.match(processorSource, /afterEventEnvelopeParentRead/);
  assert.match(processorSource, /jsonb_agg\(/);
  assert.match(processorSource, /jsonb_build_object\(/);
  assert.match(processorSource, /leaseDurationMs/);
  assert.match(processorSource, /clock_timestamp\(\)/);
  assert.match(processorSource, /bindExistingAliasToDirectSelf/);
  assert.match(processorSource, /conflictOwners/);
  assert.match(processorSource, /RevenueCatFinalizationFenceLostError/);
  assert.match(processorSource, /beforeFinalEventCommit/);
  assert.doesNotMatch(
    processorSource,
    /"processing_lease_until"\s*(?:>|<=)\s*now\(\)/,
  );
  assert.match(reconcilerSource, /export async function applyTrustedSnapshot/);
  assert.match(reconcilerSource, /"source_operation_id" COLLATE "C"/);
  assert.match(
    reconcilerSource,
    /"processing_lease_until"\s*>\s*clock_timestamp\(\)/,
  );
  assert.match(reconcilerSource, /subscriptions/);
  assert.match(accountDeletionSource, /export async function withAccountLocks/);
  assert.match(accountDeletionSource, /Buffer\.compare/);
  assert.match(accountDeletionSource, /2_026_090_101/);
});

test("unsupported parsed deliveries are acknowledged without PostgreSQL, identities, or provider access", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
  const { register } = requireFromScriptsPackage("tsx/esm/api");
  const unregister = register();
  try {
    const processor = await import(
      `${processorUrl.href}?unsupported=${Date.now()}`
    );
    for (const code of [
      "ignored_identity_volume",
      "unsupported_redemption_shape",
    ]) {
      const metrics = [];
      assert.deepEqual(
        await processor.processRevenueCatParseResult({
          parsed: { ok: false, code, message: "bounded outcome" },
          metric: (metric) => metrics.push(metric),
          client: new Proxy(
            {},
            {
              get() {
                assert.fail(
                  "unsupported parse outcomes must not access a client",
                );
              },
            },
          ),
        }),
        { status: 200, disposition: code },
      );
      assert.deepEqual(metrics, [{ type: code, count: 1 }]);
    }
    const malformedMetrics = [];
    assert.deepEqual(
      await processor.processRevenueCatParseResult({
        parsed: { ok: false, code: "malformed_event", message: "bad" },
        metric: (metric) => malformedMetrics.push(metric),
      }),
      { status: 400, disposition: "malformed_event" },
    );
    assert.deepEqual(malformedMetrics, []);
  } finally {
    await unregister();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("the forward-only RevenueCat migration contract is present", async () => {
  let sql;
  let authoritySql;
  try {
    sql = await readFile(revenuecatMigrationUrl, "utf8");
    authoritySql = await readFile(
      revenuecatWorkerAuthorityMigrationUrl,
      "utf8",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  assert.ok(sql, "expected 0004_revenuecat_entitlement_integrity.sql");
  assert.deepEqual(
    [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]),
    [
      "revenuecat_webhook_events",
      "revenuecat_event_subjects",
      "revenuecat_customer_aliases",
      "revenuecat_customer_state",
      "subscription_entitlements",
    ],
  );
  assert.match(sql, /CREATE TRIGGER "TR_revenuecat_count_pruned_subject"/);
  assert.match(sql, /"retained_identity_count" integer NOT NULL DEFAULT 0/);
  assert.match(
    sql,
    /"retained_identity_count" \+ "pruned_identity_count" <= "identity_count"/,
  );
  assert.match(sql, /CREATE TRIGGER "TR_revenuecat_reserve_subject_capacity"/);
  assert.match(
    sql,
    /CREATE TRIGGER "TR_revenuecat_reserve_subject_capacity"\s+AFTER INSERT ON "revenuecat_event_subjects"/,
  );
  assert.match(
    sql,
    /CREATE TRIGGER "TR_revenuecat_preserve_subject_identity"\s+BEFORE UPDATE OF "event_id", "subject_hash"/,
  );
  assert.match(sql, /CREATE TRIGGER "TR_revenuecat_guard_event_capacity"/);
  assert.doesNotMatch(sql, /INSERT INTO "revenuecat_webhook_events"/);
  assert.ok(authoritySql, "expected immutable 0005 worker-authority migration");
  assert.match(
    authoritySql,
    /CREATE INDEX "IDX_revenuecat_event_subjects_hash"\s+ON "revenuecat_event_subjects" \("subject_hash","event_id"\)/,
  );
});

if (testDatabaseUrl) {
  before(async () => {
    const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
    assert.match(
      databaseName,
      /test/i,
      "TEST_DATABASE_URL must target a database whose name contains 'test'",
    );
    ({ Pool } = requireFromDatabasePackage("pg"));
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(suiteDatabaseName)}`);
    const databaseUrl = databaseUrlFor(testDatabaseUrl, suiteDatabaseName);
    ({ runMigrations } = await import("../../lib/db/scripts/migrate.mjs"));
    await runMigrations(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    Object.assign(process.env, {
      REVENUECAT_WEBHOOK_SECRET: processorConfig.webhookSecret,
      REVENUECAT_SECRET_API_KEY: processorConfig.apiKey,
      REVENUECAT_SUBJECT_HASH_KEY: processorConfig.subjectHashKey,
      REVENUECAT_PRO_ENTITLEMENT_ID: processorConfig.proEntitlementId,
      REVENUECAT_COACHING_ENTITLEMENT_ID: processorConfig.coachingEntitlementId,
      REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify(processorConfig.proProducts),
      REVENUECAT_COACHING_PRODUCTS_JSON: JSON.stringify(
        processorConfig.coachingProducts,
      ),
      REVENUECAT_ENVIRONMENT: processorConfig.environment,
      REVENUECAT_NORMALIZED_READS: "per_user",
    });
    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    db = databaseModule.db;
    workspacePool = databaseModule.pool;
    ({ usersTable } = await import("../../lib/db/src/schema/auth.ts"));
    ({ eq } = requireFromDatabasePackage("drizzle-orm"));
    revenuecatSchema = await import("../../lib/db/src/schema/revenuecat.ts");
    ({ processRevenueCatDelivery } =
      await import("../../artifacts/api-server/src/lib/revenuecatProcessor.ts"));
    ({ tombstoneAndDeleteAccountData, provisionAuthenticatedUserIfActive } =
      await import("../../artifacts/api-server/src/lib/accountDeletion.ts"));
    ({ applyTrustedSnapshot, reconcileTrustedUser } =
      await import("../../artifacts/api-server/src/lib/revenuecatReconciler.ts"));
    ({
      createRevenueCatAuthProvisioningCallback,
      claimDueTrustedUsers,
      claimPendingRevenueCatEvents,
      recoverClaimedRevenueCatEvent,
      reconcileTrustedUserOnDemand,
      runTrustedUserBatch,
      runPendingEventBatch,
      bootstrapRevenueCatCustomers,
      cleanupRevenueCatEvents,
      startRevenueCatWorkers,
    } = await import("../../artifacts/api-server/src/lib/revenuecatWorker.ts"));
    ({ resolveEntitlement } =
      await import("../../artifacts/api-server/src/lib/entitlements.ts"));
    const [
      { default: healthRouter },
      { default: privacyRouter },
      { default: diagnosticsRouter },
    ] = await Promise.all([
      import("../../artifacts/api-server/src/routes/health.ts"),
      import("../../artifacts/api-server/src/routes/privacy.ts"),
      import("../../artifacts/api-server/src/routes/diagnostics.ts"),
    ]);
    const express = requireFromApiPackage("express");
    apiApp = express();
    apiApp.use((request, _response, next) => {
      request.log = { error() {}, warn() {}, info() {} };
      const testUser = request.get("x-elovia-test-user");
      if (testUser) request.user = { id: testUser };
      request.isAuthenticated = () => Boolean(testUser && request.user?.id);
      next();
    });
    apiApp.use(express.json({ limit: "20mb" }));
    apiApp.use("/api", healthRouter);
    apiApp.use("/api", privacyRouter);
    apiApp.use("/api", diagnosticsRouter);
    ({ applyVerifiedFirebaseAuth } =
      await import("../../artifacts/api-server/src/middlewares/authMiddleware.ts"));
    scopedPool = new Pool({ connectionString: databaseUrl });
  });

  after(async () => {
    await workspacePool?.end();
    await unregisterTsx?.();
    await scopedPool?.end();
    await adminPool?.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [suiteDatabaseName],
    );
    await adminPool?.query(`DROP DATABASE ${quotedIdentifier(suiteDatabaseName)}`);
    await adminPool?.end();
  });
}

integrationTest(
  "twenty concurrent duplicate deliveries have one fetch owner and one terminal projection",
  async () => {
    const userId = `duplicate-user-${Date.now()}`;
    const event = delivery({ eventId: `duplicate_${Date.now()}`, userId });
    await scopedPool.query(
      "INSERT INTO users (id, created_at) VALUES ($1, now())",
      [userId],
    );
    const calls = [];
    const client = fakeClient(
      { lookup: "existing", snapshot: snapshot("2026-09-01T10:00:02.000Z") },
      calls,
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client,
          poll: async () => new Promise((resolve) => setTimeout(resolve, 5)),
        }),
      ),
    );
    assert.equal(calls.length, 1);
    assert.equal(
      results.every((result) => result.status === 200),
      true,
    );
    assert.equal(
      results.filter((result) => result.applied === true).length,
      1,
    );
    assert.equal(
      results.filter((result) => result.applied === false).length,
      19,
    );
    const persisted = await scopedPool.query(
      `SELECT disposition,attempt_count,identity_applied_at IS NOT NULL AS identity_done,
              entitlement_applied_at IS NOT NULL AS entitlement_done
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(persisted.rows[0], {
      disposition: "applied",
      attempt_count: 1,
      identity_done: true,
      entitlement_done: true,
    });
  },
);

integrationTest(
  "ordinary resolution fails closed for zero or multiple owners without persistence or GET",
  async () => {
    const calls = [];
    const client = fakeClient(
      { lookup: "existing", snapshot: snapshot("2026-09-01T10:00:03.000Z") },
      calls,
    );
    const unmapped = delivery({
      eventId: `unmapped_${Date.now()}`,
      userId: "not-local",
    });
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: unmapped,
        config: processorConfig,
        client,
      }),
      { status: 200, disposition: "ignored_unmapped" },
    );

    const first = `conflict-a-${Date.now()}`;
    const second = `conflict-b-${Date.now()}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      first,
      second,
    ]);
    const conflict = delivery({
      eventId: `conflict_${Date.now()}`,
      userId: first,
      originalUserId: second,
    });
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: conflict,
        config: processorConfig,
        client,
      }),
      { status: 200, disposition: "ignored_identity_conflict" },
    );
    assert.equal(calls.length, 0);
    const count = await scopedPool.query(
      "SELECT count(*)::integer AS count FROM revenuecat_webhook_events WHERE event_id=ANY($1::text[])",
      [[unmapped.eventId, conflict.eventId]],
    );
    assert.equal(count.rows[0].count, 0);
  },
);

integrationTest(
  "unknown deliveries retain only an identifier-free terminal envelope",
  async () => {
    const event = delivery({
      eventId: `unknown_${Date.now()}`,
      type: "FUTURE_EVENT",
      requiresReconciliation: false,
      disposition: "ignored_unknown",
      userId: "raw-subject-must-not-persist",
      aliases: ["raw-alias-must-not-persist"],
    });
    const calls = [];
    const result = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(null, calls),
    });
    assert.deepEqual(result, { status: 200, disposition: "ignored_unknown" });
    assert.equal(calls.length, 0);
    const row = await scopedPool.query(
      `SELECT disposition,identity_count,metadata,
              (SELECT count(*)::integer FROM revenuecat_event_subjects WHERE event_id=$1) AS subjects
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(row.rows[0], {
      disposition: "ignored_unknown",
      identity_count: 0,
      metadata: { schemaVersion: 1, identityCount: 0 },
      subjects: 0,
    });
  },
);

integrationTest(
  "created customers and provider failures stay pending, durable, and enqueued",
  async () => {
    const userId = `pending-user-${Date.now()}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    for (const [suffix, lookup] of [
      [
        "created",
        { lookup: "created", snapshot: snapshot("2026-09-01T10:00:04.000Z") },
      ],
      ["failure", new Error("provider unavailable")],
    ]) {
      const event = delivery({
        eventId: `pending_${suffix}_${Date.now()}`,
        userId,
      });
      const client = {
        async getSubscriber() {
          if (lookup instanceof Error) throw lookup;
          return lookup;
        },
      };
      const result = await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client,
      });
      assert.equal(result.status, 503);
      const persisted = await scopedPool.query(
        `SELECT disposition,processing_lease_id,next_attempt_at > received_at AS backed_off
         FROM revenuecat_webhook_events WHERE event_id=$1`,
        [event.eventId],
      );
      assert.deepEqual(persisted.rows[0], {
        disposition: "pending",
        processing_lease_id: null,
        backed_off: true,
      });
    }
    const queue = await scopedPool.query(
      "SELECT reconcile_reason FROM revenuecat_customer_state WHERE user_id=$1",
      [userId],
    );
    assert.equal(queue.rows[0].reconcile_reason, "webhook_failure");
  },
);

integrationTest(
  "trusted projection keeps Pro and Coaching independent and ignores stale byte-ordered tuples",
  async () => {
    const userId = `projector-user-${Date.now()}`;
    await scopedPool.query(
      "INSERT INTO users (id, created_at) VALUES ($1,'2026-08-01T00:00:00Z')",
      [userId],
    );
    const advanced = await db.transaction((transaction) =>
      applyTrustedSnapshot(transaction, {
        userId,
        snapshot: snapshot("2026-09-01T10:00:05.000Z", { coaching: true }),
        config: processorConfig,
        operationId: "worker:sort_A000",
      }),
    );
    assert.equal(advanced.advanced, true);
    const stale = await db.transaction((transaction) =>
      applyTrustedSnapshot(transaction, {
        userId,
        snapshot: snapshot("2026-09-01T10:00:05.000Z", {
          pro: false,
          coaching: false,
        }),
        config: processorConfig,
        operationId: "worker:sort-0000",
      }),
    );
    assert.equal(stale.advanced, false);
    const rows = await scopedPool.query(
      "SELECT entitlement_id,active FROM subscription_entitlements WHERE user_id=$1 ORDER BY entitlement_id",
      [userId],
    );
    assert.deepEqual(rows.rows, [
      { entitlement_id: "elovia_coaching", active: true },
      { entitlement_id: "elovia_pro", active: true },
    ]);
    const compatibility = await scopedPool.query(
      `SELECT revenuecat_user_id,entitlement_active,entitlement_id,status,tier,
              trial_started_at,trial_ends_at,last_event
       FROM subscriptions WHERE user_id=$1`,
      [userId],
    );
    assert.deepEqual(compatibility.rows[0], {
      revenuecat_user_id: userId,
      entitlement_active: true,
      entitlement_id: "elovia_coaching",
      status: "active",
      tier: null,
      trial_started_at: null,
      trial_ends_at: null,
      last_event: null,
    });
  },
);

integrationTest(
  "unconfigured products and mismatched environments fail closed without compatibility grants",
  async () => {
    const suffix = Date.now();
    const userId = `product-fail-closed-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    const event = delivery({
      eventId: `product_fail_closed_${suffix}`,
      userId,
    });
    const configWithoutObservedProduct = {
      ...processorConfig,
      proProducts: Object.freeze([
        Object.freeze({ id: "different_pro", kind: "auto_renewing" }),
      ]),
    };
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: configWithoutObservedProduct,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-01T10:00:05.500Z"),
            },
            [],
          ),
        })
      ).status,
      200,
    );
    const entitlements = await scopedPool.query(
      `SELECT entitlement_id,active FROM subscription_entitlements
       WHERE user_id=$1 ORDER BY entitlement_id`,
      [userId],
    );
    assert.deepEqual(entitlements.rows, [
      { entitlement_id: "elovia_coaching", active: false },
      { entitlement_id: "elovia_pro", active: false },
    ]);
    const compatibility = await scopedPool.query(
      `SELECT entitlement_active,entitlement_id,status
       FROM subscriptions WHERE user_id=$1`,
      [userId],
    );
    assert.deepEqual(compatibility.rows[0], {
      entitlement_active: false,
      entitlement_id: null,
      status: "expired",
    });

    const wrongEnvironment = delivery({
      eventId: `product_wrong_environment_${suffix}`,
      userId,
      metadata: { environment: "PRODUCTION" },
    });
    const calls = [];
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: wrongEnvironment,
        config: processorConfig,
        client: fakeClient(null, calls),
      }),
      { status: 200, disposition: "ignored_environment" },
    );
    assert.deepEqual(calls, []);
  },
);

integrationTest(
  "an authoritative transfer reconciles both sides atomically and moves aliases by event order",
  async () => {
    const suffix = Date.now();
    const source = `transfer-source-${suffix}`;
    const destination = `transfer-destination-${suffix}`;
    const sourceAlias = `$RCAnonymousID:transfer-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'anonymous','webhook','2026-08-01T00:00:00Z','old_alias_123')`,
      [subjectHash(sourceAlias), source],
    );
    const event = delivery({
      eventId: `transfer_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source, sourceAlias],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    const calls = [];
    const client = fakeClient(
      (uid) => ({
        lookup: "existing",
        snapshot:
          uid === source
            ? snapshot("2026-09-01T10:00:06.000Z", {
                pro: false,
                coaching: false,
              })
            : snapshot("2026-09-01T10:00:06.000Z"),
      }),
      calls,
    );
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client,
      }),
      { status: 200, disposition: "applied", applied: true },
    );
    assert.deepEqual(new Set(calls), new Set([source, destination]));
    const moved = await scopedPool.query(
      `SELECT local_user_id,source_event_id FROM revenuecat_customer_aliases
       WHERE alias_hash=$1`,
      [subjectHash(sourceAlias)],
    );
    assert.deepEqual(moved.rows[0], {
      local_user_id: destination,
      source_event_id: event.eventId,
    });
    const entitlements = await scopedPool.query(
      `SELECT user_id,active FROM subscription_entitlements
       WHERE entitlement_id=$1 AND user_id=ANY($2::text[]) ORDER BY user_id`,
      [processorConfig.proEntitlementId, [source, destination]],
    );
    assert.deepEqual(
      new Map(entitlements.rows.map((row) => [row.user_id, row.active])),
      new Map([
        [source, false],
        [destination, true],
      ]),
    );
  },
);

integrationTest(
  "purchase redemption outcomes fetch only an existing redeemer and never transfer source ownership",
  async () => {
    const suffix = Date.now();
    const redeemer = `redeemer-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [redeemer]);
    for (const [index, outcome] of [
      "alias",
      "transfer",
      "redeemer_owns",
    ].entries()) {
      const redeemerAlias = `redeemer-alias-${suffix}-${index}`;
      const redeemedFrom = `redeemed-from-${suffix}-${index}`;
      const event = delivery({
        eventId: `redeemed_${index}_${suffix}`,
        type: "PURCHASE_REDEEMED",
        kind: "purchase_redeemed",
        redeemedFrom: [redeemedFrom],
        redeemedBy: [redeemer, redeemerAlias],
        redemptionOutcome: outcome,
      });
      delete event.userId;
      delete event.originalUserId;
      delete event.aliases;
      const calls = [];
      const applied = await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client: fakeClient(
          {
            lookup: "existing",
            snapshot: snapshot(`2026-09-01T10:00:0${7 + index}.000Z`),
          },
          calls,
        ),
      });
      assert.equal(applied.status, 200);
      assert.deepEqual(calls, [redeemer]);
      const aliases = await scopedPool.query(
        `SELECT local_user_id FROM revenuecat_customer_aliases
         WHERE alias_hash=ANY($1::text[]) ORDER BY alias_hash`,
        [[subjectHash(redeemerAlias), subjectHash(redeemedFrom)]],
      );
      assert.equal(
        aliases.rows.some((row) => row.local_user_id !== redeemer),
        false,
      );
      assert.equal(aliases.rowCount, outcome === "transfer" ? 0 : 1);
    }
  },
);

integrationTest(
  "terminal pruned duplicates stay stable while an envelope collision is rejected",
  async () => {
    const suffix = Date.now();
    const userId = `pruned-duplicate-${suffix}`;
    const event = delivery({ eventId: `pruned_${suffix}`, userId });
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    const firstCalls = [];
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-01T10:00:10.000Z"),
            },
            firstCalls,
          ),
        })
      ).status,
      200,
    );
    await scopedPool.query("DELETE FROM users WHERE id=$1", [userId]);
    const duplicateCalls = [];
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client: fakeClient(null, duplicateCalls),
      }),
      { status: 200, disposition: "applied", applied: false },
    );
    assert.equal(duplicateCalls.length, 0);
    const pruned = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(pruned.rows[0], {
      retained_identity_count: 0,
      pruned_identity_count: 1,
    });
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: {
          ...event,
          eventAt: new Date("2026-09-01T10:00:01.000Z"),
        },
        config: processorConfig,
        client: fakeClient(null, duplicateCalls),
      }),
      { status: 400, disposition: "event_collision" },
    );
    const unrelatedDeleted = `pruned-collision-${suffix}`;
    await scopedPool.query(
      "INSERT INTO account_deletions (user_id,request_id) VALUES ($1,$2)",
      [unrelatedDeleted, `delete-pruned-collision-${suffix}`],
    );
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: { ...event, aliases: [unrelatedDeleted] },
        config: processorConfig,
        client: fakeClient(null, duplicateCalls),
      }),
      { status: 400, disposition: "event_collision" },
    );
  },
);

integrationTest(
  "a duplicate event envelope remains atomic when pruning starts after its parent row is read",
  async () => {
    const suffix = Date.now();
    const userId = `atomic-envelope-${suffix}`;
    const event = delivery({ eventId: `atomic_envelope_${suffix}`, userId });
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-01T10:00:10.250Z"),
            },
            [],
          ),
        })
      ).status,
      200,
    );

    let parentReadHooks = 0;
    const duplicateCalls = [];
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client: fakeClient(null, duplicateCalls),
        afterEventEnvelopeParentRead: async () => {
          parentReadHooks += 1;
          await tombstoneAndDeleteAccountData(
            userId,
            `atomic-envelope-delete-${suffix}`,
          );
        },
      }),
      { status: 200, disposition: "applied", applied: false },
    );
    assert.equal(parentReadHooks, 1);
    assert.deepEqual(duplicateCalls, []);
    const stored = await scopedPool.query(
      `SELECT e.identity_count,e.retained_identity_count,e.pruned_identity_count,
              count(s.subject_hash)::int AS stored_hashes
       FROM revenuecat_webhook_events e
       LEFT JOIN revenuecat_event_subjects s ON s.event_id=e.event_id
       WHERE e.event_id=$1
       GROUP BY e.event_id`,
      [event.eventId],
    );
    assert.deepEqual(stored.rows[0], {
      identity_count: 1,
      retained_identity_count: 0,
      pruned_identity_count: 1,
      stored_hashes: 0,
    });
  },
);

integrationTest(
  "a terminal shared transfer accepts its complete-set duplicate after deletion but rejects a surviving role-mask collision",
  async () => {
    const suffix = Date.now();
    const source = `terminal-shared-source-${suffix}`;
    const destination = `terminal-shared-destination-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    const event = delivery({
      eventId: `terminal_shared_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(
            (uid) => ({
              lookup: "existing",
              snapshot:
                uid === source
                  ? snapshot("2026-09-01T10:00:10.500Z", {
                      pro: false,
                      coaching: false,
                    })
                  : snapshot("2026-09-01T10:00:10.500Z"),
            }),
            [],
          ),
        })
      ).status,
      200,
    );
    await tombstoneAndDeleteAccountData(
      source,
      `terminal-shared-delete-${suffix}`,
    );
    const duplicateCalls = [];
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(null, duplicateCalls),
        })
      ).status,
      200,
    );
    assert.deepEqual(duplicateCalls, []);
    const retained = await scopedPool.query(
      `SELECT e.identity_count,e.retained_identity_count,e.pruned_identity_count,
              s.subject_hash,s.role_mask,s.local_user_id
       FROM revenuecat_webhook_events e
       JOIN revenuecat_event_subjects s ON s.event_id=e.event_id
       WHERE e.event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(retained.rows[0], {
      identity_count: 2,
      retained_identity_count: 1,
      pruned_identity_count: 1,
      subject_hash: subjectHash(destination),
      role_mask: 16,
      local_user_id: destination,
    });
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: {
          ...event,
          transferredFrom: [source, destination],
        },
        config: processorConfig,
        client: fakeClient(null, duplicateCalls),
      }),
      { status: 400, disposition: "event_collision" },
    );
  },
);

integrationTest(
  "a pending pruned transfer validates the complete role-mask set and resumes from only its shared survivor",
  async () => {
    const suffix = Date.now();
    const source = `pending-role-source-${suffix}`;
    const destination = `pending-role-destination-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    const event = delivery({
      eventId: `pending_role_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("leave pending");
        },
      },
    });
    await tombstoneAndDeleteAccountData(
      source,
      `pending-role-delete-${suffix}`,
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=now(),processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: { ...event, transferredFrom: [source, destination] },
        config: processorConfig,
        client: fakeClient(null, []),
      }),
      { status: 400, disposition: "event_collision" },
    );
    const calls = [];
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-01T10:00:10.750Z"),
            },
            calls,
          ),
        })
      ).status,
      200,
    );
    assert.deepEqual(calls, [destination]);
    const retained = await scopedPool.query(
      `SELECT identity_count,retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(retained.rows[0], {
      identity_count: 2,
      retained_identity_count: 1,
      pruned_identity_count: 1,
    });
  },
);

integrationTest(
  "tombstoned transfer identities are excluded before claim, hashing persistence, and GET",
  async () => {
    const suffix = Date.now();
    const tombstonedSource = `tomb-source-${suffix}`;
    const tombstonedDestination = `tomb-destination-${suffix}`;
    const liveSource = `live-source-${suffix}`;
    const liveDestination = `live-destination-${suffix}`;
    await scopedPool.query(
      "INSERT INTO users (id) VALUES ($1),($2),($3),($4)",
      [tombstonedSource, tombstonedDestination, liveSource, liveDestination],
    );
    await scopedPool.query(
      `INSERT INTO account_deletions (user_id,request_id)
       VALUES ($1,$2),($3,$4)`,
      [
        tombstonedSource,
        `delete-source-${suffix}`,
        tombstonedDestination,
        `delete-destination-${suffix}`,
      ],
    );
    await scopedPool.query("DELETE FROM users WHERE id=ANY($1::text[])", [
      [tombstonedSource, tombstonedDestination],
    ]);

    const cases = [
      {
        name: "deleted source",
        from: [tombstonedSource],
        to: [liveDestination],
        calls: [liveDestination],
        retained: [liveDestination],
      },
      {
        name: "deleted destination",
        from: [liveSource],
        to: [tombstonedDestination],
        calls: [liveSource],
        retained: [liveSource],
      },
      {
        name: "both deleted",
        from: [tombstonedSource],
        to: [tombstonedDestination],
        calls: [],
        retained: [],
      },
    ];
    for (const [index, scenario] of cases.entries()) {
      const event = delivery({
        eventId: `tomb_transfer_${index}_${suffix}`,
        type: "TRANSFER",
        kind: "transfer",
        transferredFrom: scenario.from,
        transferredTo: scenario.to,
      });
      delete event.userId;
      delete event.originalUserId;
      delete event.aliases;
      const calls = [];
      const outcome = await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client: fakeClient(
          (uid) => ({
            lookup: "existing",
            snapshot:
              uid === liveSource
                ? snapshot("2026-09-01T10:01:00.000Z", {
                    pro: false,
                    coaching: false,
                  })
                : snapshot("2026-09-01T10:01:00.000Z"),
          }),
          calls,
        ),
      });
      assert.equal(outcome.status, 200, scenario.name);
      assert.deepEqual(calls, scenario.calls, scenario.name);
      const persisted = await scopedPool.query(
        `SELECT e.identity_count,e.retained_identity_count,
                e.pruned_identity_count,e.metadata,s.subject_hash,s.local_user_id
         FROM revenuecat_webhook_events e
         LEFT JOIN revenuecat_event_subjects s ON s.event_id=e.event_id
         WHERE e.event_id=$1 ORDER BY s.subject_hash`,
        [event.eventId],
      );
      if (scenario.retained.length === 0) {
        assert.equal(persisted.rowCount, 0, scenario.name);
      } else {
        assert.deepEqual(
          {
            identityCount: persisted.rows[0].identity_count,
            retainedCount: persisted.rows[0].retained_identity_count,
            prunedCount: persisted.rows[0].pruned_identity_count,
            metadata: persisted.rows[0].metadata,
          },
          {
            identityCount: 2,
            retainedCount: scenario.retained.length,
            prunedCount: 2 - scenario.retained.length,
            metadata: { schemaVersion: 1, identityCount: 2 },
          },
          scenario.name,
        );
        assert.deepEqual(
          persisted.rows.map((row) => row.subject_hash),
          scenario.retained.map(subjectHash).sort(),
          scenario.name,
        );
      }
      assert.equal(
        persisted.rows.some((row) =>
          [tombstonedSource, tombstonedDestination]
            .map(subjectHash)
            .includes(row.subject_hash),
        ),
        false,
        scenario.name,
      );
    }
  },
);

integrationTest(
  "a deletion after initial resolution but before claim locks cannot persist, fetch, or transfer the tombstoned subject",
  async () => {
    const suffix = Date.now();
    const source = `preclaim-source-${suffix}`;
    const destination = `preclaim-destination-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    const event = delivery({
      eventId: `preclaim_delete_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    const calls = [];
    let hookCalls = 0;
    const outcome = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:00.500Z"),
        },
        calls,
      ),
      beforeClaimLocks: async () => {
        hookCalls += 1;
        await tombstoneAndDeleteAccountData(
          source,
          `preclaim-delete-request-${suffix}`,
        );
      },
    });
    assert.equal(hookCalls, 1);
    assert.equal(outcome.status, 200);
    assert.deepEqual(calls, [destination]);
    const stored = await scopedPool.query(
      `SELECT e.identity_count,e.retained_identity_count,e.pruned_identity_count,
              e.metadata,s.subject_hash,s.local_user_id,
              EXISTS(SELECT 1 FROM revenuecat_customer_aliases a
                     WHERE a.alias_hash=$2) AS deleted_alias
       FROM revenuecat_webhook_events e
       LEFT JOIN revenuecat_event_subjects s ON s.event_id=e.event_id
       WHERE e.event_id=$1`,
      [event.eventId, subjectHash(source)],
    );
    assert.deepEqual(stored.rows[0], {
      identity_count: 2,
      retained_identity_count: 1,
      pruned_identity_count: 1,
      metadata: { schemaVersion: 1, identityCount: 2 },
      subject_hash: subjectHash(destination),
      local_user_id: destination,
      deleted_alias: false,
    });
  },
);

integrationTest(
  "transfer relinking preserves direct self ownership and never maps a missing destination to source",
  async () => {
    const suffix = Date.now();
    const source = `direct-source-${suffix}`;
    const destination = `direct-destination-${suffix}`;
    const missingDestination = `missing-destination-${suffix}`;
    const movableAlias = `$RCAnonymousID:movable-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'anonymous','webhook','2026-08-01T00:00:00Z','direct_old_123')`,
      [subjectHash(movableAlias), source],
    );
    const first = delivery({
      eventId: `direct_transfer_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source, movableAlias],
      transferredTo: [destination],
    });
    delete first.userId;
    delete first.originalUserId;
    delete first.aliases;
    await processRevenueCatDelivery({
      delivery: first,
      config: processorConfig,
      client: fakeClient(
        (uid) => ({
          lookup: "existing",
          snapshot:
            uid === source
              ? snapshot("2026-09-01T10:01:01.000Z", {
                  pro: false,
                  coaching: false,
                })
              : snapshot("2026-09-01T10:01:01.000Z"),
        }),
        [],
      ),
    });
    const directRows = await scopedPool.query(
      `SELECT subject_hash,local_user_id FROM revenuecat_event_subjects
       WHERE event_id=$1 ORDER BY subject_hash`,
      [first.eventId],
    );
    assert.deepEqual(
      new Map(
        directRows.rows.map((row) => [row.subject_hash, row.local_user_id]),
      ),
      new Map([
        [subjectHash(source), source],
        [subjectHash(destination), destination],
        [subjectHash(movableAlias), destination],
      ]),
    );
    const forbiddenDirectAliases = await scopedPool.query(
      `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
       WHERE alias_hash=ANY($1::text[])`,
      [[subjectHash(source), subjectHash(destination)]],
    );
    assert.equal(forbiddenDirectAliases.rows[0].count, 0);

    const second = delivery({
      eventId: `missing_to_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [missingDestination],
    });
    delete second.userId;
    delete second.originalUserId;
    delete second.aliases;
    await processRevenueCatDelivery({
      delivery: second,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:02.000Z", {
            pro: false,
            coaching: false,
          }),
        },
        [],
      ),
    });
    const missingTo = await scopedPool.query(
      `SELECT local_user_id FROM revenuecat_event_subjects
       WHERE event_id=$1 AND subject_hash=$2`,
      [second.eventId, subjectHash(missingDestination)],
    );
    assert.equal(missingTo.rows[0].local_user_id, null);
  },
);

integrationTest(
  "direct-self authority rebinds an older webhook alias and deletion removes its hash",
  async () => {
    const suffix = Date.now();
    const priorOwner = `direct-prior-owner-${suffix}`;
    const directUser = `direct-provisioned-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [priorOwner]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,
        source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook',
               '2026-08-01T00:00:00Z','direct_before_provision')`,
      [subjectHash(directUser), priorOwner],
    );
    const historicalEventId = `direct_history_${suffix}`;
    await insertEvent(scopedPool, {
      eventId: historicalEventId,
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: true,
      metadata: { schemaVersion: 1, identityCount: 1 },
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id)
       VALUES ($1,$2,1,$3)`,
      [historicalEventId, subjectHash(directUser), priorOwner],
    );
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [directUser]);

    const ordinary = delivery({
      eventId: `direct_rebind_${suffix}`,
      eventAt: new Date("2026-09-01T10:02:00.000Z"),
      userId: directUser,
    });
    const transfer = delivery({
      eventId: `direct_ordering_${suffix}`,
      eventAt: new Date("2026-09-01T10:02:01.000Z"),
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [directUser],
      transferredTo: [priorOwner],
    });
    delete transfer.userId;
    delete transfer.originalUserId;
    delete transfer.aliases;
    const [ordinaryResult, transferResult] = await Promise.all([
      processRevenueCatDelivery({
        delivery: ordinary,
        config: processorConfig,
        client: fakeClient(
          {
            lookup: "existing",
            snapshot: snapshot("2026-09-01T10:02:00.000Z"),
          },
          [],
        ),
      }),
      processRevenueCatDelivery({
        delivery: transfer,
        config: processorConfig,
        client: fakeClient(
          (uid) => ({
            lookup: "existing",
            snapshot:
              uid === directUser
                ? snapshot("2026-09-01T10:02:01.000Z", {
                    pro: false,
                    coaching: false,
                  })
                : snapshot("2026-09-01T10:02:01.000Z"),
          }),
          [],
        ),
      }),
    ]);
    assert.equal(ordinaryResult.status, 200);
    assert.equal(transferResult.status, 200);
    const rebound = await scopedPool.query(
      `SELECT local_user_id,alias_kind,ownership_source,source_event_at,
              source_event_id,authenticated_at IS NOT NULL AS authenticated
       FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
      [subjectHash(directUser)],
    );
    assert.deepEqual(rebound.rows[0], {
      local_user_id: directUser,
      alias_kind: "authenticated",
      ownership_source: "authenticated",
      source_event_at: null,
      source_event_id: null,
      authenticated: true,
    });
    assert.equal(
      (
        await scopedPool.query(
          `SELECT local_user_id FROM revenuecat_event_subjects
           WHERE event_id=$1 AND subject_hash=$2`,
          [historicalEventId, subjectHash(directUser)],
        )
      ).rows[0].local_user_id,
      directUser,
    );

    await tombstoneAndDeleteAccountData(
      directUser,
      `direct-rebind-delete-${suffix}`,
    );
    const deletedHash = await scopedPool.query(
      `SELECT
         (SELECT count(*)::integer FROM revenuecat_customer_aliases
          WHERE alias_hash=$1) AS alias_count,
         (SELECT count(*)::integer FROM revenuecat_event_subjects
          WHERE subject_hash=$1) AS subject_count`,
      [subjectHash(directUser)],
    );
    assert.deepEqual(deletedHash.rows[0], {
      alias_count: 0,
      subject_count: 0,
    });
  },
);

integrationTest(
  "ordinary recovery executes only the missing identity or entitlement phase",
  async () => {
    const suffix = Date.now();
    const owner = `phase-owner-${suffix}`;
    const identityAlias = `phase-alias-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [owner]);

    const identityPending = delivery({
      eventId: `identity_pending_${suffix}`,
      userId: owner,
      aliases: [identityAlias],
    });
    await processRevenueCatDelivery({
      delivery: identityPending,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("crash");
        },
      },
    });
    await db.transaction((transaction) =>
      applyTrustedSnapshot(transaction, {
        userId: owner,
        snapshot: snapshot("2026-09-01T10:01:03.000Z"),
        config: processorConfig,
        operationId: "worker:phase_entitlement_1",
      }),
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET entitlement_applied_at=now(),next_attempt_at=now(),
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [identityPending.eventId],
    );
    let forbiddenGets = 0;
    const identityRecovered = await processRevenueCatDelivery({
      delivery: identityPending,
      config: processorConfig,
      client: {
        async getSubscriber() {
          forbiddenGets += 1;
          throw new Error("entitlement phase must not refetch");
        },
      },
    });
    assert.equal(identityRecovered.status, 200);
    assert.equal(forbiddenGets, 0);
    const recoveredAlias = await scopedPool.query(
      `SELECT local_user_id FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
      [subjectHash(identityAlias)],
    );
    assert.equal(recoveredAlias.rows[0].local_user_id, owner);

    const entitlementPending = delivery({
      eventId: `entitlement_pending_${suffix}`,
      userId: owner,
      aliases: [`must-not-repeat-${suffix}`],
    });
    await processRevenueCatDelivery({
      delivery: entitlementPending,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("crash");
        },
      },
    });
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET identity_applied_at=now(),next_attempt_at=now(),
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [entitlementPending.eventId],
    );
    const existingAlias = await scopedPool.query(
      `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
       WHERE alias_hash=$1`,
      [subjectHash(`must-not-repeat-${suffix}`)],
    );
    assert.equal(existingAlias.rows[0].count, 0);
    const calls = [];
    const entitlementRecovered = await processRevenueCatDelivery({
      delivery: entitlementPending,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:04.000Z"),
        },
        calls,
      ),
    });
    assert.equal(entitlementRecovered.status, 200);
    assert.deepEqual(calls, [owner]);
    const repeatedAlias = await scopedPool.query(
      `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
       WHERE alias_hash=$1`,
      [subjectHash(`must-not-repeat-${suffix}`)],
    );
    assert.equal(repeatedAlias.rows[0].count, 0);
  },
);

integrationTest(
  "a conflict after either phase committed remains pending with identity_set_changed",
  async () => {
    const suffix = Date.now();
    const first = `phase-conflict-a-${suffix}`;
    const second = `phase-conflict-b-${suffix}`;
    const alias = `phase-conflict-alias-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      first,
      second,
    ]);
    const event = delivery({
      eventId: `phase_conflict_${suffix}`,
      userId: first,
      aliases: [alias],
    });
    await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("pending");
        },
      },
    });
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET entitlement_applied_at=now(),next_attempt_at=now(),
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-09-01T10:01:05Z','conflict_alias_1')`,
      [subjectHash(alias), second],
    );
    const metrics = [];
    const outcome = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(null, []),
      metric: (metric) => metrics.push(metric),
    });
    assert.deepEqual(outcome, {
      status: 503,
      disposition: "identity_set_changed",
      retryAfterSeconds: 1,
    });
    assert.equal(
      metrics.some((metric) => metric.type === "identity_set_changed"),
      true,
    );
    const pending = await scopedPool.query(
      `SELECT disposition,processed_at,next_attempt_at>now() AS backed_off
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.equal(pending.rows[0].disposition, "pending");
    assert.equal(pending.rows[0].processed_at, null);
  },
);

integrationTest(
  "a finalization-only conflict immediately enqueues every discovered owner",
  async () => {
    const suffix = Date.now();
    const first = `final-conflict-a-${suffix}`;
    const second = `final-conflict-b-${suffix}`;
    const movingAlias = `final-conflict-moving-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      first,
      second,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,
        source_event_at,source_event_id)
       VALUES
         ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z','shadow_owner'),
         ($3,$4,'ordinary','webhook','2026-08-01T00:00:00Z','moving_owner')`,
      [subjectHash(first), second, subjectHash(movingAlias), first],
    );
    const event = delivery({
      eventId: `final_conflict_${suffix}`,
      userId: first,
      aliases: [movingAlias],
    });
    await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("leave recoverable event pending");
        },
      },
    });
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET identity_applied_at=now(),next_attempt_at=now(),
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    await scopedPool.query(
      "DELETE FROM revenuecat_customer_state WHERE user_id=ANY($1::text[])",
      [[first, second]],
    );

    let moved = false;
    const outcome = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          assert.equal(uid, first);
          if (!moved) {
            moved = true;
            await scopedPool.query(
              `UPDATE revenuecat_customer_aliases
               SET local_user_id=$1,source_event_at='2026-09-01T10:01:05Z',
                   source_event_id='final_conflict_move',updated_at=now()
               WHERE alias_hash=$2`,
              [second, subjectHash(movingAlias)],
            );
          }
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-01T10:01:05.500Z"),
          };
        },
      },
    });
    assert.equal(moved, true);
    assert.deepEqual(outcome, {
      status: 503,
      disposition: "identity_set_changed",
      retryAfterSeconds: 10,
    });
    const queued = await scopedPool.query(
      `SELECT user_id,reconcile_reason FROM revenuecat_customer_state
       WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
      [[first, second]],
    );
    assert.deepEqual(
      new Map(queued.rows.map((row) => [row.user_id, row.reconcile_reason])),
      new Map([
        [first, "webhook_failure"],
        [second, "webhook_failure"],
      ]),
    );
  },
);

integrationTest(
  "a 201 lookup is re-resolved under final locks before deciding visibility",
  async () => {
    const suffix = Date.now();
    const ordinary = `created-delete-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [ordinary]);
    const ordinaryEvent = delivery({
      eventId: `created_deleted_${suffix}`,
      userId: ordinary,
    });
    const ordinaryResult = await processRevenueCatDelivery({
      delivery: ordinaryEvent,
      config: processorConfig,
      client: {
        async getSubscriber() {
          await scopedPool.query("DELETE FROM users WHERE id=$1", [ordinary]);
          return {
            lookup: "created",
            snapshot: snapshot("2026-09-01T10:01:06.000Z"),
          };
        },
      },
    });
    assert.deepEqual(ordinaryResult, {
      status: 200,
      disposition: "ignored_deleted",
    });
    assert.equal(
      (
        await scopedPool.query(
          "SELECT count(*)::integer AS count FROM revenuecat_webhook_events WHERE event_id=$1",
          [ordinaryEvent.eventId],
        )
      ).rows[0].count,
      0,
    );

    const source = `created-transfer-source-${suffix}`;
    const destination = `created-transfer-dest-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    const transfer = delivery({
      eventId: `created_transfer_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [destination],
    });
    delete transfer.userId;
    delete transfer.originalUserId;
    delete transfer.aliases;
    const transferResult = await processRevenueCatDelivery({
      delivery: transfer,
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          if (uid === source) {
            await scopedPool.query("DELETE FROM users WHERE id=$1", [source]);
            return {
              lookup: "created",
              snapshot: snapshot("2026-09-01T10:01:07.000Z"),
            };
          }
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-01T10:01:07.000Z"),
          };
        },
      },
    });
    assert.equal(transferResult.status, 200);
    const subjects = await scopedPool.query(
      `SELECT subject_hash FROM revenuecat_event_subjects WHERE event_id=$1`,
      [transfer.eventId],
    );
    assert.deepEqual(
      subjects.rows.map((row) => row.subject_hash),
      [subjectHash(destination)],
    );
  },
);

integrationTest(
  "an expired event lease can be reclaimed while its old fence cannot commit",
  async () => {
    const suffix = Date.now();
    const owner = `expired-fence-${suffix}`;
    const event = delivery({
      eventId: `expired_fence_${suffix}`,
      userId: owner,
    });
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
    let releaseOld;
    let oldStarted;
    const oldStartedPromise = new Promise((resolve) => {
      oldStarted = resolve;
    });
    const oldSnapshot = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const oldRun = processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          oldStarted();
          return oldSnapshot;
        },
      },
    });
    await oldStartedPromise;
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET processing_lease_until=now()-interval '1 second',next_attempt_at=now()
       WHERE event_id=$1`,
      [event.eventId],
    );
    const newer = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:09.000Z"),
        },
        [],
      ),
    });
    assert.equal(newer.status, 200);
    releaseOld({
      lookup: "existing",
      snapshot: snapshot("2026-09-01T10:01:08.000Z"),
    });
    const staleOwner = await oldRun;
    assert.equal(staleOwner.status, 503);
    const state = await scopedPool.query(
      `SELECT attempt_count,disposition FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(state.rows[0], {
      attempt_count: 2,
      disposition: "applied",
    });
  },
);

integrationTest(
  "an advisory-lock delay starts the event lease from the live database clock",
  async () => {
    const suffix = Date.now();
    const owner = `delayed-lease-${suffix}`;
    const event = delivery({
      eventId: `delayed_lease_${suffix}`,
      userId: owner,
    });
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
    const blocker = await scopedPool.connect();
    let reachedClaim;
    const reachedClaimPromise = new Promise((resolve) => {
      reachedClaim = resolve;
    });
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 2026090101))",
        [owner],
      );
      let leaseSpanMs = 0;
      const processing = processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        leaseDurationMs: 200,
        beforeClaimLocks: async () => reachedClaim(),
        client: {
          async getSubscriber() {
            const lease = await scopedPool.query(
              `SELECT extract(epoch FROM
                 (processing_lease_until - received_at)) * 1000 AS span_ms
               FROM revenuecat_webhook_events WHERE event_id=$1`,
              [event.eventId],
            );
            leaseSpanMs = Number(lease.rows[0].span_ms);
            throw new Error("leave delayed claim pending");
          },
        },
      });
      await reachedClaimPromise;

      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt += 1) {
        const activity = await scopedPool.query(
          `SELECT EXISTS(
             SELECT 1 FROM pg_stat_activity
             WHERE pid <> $1 AND wait_event_type='Lock'
               AND query LIKE '%pg_advisory_xact_lock%'
           ) AS waiting`,
          [blocker.processID],
        );
        waiting = activity.rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        waiting,
        true,
        "processor should wait on the held account lock",
      );
      await blocker.query("SELECT pg_sleep(0.12)");
      await blocker.query("COMMIT");

      assert.equal((await processing).disposition, "provider_unavailable");
      assert.ok(
        leaseSpanMs >= 300,
        `lease should start after the lock wait; observed ${leaseSpanMs}ms`,
      );
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
    }
  },
);

integrationTest(
  "lease expiry after finalization writes rolls every projection and phase mutation back",
  async () => {
    const suffix = Date.now();
    const owner = `finalization-expiry-${suffix}`;
    const alias = `finalization-expiry-alias-${suffix}`;
    const event = delivery({
      eventId: `finalization_expiry_${suffix}`,
      userId: owner,
      aliases: [alias],
    });
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
    let finalCommitHooks = 0;
    const outcome = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      leaseDurationMs: 500,
      beforeFinalEventCommit: async () => {
        finalCommitHooks += 1;
        await new Promise((resolve) => setTimeout(resolve, 650));
      },
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:09.500Z"),
        },
        [],
      ),
    });
    assert.equal(finalCommitHooks, 1, "writes must begin before lease expiry");
    assert.deepEqual(outcome, {
      status: 503,
      disposition: "processing",
      retryAfterSeconds: 1,
    });
    const persisted = await scopedPool.query(
      `SELECT e.disposition,e.identity_applied_at,e.entitlement_applied_at,
              e.processed_at,
              cs.canonicalization_state,cs.source_kind,cs.last_snapshot_at,
              (SELECT count(*)::integer FROM revenuecat_customer_aliases
               WHERE alias_hash=$2) AS alias_count,
              (SELECT count(*)::integer FROM subscription_entitlements
               WHERE user_id=$3) AS entitlement_count,
              (SELECT count(*)::integer FROM subscriptions
               WHERE user_id=$3) AS compatibility_count
       FROM revenuecat_webhook_events e
       JOIN revenuecat_customer_state cs ON cs.user_id=$3
       WHERE e.event_id=$1`,
      [event.eventId, subjectHash(alias), owner],
    );
    assert.deepEqual(persisted.rows[0], {
      disposition: "pending",
      identity_applied_at: null,
      entitlement_applied_at: null,
      processed_at: null,
      canonicalization_state: "pending",
      source_kind: "none",
      last_snapshot_at: null,
      alias_count: 0,
      entitlement_count: 0,
      compatibility_count: 0,
    });
  },
);

integrationTest(
  "transfer sides fail closed independently, same-owner overlap is accepted, and environment mismatches persist nothing",
  async () => {
    const suffix = Date.now();
    const first = `side-a-${suffix}`;
    const second = `side-b-${suffix}`;
    const destination = `side-dest-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2),($3)", [
      first,
      second,
      destination,
    ]);
    for (const [index, sides] of [
      { from: [first, second], to: [destination] },
      { from: [first], to: [second, destination] },
    ].entries()) {
      const event = delivery({
        eventId: `side_conflict_${index}_${suffix}`,
        type: "TRANSFER",
        kind: "transfer",
        transferredFrom: sides.from,
        transferredTo: sides.to,
      });
      delete event.userId;
      delete event.originalUserId;
      delete event.aliases;
      assert.deepEqual(
        await processRevenueCatDelivery({
          delivery: event,
          config: processorConfig,
          client: fakeClient(null, []),
        }),
        { status: 200, disposition: "ignored_identity_conflict" },
      );
    }
    const overlap = delivery({
      eventId: `same_overlap_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [first],
      transferredTo: [first],
    });
    delete overlap.userId;
    delete overlap.originalUserId;
    delete overlap.aliases;
    const overlapCalls = [];
    assert.equal(
      (
        await processRevenueCatDelivery({
          delivery: overlap,
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-01T10:01:10.000Z"),
            },
            overlapCalls,
          ),
        })
      ).status,
      200,
    );
    assert.deepEqual(overlapCalls, [first]);

    const wrongEnvironment = delivery({
      eventId: `wrong_environment_${suffix}`,
      userId: first,
      metadata: { environment: "PRODUCTION" },
    });
    assert.deepEqual(
      await processRevenueCatDelivery({
        delivery: wrongEnvironment,
        config: processorConfig,
        client: fakeClient(null, []),
      }),
      { status: 200, disposition: "ignored_environment" },
    );
    const eventCount = await scopedPool.query(
      `SELECT count(*)::integer AS count FROM revenuecat_webhook_events
       WHERE event_id=ANY($1::text[])`,
      [
        [
          `side_conflict_0_${suffix}`,
          `side_conflict_1_${suffix}`,
          wrongEnvironment.eventId,
        ],
      ],
    );
    assert.equal(eventCount.rows[0].count, 0);
  },
);

integrationTest(
  "a pending pruned transfer resumes only from its surviving linked destination",
  async () => {
    const suffix = Date.now();
    const source = `pruned-source-${suffix}`;
    const destination = `pruned-destination-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    const event = delivery({
      eventId: `pending_pruned_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("pending");
        },
      },
    });
    await scopedPool.query("DELETE FROM users WHERE id=$1", [source]);
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=now(),processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    const calls = [];
    const recovered = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:11.000Z"),
        },
        calls,
      ),
    });
    assert.equal(recovered.status, 200);
    assert.deepEqual(calls, [destination]);
    const retained = await scopedPool.query(
      `SELECT e.identity_count,e.retained_identity_count,e.pruned_identity_count,
              s.subject_hash,s.local_user_id
       FROM revenuecat_webhook_events e
       JOIN revenuecat_event_subjects s ON s.event_id=e.event_id
       WHERE e.event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(retained.rows[0], {
      identity_count: 2,
      retained_identity_count: 1,
      pruned_identity_count: 1,
      subject_hash: subjectHash(destination),
      local_user_id: destination,
    });
  },
);

integrationTest(
  "generic source and destination reconciliation cannot satisfy a source-live transfer",
  async () => {
    const suffix = Date.now();
    const source = `source-live-${suffix}`;
    const destination = `source-live-destination-${suffix}`;
    const alias = `$RCAnonymousID:source-live-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
      source,
      destination,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'anonymous','webhook','2026-08-01T00:00:00Z','source_live_old')`,
      [subjectHash(alias), source],
    );
    const event = delivery({
      eventId: `source_live_${suffix}`,
      type: "TRANSFER",
      kind: "transfer",
      transferredFrom: [source, alias],
      transferredTo: [destination],
    });
    delete event.userId;
    delete event.originalUserId;
    delete event.aliases;
    await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw new Error("pending");
        },
      },
    });
    for (const [index, userId] of [source, destination].entries()) {
      await db.transaction((transaction) =>
        applyTrustedSnapshot(transaction, {
          userId,
          snapshot: snapshot(`2026-09-01T10:01:1${2 + index}.000Z`),
          config: processorConfig,
          operationId: `worker:source_live_${index}`,
        }),
      );
    }
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=now(),processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    const stillLive = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(
        (uid) => ({
          lookup: "existing",
          snapshot: snapshot("2026-09-01T10:01:14.000Z"),
        }),
        [],
      ),
    });
    assert.equal(stillLive.disposition, "transfer_visibility_lag");
    const pending = await scopedPool.query(
      `SELECT identity_applied_at,entitlement_applied_at,disposition
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [event.eventId],
    );
    assert.deepEqual(pending.rows[0], {
      identity_applied_at: null,
      entitlement_applied_at: null,
      disposition: "pending",
    });
    const unmoved = await scopedPool.query(
      "SELECT local_user_id FROM revenuecat_customer_aliases WHERE alias_hash=$1",
      [subjectHash(alias)],
    );
    assert.equal(unmoved.rows[0].local_user_id, source);

    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=now(),processing_lease_id=NULL,processing_lease_until=NULL
       WHERE event_id=$1`,
      [event.eventId],
    );
    const completed = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: fakeClient(
        (uid) => ({
          lookup: "existing",
          snapshot:
            uid === source
              ? snapshot("2026-09-01T10:01:15.000Z", {
                  pro: false,
                  coaching: false,
                })
              : snapshot("2026-09-01T10:01:15.000Z"),
        }),
        [],
      ),
    });
    assert.equal(completed.status, 200);
  },
);

integrationTest(
  "three ownership expansions back off with identity_set_changed without partial projection",
  async () => {
    const suffix = Date.now();
    const owners = Array.from(
      { length: 4 },
      (_, index) => `expansion-owner-${index}-${suffix}`,
    );
    const rawAlias = `expansion-alias-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      owners,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z','expand_old_1')`,
      [subjectHash(rawAlias), owners[0]],
    );
    const event = delivery({
      eventId: `three_expansions_${suffix}`,
      userId: rawAlias,
    });
    const calls = [];
    const metrics = [];
    const outcome = await processRevenueCatDelivery({
      delivery: event,
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          const index = owners.indexOf(uid);
          calls.push(uid);
          await scopedPool.query(
            `UPDATE revenuecat_customer_aliases
             SET local_user_id=$2,source_event_at=$3,source_event_id=$4
             WHERE alias_hash=$1`,
            [
              subjectHash(rawAlias),
              owners[index + 1],
              `2026-09-01T10:01:${20 + index}Z`,
              `expand_new_${index}`,
            ],
          );
          return {
            lookup: "existing",
            snapshot: snapshot(`2026-09-01T10:01:${20 + index}.000Z`),
          };
        },
      },
      metric: (metric) => metrics.push(metric),
    });
    assert.equal(outcome.disposition, "identity_set_changed");
    assert.deepEqual(calls, owners.slice(0, 3));
    assert.equal(
      metrics.some((metric) => metric.type === "identity_set_changed"),
      true,
    );
    const projected = await scopedPool.query(
      "SELECT count(*)::integer AS count FROM subscription_entitlements WHERE user_id=ANY($1::text[])",
      [owners],
    );
    assert.equal(projected.rows[0].count, 0);
    const queued = await scopedPool.query(
      `SELECT user_id FROM revenuecat_customer_state
       WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
      [owners],
    );
    assert.deepEqual(
      queued.rows.map((row) => row.user_id),
      [...owners].sort(),
    );
  },
);

integrationTest(
  "newer reverse and concurrent transfers win alias provenance deterministically",
  async () => {
    const suffix = Date.now();
    const owners = [
      `chain-a-${suffix}`,
      `chain-b-${suffix}`,
      `chain-c-${suffix}`,
    ];
    const alias = `$RCAnonymousID:chain-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      owners,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'anonymous','webhook','2026-08-01T00:00:00Z','chain_old_1')`,
      [subjectHash(alias), owners[0]],
    );
    const makeTransfer = (eventId, eventAt, destination) => {
      const event = delivery({
        eventId,
        eventAt,
        type: "TRANSFER",
        kind: "transfer",
        transferredFrom: [alias],
        transferredTo: [destination],
      });
      delete event.userId;
      delete event.originalUserId;
      delete event.aliases;
      return event;
    };
    const clientFor = (destination) =>
      fakeClient(
        (uid) => ({
          lookup: "existing",
          snapshot:
            uid === destination
              ? snapshot("2026-09-01T10:01:31.000Z")
              : snapshot("2026-09-01T10:01:31.000Z", {
                  pro: false,
                  coaching: false,
                }),
        }),
        [],
      );
    const newer = makeTransfer(
      `chain_newer_${suffix}`,
      new Date("2026-09-01T10:01:31Z"),
      owners[1],
    );
    const older = makeTransfer(
      `chain_older_${suffix}`,
      new Date("2026-09-01T10:01:30Z"),
      owners[2],
    );
    await Promise.all([
      processRevenueCatDelivery({
        delivery: older,
        config: processorConfig,
        client: clientFor(owners[2]),
      }),
      processRevenueCatDelivery({
        delivery: newer,
        config: processorConfig,
        client: clientFor(owners[1]),
      }),
    ]);
    const winner = await scopedPool.query(
      `SELECT local_user_id,source_event_id FROM revenuecat_customer_aliases
       WHERE alias_hash=$1`,
      [subjectHash(alias)],
    );
    assert.deepEqual(winner.rows[0], {
      local_user_id: owners[1],
      source_event_id: newer.eventId,
    });
  },
);

integrationTest(
  "fifty preclaim and post-GET transfer deletion races retain no deleted subject or alias",
  async () => {
    const suffix = Date.now();
    for (let index = 0; index < 50; index += 1) {
      const source = `delete-race-source-${index}-${suffix}`;
      const destination = `delete-race-dest-${index}-${suffix}`;
      const deleted = index % 2 === 0 ? source : destination;
      const preclaim = index % 4 < 2;
      await scopedPool.query("INSERT INTO users (id) VALUES ($1),($2)", [
        source,
        destination,
      ]);
      const event = delivery({
        eventId: `delete_race_${index}_${suffix}`,
        type: "TRANSFER",
        kind: "transfer",
        transferredFrom: [source],
        transferredTo: [destination],
      });
      delete event.userId;
      delete event.originalUserId;
      delete event.aliases;
      let deletedDuringGet = false;
      let deletedBeforeClaim = false;
      const calls = [];
      const outcome = await processRevenueCatDelivery({
        delivery: event,
        config: processorConfig,
        client: {
          async getSubscriber(uid) {
            calls.push(uid);
            if (!preclaim && uid === deleted && !deletedDuringGet) {
              deletedDuringGet = true;
              await tombstoneAndDeleteAccountData(
                deleted,
                `post-get-delete-${index}-${suffix}`,
              );
            }
            return {
              lookup: "existing",
              snapshot:
                uid === source
                  ? snapshot("2026-09-01T10:01:40.000Z", {
                      pro: false,
                      coaching: false,
                    })
                  : snapshot("2026-09-01T10:01:40.000Z"),
            };
          },
        },
        beforeClaimLocks: preclaim
          ? async () => {
              deletedBeforeClaim = true;
              await tombstoneAndDeleteAccountData(
                deleted,
                `preclaim-delete-${index}-${suffix}`,
              );
            }
          : undefined,
      });
      assert.equal(outcome.status, 200);
      assert.equal(deletedBeforeClaim, preclaim);
      assert.equal(deletedDuringGet, !preclaim);
      if (preclaim) assert.equal(calls.includes(deleted), false);
      const forbidden = await scopedPool.query(
        `SELECT
          EXISTS(SELECT 1 FROM revenuecat_event_subjects WHERE subject_hash=$1) AS subject,
          EXISTS(SELECT 1 FROM revenuecat_customer_aliases WHERE alias_hash=$1) AS alias,
          (SELECT identity_count FROM revenuecat_webhook_events WHERE event_id=$2) AS identity_count,
          (SELECT retained_identity_count FROM revenuecat_webhook_events WHERE event_id=$2) AS retained_count,
          (SELECT pruned_identity_count FROM revenuecat_webhook_events WHERE event_id=$2) AS pruned_count`,
        [subjectHash(deleted), event.eventId],
      );
      assert.deepEqual(forbidden.rows[0], {
        subject: false,
        alias: false,
        identity_count: 2,
        retained_count: 1,
        pruned_count: 1,
      });
    }
  },
);

integrationTest(
  "upgrading exact 0000-0003 scrubs hostile legacy data without granting access",
  async () => {
    const migrationsDirectory = await mkdtemp(
      join(tmpdir(), "elovia-revenuecat-upgrade-"),
    );
    try {
      for (const name of migrationNames.slice(0, 4)) {
        await writeFile(
          join(migrationsDirectory, name),
          await readFile(new URL(name, baselineMigrationUrl), "utf8"),
          "utf8",
        );
      }
      await withTemporaryDatabase(async (databaseUrl) => {
        assert.deepEqual(
          await runMigrations(databaseUrl, { migrationsDirectory }),
          migrationNames.slice(0, 4),
        );
        const pool = new Pool({ connectionString: databaseUrl });
        try {
          await pool.query(
            `INSERT INTO users (id) VALUES ('legacy-hostile'), ('pending-user')`,
          );
          await pool.query(
            `INSERT INTO subscriptions (
              user_id, revenuecat_user_id, entitlement_active, entitlement_id,
              status, tier, product_id, store, trial_started_at, trial_ends_at,
              current_period_ends_at, last_event, last_event_at
            ) VALUES ($1,$2,true,$3,'active','lifetime',$4,$5,now(),now() + interval '99 years',
              now() + interval '99 years',$6::jsonb,now() + interval '99 years')`,
            [
              "legacy-hostile",
              `$RCAnonymousID:${"x".repeat(512)}`,
              "entitlement-" + "x".repeat(512),
              "product-" + "x".repeat(512),
              "untrusted_store",
              JSON.stringify({ subscriber: "private", access: true }),
            ],
          );
        } finally {
          await pool.end();
        }

        assert.deepEqual(
          await runMigrations(databaseUrl),
          migrationNames.slice(4),
        );
        const verifyPool = new Pool({ connectionString: databaseUrl });
        try {
          const states = await verifyPool.query(`
            SELECT user_id, canonicalization_state, source_kind, reconcile_reason
            FROM revenuecat_customer_state ORDER BY user_id
          `);
          assert.deepEqual(states.rows, [
            {
              user_id: "legacy-hostile",
              canonicalization_state: "legacy_unverified",
              source_kind: "legacy_unverified",
              reconcile_reason: "legacy_bootstrap",
            },
            {
              user_id: "pending-user",
              canonicalization_state: "pending",
              source_kind: "none",
              reconcile_reason: "legacy_bootstrap",
            },
          ]);
          const entitlements = await verifyPool.query(
            `SELECT * FROM subscription_entitlements ORDER BY user_id, entitlement_id`,
          );
          assert.equal(entitlements.rowCount, 1);
          assert.deepEqual(
            {
              userId: entitlements.rows[0].user_id,
              entitlementId: entitlements.rows[0].entitlement_id,
              active: entitlements.rows[0].active,
              status: entitlements.rows[0].status,
              productId: entitlements.rows[0].product_id,
              store: entitlements.rows[0].store,
              periodEndsAt: entitlements.rows[0].period_ends_at,
              graceEndsAt: entitlements.rows[0].grace_ends_at,
              accessEndsAt: entitlements.rows[0].access_ends_at,
              willRenew: entitlements.rows[0].will_renew,
              sourceEnvironment: entitlements.rows[0].source_environment,
              sourceKind: entitlements.rows[0].source_kind,
              snapshot: entitlements.rows[0].source_snapshot_at.toISOString(),
              operation: entitlements.rows[0].source_operation_id,
              trigger: entitlements.rows[0].source_trigger_event_id,
            },
            {
              userId: "legacy-hostile",
              entitlementId: "__legacy_unverified__",
              active: false,
              status: "expired",
              productId: null,
              store: null,
              periodEndsAt: null,
              graceEndsAt: null,
              accessEndsAt: null,
              willRenew: false,
              sourceEnvironment: null,
              sourceKind: "legacy_unverified",
              snapshot: "1970-01-01T00:00:00.000Z",
              operation: "legacy",
              trigger: null,
            },
          );
          const scrubbed = await verifyPool.query(
            `SELECT revenuecat_user_id, last_event FROM subscriptions WHERE user_id = 'legacy-hostile'`,
          );
          assert.deepEqual(scrubbed.rows[0], {
            revenuecat_user_id: "legacy-hostile",
            last_event: null,
          });
          assert.equal(
            (
              await verifyPool.query(
                "SELECT count(*)::integer AS count FROM revenuecat_webhook_events",
              )
            ).rows[0].count,
            0,
          );
          await assert.rejects(
            verifyPool.query(
              `UPDATE subscriptions SET last_event = '{"forbidden":true}'::jsonb WHERE user_id = 'legacy-hostile'`,
            ),
            /subscriptions_last_event_must_be_null/,
          );
          await assert.rejects(
            verifyPool.query(
              `UPDATE subscriptions SET revenuecat_user_id = '$RCAnonymousID:forbidden' WHERE user_id = 'legacy-hostile'`,
            ),
            /subscriptions_revenuecat_user_is_local/,
          );
        } finally {
          await verifyPool.end();
        }
      });
    } finally {
      await rm(migrationsDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "the blank schema mirrors every RevenueCat DDL object",
  async () => {
    const tables = await scopedPool.query(
      `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
     ORDER BY table_name`,
      [revenuecatTableNames],
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      revenuecatTableNames,
    );

    const columns = await scopedPool.query(
      `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
      [revenuecatTableNames],
    );
    const actualColumns = Object.fromEntries(
      revenuecatTableNames.map((name) => [
        name,
        columns.rows
          .filter((row) => row.table_name === name)
          .map((row) => row.column_name),
      ]),
    );
    assert.deepEqual(actualColumns, expectedColumns);

    const checks = await scopedPool.query(
      `SELECT conname FROM pg_constraint
     WHERE connamespace = current_schema()::regnamespace AND contype = 'c'
       AND conrelid::regclass::text = ANY($1::text[])
     ORDER BY conname`,
      [revenuecatTableNames],
    );
    assert.deepEqual(
      checks.rows.map((row) => row.conname),
      expectedCheckNames,
    );
    const legacyChecks = await scopedPool.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'subscriptions'::regclass AND contype = 'c'
    ORDER BY conname
  `);
    assert.deepEqual(
      legacyChecks.rows.map((row) => row.conname),
      [
        "subscriptions_last_event_must_be_null",
        "subscriptions_revenuecat_user_is_local",
      ],
    );

    const indexes = await scopedPool.query(
      `SELECT index_record.relname AS index_name,
       ARRAY(SELECT attribute.attname
         FROM unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, position)
         JOIN pg_attribute attribute ON attribute.attrelid = index_meta.indrelid
           AND attribute.attnum = key.attnum
         ORDER BY key.position) AS columns,
       pg_get_indexdef(index_meta.indexrelid) AS definition
     FROM pg_index index_meta
     JOIN pg_class index_record ON index_record.oid = index_meta.indexrelid
     JOIN pg_class table_record ON table_record.oid = index_meta.indrelid
     WHERE table_record.relnamespace = current_schema()::regnamespace
       AND index_record.relname = ANY($1::text[])
     ORDER BY index_record.relname`,
      [Object.keys(expectedIndexColumns)],
    );
    assert.deepEqual(
      Object.fromEntries(
        indexes.rows.map((row) => [row.index_name, row.columns]),
      ),
      expectedIndexColumns,
    );
    assert.match(
      indexes.rows.find(
        (row) => row.index_name === "IDX_revenuecat_events_type_time",
      ).definition,
      /event_at DESC/,
    );
    await scopedPool.query("SET enable_seqscan=off");
    try {
      const explained = await scopedPool.query(
        `EXPLAIN (FORMAT TEXT, COSTS OFF)
         SELECT subject.event_id,subject.local_user_id
         FROM revenuecat_event_subjects AS subject
         JOIN revenuecat_webhook_events AS event
           ON event.event_id=subject.event_id
         WHERE subject.subject_hash=$1::char(64)
           AND event.disposition='pending'
         ORDER BY subject.event_id COLLATE "C"`,
        ["f".repeat(64)],
      );
      assert.match(
        explained.rows.map((row) => row["QUERY PLAN"]).join("\n"),
        /IDX_revenuecat_event_subjects_hash/,
      );
    } finally {
      await scopedPool.query("RESET enable_seqscan");
    }

    const primaryKeys = await scopedPool.query(
      `SELECT relation.relname AS table_name, pg_get_constraintdef(constraint_record.oid) AS definition
     FROM pg_constraint constraint_record
     JOIN pg_class relation ON relation.oid = constraint_record.conrelid
     WHERE constraint_record.connamespace = current_schema()::regnamespace
       AND constraint_record.contype = 'p'
       AND relation.relname = ANY($1::text[])
     ORDER BY relation.relname`,
      [revenuecatTableNames],
    );
    assert.deepEqual(primaryKeys.rows, [
      {
        table_name: "revenuecat_customer_aliases",
        definition: "PRIMARY KEY (alias_hash)",
      },
      {
        table_name: "revenuecat_customer_state",
        definition: "PRIMARY KEY (user_id)",
      },
      {
        table_name: "revenuecat_event_subjects",
        definition: "PRIMARY KEY (event_id, subject_hash)",
      },
      {
        table_name: "revenuecat_webhook_events",
        definition: "PRIMARY KEY (event_id)",
      },
      {
        table_name: "subscription_entitlements",
        definition: "PRIMARY KEY (user_id, entitlement_id)",
      },
    ]);

    const foreignKeys = await scopedPool.query(
      `SELECT relation.relname AS table_name, pg_get_constraintdef(constraint_record.oid) AS definition
     FROM pg_constraint constraint_record
     JOIN pg_class relation ON relation.oid = constraint_record.conrelid
     WHERE constraint_record.connamespace = current_schema()::regnamespace
       AND constraint_record.contype = 'f'
       AND relation.relname = ANY($1::text[])
     ORDER BY relation.relname, definition`,
      [revenuecatTableNames],
    );
    assert.deepEqual(foreignKeys.rows, [
      {
        table_name: "revenuecat_customer_aliases",
        definition:
          "FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE",
      },
      {
        table_name: "revenuecat_customer_state",
        definition:
          "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
      },
      {
        table_name: "revenuecat_event_subjects",
        definition:
          "FOREIGN KEY (event_id) REFERENCES revenuecat_webhook_events(event_id) ON DELETE CASCADE",
      },
      {
        table_name: "revenuecat_event_subjects",
        definition:
          "FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE",
      },
      {
        table_name: "subscription_entitlements",
        definition:
          "FOREIGN KEY (source_trigger_event_id) REFERENCES revenuecat_webhook_events(event_id) ON DELETE SET NULL",
      },
      {
        table_name: "subscription_entitlements",
        definition:
          "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
      },
    ]);

    const collations = await scopedPool.query(
      `SELECT table_record.relname AS table_name, attribute.attname AS column_name,
            collation.collname AS collation_name
     FROM pg_attribute attribute
     JOIN pg_class table_record ON table_record.oid = attribute.attrelid
     JOIN pg_collation collation ON collation.oid = attribute.attcollation
     WHERE table_record.relnamespace = current_schema()::regnamespace
       AND (table_record.relname, attribute.attname) IN (
         ('revenuecat_webhook_events','event_id'),
         ('revenuecat_event_subjects','event_id'),
         ('revenuecat_customer_aliases','source_event_id'),
         ('revenuecat_customer_state','last_operation_id'),
         ('subscription_entitlements','source_operation_id'),
         ('subscription_entitlements','source_trigger_event_id')
       ) ORDER BY table_name, column_name`,
    );
    assert.ok(collations.rowCount === 6);
    assert.ok(collations.rows.every((row) => row.collation_name === "C"));

    const trigger = await scopedPool.query(`
      SELECT table_record.relname AS table_name, trigger_record.tgname,
             procedure_record.proname,
             pg_get_triggerdef(trigger_record.oid) AS definition
      FROM pg_trigger trigger_record
      JOIN pg_proc procedure_record ON procedure_record.oid = trigger_record.tgfoid
      JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
      WHERE trigger_record.tgrelid IN (
        'revenuecat_event_subjects'::regclass,
        'revenuecat_webhook_events'::regclass
      )
        AND NOT trigger_record.tgisinternal
      ORDER BY table_record.relname, trigger_record.tgname
    `);
    assert.deepEqual(
      trigger.rows.map((row) => [row.table_name, row.tgname, row.proname]),
      [
        [
          "revenuecat_event_subjects",
          "TR_revenuecat_count_pruned_subject",
          "revenuecat_count_pruned_subject",
        ],
        [
          "revenuecat_event_subjects",
          "TR_revenuecat_preserve_subject_identity",
          "revenuecat_preserve_subject_identity",
        ],
        [
          "revenuecat_event_subjects",
          "TR_revenuecat_reserve_subject_capacity",
          "revenuecat_reserve_subject_capacity",
        ],
        [
          "revenuecat_webhook_events",
          "TR_revenuecat_guard_event_capacity",
          "revenuecat_guard_event_capacity",
        ],
      ],
    );
    assert.match(
      trigger.rows.find(
        (row) => row.tgname === "TR_revenuecat_count_pruned_subject",
      ).definition,
      /AFTER DELETE/,
    );
    assert.match(
      trigger.rows.find(
        (row) => row.tgname === "TR_revenuecat_reserve_subject_capacity",
      ).definition,
      /AFTER INSERT/,
    );
    assert.match(
      trigger.rows.find(
        (row) => row.tgname === "TR_revenuecat_preserve_subject_identity",
      ).definition,
      /BEFORE UPDATE OF event_id, subject_hash/,
    );
    assert.match(
      trigger.rows.find(
        (row) => row.tgname === "TR_revenuecat_guard_event_capacity",
      ).definition,
      /BEFORE UPDATE OF identity_count, retained_identity_count, pruned_identity_count/,
    );
  },
);

integrationTest(
  "subject capacity is atomic, monotonic, and cannot block later account deletion",
  async () => {
    await scopedPool.query(
      `INSERT INTO users (id) VALUES
       ('capacity-user-one'), ('capacity-user-two'), ('capacity-user-three'),
       ('capacity-zero-user'), ('capacity-race-one'), ('capacity-race-two')`,
    );

    await insertEvent(scopedPool, {
      eventId: "event_capacity_2",
      identityCount: 2,
      identityRequired: true,
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES
       ('event_capacity_2',$1,1,'capacity-user-one'),
       ('event_capacity_2',$2,2,'capacity-user-two')`,
      ["5".repeat(64), "6".repeat(64)],
    );
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_2',$1,4,'capacity-user-three')`,
        ["7".repeat(64)],
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_capacity_valid");
        return true;
      },
    );
    await assert.rejects(
      scopedPool.query(
        `UPDATE revenuecat_webhook_events SET identity_count=1
         WHERE event_id='event_capacity_2'`,
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(
          error.constraint,
          "revenuecat_event_subject_capacity_valid",
        );
        return true;
      },
    );

    await insertEvent(scopedPool, {
      eventId: "event_capacity_1",
      identityCount: 1,
      identityRequired: true,
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id)
       VALUES ('event_capacity_1',$1,1,'capacity-user-three')`,
      ["b".repeat(64)],
    );
    const duplicateNoOp = await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id)
       VALUES ('event_capacity_1',$1,2,'capacity-zero-user')
       ON CONFLICT (event_id,subject_hash) DO NOTHING
       RETURNING role_mask`,
      ["b".repeat(64)],
    );
    assert.equal(duplicateNoOp.rowCount, 0);
    let idempotentState = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_1'`,
    );
    assert.deepEqual(idempotentState.rows[0], {
      retained_identity_count: 1,
      pruned_identity_count: 0,
    });

    const duplicateUpdate = await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id)
       VALUES ('event_capacity_1',$1,4,'capacity-zero-user')
       ON CONFLICT (event_id,subject_hash) DO UPDATE
       SET role_mask=EXCLUDED.role_mask,
           local_user_id=EXCLUDED.local_user_id
       RETURNING role_mask,local_user_id`,
      ["b".repeat(64)],
    );
    assert.deepEqual(duplicateUpdate.rows[0], {
      role_mask: 4,
      local_user_id: "capacity-zero-user",
    });
    idempotentState = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_1'`,
    );
    assert.deepEqual(idempotentState.rows[0], {
      retained_identity_count: 1,
      pruned_identity_count: 0,
    });
    for (const statement of [
      `UPDATE revenuecat_event_subjects SET subject_hash='${"d".repeat(64)}'
       WHERE event_id='event_capacity_1'`,
      `UPDATE revenuecat_event_subjects SET event_id='event_capacity_2'
       WHERE event_id='event_capacity_1'`,
    ]) {
      await assert.rejects(scopedPool.query(statement), (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_identity_immutable");
        return true;
      });
    }
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_1',$1,2,'capacity-zero-user')`,
        ["c".repeat(64)],
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_capacity_valid");
        return true;
      },
    );

    await insertEvent(scopedPool, {
      eventId: "event_capacity_0",
      identityCount: 0,
      identityRequired: false,
    });
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_0',$1,1,'capacity-zero-user')`,
        ["8".repeat(64)],
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_capacity_valid");
        return true;
      },
    );

    await db.delete(usersTable).where(eq(usersTable.id, "capacity-zero-user"));
    const conflictPruned = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count,
              (SELECT count(*)::integer FROM revenuecat_event_subjects
               WHERE event_id='event_capacity_1') AS subject_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_1'`,
    );
    assert.deepEqual(conflictPruned.rows[0], {
      retained_identity_count: 0,
      pruned_identity_count: 1,
      subject_count: 0,
    });
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_1',$1,2,'capacity-user-three')`,
        ["c".repeat(64)],
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_capacity_valid");
        return true;
      },
    );

    await db.delete(usersTable).where(eq(usersTable.id, "capacity-user-one"));
    const pruned = await scopedPool.query(
      `SELECT identity_count,retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_2'`,
    );
    assert.deepEqual(pruned.rows[0], {
      identity_count: 2,
      retained_identity_count: 1,
      pruned_identity_count: 1,
    });
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_2',$1,4,'capacity-user-three')`,
        ["7".repeat(64)],
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(error.constraint, "revenuecat_subject_capacity_valid");
        return true;
      },
    );
    await assert.rejects(
      scopedPool.query(
        `UPDATE revenuecat_webhook_events SET pruned_identity_count=0
         WHERE event_id='event_capacity_2'`,
      ),
      (error) => {
        assert.equal(error.code, "23514");
        assert.equal(
          error.constraint,
          "revenuecat_event_capacity_counters_managed",
        );
        return true;
      },
    );
    await db.delete(usersTable).where(eq(usersTable.id, "capacity-user-two"));
    const fullyPruned = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_2'`,
    );
    assert.deepEqual(fullyPruned.rows[0], {
      retained_identity_count: 0,
      pruned_identity_count: 2,
    });

    await insertEvent(scopedPool, {
      eventId: "event_capacity_race",
      identityCount: 1,
      identityRequired: true,
    });
    const concurrent = await Promise.allSettled([
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_race',$1,1,'capacity-race-one')`,
        ["9".repeat(64)],
      ),
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id)
         VALUES ('event_capacity_race',$1,2,'capacity-race-two')`,
        ["a".repeat(64)],
      ),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    const rejected = concurrent.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "23514");
    assert.equal(
      rejected.reason.constraint,
      "revenuecat_subject_capacity_valid",
    );
    const raceState = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count,
              (SELECT count(*)::integer FROM revenuecat_event_subjects
               WHERE event_id='event_capacity_race') AS subject_count
       FROM revenuecat_webhook_events WHERE event_id='event_capacity_race'`,
    );
    assert.deepEqual(raceState.rows[0], {
      retained_identity_count: 1,
      pruned_identity_count: 0,
      subject_count: 1,
    });
  },
);

integrationTest(
  "identity roles, provenance, and phase checks reject contradictory state",
  async () => {
    await scopedPool.query(
      `INSERT INTO users (id) VALUES ('phase-user'), ('phase-user-two')`,
    );
    await insertEvent(scopedPool, {
      eventId: "event_phase_1",
      identityCount: 2,
      identityRequired: true,
    });
    const hash = "a".repeat(64);
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id, subject_hash, role_mask, local_user_id)
       VALUES ('event_phase_1',$1,5,'phase-user')`,
      [hash],
    );
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id, subject_hash, role_mask, local_user_id)
         VALUES ('event_phase_1',$1,1,'phase-user-two')`,
        [hash],
      ),
      /duplicate key/,
    );
    await assert.rejects(
      scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id, subject_hash, role_mask)
         VALUES ('event_phase_1',$1,128)`,
        ["b".repeat(64)],
      ),
      /revenuecat_subject_role_mask_valid/,
    );

    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,authenticated_at)
       VALUES ($1,'phase-user','authenticated','authenticated','2026-09-01T10:00:00Z')`,
      ["c".repeat(64)],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,'phase-user','ordinary','webhook','2026-09-01T10:00:00Z','event_phase_1')`,
      ["d".repeat(64)],
    );
    for (const [hashValue, values] of [
      [
        "e".repeat(64),
        "'ordinary','authenticated',NULL,NULL,'2026-09-01T10:00:00Z'",
      ],
      [
        "f".repeat(64),
        "'authenticated','webhook','2026-09-01T10:00:00Z','event_phase_1',NULL",
      ],
    ]) {
      await assert.rejects(
        scopedPool.query(
          `INSERT INTO revenuecat_customer_aliases
           (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id,authenticated_at)
           VALUES ($1,'phase-user',${values})`,
          [hashValue],
        ),
        /revenuecat_alias_provenance_valid/,
      );
    }

    await assert.rejects(
      insertEvent(scopedPool, {
        eventId: "event_badphase1",
        identityCount: 1,
        identityRequired: false,
      }),
      /revenuecat_event_phase_fields_valid/,
    );
    await insertEvent(scopedPool, {
      eventId: "event_twophase",
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: true,
    });
    await assert.rejects(
      scopedPool.query(
        `UPDATE revenuecat_webhook_events
         SET entitlement_applied_at='2026-09-01T10:00:02Z',
             processed_at='2026-09-01T10:00:03Z', disposition='applied'
         WHERE event_id='event_twophase'`,
      ),
      /revenuecat_event_state_consistent/,
    );
    await assert.rejects(
      scopedPool.query(
        `UPDATE revenuecat_webhook_events
         SET identity_applied_at='2026-09-01T10:00:02Z',
             processed_at='2026-09-01T10:00:03Z', disposition='applied'
         WHERE event_id='event_twophase'`,
      ),
      /revenuecat_event_state_consistent/,
    );
    await assert.rejects(
      insertEvent(scopedPool, {
        eventId: "event_badphase2",
        entitlementRequired: true,
      }),
      /revenuecat_event_phase_fields_valid/,
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET identity_applied_at='2026-09-01T10:00:02Z', processed_at='2026-09-01T10:00:03Z', disposition='applied'
       WHERE event_id='event_phase_1'`,
    );
    const applied = await scopedPool.query(
      `SELECT identity_applied_at IS NOT NULL AS identity_done,
              entitlement_applied_at IS NOT NULL AS entitlement_done
       FROM revenuecat_webhook_events WHERE event_id='event_phase_1'`,
    );
    assert.deepEqual(applied.rows[0], {
      identity_done: true,
      entitlement_done: false,
    });
  },
);

integrationTest(
  "C-collated event and operation identifiers keep byte-stable ordering",
  async () => {
    const identifiers = ["sort-a000", "sort-A000", "sort_0000", "sort-0000"];
    for (const eventId of identifiers) {
      await insertEvent(scopedPool, { eventId, type: "TEST" });
    }
    const events = await scopedPool.query(
      `SELECT event_id FROM revenuecat_webhook_events WHERE event_id LIKE 'sort%' ORDER BY event_id`,
    );
    assert.deepEqual(
      events.rows.map((row) => row.event_id),
      ["sort-0000", "sort-A000", "sort_0000", "sort-a000"],
    );

    for (let index = 0; index < identifiers.length; index += 1) {
      const userId = `sort-user-${index}`;
      await scopedPool.query(`INSERT INTO users (id) VALUES ($1)`, [userId]);
      await scopedPool.query(
        `INSERT INTO revenuecat_customer_state
         (user_id,canonicalization_state,source_kind,source_environment,last_snapshot_at,
          last_operation_id,last_reconciled_at,reconcile_reason,reconcile_after)
         VALUES ($1,'canonical','worker_canonical','sandbox','2026-09-01T10:00:00Z',$2,
                 '2026-09-01T10:00:01Z','scheduled','2026-09-02T10:00:00Z')`,
        [userId, `worker:${identifiers[index]}`],
      );
      await scopedPool.query(
        `INSERT INTO subscription_entitlements
         (user_id,entitlement_id,active,status,will_renew,source_environment,
          source_kind,source_snapshot_at,source_operation_id)
         VALUES ($1,'pro',true,'active',true,'sandbox','worker_canonical',
                 '2026-09-01T10:00:00Z',$2)`,
        [userId, `worker:${identifiers[index]}`],
      );
    }
    const operations = await scopedPool.query(
      `SELECT last_operation_id FROM revenuecat_customer_state
       WHERE user_id LIKE 'sort-user-%' ORDER BY last_operation_id`,
    );
    assert.deepEqual(
      operations.rows.map((row) => row.last_operation_id),
      identifiers
        .map((identifier) => `worker:${identifier}`)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)),
        ),
    );
    const entitlementOperations = await scopedPool.query(
      `SELECT source_operation_id FROM subscription_entitlements
       WHERE user_id LIKE 'sort-user-%' ORDER BY source_operation_id`,
    );
    assert.deepEqual(
      entitlementOperations.rows.map((row) => row.source_operation_id),
      operations.rows.map((row) => row.last_operation_id),
    );
  },
);

integrationTest(
  "Drizzle user deletion prunes only that identity and cascades its queue state",
  async () => {
    await scopedPool.query(
      `INSERT INTO users (id) VALUES ('shared-user-one'), ('shared-user-two')`,
    );
    await insertEvent(scopedPool, {
      eventId: "event_shared_1",
      identityCount: 2,
      identityRequired: true,
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES
       ('event_shared_1',$1,1,'shared-user-one'),
       ('event_shared_1',$2,3,'shared-user-two')`,
      ["1".repeat(64), "2".repeat(64)],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,authenticated_at) VALUES
       ($1,'shared-user-one','authenticated','authenticated','2026-09-01T10:00:00Z')`,
      ["3".repeat(64)],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after)
       VALUES ('shared-user-one','pending','none','scheduled','2026-09-02T10:00:00Z')`,
    );
    await scopedPool.query(
      `INSERT INTO subscription_entitlements
       (user_id,entitlement_id,active,status,will_renew,source_environment,source_kind,
        source_snapshot_at,source_operation_id,source_trigger_event_id) VALUES
       ('shared-user-one','pro',true,'active',true,'sandbox','webhook_canonical',
        '2026-09-01T10:00:00Z','webhook:event_shared_1','event_shared_1')`,
    );
    await db.delete(usersTable).where(eq(usersTable.id, "shared-user-one"));

    const eventState = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count
       FROM revenuecat_webhook_events WHERE event_id='event_shared_1'`,
    );
    assert.deepEqual(eventState.rows[0], {
      retained_identity_count: 1,
      pruned_identity_count: 1,
    });
    const subjects = await scopedPool.query(
      `SELECT subject_hash,local_user_id FROM revenuecat_event_subjects WHERE event_id='event_shared_1'`,
    );
    assert.deepEqual(subjects.rows, [
      { subject_hash: "2".repeat(64), local_user_id: "shared-user-two" },
    ]);
    const deletedHashes = await scopedPool.query(
      `SELECT
        EXISTS(SELECT 1 FROM revenuecat_event_subjects WHERE subject_hash=$1) AS subject_retained,
        EXISTS(SELECT 1 FROM revenuecat_customer_aliases WHERE alias_hash=$2) AS alias_retained`,
      ["1".repeat(64), "3".repeat(64)],
    );
    assert.deepEqual(deletedHashes.rows[0], {
      subject_retained: false,
      alias_retained: false,
    });
    const cascaded = await scopedPool.query(`
      SELECT
        (SELECT count(*)::integer FROM revenuecat_customer_state WHERE user_id='shared-user-one') AS state,
        (SELECT count(*)::integer FROM revenuecat_customer_aliases WHERE local_user_id='shared-user-one') AS aliases,
        (SELECT count(*)::integer FROM subscription_entitlements WHERE user_id='shared-user-one') AS entitlements
    `);
    assert.deepEqual(cascaded.rows[0], {
      state: 0,
      aliases: 0,
      entitlements: 0,
    });

    await db.delete(usersTable).where(eq(usersTable.id, "shared-user-two"));
    const fullyPruned = await scopedPool.query(
      `SELECT retained_identity_count,pruned_identity_count,
              (SELECT count(*)::integer FROM revenuecat_event_subjects
               WHERE event_id='event_shared_1') AS retained_subjects
       FROM revenuecat_webhook_events WHERE event_id='event_shared_1'`,
    );
    assert.deepEqual(fullyPruned.rows[0], {
      retained_identity_count: 0,
      pruned_identity_count: 2,
      retained_subjects: 0,
    });
  },
);

integrationTest(
  "authenticated provenance displaces webhook ownership and recovers an identity-only event without raw subjects",
  async () => {
    const suffix = Date.now();
    const priorOwner = `auth-prior-${suffix}`;
    const authenticated = `auth-direct-${suffix}`;
    const eventId = `auth_recovery_${suffix}`;
    const hash = subjectHash(authenticated);
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [priorOwner]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2000-01-01T00:00:00Z','auth_seed_1234')`,
      [hash, priorOwner],
    );
    await insertEvent(scopedPool, {
      eventId,
      eventAt: "2000-01-01T00:00:01Z",
      receivedAt: "2000-01-01T00:00:02Z",
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: true,
      nextAttemptAt: "2000-01-01T00:00:02Z",
      retentionUntil: "2099-01-01T00:00:00Z",
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES ($1,$2,1,$3)`,
      [eventId, hash, priorOwner],
    );

    const authUser = {
      id: authenticated,
      email: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
    };
    assert.equal(
      await provisionAuthenticatedUserIfActive(
        authUser,
        createRevenueCatAuthProvisioningCallback(authUser, processorConfig),
      ),
      "active",
    );
    const ownership = await scopedPool.query(
      `SELECT local_user_id,alias_kind,ownership_source,source_event_at,source_event_id,
              authenticated_at IS NOT NULL AS authenticated
       FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
      [hash],
    );
    assert.deepEqual(ownership.rows[0], {
      local_user_id: authenticated,
      alias_kind: "authenticated",
      ownership_source: "authenticated",
      source_event_at: null,
      source_event_id: null,
      authenticated: true,
    });
    const queued = await scopedPool.query(
      `SELECT user_id,reconcile_reason FROM revenuecat_customer_state
       WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
      [[priorOwner, authenticated]],
    );
    assert.deepEqual(
      new Set(
        queued.rows.map((row) => `${row.user_id}:${row.reconcile_reason}`),
      ),
      new Set([
        `${priorOwner}:authenticated`,
        `${authenticated}:authenticated`,
      ]),
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET entitlement_applied_at=clock_timestamp(),next_attempt_at='2000-01-01T00:00:02Z'
       WHERE event_id=$1`,
      [eventId],
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at='2099-01-01T00:00:00Z'
       WHERE disposition='pending' AND event_id<>$1`,
      [eventId],
    );
    let providerCalls = 0;
    await runPendingEventBatch({
      config: processorConfig,
      client: {
        async getSubscriber() {
          providerCalls += 1;
          throw new Error("identity-only recovery must not fetch");
        },
      },
      limit: 1,
    });
    assert.equal(providerCalls, 0);
    const recovered = await scopedPool.query(
      `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
              entitlement_applied_at IS NOT NULL AS entitlement_done
       FROM revenuecat_webhook_events WHERE event_id=$1`,
      [eventId],
    );
    assert.deepEqual(recovered.rows[0], {
      disposition: "stale",
      identity_done: true,
      entitlement_done: true,
    });
    assert.equal(
      (
        await scopedPool.query(
          "SELECT local_user_id FROM revenuecat_customer_aliases WHERE alias_hash=$1",
          [hash],
        )
      ).rows[0].local_user_id,
      authenticated,
    );
  },
);

integrationTest(
  "webhook authentication transitions wake backed-off recovery once while exact repeats and tombstones stay inert",
  async () => {
    const suffix = Date.now();
    const active = `auth-state-active-${suffix}`;
    const deleted = `auth-state-deleted-${suffix}`;
    const activeUser = {
      id: active,
      email: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
    };
    assert.equal(
      await provisionAuthenticatedUserIfActive(
        activeUser,
        createRevenueCatAuthProvisioningCallback(activeUser, processorConfig),
      ),
      "active",
    );
    const hash = subjectHash(active);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT alias_kind,ownership_source,local_user_id
           FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
          [hash],
        )
      ).rows[0],
      {
        alias_kind: "authenticated",
        ownership_source: "authenticated",
        local_user_id: active,
      },
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_state SET
         canonicalization_state='canonical',source_kind='auth_canonical',
         source_environment='sandbox',last_snapshot_at='2026-09-02T01:15:00Z',
         last_operation_id='auth:00000000-0000-0000-0000-000000000002',
         last_reconciled_at=clock_timestamp(),reconcile_reason='scheduled',
         reconcile_after='2099-01-01T00:00:00Z',updated_at='2026-09-02T01:15:01Z'
       WHERE user_id=$1`,
      [active],
    );
    const noOpEvent = `auth_noop_${suffix}`;
    await insertEvent(scopedPool, {
      eventId: noOpEvent,
      eventAt: "2026-09-01T01:15:00Z",
      receivedAt: "2026-09-01T01:15:01Z",
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: true,
      nextAttemptAt: "2099-01-01T00:00:00Z",
      retentionUntil: "2099-02-01T00:00:00Z",
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES ($1,$2,1,$3)`,
      [noOpEvent, hash, active],
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_aliases
       SET alias_kind='ordinary',ownership_source='webhook',
           source_event_at='2026-09-01T01:15:00Z',
           source_event_id=$2,authenticated_at=NULL,
           updated_at='2026-09-02T01:15:02Z'
       WHERE alias_hash=$1`,
      [hash, `auth_same_owner_provenance_${suffix}`],
    );
    const transitionBefore = (
      await scopedPool.query(
        `SELECT state.reconcile_after AS state_reconcile_after,
                state.updated_at AS state_updated_at,
                alias.updated_at AS alias_updated_at,
                event.next_attempt_at AS event_next_attempt_at,
                subject.local_user_id,subject.xmin::text AS subject_xmin
         FROM revenuecat_customer_state AS state
         JOIN revenuecat_customer_aliases AS alias
           ON alias.alias_hash=$3 AND alias.local_user_id=state.user_id
         JOIN revenuecat_webhook_events AS event ON event.event_id=$2
         JOIN revenuecat_event_subjects AS subject
           ON subject.event_id=event.event_id AND subject.subject_hash=$3
         WHERE state.user_id=$1`,
        [active, noOpEvent, hash],
      )
    ).rows[0];
    assert.equal(
      transitionBefore.state_reconcile_after.toISOString(),
      "2099-01-01T00:00:00.000Z",
    );
    assert.equal(
      transitionBefore.event_next_attempt_at.toISOString(),
      "2099-01-01T00:00:00.000Z",
    );
    assert.equal(
      await provisionAuthenticatedUserIfActive(
        activeUser,
        createRevenueCatAuthProvisioningCallback(activeUser, processorConfig),
      ),
      "active",
    );
    const afterTransition = (
      await scopedPool.query(
        `SELECT state.reconcile_reason,
                state.reconcile_after<=clock_timestamp() AS state_due,
                state.updated_at AS state_updated_at,
                alias.alias_kind,alias.ownership_source,
                alias.source_event_at,alias.source_event_id,
                alias.updated_at AS alias_updated_at,
                event.next_attempt_at<=clock_timestamp() AS event_due,
                event.next_attempt_at AS event_next_attempt_at,
                subject.local_user_id,subject.xmin::text AS subject_xmin
         FROM revenuecat_customer_state AS state
         JOIN revenuecat_customer_aliases AS alias
           ON alias.alias_hash=$3 AND alias.local_user_id=state.user_id
         JOIN revenuecat_webhook_events AS event ON event.event_id=$2
         JOIN revenuecat_event_subjects AS subject
           ON subject.event_id=event.event_id AND subject.subject_hash=$3
         WHERE state.user_id=$1`,
        [active, noOpEvent, hash],
      )
    ).rows[0];
    assert.deepEqual(
      {
        reconcile_reason: afterTransition.reconcile_reason,
        state_due: afterTransition.state_due,
        alias_kind: afterTransition.alias_kind,
        ownership_source: afterTransition.ownership_source,
        source_event_at: afterTransition.source_event_at,
        source_event_id: afterTransition.source_event_id,
        event_due: afterTransition.event_due,
        local_user_id: afterTransition.local_user_id,
        subject_xmin: afterTransition.subject_xmin,
      },
      {
        reconcile_reason: "authenticated",
        state_due: true,
        alias_kind: "authenticated",
        ownership_source: "authenticated",
        source_event_at: null,
        source_event_id: null,
        event_due: true,
        local_user_id: active,
        subject_xmin: transitionBefore.subject_xmin,
      },
    );
    assert.notEqual(
      afterTransition.state_updated_at.getTime(),
      transitionBefore.state_updated_at.getTime(),
    );
    assert.notEqual(
      afterTransition.alias_updated_at.getTime(),
      transitionBefore.alias_updated_at.getTime(),
    );

    assert.equal(
      await provisionAuthenticatedUserIfActive(
        activeUser,
        createRevenueCatAuthProvisioningCallback(activeUser, processorConfig),
      ),
      "active",
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT state.reconcile_reason,
                  state.reconcile_after<=clock_timestamp() AS state_due,
                  state.updated_at AS state_updated_at,
                  alias.alias_kind,alias.ownership_source,
                  alias.source_event_at,alias.source_event_id,
                  alias.updated_at AS alias_updated_at,
                  event.next_attempt_at<=clock_timestamp() AS event_due,
                  event.next_attempt_at AS event_next_attempt_at,
                  subject.local_user_id,subject.xmin::text AS subject_xmin
           FROM revenuecat_customer_state AS state
           JOIN revenuecat_customer_aliases AS alias
             ON alias.alias_hash=$3 AND alias.local_user_id=state.user_id
           JOIN revenuecat_webhook_events AS event ON event.event_id=$2
           JOIN revenuecat_event_subjects AS subject
             ON subject.event_id=event.event_id AND subject.subject_hash=$3
           WHERE state.user_id=$1`,
          [active, noOpEvent, hash],
        )
      ).rows[0],
      afterTransition,
    );

    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [deleted]);
    await tombstoneAndDeleteAccountData(deleted, `delete-auth-${suffix}`);
    const deletedUser = { ...activeUser, id: deleted };
    assert.equal(
      await provisionAuthenticatedUserIfActive(
        deletedUser,
        createRevenueCatAuthProvisioningCallback(deletedUser, processorConfig),
      ),
      "deleted",
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT
             (SELECT count(*)::integer FROM users WHERE id=$1) AS users,
             (SELECT count(*)::integer FROM revenuecat_customer_state WHERE user_id=$1) AS states,
             (SELECT count(*)::integer FROM revenuecat_customer_aliases WHERE alias_hash=$2) AS aliases`,
          [deleted, subjectHash(deleted)],
        )
      ).rows[0],
      { users: 0, states: 0, aliases: 0 },
    );
  },
);

integrationTest(
  "exact authenticated aliases repair missing and legacy state once without churning healthy or due rows",
  async () => {
    const suffix = Date.now();
    const missing = `auth-repair-missing-${suffix}`;
    const legacy = `auth-repair-legacy-${suffix}`;
    const healthy = `auth-repair-healthy-${suffix}`;
    const due = `auth-repair-due-${suffix}`;
    const users = [missing, legacy, healthy, due];
    const hashes = users.map(subjectHash);
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,authenticated_at)
       SELECT seeded.alias_hash,live_user.id,'authenticated','authenticated',
              live_user.created_at
       FROM unnest($1::text[],$2::text[]) AS seeded(user_id,alias_hash)
       JOIN users AS live_user ON live_user.id=seeded.user_id`,
      [users, hashes],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,
        reconcile_after,updated_at)
       VALUES ($1,'legacy_unverified','legacy_unverified','legacy_bootstrap',
               '2099-01-01T00:00:00Z','2026-09-02T02:00:00Z')`,
      [legacy],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,source_environment,
        last_snapshot_at,last_operation_id,last_reconciled_at,
        reconcile_reason,reconcile_after,updated_at)
       VALUES ($1,'canonical','auth_canonical','sandbox',
               '2026-09-02T01:59:00Z',
               'auth:00000000-0000-0000-0000-000000000004',
               '2026-09-02T01:59:01Z','scheduled',
               '2099-01-01T00:00:00Z','2026-09-02T02:00:01Z')`,
      [healthy],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,
        reconcile_after,updated_at)
       VALUES ($1,'pending','none','authenticated',
               '2026-09-01T00:00:00Z','2026-09-02T02:00:02Z')`,
      [due],
    );

    async function state(userId) {
      return (
        await scopedPool.query(
          `SELECT canonicalization_state,source_kind,source_environment,
                  last_snapshot_at,last_operation_id,last_reconciled_at,
                  reconcile_reason,reconcile_after,
                  reconcile_attempt_count,reconcile_lease_id,
                  reconcile_lease_until,reconcile_last_error_code,
                  created_at,updated_at
           FROM revenuecat_customer_state WHERE user_id=$1`,
          [userId],
        )
      ).rows[0];
    }
    async function authenticate(userId) {
      const user = {
        id: userId,
        email: null,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      };
      assert.equal(
        await provisionAuthenticatedUserIfActive(
          user,
          createRevenueCatAuthProvisioningCallback(user, processorConfig),
        ),
        "active",
      );
    }

    assert.equal(await state(missing), undefined);
    const legacyBefore = await state(legacy);
    const healthyBefore = await state(healthy);
    const dueBefore = await state(due);
    for (const userId of users) await authenticate(userId);

    const missingAfterRepair = await state(missing);
    const legacyAfterRepair = await state(legacy);
    assert.deepEqual(
      {
        canonicalization_state: missingAfterRepair.canonicalization_state,
        source_kind: missingAfterRepair.source_kind,
        reconcile_reason: missingAfterRepair.reconcile_reason,
        due: missingAfterRepair.reconcile_after.getTime() <= Date.now(),
      },
      {
        canonicalization_state: "pending",
        source_kind: "none",
        reconcile_reason: "authenticated",
        due: true,
      },
    );
    assert.deepEqual(
      {
        canonicalization_state: legacyAfterRepair.canonicalization_state,
        source_kind: legacyAfterRepair.source_kind,
        source_environment: legacyAfterRepair.source_environment,
        last_snapshot_at: legacyAfterRepair.last_snapshot_at,
        last_operation_id: legacyAfterRepair.last_operation_id,
        last_reconciled_at: legacyAfterRepair.last_reconciled_at,
        reconcile_reason: legacyAfterRepair.reconcile_reason,
        due: legacyAfterRepair.reconcile_after.getTime() <= Date.now(),
      },
      {
        canonicalization_state: "pending",
        source_kind: "none",
        source_environment: null,
        last_snapshot_at: null,
        last_operation_id: null,
        last_reconciled_at: null,
        reconcile_reason: "authenticated",
        due: true,
      },
    );
    assert.notEqual(
      legacyAfterRepair.updated_at.getTime(),
      legacyBefore.updated_at.getTime(),
    );
    assert.deepEqual(await state(healthy), healthyBefore);
    assert.deepEqual(await state(due), dueBefore);

    const afterFirstRequest = new Map(
      await Promise.all(
        users.map(async (userId) => [userId, await state(userId)]),
      ),
    );
    for (const userId of users) await authenticate(userId);
    for (const userId of users) {
      assert.deepEqual(await state(userId), afterFirstRequest.get(userId));
    }

    const calls = [];
    await reconcileTrustedUserOnDemand({
      userId: missing,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T02:01:00Z", { pro: true }),
        },
        calls,
      ),
    });
    assert.deepEqual(calls, [missing]);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT canonicalization_state,source_kind,
                  reconcile_after>clock_timestamp() AS scheduled
           FROM revenuecat_customer_state WHERE user_id=$1`,
          [missing],
        )
      ).rows[0],
      {
        canonicalization_state: "canonical",
        source_kind: "auth_canonical",
        scheduled: true,
      },
    );
  },
);

integrationTest(
  "authenticated provisioning expands over a concurrently rebound displaced owner",
  async () => {
    const suffix = Date.now();
    const authenticated = `auth-expansion-${suffix}`;
    const firstOwner = `auth-expansion-first-${suffix}`;
    const secondOwner = `auth-expansion-second-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [firstOwner, secondOwner],
    ]);
    const user = {
      id: authenticated,
      email: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
    };
    const hash = subjectHash(authenticated);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z',$3)`,
      [hash, firstOwner, `auth_expand_${suffix}`],
    );
    const realCallback = createRevenueCatAuthProvisioningCallback(
      user,
      processorConfig,
    );
    let discoveries = 0;
    let rebound = false;
    const expandingCallback = {
      async discoverAdditionalOwners(transaction) {
        discoveries += 1;
        const discovered =
          await realCallback.discoverAdditionalOwners(transaction);
        if (!rebound) {
          rebound = true;
          await scopedPool.query(
            `UPDATE revenuecat_customer_aliases SET local_user_id=$2
             WHERE alias_hash=$1`,
            [hash, secondOwner],
          );
        }
        return discovered;
      },
      afterProvision: realCallback.afterProvision,
    };
    assert.equal(
      await provisionAuthenticatedUserIfActive(user, expandingCallback),
      "active",
    );
    assert.equal(discoveries, 3);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT local_user_id,ownership_source FROM revenuecat_customer_aliases
           WHERE alias_hash=$1`,
          [hash],
        )
      ).rows[0],
      { local_user_id: authenticated, ownership_source: "authenticated" },
    );
    const queued = await scopedPool.query(
      `SELECT user_id,reconcile_reason FROM revenuecat_customer_state
       WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
      [[authenticated, secondOwner]],
    );
    assert.deepEqual(
      new Set(
        queued.rows.map((row) => `${row.user_id}:${row.reconcile_reason}`),
      ),
      new Set([
        `${authenticated}:authenticated`,
        `${secondOwner}:authenticated`,
      ]),
    );
  },
);

integrationTest(
  "verified deletion fallback only authorizes tombstone finalization and never provisions RevenueCat state",
  async () => {
    const suffix = Date.now();
    const userId = `auth-fallback-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await tombstoneAndDeleteAccountData(userId, `fallback-${suffix}`);
    const verification = {
      user: {
        id: userId,
        email: null,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
      },
      deletionFallback: true,
    };
    const response = () => ({
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    });
    let nextCalls = 0;
    const ordinaryRequest = {
      method: "GET",
      path: "/api/entitlement",
      log: { error() {} },
    };
    const ordinaryResponse = response();
    await applyVerifiedFirebaseAuth(
      ordinaryRequest,
      ordinaryResponse,
      () => {
        nextCalls += 1;
      },
      verification,
    );
    assert.equal(ordinaryResponse.statusCode, 410);
    assert.equal(ordinaryResponse.body.code, "deleted_account");
    assert.equal(nextCalls, 0);
    assert.equal(ordinaryRequest.user, undefined);

    const deletionRequest = {
      method: "GET",
      path: "/api/account/deletion-status",
      log: { error() {} },
    };
    await applyVerifiedFirebaseAuth(
      deletionRequest,
      response(),
      () => {
        nextCalls += 1;
      },
      verification,
    );
    assert.equal(nextCalls, 1);
    assert.equal(deletionRequest.user.id, userId);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT
             (SELECT count(*)::integer FROM users WHERE id=$1) AS users,
             (SELECT count(*)::integer FROM revenuecat_customer_state WHERE user_id=$1) AS states,
             (SELECT count(*)::integer FROM revenuecat_customer_aliases WHERE local_user_id=$1) AS aliases`,
          [userId],
        )
      ).rows[0],
      { users: 0, states: 0, aliases: 0 },
    );
  },
);

integrationTest(
  "trusted UID claims are fenced, 201 is non-applying, and a later 200 schedules six hours",
  async () => {
    const suffix = Date.now();
    const userId = `trusted-worker-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,source_environment,last_snapshot_at,
        last_operation_id,last_reconciled_at,reconcile_reason,reconcile_after)
       VALUES ($1,'canonical','worker_canonical','sandbox','2026-09-01T00:00:00Z',
               'worker:seed_12345678','2026-09-01T00:00:01Z','scheduled','2000-01-01T00:00:00Z')`,
      [userId],
    );
    await scopedPool.query(
      `INSERT INTO subscription_entitlements
       (user_id,entitlement_id,active,status,product_id,store,access_ends_at,will_renew,
        source_environment,source_kind,source_snapshot_at,source_operation_id)
       VALUES ($1,'elovia_pro',true,'active','pro_monthly','test_store',
               '2026-10-01T00:00:00Z',true,'sandbox','worker_canonical',
               '2026-09-01T00:00:00Z','worker:seed_12345678')`,
      [userId],
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after='2099-01-01T00:00:00Z'
       WHERE user_id<>$1`,
      [userId],
    );
    const empty = snapshot("2026-09-02T00:00:00Z", {
      pro: false,
      coaching: false,
    });
    await runTrustedUserBatch({
      config: processorConfig,
      client: fakeClient({ lookup: "created", snapshot: empty }, []),
      limit: 1,
    });
    assert.equal(
      (
        await scopedPool.query(
          `SELECT active FROM subscription_entitlements
           WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
          [userId],
        )
      ).rows[0].active,
      true,
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_state SET reconcile_after='2000-01-01T00:00:00Z'
       WHERE user_id=$1`,
      [userId],
    );
    await runTrustedUserBatch({
      config: processorConfig,
      client: fakeClient({ lookup: "existing", snapshot: empty }, []),
      limit: 1,
    });
    const state = await scopedPool.query(
      `SELECT canonicalization_state,reconcile_attempt_count,reconcile_lease_id,
              reconcile_last_error_code,last_operation_id,
              reconcile_after > clock_timestamp() + interval '5 hours 50 minutes' AS six_hours
       FROM revenuecat_customer_state WHERE user_id=$1`,
      [userId],
    );
    assert.equal(state.rows[0].canonicalization_state, "canonical");
    assert.equal(state.rows[0].reconcile_attempt_count, 0);
    assert.equal(state.rows[0].reconcile_lease_id, null);
    assert.equal(state.rows[0].reconcile_last_error_code, null);
    assert.match(state.rows[0].last_operation_id, /^worker:/);
    assert.equal(state.rows[0].six_hours, true);
    assert.equal(
      (
        await scopedPool.query(
          `SELECT active FROM subscription_entitlements
           WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
          [userId],
        )
      ).rows[0].active,
      false,
    );
  },
);

integrationTest(
  "customer workers claim one slow item per replica, fence expired claims, and back off exponentially",
  async () => {
    const suffix = Date.now();
    const slow = `customer-a-slow-${suffix}`;
    const peer = `customer-b-peer-${suffix}`;
    const fenced = `customer-c-fenced-${suffix}`;
    const retrying = `customer-d-retry-${suffix}`;
    const users = [slow, peer, fenced, retrying];
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after,
        reconcile_attempt_count)
       SELECT user_id,'pending','none','scheduled','2000-01-01T00:00:00Z',attempts
       FROM unnest($1::text[],$2::integer[]) AS seeded(user_id,attempts)`,
      [users, [0, 0, 0, 3]],
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after='2099-01-01T00:00:00Z'
       WHERE user_id NOT IN ($1,$2)`,
      [slow, peer],
    );
    let releaseSlow;
    let slowStartedResolve;
    const slowStarted = new Promise((resolve) => {
      slowStartedResolve = resolve;
    });
    const slowGate = new Promise((resolve) => {
      releaseSlow = resolve;
    });
    const calls = [];
    const firstReplica = runTrustedUserBatch({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(`first:${uid}`);
          slowStartedResolve();
          await slowGate;
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T01:20:00Z", { pro: true }),
          };
        },
      },
      limit: 2,
    });
    await slowStarted;
    const secondReplica = await runTrustedUserBatch({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(`second:${uid}`);
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T01:21:00Z", { pro: true }),
          };
        },
      },
      limit: 1,
    });
    assert.deepEqual(secondReplica, { claimed: 1, succeeded: 1, retried: 0 });
    assert.deepEqual(calls, [`first:${slow}`, `second:${peer}`]);
    releaseSlow();
    assert.deepEqual(await firstReplica, {
      claimed: 1,
      succeeded: 1,
      retried: 0,
    });

    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after=CASE WHEN user_id=$1
         THEN '2000-01-01T00:00:00Z'::timestamptz
         ELSE '2099-01-01T00:00:00Z'::timestamptz END
       WHERE user_id=ANY($2::text[])`,
      [fenced, users],
    );
    const oldClaim = (await claimDueTrustedUsers(1))[0];
    assert.equal(oldClaim.userId, fenced);
    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_lease_until=clock_timestamp() - interval '1 second'
       WHERE user_id=$1`,
      [fenced],
    );
    const currentClaim = (await claimDueTrustedUsers(1))[0];
    assert.equal(currentClaim.userId, fenced);
    const fenceCalls = [];
    const oldResult = await reconcileTrustedUser({
      userId: fenced,
      reason: "scheduled",
      operationId: `worker:${oldClaim.leaseId}`,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T03:00:00Z", { pro: true }),
        },
        fenceCalls,
      ),
      fence: { leaseId: oldClaim.leaseId, customerState: true },
    });
    assert.deepEqual(oldResult, { outcome: "fenced_out" });
    const currentResult = await reconcileTrustedUser({
      userId: fenced,
      reason: "scheduled",
      operationId: `worker:${currentClaim.leaseId}`,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T02:00:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        fenceCalls,
      ),
      fence: { leaseId: currentClaim.leaseId, customerState: true },
    });
    assert.deepEqual(currentResult, { outcome: "applied" });
    assert.deepEqual(fenceCalls, [fenced, fenced]);
    assert.equal(
      (
        await scopedPool.query(
          `SELECT active FROM subscription_entitlements
           WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
          [fenced],
        )
      ).rows[0].active,
      false,
    );

    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after=CASE WHEN user_id=$1
         THEN '2000-01-01T00:00:00Z'::timestamptz
         ELSE '2099-01-01T00:00:00Z'::timestamptz END,
           reconcile_lease_id=NULL,reconcile_lease_until=NULL
       WHERE user_id=ANY($2::text[])`,
      [retrying, users],
    );
    const retryMetrics = [];
    await runTrustedUserBatch({
      config: processorConfig,
      client: {
        async getSubscriber() {
          throw Object.assign(new Error("do not persist this"), {
            code: "revenuecat_timeout",
          });
        },
      },
      limit: 1,
      metric: (metric) => retryMetrics.push(metric),
    });
    const retryState = await scopedPool.query(
      `SELECT reconcile_attempt_count,reconcile_last_error_code,
              reconcile_after >= clock_timestamp() + interval '7 minutes' AS backed_off,
              reconcile_lease_id
       FROM revenuecat_customer_state WHERE user_id=$1`,
      [retrying],
    );
    assert.deepEqual(retryState.rows[0], {
      reconcile_attempt_count: 4,
      reconcile_last_error_code: "revenuecat_timeout",
      backed_off: true,
      reconcile_lease_id: null,
    });
    assert.deepEqual(retryMetrics, [
      {
        type: "customer_reconcile_failure",
        errorCode: "revenuecat_timeout",
        count: 1,
      },
    ]);
  },
);

integrationTest(
  "webhook, bootstrap, and worker observations preserve the greatest canonical tuple",
  async () => {
    const suffix = Date.now();
    const userId = `canonical-order-${suffix}`;
    const eventId = `ordering_${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await insertEvent(scopedPool, {
      eventId,
      disposition: "pending",
      nextAttemptAt: "2099-01-01T00:00:00Z",
      retentionUntil: "2099-02-01T00:00:00Z",
    });
    await db.transaction((transaction) =>
      applyTrustedSnapshot(transaction, {
        userId,
        snapshot: snapshot("2026-09-02T02:30:00Z", { pro: true }),
        config: processorConfig,
        operationId: `webhook:${eventId}`,
      }),
    );
    const bootstrapResult = await reconcileTrustedUser({
      userId,
      reason: "legacy_bootstrap",
      operationId: "bootstrap:00000000-0000-0000-0000-000000000004",
      allowCreatedEmpty: true,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T02:29:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        [],
      ),
    });
    assert.deepEqual(bootstrapResult, { outcome: "stale" });
    assert.equal(
      (
        await scopedPool.query(
          `SELECT active FROM subscription_entitlements
           WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
          [userId],
        )
      ).rows[0].active,
      true,
    );

    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after='2000-01-01T00:00:00Z'
       WHERE user_id=$1`,
      [userId],
    );
    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after='2099-01-01T00:00:00Z'
       WHERE user_id<>$1`,
      [userId],
    );
    await runTrustedUserBatch({
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T02:30:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        [],
      ),
      limit: 1,
    });
    const final = await scopedPool.query(
      `SELECT entitlement.active,state.last_operation_id
       FROM subscription_entitlements AS entitlement
       JOIN revenuecat_customer_state AS state ON state.user_id=entitlement.user_id
       WHERE entitlement.user_id=$1 AND entitlement.entitlement_id='elovia_pro'`,
      [userId],
    );
    assert.equal(final.rows[0].active, false);
    assert.match(final.rows[0].last_operation_id, /^worker:/);
  },
);

integrationTest(
  "on-demand reconciliation is due-only, fail-closed, and deletion wins after fetch",
  async () => {
    const suffix = Date.now();
    const due = `on-demand-due-${suffix}`;
    const notDue = `on-demand-future-${suffix}`;
    const failing = `on-demand-failing-${suffix}`;
    const deleted = `on-demand-deleted-${suffix}`;
    const users = [due, notDue, failing, deleted];
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after)
       SELECT user_id,'pending','none','scheduled',reconcile_after
       FROM unnest($1::text[],$2::timestamptz[]) AS seeded(user_id,reconcile_after)`,
      [
        users,
        [
          "2000-01-01T00:00:00Z",
          "2099-01-01T00:00:00Z",
          "2000-01-01T00:00:00Z",
          "2000-01-01T00:00:00Z",
        ],
      ],
    );
    const calls = [];
    await reconcileTrustedUserOnDemand({
      userId: due,
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T01:00:00Z", { pro: true }),
        },
        calls,
      ),
    });
    await reconcileTrustedUserOnDemand({
      userId: notDue,
      config: processorConfig,
      client: fakeClient(null, calls),
    });
    await reconcileTrustedUserOnDemand({
      userId: failing,
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(uid);
          throw Object.assign(new Error("provider payload must not persist"), {
            code: "secret_provider_failure",
          });
        },
      },
    });
    await reconcileTrustedUserOnDemand({
      userId: deleted,
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(uid);
          await scopedPool.query("DELETE FROM users WHERE id=$1", [uid]);
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T01:01:00Z", { pro: true }),
          };
        },
      },
    });
    assert.deepEqual(calls, [due, failing, deleted]);
    const states = await scopedPool.query(
      `SELECT user_id,canonicalization_state,reconcile_last_error_code,
              reconcile_lease_id,reconcile_after > clock_timestamp() AS scheduled
       FROM revenuecat_customer_state WHERE user_id=ANY($1::text[])
       ORDER BY user_id`,
      [[due, notDue, failing, deleted]],
    );
    const byUser = new Map(states.rows.map((row) => [row.user_id, row]));
    assert.equal(byUser.get(due).canonicalization_state, "canonical");
    assert.equal(byUser.get(notDue).canonicalization_state, "pending");
    assert.equal(
      byUser.get(failing).reconcile_last_error_code,
      "revenuecat_worker_failure",
    );
    assert.equal(byUser.get(failing).reconcile_lease_id, null);
    assert.equal(byUser.get(failing).scheduled, true);
    assert.equal(byUser.has(deleted), false);
  },
);

integrationTest(
  "only bootstrap accepts an empty first 201 and every nonempty 201 is invalid",
  async () => {
    const suffix = Date.now();
    const reasons = [
      "authenticated",
      "on_demand",
      "scheduled",
      "webhook_failure",
    ];
    const users = reasons.map((reason) => `created-${reason}-${suffix}`);
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    const emptyCreated = {
      lookup: "created",
      snapshot: snapshot("2026-09-02T01:10:00Z", {
        pro: false,
        coaching: false,
      }),
    };
    for (const [index, reason] of reasons.entries()) {
      const result = await reconcileTrustedUser({
        userId: users[index],
        reason,
        operationId:
          reason === "scheduled"
            ? `worker:created-${suffix}`
            : `auth:created-${suffix}-${index}`,
        config: processorConfig,
        client: fakeClient(emptyCreated, []),
      });
      assert.deepEqual(result, { outcome: "visibility_lag" });
    }
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM subscription_entitlements
           WHERE user_id=ANY($1::text[])`,
          [users],
        )
      ).rows[0].count,
      0,
    );
    await assert.rejects(
      () =>
        reconcileTrustedUser({
          userId: users[0],
          reason: "legacy_bootstrap",
          operationId: `bootstrap:invalid-${suffix}`,
          allowCreatedEmpty: true,
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "created",
              snapshot: snapshot("2026-09-02T01:11:00Z", { pro: true }),
            },
            [],
          ),
        }),
      (error) => error?.code === "canonical_response_invalid",
    );
  },
);

integrationTest(
  "rawless worker rejects ordinary, redemption, and either transfer-side ambiguity before provider IO",
  async () => {
    const suffix = Date.now();
    const users = [
      `ambiguity-a-${suffix}`,
      `ambiguity-b-${suffix}`,
      `ambiguity-c-${suffix}`,
    ];
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    const cases = [
      {
        eventId: `ambiguous_ordinary_${suffix}`,
        type: "INITIAL_PURCHASE",
        subjects: [
          { hash: "1".repeat(63) + "a", roleMask: 1, localUserId: users[0] },
          { hash: "1".repeat(63) + "b", roleMask: 1, localUserId: users[1] },
        ],
      },
      {
        eventId: `ambiguous_redemption_${suffix}`,
        type: "PURCHASE_REDEEMED",
        subjects: [
          { hash: "2".repeat(63) + "a", roleMask: 64, localUserId: users[0] },
          { hash: "2".repeat(63) + "b", roleMask: 64, localUserId: users[1] },
        ],
      },
      {
        eventId: `ambiguous_transfer_source_${suffix}`,
        type: "TRANSFER",
        subjects: [
          { hash: "3".repeat(63) + "a", roleMask: 8, localUserId: users[0] },
          { hash: "3".repeat(63) + "b", roleMask: 8, localUserId: users[1] },
          { hash: "3".repeat(63) + "c", roleMask: 16, localUserId: users[2] },
        ],
      },
      {
        eventId: `ambiguous_transfer_destination_${suffix}`,
        type: "TRANSFER",
        subjects: [
          { hash: "4".repeat(63) + "a", roleMask: 8, localUserId: users[0] },
          { hash: "4".repeat(63) + "b", roleMask: 16, localUserId: users[1] },
          { hash: "4".repeat(63) + "c", roleMask: 16, localUserId: users[2] },
        ],
      },
    ];
    for (const testCase of cases) {
      await insertRawlessEvent(testCase);
      const calls = [];
      const metrics = [];
      await runPendingEventBatch({
        config: processorConfig,
        client: fakeClient(null, calls),
        limit: 1,
        metric: (metric) => metrics.push(metric),
      });
      assert.deepEqual(calls, []);
      assert.equal(
        metrics.some(
          (metric) =>
            metric.type === "event_recovery_failure" &&
            metric.errorCode === "identity_conflict" &&
            metric.count === 1,
        ),
        true,
      );
      const state = await scopedPool.query(
        `SELECT disposition,identity_applied_at,entitlement_applied_at,
                processing_lease_id
         FROM revenuecat_webhook_events
         WHERE event_id=$1`,
        [testCase.eventId],
      );
      assert.equal(state.rows[0].disposition, "pending");
      assert.equal(state.rows[0].identity_applied_at, null);
      assert.equal(state.rows[0].entitlement_applied_at, null);
      assert.equal(state.rows[0].processing_lease_id, null);
    }
  },
);

integrationTest(
  "rawless PURCHASE_REDEEMED worker honors alias, redeemer_owns, and transfer modes without fetching or revoking the source",
  async () => {
    const suffix = Date.now();
    for (const [index, redemptionOutcome] of [
      "alias",
      "redeemer_owns",
      "transfer",
    ].entries()) {
      const redeemer = `rawless-redeemer-${index}-${suffix}`;
      const source = `rawless-redemption-source-${index}-${suffix}`;
      const eventId = `rawless_redeemed_${index}_${suffix}`;
      const directHash = subjectHash(redeemer);
      const redeemerAliasHash = subjectHash(
        `rawless-redeemer-alias-${index}-${suffix}`,
      );
      const sourceHash = subjectHash(
        `rawless-redeemed-from-${index}-${suffix}`,
      );
      await scopedPool.query(
        "INSERT INTO users (id) SELECT unnest($1::text[])",
        [[redeemer, source]],
      );
      await scopedPool.query(
        `INSERT INTO revenuecat_customer_state
         (user_id,canonicalization_state,source_kind,source_environment,
          last_snapshot_at,last_operation_id,last_reconciled_at,
          reconcile_reason,reconcile_after)
         VALUES ($1,'canonical','worker_canonical','sandbox',
                 '2026-08-01T00:00:00Z',$2,'2026-08-01T00:00:01Z',
                 'scheduled','2099-01-01T00:00:00Z')`,
        [source, `worker:redemption-source-${index}`],
      );
      await scopedPool.query(
        `INSERT INTO subscription_entitlements
         (user_id,entitlement_id,active,status,product_id,store,access_ends_at,
          will_renew,source_environment,source_kind,source_snapshot_at,
          source_operation_id)
         VALUES ($1,'elovia_pro',true,'active','pro_monthly','test_store',
                 '2099-01-01T00:00:00Z',true,'sandbox','worker_canonical',
                 '2026-08-01T00:00:00Z',$2)`,
        [source, `worker:redemption-source-${index}`],
      );
      await insertRawlessEvent({
        eventId,
        type: "PURCHASE_REDEEMED",
        metadata: { schemaVersion: 1, identityCount: 3, redemptionOutcome },
        subjects: [
          { hash: directHash, roleMask: 64, localUserId: redeemer },
          { hash: redeemerAliasHash, roleMask: 64, localUserId: null },
          { hash: sourceHash, roleMask: 32, localUserId: source },
        ],
      });
      const calls = [];
      await runPendingEventBatch({
        config: processorConfig,
        client: fakeClient(
          {
            lookup: "existing",
            snapshot: snapshot(`2026-09-02T03:0${index}:00Z`, {
              pro: true,
            }),
          },
          calls,
        ),
        limit: 1,
      });
      assert.deepEqual(calls, [redeemer]);
      assert.deepEqual(
        (
          await scopedPool.query(
            `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
                    entitlement_applied_at IS NOT NULL AS entitlement_done
             FROM revenuecat_webhook_events WHERE event_id=$1`,
            [eventId],
          )
        ).rows[0],
        { disposition: "applied", identity_done: true, entitlement_done: true },
      );
      const links = await scopedPool.query(
        `SELECT subject_hash,local_user_id FROM revenuecat_event_subjects
         WHERE event_id=$1 ORDER BY subject_hash`,
        [eventId],
      );
      assert.deepEqual(
        new Map(links.rows.map((row) => [row.subject_hash, row.local_user_id])),
        new Map([
          [directHash, redeemer],
          [redeemerAliasHash, redeemer],
          [sourceHash, source],
        ]),
      );
      const alias = await scopedPool.query(
        `SELECT local_user_id,alias_kind,ownership_source
         FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
        [redeemerAliasHash],
      );
      if (redemptionOutcome === "transfer") {
        assert.equal(alias.rowCount, 0);
      } else {
        assert.deepEqual(alias.rows[0], {
          local_user_id: redeemer,
          alias_kind: "ordinary",
          ownership_source: "webhook",
        });
      }
      assert.deepEqual(
        (
          await scopedPool.query(
            `SELECT active,source_operation_id FROM subscription_entitlements
             WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
            [redeemer],
          )
        ).rows[0],
        {
          active: true,
          source_operation_id: `webhook:${eventId}`,
        },
      );
      assert.deepEqual(
        (
          await scopedPool.query(
            `SELECT active,source_operation_id FROM subscription_entitlements
             WHERE user_id=$1 AND entitlement_id='elovia_pro'`,
            [source],
          )
        ).rows[0],
        {
          active: true,
          source_operation_id: `worker:redemption-source-${index}`,
        },
      );
      assert.equal(
        (
          await scopedPool.query(
            `SELECT count(*)::integer AS count
             FROM revenuecat_customer_aliases WHERE alias_hash=$1`,
            [sourceHash],
          )
        ).rows[0].count,
        0,
      );
    }
  },
);

integrationTest(
  "rawless transfer recovery supports source-only, destination-only, and overlap while source-live and 201 remain pending",
  async () => {
    const suffix = Date.now();
    const source = `one-sided-source-${suffix}`;
    const destination = `one-sided-destination-${suffix}`;
    const overlap = `one-sided-overlap-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [source, destination, overlap],
    ]);
    const cases = [
      {
        eventId: `transfer_source_only_${suffix}`,
        subjects: [
          { hash: "5".repeat(63) + "a", roleMask: 8, localUserId: source },
        ],
        lookup: {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:00:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        terminal: true,
      },
      {
        eventId: `transfer_destination_only_${suffix}`,
        subjects: [
          {
            hash: "6".repeat(63) + "a",
            roleMask: 16,
            localUserId: destination,
          },
        ],
        lookup: {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:01:00Z", { pro: true }),
        },
        terminal: true,
      },
      {
        eventId: `transfer_overlap_${suffix}`,
        subjects: [
          { hash: "7".repeat(63) + "a", roleMask: 24, localUserId: overlap },
        ],
        lookup: {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:02:00Z", { pro: true }),
        },
        terminal: true,
      },
      {
        eventId: `transfer_source_live_${suffix}`,
        subjects: [
          { hash: "8".repeat(63) + "a", roleMask: 8, localUserId: source },
        ],
        lookup: {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:03:00Z", { pro: true }),
        },
        terminal: false,
      },
      {
        eventId: `transfer_created_${suffix}`,
        subjects: [
          {
            hash: "9".repeat(63) + "a",
            roleMask: 16,
            localUserId: destination,
          },
        ],
        lookup: {
          lookup: "created",
          snapshot: snapshot("2026-09-02T00:04:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        terminal: false,
      },
    ];
    for (const testCase of cases) {
      await insertRawlessEvent({
        eventId: testCase.eventId,
        type: "TRANSFER",
        subjects: testCase.subjects,
      });
      const calls = [];
      await runPendingEventBatch({
        config: processorConfig,
        client: fakeClient(testCase.lookup, calls),
        limit: 1,
      });
      assert.equal(calls.length, 1);
      const state = await scopedPool.query(
        `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
                entitlement_applied_at IS NOT NULL AS entitlement_done
         FROM revenuecat_webhook_events WHERE event_id=$1`,
        [testCase.eventId],
      );
      assert.equal(state.rows[0].disposition !== "pending", testCase.terminal);
      assert.equal(state.rows[0].identity_done, testCase.terminal);
      assert.equal(state.rows[0].entitlement_done, testCase.terminal);
    }
    const sourceOnlyAliases = await scopedPool.query(
      `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
       WHERE alias_hash=$1`,
      ["5".repeat(63) + "a"],
    );
    assert.equal(sourceOnlyAliases.rows[0].count, 0);
  },
);

integrationTest(
  "rawless mixed transfer links an unresolved source to its destination while newer authority still wins",
  async () => {
    const suffix = Date.now();
    const destination = `mixed-transfer-destination-${suffix}`;
    const futureOwner = `mixed-transfer-future-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [destination, futureOwner],
    ]);

    const unresolvedEvent = `mixed_transfer_unresolved_${suffix}`;
    const unresolvedSourceHash = subjectHash(
      `mixed-transfer-unresolved-source-${suffix}`,
    );
    const destinationHash = subjectHash(destination);
    await insertRawlessEvent({
      eventId: unresolvedEvent,
      type: "TRANSFER",
      subjects: [
        { hash: unresolvedSourceHash, roleMask: 8, localUserId: null },
        { hash: destinationHash, roleMask: 16, localUserId: destination },
      ],
    });
    const unresolvedCalls = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:05:00Z", { pro: true }),
        },
        unresolvedCalls,
      ),
      limit: 1,
    });
    assert.deepEqual(unresolvedCalls, [destination]);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
                  entitlement_applied_at IS NOT NULL AS entitlement_done
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [unresolvedEvent],
        )
      ).rows[0],
      { disposition: "applied", identity_done: true, entitlement_done: true },
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT subject.local_user_id,alias.local_user_id AS alias_owner,
                  alias.alias_kind,alias.source_event_id
           FROM revenuecat_event_subjects AS subject
           LEFT JOIN revenuecat_customer_aliases AS alias
             ON alias.alias_hash=subject.subject_hash
           WHERE subject.event_id=$1 AND subject.subject_hash=$2`,
          [unresolvedEvent, unresolvedSourceHash],
        )
      ).rows[0],
      {
        local_user_id: destination,
        alias_owner: destination,
        alias_kind: "transferred",
        source_event_id: unresolvedEvent,
      },
    );

    const orderedEvent = `mixed_transfer_ordered_${suffix}`;
    const orderedSourceHash = subjectHash(
      `mixed-transfer-ordered-source-${suffix}`,
    );
    const futureEvent = `future_transfer_${suffix}`;
    const futureDestinationHash = subjectHash(futureOwner);
    await insertRawlessEvent({
      eventId: futureEvent,
      type: "TRANSFER",
      eventAt: "2026-09-02T09:00:00Z",
      receivedAt: "2026-09-02T09:00:01Z",
      subjects: [
        { hash: orderedSourceHash, roleMask: 8, localUserId: null },
        {
          hash: futureDestinationHash,
          roleMask: 16,
          localUserId: futureOwner,
        },
      ],
    });
    const futureCalls = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T09:00:02Z", { pro: true }),
        },
        futureCalls,
      ),
      limit: 1,
    });
    assert.deepEqual(futureCalls, [futureOwner]);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT event.disposition,alias.local_user_id,alias.source_event_id
           FROM revenuecat_webhook_events AS event
           JOIN revenuecat_event_subjects AS subject
             ON subject.event_id=event.event_id AND subject.subject_hash=$2
           JOIN revenuecat_customer_aliases AS alias
             ON alias.alias_hash=subject.subject_hash
           WHERE event.event_id=$1`,
          [futureEvent, orderedSourceHash],
        )
      ).rows[0],
      {
        disposition: "applied",
        local_user_id: futureOwner,
        source_event_id: futureEvent,
      },
    );
    await insertRawlessEvent({
      eventId: orderedEvent,
      type: "TRANSFER",
      eventAt: "2026-09-01T10:00:00Z",
      subjects: [
        { hash: orderedSourceHash, roleMask: 8, localUserId: null },
        { hash: destinationHash, roleMask: 16, localUserId: destination },
      ],
    });
    const orderedCalls = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(
        (uid) => ({
          lookup: "existing",
          snapshot: snapshot("2026-09-02T10:00:00Z", {
            pro: uid === destination,
            coaching: false,
          }),
        }),
        orderedCalls,
      ),
      limit: 1,
    });
    assert.deepEqual(
      new Set(orderedCalls),
      new Set([destination, futureOwner]),
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT subject.local_user_id,alias.local_user_id AS alias_owner,
                  alias.source_event_id,event.disposition,
                  event.identity_applied_at IS NOT NULL AS identity_done
           FROM revenuecat_event_subjects AS subject
           JOIN revenuecat_webhook_events AS event ON event.event_id=subject.event_id
           JOIN revenuecat_customer_aliases AS alias
             ON alias.alias_hash=subject.subject_hash
           WHERE subject.event_id=$1 AND subject.subject_hash=$2`,
          [orderedEvent, orderedSourceHash],
        )
      ).rows[0],
      {
        local_user_id: futureOwner,
        alias_owner: futureOwner,
        source_event_id: futureEvent,
        disposition: "applied",
        identity_done: true,
      },
    );
  },
);

integrationTest(
  "direct UID links without aliases survive both event phase-crash directions",
  async () => {
    const suffix = Date.now();
    const identityOnlyUser = `direct-identity-${suffix}`;
    const entitlementOnlyUser = `direct-entitlement-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [identityOnlyUser, entitlementOnlyUser],
    ]);

    const identityOnlyEvent = `direct_identity_only_${suffix}`;
    const identityOnlyHash = "a".repeat(63) + "1";
    await insertRawlessEvent({
      eventId: identityOnlyEvent,
      subjects: [
        {
          hash: identityOnlyHash,
          roleMask: 1,
          localUserId: identityOnlyUser,
        },
      ],
      entitlementApplied: true,
    });
    const forbiddenCalls = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(null, forbiddenCalls),
      limit: 1,
    });
    assert.deepEqual(forbiddenCalls, []);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
                  entitlement_applied_at IS NOT NULL AS entitlement_done
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [identityOnlyEvent],
        )
      ).rows[0],
      { disposition: "stale", identity_done: true, entitlement_done: true },
    );
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
           WHERE alias_hash=$1`,
          [identityOnlyHash],
        )
      ).rows[0].count,
      0,
    );

    const entitlementOnlyEvent = `direct_entitlement_only_${suffix}`;
    const entitlementOnlyHash = "b".repeat(63) + "1";
    await insertRawlessEvent({
      eventId: entitlementOnlyEvent,
      subjects: [
        {
          hash: entitlementOnlyHash,
          roleMask: 1,
          localUserId: entitlementOnlyUser,
        },
      ],
      identityApplied: true,
    });
    const calls = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:10:00Z", { pro: true }),
        },
        calls,
      ),
      limit: 1,
    });
    assert.deepEqual(calls, [entitlementOnlyUser]);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at IS NOT NULL AS identity_done,
                  entitlement_applied_at IS NOT NULL AS entitlement_done
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [entitlementOnlyEvent],
        )
      ).rows[0],
      { disposition: "applied", identity_done: true, entitlement_done: true },
    );
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM revenuecat_customer_aliases
           WHERE alias_hash=$1`,
          [entitlementOnlyHash],
        )
      ).rows[0].count,
      0,
    );
  },
);

integrationTest(
  "fully pruned rawless events are parked without entering the normal claim queue",
  async () => {
    const suffix = Date.now();
    const userId = `worker-pruned-${suffix}`;
    const eventId = `worker_pruned_${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await insertRawlessEvent({
      eventId,
      subjects: [
        {
          hash: "b".repeat(63) + "2",
          roleMask: 1,
          localUserId: userId,
        },
      ],
    });
    await scopedPool.query("DELETE FROM users WHERE id=$1", [userId]);
    await makeOnlyEventDue(eventId);
    const calls = [];
    assert.equal(
      await runPendingEventBatch({
        config: processorConfig,
        client: fakeClient(null, calls),
        limit: 1,
      }),
      0,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,retained_identity_count,pruned_identity_count,
                  next_attempt_at=retention_until AS deferred_to_retention,
                  processing_lease_id
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [eventId],
        )
      ).rows[0],
      {
        disposition: "pending",
        retained_identity_count: 0,
        pruned_identity_count: 1,
        deferred_to_retention: true,
        processing_lease_id: null,
      },
    );
  },
);

integrationTest(
  "an expired fully-pruned cleanup failure cannot starve the next recoverable event",
  async () => {
    const suffix = Date.now();
    const prunedUser = `pruned-failure-user-${suffix}`;
    const peerUser = `pruned-failure-peer-${suffix}`;
    const prunedEvent = `pruned_cleanup_failure_${suffix}`;
    const peerEvent = `pruned_cleanup_peer_${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [prunedUser, peerUser],
    ]);
    await insertRawlessEvent({
      eventId: prunedEvent,
      subjects: [
        {
          hash: subjectHash(`pruned-cleanup-failure-${suffix}`),
          roleMask: 1,
          localUserId: prunedUser,
        },
      ],
      eventAt: "2026-05-01T00:00:00Z",
      receivedAt: "2026-05-01T00:00:01Z",
      retentionUntil: "2026-08-01T00:00:00Z",
    });
    await scopedPool.query("DELETE FROM users WHERE id=$1", [prunedUser]);
    await insertRawlessEvent({
      eventId: peerEvent,
      subjects: [
        {
          hash: subjectHash(`pruned-cleanup-peer-${suffix}`),
          roleMask: 1,
          localUserId: peerUser,
        },
      ],
    });
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=CASE event_id
         WHEN $1 THEN received_at
         WHEN $2 THEN received_at
         ELSE '2099-01-01T00:00:00Z'::timestamptz END,
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE disposition='pending'`,
      [prunedEvent, peerEvent],
    );
    await scopedPool.query(`
      CREATE FUNCTION reject_test_pruned_cleanup() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.event_id LIKE 'pruned_cleanup_failure_%' THEN
          RAISE EXCEPTION 'injected cleanup failure';
        END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER reject_test_pruned_cleanup
      BEFORE DELETE ON revenuecat_webhook_events
      FOR EACH ROW EXECUTE FUNCTION reject_test_pruned_cleanup();
    `);
    try {
      const calls = [];
      assert.equal(
        await runPendingEventBatch({
          config: processorConfig,
          client: fakeClient(
            {
              lookup: "existing",
              snapshot: snapshot("2026-09-02T00:12:00Z", { pro: true }),
            },
            calls,
          ),
          limit: 1,
        }),
        1,
      );
      assert.deepEqual(calls, [peerUser]);
      assert.deepEqual(
        (
          await scopedPool.query(
            `SELECT disposition,attempt_count,processing_lease_id
             FROM revenuecat_webhook_events WHERE event_id=$1`,
            [prunedEvent],
          )
        ).rows[0],
        {
          disposition: "pending",
          attempt_count: 0,
          processing_lease_id: null,
        },
      );
    } finally {
      await scopedPool.query(`
        DROP TRIGGER reject_test_pruned_cleanup ON revenuecat_webhook_events;
        DROP FUNCTION reject_test_pruned_cleanup();
      `);
    }
  },
);

integrationTest(
  "event recovery expands ordered owner locks and bounds repeated ownership instability",
  async () => {
    const suffix = Date.now();
    const owners = Array.from(
      { length: 7 },
      (_, index) => `expanded-${index}-${suffix}`,
    );
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      owners,
    ]);

    const stableEvent = `expansion_stable_${suffix}`;
    const stableHash = "c".repeat(63) + "1";
    await insertRawlessEvent({
      eventId: stableEvent,
      subjects: [{ hash: stableHash, roleMask: 1, localUserId: owners[0] }],
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z',$3)`,
      [stableHash, owners[0], `seed_stable_${suffix}`],
    );
    const stableCalls = [];
    const stableMetrics = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: fakeClient(async (uid) => {
        stableCalls.push(uid);
        if (uid === owners[0]) {
          await scopedPool.query(
            `UPDATE revenuecat_customer_aliases SET local_user_id=$2 WHERE alias_hash=$1`,
            [stableHash, owners[1]],
          );
        }
        return {
          lookup: "existing",
          snapshot: snapshot("2026-09-02T00:20:00Z", { pro: true }),
        };
      }, []),
      limit: 1,
      metric: (metric) => stableMetrics.push(metric),
    });
    assert.deepEqual(stableCalls, [owners[0], owners[1]]);
    assert.equal(
      stableMetrics.some(
        (metric) => metric.type === "event_recovery_expansion",
      ),
      true,
    );
    assert.equal(
      (
        await scopedPool.query(
          `SELECT disposition FROM revenuecat_webhook_events WHERE event_id=$1`,
          [stableEvent],
        )
      ).rows[0].disposition,
      "applied",
    );

    const unstableEvent = `expansion_unstable_${suffix}`;
    const unstableHash = "d".repeat(63) + "1";
    await insertRawlessEvent({
      eventId: unstableEvent,
      subjects: [{ hash: unstableHash, roleMask: 1, localUserId: owners[2] }],
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z',$3)`,
      [unstableHash, owners[2], `seed_unstable_${suffix}`],
    );
    const unstableCalls = [];
    const unstableMetrics = [];
    await runPendingEventBatch({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          unstableCalls.push(uid);
          const index = owners.indexOf(uid);
          await scopedPool.query(
            `UPDATE revenuecat_customer_aliases SET local_user_id=$2 WHERE alias_hash=$1`,
            [unstableHash, owners[index + 1]],
          );
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T00:21:00Z", { pro: true }),
          };
        },
      },
      limit: 1,
      metric: (metric) => unstableMetrics.push(metric),
    });
    assert.equal(unstableCalls.length, 4);
    assert.equal(
      unstableMetrics.some(
        (metric) =>
          metric.type === "event_recovery_failure" &&
          metric.errorCode === "identity_set_changed" &&
          metric.count === 1,
      ),
      true,
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at,entitlement_applied_at,
                  processing_lease_id
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [unstableEvent],
        )
      ).rows[0],
      {
        disposition: "pending",
        identity_applied_at: null,
        entitlement_applied_at: null,
        processing_lease_id: null,
      },
    );
  },
);

integrationTest(
  "event workers never hold queued leases behind a slow item and an old fence performs no duplicate GET",
  async () => {
    const suffix = Date.now();
    const slowUser = `lease-slow-${suffix}`;
    const peerUser = `lease-peer-${suffix}`;
    const fencedUser = `lease-fenced-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [slowUser, peerUser, fencedUser],
    ]);
    const slowEvent = `lease_a_slow_${suffix}`;
    const peerEvent = `lease_b_peer_${suffix}`;
    await insertRawlessEvent({
      eventId: slowEvent,
      subjects: [
        { hash: "e".repeat(63) + "1", roleMask: 1, localUserId: slowUser },
      ],
    });
    await insertRawlessEvent({
      eventId: peerEvent,
      subjects: [
        { hash: "e".repeat(63) + "2", roleMask: 1, localUserId: peerUser },
      ],
    });
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events SET next_attempt_at=received_at
       WHERE event_id=ANY($1::text[])`,
      [[slowEvent, peerEvent]],
    );
    let releaseSlow;
    let slowStartedResolve;
    const slowStarted = new Promise((resolve) => {
      slowStartedResolve = resolve;
    });
    const slowGate = new Promise((resolve) => {
      releaseSlow = resolve;
    });
    const calls = [];
    const firstReplica = runPendingEventBatch({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(`first:${uid}`);
          slowStartedResolve();
          await slowGate;
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T00:30:00Z", { pro: true }),
          };
        },
      },
      limit: 2,
    });
    await slowStarted;
    const secondReplica = await runPendingEventBatch({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(`second:${uid}`);
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T00:31:00Z", { pro: true }),
          };
        },
      },
      limit: 1,
    });
    assert.equal(secondReplica, 1);
    assert.deepEqual(calls, [`first:${slowUser}`, `second:${peerUser}`]);
    releaseSlow();
    assert.equal(await firstReplica, 1);

    const fencedEvent = `lease_c_fenced_${suffix}`;
    await insertRawlessEvent({
      eventId: fencedEvent,
      subjects: [
        {
          hash: "e".repeat(63) + "3",
          roleMask: 1,
          localUserId: fencedUser,
        },
      ],
    });
    const oldClaim = (await claimPendingRevenueCatEvents(1))[0];
    assert.equal(oldClaim.eventId, fencedEvent);
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET processing_lease_until=clock_timestamp() - interval '1 second'
       WHERE event_id=$1`,
      [fencedEvent],
    );
    const currentClaim = (await claimPendingRevenueCatEvents(1))[0];
    assert.equal(currentClaim.eventId, fencedEvent);
    const fenceCalls = [];
    const client = fakeClient(
      {
        lookup: "existing",
        snapshot: snapshot("2026-09-02T00:32:00Z", { pro: true }),
      },
      fenceCalls,
    );
    await recoverClaimedRevenueCatEvent(oldClaim, processorConfig, client);
    assert.deepEqual(fenceCalls, []);
    await recoverClaimedRevenueCatEvent(currentClaim, processorConfig, client);
    assert.deepEqual(fenceCalls, [fencedUser]);
  },
);

integrationTest(
  "bootstrap pages customer state by trusted UID and accepts only an empty 201",
  async () => {
    const suffix = Date.now();
    const userId = `000-bootstrap-${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after)
       VALUES ($1,'legacy_unverified','legacy_unverified','legacy_bootstrap','2000-01-01T00:00:00Z')`,
      [userId],
    );
    await scopedPool.query(
      `INSERT INTO subscription_entitlements
       (user_id,entitlement_id,active,status,will_renew,source_kind,
        source_snapshot_at,source_operation_id)
       VALUES ($1,'__legacy_unverified__',false,'expired',false,'legacy_unverified',
               '1970-01-01T00:00:00Z','legacy')`,
      [userId],
    );
    const calls = [];
    await bootstrapRevenueCatCustomers({
      config: processorConfig,
      client: fakeClient(
        {
          lookup: "created",
          snapshot: snapshot("2026-09-02T01:00:00Z", {
            pro: false,
            coaching: false,
          }),
        },
        calls,
      ),
      runId: "12345678-1234-1234-1234-123456789abc",
      batchSize: 10,
    });
    assert.equal(calls.includes(userId), true);
    const state = await scopedPool.query(
      `SELECT canonicalization_state,source_kind,last_operation_id
       FROM revenuecat_customer_state WHERE user_id=$1`,
      [userId],
    );
    assert.deepEqual(state.rows[0], {
      canonicalization_state: "canonical",
      source_kind: "bootstrap_canonical",
      last_operation_id: "bootstrap:12345678-1234-1234-1234-123456789abc",
    });
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM subscription_entitlements
           WHERE user_id=$1 AND entitlement_id='__legacy_unverified__'`,
          [userId],
        )
      ).rows[0].count,
      0,
    );
  },
);

integrationTest(
  "bootstrap paginates existing state, tolerates deletion, and reports remaining retryable failures",
  async () => {
    const suffix = Date.now();
    const successful = `zz-bootstrap-a-success-${suffix}`;
    const deleted = `zz-bootstrap-b-deleted-${suffix}`;
    const failing = `zz-bootstrap-c-failing-${suffix}`;
    const users = [successful, deleted, failing];
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      users,
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after)
       SELECT user_id,'legacy_unverified','legacy_unverified','legacy_bootstrap',
              '2000-01-01T00:00:00Z'
       FROM unnest($1::text[]) AS seeded(user_id)`,
      [users],
    );
    const calls = [];
    const result = await bootstrapRevenueCatCustomers({
      config: processorConfig,
      client: {
        async getSubscriber(uid) {
          calls.push(uid);
          if (uid === deleted) {
            await scopedPool.query("DELETE FROM users WHERE id=$1", [uid]);
          }
          if (uid === failing) {
            throw Object.assign(new Error("provider details stay private"), {
              code: "revenuecat_unavailable",
            });
          }
          return {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T01:30:00Z", {
              pro: false,
              coaching: false,
            }),
          };
        },
      },
      runId: "00000000-0000-0000-0000-000000000003",
      batchSize: 1,
    });
    assert.deepEqual(calls, users);
    assert.equal(result.attempted, 3);
    assert.equal(result.remaining >= 1, true);
    const states = await scopedPool.query(
      `SELECT user_id,canonicalization_state,reconcile_last_error_code
       FROM revenuecat_customer_state WHERE user_id=ANY($1::text[])
       ORDER BY user_id`,
      [users],
    );
    assert.deepEqual(states.rows, [
      {
        user_id: successful,
        canonicalization_state: "canonical",
        reconcile_last_error_code: null,
      },
      {
        user_id: failing,
        canonicalization_state: "legacy_unverified",
        reconcile_last_error_code: "revenuecat_unavailable",
      },
    ]);
  },
);

integrationTest(
  "cleanup preserves surviving identity work and never derives transfer phases from customer state",
  async () => {
    const suffix = Date.now();
    const userId = `cleanup-live-${suffix}`;
    const identityOnly = `cleanup_a_identity_only_${suffix}`;
    const ordinary = `cleanup_ordinary_${suffix}`;
    const transfer = `cleanup_transfer_${suffix}`;
    const pruned = `cleanup_pruned_${suffix}`;
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,source_environment,last_snapshot_at,
        last_operation_id,last_reconciled_at,reconcile_reason,reconcile_after)
       VALUES ($1,'canonical','worker_canonical','sandbox','2026-09-01T00:00:00Z',
               'worker:cleanup_1234',clock_timestamp(),'scheduled','2099-01-01T00:00:00Z')`,
      [userId],
    );
    await insertEvent(scopedPool, {
      eventId: identityOnly,
      type: "PRODUCT_CHANGE",
      eventAt: "2026-05-01T00:00:00Z",
      receivedAt: "2026-05-01T00:00:01Z",
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: false,
      nextAttemptAt: "2099-01-01T00:00:00Z",
      retentionUntil: "2026-11-01T00:00:00Z",
    });
    for (const [eventId, type] of [
      [ordinary, "INITIAL_PURCHASE"],
      [transfer, "TRANSFER"],
      [pruned, "INITIAL_PURCHASE"],
    ]) {
      await insertEvent(scopedPool, {
        eventId,
        type,
        eventAt: "2026-05-01T00:00:00Z",
        receivedAt: "2026-05-01T00:00:01Z",
        identityCount: 1,
        identityRequired: true,
        entitlementRequired: true,
        nextAttemptAt: "2099-01-01T00:00:00Z",
        retentionUntil: "2026-08-01T00:00:00Z",
      });
    }
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES
       ($1,$2,1,$3),($4,$5,1,$3),($6,$7,24,$3)`,
      [
        identityOnly,
        "0".repeat(64),
        userId,
        ordinary,
        "a".repeat(64),
        transfer,
        "b".repeat(64),
      ],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id) VALUES ($1,$2,1,NULL)`,
      [pruned, "c".repeat(64)],
    );
    const alerts = [];
    await cleanupRevenueCatEvents({ alert: (alert) => alerts.push(alert) });
    const states = await scopedPool.query(
      `SELECT event_id,identity_applied_at IS NOT NULL AS identity_done,
              entitlement_applied_at IS NOT NULL AS entitlement_done
       FROM revenuecat_webhook_events
       WHERE event_id=ANY($1::text[]) ORDER BY event_id`,
      [[identityOnly, ordinary, transfer]],
    );
    assert.deepEqual(
      new Map(states.rows.map((row) => [row.event_id, row])),
      new Map([
        [
          identityOnly,
          {
            event_id: identityOnly,
            identity_done: false,
            entitlement_done: false,
          },
        ],
        [
          ordinary,
          { event_id: ordinary, identity_done: false, entitlement_done: true },
        ],
        [
          transfer,
          { event_id: transfer, identity_done: false, entitlement_done: false },
        ],
      ]),
    );
    assert.equal(
      (
        await scopedPool.query(
          "SELECT count(*)::integer AS count FROM revenuecat_webhook_events WHERE event_id=$1",
          [pruned],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      alerts.some(
        (alert) => alert.type === "INITIAL_PURCHASE" && alert.count >= 1,
      ),
      true,
    );
    assert.equal(
      alerts.some((alert) => alert.type === "TRANSFER" && alert.count >= 1),
      true,
    );
    for (const alert of alerts) {
      assert.deepEqual(Object.keys(alert).sort(), ["count", "type"]);
    }
  },
);

integrationTest(
  "30-day cleanup requires post-event canonical observations for stale direct and current alias authorities",
  async () => {
    const suffix = Date.now();
    const aliasOwner = `cleanup-authority-alias-${suffix}`;
    const staleDirectOwner = `cleanup-authority-direct-${suffix}`;
    const eventId = `cleanup_authority_${suffix}`;
    const hash = subjectHash(`cleanup-authority-hash-${suffix}`);
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [aliasOwner, staleDirectOwner],
    ]);
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,reconcile_reason,reconcile_after)
       VALUES ($1,'pending','none','scheduled','2099-01-01T00:00:00Z')`,
      [aliasOwner],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,source_environment,
        last_snapshot_at,last_operation_id,last_reconciled_at,
        reconcile_reason,reconcile_after)
       VALUES ($1,'canonical','worker_canonical','sandbox',
               '2026-08-01T00:00:00Z',$2,'2026-08-01T00:00:01Z',
               'scheduled','2099-01-01T00:00:00Z')`,
      [staleDirectOwner, `worker:cleanup-authority-direct-${suffix}`],
    );
    await insertRawlessEvent({
      eventId,
      subjects: [{ hash, roleMask: 1, localUserId: staleDirectOwner }],
      eventAt: "2026-07-01T00:00:00Z",
      receivedAt: "2026-07-01T00:00:01Z",
      retentionUntil: "2026-11-01T00:00:00Z",
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES ($1,$2,'ordinary','webhook','2026-08-01T00:00:00Z',$3)`,
      [hash, aliasOwner, `cleanup_authority_alias_${suffix}`],
    );

    await cleanupRevenueCatEvents();
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at,entitlement_applied_at
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [eventId],
        )
      ).rows[0],
      {
        disposition: "pending",
        identity_applied_at: null,
        entitlement_applied_at: null,
      },
    );
    assert.deepEqual(
      new Map(
        (
          await scopedPool.query(
            `SELECT user_id,reconcile_reason,
                    reconcile_after<=clock_timestamp() AS due
             FROM revenuecat_customer_state
             WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
            [[aliasOwner, staleDirectOwner]],
          )
        ).rows.map((row) => [row.user_id, row]),
      ),
      new Map([
        [
          aliasOwner,
          {
            user_id: aliasOwner,
            reconcile_reason: "webhook_failure",
            due: true,
          },
        ],
        [
          staleDirectOwner,
          {
            user_id: staleDirectOwner,
            reconcile_reason: "webhook_failure",
            due: true,
          },
        ],
      ]),
    );

    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET canonicalization_state='canonical',source_kind='worker_canonical',
           source_environment='sandbox',last_snapshot_at='2026-08-15T00:00:00Z',
           last_operation_id='worker:cleanup-authority-ready',
           last_reconciled_at='2026-08-15T00:00:01Z',
           reconcile_reason='scheduled',reconcile_after='2099-01-01T00:00:00Z',
           updated_at=clock_timestamp()
       WHERE user_id=ANY($1::text[])`,
      [[aliasOwner, staleDirectOwner]],
    );
    await cleanupRevenueCatEvents();
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT disposition,identity_applied_at,
                  entitlement_applied_at IS NOT NULL AS entitlement_done
           FROM revenuecat_webhook_events WHERE event_id=$1`,
          [eventId],
        )
      ).rows[0],
      {
        disposition: "pending",
        identity_applied_at: null,
        entitlement_done: true,
      },
    );
  },
);

integrationTest(
  "90-day cleanup retains only live null-linked alias authority, enqueues it, and recovery completes",
  async () => {
    const suffix = Date.now();
    const authenticatedOwner = `cleanup-alias-auth-${suffix}`;
    const webhookOwner = `cleanup-alias-webhook-${suffix}`;
    const tombstonedOwner = `cleanup-alias-tombstone-${suffix}`;
    const authenticatedEvent = `cleanup_alias_a_auth_${suffix}`;
    const webhookEvent = `cleanup_alias_b_webhook_${suffix}`;
    const noAliasEvent = `cleanup_alias_c_none_${suffix}`;
    const tombstonedEvent = `cleanup_alias_d_tombstone_${suffix}`;
    const authenticatedHash = subjectHash(`cleanup-auth-hash-${suffix}`);
    const webhookHash = subjectHash(`cleanup-webhook-hash-${suffix}`);
    const noAliasHash = subjectHash(`cleanup-no-alias-hash-${suffix}`);
    const tombstonedHash = subjectHash(`cleanup-tombstone-hash-${suffix}`);
    await scopedPool.query("INSERT INTO users (id) SELECT unnest($1::text[])", [
      [authenticatedOwner, webhookOwner, tombstonedOwner],
    ]);
    for (const [eventId, hash] of [
      [authenticatedEvent, authenticatedHash],
      [webhookEvent, webhookHash],
      [noAliasEvent, noAliasHash],
      [tombstonedEvent, tombstonedHash],
    ]) {
      await insertRawlessEvent({
        eventId,
        subjects: [{ hash, roleMask: 1, localUserId: null }],
        eventAt: "2026-05-01T00:00:00Z",
        receivedAt: "2026-05-01T00:00:01Z",
        retentionUntil: "2026-08-01T00:00:00Z",
      });
    }
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,authenticated_at)
       VALUES ($1,$2,'authenticated','authenticated','2026-04-01T00:00:00Z')`,
      [authenticatedHash, authenticatedOwner],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_aliases
       (alias_hash,local_user_id,alias_kind,ownership_source,source_event_at,source_event_id)
       VALUES
         ($1,$2,'ordinary','webhook','2026-04-01T00:00:00Z',$3),
         ($4,$5,'ordinary','webhook','2026-04-01T00:00:00Z',$6)`,
      [
        webhookHash,
        webhookOwner,
        `cleanup_alias_seed_${suffix}`,
        tombstonedHash,
        tombstonedOwner,
        `cleanup_alias_tomb_${suffix}`,
      ],
    );
    await scopedPool.query(
      `INSERT INTO account_deletions (user_id,request_id) VALUES ($1,$2)`,
      [tombstonedOwner, `cleanup-alias-tombstone-${suffix}`],
    );
    const alerts = [];
    await cleanupRevenueCatEvents({ alert: (alert) => alerts.push(alert) });
    const retained = await scopedPool.query(
      `SELECT event_id,next_attempt_at<=clock_timestamp() AS due
       FROM revenuecat_webhook_events
       WHERE event_id=ANY($1::text[]) ORDER BY event_id`,
      [[authenticatedEvent, webhookEvent, noAliasEvent, tombstonedEvent]],
    );
    assert.deepEqual(retained.rows, [
      { event_id: authenticatedEvent, due: true },
      { event_id: webhookEvent, due: true },
    ]);
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM revenuecat_event_subjects
           WHERE event_id=$1 OR subject_hash=$2`,
          [noAliasEvent, noAliasHash],
        )
      ).rows[0].count,
      0,
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT
             EXISTS(SELECT 1 FROM revenuecat_webhook_events WHERE event_id=$1) AS event,
             EXISTS(SELECT 1 FROM revenuecat_event_subjects WHERE event_id=$1) AS subject,
             EXISTS(SELECT 1 FROM revenuecat_customer_state WHERE user_id=$2) AS queued,
             EXISTS(SELECT 1 FROM revenuecat_customer_aliases WHERE alias_hash=$3) AS alias`,
          [tombstonedEvent, tombstonedOwner, tombstonedHash],
        )
      ).rows[0],
      { event: false, subject: false, queued: false, alias: true },
    );
    const queued = await scopedPool.query(
      `SELECT user_id,reconcile_reason,reconcile_after<=clock_timestamp() AS due
       FROM revenuecat_customer_state
       WHERE user_id=ANY($1::text[]) ORDER BY user_id`,
      [[authenticatedOwner, webhookOwner]],
    );
    assert.deepEqual(
      new Map(queued.rows.map((row) => [row.user_id, row])),
      new Map([
        [
          authenticatedOwner,
          {
            user_id: authenticatedOwner,
            reconcile_reason: "webhook_failure",
            due: true,
          },
        ],
        [
          webhookOwner,
          {
            user_id: webhookOwner,
            reconcile_reason: "webhook_failure",
            due: true,
          },
        ],
      ]),
    );
    assert.equal(
      alerts.some(
        (alert) => alert.type === "INITIAL_PURCHASE" && alert.count >= 2,
      ),
      true,
    );
    for (const alert of alerts) {
      assert.deepEqual(Object.keys(alert).sort(), ["count", "type"]);
    }

    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at=CASE WHEN event_id=ANY($1::text[])
         THEN received_at
         ELSE '2099-01-01T00:00:00Z'::timestamptz END,
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE disposition='pending'`,
      [[authenticatedEvent, webhookEvent]],
    );
    const calls = [];
    assert.equal(
      await runPendingEventBatch({
        config: processorConfig,
        client: fakeClient(
          {
            lookup: "existing",
            snapshot: snapshot("2026-09-02T04:00:00Z", { pro: true }),
          },
          calls,
        ),
        limit: 2,
      }),
      2,
    );
    assert.deepEqual(
      new Set(calls),
      new Set([authenticatedOwner, webhookOwner]),
    );
    const recovered = await scopedPool.query(
      `SELECT event_id,disposition,
              identity_applied_at IS NOT NULL AS identity_done,
              entitlement_applied_at IS NOT NULL AS entitlement_done
       FROM revenuecat_webhook_events
       WHERE event_id=ANY($1::text[]) ORDER BY event_id`,
      [[authenticatedEvent, webhookEvent]],
    );
    assert.deepEqual(recovered.rows, [
      {
        event_id: authenticatedEvent,
        disposition: "applied",
        identity_done: true,
        entitlement_done: true,
      },
      {
        event_id: webhookEvent,
        disposition: "applied",
        identity_done: true,
        entitlement_done: true,
      },
    ]);
    const authorities = await scopedPool.query(
      `SELECT alias_hash,local_user_id,ownership_source
       FROM revenuecat_customer_aliases
       WHERE alias_hash=ANY($1::text[]) ORDER BY alias_hash`,
      [[authenticatedHash, webhookHash]],
    );
    assert.deepEqual(
      new Map(authorities.rows.map((row) => [row.alias_hash, row])),
      new Map([
        [
          authenticatedHash,
          {
            alias_hash: authenticatedHash,
            local_user_id: authenticatedOwner,
            ownership_source: "authenticated",
          },
        ],
        [
          webhookHash,
          {
            alias_hash: webhookHash,
            local_user_id: webhookOwner,
            ownership_source: "webhook",
          },
        ],
      ]),
    );
    assert.deepEqual(
      (
        await scopedPool.query(
          `SELECT
             EXISTS(SELECT 1 FROM revenuecat_webhook_events WHERE event_id=$1) AS event,
             EXISTS(SELECT 1 FROM revenuecat_event_subjects WHERE subject_hash=$2) AS subject,
             EXISTS(SELECT 1 FROM revenuecat_customer_aliases WHERE alias_hash=$2) AS alias`,
          [noAliasEvent, noAliasHash],
        )
      ).rows[0],
      { event: false, subject: false, alias: false },
    );
  },
);

integrationTest(
  "real privacy and diagnostics routes preserve shared events while omitting pseudonymous identifiers",
  async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const owner = `presentation-owner-${suffix}`;
    const sharedOwner = `presentation-shared-${suffix}`;
    const missingStateOwner = `presentation-missing-${suffix}`;
    const eventId = `presentation_event_${Date.now()}`;
    const ownerHash = subjectHash(`raw-owner-${suffix}`);
    const sharedHash = subjectHash(`raw-shared-${suffix}`);
    const eventAt = new Date(Date.now() - 120_000).toISOString();
    const receivedAt = new Date(Date.now() - 60_000).toISOString();
    const server = await new Promise((resolve, reject) => {
      const listening = apiApp.listen(0, () => resolve(listening));
      listening.once("error", reject);
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const getJson = async (path, userId) => {
      const response = await fetch(`${origin}${path}`, {
        headers: userId ? { "x-elovia-test-user": userId } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      for (const path of ["/api/privacy/export", "/api/diagnostics"]) {
        assert.deepEqual(await getJson(path), {
          status: 401,
          body: {
            error: "Authentication required",
            code: "unauthenticated",
          },
        });
      }
      const baseline = (
        await getJson("/api/diagnostics", `probe-${suffix}`)
      ).body.revenueCat;
      await scopedPool.query(
        `INSERT INTO users (id,created_at) VALUES
         ($1,clock_timestamp()),($2,clock_timestamp()),($3,clock_timestamp())`,
        [owner, sharedOwner, missingStateOwner],
      );
      await scopedPool.query(
        `INSERT INTO revenuecat_customer_state
         (user_id,canonicalization_state,source_kind,source_environment,
          last_snapshot_at,last_operation_id,last_reconciled_at,
          reconcile_reason,reconcile_after)
         VALUES
         ($1,'pending','none',NULL,NULL,NULL,NULL,'webhook_failure',clock_timestamp()),
         ($2,'canonical','worker_canonical','sandbox',clock_timestamp(),
          'worker:presentation123',clock_timestamp(),'scheduled','2099-01-01T00:00:00Z')`,
        [owner, sharedOwner],
      );
      await insertEvent(scopedPool, {
        eventId,
        type: "TRANSFER",
        eventAt,
        receivedAt,
        environment: "sandbox",
        metadata: { schemaVersion: 1, identityCount: 2 },
        identityCount: 2,
        identityRequired: true,
        entitlementRequired: true,
        nextAttemptAt: receivedAt,
      });
      await scopedPool.query(
        `UPDATE revenuecat_webhook_events SET attempt_count=1 WHERE event_id=$1`,
        [eventId],
      );
      await scopedPool.query(
        `INSERT INTO revenuecat_event_subjects
         (event_id,subject_hash,role_mask,local_user_id) VALUES
         ($1,$2,$3,$4),($1,$5,$6,$7)`,
        [
          eventId,
          ownerHash,
          1 | 16,
          owner,
          sharedHash,
          8,
          sharedOwner,
        ],
      );
      await scopedPool.query(
        `INSERT INTO subscription_entitlements
         (user_id,entitlement_id,active,status,product_id,store,
          period_ends_at,access_ends_at,will_renew,source_environment,
          source_kind,source_snapshot_at,source_operation_id,
          source_trigger_event_id)
         VALUES ($1,'elovia_pro',true,'active','pro_monthly','test_store',
                 '2099-01-01T00:00:00Z','2099-01-01T00:00:00Z',true,
                 'sandbox','webhook_canonical',clock_timestamp(),$2,$3)`,
        [owner, `webhook:${eventId}`, eventId],
      );

      const ownerExport = await getJson("/api/privacy/export", owner);
      assert.equal(ownerExport.status, 200);
      assert.equal(
        ownerExport.body.revenueCatBilling.label,
        "RevenueCat billing entitlement state",
      );
      assert.deepEqual(ownerExport.body.revenueCatBilling.events[0].roles, [
        "primary",
        "transferred_to",
      ]);
      assert.deepEqual(ownerExport.body.subscriptions, [
        ownerExport.body.revenueCatBilling.entitlements[0],
      ]);
      const sharedExport = await getJson("/api/privacy/export", sharedOwner);
      assert.equal(sharedExport.status, 200);
      assert.deepEqual(sharedExport.body.revenueCatBilling.events[0].roles, [
        "transferred_from",
      ]);
      for (const exportBody of [ownerExport.body, sharedExport.body]) {
        const serialized = JSON.stringify(exportBody.revenueCatBilling);
        assert.equal(serialized.includes(ownerHash), false);
        assert.equal(serialized.includes(sharedHash), false);
        assert.equal(serialized.includes("subjectHash"), false);
        assert.equal(serialized.includes("aliasHash"), false);
        assert.equal(serialized.includes("revenuecatUserId"), false);
        assert.equal(serialized.includes("lastEvent"), false);
      }

      await scopedPool.query("DELETE FROM users WHERE id=$1", [sharedOwner]);
      const survivingExport = await getJson("/api/privacy/export", owner);
      assert.equal(survivingExport.status, 200);
      assert.equal(
        survivingExport.body.revenueCatBilling.events[0].prunedIdentityCount,
        1,
      );
      assert.deepEqual(
        survivingExport.body.revenueCatBilling.events[0].roles,
        ["primary", "transferred_to"],
      );
      assert.deepEqual(
        (
          await scopedPool.query(
            `SELECT retained_identity_count,pruned_identity_count,
                    (SELECT count(*)::integer FROM revenuecat_event_subjects
                     WHERE event_id=$1) AS subjects
             FROM revenuecat_webhook_events WHERE event_id=$1`,
            [eventId],
          )
        ).rows[0],
        { retained_identity_count: 1, pruned_identity_count: 1, subjects: 1 },
      );

      const diagnostics = (
        await getJson("/api/diagnostics", owner)
      ).body.revenueCat;
      assert.equal(diagnostics.configuration.webhookSecretPresent, true);
      assert.equal(diagnostics.configuration.apiKeyPresent, true);
      assert.equal(diagnostics.configuration.subjectHashKeyPresent, true);
      assert.equal(diagnostics.configuration.proProductCount, 1);
      assert.equal(diagnostics.configuration.coachingProductCount, 1);
      assert.equal(diagnostics.events.due, baseline.events.due + 1);
      assert.equal(diagnostics.events.failed, baseline.events.failed + 1);
      assert.equal(diagnostics.events.pending, baseline.events.pending + 1);
      assert.equal(
        diagnostics.events.pendingIdentityPhase,
        baseline.events.pendingIdentityPhase + 1,
      );
      assert.equal(
        diagnostics.events.pendingEntitlementPhase,
        baseline.events.pendingEntitlementPhase + 1,
      );
      assert.equal(diagnostics.events.pruned, baseline.events.pruned + 1);
      assert.equal(
        diagnostics.customers.noncanonical,
        baseline.customers.noncanonical + 1,
      );
      assert.equal(
        diagnostics.customers.missingState,
        baseline.customers.missingState + 1,
      );
      assert.equal(diagnostics.customers.hasNoncanonical, true);
    } finally {
      await scopedPool.query(
        `DELETE FROM users WHERE id=ANY($1::text[])`,
        [[owner, sharedOwner, missingStateOwner]],
      );
      await scopedPool.query(
        `DELETE FROM revenuecat_webhook_events WHERE event_id=$1`,
        [eventId],
      );
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

integrationTest(
  "per-user and strict resolvers ignore legacy paid rows and strict readiness uses real customer state",
  async () => {
    const suffix = Date.now();
    const legacyUser = `resolver-legacy-${suffix}`;
    const canonicalUser = `resolver-canonical-${suffix}`;
    await scopedPool.query(
      `INSERT INTO users (id,created_at) VALUES
       ($1,'2020-01-01T00:00:00Z'),($2,'2020-01-01T00:00:00Z')`,
      [legacyUser, canonicalUser],
    );
    await scopedPool.query(
      `INSERT INTO subscriptions
       (user_id,revenuecat_user_id,entitlement_active,entitlement_id,status,tier,
        product_id,store,current_period_ends_at,last_event,last_event_at)
       VALUES ($1,$1,true,'legacy-paid','active','lifetime','legacy-product',
               'app_store','2099-01-01T00:00:00Z',NULL,'2099-01-01T00:00:00Z')`,
      [legacyUser],
    );
    await scopedPool.query(
      `INSERT INTO revenuecat_customer_state
       (user_id,canonicalization_state,source_kind,source_environment,last_snapshot_at,
        last_operation_id,last_reconciled_at,reconcile_reason,reconcile_after)
       VALUES ($1,'canonical','worker_canonical','sandbox','2026-09-02T01:40:00Z',
               'worker:resolver-canonical','2026-09-02T01:40:01Z','scheduled',
               '2099-01-01T00:00:00Z')`,
      [canonicalUser],
    );
    await scopedPool.query(
      `INSERT INTO subscription_entitlements
       (user_id,entitlement_id,active,status,product_id,store,access_ends_at,
        will_renew,source_environment,source_kind,source_snapshot_at,source_operation_id)
       VALUES ($1,'elovia_pro',true,'active','pro_monthly','test_store',
               '2099-01-01T00:00:00Z',true,'sandbox','worker_canonical',
               '2026-09-02T01:40:00Z','worker:resolver-canonical')`,
      [canonicalUser],
    );

    process.env.REVENUECAT_NORMALIZED_READS = "per_user";
    const legacyPerUser = await resolveEntitlement(legacyUser);
    assert.deepEqual(legacyPerUser, {
      tier: "free",
      hasProAccess: false,
      hasCoaching: false,
      status: "expired",
      trialEndsAt: new Date("2020-01-16T00:00:00.000Z"),
      currentPeriodEndsAt: null,
      productId: null,
    });
    assert.equal((await resolveEntitlement(canonicalUser)).tier, "premium");
    process.env.REVENUECAT_NORMALIZED_READS = "strict";
    assert.deepEqual(await resolveEntitlement(legacyUser), legacyPerUser);

    const server = await new Promise((resolve, reject) => {
      const listening = apiApp.listen(0, () => resolve(listening));
      listening.once("error", reject);
    });
    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      const origin = `http://127.0.0.1:${address.port}`;
      process.env.REVENUECAT_ENVIRONMENT = "invalid-for-readiness-test";
      const invalidConfiguration = await fetch(`${origin}/api/readyz`);
      process.env.REVENUECAT_ENVIRONMENT = processorConfig.environment;
      assert.equal(invalidConfiguration.status, 503);
      const unavailable = await fetch(`${origin}/api/readyz`);
      assert.equal(unavailable.status, 503);

      await scopedPool.query(`
        INSERT INTO revenuecat_customer_state (
          user_id,canonicalization_state,source_kind,source_environment,
          last_snapshot_at,last_operation_id,last_reconciled_at,
          reconcile_reason,reconcile_after
        )
        SELECT id,'canonical','bootstrap_canonical','sandbox',
               '2026-09-02T01:50:00Z',
               'bootstrap:00000000-0000-0000-0000-000000000001',
               clock_timestamp(),'scheduled','2099-01-01T00:00:00Z'
        FROM users
        ON CONFLICT (user_id) DO UPDATE SET
          canonicalization_state='canonical',
          source_kind='bootstrap_canonical',
          source_environment='sandbox',
          last_snapshot_at='2026-09-02T01:50:00Z',
          last_operation_id='bootstrap:00000000-0000-0000-0000-000000000001',
          last_reconciled_at=clock_timestamp(),
          reconcile_reason='scheduled',
          reconcile_after='2099-01-01T00:00:00Z',
          reconcile_attempt_count=0,
          reconcile_lease_id=NULL,
          reconcile_lease_until=NULL,
          reconcile_last_error_code=NULL
      `);
      const ready = await fetch(`${origin}/api/readyz`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { status: "ok" });
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      process.env.REVENUECAT_NORMALIZED_READS = "per_user";
    }
  },
);

integrationTest(
  "RevenueCat worker lifecycle performs one injected cycle and stops its next schedule",
  async () => {
    await scopedPool.query(
      `UPDATE revenuecat_customer_state
       SET reconcile_after='2099-01-01T00:00:00Z',
           reconcile_lease_id=NULL,reconcile_lease_until=NULL`,
    );
    await scopedPool.query(
      `UPDATE revenuecat_webhook_events
       SET next_attempt_at='2099-01-01T00:00:00Z',
           processing_lease_id=NULL,processing_lease_until=NULL
       WHERE disposition='pending'`,
    );
    let cycleCount = 0;
    let cycleResolve;
    const cycle = new Promise((resolve) => {
      cycleResolve = resolve;
    });
    const calls = [];
    const stop = startRevenueCatWorkers({
      intervalMs: 2_147_000_000,
      runtime: {
        config: processorConfig,
        client: fakeClient(null, calls),
      },
      metric() {},
      onCycle() {
        cycleCount += 1;
        cycleResolve();
      },
    });
    await cycle;
    stop();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(cycleCount, 1);
    assert.deepEqual(calls, []);
  },
);

integrationTest(
  "event retention deletion nulls only the entitlement trigger and cascades subjects",
  async () => {
    await scopedPool.query(`INSERT INTO users (id) VALUES ('ttl-user')`);
    await insertEvent(scopedPool, {
      eventId: "event_ttl_123",
      identityCount: 1,
      identityRequired: true,
      entitlementRequired: true,
    });
    await scopedPool.query(
      `INSERT INTO revenuecat_event_subjects
       (event_id,subject_hash,role_mask,local_user_id)
       VALUES ('event_ttl_123',$1,1,'ttl-user')`,
      ["4".repeat(64)],
    );
    await scopedPool.query(
      `INSERT INTO subscription_entitlements
       (user_id,entitlement_id,active,status,will_renew,source_environment,source_kind,
        source_snapshot_at,source_operation_id,source_trigger_event_id)
       VALUES ('ttl-user','pro',true,'active',true,'sandbox','webhook_canonical',
        '2026-09-01T10:00:00Z','webhook:event_ttl_123','event_ttl_123')`,
    );
    await scopedPool.query(
      `DELETE FROM revenuecat_webhook_events WHERE event_id='event_ttl_123'`,
    );
    const entitlement = await scopedPool.query(
      `SELECT active,status,source_kind,source_operation_id,source_trigger_event_id
       FROM subscription_entitlements WHERE user_id='ttl-user'`,
    );
    assert.deepEqual(entitlement.rows[0], {
      active: true,
      status: "active",
      source_kind: "webhook_canonical",
      source_operation_id: "webhook:event_ttl_123",
      source_trigger_event_id: null,
    });
    assert.equal(
      (
        await scopedPool.query(
          `SELECT count(*)::integer AS count FROM revenuecat_event_subjects WHERE event_id='event_ttl_123'`,
        )
      ).rows[0].count,
      0,
    );
  },
);

integrationTest(
  "the Drizzle mirror exposes role masks and all five tables",
  () => {
    assert.deepEqual(revenuecatSchema.REVENUECAT_SUBJECT_ROLE_MASKS, {
      primary: 1,
      original: 2,
      alias: 4,
      transferredFrom: 8,
      transferredTo: 16,
      redeemedFrom: 32,
      redeemedBy: 64,
    });
    for (const exportName of [
      "revenuecatWebhookEventsTable",
      "revenuecatEventSubjectsTable",
      "revenuecatCustomerAliasesTable",
      "revenuecatCustomerStateTable",
      "subscriptionEntitlementsTable",
    ]) {
      assert.ok(revenuecatSchema[exportName], `missing ${exportName}`);
    }
  },
);
