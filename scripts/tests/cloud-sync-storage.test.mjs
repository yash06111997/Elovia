import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOCAL_SYNC_JOURNAL_KEY,
  LOCAL_SYNC_OWNER_KEY,
  LOCAL_SYNC_QUARANTINE_OWNER,
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

class FailingMemoryStorage extends MemoryStorage {
  setFailure(failAt) {
    this.mutationCount = 0;
    this.failAt = failAt;
  }

  clearFailure() {
    this.mutationCount = 0;
    this.failAt = null;
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

test("authenticated A is isolated from signed-out guest and later B", async () => {
  const accountKeys = ["@elovia_state"];
  const storage = new MemoryStorage(
    Object.entries({
      [LOCAL_SYNC_OWNER_KEY]: "A",
      "@elovia_state": "A-state",
    }),
  );
  const coordinator = new SyncStorageCoordinator(storage, accountKeys);
  let currentUser = null;

  const guest = await coordinator.prepareOwner(null, async () => currentUser);
  assert.deepEqual(guest, { status: "ready", changed: true });
  assert.equal(await storage.getItem("@elovia_state"), null);
  assert.equal(
    await storage.getItem(scopedSyncCacheKey("A", "@elovia_state")),
    "A-state",
  );
  assert.deepEqual(
    await coordinator.readOwned(null, async () => currentUser, [
      "@elovia_state",
    ]),
    { status: "ready", value: [["@elovia_state", null]] },
  );

  currentUser = "B";
  const b = await coordinator.prepareOwner("B", async () => currentUser);
  assert.deepEqual(b, { status: "ready", changed: true });
  assert.equal(await storage.getItem("@elovia_state"), null);
  assert.deepEqual(
    await coordinator.readOwned("B", async () => currentUser, [
      "@elovia_state",
    ]),
    { status: "ready", value: [["@elovia_state", null]] },
  );
});

test("the first authenticated user claims unowned guest data without losing it", async () => {
  const storage = new MemoryStorage([["@elovia_state", "guest-state"]]);
  const coordinator = new SyncStorageCoordinator(storage, ["@elovia_state"]);
  let currentUser = null;

  assert.deepEqual(
    await coordinator.readOwned(null, async () => currentUser, [
      "@elovia_state",
    ]),
    { status: "ready", value: [["@elovia_state", "guest-state"]] },
  );

  currentUser = "A";
  assert.deepEqual(
    await coordinator.prepareOwner("A", async () => currentUser),
    { status: "ready", changed: true },
  );
  assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), "A");
  assert.equal(await storage.getItem("@elovia_state"), "guest-state");
});

test("an old A generation cannot write after A to B to A remounts", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "A-current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, ["state"]);
  let currentUid = "A";
  let generation = 1;
  const oldGeneration = generation;
  const oldAResolver = async () =>
    generation === oldGeneration ? currentUid : "stale-generation";

  currentUid = "B";
  generation++;
  await coordinator.prepareOwner("B", async () => currentUid);
  currentUid = "A";
  generation++;
  await coordinator.prepareOwner("A", async () => currentUid);

  const stale = await coordinator.commitOwned(
    "A",
    oldAResolver,
    [["state", "old-A-write"]],
    [],
  );
  assert.deepEqual(stale, { status: "stale" });
  assert.equal(await storage.getItem("state"), "A-current");
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

test("same-uid ABA invalidation during a commit rolls shared keys back", async () => {
  const storage = new BlockingMemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "a2-current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  let generationIsCurrent = true;

  const lateA1Commit = coordinator.commitOwned(
    "A",
    async () => (generationIsCurrent ? "A" : "stale-generation"),
    [["state", "a1-stale"]],
    [],
  );
  await storage.entered;
  generationIsCurrent = false;
  storage.release();

  assert.deepEqual(await lateA1Commit, { status: "stale" });
  assert.equal(await storage.getItem("state"), "a2-current");
});

test("a queued owner transition excludes a rolled-back previous-owner commit from B", async () => {
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
  assert.equal(await storage.getItem(scopedSyncCacheKey("A", "state")), null);
  assert.deepEqual(await coordinator.readOwned("B", current, SYNC_KEYS), {
    status: "ready",
    value: [
      ["state", null],
      ["plan", null],
    ],
  });
});

function transitionFixture() {
  return new FailingMemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "a-state"],
    [scopedSyncCacheKey("A", "state"), "old-a-cache"],
    [scopedSyncCacheKey("A", "plan"), "old-a-plan-cache"],
    [scopedSyncCacheKey("B", "state"), "b-state"],
  ]);
}

