import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createGenerationGuardedCurrentUserResolver,
  LEGACY_LOCAL_SYNC_GUEST_OWNER,
  LEGACY_LOCAL_SYNC_QUARANTINE_OWNER,
  LOCAL_SYNC_JOURNAL_KEY,
  LOCAL_SYNC_GUEST_OWNER,
  LOCAL_SYNC_OWNER_KEY,
  LOCAL_SYNC_QUARANTINE_OWNER,
  LOCAL_SYNC_TRANSITION_EPOCH_KEY,
  readStableSynchronizedValue,
  readStableSynchronizedValueWithOwner,
  STALE_CURRENT_USER,
  scopedSyncCacheKey,
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("background reads accept only unchanged stable owners", async () => {
  for (const owner of [
    null,
    LOCAL_SYNC_GUEST_OWNER,
    storedSyncUserOwner("A"),
  ]) {
    const entries = [["places", '[{"id":"A-gym"}]']];
    if (owner !== null) entries.push([LOCAL_SYNC_OWNER_KEY, owner]);
    const storage = new MemoryStorage(entries);
    assert.equal(
      await readStableSynchronizedValue(storage, "places"),
      '[{"id":"A-gym"}]',
    );
  }

  for (const entries of [
    [
      [LOCAL_SYNC_OWNER_KEY, LOCAL_SYNC_QUARANTINE_OWNER],
      ["places", '[{"id":"unsafe"}]'],
    ],
    [
      [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
      [LOCAL_SYNC_JOURNAL_KEY, '{"kind":"transition"}'],
      ["places", '[{"id":"unsafe"}]'],
    ],
    [
      [LOCAL_SYNC_OWNER_KEY, "raw-unverified-owner"],
      ["places", '[{"id":"unsafe"}]'],
    ],
  ]) {
    assert.equal(
      await readStableSynchronizedValue(new MemoryStorage(entries), "places"),
      null,
    );
  }
});

test("background reads return the verified decoded user owner with the value", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("account/a")],
    ["places", '[{"id":"A-gym"}]'],
  ]);
  assert.deepEqual(
    await readStableSynchronizedValueWithOwner(storage, "places"),
    {
      ownerUserId: "account/a",
      value: '[{"id":"A-gym"}]',
    },
  );
});

test("background reads fail closed when an owner transition starts between checks", async () => {
  class TransitionDuringReadStorage extends MemoryStorage {
    async getItem(key) {
      if (key === "places") {
        this.values.set(LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("B"));
        this.values.set("places", '[{"id":"B-gym"}]');
      }
      return super.getItem(key);
    }
  }

  const storage = new TransitionDuringReadStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["places", '[{"id":"A-gym"}]'],
  ]);
  assert.equal(await readStableSynchronizedValue(storage, "places"), null);

  class JournalDuringReadStorage extends MemoryStorage {
    async getItem(key) {
      if (key === "places") {
        this.values.set(
          LOCAL_SYNC_JOURNAL_KEY,
          JSON.stringify({ version: 2, kind: "transition" }),
        );
      }
      return super.getItem(key);
    }
  }

  const pendingTransition = new JournalDuringReadStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["places", '[{"id":"A-gym"}]'],
  ]);
  assert.equal(
    await readStableSynchronizedValue(pendingTransition, "places"),
    null,
  );
});

test("background reads reject a complete A to B to A transition during the value read", async () => {
  class AbaTransitionStorage extends MemoryStorage {
    async getItem(key) {
      if (key !== "places") return super.getItem(key);

      this.values.set(LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("B"));
      this.values.set(LOCAL_SYNC_TRANSITION_EPOCH_KEY, "42");
      this.values.set("places", '[{"id":"B-gym"}]');
      const capturedOtherAccountValue = await super.getItem(key);

      this.values.set(LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A"));
      this.values.set(LOCAL_SYNC_TRANSITION_EPOCH_KEY, "43");
      this.values.set("places", '[{"id":"A-gym"}]');
      return capturedOtherAccountValue;
    }
  }

  const storage = new AbaTransitionStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    [LOCAL_SYNC_TRANSITION_EPOCH_KEY, "41"],
    ["places", '[{"id":"A-gym"}]'],
  ]);
  assert.equal(await readStableSynchronizedValue(storage, "places"), null);
});

