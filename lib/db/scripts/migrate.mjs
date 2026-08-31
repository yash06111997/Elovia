import { createHash } from "node:crypto";
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
  "user_data_revision_safe",
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

function baselineManifest(sql) {
  const tables = new Map();
  for (const match of sql.matchAll(
    /CREATE TABLE "([^"]+)" \(\n([\s\S]*?)\n\);/g,
  )) {
    const [, tableName, definition] = match;
    const columns = [];
    for (const line of definition.split("\n")) {
      const column = line.match(/^\s*"([^"]+)"\s/);
      if (column) {
        columns.push(column[1]);
      }
    }
    tables.set(tableName, {
      columns,
      requiresPrimaryKey: definition.includes("PRIMARY KEY"),
    });
  }

  const indexes = new Set(
    [...sql.matchAll(/CREATE(?: UNIQUE)? INDEX "([^"]+)" ON /g)].map(
      (match) => match[1],
    ),
  );
  const constraints = new Set(
    [...sql.matchAll(/CONSTRAINT "([^"]+)"/g)]
      .map((match) => match[1])
      .filter(
        (constraint) => !BASELINE_ADOPTION_OPTIONAL_CONSTRAINTS.has(constraint),
      ),
  );

  if (tables.size === 0) {
    throw new Error("The baseline migration does not define any tables.");
  }

  return { tables, indexes, constraints };
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

async function verifyBaselineAdoption(client, sql) {
  const manifest = baselineManifest(sql);
  const existingTables = await existingApplicationTables(client);
  const columns = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
  `);
  const indexes = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
  `);
  const constraints = await client.query(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
  `);
  const primaryKeys = await client.query(`
    SELECT table_name
    FROM information_schema.table_constraints
    WHERE constraint_schema = current_schema()
      AND constraint_type = 'PRIMARY KEY'
  `);

  const existingColumns = new Set(
    columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
  );
  const existingIndexes = new Set(indexes.rows.map((row) => row.indexname));
  const existingConstraints = new Set(
    constraints.rows.map((row) => row.constraint_name),
  );
  const existingPrimaryKeys = new Set(
    primaryKeys.rows.map((row) => row.table_name),
  );
  const missing = [];

  for (const [tableName, table] of manifest.tables) {
    if (!existingTables.has(tableName)) {
      missing.push(`table ${tableName}`);
      continue;
    }
    for (const columnName of table.columns) {
      const qualifiedColumn = `${tableName}.${columnName}`;
      if (
        !BASELINE_ADOPTION_OPTIONAL_COLUMNS.has(qualifiedColumn) &&
        !existingColumns.has(qualifiedColumn)
      ) {
        missing.push(`column ${qualifiedColumn}`);
      }
    }
    if (table.requiresPrimaryKey && !existingPrimaryKeys.has(tableName)) {
      missing.push(`primary key ${tableName}`);
    }
  }

  for (const indexName of manifest.indexes) {
    if (!existingIndexes.has(indexName)) {
      missing.push(`index ${indexName}`);
    }
  }
  for (const constraintName of manifest.constraints) {
    if (!existingConstraints.has(constraintName)) {
      missing.push(`constraint ${constraintName}`);
    }
  }

  if (missing.length) {
    throw new Error(
      `Existing schema cannot adopt ${BASELINE_MIGRATION}; missing required objects: ${missing.join(", ")}.`,
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
