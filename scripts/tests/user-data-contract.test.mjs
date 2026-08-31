import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildUserDataPatch,
  parseUserDataWrite,
  revisionMatches,
  USER_DATA_FIELDS,
} from "../../artifacts/api-server/src/routes/userDataContract.ts";

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
  const source = await readFile(
    new URL(
      "../../artifacts/api-server/src/routes/userData.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /parseUserDataWrite\(req\.body\)/);
  assert.match(source, /status\(409\)/);
  assert.match(source, /SYNC_CONFLICT/);
  assert.match(source, /eq\(userDataTable\.revision, current\.revision\)/);
  assert.doesNotMatch(source, /appState:\s*appState\s*\?\?\s*null/);
  assert.match(source, /revision:\s*row\.revision/);
  assert.match(source, /updatedAt:\s*row\.updatedAt\.toISOString\(\)/);
});
