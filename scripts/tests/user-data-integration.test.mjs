import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error(
    "CI must provide TEST_DATABASE_URL for user-data integration tests",
  );
}

const integrationTest = testDatabaseUrl ? test : test.skip;
const schemaName = `elovia_sync_test_${process.pid}_${Date.now()}`;
const expectedUserDataFields = [
  "appState",
  "workoutPlan",
  "customPlans",
  "activePlanType",
  "activeCustomPlanId",
  "activeSession",
  "sessions",
  "personalRecords",
  "mealPlan",
  "foodLog",
  "customMealPlans",
  "activeMealPlanType",
  "activeCustomMealPlanId",
  "healthData",
  "wellnessData",
  "waterGoal",
  "reminderPrefs",
  "places",
];
const expectedApplicationTables = [
  "account_deletions",
  "activity_comments",
  "ai_response_receipts",
  "ai_usage",
  "challenge_participants",
  "challenges",
  "coach_availability",
  "coach_profiles",
  "coaching_sessions",
  "community_memberships",
  "content_reports",
  "friendships",
  "kudos",
  "mobile_oauth_attempts",
  "moderation_audit_log",
  "push_tokens",
  "revenuecat_customer_aliases",
  "revenuecat_customer_state",
  "revenuecat_event_subjects",
  "revenuecat_webhook_events",
  "sessions",
  "shared_activities",
  "social_profiles",
  "subscription_entitlements",
  "subscriptions",
  "supplements",
  "user_data",
  "users",
];
const syncIntegrityColumns = [
  "active_session",
  "places",
  "reminder_prefs",
  "revision",
  "water_goal",
  "wellness_data",
];
const baselineMigrationUrl = new URL(
  "../../lib/db/migrations/0000_baseline.sql",
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

let adminPool;
let Pool;
let scopedPool;
let workspacePool;
let db;
let saveUserData;
let sql;
let loadUserData;
let runMigrations;
let claimPendingAccountDeletionIdentities;
let finalizeAccountDeletion;
let finalizeClaimedAccountDeletionIdentity;
let provisionAuthenticatedUserIfActive;
let rescheduleClaimedAccountDeletionIdentity;
let tombstoneAndDeleteAccountData;
let withAccountLock;
let withAccountLocks;
let unregisterTsx;
let routeServer;
let routeBaseUrl;
let temporaryDatabaseCounter = 0;

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scopedDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
}

function databaseUrlFor(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete("options");
  return url.toString();
}

