import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCloudSyncSession,
  cloudSyncSessionUid,
  endCloudSyncSession,
  isCloudSyncSessionCurrent,
} from "../../artifacts/mobile/lib/cloudSyncSession.ts";
import { createCloudSyncNetworkOrchestrator } from "../../artifacts/mobile/lib/cloudSyncOrchestrator.ts";
import {
  LOCAL_SYNC_OWNER_KEY,
  SyncStorageCoordinator,
} from "../../artifacts/mobile/lib/cloudSyncStorage.ts";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }
  async getItem(key) {
    return this.values.get(key) ?? null;
  }
  async setItem(key, value) {
    this.values.set(key, value);
  }
  async removeItem(key) {
    this.values.delete(key);
  }
  async multiGet(keys) {
    return keys.map((key) => [key, this.values.get(key) ?? null]);
  }
  async multiSet(entries) {
    for (const [key, value] of entries) this.values.set(key, value);
  }
  async multiRemove(keys) {
    for (const key of keys) this.values.delete(key);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("a deferred A1 restore cannot mutate or settle A2 after A to B to A", async () => {
  let firebaseUid = "A";
  const runner = createCloudSyncNetworkOrchestrator(
    async (token) =>
      isCloudSyncSessionCurrent(token) &&
      cloudSyncSessionUid(token) === firebaseUid,
  );
  const response = deferred();
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "A2-local"],
    ["revision", "8"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, ["state"]);
  let restoredEvents = 0;
  let backupGateOpen = false;

  const applySnapshot = (token) => async (snapshot) => {
    const committed = await coordinator.commitOwned(
      "A",
      async () =>
        isCloudSyncSessionCurrent(token) && firebaseUid === "A"
          ? "A"
          : "stale-session",
      [["state", snapshot.state]],
      [],
      [["revision", String(snapshot.revision)]],
    );
    if (committed.status === "stale") return { status: "unauthorized" };
    restoredEvents++;
    backupGateOpen = true;
    return { status: "restored" };
  };

  const a1 = beginCloudSyncSession("A");
  const staleRestore = runner.execute(
    a1,
    () => response.promise,
    applySnapshot(a1),
  );

  firebaseUid = "B";
  beginCloudSyncSession("B");
  firebaseUid = "A";
  const a2 = beginCloudSyncSession("A");
  assert.notEqual(a1, a2);
  assert.equal(isCloudSyncSessionCurrent(a1), false);
  assert.equal(isCloudSyncSessionCurrent(a2), true);
  response.resolve({ state: "stale-A1-cloud", revision: 9 });

  assert.deepEqual(await staleRestore, { status: "stale" });
  assert.equal(await storage.getItem("state"), "A2-local");
  assert.equal(await storage.getItem("revision"), "8");
  assert.equal(restoredEvents, 0);
  assert.equal(backupGateOpen, false);

  const currentRestore = await runner.execute(
    a2,
    async () => ({ state: "A2-cloud", revision: 10 }),
    applySnapshot(a2),
  );
  assert.deepEqual(currentRestore, {
    status: "applied",
    value: { status: "restored" },
  });
  assert.equal(await storage.getItem("state"), "A2-cloud");
  assert.equal(await storage.getItem("revision"), "10");
  assert.equal(restoredEvents, 1);
  assert.equal(backupGateOpen, true);
});