test("an A1 Firebase lookup resolving after A to B to A2 is stale before mutation", async () => {
  const lookup = deferred();
  let scope = { ready: true, uid: "A", generation: 1 };
  const resolver = createGenerationGuardedCurrentUserResolver(
    { uid: "A", generation: 1 },
    () => scope,
    () => lookup.promise,
  );
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "A2-current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, ["state"]);

  const staleCommit = coordinator.commitOwned(
    "A",
    resolver,
    [["state", "A1-stale"]],
    [],
  );
  scope = { ready: true, uid: "B", generation: 2 };
  scope = { ready: true, uid: "A", generation: 3 };
  lookup.resolve("A");

  assert.deepEqual(await staleCommit, { status: "stale" });
  assert.equal(await storage.getItem("state"), "A2-current");
  assert.deepEqual(await resolver(), STALE_CURRENT_USER);

  const failedLookup = createGenerationGuardedCurrentUserResolver(
    { uid: "A", generation: 3 },
    () => scope,
    async () => {
      throw new Error("auth unavailable");
    },
  );
  assert.deepEqual(await failedLookup(), STALE_CURRENT_USER);
});

test("Firebase-looking sentinel UIDs are encoded as users and never impersonate system owners", async () => {
  const collisionUids = [
    LEGACY_LOCAL_SYNC_GUEST_OWNER,
    LEGACY_LOCAL_SYNC_QUARANTINE_OWNER,
    "@elovia_sync_owner:stale-generation",
    "@elovia_sync_owner:stale-cloud-session",
    LOCAL_SYNC_GUEST_OWNER,
    LOCAL_SYNC_QUARANTINE_OWNER,
    "user:A",
  ];
  assert.equal(
    new Set(collisionUids.map(storedSyncUserOwner)).size,
    collisionUids.length,
  );

  for (const uid of collisionUids) {
    const storage = new MemoryStorage([["state", `owned:${uid}`]]);
    const coordinator = new SyncStorageCoordinator(storage, ["state"]);
    assert.deepEqual(await coordinator.prepareOwner(uid, async () => uid), {
      status: "ready",
      changed: true,
    });
    const storedOwner = storedSyncUserOwner(uid);
    assert.equal(await storage.getItem(LOCAL_SYNC_OWNER_KEY), storedOwner);
    assert.notEqual(storedOwner, LOCAL_SYNC_GUEST_OWNER);
    assert.notEqual(storedOwner, LOCAL_SYNC_QUARANTINE_OWNER);

    assert.deepEqual(await coordinator.prepareOwner(null, async () => null), {
      status: "ready",
      changed: true,
    });
    assert.equal(
      await storage.getItem(LOCAL_SYNC_OWNER_KEY),
      LOCAL_SYNC_GUEST_OWNER,
    );
    assert.equal(
      await storage.getItem(scopedSyncCacheKey(storedOwner, "state")),
      `owned:${uid}`,
    );

    const legacyStorage = new MemoryStorage([
      [LOCAL_SYNC_OWNER_KEY, uid],
      ["state", `legacy:${uid}`],
    ]);
    const legacy = new SyncStorageCoordinator(legacyStorage, ["state"]);
    assert.deepEqual(await legacy.prepareOwner(uid, async () => uid), {
      status: "ready",
      changed: true,
    });
    assert.equal(
      await legacyStorage.getItem(LOCAL_SYNC_OWNER_KEY),
      storedSyncUserOwner(uid),
    );
    assert.equal(await legacyStorage.getItem("state"), `legacy:${uid}`);
  }
});

