import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const migrationsDirectory = new URL("../migrations/", import.meta.url);
const MIGRATION_LOCK_ID = 2_026_083_101;

async function orderedMigrations() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function runMigrations(
  connectionString = process.env.DATABASE_URL,
) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

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

    for (const name of await orderedMigrations()) {
      const sql = await readFile(new URL(name, migrationsDirectory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query(
        `SELECT "checksum" FROM "_elovia_schema_migrations" WHERE "name" = $1`,
        [name],
      );

      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(
            `Migration ${name} was modified after it was applied. Refusing to start.`,
          );
        }
        continue;
      }

      await client.query(sql);
      await client.query(
        `INSERT INTO "_elovia_schema_migrations" ("name", "checksum") VALUES ($1, $2)`,
        [name, checksum],
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