async function waitForDatabaseClientsToClose(databaseName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const active = await adminPool.query(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    if (active.rows[0].count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withTemporaryDatabase(callback) {
  temporaryDatabaseCounter += 1;
  const databaseName = `elovia_migration_test_${process.pid}_${temporaryDatabaseCounter}`;
  assert.match(databaseName, /^elovia_migration_test_[0-9_]+$/);

  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  try {
    return await callback(databaseUrlFor(testDatabaseUrl, databaseName));
  } finally {
    // Pool shutdown can be visible to the server a few milliseconds after the
    // client's end promise settles on PostgreSQL 14. Give it time to drain so
    // forced cleanup cannot surface as an uncaught test error.
    await waitForDatabaseClientsToClose(databaseName);
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
  }
}

async function applicationTables(pool) {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_elovia_schema_migrations'
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function provisionLegacySchema(pool, targetSchema = "public") {
  const baselineSql = await readFile(baselineMigrationUrl, "utf8");
  const scopedBaselineSql = baselineSql.replaceAll(
    '"public".',
    `${quotedIdentifier(targetSchema)}.`,
  );
  await pool.query(scopedBaselineSql);
  await pool.query(`
    ALTER TABLE user_data DROP CONSTRAINT user_data_revision_safe;
    ALTER TABLE user_data
      DROP COLUMN revision,
      DROP COLUMN active_session,
      DROP COLUMN wellness_data,
      DROP COLUMN water_goal,
      DROP COLUMN reminder_prefs,
      DROP COLUMN places;
  `);
}

async function assertNoMigrationRecords(pool) {
  const migrationTable = await pool.query(
    "SELECT to_regclass('public._elovia_schema_migrations')::text AS migration_table",
  );
  assert.equal(migrationTable.rows[0].migration_table, null);

  const verifierSchemas = await pool.query(`
    SELECT count(*)::integer AS verifier_count
    FROM pg_namespace
    WHERE nspname LIKE '\\_elovia\\_verify\\_%' ESCAPE '\\'
  `);
  assert.equal(verifierSchemas.rows[0].verifier_count, 0);
}

async function existingSyncIntegrityColumns(pool) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_data'
        AND column_name = ANY($1::text[])
      ORDER BY column_name
    `,
    [syncIntegrityColumns],
  );
  return result.rows.map((row) => row.column_name);
}

async function assertAdoptionRefused({ mutate, verify }) {
  await withTemporaryDatabase(async (databaseUrl) => {
    const setupPool = new Pool({ connectionString: databaseUrl });
    try {
      await provisionLegacySchema(setupPool);
      await mutate(setupPool);
    } finally {
      await setupPool.end();
    }

    await assert.rejects(
      runMigrations(databaseUrl),
      /cannot adopt 0000_baseline\.sql/i,
    );

    const verificationPool = new Pool({ connectionString: databaseUrl });
    try {
      await assertNoMigrationRecords(verificationPool);
      await verify(verificationPool);
    } finally {
      await verificationPool.end();
    }
  });
}

async function withTimeout(promise, message, timeoutMs = 1_000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

if (testDatabaseUrl) {
  before(async () => {
    const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
    assert.match(
      databaseName,
      /test/i,
      "TEST_DATABASE_URL must target a database whose name contains 'test'",
    );

    const pg = requireFromDatabasePackage("pg");
    ({ Pool } = pg);
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schemaName)}`);

    const databaseUrl = scopedDatabaseUrl(testDatabaseUrl);
    scopedPool = new Pool({ connectionString: databaseUrl });
    await provisionLegacySchema(scopedPool, schemaName);

    ({ runMigrations } = await import("../../lib/db/scripts/migrate.mjs"));
    await runMigrations(databaseUrl);
    await runMigrations(databaseUrl);

    process.env.DATABASE_URL = databaseUrl;
    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    db = databaseModule.db;
    workspacePool = databaseModule.pool;
    ({ sql } = requireFromDatabasePackage("drizzle-orm"));
    ({ loadUserData, saveUserData } =
      await import("../../artifacts/api-server/src/services/userDataStore.ts"));
    ({
      claimPendingAccountDeletionIdentities,
      finalizeAccountDeletion,
      finalizeClaimedAccountDeletionIdentity,
      provisionAuthenticatedUserIfActive,
      rescheduleClaimedAccountDeletionIdentity,
      tombstoneAndDeleteAccountData,
      withAccountLock,
      withAccountLocks,
    } = await import("../../artifacts/api-server/src/lib/accountDeletion.ts"));

    await scopedPool.query("INSERT INTO users (id) VALUES ('route-user')");
    const express = requireFromApiPackage("express");
    const { default: userDataRouter } =
      await import("../../artifacts/api-server/src/routes/userData.ts");
    const routeApp = express();
    routeApp.use(express.json());
    routeApp.use((request, _response, next) => {
      request.user = { id: "route-user" };
      request.isAuthenticated = () => true;
      request.log = { error() {} };
      next();
    });
    routeApp.use(userDataRouter);
    routeServer = await new Promise((resolve, reject) => {
      const server = routeApp.listen(0, "127.0.0.1", () => resolve(server));
      server.once("error", reject);
    });
    routeBaseUrl = `http://127.0.0.1:${routeServer.address().port}`;
  });

  after(async () => {
    routeServer?.closeAllConnections();
    await new Promise((resolve, reject) => {
      if (!routeServer) {
        resolve();
        return;
      }
      routeServer.close((error) => (error ? reject(error) : resolve()));
    });
    await workspacePool?.end();
    await unregisterTsx?.();
    await scopedPool?.end();
    await adminPool?.query(
      `DROP SCHEMA ${quotedIdentifier(schemaName)} CASCADE`,
    );
    await adminPool?.end();
  });
}