test("legacy raw owner markers migrate only for the exact authenticated UID", async () => {
  const exactStorage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "A-state"],
  ]);
  const exact = new SyncStorageCoordinator(exactStorage, ["state"]);
  assert.deepEqual(await exact.prepareOwner("A", async () => "A"), {
    status: "ready",
    changed: true,
  });
  assert.equal(
    await exactStorage.getItem(LOCAL_SYNC_OWNER_KEY),
    storedSyncUserOwner("A"),
  );

  const mismatchedStorage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, "A"],
    ["state", "A-state"],
  ]);
  const mismatched = new SyncStorageCoordinator(mismatchedStorage, ["state"]);
  await assert.rejects(mismatched.prepareOwner("B", async () => "B"));
  assert.equal(
    await mismatchedStorage.getItem(LOCAL_SYNC_OWNER_KEY),
    LOCAL_SYNC_QUARANTINE_OWNER,
  );
  assert.equal(await mismatchedStorage.getItem("state"), "A-state");
  assert.deepEqual(await mismatched.prepareOwner("A", async () => "A"), {
    status: "ready",
    changed: true,
  });
  assert.equal(
    await mismatchedStorage.getItem(LOCAL_SYNC_OWNER_KEY),
    storedSyncUserOwner("A"),
  );

  const guestStorage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, LEGACY_LOCAL_SYNC_GUEST_OWNER],
  ]);
  const guest = new SyncStorageCoordinator(guestStorage, ["state"]);
  assert.deepEqual(await guest.prepareOwner(null, async () => null), {
    status: "ready",
    changed: true,
  });
  assert.equal(
    await guestStorage.getItem(LOCAL_SYNC_OWNER_KEY),
    LOCAL_SYNC_GUEST_OWNER,
  );
});

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
  assert.equal(await storage.getItem(LOCAL_SYNC_TRANSITION_EPOCH_KEY), "1");

  currentUser = "B";
  assert.deepEqual(await coordinator.prepareOwner("B", current), {
    status: "ready",
    changed: true,
  });
  assert.equal(await storage.getItem("state"), null);
  assert.equal(await storage.getItem(LOCAL_SYNC_TRANSITION_EPOCH_KEY), "2");
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
    ),
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
  assert.equal(await storage.getItem(LOCAL_SYNC_TRANSITION_EPOCH_KEY), "3");
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("B"), "state"),
    ),
    "b-state",
  );
  assert.equal(
    await storage.getItem(LOCAL_SYNC_OWNER_KEY),
    storedSyncUserOwner("A"),
  );
});

test("authenticated A is isolated from signed-out guest and later B", async () => {
  const accountKeys = ["@elovia_state"];
  const storage = new MemoryStorage(
    Object.entries({
      [LOCAL_SYNC_OWNER_KEY]: storedSyncUserOwner("A"),
      "@elovia_state": "A-state",
    }),
  );
  const coordinator = new SyncStorageCoordinator(storage, accountKeys);
  let currentUser = null;

  const guest = await coordinator.prepareOwner(null, async () => currentUser);
  assert.deepEqual(guest, { status: "ready", changed: true });
  assert.equal(await storage.getItem("@elovia_state"), null);
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("A"), "@elovia_state"),
    ),
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
  assert.equal(
    await storage.getItem(LOCAL_SYNC_OWNER_KEY),
    storedSyncUserOwner("A"),
  );
  assert.equal(await storage.getItem("@elovia_state"), "guest-state");
});

test("an old A generation cannot write after A to B to A remounts", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "A-current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, ["state"]);
  let currentUid = "A";
  let generation = 1;
  const oldGeneration = generation;
  const oldAResolver = async () =>
    generation === oldGeneration ? currentUid : STALE_CURRENT_USER;

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
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
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
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
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
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("B")],
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
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "a2-current"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  let generationIsCurrent = true;

  const lateA1Commit = coordinator.commitOwned(
    "A",
    async () => (generationIsCurrent ? "A" : STALE_CURRENT_USER),
    [["state", "a1-stale"]],
    [],
  );
  await storage.entered;
  generationIsCurrent = false;
  storage.release();

  assert.deepEqual(await lateA1Commit, { status: "stale" });
  assert.equal(await storage.getItem("state"), "a2-current");
});

test("every owned commit phase is crash-recoverable without partial data or revision", async () => {
  const mutationPhases = 7;

  for (let failAt = 1; failAt <= mutationPhases; failAt++) {
    const storage = new FailingMemoryStorage([
      [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
      ["state", "old-state"],
      ["plan", "old-plan"],
      ["revision", "4"],
    ]);
    storage.setFailure(failAt);
    const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

    await assert.rejects(
      coordinator.commitOwned(
        "A",
        async () => "A",
        [["state", "new-state"]],
        ["plan"],
        [["revision", "5"]],
        "cloud-generation-7",
      ),
    );

    storage.clearFailure();
    const restarted = new SyncStorageCoordinator(storage, SYNC_KEYS);
    assert.deepEqual(
      await restarted.readOwned("A", async () => "A", [
        "state",
        "plan",
        "revision",
      ]),
      {
        status: "ready",
        value: [
          ["state", "old-state"],
          ["plan", "old-plan"],
          ["revision", "4"],
        ],
      },
    );
    assert.equal(
      await storage.getItem(LOCAL_SYNC_OWNER_KEY),
      storedSyncUserOwner("A"),
    );
    assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
  }
});

test("failed owned-commit recovery remains quarantined until a later retry", async () => {
  const storage = new FailingMemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "old-state"],
    ["revision", "4"],
  ]);
  storage.setFailure(4);
  await assert.rejects(
    new SyncStorageCoordinator(storage, SYNC_KEYS).commitOwned(
      "A",
      async () => "A",
      [["state", "new-state"]],
      [],
      [["revision", "5"]],
      "cloud-generation-9",
    ),
  );

  storage.setFailure(2);
  await assert.rejects(
    new SyncStorageCoordinator(storage, SYNC_KEYS).readOwned(
      "A",
      async () => "A",
      ["state", "revision"],
    ),
  );
  assert.equal(
    await storage.getItem(LOCAL_SYNC_OWNER_KEY),
    LOCAL_SYNC_QUARANTINE_OWNER,
  );
  assert.notEqual(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);

  storage.clearFailure();
  const recovered = new SyncStorageCoordinator(storage, SYNC_KEYS);
  assert.deepEqual(
    await recovered.readOwned("A", async () => "A", ["state", "revision"]),
    {
      status: "ready",
      value: [
        ["state", "old-state"],
        ["revision", "4"],
      ],
    },
  );
});

