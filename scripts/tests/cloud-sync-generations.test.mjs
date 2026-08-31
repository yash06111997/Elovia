import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOCAL_SYNC_JOURNAL_KEY,
  LOCAL_SYNC_OWNER_KEY,
  scopedSyncGenerationKey,
  STALE_CURRENT_USER,
  storedSyncUserOwner,
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

class FailingMemoryStorage extends MemoryStorage {
  setFailure(failAt) {
    this.failAt = failAt;
    this.mutationCount = 0;
  }
  clearFailure() {
    this.failAt = null;
    this.mutationCount = 0;
  }
  maybeFail() {
    this.mutationCount = (this.mutationCount ?? 0) + 1;
    if (this.mutationCount === this.failAt) {
      this.failAt = null;
      throw new Error(`Injected storage failure ${this.mutationCount}`);
    }
  }
  async setItem(key, value) {
    this.maybeFail();
    await super.setItem(key, value);
  }
  async removeItem(key) {
    this.maybeFail();
    await super.removeItem(key);
  }
  async multiSet(entries) {
    this.maybeFail();
    await super.multiSet(entries);
  }
  async multiRemove(keys) {
    this.maybeFail();
    await super.multiRemove(keys);
  }
}

const SYNC_KEYS = ["state", "activeSession"];
const currentA = async () => "A";
const ownerA = storedSyncUserOwner("A");
const changeA = scopedSyncGenerationKey(ownerA, "change");
const cleanA = scopedSyncGenerationKey(ownerA, "clean");