test("a deferred A1 backup response cannot advance A2 revision or conflict state", async () => {
  let firebaseUid = "A";
  const runner = createCloudSyncNetworkOrchestrator(
    async (token) =>
      isCloudSyncSessionCurrent(token) &&
      cloudSyncSessionUid(token) === firebaseUid,
  );
  const response = deferred();
  let revision = 12;
  let conflictBlocked = false;

  const a1 = beginCloudSyncSession("A");
  const staleBackup = runner.execute(
    a1,
    () => response.promise,
    async (result) => {
      revision = result.revision;
      conflictBlocked = result.status === "conflict";
      return result;
    },
  );

  firebaseUid = "B";
  beginCloudSyncSession("B");
  firebaseUid = "A";
  const a2 = beginCloudSyncSession("A");
  response.resolve({ status: "conflict", revision: 99 });

  assert.deepEqual(await staleBackup, { status: "stale" });
  assert.equal(revision, 12);
  assert.equal(conflictBlocked, false);
  assert.equal(isCloudSyncSessionCurrent(a2), true);

  // Ending an old token cannot invalidate the newer matching account session.
  endCloudSyncSession(a1);
  assert.equal(isCloudSyncSessionCurrent(a2), true);
  endCloudSyncSession(a2);
  assert.equal(isCloudSyncSessionCurrent(a2), false);
});

test("same-session backup and restore operations run in deterministic order", async () => {
  let firebaseUid = "A";
  const runner = createCloudSyncNetworkOrchestrator(
    async (token) =>
      isCloudSyncSessionCurrent(token) &&
      cloudSyncSessionUid(token) === firebaseUid,
  );
  const token = beginCloudSyncSession("A");
  const firstResponse = deferred();
  const automaticStarted = deferred();
  const order = [];
  let cloudRevision = 4;
  let localPayload = "older";

  const automaticBackup = runner.runExclusive(token, async () => {
    order.push(`auto-read:${localPayload}:${cloudRevision}`);
    automaticStarted.resolve();
    await firstResponse.promise;
    cloudRevision += 1;
    order.push(`auto-saved:${cloudRevision}`);
    return { status: "saved", revision: cloudRevision };
  });

  localPayload = "newest";
  const manualBackup = runner.runExclusive(token, async () => {
    order.push(`manual-read:${localPayload}:${cloudRevision}`);
    cloudRevision += 1;
    order.push(`manual-saved:${cloudRevision}`);
    return { status: "saved", revision: cloudRevision };
  });
  const manualRestore = runner.runExclusive(token, async () => {
    order.push(`restore-read:${cloudRevision}`);
    return { status: "restored", revision: cloudRevision };
  });

  await automaticStarted.promise;
  assert.deepEqual(order, ["auto-read:newest:4"]);
  firstResponse.resolve();

  assert.deepEqual(await automaticBackup, {
    status: "applied",
    value: { status: "saved", revision: 5 },
  });
  assert.deepEqual(await manualBackup, {
    status: "applied",
    value: { status: "saved", revision: 6 },
  });
  assert.deepEqual(await manualRestore, {
    status: "applied",
    value: { status: "restored", revision: 6 },
  });
  assert.deepEqual(order, [
    "auto-read:newest:4",
    "auto-saved:5",
    "manual-read:newest:5",
    "manual-saved:6",
    "restore-read:6",
  ]);
});

test("deferred legacy reads do not hold storage and stale snapshots cannot commit", async () => {
  let firebaseUid = "A";
  const runner = createCloudSyncNetworkOrchestrator(
    async (token) =>
      isCloudSyncSessionCurrent(token) &&
      cloudSyncSessionUid(token) === firebaseUid,
  );
  const token = beginCloudSyncSession("A");
  const response = deferred();
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, ["state"]);

  const migration = runner.runExclusive(token, async () => {
    const guarded = await runner.execute(
      token,
      () => response.promise,
      async (snapshot) => snapshot,
    );
    if (guarded.status === "stale") return { status: "unauthorized" };
    return coordinator.commitOwned(
      "A",
      async () =>
        isCloudSyncSessionCurrent(token) && firebaseUid === "A"
          ? "A"
          : "stale-session",
      [["state", guarded.value.state]],
      [],
    );
  });

  assert.deepEqual(
    await coordinator.readOwned("A", async () => "A", ["state"]),
    { status: "ready", value: [["state", "current"]] },
  );

  firebaseUid = "B";
  beginCloudSyncSession("B");
  response.resolve({ state: "stale-legacy" });
  assert.deepEqual(await migration, { status: "stale" });
  assert.equal(await storage.getItem("state"), "current");
});