test("scoped reset clears only A globals/cache and preserves B and guest caches", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "a-global"],
    ["revision:A", "7"],
    [scopedSyncCacheKey(storedSyncUserOwner("A"), "state"), "a-cache"],
    [scopedSyncCacheKey(storedSyncUserOwner("B"), "state"), "b-cache"],
    [scopedSyncCacheKey(LOCAL_SYNC_GUEST_OWNER, "state"), "guest-cache"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  assert.deepEqual(
    await coordinator.resetOwned(
      "A",
      async () => "A",
      ["revision:A"],
      "cloud-generation-11",
    ),
    { status: "ready", value: undefined },
  );
  assert.equal(await storage.getItem("state"), null);
  assert.equal(await storage.getItem("revision:A"), null);
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
    ),
    null,
  );
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("B"), "state"),
    ),
    "b-cache",
  );
  assert.equal(
    await storage.getItem(scopedSyncCacheKey(LOCAL_SYNC_GUEST_OWNER, "state")),
    "guest-cache",
  );
});

test("guest reset clears guest globals/cache and preserves every authenticated cache", async () => {
  const storage = new MemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, LOCAL_SYNC_GUEST_OWNER],
    ["state", "guest-global"],
    [scopedSyncCacheKey(LOCAL_SYNC_GUEST_OWNER, "state"), "guest-cache"],
    [scopedSyncCacheKey(storedSyncUserOwner("A"), "state"), "a-cache"],
    [scopedSyncCacheKey(storedSyncUserOwner("B"), "state"), "b-cache"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);

  assert.deepEqual(
    await coordinator.resetOwned(
      null,
      async () => null,
      [],
      "guest-generation-4",
    ),
    { status: "ready", value: undefined },
  );
  assert.equal(await storage.getItem("state"), null);
  assert.equal(
    await storage.getItem(scopedSyncCacheKey(LOCAL_SYNC_GUEST_OWNER, "state")),
    null,
  );
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
    ),
    "a-cache",
  );
  assert.equal(
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("B"), "state"),
    ),
    "b-cache",
  );
});

test("cloud-saved reset revision survives mutation failure and restart recovery", async () => {
  const revisionKey = "revision:A";
  const storage = new FailingMemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "a-original"],
    [revisionKey, "7"],
  ]);
  const coordinator = new SyncStorageCoordinator(storage, SYNC_KEYS);
  storage.setFailure(4);

  await assert.rejects(
    coordinator.resetOwned(
      "A",
      async () => "A",
      [revisionKey],
      "cloud-generation-15",
      [[revisionKey, "8"]],
      [[revisionKey, "8"]],
    ),
    /Injected storage failure/,
  );

  storage.clearFailure();
  const restarted = new SyncStorageCoordinator(storage, SYNC_KEYS);
  assert.deepEqual(await restarted.prepareOwner("A", async () => "A"), {
    status: "ready",
    changed: false,
  });
  assert.equal(await storage.getItem("state"), "a-original");
  assert.equal(await storage.getItem(revisionKey), "8");
  assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
});

test("a queued owner transition excludes a rolled-back previous-owner commit from B", async () => {
  const storage = new BlockingMemoryStorage([
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
  ]);
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
    await storage.getItem(
      scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
    ),
    null,
  );
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
    [LOCAL_SYNC_OWNER_KEY, storedSyncUserOwner("A")],
    ["state", "a-state"],
    [scopedSyncCacheKey(storedSyncUserOwner("A"), "state"), "old-a-cache"],
    [scopedSyncCacheKey(storedSyncUserOwner("A"), "plan"), "old-a-plan-cache"],
    [scopedSyncCacheKey(storedSyncUserOwner("B"), "state"), "b-state"],
  ]);
}

