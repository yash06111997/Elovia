import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOCAL_SYNC_OWNER_KEY,
  scopedSyncCacheKey,
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

class BlockingMemoryStorage extends MemoryStorage {
  constructor(entries) {
    super(entries);
    this.blockNextSet = true;
    this.entered = new Promise((resolve) => {
      this.markEntered = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  async multiSet(entries) {
    if (this.blockNextSet) {
      this.blockNextSet = false;
      this.markEntered();
      await this.gate;
    }
    await super.multiSet(entries);
  }
}

const SYNC_KEYS = ["state", "plan"];

test("guest data is claimed, isolated on A to B, and restored on B to A", async () => {
  const storage = new MemoryStorage([["state", "guest-a"]]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  let currentUser = "A";
  const current = async () => currentUser;

  assert.deepEqual(await coordinator.prepareOwner("A", current), {
    status: "ready",
    changed: true,
  });
  assert.equal(await storage.getItem("state"), "guest-a");

  currentUser = "B";
  assert.deepEqual(await coordinator.prepareOwner("B", current), {
    status: "ready",
    changed: true,
  });
  assert.equal(await storage.getItem("state"), null);
  assert.equal(
    await storage.getItem(scopedSyncCacheKey("A", "state")),
    "guest-a",
  );

  const bRead = await coordinator.readOwned("B", current, SYNC_KEYS);
  assert.deepEqual(bRead, {
    status: "ready",
    value: [
      ["state", null],
      ["plan", null],
    ],
  });

  await storage.setItem("state", "b-state");
  currentUser = "A";
  assert.deepEqual(await coordinator.prepareOwner("A", current), {
    status: "ready",
    changed: true,
  });
  assert.equal(await storage.getItem("state"), "guest-a");
  assert.equal(
    await storage.getItem(scopedSyncCacheKey("B", "state")),
    "b-state",
  );
  assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), "A");
});

test("a stale expected uid aborts an owner transition without mutation", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "a-state"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const before = new Map(storage.values);

  assert.deepEqual(await coordinator.prepareOwner("A", async () => "B"), {
    status: "stale",
  });
  assert.deepEqual(storage.values, before);
});

test("an auth change during transition is rechecked before any mutation", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "a-state"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  const before = new Map(storage.values);
  let checks = 0;

  const outcome = await coordinator.prepareOwner("B", async () => {
    checks += 1;
    return checks === 1 ? "B" : "A";
  });

  assert.deepEqual(outcome, { status: "stale" });
  assert.deepEqual(storage.values, before);
});

test("stale restore commits cannot mutate another owner's global keys", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "B"],
    ["state", "b-state"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  const outcome = await coordinator.commitOwned(
    "A",
    async () => "B",
    [["state", "late-a-state"]],
    [],
  );

  assert.deepEqual(outcome, { status: "stale" });
  assert.equal(await storage.getItem("state"), "b-state");
});

test("a queued owner transition moves a late previous-owner commit before B can read", async () => {
  const storage = new BlockingMemoryStorage([[LOCAL_SYNC_OWNER_KEY, "A"]]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  let currentUser = "A";
  const current = async () => currentUser;

  const lateACommit = coordinator.commitOwned(
    "A",
    current,
    [["state", "late-a-state"]],
    [],
  );
  await storage.entered;
  currentUser = "B";
  const switchToB = coordinator.prepareOwner("B", current);
  storage.release();

  assert.deepEqual(await lateACommit, { status: "stale" });
  assert.deepEqual(await switchToB, { status: "ready", changed: true });
  assert.equal(await storage.getItem("state"), null);
  assert.equal(
    await storage.getItem(scopedSyncCacheKey("A", "state")),
    "late-a-state",
  );
  assert.deepEqual(await coordinator.readOwned("B", current, SYNC_KEYS), {
    status: "ready",
    value: [
      ["state", null],
      ["plan", null],
    ],
  });
});

test("automatic and manual sync bind work to an expected authenticated owner", async () => {
  const [syncSource, autoSource, profileSource] = await Promise.all([
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
      new URL("../../artifacts/mobile/app/(tabs)/profile.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    syncSource,
    /new SyncStorageCoordinator\(AsyncStorage, SYNC_KEYS\)/,
  );
  assert.match(syncSource, /backupToCloud\(expectedUserId\?: string\)/);
  assert.match(syncSource, /restoreFromCloud\([\s\S]*expectedUserId\?: string/);
  assert.match(
    syncSource,
    /serializeRestoreFields\(data, RESTORE_FIELD_KINDS\)/,
  );
  assert.match(
    autoSource,
    /prepareLocalSyncOwner\(currentUserId\)[\s\S]*restoreFromCloud\(currentUserId\)/,
  );
  assert.match(autoSource, /getCurrentCloudSyncUserId\(\)[\s\S]*currentUserId/);
  assert.match(autoSource, /backupToCloud\(userId\)/);
  assert.match(profileSource, /restoreFromCloud\(expectedUserId\)/);
  assert.match(profileSource, /migrateLegacyFirebaseData\(expectedUserId\)/);
  assert.doesNotMatch(profileSource, /migrateLegacyFirebaseData\(user\.id\)/);
});