integrationTest(
  "a blank database bootstraps the complete generated schema",
  async () => {
    await withTemporaryDatabase(async (databaseUrl) => {
      assert.deepEqual(await runMigrations(databaseUrl), [
        "0000_baseline.sql",
        "0001_user_data_sync_integrity.sql",
        "0002_account_deletion_tombstones.sql",
        "0003_account_deletion_identity_outbox.sql",
        "0004_revenuecat_entitlement_integrity.sql",
        "0005_revenuecat_worker_authority.sql",
        "0006_revenuecat_alias_provenance.sql",
        "0007_mobile_oauth_exchange.sql",
        "0008_community_safety.sql",
      ]);

      const pool = new Pool({ connectionString: databaseUrl });
      try {
        assert.deepEqual(
          await applicationTables(pool),
          expectedApplicationTables,
        );
        const applied = await pool.query(`
          SELECT name, count(*)::integer AS application_count
          FROM _elovia_schema_migrations
          GROUP BY name
          ORDER BY name
        `);
        assert.deepEqual(applied.rows, [
          { name: "0000_baseline.sql", application_count: 1 },
          {
            name: "0001_user_data_sync_integrity.sql",
            application_count: 1,
          },
          {
            name: "0002_account_deletion_tombstones.sql",
            application_count: 1,
          },
          {
            name: "0003_account_deletion_identity_outbox.sql",
            application_count: 1,
          },
          {
            name: "0004_revenuecat_entitlement_integrity.sql",
            application_count: 1,
          },
          {
            name: "0005_revenuecat_worker_authority.sql",
            application_count: 1,
          },
          {
            name: "0006_revenuecat_alias_provenance.sql",
            application_count: 1,
          },
          {
            name: "0007_mobile_oauth_exchange.sql",
            application_count: 1,
          },
          {
            name: "0008_community_safety.sql",
            application_count: 1,
          },
        ]);
        await pool.query(`
          INSERT INTO users (id) VALUES ('bootstrap-ready-user');
          INSERT INTO user_data (user_id) VALUES ('bootstrap-ready-user');
        `);
        const ready = await pool.query(
          "SELECT revision FROM user_data WHERE user_id = 'bootstrap-ready-user'",
        );
        assert.equal(ready.rows[0].revision, "1");
      } finally {
        await pool.end();
      }
    });
  },
);

integrationTest(
  "concurrent migration runners serialize every version exactly once",
  async () => {
    await withTemporaryDatabase(async (databaseUrl) => {
      const results = await Promise.all([
        runMigrations(databaseUrl),
        runMigrations(databaseUrl),
      ]);
      assert.deepEqual(results.flat().sort(), [
        "0000_baseline.sql",
        "0001_user_data_sync_integrity.sql",
        "0002_account_deletion_tombstones.sql",
        "0003_account_deletion_identity_outbox.sql",
        "0004_revenuecat_entitlement_integrity.sql",
        "0005_revenuecat_worker_authority.sql",
        "0006_revenuecat_alias_provenance.sql",
        "0007_mobile_oauth_exchange.sql",
        "0008_community_safety.sql",
      ]);

      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const applied = await pool.query(`
          SELECT name, count(*)::integer AS application_count
          FROM _elovia_schema_migrations
          GROUP BY name
          ORDER BY name
        `);
        assert.deepEqual(applied.rows, [
          { name: "0000_baseline.sql", application_count: 1 },
          {
            name: "0001_user_data_sync_integrity.sql",
            application_count: 1,
          },
          {
            name: "0002_account_deletion_tombstones.sql",
            application_count: 1,
          },
          {
            name: "0003_account_deletion_identity_outbox.sql",
            application_count: 1,
          },
          {
            name: "0004_revenuecat_entitlement_integrity.sql",
            application_count: 1,
          },
          {
            name: "0005_revenuecat_worker_authority.sql",
            application_count: 1,
          },
          {
            name: "0006_revenuecat_alias_provenance.sql",
            application_count: 1,
          },
          {
            name: "0007_mobile_oauth_exchange.sql",
            application_count: 1,
          },
          {
            name: "0008_community_safety.sql",
            application_count: 1,
          },
        ]);
      } finally {
        await pool.end();
      }
    });
  },
);

