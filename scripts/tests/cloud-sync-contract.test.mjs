import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildStoredSyncPayload,
  buildCloudResetPayload,
  canSettleAfterLegacyCommit,
  canUploadAfterRestore,
  classifyAuthTokenFailure,
  classifyBackupResponse,
  classifyResponseBodyFailure,
  classifyRestoreResponse,
  revisionStorageKey,
  runCloudFirstReset,
  serializeRestoreFields,
} from "../../artifacts/mobile/lib/cloudSyncContract.ts";

test("only definitive restore states permit upload", () => {
  assert.equal(
    canUploadAfterRestore({ status: "restored", revision: 4 }),
    true,
  );
  assert.equal(canUploadAfterRestore({ status: "empty" }), true);
  assert.equal(canUploadAfterRestore({ status: "offline" }), false);
  assert.equal(canUploadAfterRestore({ status: "server" }), false);
  assert.equal(canUploadAfterRestore({ status: "unauthorized" }), false);
  assert.equal(canUploadAfterRestore({ status: "local_changes" }), false);
});

test("a committed legacy restore settles despite backup transport or conflict outcomes", () => {
  for (const outcome of [
    { status: "saved", revision: 2 },
    { status: "empty" },
    { status: "offline" },
    { status: "server" },
    { status: "conflict", currentRevision: 3 },
  ]) {
    assert.equal(canSettleAfterLegacyCommit(outcome), true);
  }
  assert.equal(canSettleAfterLegacyCommit({ status: "unauthorized" }), false);
});

test("HTTP restore responses are not collapsed into empty", () => {
  assert.deepEqual(classifyRestoreResponse(200, false, null), {
    status: "empty",
  });
  assert.deepEqual(classifyRestoreResponse(401, false, null), {
    status: "unauthorized",
  });
  assert.deepEqual(classifyRestoreResponse(403, false, null), {
    status: "unauthorized",
  });
  assert.deepEqual(classifyRestoreResponse(503, false, null), {
    status: "server",
  });
  assert.deepEqual(classifyRestoreResponse(200, true, 9), {
    status: "restored",
    revision: 9,
  });
});

test("restore requires a positive safe server revision", () => {
  for (const revision of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(classifyRestoreResponse(200, true, revision), {
      status: "server",
    });
  }
});

test("backup responses distinguish saved, unauthorized, conflict, and server", () => {
  assert.deepEqual(classifyBackupResponse(200, 7, null), {
    status: "saved",
    revision: 7,
  });
  assert.deepEqual(classifyBackupResponse(401, null, null), {
    status: "unauthorized",
  });
  assert.deepEqual(classifyBackupResponse(403, null, null), {
    status: "unauthorized",
  });
  assert.deepEqual(classifyBackupResponse(409, null, 6), {
    status: "conflict",
    currentRevision: 6,
  });
  assert.deepEqual(classifyBackupResponse(409, null, null), {
    status: "conflict",
    currentRevision: null,
  });
  assert.deepEqual(classifyBackupResponse(500, null, null), {
    status: "server",
  });
});

