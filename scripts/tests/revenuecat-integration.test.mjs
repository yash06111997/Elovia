import assert from "node:assert/strict";
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
const schemaName = `elovia_revenuecat_test_${process.pid}_${Date.now()}`;
const baselineMigrationUrl = new URL(
  "../../lib/db/migrations/0000_baseline.sql",
  import.meta.url,
);
const revenuecatMigrationUrl = new URL(
  "../../lib/db/migrations/0004_revenuecat_entitlement_integrity.sql",
  import.meta.url,
);
const requireFromDatabasePackage = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);

let Pool;
let adminPool;
let scopedPool;
let workspacePool;
let db;
let eq;
let usersTable;
let revenuecatSchema;
let runMigrations;
let unregisterTsx;
let temporaryDatabaseCounter = 0;

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scopedDatabaseUrl(databaseUrl, targetSchema = schemaName) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${targetSchema}`);
  return url.toString();
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

test("the forward-only RevenueCat migration contract is present", async () => {
  let sql;
  try {
    sql = await readFile(revenuecatMigrationUrl, "utf8");
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
  assert.doesNotMatch(sql, /INSERT INTO "revenuecat_webhook_events"/);
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
    await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schemaName)}`);
    const databaseUrl = scopedDatabaseUrl(testDatabaseUrl);
    ({ runMigrations } = await import("../../lib/db/scripts/migrate.mjs"));
    await runMigrations(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    db = databaseModule.db;
    workspacePool = databaseModule.pool;
    ({ usersTable } = await import("../../lib/db/src/schema/auth.ts"));
    ({ eq } = requireFromDatabasePackage("drizzle-orm"));
    revenuecatSchema = await import("../../lib/db/src/schema/revenuecat.ts");
    scopedPool = new Pool({ connectionString: databaseUrl });
  });

  after(async () => {
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

        assert.deepEqual(await runMigrations(databaseUrl), [migrationNames[4]]);
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
    SELECT trigger_record.tgname, procedure_record.proname,
           pg_get_triggerdef(trigger_record.oid) AS definition
    FROM pg_trigger trigger_record
    JOIN pg_proc procedure_record ON procedure_record.oid = trigger_record.tgfoid
    WHERE trigger_record.tgrelid = 'revenuecat_event_subjects'::regclass
      AND NOT trigger_record.tgisinternal
  `);
    assert.deepEqual(
      trigger.rows.map((row) => [row.tgname, row.proname]),
      [
        [
          "TR_revenuecat_count_pruned_subject",
          "revenuecat_count_pruned_subject",
        ],
      ],
    );
    assert.match(trigger.rows[0].definition, /AFTER DELETE/);
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
      identityCount: 1,
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
      `SELECT pruned_identity_count FROM revenuecat_webhook_events WHERE event_id='event_shared_1'`,
    );
    assert.equal(eventState.rows[0].pruned_identity_count, 1);
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
      `SELECT pruned_identity_count,
              (SELECT count(*)::integer FROM revenuecat_event_subjects
               WHERE event_id='event_shared_1') AS retained_subjects
       FROM revenuecat_webhook_events WHERE event_id='event_shared_1'`,
    );
    assert.deepEqual(fullyPruned.rows[0], {
      pruned_identity_count: 2,
      retained_subjects: 0,
    });
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
