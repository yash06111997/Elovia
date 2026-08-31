import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const defaultMigrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const BASELINE_MIGRATION = "0000_baseline.sql";
const MIGRATION_LOCK_ID = 2_026_083_101;
const BASELINE_ADOPTION_OPTIONAL_COLUMNS = new Set([
  "user_data.revision",
  "user_data.active_session",
  "user_data.wellness_data",
  "user_data.water_goal",
  "user_data.reminder_prefs",
  "user_data.places",
]);
const BASELINE_ADOPTION_OPTIONAL_CONSTRAINTS = new Set([
  "user_data.user_data_revision_safe",
]);

function normalizeSql(sql) {
  return sql.replace(/\r\n?/g, "\n");
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function checksumDetails(rawSql) {
  const sql = normalizeSql(rawSql);
  return {
    sql,
    canonical: checksum(sql),
    lineEndingVariants: new Set([
      checksum(sql),
      checksum(rawSql),
      checksum(sql.replaceAll("\n", "\r\n")),
    ]),
  };
}

function migrationDirectoryPath(migrationsDirectory) {
  if (migrationsDirectory instanceof URL) {
    return fileURLToPath(migrationsDirectory);
  }
  return resolve(migrationsDirectory ?? defaultMigrationsDirectory);
}

async function orderedMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function existingApplicationTables(client) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name <> '_elovia_schema_migrations'
  `);
  return new Set(result.rows.map((row) => row.table_name));
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDefinition(value, schemaName) {
  if (value === null || typeof value !== "string") {
    return value;
  }

  const escapedSchema = escapeRegExp(schemaName);
  return value
    .replace(new RegExp(`"${escapedSchema}"\\.`, "g"), "")
    .replace(new RegExp(`\\b${escapedSchema}\\.`, "g"), "")
    .trim();
}

function normalizeMetadataRows(rows, schemaName) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.map((item) => normalizeDefinition(item, schemaName))
          : normalizeDefinition(value, schemaName),
      ]),
    ),
  );
}

async function loadSchemaMetadata(client, schemaName) {
  const tables = await client.query(
    `
      SELECT
        relation.relname AS table_name,
        relation.relkind AS relation_kind,
        relation.relpersistence AS persistence
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> '_elovia_schema_migrations'
      ORDER BY relation.relname
    `,
    [schemaName],
  );
  const columns = await client.query(
    `
      SELECT
        relation.relname AS table_name,
        attribute.attname AS column_name,
        format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
        attribute.attnotnull AS not_null,
        attribute.attidentity AS identity,
        attribute.attgenerated AS generated,
        pg_get_expr(default_value.adbin, default_value.adrelid, false) AS default_expression
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
      LEFT JOIN pg_attrdef AS default_value
        ON default_value.adrelid = relation.oid
        AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = $1
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> '_elovia_schema_migrations'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum
    `,
    [schemaName],
  );
  const constraints = await client.query(
    `
      SELECT
        relation.relname AS table_name,
        constraint_record.conname AS constraint_name,
        constraint_record.contype AS constraint_type,
        constraint_record.condeferrable AS deferrable,
        constraint_record.condeferred AS initially_deferred,
        constraint_record.convalidated AS validated,
        pg_get_constraintdef(constraint_record.oid, false) AS definition
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = $1
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> '_elovia_schema_migrations'
      ORDER BY relation.relname, constraint_record.conname
    `,
    [schemaName],
  );
  const indexes = await client.query(
    `
      SELECT
        table_record.relname AS table_name,
        index_record.relname AS index_name,
        access_method.amname AS access_method,
        index_metadata.indisunique AS is_unique,
        index_metadata.indisprimary AS is_primary,
        index_metadata.indisvalid AS is_valid,
        index_metadata.indisready AS is_ready,
        index_metadata.indnullsnotdistinct AS nulls_not_distinct,
        ARRAY(
          SELECT pg_get_indexdef(index_metadata.indexrelid, position, false)
          FROM generate_series(1, index_metadata.indnkeyatts) AS position
          ORDER BY position
        ) AS key_expressions,
        pg_get_expr(index_metadata.indpred, index_metadata.indrelid, false) AS predicate,
        pg_get_indexdef(index_metadata.indexrelid, 0, false) AS definition
      FROM pg_index AS index_metadata
      JOIN pg_class AS index_record ON index_record.oid = index_metadata.indexrelid
      JOIN pg_class AS table_record ON table_record.oid = index_metadata.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = table_record.relnamespace
      JOIN pg_am AS access_method ON access_method.oid = index_record.relam
      WHERE namespace.nspname = $1
        AND table_record.relkind IN ('r', 'p')
        AND table_record.relname <> '_elovia_schema_migrations'
      ORDER BY table_record.relname, index_record.relname
    `,
    [schemaName],
  );

  return {
    tables: normalizeMetadataRows(tables.rows, schemaName),
    columns: normalizeMetadataRows(columns.rows, schemaName),
    constraints: normalizeMetadataRows(constraints.rows, schemaName),
    indexes: normalizeMetadataRows(indexes.rows, schemaName),
  };
}

function compareRequiredMetadata({
  kind,
  expected,
  actual,
  keyFields,
  optional = new Set(),
}) {
  const keyFor = (row) => keyFields.map((field) => row[field]).join(".");
  const actualByKey = new Map(actual.map((row) => [keyFor(row), row]));
  const mismatches = [];

  for (const expectedRow of expected) {
    const key = keyFor(expectedRow);
    const actualRow = actualByKey.get(key);
    if (!actualRow) {
      if (!optional.has(key)) {
        mismatches.push(`missing ${kind} ${key}`);
      }
      continue;
    }

    if (JSON.stringify(actualRow) !== JSON.stringify(expectedRow)) {
      mismatches.push(
        `incompatible ${kind} ${key}: expected ${JSON.stringify(expectedRow)}, found ${JSON.stringify(actualRow)}`,
      );
    }
  }

  return mismatches;
}

function semanticMismatches(expected, actual) {
  return [
    ...compareRequiredMetadata({
      kind: "table",
      expected: expected.tables,
      actual: actual.tables,
      keyFields: ["table_name"],
    }),
    ...compareRequiredMetadata({
      kind: "column",
      expected: expected.columns,
      actual: actual.columns,
      keyFields: ["table_name", "column_name"],
      optional: BASELINE_ADOPTION_OPTIONAL_COLUMNS,
    }),
    ...compareRequiredMetadata({
      kind: "constraint",
      expected: expected.constraints,
      actual: actual.constraints,
      keyFields: ["table_name", "constraint_name"],
      optional: BASELINE_ADOPTION_OPTIONAL_CONSTRAINTS,
    }),
    ...compareRequiredMetadata({
      kind: "index",
      expected: expected.indexes,
      actual: actual.indexes,
      keyFields: ["table_name", "index_name"],
    }),
  ];
}

async function verifyBaselineAdoption(client, sql) {
  const schema = await client.query("SELECT current_schema() AS schema_name");
  const targetSchema = schema.rows[0]?.schema_name;
  if (!targetSchema) {
    throw new Error("Cannot determine the application schema for adoption.");
  }

  const verifierSchema = `_elovia_verify_${randomUUID().replaceAll("-", "")}`;
  const quotedTarget = quoteIdentifier(targetSchema);
  const quotedVerifier = quoteIdentifier(verifierSchema);
  let mismatches;

  await client.query(`CREATE SCHEMA ${quotedVerifier}`);
  try {
    await client.query(
      `SET LOCAL search_path TO ${quotedVerifier}, pg_catalog`,
    );
    await client.query(sql.replaceAll('"public".', `${quotedVerifier}.`));
    const expected = await loadSchemaMetadata(client, verifierSchema);

    await client.query(`SET LOCAL search_path TO ${quotedTarget}, pg_catalog`);
    const actual = await loadSchemaMetadata(client, targetSchema);
    mismatches = semanticMismatches(expected, actual);
  } finally {
    await client.query(`SET LOCAL search_path TO ${quotedTarget}, pg_catalog`);
    await client.query(`DROP SCHEMA ${quotedVerifier} CASCADE`);
  }

  if (mismatches.length) {
    throw new Error(
      `Existing schema cannot adopt ${BASELINE_MIGRATION}; ${mismatches.join("; ")}.`,
    );
  }
}

export async function runMigrations(
  connectionString = process.env.DATABASE_URL,
  { migrationsDirectory } = {},
) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  const directory = migrationDirectoryPath(migrationsDirectory);
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const appliedNow = [];

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_elovia_schema_migrations" (
        "name" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const name of await orderedMigrations(directory)) {
      const migration = checksumDetails(
        await readFile(join(directory, name), "utf8"),
      );
      const applied = await client.query(
        `SELECT "checksum" FROM "_elovia_schema_migrations" WHERE "name" = $1`,
        [name],
      );

      if (applied.rowCount) {
        if (!migration.lineEndingVariants.has(applied.rows[0].checksum)) {
          throw new Error(
            `Migration ${name} was modified after it was applied. Refusing to start.`,
          );
        }
        if (applied.rows[0].checksum !== migration.canonical) {
          await client.query(
            `UPDATE "_elovia_schema_migrations" SET "checksum" = $2 WHERE "name" = $1`,
            [name, migration.canonical],
          );
        }
        continue;
      }

      const existingTables = await existingApplicationTables(client);
      if (name === BASELINE_MIGRATION && existingTables.size > 0) {
        await verifyBaselineAdoption(client, migration.sql);
      } else {
        await client.query(migration.sql);
      }
      await client.query(
        `INSERT INTO "_elovia_schema_migrations" ("name", "checksum") VALUES ($1, $2)`,
        [name, migration.canonical],
      );
      appliedNow.push(name);
    }

    await client.query("COMMIT");
    return appliedNow;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  runMigrations()
    .then((applied) => {
      process.stdout.write(
        applied.length
          ? `Applied migrations: ${applied.join(", ")}\n`
          : "Database migrations are current.\n",
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Database migration failed: ${error instanceof Error ? error.message : "Unknown error"}\n`,
      );
      process.exitCode = 1;
    });
}