function storageForA(entries = []) {
  return new MemoryStorage([[LOCAL_SYNC_OWNER_KEY, ownerA], ...entries]);
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("cold dirty local state chooses backup and never starts a cloud GET", async () => {
  const storage = storageForA([
    ["state", '{"workout":"offline"}'],
    ["revision", "9"],
    [changeA, "4"],
    [cleanA, "3"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  let cloudGets = 0;

  const snapshot = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(snapshot.status, "ready");
  const outcome = snapshot.value.dirty
    ? { status: "local_changes" }
    : ((cloudGets += 1), { status: "restored" });

  assert.deepEqual(outcome, { status: "local_changes" });
  assert.equal(cloudGets, 0);
  assert.equal(new Map(snapshot.value.entries).get("revision"), "9");
});

test("a local edit during a deferred GET prevents snapshot and revision overwrite", async () => {
  const storage = storageForA([
    ["state", "clean-local"],
    ["revision", "9"],
    [changeA, "2"],
    [cleanA, "2"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const beforeGet = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(beforeGet.status, "ready");

  await coordinator.commitLocalChangeOwned(
    "A",
    currentA,
    [["state", "new-offline-edit"]],
    [],
    "context-generation-3",
  );
  const applied = await coordinator.commitRestoreOwned(
    "A",
    currentA,
    beforeGet.value.changeGeneration,
    [["state", "old-cloud-snapshot"]],
    [],
    [["revision", "10"]],
    "cloud-generation-3",
  );

  assert.deepEqual(applied, {
    status: "ready",
    value: { committed: false },
  });
  assert.equal(await storage.getItem("state"), "new-offline-edit");
  assert.equal(await storage.getItem("revision"), "9");
  assert.equal(await storage.getItem(changeA), "3");
  assert.equal(await storage.getItem(cleanA), "2");
});

test("only an explicit manual conflict resolution may replace dirty local data", async () => {
  const storage = storageForA([
    ["state", "unsynced-local"],
    ["revision", "9"],
    [changeA, "3"],
    [cleanA, "2"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const captured = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(captured.status, "ready");
  assert.equal(captured.value.dirty, true);

  const defaultRestore = await coordinator.commitRestoreOwned(
    "A",
    currentA,
    captured.value.changeGeneration,
    [["state", "cloud-copy"]],
    [],
    [["revision", "10"]],
    "manual-default",
  );
  assert.deepEqual(defaultRestore, {
    status: "ready",
    value: { committed: false },
  });
  assert.equal(await storage.getItem("state"), "unsynced-local");
  assert.equal(await storage.getItem("revision"), "9");

  const forcedRestore = await coordinator.commitRestoreOwned(
    "A",
    currentA,
    captured.value.changeGeneration,
    [["state", "cloud-copy"]],
    [],
    [["revision", "10"]],
    "manual-confirmed",
    { allowOverwriteDirty: true },
  );
  assert.deepEqual(forcedRestore, {
    status: "ready",
    value: { committed: true },
  });
  assert.equal(await storage.getItem("state"), "cloud-copy");
  assert.equal(await storage.getItem("revision"), "10");
  assert.equal(await storage.getItem(changeA), "3");
  assert.equal(await storage.getItem(cleanA), "3");

  await coordinator.commitLocalChangeOwned(
    "A",
    currentA,
    [["state", "later-edit"]],
    [],
    "later-edit",
  );
  const later = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(later.status, "ready");
  assert.equal(later.value.dirty, true);
  assert.deepEqual(
    await coordinator.commitBackupSavedOwned(
      "A",
      currentA,
      later.value.changeGeneration,
      [["revision", "11"]],
      "later-backup",
    ),
    { status: "ready", value: { markedClean: true } },
  );

  const afterBackup = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(afterBackup.status, "ready");
  assert.equal(afterBackup.value.dirty, false);
  assert.deepEqual(
    await coordinator.commitRestoreOwned(
      "A",
      currentA,
      afterBackup.value.changeGeneration,
      [["state", "later-cloud"]],
      [],
      [["revision", "12"]],
      "later-restore",
    ),
    { status: "ready", value: { committed: true } },
  );

  let authChecks = 0;
  const invalidatedSession = async () =>
    authChecks++ === 0 ? "A" : STALE_CURRENT_USER;
  const staleForcedRestore = await coordinator.commitRestoreOwned(
    "A",
    invalidatedSession,
    afterBackup.value.changeGeneration,
    [["state", "stale-cloud"]],
    [],
    [["revision", "13"]],
    "stale-manual-confirmation",
    { allowOverwriteDirty: true },
  );
  assert.deepEqual(staleForcedRestore, { status: "stale" });
  assert.equal(await storage.getItem("state"), "later-cloud");
  assert.equal(await storage.getItem("revision"), "12");
});

test("health capability refresh does not dirty a clean deferred restore", async () => {
  const healthKey = "@elovia_health_data";
  const storage = storageForA([
    [healthKey, '{"todaySteps":1}'],
    ["revision", "5"],
    [changeA, "4"],
    [cleanA, "4"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, [healthKey]);
  const beforeGet = await coordinator.readSyncSnapshotOwned("A", currentA, [
    healthKey,
    "revision",
  ]);
  assert.equal(beforeGet.status, "ready");
  assert.equal(beforeGet.value.dirty, false);

  const response = deferred();
  const restore = response.promise.then((cloudHealth) =>
    coordinator.commitRestoreOwned(
      "A",
      currentA,
      beforeGet.value.changeGeneration,
      [[healthKey, cloudHealth]],
      [],
      [["revision", "6"]],
      "deferred-health-restore",
    ),
  );

  // Mount capability refresh is in-memory only, so synchronized storage and
  // its generation remain untouched while the GET is in flight.
  assert.equal(await storage.getItem(changeA), "4");
  assert.equal(await storage.getItem(cleanA), "4");
  response.resolve('{"todaySteps":2}');
  assert.deepEqual(await restore, {
    status: "ready",
    value: { committed: true },
  });
  assert.equal(await storage.getItem(healthKey), '{"todaySteps":2}');
  assert.equal(await storage.getItem("revision"), "6");
});

test("backup response advances revision but does not clean an edit made during fetch", async () => {
  const storage = storageForA([
    ["state", "snapshot-one"],
    ["revision", "9"],
    [changeA, "5"],
    [cleanA, "4"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const captured = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(captured.status, "ready");

  await coordinator.commitLocalChangeOwned(
    "A",
    currentA,
    [["state", "snapshot-two"]],
    [],
    "context-generation-6",
  );
  const firstSaved = await coordinator.commitBackupSavedOwned(
    "A",
    currentA,
    captured.value.changeGeneration,
    [["revision", "10"]],
    "cloud-generation-6",
  );
  assert.deepEqual(firstSaved, {
    status: "ready",
    value: { markedClean: false },
  });

  const next = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(next.status, "ready");
  assert.equal(next.value.dirty, true);
  assert.equal(new Map(next.value.entries).get("state"), "snapshot-two");
  assert.equal(new Map(next.value.entries).get("revision"), "10");

  const secondSaved = await coordinator.commitBackupSavedOwned(
    "A",
    currentA,
    next.value.changeGeneration,
    [["revision", "11"]],
    "cloud-generation-6",
  );
  assert.deepEqual(secondSaved, {
    status: "ready",
    value: { markedClean: true },
  });
  assert.equal(await storage.getItem(cleanA), "6");
});

test("a clean restore remains clean and can restore again on the next launch", async () => {
  const storage = storageForA([
    ["state", "old"],
    ["revision", "3"],
    [changeA, "7"],
    [cleanA, "7"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const captured = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(captured.status, "ready");

  assert.deepEqual(
    await coordinator.commitRestoreOwned(
      "A",
      currentA,
      captured.value.changeGeneration,
      [["state", "cloud"]],
      [],
      [["revision", "4"]],
      "cloud-generation-7",
    ),
    { status: "ready", value: { committed: true } },
  );
  const nextLaunch = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
    "revision",
  ]);
  assert.equal(nextLaunch.status, "ready");
  assert.equal(nextLaunch.value.dirty, false);
  assert.equal(nextLaunch.value.changeGeneration, 7);
  assert.equal(nextLaunch.value.cleanGeneration, 7);
});

test("data and change generation recover together at every journal phase", async () => {
  for (let failAt = 1; failAt <= 6; failAt++) {
    const storage = new FailingMemoryStorage([
      [LOCAL_SYNC_OWNER_KEY, ownerA],
      ["state", "before"],
      [changeA, "8"],
      [cleanA, "8"],
    ]);
    storage.setFailure(failAt);
    const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
    await assert.rejects(
      coordinator.commitLocalChangeOwned(
        "A",
        currentA,
        [["state", "after"]],
        [],
        "context-generation-8",
      ),
    );

    storage.clearFailure();
    const restarted = new SyncStorageCoordinator(storage, SYNC_KEYS);
    await restarted.prepareOwner("A", currentA);
    assert.equal(await storage.getItem("state"), "before");
    assert.equal(await storage.getItem(changeA), "8");
    assert.equal(await storage.getItem(cleanA), "8");
    assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
  }
});

test("A and B change metadata stay isolated across owner transitions", async () => {
  const ownerB = storedSyncUserOwner("B");
  const changeB = scopedSyncGenerationKey(ownerB, "change");
  const cleanB = scopedSyncGenerationKey(ownerB, "clean");
  const storage = storageForA([
    [changeA, "2"],
    [cleanA, "1"],
    [changeB, "10"],
    [cleanB, "10"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  await coordinator.prepareOwner("B", async () => "B");
  await coordinator.commitLocalChangeOwned(
    "B",
    async () => "B",
    [["state", "b-edit"]],
    [],
    "context-generation-b",
  );
  assert.equal(await storage.getItem(changeA), "2");
  assert.equal(await storage.getItem(cleanA), "1");
  assert.equal(await storage.getItem(changeB), "11");
  assert.equal(await storage.getItem(cleanB), "10");
});

test("the first authenticated user claims guest data as dirty", async () => {
  const storage = new MemoryStorage([["state", "guest-offline-edit"]]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  assert.deepEqual(await coordinator.prepareOwner("A", currentA), {
    status: "ready",
    changed: true,
  });
  const claimed = await coordinator.readSyncSnapshotOwned("A", currentA, [
    "state",
  ]);
  assert.equal(claimed.status, "ready");
  assert.equal(claimed.value.dirty, true);
  assert.equal(claimed.value.changeGeneration, 1);
  assert.equal(claimed.value.cleanGeneration, 0);
  assert.equal(
    new Map(claimed.value.entries).get("state"),
    "guest-offline-edit",
  );
});

test("corrupt generation metadata fails closed", async () => {
  const storage = storageForA([
    ["state", "local"],
    [changeA, "2"],
    [cleanA, "3"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  await assert.rejects(
    coordinator.readSyncSnapshotOwned("A", currentA, ["state"]),
    /generation metadata is invalid/,
  );
  assert.equal(await storage.getItem("state"), "local");
});

test("production sync exposes local_changes honestly and routes AutoSync to backup", async () => {
  const [syncSource, autoSource, profileSource, accountSource] =
    await Promise.all([
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
        new URL(
          "../../artifacts/mobile/app/(tabs)/profile.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../artifacts/mobile/lib/accountSyncStorage.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(syncSource, /readSyncSnapshotOwned/);
  assert.match(
    syncSource,
    /if \(capturedWasDirty && !options\.allowOverwriteDirty\)[\s\S]*status: "local_changes"/,
  );
  assert.match(syncSource, /commitBackupSavedOwned/);
  assert.match(syncSource, /commitRestoreOwned/);
  assert.match(syncSource, /allowOverwriteDirty/);
  assert.match(syncSource, /conflictBlockedUsers\.delete\(identity\.uid\)/);
  assert.match(accountSource, /commitLocalChangeOwned/);
  assert.match(
    autoSource,
    /outcome\.status === "local_changes"[\s\S]*restoreSettledRef\.current = true[\s\S]*attemptAutomaticBackup/,
  );
  assert.doesNotMatch(autoSource, /allowOverwriteDirty/);
  assert.match(profileSource, /permanently replace unsynced changes/);
  assert.match(profileSource, /Use cloud copy/);
  assert.match(profileSource, /style: "destructive"/);
  assert.match(
    profileSource,
    /restoreFromCloud\(sessionToken, \{ allowOverwriteDirty: true \}\)/,
  );
  assert.equal(
    (profileSource.match(/allowOverwriteDirty: true/g) ?? []).length,
    1,
  );
});