integrationTest(
  "line-ending normalization tolerates CRLF but rejects checksum tampering atomically",
  async () => {
    const migrationsDirectory = await mkdtemp(
      join(tmpdir(), "elovia-migrations-"),
    );
    const migrationNames = [
      "0000_baseline.sql",
      "0001_user_data_sync_integrity.sql",
      "0002_account_deletion_tombstones.sql",
      "0003_account_deletion_identity_outbox.sql",
      "0004_revenuecat_entitlement_integrity.sql",
      "0005_revenuecat_worker_authority.sql",
      "0006_revenuecat_alias_provenance.sql",
      "0007_mobile_oauth_exchange.sql",
      "0008_community_safety.sql",
    ];

    try {
      for (const name of migrationNames) {
        const source = await readFile(
          new URL(name, baselineMigrationUrl),
          "utf8",
        );
        await writeFile(
          join(migrationsDirectory, name),
          source.replace(/\r\n?|\n/g, "\r\n"),
          "utf8",
        );
      }

      await withTemporaryDatabase(async (databaseUrl) => {
        await runMigrations(databaseUrl);
        assert.deepEqual(
          await runMigrations(databaseUrl, { migrationsDirectory }),
          [],
        );

        const changedMigration = join(
          migrationsDirectory,
          "0001_user_data_sync_integrity.sql",
        );
        await writeFile(
          changedMigration,
          `${await readFile(changedMigration, "utf8")}\r\n-- checksum tampering\r\n`,
          "utf8",
        );
        await writeFile(
          join(migrationsDirectory, "0000z_partial_state.sql"),
          'CREATE TABLE "migration_partial_state" ("id" integer PRIMARY KEY);\r\n',
          "utf8",
        );

        await assert.rejects(
          runMigrations(databaseUrl, { migrationsDirectory }),
          /modified after it was applied/i,
        );

        const pool = new Pool({ connectionString: databaseUrl });
        try {
          const state = await pool.query(`
            SELECT
              to_regclass('public.migration_partial_state') AS partial_table,
              count(*)::integer AS migration_count
            FROM _elovia_schema_migrations
          `);
          assert.deepEqual(state.rows[0], {
            partial_table: null,
            migration_count: migrationNames.length,
          });
        } finally {
          await pool.end();
        }
      });
    } finally {
      await rm(migrationsDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "verifier cleanup preserves the primary PostgreSQL diagnostic",
  async () => {
    const migrationsDirectory = await mkdtemp(
      join(tmpdir(), "elovia-diagnostic-migrations-"),
    );
    const missingRelation = "verifier_primary_diagnostic_sentinel";

    try {
      const baseline = await readFile(baselineMigrationUrl, "utf8");
      const syncMigration = await readFile(
        new URL("0001_user_data_sync_integrity.sql", baselineMigrationUrl),
        "utf8",
      );
      await writeFile(
        join(migrationsDirectory, "0000_baseline.sql"),
        `${baseline}\nSELECT * FROM ${missingRelation};\n`,
        "utf8",
      );
      await writeFile(
        join(migrationsDirectory, "0001_user_data_sync_integrity.sql"),
        syncMigration,
        "utf8",
      );

      await withTemporaryDatabase(async (databaseUrl) => {
        const setupPool = new Pool({ connectionString: databaseUrl });
        try {
          await provisionLegacySchema(setupPool);
        } finally {
          await setupPool.end();
        }

        await assert.rejects(
          runMigrations(databaseUrl, { migrationsDirectory }),
          (error) => {
            assert.equal(error.code, "42P01");
            assert.match(error.message, new RegExp(missingRelation));
            assert.doesNotMatch(error.message, /transaction is aborted/i);
            return true;
          },
        );

        const verificationPool = new Pool({ connectionString: databaseUrl });
        try {
          await assertNoMigrationRecords(verificationPool);
        } finally {
          await verificationPool.end();
        }
      });
    } finally {
      await rm(migrationsDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "baseline adoption rejects a sync column with wrong type, nullability, and default",
  async () => {
    await assertAdoptionRefused({
      mutate: (pool) =>
        pool.query(
          "ALTER TABLE user_data ADD COLUMN revision integer DEFAULT 2",
        ),
      verify: async (pool) => {
        const column = await pool.query(`
          SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'user_data'
            AND column_name = 'revision'
        `);
        assert.deepEqual(column.rows[0], {
          data_type: "integer",
          is_nullable: "YES",
          column_default: "2",
        });
        assert.deepEqual(await existingSyncIntegrityColumns(pool), [
          "revision",
        ]);
      },
    });
  },
);

integrationTest(
  "baseline adoption rejects a same-named but incompatible revision check",
  async () => {
    await assertAdoptionRefused({
      mutate: (pool) =>
        pool.query(`
          ALTER TABLE user_data ADD COLUMN revision bigint NOT NULL DEFAULT 1;
          ALTER TABLE user_data
            ADD CONSTRAINT user_data_revision_safe
            CHECK (revision >= 0 AND revision <= 9007199254740991);
        `),
      verify: async (pool) => {
        const constraint = await pool.query(`
          SELECT pg_get_constraintdef(oid, true) AS definition
          FROM pg_constraint
          WHERE conname = 'user_data_revision_safe'
            AND conrelid = 'public.user_data'::regclass
        `);
        assert.match(constraint.rows[0].definition, /revision >= 0/);
        assert.deepEqual(await existingSyncIntegrityColumns(pool), [
          "revision",
        ]);
      },
    });
  },
);

integrationTest(
  "baseline adoption rejects an index with the right name and wrong key",
  async () => {
    await assertAdoptionRefused({
      mutate: (pool) =>
        pool.query(`
          DROP INDEX "IDX_ai_usage_day";
          CREATE INDEX "IDX_ai_usage_day" ON ai_usage (provider);
        `),
      verify: async (pool) => {
        const index = await pool.query(`
          SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'IDX_ai_usage_day'
        `);
        assert.match(index.rows[0].indexdef, /\(provider\)/);
        assert.deepEqual(await existingSyncIntegrityColumns(pool), []);
      },
    });
  },
);

integrationTest(
  "baseline adoption rejects a primary key with incompatible column order",
  async () => {
    await assertAdoptionRefused({
      mutate: (pool) =>
        pool.query(`
          ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_pkey;
          ALTER TABLE ai_usage
            ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (user_id, id);
        `),
      verify: async (pool) => {
        const primaryKey = await pool.query(`
          SELECT pg_get_constraintdef(oid, true) AS definition
          FROM pg_constraint
          WHERE conname = 'ai_usage_pkey'
            AND conrelid = 'public.ai_usage'::regclass
        `);
        assert.equal(
          primaryKey.rows[0].definition,
          "PRIMARY KEY (user_id, id)",
        );
        assert.deepEqual(await existingSyncIntegrityColumns(pool), []);
      },
    });
  },
);

integrationTest(
  "baseline adoption rejects a missing required table without partial migration state",
  async () => {
    await assertAdoptionRefused({
      mutate: (pool) => pool.query("DROP TABLE supplements CASCADE"),
      verify: async (pool) => {
        const missingTable = await pool.query(
          "SELECT to_regclass('public.supplements')::text AS table_name",
        );
        assert.equal(missingTable.rows[0].table_name, null);
        assert.deepEqual(await existingSyncIntegrityColumns(pool), []);
      },
    });
  },
);

integrationTest(
  "the HTTP contract accepts string/null identifiers and rejects objects/numbers",
  async () => {
    const validResponse = await fetch(`${routeBaseUrl}/user-data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: null,
        activePlanType: "custom",
        activeCustomPlanId: null,
        activeMealPlanType: "custom-meal",
        activeCustomMealPlanId: null,
      }),
    });
    assert.equal(validResponse.status, 200);
    assert.deepEqual(await validResponse.json(), {
      success: true,
      revision: 1,
    });

    for (const payload of [
      { baseRevision: 1, activePlanType: { invalid: true } },
      { baseRevision: 1, activeCustomPlanId: 7 },
      { baseRevision: 1, activeMealPlanType: { invalid: true } },
      { baseRevision: 1, activeCustomMealPlanId: 7 },
      { baseRevision: 1, sessions: {} },
      { baseRevision: 1, foodLog: {} },
      { baseRevision: 1, activeSession: [] },
      { baseRevision: 1, waterGoal: 0 },
    ]) {
      const invalidResponse = await fetch(`${routeBaseUrl}/user-data`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(invalidResponse.status, 400);
      assert.deepEqual(await invalidResponse.json(), {
        error: {
          code: "VALIDATION_ERROR",
          message: "Cloud snapshot payload is invalid.",
          retryable: false,
        },
      });
    }

    const getResponse = await fetch(`${routeBaseUrl}/user-data`);
    assert.equal(getResponse.headers.get("cache-control"), "private, no-store");
    const snapshot = await getResponse.json();
    assert.deepEqual(Object.keys(snapshot), ["data", "revision", "updatedAt"]);
    assert.deepEqual(Object.keys(snapshot.data), expectedUserDataFields);
    assert.deepEqual(snapshot.data, {
      appState: null,
      workoutPlan: null,
      customPlans: null,
      activePlanType: "custom",
      activeCustomPlanId: null,
      activeSession: null,
      sessions: null,
      personalRecords: null,
      mealPlan: null,
      foodLog: null,
      customMealPlans: null,
      activeMealPlanType: "custom-meal",
      activeCustomMealPlanId: null,
      healthData: null,
      wellnessData: null,
      waterGoal: null,
      reminderPrefs: null,
      places: null,
    });
    assert.equal(snapshot.revision, 1);
    assert.equal(
      new Date(snapshot.updatedAt).toISOString(),
      snapshot.updatedAt,
    );
    assert.equal("userId" in snapshot.data, false);
    assert.equal("updatedAt" in snapshot.data, false);
  },
);

integrationTest(
  "a pre-provisioned schema adopts the baseline and gains sync columns",
  async () => {
    const tables = await scopedPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
        AND table_name <> '_elovia_schema_migrations'
      ORDER BY table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      expectedApplicationTables,
    );

    const applied = await scopedPool.query(`
      SELECT name
      FROM _elovia_schema_migrations
      ORDER BY name
    `);
    assert.deepEqual(
      applied.rows.map((row) => row.name),
      [
        "0000_baseline.sql",
        "0001_user_data_sync_integrity.sql",
        "0002_account_deletion_tombstones.sql",
        "0003_account_deletion_identity_outbox.sql",
        "0004_revenuecat_entitlement_integrity.sql",
        "0005_revenuecat_worker_authority.sql",
        "0006_revenuecat_alias_provenance.sql",
        "0007_mobile_oauth_exchange.sql",
        "0008_community_safety.sql",
      ],
    );

    const result = await scopedPool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_data'
      AND column_name IN (
        'revision', 'active_session', 'wellness_data',
        'water_goal', 'reminder_prefs', 'places'
      )
    ORDER BY column_name
  `);

    assert.deepEqual(result.rows, [
      { column_name: "active_session", data_type: "jsonb" },
      { column_name: "places", data_type: "jsonb" },
      { column_name: "reminder_prefs", data_type: "jsonb" },
      { column_name: "revision", data_type: "bigint" },
      { column_name: "water_goal", data_type: "jsonb" },
      { column_name: "wellness_data", data_type: "jsonb" },
    ]);
  },
);

integrationTest(
  "concurrent creates return one save and one typed conflict",
  async () => {
    await scopedPool.query("INSERT INTO users (id) VALUES ('create-user')");

    const results = await Promise.all([
      saveUserData(db, "create-user", {
        baseRevision: null,
        appState: { side: 1 },
      }),
      saveUserData(db, "create-user", {
        baseRevision: null,
        appState: { side: 2 },
      }),
    ]);

    assert.deepEqual(results.map((result) => result.kind).sort(), [
      "conflict",
      "saved",
    ]);
    assert.equal(results.find((result) => result.kind === "saved").revision, 1);
    assert.equal(
      results.find((result) => result.kind === "conflict").currentRevision,
      1,
    );
  },
);

integrationTest(
  "neutral account locks run for missing and deleted accounts and reject empty identities",
  async () => {
    const missing = await withAccountLock(
      "neutral-lock-missing",
      async (transaction) => {
        const result = await transaction.execute(sql`
        SELECT count(*)::integer AS count
        FROM users WHERE id='neutral-lock-missing'
      `);
        return result.rows[0].count;
      },
    );
    assert.equal(missing, 0);

    await scopedPool.query(
      "INSERT INTO users (id) VALUES ('neutral-lock-deleted')",
    );
    await tombstoneAndDeleteAccountData(
      "neutral-lock-deleted",
      "neutral-lock-request",
    );
    assert.equal(
      await withAccountLock("neutral-lock-deleted", async () => "callback-ran"),
      "callback-ran",
    );
    await assert.rejects(
      withAccountLock("", async () => undefined),
      /account id must not be empty/i,
    );
    await assert.rejects(
      withAccountLocks(["valid-lock", ""], async () => undefined),
      /account id must not be empty/i,
    );
  },
);

integrationTest(
  "multi-account locks dedupe exact strings and remain deadlock-free in UTF-8 byte order",
  async () => {
    let firstCallbacks = 0;
    let secondCallbacks = 0;
    const run = Promise.all([
      withAccountLocks(["z-lock", "é-lock", "z-lock"], async (transaction) => {
        firstCallbacks += 1;
        const locks = await transaction.execute(sql`
          SELECT count(*)::integer AS count
          FROM pg_locks
          WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
        `);
        assert.equal(locks.rows[0].count, 2);
      }),
      withAccountLocks(["é-lock", "z-lock"], async () => {
        secondCallbacks += 1;
      }),
    ]);
    await withTimeout(run, "neutral account lock ordering deadlocked", 2_000);
    assert.equal(firstCallbacks, 1);
    assert.equal(secondCallbacks, 1);
  },
);

integrationTest(
  "account deletion tombstone serializes provisioning and survives repeated deletion",
  async () => {
    const userId = "deletion-race-user";
    const authUser = {
      id: userId,
      email: "deletion-race@example.invalid",
      firstName: "Delete",
      lastName: "Race",
      profileImageUrl: null,
    };
    await scopedPool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
      userId,
      authUser.email,
    ]);
    await scopedPool.query(
      "INSERT INTO user_data (user_id, app_state) VALUES ($1, $2::jsonb)",
      [userId, JSON.stringify({ private: true })],
    );

    await Promise.all([
      provisionAuthenticatedUserIfActive(authUser),
      tombstoneAndDeleteAccountData(userId, "deletion-request-first"),
      provisionAuthenticatedUserIfActive(authUser),
    ]);

    assert.equal(
      await provisionAuthenticatedUserIfActive(authUser),
      "deleted",
      "post-tombstone auth cannot recreate the user",
    );
    const repeated = await tombstoneAndDeleteAccountData(
      userId,
      "deletion-request-second",
    );
    assert.equal(repeated.requestId, "deletion-request-first");
    assert.equal(repeated.status, "identity_pending");

    const persisted = await scopedPool.query(
      `
        SELECT
          (SELECT count(*)::integer FROM users WHERE id = $1) AS users,
          (SELECT count(*)::integer FROM user_data WHERE user_id = $1) AS user_data,
          (SELECT count(*)::integer FROM account_deletions WHERE user_id = $1) AS tombstones
      `,
      [userId],
    );
    assert.deepEqual(persisted.rows[0], {
      users: 0,
      user_data: 0,
      tombstones: 1,
    });

    assert.equal(await finalizeAccountDeletion(userId), true);
    assert.equal(await finalizeAccountDeletion(userId), true);
    const finalized = await scopedPool.query(
      "SELECT status, finalized_at IS NOT NULL AS finalized FROM account_deletions WHERE user_id = $1",
      [userId],
    );
    assert.deepEqual(finalized.rows[0], {
      status: "finalized",
      finalized: true,
    });
  },
);

integrationTest(
  "account identity outbox leases once, rejects stale ownership, and finalizes durably",
  async () => {
    // Earlier deletion scenarios intentionally leave durable tombstones behind.
    // This claim test owns its queue state, so isolate it from those fixtures.
    await scopedPool.query("DELETE FROM account_deletions");
    const userId = "deletion-outbox-user";
    await scopedPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await tombstoneAndDeleteAccountData(userId, "deletion-outbox-request");

    const firstClaims = await claimPendingAccountDeletionIdentities({
      leaseId: "deletion-lease-first",
      limit: 5,
      leaseSeconds: 120,
    });
    assert.equal(firstClaims.length, 1);
    assert.equal(firstClaims[0].userId, userId);
    assert.equal(firstClaims[0].attemptCount, 1);
    assert.deepEqual(
      await claimPendingAccountDeletionIdentities({
        leaseId: "deletion-lease-overlap",
        limit: 5,
        leaseSeconds: 120,
      }),
      [],
    );
    assert.equal(
      await rescheduleClaimedAccountDeletionIdentity(
        { ...firstClaims[0], leaseId: "stale-lease" },
        new Date(0),
      ),
      false,
    );
    assert.equal(
      await rescheduleClaimedAccountDeletionIdentity(
        firstClaims[0],
        new Date(0),
      ),
      true,
    );

    const retryClaims = await claimPendingAccountDeletionIdentities({
      leaseId: "deletion-lease-retry",
      limit: 5,
      leaseSeconds: 120,
    });
    assert.equal(retryClaims.length, 1);
    assert.equal(retryClaims[0].attemptCount, 2);
    assert.equal(
      await finalizeClaimedAccountDeletionIdentity(firstClaims[0]),
      false,
      "an expired worker cannot finalize a newer lease",
    );
    assert.equal(
      await finalizeClaimedAccountDeletionIdentity(retryClaims[0]),
      true,
    );
    assert.deepEqual(
      await claimPendingAccountDeletionIdentities({
        leaseId: "deletion-lease-after-finalize",
        limit: 5,
        leaseSeconds: 120,
      }),
      [],
    );

    const persisted = await scopedPool.query(
      `SELECT status, identity_attempt_count, identity_lease_id
       FROM account_deletions WHERE user_id = $1`,
      [userId],
    );
    assert.deepEqual(persisted.rows[0], {
      status: "finalized",
      identity_attempt_count: 2,
      identity_lease_id: null,
    });
  },
);

integrationTest(
  "concurrent updates return one save and one conflict",
  async () => {
    await scopedPool.query("INSERT INTO users (id) VALUES ('update-user')");
    await saveUserData(db, "update-user", {
      baseRevision: null,
      appState: { initial: true },
    });

    const results = await Promise.all([
      saveUserData(db, "update-user", { baseRevision: 1, sessions: ["a"] }),
      saveUserData(db, "update-user", { baseRevision: 1, sessions: ["b"] }),
    ]);

    assert.deepEqual(results.map((result) => result.kind).sort(), [
      "conflict",
      "saved",
    ]);
    assert.equal(results.find((result) => result.kind === "saved").revision, 2);
    assert.equal(
      results.find((result) => result.kind === "conflict").currentRevision,
      2,
    );
  },
);

integrationTest(
  "deletion after the revision read reports a null current revision",
  async () => {
    await scopedPool.query("INSERT INTO users (id) VALUES ('deleted-user')");
    await saveUserData(db, "deleted-user", {
      baseRevision: null,
      appState: { initial: true },
    });

    let notifyRevisionRead;
    let resumeUpdate;
    const revisionRead = new Promise((resolve) => {
      notifyRevisionRead = resolve;
    });
    const updateMayResume = new Promise((resolve) => {
      resumeUpdate = resolve;
    });

    const save = saveUserData(
      db,
      "deleted-user",
      { baseRevision: 1, sessions: [{ id: "never-written" }] },
      {
        afterRevisionRead: async () => {
          notifyRevisionRead();
          await updateMayResume;
        },
      },
    );

    await withTimeout(
      revisionRead,
      "saveUserData did not expose its deterministic post-read test hook",
    );
    try {
      await scopedPool.query(
        "DELETE FROM user_data WHERE user_id = 'deleted-user'",
      );
    } finally {
      resumeUpdate();
    }

    assert.deepEqual(await save, {
      kind: "conflict",
      currentRevision: null,
    });
    const remaining = await scopedPool.query(
      "SELECT revision FROM user_data WHERE user_id = 'deleted-user'",
    );
    assert.equal(remaining.rowCount, 0);
  },
);

integrationTest("partial patches preserve omitted fields", async () => {
  await scopedPool.query("INSERT INTO users (id) VALUES ('partial-user')");
  await saveUserData(db, "partial-user", {
    baseRevision: null,
    appState: { retained: true },
    activePlanType: "generated",
  });
  await saveUserData(db, "partial-user", {
    baseRevision: 1,
    sessions: [{ id: "session-1" }],
  });

  const loaded = await loadUserData(db, "partial-user");
  assert.deepEqual(loaded.data.appState, { retained: true });
  assert.equal(loaded.data.activePlanType, "generated");
  assert.deepEqual(loaded.data.sessions, [{ id: "session-1" }]);
});

integrationTest(
  "load serialization exposes exact fields, revision, and ISO time",
  async () => {
    const loaded = await loadUserData(db, "partial-user");
    assert.deepEqual(Object.keys(loaded.data), expectedUserDataFields);
    assert.equal(loaded.revision, 2);
    assert.equal(new Date(loaded.updatedAt).toISOString(), loaded.updatedAt);
  },
);
