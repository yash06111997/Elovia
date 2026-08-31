import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  beginCloudSyncSession,
  CloudSyncDeadlineError,
  cloudSyncSessionAbortControllerCount,
  endCloudSyncSession,
  cloudSyncFetch,
  isCloudSyncSessionCurrent,
  runCloudSyncBoundedOperation,
} from "../../artifacts/mobile/lib/cloudSyncSession.ts";
import { createCloudSyncNetworkOrchestrator } from "../../artifacts/mobile/lib/cloudSyncOrchestrator.ts";
import {
  createLegacySnapshotFetcher,
  shouldFinalizeLegacyMigration,
} from "../../artifacts/mobile/lib/legacySnapshot.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("a bounded timeout releases the session operation queue without leaks", async () => {
  const token = beginCloudSyncSession("A");
  const runner = createCloudSyncNetworkOrchestrator(() => true);
  const order = [];

  const timedOut = runner.runExclusive(token, () =>
    runCloudSyncBoundedOperation(
      token,
      async () => {
        order.push("first-started");
        return new Promise(() => {});
      },
      5,
    ),
  );
  const next = runner.runExclusive(token, async () => {
    order.push("second-started");
    return "done";
  });

  await assert.rejects(
    timedOut,
    (error) =>
      error instanceof CloudSyncDeadlineError && error.reason === "timeout",
  );
  assert.deepEqual(await next, { status: "applied", value: "done" });
  assert.deepEqual(order, ["first-started", "second-started"]);
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  endCloudSyncSession(token);
});

test("ending A aborts immediately and never blocks a new B operation", async () => {
  const a = beginCloudSyncSession("A");
  const lateA = deferred();
  let aApplied = false;
  const aOperation = cloudSyncFetch(
    a,
    "https://sync.test/user-data",
    undefined,
    async (response) => response,
    1_000,
    async () => lateA.promise,
  ).then(() => {
    aApplied = true;
  });
  assert.equal(cloudSyncSessionAbortControllerCount(a), 1);

  endCloudSyncSession(a);
  const b = beginCloudSyncSession("B");
  const bResult = await runCloudSyncBoundedOperation(
    b,
    async () => "B-saved",
    5,
  );
  assert.equal(bResult, "B-saved");
  await assert.rejects(
    aOperation,
    (error) =>
      error instanceof CloudSyncDeadlineError && error.reason === "session",
  );

  lateA.resolve("late-A");
  await Promise.resolve();
  assert.equal(aApplied, false);
  assert.equal(cloudSyncSessionAbortControllerCount(a), 0);
  assert.equal(cloudSyncSessionAbortControllerCount(b), 0);
  endCloudSyncSession(b);
});

test("a never-resolving response body is bounded and releases its controller", async () => {
  const token = beginCloudSyncSession("body-timeout");
  const body = deferred();
  const request = cloudSyncFetch(
    token,
    "https://sync.test/user-data",
    undefined,
    async (response) => response.json(),
    5,
    async () => ({ json: async () => body.promise }),
  );

  await assert.rejects(
    request,
    (error) =>
      error instanceof CloudSyncDeadlineError && error.reason === "timeout",
  );
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  body.resolve({ revision: 1 });
  await Promise.resolve();
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  endCloudSyncSession(token);
});

test("a bounded token refresh releases queued A work and cannot block B", async () => {
  const runner = createCloudSyncNetworkOrchestrator(isCloudSyncSessionCurrent);
  const lateToken = deferred();
  const usedTokens = [];
  const a = beginCloudSyncSession("A-token");
  const aRefresh = runner.runExclusive(a, () =>
    runCloudSyncBoundedOperation(a, async () => lateToken.promise, 1_000),
  );
  const aRejected = assert.rejects(
    aRefresh,
    (error) =>
      error instanceof CloudSyncDeadlineError && error.reason === "session",
  );
  const queuedA = runner.runExclusive(a, async () => "queued-A");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (cloudSyncSessionAbortControllerCount(a) === 1) break;
    await Promise.resolve();
  }
  assert.equal(cloudSyncSessionAbortControllerCount(a), 1);

  endCloudSyncSession(a);
  const b = beginCloudSyncSession("B-token");
  const bRefresh = await runner.runExclusive(b, async () => "B-token-value");
  assert.deepEqual(bRefresh, { status: "applied", value: "B-token-value" });
  await aRejected;
  assert.deepEqual(await queuedA, { status: "stale" });

  lateToken.resolve("late-A-token");
  const staleA = await Promise.resolve(lateToken.promise).then((token) => {
    if (isCloudSyncSessionCurrent(a)) usedTokens.push(token);
    return isCloudSyncSessionCurrent(a);
  });
  assert.equal(staleA, false);
  assert.deepEqual(usedTokens, []);
  assert.equal(cloudSyncSessionAbortControllerCount(a), 0);
  assert.equal(cloudSyncSessionAbortControllerCount(b), 0);
  endCloudSyncSession(b);
});

