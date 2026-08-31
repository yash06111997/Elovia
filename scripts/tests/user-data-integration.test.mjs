import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error(
    "CI must provide TEST_DATABASE_URL for user-data integration tests",
  );
}

const integrationTest = testDatabaseUrl ? test : test.skip;
const schemaName = `elovia_sync_test_${process.pid}_${Date.now()}`;
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
let scopedPool;
let workspacePool;
let db;
let saveUserData;
let loadUserData;
let runMigrations;
let unregisterTsx;
let routeServer;
let routeBaseUrl;

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scopedDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
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
    const { Pool } = pg;
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schemaName)}`);

    const databaseUrl = scopedDatabaseUrl(testDatabaseUrl);
    scopedPool = new Pool({ connectionString: databaseUrl });
    await scopedPool.query(`
      CREATE TABLE users (
        id varchar PRIMARY KEY,
        email varchar UNIQUE,
        first_name varchar,
        last_name varchar,
        profile_image_url varchar,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE user_data (
        user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        app_state jsonb,
        workout_plan jsonb,
        custom_plans jsonb,
        active_plan_type varchar,
        active_custom_plan_id varchar,
        sessions jsonb,
        personal_records jsonb,
        meal_plan jsonb,
        food_log jsonb,
        custom_meal_plans jsonb,
        active_meal_plan_type varchar,
        active_custom_meal_plan_id varchar,
        health_data jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    ({ runMigrations } = await import("../../lib/db/scripts/migrate.mjs"));
    await runMigrations(databaseUrl);
    await runMigrations(databaseUrl);

    process.env.DATABASE_URL = databaseUrl;
    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    db = databaseModule.db;
    workspacePool = databaseModule.pool;
    ({ loadUserData, saveUserData } =
      await import("../../artifacts/api-server/src/services/userDataStore.ts"));

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
  "the HTTP contract accepts string/null identifiers and rejects objects/numbers",
  async () => {
    const validResponse = await fetch(`${routeBaseUrl}/user-data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: null,
        activePlanType: "custom",
        activeCustomPlanId: null,
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
    assert.equal(snapshot.data.activePlanType, "custom");
    assert.equal(snapshot.data.activeCustomPlanId, null);
    assert.equal(snapshot.revision, 1);
  },
);

integrationTest(
  "old user-data schemas gain every sync-integrity column",
  async () => {
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
    assert.deepEqual(Object.keys(loaded.data), [
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
    ]);
    assert.equal(loaded.revision, 2);
    assert.equal(new Date(loaded.updatedAt).toISOString(), loaded.updatedAt);
  },
);