test("every transition write phase fails closed, rolls back, and retries cleanly", async () => {
  const mutationPhases = 8;

  for (let failAt = 1; failAt <= mutationPhases; failAt++) {
    const storage = transitionFixture();
    storage.setFailure(failAt);
    const firstCoordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

    await assert.rejects(firstCoordinator.prepareOwner("B", async () => "B"));

    storage.clearFailure();
    const restartedCoordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
    assert.deepEqual(
      await restartedCoordinator.readOwned("B", async () => "B", SYNC_KEYS),
      {
        status: "stale",
      },
    );
    assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), "A");
    assert.equal(await storage.getItem("state"), "a-state");
    assert.equal(
      await storage.getItem(scopedSyncCacheKey("A", "state")),
      "old-a-cache",
    );
    assert.equal(
      await storage.getItem(scopedSyncCacheKey("A", "plan")),
      "old-a-plan-cache",
    );
    assert.equal(
      await storage.getItem(scopedSyncCacheKey("B", "state")),
      "b-state",
    );

    assert.deepEqual(
      await restartedCoordinator.prepareOwner("B", async () => "B"),
      {
        status: "ready",
        changed: true,
      },
    );
    assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), "B");
    assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
    assert.equal(await storage.getItem("state"), "b-state");
    assert.equal(
      await storage.getItem(scopedSyncCacheKey("A", "state")),
      "a-state",
    );
    assert.equal(await storage.getItem(scopedSyncCacheKey("A", "plan")), null);
    assert.equal(
      await storage.getItem(scopedSyncCacheKey("B", "state")),
      "b-state",
    );
  }
});

test("failed rollback remains quarantined and a later restart can recover", async () => {
  const storage = transitionFixture();
  storage.setFailure(3);
  await assert.rejects(
    new SyncStorageCoordinator(storage, SYNC_KEYS).prepareOwner(
      "B",
      async () => "B",
    ),
  );
  assert.notEqual(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);

  storage.setFailure(2);
  await assert.rejects(
    new SyncStorageCoordinator(storage, SYNC_KEYS).readOwned(
      "B",
      async () => "B",
      SYNC_KEYS,
    ),
  );
  assert.equal(
    await storage.getItem(LOCAL_SYNC_OWNER_KEY),
    LOCAL_SYNC_QUARANTINE_OWNER,
  );
  assert.notEqual(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);

  storage.clearFailure();
  const recovered = new SyncStorageCoordinator(storage, SYNC_KEYS);
  assert.deepEqual(await recovered.prepareOwner("B", async () => "B"), {
    status: "ready",
    changed: true,
  });
  assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), "B");
  assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
  assert.equal(await storage.getItem("state"), "b-state");
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

  assert.match(syncSource, /syncStorageCoordinator as syncStorage/);
  assert.match(
    syncSource,
    /backupToCloud\([\s\S]*sessionToken: CloudSyncSessionToken/,
  );
  assert.match(
    syncSource,
    /restoreFromCloud\([\s\S]*sessionToken: CloudSyncSessionToken/,
  );
  assert.match(
    syncSource,
    /serializeRestoreFields\(data, RESTORE_FIELD_KINDS\)/,
  );
  assert.match(
    autoSource,
    /prepareLocalSyncOwner\(sessionToken\)[\s\S]*restoreFromCloud\(sessionToken\)/,
  );
  assert.match(autoSource, /isCloudSyncSessionCurrent\(sessionToken\)/);
  assert.match(autoSource, /backupToCloud\(sessionToken\)/);
  assert.match(autoSource, /endCloudSyncSession\(ownedSessionToken\)/);
  assert.match(profileSource, /getCurrentCloudSyncSession\(expectedUserId\)/);
  assert.match(profileSource, /restoreFromCloud\(sessionToken\)/);
  assert.match(profileSource, /migrateLegacyFirebaseData\(sessionToken\)/);
  assert.doesNotMatch(profileSource, /beginCloudSyncSession/);
});
