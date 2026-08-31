import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canUploadAfterRestore,
  classifyAuthTokenFailure,
  classifyBackupResponse,
  classifyRestoreResponse,
  revisionStorageKey,
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

const RESTORE_FIELD_KINDS = {
  activePlanType: "scalar",
  activeCustomPlanId: "scalar",
  activeMealPlanType: "scalar",
  activeCustomMealPlanId: "scalar",
  appState: "json",
};

test("restore scalar fields accept only strings or explicit null", () => {
  assert.deepEqual(
    serializeRestoreFields(
      { activePlanType: "custom", activeCustomPlanId: null },
      RESTORE_FIELD_KINDS,
    ),
    {
      status: "valid",
      changes: [
        ["activePlanType", "custom"],
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
  assert.doesNotMatch(source, /Promise<boolean>/);
});

test("automatic sync gates migration and pauses after conflicts", async () => {
  const source = await readFile(
    new URL("../../artifacts/mobile/components/AutoSync.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /canUploadAfterRestore\(outcome\)/);
  assert.match(source, /outcome\.status === "restored"/);
  assert.match(source, /migrateLegacyFirebaseData\(currentUserId\)/);
  assert.match(source, /isCloudSyncConflictBlocked\(userId\)/);
  assert.match(source, /backupInFlightRef\.current/);
  assert.match(source, /cloud_sync_failed/);
});

test("manual sync presents conflict and restore failures honestly", async () => {
  const source = await readFile(
    new URL("../../artifacts/mobile/app/(tabs)/profile.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Newer cloud data found/);
  assert.match(source, /Restore the latest cloud data before backing up/);
  assert.match(source, /You're offline/);
  assert.match(source, /Sign-in required/);
  assert.match(source, /Restore unavailable/);
  assert.match(source, /No cloud backup/);
});
