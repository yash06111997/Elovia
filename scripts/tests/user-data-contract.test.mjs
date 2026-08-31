import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildUserDataPatch,
  MAX_SYNC_REVISION,
  parseUserDataWrite,
  revisionMatches,
  USER_DATA_FIELDS,
} from "../../artifacts/api-server/src/routes/userDataContract.ts";
import { apiErrorHandler } from "../../artifacts/api-server/src/middlewares/apiErrorHandler.ts";

const expectedFields = [
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

test("sync writes expose the complete synchronized field list", () => {
  assert.deepEqual(USER_DATA_FIELDS, expectedFields);
});

test("sync writes reject unknown fields and require a base revision", () => {
  assert.throws(() =>
    parseUserDataWrite({
      baseRevision: null,
      appState: {},
      unexpected: true,
    }),
  );
  assert.throws(() => parseUserDataWrite({ appState: {} }));
});

test("sync writes do not accept prototype-inherited contract fields", () => {
  const inheritedRevision = Object.create({ baseRevision: 7 });
  inheritedRevision.appState = { onboardingCompleted: true };

  assert.throws(() =>
    buildUserDataPatch(parseUserDataWrite(inheritedRevision)),
  );

  const inheritedSnapshotField = Object.create({
    healthData: { steps: 1_000 },
  });
  inheritedSnapshotField.baseRevision = 7;

  assert.throws(() =>
    buildUserDataPatch(parseUserDataWrite(inheritedSnapshotField)),
  );
});

test("sync writes discard inherited fields when own snapshot fields are valid", () => {
  const payload = Object.create({ healthData: { steps: 1_000 } });
  payload.baseRevision = 7;
  payload.sessions = [];

  const parsed = parseUserDataWrite(payload);
  assert.equal(Object.hasOwn(parsed, "healthData"), false);
  assert.deepEqual(buildUserDataPatch(parsed), { sessions: [] });
});

test("sync writes require at least one own-present synchronized field", () => {
  assert.throws(() => parseUserDataWrite({ baseRevision: null }));
});

test("sync writes reject explicit undefined synchronized values", () => {
  assert.throws(() =>
    parseUserDataWrite({ baseRevision: null, appState: undefined }),
  );
  assert.throws(() =>
    parseUserDataWrite({
      baseRevision: null,
      appState: undefined,
      sessions: [],
    }),
  );
});

test("sync writes reject invalid revisions without coercing them", () => {
  assert.throws(() => parseUserDataWrite({ baseRevision: -1, appState: {} }));
  assert.throws(() => parseUserDataWrite({ baseRevision: 1.5, appState: {} }));
  assert.throws(() => parseUserDataWrite({ baseRevision: "1", appState: {} }));
  assert.throws(() =>
    parseUserDataWrite({
      baseRevision: MAX_SYNC_REVISION + 1,
      appState: {},
    }),
  );
});

test("varchar snapshot fields accept only strings or explicit null", () => {
  const parsed = parseUserDataWrite({
    baseRevision: 4,
    activePlanType: "custom",
    activeCustomPlanId: null,
    activeMealPlanType: "generated",
    activeCustomMealPlanId: "meal-plan-1",
  });

  assert.deepEqual(buildUserDataPatch(parsed), {
    activePlanType: "custom",
    activeCustomPlanId: null,
    activeMealPlanType: "generated",
    activeCustomMealPlanId: "meal-plan-1",
  });

  for (const invalid of [
    { activePlanType: {} },
    { activeCustomPlanId: 7 },
    { activeMealPlanType: [] },
    { activeCustomMealPlanId: false },
  ]) {
    assert.throws(() => parseUserDataWrite({ baseRevision: 4, ...invalid }));
  }
});

test("sync patches preserve omission and permit explicit clearing", () => {
  assert.deepEqual(
    buildUserDataPatch({ baseRevision: 7, appState: null, sessions: [] }),
    { appState: null, sessions: [] },
  );
});

test("parsed sync writes preserve explicit null and omit absent fields", () => {
  const parsed = parseUserDataWrite({
    baseRevision: null,
    appState: null,
  });

  assert.equal(parsed.baseRevision, null);
  assert.equal(Object.hasOwn(parsed, "sessions"), false);
  assert.deepEqual(buildUserDataPatch(parsed), { appState: null });
});

test("sync patches omit synchronized fields that are not own-present", () => {
  const inherited = Object.create({ healthData: { steps: 1_000 } });
  inherited.baseRevision = 7;
  inherited.appState = { onboardingCompleted: true };

  assert.deepEqual(buildUserDataPatch(inherited), {
    appState: { onboardingCompleted: true },
  });
});

test("revision comparison distinguishes create, update, and conflict", () => {
  assert.equal(revisionMatches(null, null), true);
  assert.equal(revisionMatches(4, 4), true);
  assert.equal(revisionMatches(4, 3), false);
  assert.equal(revisionMatches(4, null), false);
  assert.equal(revisionMatches(4, "4"), false);
});

test("user-data routes enforce optimistic concurrency without destructive fallbacks", async () => {
  const routeSource = await readFile(
    new URL(
      "../../artifacts/api-server/src/routes/userData.ts",
      import.meta.url,
    ),
    "utf8",
  );
  let persistenceSource = routeSource;
  try {
    persistenceSource += await readFile(
      new URL(
        "../../artifacts/api-server/src/services/userDataStore.ts",
        import.meta.url,
      ),
      "utf8",
    );
  } catch {
    // The initial implementation kept persistence in the route. This fallback
    // lets the regression test go red on behavior, not merely file placement.
  }

  assert.match(routeSource, /parseUserDataWrite\(req\.body\)/);
  assert.match(routeSource, /status\(409\)/);
  assert.match(routeSource, /SYNC_CONFLICT/);
  assert.match(
    persistenceSource,
    /eq\(userDataTable\.revision, current\.revision\)/,
  );
  assert.doesNotMatch(persistenceSource, /appState:\s*appState\s*\?\?\s*null/);
  assert.match(persistenceSource, /revision:\s*row\.revision/);
  assert.match(
    persistenceSource,
    /updatedAt:\s*row\.updatedAt\.toISOString\(\)/,
  );
  assert.match(routeSource, /Cache-Control["'],\s*["']private, no-store/);
  assert.match(persistenceSource, /isolationLevel:\s*["']read committed["']/);
  assert.match(
    persistenceSource,
    /currentRevision:\s*latest\?\.revision\s*\?\?\s*null/,
  );
});

test("production startup runs ordered migrations and CI exercises PostgreSQL integration", async () => {
  const [
    dbPackage,
    apiPackage,
    migrationRunner,
    migrationSql,
    errorHandler,
    ci,
  ] = await Promise.all([
    readFile(new URL("../../lib/db/package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../../artifacts/api-server/package.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../lib/db/scripts/migrate.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../lib/db/migrations/0001_user_data_sync_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/middlewares/apiErrorHandler.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(
    JSON.parse(dbPackage).scripts.migrate,
    "node ./scripts/migrate.mjs",
  );
  assert.match(
    JSON.parse(apiPackage).scripts.prestart,
    /@workspace\/db migrate/,
  );
  assert.match(migrationRunner, /BEGIN/);
  assert.match(migrationRunner, /COMMIT/);
  assert.match(migrationRunner, /pg_advisory_xact_lock/);
  assert.match(migrationSql, /"revision" bigint/);
  assert.match(errorHandler, /VALIDATION_ERROR/);
  assert.match(errorHandler, /PAYLOAD_TOO_LARGE/);
  assert.match(ci, /services:\s*[\s\S]*postgres:/);
  assert.match(ci, /TEST_DATABASE_URL/);
});

function runApiErrorHandler(error) {
  let statusCode;
  let body;
  let forwarded;
  const response = {
    headersSent: false,
    status(status) {
      statusCode = status;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  const request = { log: { error() {} } };

  apiErrorHandler(error, request, response, (value) => {
    forwarded = value;
  });

  return { statusCode, body, forwarded };
}

test("API parser errors use stable validation envelopes", () => {
  const malformed = Object.assign(new SyntaxError("private parser detail"), {
    status: 400,
    type: "entity.parse.failed",
  });
  const result = runApiErrorHandler(malformed);

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, {
    error: {
      code: "VALIDATION_ERROR",
      message: "The request body is not valid JSON.",
      retryable: false,
    },
  });
  assert.equal(
    JSON.stringify(result.body).includes("private parser detail"),
    false,
  );
});

test("oversized request errors use a stable 413 envelope", () => {
  const result = runApiErrorHandler({
    status: 413,
    type: "entity.too.large",
    message: "private size detail",
  });

  assert.equal(result.statusCode, 413);
  assert.deepEqual(result.body, {
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "The request body is too large.",
      retryable: false,
    },
  });
  assert.equal(
    JSON.stringify(result.body).includes("private size detail"),
    false,
  );
});