test("a never-resolving token refresh times out without a controller leak", async () => {
  const token = beginCloudSyncSession("token-timeout");
  const lateToken = deferred();
  let used = false;
  const refresh = runCloudSyncBoundedOperation(
    token,
    async () => lateToken.promise,
    5,
  ).then(() => {
    used = true;
  });

  await assert.rejects(
    refresh,
    (error) =>
      error instanceof CloudSyncDeadlineError && error.reason === "timeout",
  );
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  lateToken.resolve("late-token");
  await Promise.resolve();
  assert.equal(used, false);
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  endCloudSyncSession(token);
});

test("legacy reads distinguish unavailable, offline, empty, and found", async () => {
  const token = beginCloudSyncSession("legacy-user");
  const unavailable = createLegacySnapshotFetcher({
    getDb: () => null,
    makeRef: () => ({}),
    read: async () => {
      throw new Error("must not read");
    },
    runBounded: runCloudSyncBoundedOperation,
  });
  assert.deepEqual(await unavailable("legacy-user", token, 5), {
    status: "unavailable",
  });

  const initializationFailure = createLegacySnapshotFetcher({
    getDb: () => {
      throw new Error("init unavailable");
    },
    makeRef: () => ({}),
    read: async () => ({ exists: () => false }),
    runBounded: runCloudSyncBoundedOperation,
  });
  assert.deepEqual(await initializationFailure("legacy-user", token, 5), {
    status: "unavailable",
  });

  let available = false;
  const retryable = createLegacySnapshotFetcher({
    getDb: () => ({}),
    makeRef: () => ({}),
    read: async () => {
      if (!available) throw new TypeError("network failed");
      return { exists: () => true, val: () => ({ appState: { ready: true } }) };
    },
    runBounded: runCloudSyncBoundedOperation,
  });
  assert.deepEqual(await retryable("legacy-user", token, 5), {
    status: "offline",
  });
  available = true;
  assert.deepEqual(await retryable("legacy-user", token, 5), {
    status: "found",
    data: { appState: { ready: true } },
  });

  const empty = createLegacySnapshotFetcher({
    getDb: () => ({}),
    makeRef: () => ({}),
    read: async () => ({ exists: () => false }),
    runBounded: runCloudSyncBoundedOperation,
  });
  assert.deepEqual(await empty("legacy-user", token, 5), { status: "empty" });

  assert.equal(shouldFinalizeLegacyMigration("unavailable"), false);
  assert.equal(shouldFinalizeLegacyMigration("offline"), false);
  assert.equal(shouldFinalizeLegacyMigration("empty"), true);
  assert.equal(shouldFinalizeLegacyMigration("found", "offline"), false);
  assert.equal(shouldFinalizeLegacyMigration("found", "saved"), true);
  endCloudSyncSession(token);
});

test("a never-resolving legacy read times out and ignores its late value", async () => {
  const token = beginCloudSyncSession("legacy-timeout");
  const late = deferred();
  const fetchLegacy = createLegacySnapshotFetcher({
    getDb: () => ({}),
    makeRef: () => ({}),
    read: async () => late.promise,
    runBounded: runCloudSyncBoundedOperation,
  });

  assert.deepEqual(await fetchLegacy("legacy-timeout", token, 5), {
    status: "offline",
  });
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  late.resolve({ exists: () => true, val: () => ({ appState: {} }) });
  await Promise.resolve();
  assert.equal(cloudSyncSessionAbortControllerCount(token), 0);
  endCloudSyncSession(token);
});

test("production sync routes every network path through bounded token-scoped guards", async () => {
  const [sessionSource, syncSource, autoSource, firebaseSource] =
    await Promise.all([
      readFile(
        new URL(
          "../../artifacts/mobile/lib/cloudSyncSession.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../../artifacts/mobile/lib/cloudSync.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../artifacts/mobile/components/AutoSync.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../../artifacts/mobile/lib/firebaseSync.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(sessionSource, /CLOUD_SYNC_NETWORK_TIMEOUT_MS = 20_000/);
  assert.equal(syncSource.match(/cloudSyncFetch\(\s*sessionToken/g)?.length, 3);
  assert.match(syncSource, /body: await response\.json\(\)/);
  assert.match(firebaseSource, /runBounded: runCloudSyncBoundedOperation/);
  assert.match(
    syncSource,
    /runCloudSyncBoundedOperation\([\s\S]*sessionToken[\s\S]*user\.getIdToken\(\)/,
  );
  assert.match(
    syncSource,
    /isCloudSyncDeadlineError\(error, "timeout"\)[\s\S]*\? "offline"/,
  );
  assert.match(
    syncSource,
    /isCloudSyncDeadlineError\(error, "session"\)[\s\S]*\? "unauthorized"/,
  );
  assert.match(
    autoSource,
    /backupInFlightRef = useRef\(new WeakSet<CloudSyncSessionToken>\(\)\)/,
  );
  assert.doesNotMatch(autoSource, /backupInFlightRef = useRef\(false\)/);
});