test("backup rejects malformed saved and conflict revisions", () => {
  for (const revision of [null, 0, -2, 3.4, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(classifyBackupResponse(200, revision, null), {
      status: "server",
    });
  }
  assert.deepEqual(classifyBackupResponse(409, null, 0), { status: "server" });
  assert.deepEqual(
    classifyBackupResponse(409, null, Number.MAX_SAFE_INTEGER + 1),
    {
      status: "server",
    },
  );
});

test("revision storage is scoped to the Firebase user", () => {
  assert.notEqual(
    revisionStorageKey("first-user"),
    revisionStorageKey("second-user"),
  );
  assert.match(revisionStorageKey("first-user"), /first-user/);
});

test("token refresh failures distinguish offline from unauthorized", () => {
  for (const error of [
    { code: "auth/network-request-failed" },
    { code: "auth/timeout" },
    { name: "AbortError" },
    { name: "TypeError", message: "Network request failed" },
  ]) {
    assert.equal(classifyAuthTokenFailure(error), "offline");
  }

  for (const error of [
    { code: "auth/user-disabled" },
    { code: "auth/invalid-user-token" },
    new Error("Token rejected"),
    null,
  ]) {
    assert.equal(classifyAuthTokenFailure(error), "unauthorized");
  }
});

test("response body transport failures stay distinct from malformed JSON", () => {
  assert.equal(
    classifyResponseBodyFailure(new TypeError("network stream failed")),
    "offline",
  );
  assert.equal(classifyResponseBodyFailure({ name: "AbortError" }), "offline");
  assert.equal(
    classifyResponseBodyFailure(new SyntaxError("Unexpected token")),
    "server",
  );
  assert.equal(
    classifyResponseBodyFailure(new Error("unknown parser failure")),
    "server",
  );
});

const RESTORE_FIELD_KINDS = {
  activePlanType: "string",
  activeCustomPlanId: "string",
  activeMealPlanType: "string",
  activeCustomMealPlanId: "string",
  appState: "plain-object",
  workoutPlan: "nullable-object",
  activeSession: "nullable-object",
  customPlans: "array",
  sessions: "array",
  personalRecords: "array",
  mealPlan: "nullable-object",
  foodLog: "array",
  customMealPlans: "array",
  healthData: "plain-object",
  wellnessData: "plain-object",
  waterGoal: "positive-number",
};

test("cloud reset materializes every synchronized field as a null tombstone", () => {
  const payload = buildCloudResetPayload(RESTORE_FIELD_KINDS, 12);
  assert.deepEqual(payload, {
    baseRevision: 12,
    ...Object.fromEntries(
      Object.keys(RESTORE_FIELD_KINDS).map((field) => [field, null]),
    ),
  });

  const restored = serializeRestoreFields(payload, RESTORE_FIELD_KINDS);
  assert.equal(restored.status, "valid");
  assert.equal(
    restored.changes.length,
    Object.keys(RESTORE_FIELD_KINDS).length,
  );
  assert.equal(
    restored.changes.every(([, value]) => value === null),
    true,
  );
});

test("cloud-first reset never clears local data unless cloud save succeeds", async () => {
  let localClears = 0;
  const clearLocal = async () => {
    localClears += 1;
  };

  assert.deepEqual(
    await runCloudFirstReset(
      async () => ({ status: "conflict", currentRevision: 8 }),
      clearLocal,
    ),
    { status: "conflict", currentRevision: 8 },
  );
  assert.deepEqual(
    await runCloudFirstReset(async () => ({ status: "offline" }), clearLocal),
    { status: "offline" },
  );
  assert.equal(localClears, 0);

  assert.deepEqual(
    await runCloudFirstReset(
      async () => ({ status: "saved", revision: 13 }),
      async (revision) => {
        assert.equal(revision, 13);
        localClears += 1;
      },
    ),
    { status: "reset", revision: 13 },
  );
  assert.equal(localClears, 1);

  assert.deepEqual(
    await runCloudFirstReset(
      async () => ({ status: "saved", revision: 14 }),
      async () => {
        throw new Error("local storage unavailable");
      },
    ),
    { status: "local", revision: 14 },
  );
});

test("restore scalar fields accept only strings or explicit null", () => {
  assert.deepEqual(
    serializeRestoreFields(
      { activePlanType: "custom", activeCustomPlanId: null },
      RESTORE_FIELD_KINDS,
    ),
    {
      status: "valid",
      changes: [
        ["activePlanType", '"custom"'],
        ["activeCustomPlanId", null],
      ],
    },
  );

  for (const invalid of [{}, 3, ["custom"]]) {
    assert.deepEqual(
      serializeRestoreFields({ activePlanType: invalid }, RESTORE_FIELD_KINDS),
      { status: "invalid" },
    );
  }

  assert.deepEqual(
    buildStoredSyncPayload(
      [["activePlanType", "custom"]],
      RESTORE_FIELD_KINDS,
      false,
    ),
    { status: "valid", payload: { activePlanType: "custom" } },
  );
  assert.deepEqual(
    buildStoredSyncPayload(
      [["activePlanType", '"custom"']],
      RESTORE_FIELD_KINDS,
      false,
    ),
    { status: "valid", payload: { activePlanType: "custom" } },
  );
});

test("restore JSON fields are fully validated and unknown fields are ignored", () => {
  assert.deepEqual(
    serializeRestoreFields(
      { appState: { profile: { age: 30 }, flags: [true, null] }, ignored: 4n },
      RESTORE_FIELD_KINDS,
    ),
    {
      status: "valid",
      changes: [["appState", '{"profile":{"age":30},"flags":[true,null]}']],
    },
  );

  const cyclic = {};
  cyclic.self = cyclic;
  for (const invalid of [undefined, 4n, () => {}, cyclic, new Date()]) {
    assert.deepEqual(
      serializeRestoreFields({ appState: invalid }, RESTORE_FIELD_KINDS),
      { status: "invalid" },
    );
  }
});

test("sync field schemas reject wrong containers and malformed water goals", () => {
  for (const input of [
    { sessions: {} },
    { foodLog: {} },
    { customPlans: { id: "one" } },
    { appState: [] },
    { workoutPlan: [] },
    { waterGoal: 0 },
    { waterGoal: -1 },
    { waterGoal: Number.POSITIVE_INFINITY },
    { waterGoal: "3" },
  ]) {
    assert.deepEqual(serializeRestoreFields(input, RESTORE_FIELD_KINDS), {
      status: "invalid",
    });
  }
});

test("existing revisions upload missing synchronized fields as deletion tombstones", () => {
  const stored = [
    ["workoutPlan", '{"id":"plan"}'],
    ["activeSession", null],
    ["activeCustomPlanId", null],
  ];
  const outcome = buildStoredSyncPayload(stored, RESTORE_FIELD_KINDS, true);
  assert.equal(outcome.status, "valid");
  assert.deepEqual(outcome.payload.workoutPlan, { id: "plan" });
  assert.equal(outcome.payload.activeSession, null);
  assert.equal(outcome.payload.activeCustomPlanId, null);
  assert.equal(outcome.payload.sessions, null);

  const restored = serializeRestoreFields(outcome.payload, RESTORE_FIELD_KINDS);
  assert.equal(restored.status, "valid");
  const changes = new Map(restored.changes);
  assert.equal(changes.get("activeSession"), null);
  assert.equal(changes.get("activeCustomPlanId"), null);
});

test("new accounts keep the all-empty guard and preserve stored JSON null", () => {
  assert.deepEqual(
    buildStoredSyncPayload(
      [["activeSession", null]],
      RESTORE_FIELD_KINDS,
      false,
    ),
    { status: "valid", payload: {} },
  );
  assert.deepEqual(
    buildStoredSyncPayload(
      [["activeSession", "null"]],
      RESTORE_FIELD_KINDS,
      false,
    ),
    { status: "valid", payload: { activeSession: null } },
  );
});

test("malformed local synchronized values abort upload before fetch", () => {
  for (const [field, stored] of [
    ["sessions", "{}"],
    ["foodLog", "{}"],
    ["waterGoal", "0"],
    ["waterGoal", '"three"'],
  ]) {
    assert.deepEqual(
      buildStoredSyncPayload([[field, stored]], RESTORE_FIELD_KINDS, false),
      { status: "invalid" },
    );
  }
});

test("mobile sync sends a user-scoped base revision and clears explicit nulls", async () => {
  const source = await readFile(
    new URL("../../artifacts/mobile/lib/cloudSync.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /revisionStorageKey\(identity\.uid\)/);
  assert.match(source, /JSON\.stringify\(\{ baseRevision, \.\.\.payload \}\)/);
  assert.match(source, /return Object\.keys\(payload\)\.length > 0/);
  assert.match(source, /value === null[\s\S]*removals\.push\(key\)/);
  assert.match(source, /Promise<RestoreOutcome>/);
  assert.doesNotMatch(
    source,
    /restoreFromCloud\([\s\S]{0,120}Promise<boolean>/,
  );
  assert.match(source, /createCloudSyncNetworkOrchestrator/);
  assert.match(source, /currentUserForSession\(sessionToken\)/);
});

test("automatic sync gates migration and pauses after conflicts", async () => {
  const source = await readFile(
    new URL("../../artifacts/mobile/components/AutoSync.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /canUploadAfterRestore\(outcome\)/);
  assert.match(source, /outcome\.status === "restored"/);
  assert.match(source, /migrateLegacyFirebaseData\(sessionToken\)/);
  assert.match(source, /canSettleAfterLegacyCommit\(migration\.cloudBackup\)/);
  assert.match(
    source,
    /await emitDataRestored\(\)[\s\S]*canSettleAfterLegacyCommit\(migration\.cloudBackup\)[\s\S]*restoreSettledRef\.current = true/,
  );
  assert.match(source, /isCloudSyncConflictBlocked\(userId\)/);
  assert.match(source, /backupInFlightRef\.current/);
  assert.match(source, /cloud_sync_failed/);
  assert.match(source, /endCloudSyncSession\(ownedSessionToken\)/);
  assert.doesNotMatch(
    source,
    /trackEvent\([\s\S]{0,160}(?:sessionToken|generation)/,
  );
});

test("manual sync presents conflict and restore failures honestly", async () => {
  const source = await readFile(
    new URL("../../artifacts/mobile/app/(tabs)/profile.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Use cloud copy/);
  assert.match(source, /permanently replace unsynced changes/);
  assert.match(source, /text: "Cancel", style: "cancel"/);
  assert.match(source, /style: "destructive"/);
  assert.match(source, /You're offline/);
  assert.match(source, /Sign-in required/);
  assert.match(source, /Restore unavailable/);
  assert.match(source, /No cloud backup/);
});