test("every transition write phase fails closed, rolls back, and retries cleanly", async () => {
  const mutationPhases = 9;

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
    assert.equal(
      await storage.getItem(LOCAL_SYNC_OWNER_KEY),
      storedSyncUserOwner("A"),
    );
    assert.equal(await storage.getItem("state"), "a-state");
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
      ),
      "old-a-cache",
    );
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("A"), "plan"),
      ),
      "old-a-plan-cache",
    );
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("B"), "state"),
      ),
      "b-state",
    );

    assert.deepEqual(
      await restartedCoordinator.prepareOwner("B", async () => "B"),
      {
        status: "ready",
        changed: true,
      },
    );
    assert.equal(
      await storage.getItem(LOCAL_SYNC_OWNER_KEY),
      storedSyncUserOwner("B"),
    );
    assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
    assert.equal(await storage.getItem("state"), "b-state");
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("A"), "state"),
      ),
      "a-state",
    );
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("A"), "plan"),
      ),
      null,
    );
    assert.equal(
      await storage.getItem(
        scopedSyncCacheKey(storedSyncUserOwner("B"), "state"),
      ),
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
  assert.equal(
    await storage.getItem(LOCAL_SYNC_OWNER_KEY),
    storedSyncUserOwner("B"),
  );
  assert.equal(await storage.getItem(LOCAL_SYNC_JOURNAL_KEY), null);
  assert.equal(await storage.getItem("state"), "b-state");
});

test("automatic and manual sync bind work to an expected authenticated owner", async () => {
  const [syncSource, autoSource, profileSource, accountStorageSource] =
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
          "../../artifacts/mobile/app/profile-details.tsx",
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

  assert.match(syncSource, /syncStorageCoordinator as syncStorage/);
  assert.doesNotMatch(syncSource, /stale-cloud-session/);
  assert.doesNotMatch(syncSource, /stale-generation/);
  assert.match(
    accountStorageSource,
    /createGenerationGuardedCurrentUserResolver/,
  );
  assert.doesNotMatch(accountStorageSource, /STALE_GENERATION_OWNER/);
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
  assert.match(profileSource, /resetCurrentAccountData\(sessionToken\)/);
  assert.doesNotMatch(profileSource, /AsyncStorage\.clear\(\)/);
  assert.doesNotMatch(
    profileSource,
    /require\(["']@react-native-async-storage/,
  );
  assert.doesNotMatch(profileSource, /beginCloudSyncSession/);
});

test("legacy migration fetches outside storage and applies a validated journaled commit", async () => {
  const [syncSource, firebaseSource] = await Promise.all([
    readFile(
      new URL("../../artifacts/mobile/lib/cloudSync.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../artifacts/mobile/lib/firebaseSync.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    syncSource,
    /fetchLegacySnapshot\(expectedUserId, sessionToken\)/,
  );
  assert.match(syncSource, /serializeRestoreFields\([\s\S]*legacyRead\.data/);
  assert.match(syncSource, /legacyRead\.status === "unavailable"/);
  assert.match(syncSource, /legacyRead\.status === "offline"/);
  assert.match(
    syncSource,
    /readOwned\([\s\S]*migrationKey[\s\S]*flag\.value\[0\]\?\.\[1\][\s\S]*fetchLegacySnapshot/,
  );
  const unavailableReturn = syncSource.indexOf(
    'legacyRead.status === "unavailable"',
  );
  const offlineReturn = syncSource.indexOf('legacyRead.status === "offline"');
  const definitiveEmpty = syncSource.indexOf('legacyRead.status === "empty"');
  const firstMigrationFlagWrite = syncSource.indexOf(
    "[[migrationKey, new Date().toISOString()]]",
  );
  assert.ok(unavailableReturn < firstMigrationFlagWrite);
  assert.ok(offlineReturn < firstMigrationFlagWrite);
  assert.ok(definitiveEmpty < firstMigrationFlagWrite);
  assert.match(
    syncSource,
    /shouldFinalizeLegacyMigration\(legacyStatus, cloudBackup\.status\)/,
  );
  assert.doesNotMatch(syncSource, /runOwnedMutation/);
  assert.doesNotMatch(syncSource, /restoreFromFirestore/);
  assert.match(firebaseSource, /fetchLegacySnapshot/);
  assert.doesNotMatch(firebaseSource, /AsyncStorage/);
  assert.doesNotMatch(firebaseSource, /multiSet/);
});
