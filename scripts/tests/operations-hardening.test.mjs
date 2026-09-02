import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  beginPushRegistrationIntent,
  canCompletePushLogout,
  hasVerifiedServerDetachment,
  isVerifiedPushMutationResponse,
  parseCachedPushOwnership,
  parsePersistedPushRegistrationState,
  persistPushOwnershipOrCompensate,
  planPushOwnershipTransition,
  planPushServerCleanup,
  resolvePushPermission,
  runPushSafeSignOut,
  runPushOwnershipMutation,
  serializeDetachedPushRegistrationState,
  serializeOwnedPushRegistrationState,
  serializeRegisteringPushRegistrationState,
} from "../../artifacts/mobile/lib/pushOwnership.ts";
import {
  PushCleanupStore,
  runPushCleanupForUser,
  shouldPresentEloviaNotification,
} from "../../artifacts/mobile/lib/pushCleanup.ts";
import {
  buildReminderSchedule,
  ELOVIA_REMINDER_OWNER,
  isEloviaReminderNotification,
  normalizeReminderPreferences,
} from "../../artifacts/mobile/lib/reminderSchedule.ts";
import {
  PENDING_ARRIVAL_LEASE_MS,
  PendingArrivalStore,
} from "../../artifacts/mobile/lib/pendingArrival.ts";
import { runReminderReconciliation } from "../../artifacts/mobile/lib/reminderReconciliation.ts";
import { runGeofenceReconciliation } from "../../artifacts/mobile/lib/geofenceReconciliation.ts";
import {
  emitPendingArrivalRecorded,
  onPendingArrivalRecorded,
} from "../../artifacts/mobile/lib/pendingArrivalSignal.ts";
import { runNativeReconciliationWithRetry } from "../../artifacts/mobile/lib/nativeReconciliationRetry.ts";
import {
  LogoutSingleFlight,
  runLogoutWorkflow,
} from "../../artifacts/mobile/lib/logoutWorkflow.ts";
import {
  ACCOUNT_DELETION_MARKER_KEY,
  AccountDeletionRecoveryStore,
  isAccountDeletionFinalizing,
  isProvablyPreDeletionBoundaryError,
  prepareAccountDeletionRequest,
  recoverAccountDeletionFinalization,
} from "../../artifacts/mobile/lib/accountDeletionRecovery.ts";
import { runAccountDeletionWorkflow } from "../../artifacts/api-server/src/lib/accountDeletionWorkflow.ts";
import {
  accountDeletionRetryDelayMs,
  runAccountDeletionFinalizationBatch,
} from "../../artifacts/api-server/src/lib/accountDeletionFinalizerCore.ts";
import { verifyFirebaseTokenWithPolicy } from "../../artifacts/api-server/src/lib/firebaseTokenPolicy.ts";
import {
  canCompleteNativeStateLogout,
  captureNativeLifecycleFence,
  isNativeLifecycleFenceCurrent,
  isNativeLifecycleOwnerCurrent,
  NativeLifecycleStateStore,
  resumeNativeLifecycleOwner,
  runNativeOwnerReconciliation,
  runVerifiedNativeCleanup,
  setNativeLifecycleAuthOwner,
  suspendNativeLifecycleOwner,
} from "../../artifacts/mobile/lib/nativeLifecycleCleanup.ts";
import {
  emitDataRestored,
  onDataRestored,
} from "../../artifacts/mobile/lib/syncEvents.ts";

const repositoryRoot = new URL("../../", import.meta.url);

async function source(relativePath) {
  try {
    return await readFile(new URL(relativePath, repositoryRoot), "utf8");
  } catch {
    return "";
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class MemoryKeyValueStorage {
  values = new Map();
  async getItem(key) {
    return this.values.get(key) ?? null;
  }
  async setItem(key, value) {
    this.values.set(key, value);
  }
  async removeItem(key) {
    this.values.delete(key);
  }
  async getAllKeys() {
    return [...this.values.keys()];
  }
  async multiRemove(keys) {
    for (const key of keys) this.values.delete(key);
  }
}

test("telemetry is allowlisted, privacy-safe, rate-limited, and connected to crash reporting", async () => {
  const api = await source("artifacts/api-server/src/routes/telemetry.ts");
  const client = await source("artifacts/mobile/lib/telemetry.ts");
  const root = await source("artifacts/mobile/app/_layout.tsx");

  assert.match(api, /ALLOWED_EVENTS/);
  assert.match(api, /rateLimit/);
  assert.match(api, /res\.sendStatus\(204\)/);
  assert.doesNotMatch(api, /req\.body\.message/);
  assert.match(api, /"account_deletion_finalizing"/);
  assert.match(client, /reportClientError/);
  assert.match(client, /\| "account_deletion_finalizing"/);
  assert.doesNotMatch(client, /error\.message/);
  assert.match(root, /onError=\{reportClientError\}/);
});

test("release safeguards include CI, database readiness, and Railway readiness checks", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  const health = await source("artifacts/api-server/src/routes/health.ts");
  const railway = await source("railway.json");

  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm typecheck/);
  assert.match(workflow, /--filter @workspace\/mobile typecheck/);
  assert.match(workflow, /--filter @workspace\/api-server typecheck/);
  assert.match(workflow, /@workspace\/api-server run build/);
  assert.match(health, /router\.get\("\/readyz"/);
  assert.match(health, /select 1/);
  assert.equal(JSON.parse(railway).deploy.healthcheckPath, "/api/readyz");
});

test("Maestro covers the seven-step onboarding preview and workout feedback", async () => {
  const onboarding = await source("e2e/maestro/onboarding-preview.yaml");
  const workout = await source("e2e/maestro/workout-feedback.yaml");
  const readme = await source("e2e/README.md");

  assert.match(onboarding, /appId: com\.elovia\.app/);
  assert.match(onboarding, /Create my plan/);
  assert.match(onboarding, /Your plan is ready/);
  assert.match(workout, /Post-workout check-in/);
  assert.match(workout, /Save workout feedback/);
  assert.match(readme, /maestro test/);
});

test("Metro adds the workspace without discarding Expo default watch folders", async () => {
  const metro = await source("artifacts/mobile/metro.config.js");
  assert.match(metro, /\.\.\.\(config\.watchFolders \|\| \[\]\)/);
  assert.doesNotMatch(metro, /config\.watchFolders = \[workspaceRoot\]/);
});

test("known vulnerable runtime and build dependencies are pinned to patched releases", async () => {
  const workspace = await source("pnpm-workspace.yaml");

  assert.match(workspace, /drizzle-orm: \^0\.45\.2/);
  assert.match(workspace, /protobufjs@>=7 <7\.6\.5/);
  assert.match(workspace, /shell-quote@>=1\.1\.0 <1\.9\.0/);
  assert.match(workspace, /websocket-driver@>=0\.7\.0 <0\.7\.5/);
  assert.match(workspace, /path-to-regexp@>=8\.0\.0 <8\.4\.0/);
});

test("cloud snapshots include the complete advertised recoverable state", async () => {
  const [accountStorage, cloudSync, notifications, geofence, geofenceTask] =
    await Promise.all([
      source("artifacts/mobile/lib/accountSyncStorage.ts"),
      source("artifacts/mobile/lib/cloudSync.ts"),
      source("artifacts/mobile/lib/notifications.ts"),
      source("artifacts/mobile/lib/geofence.ts"),
      source("artifacts/mobile/lib/geofenceTask.ts"),
    ]);

  for (const key of [
    "@elovia_active_session",
    "@elovia_wellness",
    "@elovia_water_goal",
    "@elovia_reminder_prefs",
    "@elovia_places",
  ]) {
    assert.match(accountStorage, new RegExp(key));
  }
  assert.match(cloudSync, /"@elovia_reminder_prefs": "reminderPrefs"/);
  assert.match(cloudSync, /"@elovia_places": "places"/);
  assert.match(cloudSync, /reminderPrefs: "plain-object"/);
  assert.match(cloudSync, /places: "array"/);

  assert.match(notifications, /captureAccountStorageSession/);
  assert.doesNotMatch(
    notifications,
    /@react-native-async-storage\/async-storage/,
  );
  assert.match(geofence, /captureAccountStorageSession/);
  assert.match(geofence, /readStableBackgroundAccountValue/);
  assert.match(geofenceTask, /loadPlacesForBackgroundTask/);
  assert.doesNotMatch(geofenceTask, /\bloadPlaces\b/);
});

test("push ownership transitions never unregister another account with the current session", () => {
  assert.deepEqual(
    parseCachedPushOwnership(
      JSON.stringify({ userId: "user-a", token: "ExponentPushToken[a]" }),
    ),
    { userId: "user-a", token: "ExponentPushToken[a]" },
  );
  assert.equal(parseCachedPushOwnership("ExponentPushToken[legacy]"), null);
  assert.equal(parseCachedPushOwnership('{"userId":"","token":"x"}'), null);

  assert.deepEqual(
    planPushOwnershipTransition(
      { userId: "user-a", token: "ExponentPushToken[old]" },
      "user-a",
      "ExponentPushToken[new]",
    ),
    {
      action: "replace-current-token",
      unregisterToken: "ExponentPushToken[old]",
    },
  );
  assert.deepEqual(
    planPushOwnershipTransition(
      { userId: "user-a", token: "ExponentPushToken[same-device]" },
      "user-b",
      "ExponentPushToken[same-device]",
    ),
    { action: "transfer-owner" },
  );
  assert.deepEqual(
    planPushOwnershipTransition(
      { userId: "user-a", token: "ExponentPushToken[old-device]" },
      "user-b",
      "ExponentPushToken[new-device]",
    ),
    { action: "transfer-owner" },
  );
});

test("push logout requires explicit versioned detachment evidence across upgrades", () => {
  const ownership = {
    userId: "user-a",
    token: "ExponentPushToken[versioned]",
  };
  assert.deepEqual(
    parsePersistedPushRegistrationState(
      serializeOwnedPushRegistrationState(ownership),
    ),
    { status: "owned", ownership, versioned: true },
  );
  const registeringRaw = serializeRegisteringPushRegistrationState(ownership);
  const registering = parsePersistedPushRegistrationState(registeringRaw);
  assert.deepEqual(registering, { status: "registering", ownership });
  assert.deepEqual(planPushServerCleanup(registering, "user-a", []), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [ownership],
  });

  const legacy = parsePersistedPushRegistrationState(
    "ExponentPushToken[legacy]",
  );
  assert.deepEqual(legacy, {
    status: "legacy-token",
    token: "ExponentPushToken[legacy]",
  });
  assert.deepEqual(planPushServerCleanup(legacy, "user-a", []), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [{ userId: "user-a", token: "ExponentPushToken[legacy]" }],
  });
  const missing = parsePersistedPushRegistrationState(null);
  const corrupt = parsePersistedPushRegistrationState("not-json-or-token");
  assert.deepEqual(missing, { status: "unknown" });
  assert.deepEqual(corrupt, { status: "unknown" });
  assert.deepEqual(planPushServerCleanup(missing, "user-a", []), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [],
  });
  assert.deepEqual(planPushServerCleanup(corrupt, "user-a", []), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [],
  });

  for (const state of [legacy, missing, corrupt]) {
    assert.equal(hasVerifiedServerDetachment(state, false), false);
    assert.equal(
      canCompletePushLogout({
        serverDetached: hasVerifiedServerDetachment(state, false),
        nativeDetached: false,
        cleanupPending: true,
      }),
      false,
      "unknown upgrade state plus failed native revocation must block logout",
    );
    assert.equal(
      canCompletePushLogout({
        serverDetached: hasVerifiedServerDetachment(state, false),
        nativeDetached: true,
        cleanupPending: true,
      }),
      true,
      "verified native revocation is independently safe",
    );
  }

  const detached = parsePersistedPushRegistrationState(
    serializeDetachedPushRegistrationState(),
  );
  assert.deepEqual(detached, { status: "detached" });
  assert.deepEqual(planPushServerCleanup(detached, "user-a", []), {
    alreadyDetached: true,
    ownershipConflict: false,
    candidates: [],
  });
  assert.deepEqual(planPushServerCleanup(detached, "user-a", [ownership]), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [ownership],
  });
  assert.equal(hasVerifiedServerDetachment(detached, false), true);
  assert.equal(hasVerifiedServerDetachment(legacy, true), true);
  assert.equal(
    isVerifiedPushMutationResponse("unregister", { unregistered: false }),
    false,
    "a legacy zero-row response is not detachment evidence",
  );
  assert.equal(
    isVerifiedPushMutationResponse("unregister", { unregistered: true }),
    true,
  );
  assert.equal(
    isVerifiedPushMutationResponse("register", { registered: true }),
    true,
  );
});

test("push registration write-ahead intent survives every persistence boundary", async () => {
  const ownership = {
    userId: "user-a",
    token: "ExponentPushToken[crash-window]",
  };
  const previous = {
    userId: "user-a",
    token: "ExponentPushToken[previous]",
  };
  const preserved = [];
  let raw = null;
  assert.equal(
    await beginPushRegistrationIntent({
      ownership,
      previousOwnership: previous,
      async preserve(candidate) {
        preserved.push(candidate);
        return false;
      },
      async persistRegistering() {
        throw new Error("must not overwrite an unpreserved previous owner");
      },
    }),
    false,
  );
  assert.equal(raw, null);

  assert.equal(
    await beginPushRegistrationIntent({
      ownership,
      previousOwnership: previous,
      async preserve(candidate) {
        preserved.push(candidate);
        return true;
      },
      async persistRegistering() {
        throw new Error("injected registering-state write failure");
      },
    }),
    false,
  );
  assert.deepEqual(preserved.at(-1), previous);

  assert.equal(
    await beginPushRegistrationIntent({
      ownership,
      previousOwnership: previous,
      async preserve(candidate) {
        if (candidate.token === ownership.token) {
          throw new Error("injected redundant journal failure");
        }
        return true;
      },
      async persistRegistering(serialized) {
        raw = serialized;
      },
    }),
    true,
    "versioned registering state alone closes the post-write crash window",
  );
  const registering = parsePersistedPushRegistrationState(raw);
  assert.deepEqual(registering, { status: "registering", ownership });
  assert.deepEqual(planPushServerCleanup(registering, "user-a", []), {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [ownership],
  });
});

test("stale push registration compensates with the captured account credential before the next retry", async () => {
  let currentUserId = "user-a";
  let serverOwner = null;
  const aRegistration = deferred();
  const bRegistration = deferred();
  const calls = [];

  const mutate = (session, gate) =>
    runPushOwnershipMutation({
      session,
      token: "ExponentPushToken[device]",
      transition: { action: "transfer-owner" },
      isSessionCurrent: async (captured) => currentUserId === captured.userId,
      async register(captured, token) {
        calls.push(["register-start", captured.userId, captured.authToken]);
        await gate.promise;
        if (captured.userId === "user-b") return false;
        serverOwner = { userId: captured.userId, token };
        calls.push(["register-finish", captured.userId, captured.authToken]);
        return true;
      },
      async unregister(captured, token) {
        calls.push(["unregister", captured.userId, captured.authToken]);
        if (
          serverOwner?.userId === captured.userId &&
          serverOwner.token === token
        ) {
          serverOwner = null;
        }
        return true;
      },
    });

  const a = mutate(
    { userId: "user-a", authToken: "credential-a" },
    aRegistration,
  );
  await new Promise((resolve) => setImmediate(resolve));
  currentUserId = "user-b";
  aRegistration.resolve();
  assert.deepEqual(await a, { status: "stale", compensated: true });
  assert.equal(serverOwner, null);
  assert.deepEqual(calls.at(-1), ["unregister", "user-a", "credential-a"]);

  const b = mutate(
    { userId: "user-b", authToken: "credential-b" },
    bRegistration,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(serverOwner, null, "a is removed while b remains delayed");
  bRegistration.resolve();
  assert.deepEqual(await b, { status: "network" });
  assert.equal(
    serverOwner,
    null,
    "a is not restored when b registration fails",
  );
});

test("logout suspension compensates a registration response already in flight", async () => {
  setNativeLifecycleAuthOwner("user-a");
  const lifecycleFence = captureNativeLifecycleFence("user-a");
  assert.ok(lifecycleFence);
  const responseGate = deferred();
  let serverOwner = null;
  const calls = [];
  const operation = runPushOwnershipMutation({
    session: {
      userId: "user-a",
      authToken: "captured-a",
      lifecycleFence,
    },
    token: "ExponentPushToken[queued-logout]",
    transition: { action: "register" },
    isSessionCurrent: async (session) =>
      isNativeLifecycleFenceCurrent(session.lifecycleFence),
    async register(session, token) {
      calls.push(["register", session.authToken]);
      await responseGate.promise;
      serverOwner = { userId: session.userId, token };
      return true;
    },
    async unregister(session, token) {
      calls.push(["compensate", session.authToken]);
      if (
        serverOwner?.userId === session.userId &&
        serverOwner.token === token
      ) {
        serverOwner = null;
        return true;
      }
      return false;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  responseGate.resolve();
  assert.deepEqual(await operation, { status: "stale", compensated: true });
  assert.equal(serverOwner, null);
  assert.deepEqual(calls, [
    ["register", "captured-a"],
    ["compensate", "captured-a"],
  ]);
  resumeNativeLifecycleOwner(logoutLease);
  setNativeLifecycleAuthOwner(null);
});

test("a registration queued behind cleanup cannot reattach during suspended logout", async () => {
  setNativeLifecycleAuthOwner("user-a");
  const cleanupGate = deferred();
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const cleanup = serialize(() => cleanupGate.promise);
  let registerCalls = 0;
  const queuedRegistration = serialize(async () => {
    const fence = captureNativeLifecycleFence("user-a");
    if (!fence) return "suspended";
    const result = await runPushOwnershipMutation({
      session: { lifecycleFence: fence },
      token: "ExponentPushToken[queued-after-cleanup]",
      transition: { action: "register" },
      isSessionCurrent: async ({ lifecycleFence }) =>
        isNativeLifecycleFenceCurrent(lifecycleFence),
      async register() {
        registerCalls += 1;
        return true;
      },
      async unregister() {
        return true;
      },
    });
    return result.status;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  cleanupGate.resolve();
  await cleanup;
  assert.equal(await queuedRegistration, "suspended");
  assert.equal(registerCalls, 0);
  resumeNativeLifecycleOwner(logoutLease);
  setNativeLifecycleAuthOwner(null);
});

test("push registration compensates immediately when ownership persistence fails", async () => {
  let serverOwner = "user-a";
  const session = { userId: "user-a", authToken: "captured-a" };
  const outcome = await persistPushOwnershipOrCompensate({
    session,
    ownership: {
      userId: "user-a",
      token: "ExponentPushToken[persistence]",
    },
    async persist() {
      throw new Error("injected storage failure");
    },
    async compensate(captured, token) {
      assert.equal(captured.authToken, "captured-a");
      assert.equal(token, "ExponentPushToken[persistence]");
      serverOwner = null;
      return true;
    },
  });
  assert.deepEqual(outcome, {
    status: "persistence-failed",
    compensated: true,
  });
  assert.equal(serverOwner, null);
});

test("offline logout cleanup is durable and resolves on same-user reconnect or token transfer", async () => {
  const storage = new MemoryKeyValueStorage();
  const cleanup = new PushCleanupStore(storage);
  const ownership = {
    userId: "user-a",
    token: "ExponentPushToken[logout]",
  };
  assert.equal(await cleanup.record(ownership, 100), true);
  const restartedCleanup = new PushCleanupStore(storage);

  let unregisterCalls = 0;
  assert.equal(
    await runPushCleanupForUser({
      userId: "user-a",
      intents: await restartedCleanup.read(),
      isCurrent: async () => true,
      unregister: async () => {
        unregisterCalls += 1;
        return false;
      },
      remove: (intent) => restartedCleanup.remove(intent),
    }),
    false,
  );
  assert.equal((await restartedCleanup.read()).length, 1);

  assert.equal(
    await runPushCleanupForUser({
      userId: "user-a",
      intents: await restartedCleanup.read(),
      isCurrent: async () => true,
      unregister: async () => {
        unregisterCalls += 1;
        return true;
      },
      remove: (intent) => restartedCleanup.remove(intent),
    }),
    true,
  );
  assert.equal((await restartedCleanup.read()).length, 0);
  assert.equal(unregisterCalls, 2);

  await restartedCleanup.record(ownership, 200);
  let serverOwner = "user-a";
  const transfer = await runPushOwnershipMutation({
    session: { userId: "user-b", authToken: "captured-b" },
    token: ownership.token,
    transition: { action: "transfer-owner" },
    isSessionCurrent: async () => true,
    async register(session) {
      serverOwner = session.userId;
      return true;
    },
    async unregister() {
      throw new Error("a new user must not authorize old-user cleanup");
    },
  });
  assert.deepEqual(transfer, { status: "registered" });
  assert.equal(serverOwner, "user-b");
  await restartedCleanup.removeToken(ownership.token);
  assert.equal((await restartedCleanup.read()).length, 0);
  assert.doesNotMatch(
    [...storage.values.values()].join(""),
    /captured-a|captured-b/,
  );
});

test("notification presentation fails closed across logout and account transfer", () => {
  const pending = [
    {
      userId: "user-a",
      token: "ExponentPushToken[logout]",
      createdAt: 1,
    },
  ];
  const payload = {
    eloviaPush: 1,
    eloviaPushOwnerUserId: "user-a",
  };
  assert.equal(shouldPresentEloviaNotification(payload, null, pending), false);
  assert.equal(
    shouldPresentEloviaNotification(payload, "user-b", pending),
    false,
  );
  assert.equal(
    shouldPresentEloviaNotification(payload, "user-a", pending),
    false,
  );
  assert.equal(
    shouldPresentEloviaNotification(payload, "user-a", [], false),
    true,
  );

  const geofencePayload = {
    kind: "geofence",
    eloviaGeofence: 1,
    eloviaGeofenceOwner: "opaque-owner-a",
  };
  assert.equal(
    shouldPresentEloviaNotification(
      geofencePayload,
      "user-a",
      [],
      false,
      "opaque-owner-a",
    ),
    true,
  );
  assert.equal(
    shouldPresentEloviaNotification(
      geofencePayload,
      "user-b",
      [],
      false,
      "opaque-owner-b",
    ),
    false,
  );
  assert.equal(
    shouldPresentEloviaNotification(
      { kind: "geofence" },
      "user-a",
      [],
      false,
      "opaque-owner-a",
    ),
    false,
  );
});

test("push-safe signout blocks both-failed detachment and allows either verified channel", async () => {
  let signOutCalls = 0;
  const signOut = async () => {
    signOutCalls += 1;
  };
  assert.equal(
    await runPushSafeSignOut(
      {
        serverDetached: false,
        nativeDetached: false,
        cleanupPending: true,
      },
      signOut,
    ),
    "blocked",
  );
  assert.equal(signOutCalls, 0);

  const storage = new MemoryKeyValueStorage();
  const cleanup = new PushCleanupStore(storage);
  await cleanup.record(
    { userId: "user-a", token: "ExponentPushToken[native-only]" },
    300,
  );
  assert.equal(
    await runPushSafeSignOut(
      {
        serverDetached: true,
        nativeDetached: false,
        cleanupPending: false,
      },
      signOut,
    ),
    "signed-out",
  );
  assert.equal(
    await runPushSafeSignOut(
      {
        serverDetached: false,
        nativeDetached: true,
        cleanupPending: true,
      },
      signOut,
    ),
    "signed-out",
  );
  assert.equal(signOutCalls, 2);
  assert.equal(
    (await cleanup.read()).length,
    1,
    "native-only logout retains durable server cleanup",
  );
});

test("logout requires verified reminder and geofence cleanup independently", async () => {
  const scenarios = [
    { reminders: false, geofences: false },
    { reminders: false, geofences: true },
    { reminders: true, geofences: false },
    { reminders: true, geofences: true },
  ];
  for (const scenario of scenarios) {
    const store = new NativeLifecycleStateStore(new MemoryKeyValueStorage());
    const outcome = await runVerifiedNativeCleanup({
      store,
      ownerUserId: "user-a",
      cancelReminders: async () => scenario.reminders,
      stopGeofences: async () => scenario.geofences,
    });
    assert.equal(outcome.remindersCleared, scenario.reminders);
    assert.equal(outcome.geofencesCleared, scenario.geofences);
    assert.equal(
      canCompleteNativeStateLogout(outcome),
      scenario.reminders && scenario.geofences,
    );
    assert.equal(
      (await store.read()).status,
      scenario.reminders && scenario.geofences ? "clean" : "pending",
    );
  }
});

test("signed-out cleanup journal retries after remount and settles only when verified", async () => {
  const storage = new MemoryKeyValueStorage();
  const firstStore = new NativeLifecycleStateStore(storage);
  assert.equal(
    (
      await runVerifiedNativeCleanup({
        store: firstStore,
        ownerUserId: "user-a",
        cancelReminders: async () => false,
        stopGeofences: async () => true,
      })
    ).verified,
    false,
  );
  assert.equal((await firstStore.read()).status, "pending");

  const remountedStore = new NativeLifecycleStateStore(storage);
  assert.equal(
    (
      await runVerifiedNativeCleanup({
        store: remountedStore,
        ownerUserId: null,
        cancelReminders: async () => true,
        stopGeofences: async () => true,
      })
    ).verified,
    true,
  );
  assert.equal((await remountedStore.read()).status, "clean");
});

test("account transition clears the previous native owner before rebuilding", async () => {
  const storage = new MemoryKeyValueStorage();
  const store = new NativeLifecycleStateStore(storage);
  const initial = await runNativeOwnerReconciliation({
    store,
    ownerUserId: "user-a",
    isCurrent: () => true,
    cancelReminders: async () => true,
    stopGeofences: async () => true,
    reconcileReminders: async () => true,
    reconcileGeofences: async () => true,
  });
  assert.equal(initial, true);
  assert.deepEqual(await store.read(), {
    status: "owned",
    ownerUserId: "user-a",
    generation: 2,
  });

  const blockedCalls = [];
  const blocked = await runNativeOwnerReconciliation({
    store,
    ownerUserId: "user-b",
    isCurrent: () => true,
    cancelReminders: async () => {
      blockedCalls.push("cancel-a-reminders");
      return false;
    },
    stopGeofences: async () => {
      blockedCalls.push("stop-a-geofences");
      return true;
    },
    reconcileReminders: async () => {
      blockedCalls.push("schedule-b-reminders");
      return true;
    },
    reconcileGeofences: async () => {
      blockedCalls.push("start-b-geofences");
      return true;
    },
  });
  assert.equal(blocked, false);
  assert.deepEqual(blockedCalls.sort(), [
    "cancel-a-reminders",
    "stop-a-geofences",
  ]);
  assert.equal((await store.read()).status, "pending");

  const retryCalls = [];
  const retried = await runNativeOwnerReconciliation({
    store,
    ownerUserId: "user-b",
    isCurrent: () => true,
    cancelReminders: async () => {
      retryCalls.push("cancel-old-reminders");
      return true;
    },
    stopGeofences: async () => {
      retryCalls.push("stop-old-geofences");
      return true;
    },
    reconcileReminders: async () => {
      retryCalls.push("schedule-b-reminders");
      return true;
    },
    reconcileGeofences: async () => {
      retryCalls.push("start-b-geofences");
      return true;
    },
  });
  assert.equal(retried, true);
  assert.deepEqual(retryCalls.slice(0, 2).sort(), [
    "cancel-old-reminders",
    "stop-old-geofences",
  ]);
  assert.deepEqual(retryCalls.slice(2), [
    "schedule-b-reminders",
    "start-b-geofences",
  ]);
  assert.equal((await store.read()).ownerUserId, "user-b");
});

test("logout suspension closes the auth-to-native transition race", () => {
  setNativeLifecycleAuthOwner("user-a");
  const beforeLogout = captureNativeLifecycleFence("user-a");
  assert.ok(beforeLogout);
  assert.equal(isNativeLifecycleOwnerCurrent("user-a"), true);
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  assert.equal(isNativeLifecycleFenceCurrent(beforeLogout), false);
  assert.equal(isNativeLifecycleOwnerCurrent("user-a"), false);
  resumeNativeLifecycleOwner(logoutLease);
  assert.equal(
    isNativeLifecycleFenceCurrent(beforeLogout),
    false,
    "resume cannot revive an ABA-stale operation",
  );
  assert.equal(isNativeLifecycleOwnerCurrent("user-a"), true);

  setNativeLifecycleAuthOwner("user-b");
  assert.equal(isNativeLifecycleOwnerCurrent("user-a"), false);
  assert.equal(isNativeLifecycleOwnerCurrent("user-b"), true);
  setNativeLifecycleAuthOwner(null);
  assert.equal(isNativeLifecycleOwnerCurrent("user-b"), false);
});

test("suspension leases require the exact owner attempt and compose safely", () => {
  setNativeLifecycleAuthOwner("user-a");
  const before = captureNativeLifecycleFence("user-a");
  assert.ok(before);
  const firstLease = suspendNativeLifecycleOwner("user-a");
  const secondLease = suspendNativeLifecycleOwner("user-a");
  let rebuilds = 0;
  const releaseAndRebuild = (lease) => {
    assert.equal(resumeNativeLifecycleOwner(lease), true);
    if (captureNativeLifecycleFence("user-a")) rebuilds += 1;
  };

  releaseAndRebuild(firstLease);
  assert.equal(rebuilds, 0, "the second logout still owns suspension");
  assert.equal(captureNativeLifecycleFence("user-a"), null);
  assert.equal(
    resumeNativeLifecycleOwner(firstLease),
    false,
    "a released lease cannot release another attempt",
  );
  releaseAndRebuild(secondLease);
  assert.equal(rebuilds, 1);
  assert.equal(isNativeLifecycleFenceCurrent(before), false);
  setNativeLifecycleAuthOwner(null);
});

test("logout is single-flight and concurrent callers share one typed result", async () => {
  const singleFlight = new LogoutSingleFlight();
  const gate = deferred();
  let firstStarts = 0;
  let secondStarts = 0;
  const first = singleFlight.run(async () => {
    firstStarts += 1;
    await gate.promise;
    return { status: "signed_out", operation: "sign_out" };
  });
  const second = singleFlight.run(async () => {
    secondStarts += 1;
    return { status: "signed_out", operation: "account_deletion" };
  });
  assert.equal(first, second, "callers receive the exact active promise");
  gate.resolve();
  assert.deepEqual(await first, {
    status: "signed_out",
    operation: "sign_out",
  });
  assert.equal(firstStarts, 1);
  assert.equal(secondStarts, 0);

  const third = singleFlight.run(async () => ({
    status: "blocked",
    operation: "account_deletion",
    reason: "authentication_required",
    message: "Sign in again.",
  }));
  assert.notEqual(third, first);
  assert.equal((await third).status, "blocked");
});

test("account deletion never runs or clears locally when privacy cleanup blocks", async () => {
  const recoveryJournal = ["push-owner", "native-owner"];
  let remoteDeletionCalls = 0;
  let firebaseSignOutCalls = 0;
  let localClearCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    async prepare() {
      return {
        pushDetached: false,
        nativeDetached: true,
        blockedMessage: "Push cleanup must be retried.",
      };
    },
    async beforeSignOut() {
      remoteDeletionCalls += 1;
      recoveryJournal.length = 0;
    },
    async signOut() {
      firebaseSignOutCalls += 1;
    },
  });
  if (
    outcome.status === "signed_out" &&
    outcome.operation === "account_deletion"
  ) {
    localClearCalls += 1;
  }
  assert.deepEqual(outcome, {
    status: "blocked",
    operation: "account_deletion",
    reason: "push_cleanup",
    message: "Push cleanup must be retried.",
  });
  assert.equal(remoteDeletionCalls, 0);
  assert.equal(firebaseSignOutCalls, 0);
  assert.equal(localClearCalls, 0);
  assert.deepEqual(recoveryJournal, ["push-owner", "native-owner"]);
});

test("account deletion clears only after verified detach, deletion, and sign-out", async () => {
  const order = [];
  let localClearCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    async prepare() {
      order.push("verified-detach");
      return { pushDetached: true, nativeDetached: true };
    },
    async beforeSignOut() {
      order.push("server-delete");
    },
    async signOut() {
      order.push("firebase-sign-out");
    },
  });
  if (
    outcome.status === "signed_out" &&
    outcome.operation === "account_deletion"
  ) {
    order.push("local-clear");
    localClearCalls += 1;
  }
  assert.deepEqual(outcome, {
    status: "signed_out",
    operation: "account_deletion",
  });
  assert.deepEqual(order, [
    "verified-detach",
    "server-delete",
    "firebase-sign-out",
    "local-clear",
  ]);
  assert.equal(localClearCalls, 1);
});

test("account deletion failure after detach remains typed and never reports success", async () => {
  let firebaseSignOutCalls = 0;
  let localClearCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    async prepare() {
      return { pushDetached: true, nativeDetached: true };
    },
    async beforeSignOut() {
      throw new Error("injected deletion failure");
    },
    async signOut() {
      firebaseSignOutCalls += 1;
    },
  });
  if (
    outcome.status === "signed_out" &&
    outcome.operation === "account_deletion"
  ) {
    localClearCalls += 1;
  }
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.reason, "account_deletion_failed");
  assert.equal(firebaseSignOutCalls, 0);
  assert.equal(localClearCalls, 0);
});

test("Firebase verification checks revocation and narrows deleted-identity fallback", async () => {
  const checks = [];
  const active = await verifyFirebaseTokenWithPolicy(
    {
      async verifyIdToken(_token, checkRevoked) {
        checks.push(checkRevoked);
        return { uid: "active-user" };
      },
    },
    "signed-token",
    false,
  );
  assert.deepEqual(active, {
    identity: { uid: "active-user" },
    deletionFallback: false,
  });
  assert.deepEqual(checks, [true]);

  checks.length = 0;
  const deleted = await verifyFirebaseTokenWithPolicy(
    {
      async verifyIdToken(_token, checkRevoked) {
        checks.push(checkRevoked);
        if (checkRevoked) {
          throw { code: "auth/user-not-found" };
        }
        return { uid: "deleted-user" };
      },
    },
    "still-signed-unexpired-token",
    true,
  );
  assert.equal(deleted.deletionFallback, true);
  assert.equal(deleted.identity.uid, "deleted-user");
  assert.deepEqual(checks, [true, false]);

  await assert.rejects(
    verifyFirebaseTokenWithPolicy(
      {
        async verifyIdToken() {
          throw { code: "auth/user-not-found" };
        },
      },
      "token",
      false,
    ),
    (error) => error.code === "auth/user-not-found",
  );
});

test("server deletion tombstones data before identity work and retries finalization", async () => {
  const state = {
    tombstoned: false,
    userDataPresent: true,
    finalized: false,
    identityAttempts: 0,
  };
  const order = [];
  const first = await runAccountDeletionWorkflow({
    async tombstoneAndDeleteData() {
      state.tombstoned = true;
      state.userDataPresent = false;
      order.push("tombstone-and-data-delete");
    },
    async deleteIdentity() {
      assert.equal(state.tombstoned, true);
      assert.equal(state.userDataPresent, false);
      state.identityAttempts += 1;
      order.push("identity-delete");
      throw new Error("injected Firebase outage");
    },
    async markFinalized() {
      state.finalized = true;
      return true;
    },
  });
  assert.equal(first.status, "identity_pending");
  assert.equal(state.tombstoned, true);
  assert.equal(state.userDataPresent, false);
  assert.equal(state.finalized, false);

  const retry = await runAccountDeletionWorkflow({
    async tombstoneAndDeleteData() {
      assert.equal(state.tombstoned, true, "the durable tombstone survives");
      assert.equal(state.userDataPresent, false);
      order.push("idempotent-data-delete");
    },
    async deleteIdentity() {
      state.identityAttempts += 1;
      order.push("identity-delete-retry");
    },
    async markFinalized() {
      state.finalized = true;
      order.push("finalize-tombstone");
      return true;
    },
  });
  assert.deepEqual(retry, { status: "finalized" });
  assert.equal(state.identityAttempts, 2);
  assert.equal(state.finalized, true);
  assert.deepEqual(order, [
    "tombstone-and-data-delete",
    "identity-delete",
    "idempotent-data-delete",
    "identity-delete-retry",
    "finalize-tombstone",
  ]);
});

test("server-owned identity finalizer durably reschedules a 202 then converges", async () => {
  const claim = {
    userId: "deleted-user",
    requestId: "delete-request-worker",
    leaseId: "lease-a",
    attemptCount: 1,
  };
  let identityAttempts = 0;
  let finalized = false;
  let nextAttemptAt = null;
  const first = await runAccountDeletionFinalizationBatch({
    claim: async () => [claim],
    async deleteIdentity() {
      identityAttempts += 1;
      throw new Error("injected Firebase outage");
    },
    async finalize() {
      finalized = true;
      return true;
    },
    async reschedule(_claim, next) {
      nextAttemptAt = next;
      return true;
    },
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    reportFailure: () => undefined,
  });
  assert.deepEqual(first, { claimed: 1, finalized: 0, rescheduled: 1 });
  assert.equal(finalized, false);
  assert.equal(nextAttemptAt.toISOString(), "2026-09-01T10:00:30.000Z");
  assert.equal(accountDeletionRetryDelayMs(99), 6 * 60 * 60 * 1000);

  const second = await runAccountDeletionFinalizationBatch({
    claim: async () => [{ ...claim, leaseId: "lease-b", attemptCount: 2 }],
    async deleteIdentity() {
      identityAttempts += 1;
    },
    async finalize(retryClaim) {
      assert.equal(retryClaim.leaseId, "lease-b");
      finalized = true;
      return true;
    },
    async reschedule() {
      throw new Error("successful identity deletion must not reschedule");
    },
    now: () => new Date("2026-09-01T10:00:30.000Z"),
    reportFailure: () => undefined,
  });
  assert.deepEqual(second, { claimed: 1, finalized: 1, rescheduled: 0 });
  assert.equal(identityAttempts, 2);
  assert.equal(finalized, true);
});

test("post-delete Firebase sign-out failure remains finalizing and never resumes", async () => {
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    prepare: async () => ({ pushDetached: true, nativeDetached: true }),
    beforeSignOut: async () => ({ status: "confirmed" }),
    signOut: async () => {
      throw new Error("injected local Firebase persistence failure");
    },
  });
  assert.deepEqual(outcome, {
    status: "finalizing",
    operation: "account_deletion",
    reason: "firebase_sign_out_failed",
    localSignOutComplete: false,
    message:
      "Account deletion is finalizing, but Elovia could not finish signing out on this device. Reopen the app to retry safely.",
  });
});

test("a lost deletion response keeps Firebase signed in until the tombstone is confirmed", async () => {
  let signOutCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    prepare: async () => ({ pushDetached: true, nativeDetached: true }),
    beforeSignOut: async () => ({
      status: "pending_remote",
      message: "The deletion response was interrupted.",
    }),
    async signOut() {
      signOutCalls += 1;
    },
  });
  assert.deepEqual(outcome, {
    status: "finalizing",
    operation: "account_deletion",
    reason: "remote_delete_ambiguous",
    localSignOutComplete: false,
    message: "The deletion response was interrupted.",
  });
  assert.equal(signOutCalls, 0);
});

test("a crash before the delete request aborts prepared recovery without sign-out or clearing", async () => {
  const storage = new MemoryKeyValueStorage();
  storage.values.set("account-data", "private-local-state");
  const store = new AccountDeletionRecoveryStore(storage);
  await store.begin("user-a", "delete-request-prepared");
  let remoteCalls = 0;
  let signOutCalls = 0;

  assert.deepEqual(
    await recoverAccountDeletionFinalization({
      store: new AccountDeletionRecoveryStore(storage),
      currentUserId: "user-a",
      async confirmRemote() {
        remoteCalls += 1;
        return { status: "confirmed" };
      },
      async signOut() {
        signOutCalls += 1;
      },
    }),
    { status: "aborted" },
  );
  assert.equal(remoteCalls, 0);
  assert.equal(signOutCalls, 0);
  assert.equal(storage.values.get("account-data"), "private-local-state");
  assert.equal(storage.values.has(ACCOUNT_DELETION_MARKER_KEY), false);
  assert.equal(isAccountDeletionFinalizing(), false);
});

test("advance and prepared-abort storage faults never call delete or sign out", async () => {
  const storage = new MemoryKeyValueStorage();
  let setCalls = 0;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = async (key, value) => {
    setCalls += 1;
    if (setCalls === 2) throw new Error("injected request-start write fault");
    await originalSetItem(key, value);
  };
  storage.removeItem = async () => {
    throw new Error("injected prepared-abort fault");
  };
  const store = new AccountDeletionRecoveryStore(storage);
  let deleteCalls = 0;
  let signOutCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    prepare: async () => ({ pushDetached: true, nativeDetached: true }),
    async beforeSignOut() {
      const preparation = await prepareAccountDeletionRequest(
        store,
        "user-a",
        "delete-prepared-fault",
      );
      if (preparation === "prepared_pending") {
        return {
          status: "pending_pre_request",
          message: "Prepared deletion recovery is pending.",
        };
      }
      deleteCalls += 1;
      return { status: "confirmed" };
    },
    async signOut() {
      signOutCalls += 1;
    },
  });
  assert.equal(outcome.status, "finalizing");
  assert.equal(outcome.reason, "pre_request_recovery_pending");
  assert.equal(outcome.localSignOutComplete, false);
  assert.equal(deleteCalls, 0);
  assert.equal(signOutCalls, 0);
  assert.equal(
    JSON.parse(storage.values.get(ACCOUNT_DELETION_MARKER_KEY)).phase,
    "prepared",
  );
});

test("request-started recovery stays suspended offline then retries the same idempotency key", async () => {
  const storage = new MemoryKeyValueStorage();
  storage.values.set("account-data", "private-local-state");
  const firstStore = new AccountDeletionRecoveryStore(
    storage,
    () => new Date("2026-09-01T10:00:00.000Z"),
  );
  await firstStore.begin("user-a", "delete-request-a");
  await firstStore.advance("user-a", "delete-request-a", "request_started");
  assert.equal(isAccountDeletionFinalizing(), true);

  let signOutCalls = 0;
  const offline = await recoverAccountDeletionFinalization({
    store: new AccountDeletionRecoveryStore(storage),
    currentUserId: "user-a",
    async confirmRemote(marker) {
      assert.equal(marker.requestId, "delete-request-a");
      throw new Error("injected offline recovery");
    },
    async signOut() {
      signOutCalls += 1;
    },
  });
  assert.equal(offline.status, "pending");
  assert.equal(signOutCalls, 0);
  assert.equal(storage.values.get("account-data"), "private-local-state");
  assert.ok(storage.values.has(ACCOUNT_DELETION_MARKER_KEY));

  const signOutGate = deferred();
  const recovery = recoverAccountDeletionFinalization({
    store: new AccountDeletionRecoveryStore(storage),
    currentUserId: "user-a",
    async confirmRemote(marker) {
      assert.equal(marker.requestId, "delete-request-a");
      return { status: "confirmed" };
    },
    signOut: () => signOutGate.promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.values.get("account-data"), "private-local-state");
  assert.ok(storage.values.has(ACCOUNT_DELETION_MARKER_KEY));
  assert.equal(
    JSON.parse(storage.values.get(ACCOUNT_DELETION_MARKER_KEY)).phase,
    "remote_confirmed",
  );

  signOutGate.resolve();
  assert.deepEqual(await recovery, { status: "finalized" });
  assert.equal(storage.values.size, 0);
  assert.equal(isAccountDeletionFinalizing(), false);
});

test("request-started recovery confirms by persisted capability after Firebase is gone", async () => {
  const storage = new MemoryKeyValueStorage();
  storage.values.set("account-data", "private-local-state");
  const store = new AccountDeletionRecoveryStore(storage);
  await store.begin("user-a", "delete-request-capability");
  await store.advance("user-a", "delete-request-capability", "request_started");
  let signOutCalls = 0;
  assert.deepEqual(
    await recoverAccountDeletionFinalization({
      store: new AccountDeletionRecoveryStore(storage),
      currentUserId: null,
      async confirmRemote(marker) {
        assert.equal(marker.ownerUserId, "user-a");
        assert.equal(marker.requestId, "delete-request-capability");
        return { status: "confirmed" };
      },
      async signOut() {
        signOutCalls += 1;
      },
    }),
    { status: "finalized" },
  );
  assert.equal(signOutCalls, 0);
  assert.equal(storage.values.size, 0);
  assert.equal(isAccountDeletionFinalizing(), false);
});

test("unknown recovery requires authoritative no-tombstone evidence before resuming", async () => {
  const storage = new MemoryKeyValueStorage();
  const store = new AccountDeletionRecoveryStore(storage);
  storage.values.set(ACCOUNT_DELETION_MARKER_KEY, "corrupt-marker");
  const pending = await recoverAccountDeletionFinalization({
    store,
    currentUserId: "user-a",
    async confirmRemote() {
      throw new Error("injected offline status check");
    },
    signOut: async () => undefined,
  });
  assert.equal(pending.status, "pending");
  assert.ok(storage.values.has(ACCOUNT_DELETION_MARKER_KEY));

  assert.deepEqual(
    await recoverAccountDeletionFinalization({
      store: new AccountDeletionRecoveryStore(storage),
      currentUserId: "user-a",
      confirmRemote: async () => ({ status: "not_started" }),
      signOut: async () => {
        throw new Error("must not sign out after a no-tombstone response");
      },
    }),
    { status: "aborted" },
  );
  assert.equal(storage.values.has(ACCOUNT_DELETION_MARKER_KEY), false);
  assert.equal(isAccountDeletionFinalizing(), false);
});

test("a commit-ambiguous server error retains request-started recovery until tombstone confirmation", async () => {
  assert.equal(
    isProvablyPreDeletionBoundaryError({ code: "account_deletion_failed" }),
    false,
  );
  assert.equal(
    isProvablyPreDeletionBoundaryError({ code: "authentication_unavailable" }),
    true,
  );
  const storage = new MemoryKeyValueStorage();
  const store = new AccountDeletionRecoveryStore(storage);
  await store.begin("user-a", "delete-commit-ambiguous");
  await store.advance("user-a", "delete-commit-ambiguous", "request_started");

  const ambiguous = await recoverAccountDeletionFinalization({
    store,
    currentUserId: "user-a",
    async confirmRemote() {
      throw Object.assign(new Error("response failed after commit"), {
        code: "account_deletion_failed",
      });
    },
    signOut: async () => undefined,
  });
  assert.equal(ambiguous.status, "pending");
  assert.equal(
    JSON.parse(storage.values.get(ACCOUNT_DELETION_MARKER_KEY)).phase,
    "request_started",
  );

  assert.deepEqual(
    await recoverAccountDeletionFinalization({
      store: new AccountDeletionRecoveryStore(storage),
      currentUserId: "user-a",
      confirmRemote: async () => ({ status: "confirmed" }),
      signOut: async () => undefined,
    }),
    { status: "finalized" },
  );
  assert.equal(storage.values.size, 0);
});

test("a 202 identity-pending response confirms the boundary and signs out locally", async () => {
  let signOutCalls = 0;
  const outcome = await runLogoutWorkflow({
    operation: "account_deletion",
    isAuthenticated: true,
    prepare: async () => ({ pushDetached: true, nativeDetached: true }),
    beforeSignOut: async () => ({
      status: "confirmed",
      identityFinalizing: true,
      message: "Server identity removal is pending.",
    }),
    async signOut() {
      signOutCalls += 1;
    },
  });
  assert.deepEqual(outcome, {
    status: "finalizing",
    operation: "account_deletion",
    reason: "server_identity_pending",
    localSignOutComplete: true,
    message: "Server identity removal is pending.",
  });
  assert.equal(signOutCalls, 1);
});

test("local deletion clear failure retains the marker for a bounded restart retry", async () => {
  const storage = new MemoryKeyValueStorage();
  storage.values.set("private-data", "retained-until-clear-succeeds");
  const store = new AccountDeletionRecoveryStore(storage);
  await store.begin("user-a", "delete-clear-fault");
  await store.advance("user-a", "delete-clear-fault", "remote_confirmed");
  const originalMultiRemove = storage.multiRemove.bind(storage);
  storage.multiRemove = async () => {
    throw new Error("injected local clear failure");
  };

  const failed = await recoverAccountDeletionFinalization({
    store,
    currentUserId: null,
    signOut: async () => undefined,
  });
  assert.equal(failed.status, "pending");
  assert.ok(storage.values.has(ACCOUNT_DELETION_MARKER_KEY));
  assert.equal(isAccountDeletionFinalizing(), true);

  storage.multiRemove = originalMultiRemove;
  assert.deepEqual(
    await recoverAccountDeletionFinalization({
      store: new AccountDeletionRecoveryStore(storage),
      currentUserId: null,
      signOut: async () => undefined,
    }),
    { status: "finalized" },
  );
  assert.equal(storage.values.size, 0);
  assert.equal(isAccountDeletionFinalizing(), false);
});

test("direct reminder rebuild compensates when logout suspends its generation", async () => {
  setNativeLifecycleAuthOwner("user-a");
  const lifecycleFence = captureNativeLifecycleFence("user-a");
  assert.ok(lifecycleFence);
  const scheduleGate = deferred();
  let owned = [];
  const reconciliation = runReminderReconciliation({
    isCurrent: async () => isNativeLifecycleFenceCurrent(lifecycleFence),
    listOwned: async () => owned,
    identifier: (snapshot) => snapshot.identifier,
    canRestore: () => true,
    async cancel(identifier) {
      owned = owned.filter((item) => item.identifier !== identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      await scheduleGate.promise;
      owned.push({ identifier: "direct-reminder" });
      return "direct-reminder";
    },
    restore: async (snapshot) => snapshot.identifier,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  scheduleGate.resolve();
  assert.equal(await reconciliation, "stale");
  assert.deepEqual(owned, [], "the crossed schedule is cancelled");
  resumeNativeLifecycleOwner(logoutLease);
  setNativeLifecycleAuthOwner(null);
});

test("reminder rollback cannot recreate a previous schedule across suspension", async () => {
  setNativeLifecycleAuthOwner("user-a");
  const lifecycleFence = captureNativeLifecycleFence("user-a");
  assert.ok(lifecycleFence);
  const restoreGate = deferred();
  let owned = [{ identifier: "previous-reminder" }];
  const reconciliation = runReminderReconciliation({
    isCurrent: async () => isNativeLifecycleFenceCurrent(lifecycleFence),
    listOwned: async () => owned,
    identifier: (snapshot) => snapshot.identifier,
    canRestore: () => true,
    async cancel(identifier) {
      owned = owned.filter((item) => item.identifier !== identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      throw new Error("injected desired-schedule failure");
    },
    async restore(snapshot) {
      await restoreGate.promise;
      owned.push(snapshot);
      return snapshot.identifier;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  restoreGate.resolve();
  assert.equal(await reconciliation, "stale");
  assert.deepEqual(owned, [], "the crossed rollback schedule is cancelled");
  resumeNativeLifecycleOwner(logoutLease);
  setNativeLifecycleAuthOwner(null);
});

test("direct places sync compensates a geofence start crossing suspension", async () => {
  setNativeLifecycleAuthOwner("user-a");
  const lifecycleFence = captureNativeLifecycleFence("user-a");
  assert.ok(lifecycleFence);
  const startGate = deferred();
  let stops = 0;
  let starts = 0;
  const reconciliation = runGeofenceReconciliation({
    isCurrent: async () => isNativeLifecycleFenceCurrent(lifecycleFence),
    async stop() {
      stops += 1;
    },
    permissionGranted: async () => true,
    hasEnabledPlaces: true,
    async start() {
      starts += 1;
      await startGate.promise;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const logoutLease = suspendNativeLifecycleOwner("user-a");
  startGate.resolve();
  assert.equal(await reconciliation, "stale");
  assert.equal(starts, 1);
  assert.equal(stops, 2, "initial stop plus stale-start compensation");
  resumeNativeLifecycleOwner(logoutLease);
  setNativeLifecycleAuthOwner(null);
});

test("lifecycle push permission observation cannot invoke the optional prompt", async () => {
  let prompts = 0;
  const granted = await resolvePushPermission(false, false, async () => {
    prompts += 1;
    return true;
  });
  assert.equal(granted, false);
  assert.equal(prompts, 0);

  assert.equal(
    await resolvePushPermission(false, true, async () => {
      prompts += 1;
      return true;
    }),
    true,
  );
  assert.equal(prompts, 1, "only the explicit user path may prompt");
});

test("reminder reconciliation clamps corrupt preferences and preserves future streak reminders", () => {
  const preferences = normalizeReminderPreferences({
    enabled: true,
    workoutTime: "99:not-a-time",
    workoutEnabled: "yes",
    hydrationEnabled: true,
    hydrationIntervalHours: 99,
    wakingStartHour: -4,
    wakingEndHour: 99,
    streakGuardEnabled: true,
    streakGuardHour: 42,
    streakSuppressedOn: "2026-09-01",
    weeklyDigestEnabled: true,
    weeklyDigestDay: 14,
    weeklyDigestHour: -2,
  });

  assert.equal(preferences.workoutTime, "18:00");
  assert.equal(preferences.workoutEnabled, true);
  assert.equal(preferences.hydrationIntervalHours, 6);
  assert.equal(preferences.wakingStartHour, 0);
  assert.equal(preferences.wakingEndHour, 23);
  assert.equal(preferences.streakGuardHour, 23);
  assert.equal(preferences.weeklyDigestDay, 6);
  assert.equal(preferences.weeklyDigestHour, 0);

  const schedule = buildReminderSchedule(
    preferences,
    new Date(2026, 8, 1, 10, 0, 0),
  );
  const streakDates = schedule
    .filter((item) => item.kind === "streak")
    .map((item) => item.trigger.kind === "date" && item.trigger.at);
  assert.ok(streakDates.length >= 28);
  assert.ok(
    streakDates.every(
      (date) => date && !(date.getMonth() === 8 && date.getDate() === 1),
    ),
  );
  assert.ok(streakDates.some((date) => date && date.getDate() === 2));

  assert.equal(
    isEloviaReminderNotification({
      content: { data: { eloviaOwner: ELOVIA_REMINDER_OWNER } },
    }),
    true,
  );
  assert.equal(
    isEloviaReminderNotification({
      content: { data: { kind: "streak" } },
    }),
    false,
  );
});

test("reminder reconciliation stops stale account work and compensates an in-flight schedule", async () => {
  let currentUserId = "user-a";
  const cancelGate = deferred();
  const cancelled = [];
  const firstOwned = new Set(["old-owned-reminder"]);
  let scheduledCount = 0;

  const cancelling = runReminderReconciliation({
    isCurrent: async () => currentUserId === "user-a",
    listOwned: async () => [...firstOwned],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      cancelled.push(identifier);
      if (identifier === "old-owned-reminder") await cancelGate.promise;
      firstOwned.delete(identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      scheduledCount += 1;
      return "new-owned-reminder";
    },
    restore: async (identifier) => identifier,
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentUserId = "user-b";
  cancelGate.resolve();
  assert.equal(await cancelling, "stale");
  assert.equal(scheduledCount, 0);
  assert.deepEqual(cancelled, ["old-owned-reminder"]);

  currentUserId = "user-a";
  const scheduleGate = deferred();
  const secondOwned = new Set();
  const scheduling = runReminderReconciliation({
    isCurrent: async () => currentUserId === "user-a",
    listOwned: async () => [...secondOwned],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      cancelled.push(identifier);
      secondOwned.delete(identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      await scheduleGate.promise;
      secondOwned.add("stale-new-reminder");
      return "stale-new-reminder";
    },
    restore: async (identifier) => identifier,
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentUserId = "user-b";
  scheduleGate.resolve();
  assert.equal(await scheduling, "stale");
  assert.ok(cancelled.includes("stale-new-reminder"));
});

test("reminder cancellation failure retains the validated previous schedule", async () => {
  const scheduled = new Set(["prior-workout", "prior-streak"]);
  const outcome = await runReminderReconciliation({
    isCurrent: async () => true,
    listOwned: async () => [...scheduled],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      if (identifier === "prior-workout") {
        throw new Error("injected cancellation failure");
      }
      scheduled.delete(identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      scheduled.add("desired");
      return "desired";
    },
    async restore(identifier) {
      scheduled.add(identifier);
      return identifier;
    },
  });
  assert.equal(outcome, "failed");
  assert.deepEqual([...scheduled].sort(), ["prior-streak", "prior-workout"]);
});

test("mid-scheduling failure retries then rolls back the complete previous schedule", async () => {
  const scheduled = new Set(["prior-workout", "prior-streak"]);
  let desiredSequence = 0;
  const outcome = await runReminderReconciliation({
    isCurrent: async () => true,
    listOwned: async () => [...scheduled],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      scheduled.delete(identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 2,
    async schedule(index) {
      if (index === 1) throw new Error("injected schedule failure");
      const identifier = `desired-${++desiredSequence}`;
      scheduled.add(identifier);
      return identifier;
    },
    async restore(identifier) {
      scheduled.add(identifier);
      return identifier;
    },
  });
  assert.equal(outcome, "failed");
  assert.deepEqual([...scheduled].sort(), ["prior-streak", "prior-workout"]);
  assert.equal(
    desiredSequence,
    2,
    "the desired set received one bounded retry",
  );
});

test("reminder reconciliation never cancels an un-restorable previous request", async () => {
  let cancellationCalls = 0;
  const outcome = await runReminderReconciliation({
    isCurrent: async () => true,
    listOwned: async () => ["legacy-unrestorable"],
    identifier: (identifier) => identifier,
    canRestore: () => false,
    async cancel() {
      cancellationCalls += 1;
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    schedule: async () => "desired",
    restore: async (identifier) => identifier,
  });
  assert.equal(outcome, "failed");
  assert.equal(cancellationCalls, 0);
});

test("reminder retry is blocked when a partial desired set cannot be cancelled exactly", async () => {
  const scheduled = new Set();
  let firstItemSchedules = 0;
  const outcome = await runReminderReconciliation({
    isCurrent: async () => true,
    listOwned: async () => [...scheduled],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      if (identifier === "stuck-desired") {
        throw new Error("injected rollback cancellation failure");
      }
      scheduled.delete(identifier);
    },
    permissionGranted: async () => true,
    scheduleCount: 2,
    async schedule(index) {
      if (index === 1) throw new Error("injected partial scheduling failure");
      firstItemSchedules += 1;
      scheduled.add("stuck-desired");
      return "stuck-desired";
    },
    restore: async (identifier) => identifier,
  });
  assert.equal(outcome, "failed");
  assert.equal(firstItemSchedules, 1, "no retry starts over native leftovers");
  assert.deepEqual([...scheduled], ["stuck-desired"]);
});

test("reminder success requires the exact observed identifier multiset", async () => {
  const scheduled = [];
  const outcome = await runReminderReconciliation({
    isCurrent: async () => true,
    listOwned: async () => [...scheduled],
    identifier: (identifier) => identifier,
    canRestore: () => true,
    async cancel(identifier) {
      const index = scheduled.indexOf(identifier);
      if (index >= 0) scheduled.splice(index, 1);
    },
    permissionGranted: async () => true,
    scheduleCount: 1,
    async schedule() {
      scheduled.push("desired", "unexpected-duplicate");
      return "desired";
    },
    restore: async (identifier) => identifier,
  });
  assert.equal(outcome, "failed");
  assert.notEqual(outcome, "reconciled");
  assert.deepEqual(scheduled, []);
});

test("cloud restore listeners rerun native reconciliation and stale geofence starts compensate", async () => {
  const phases = [];
  const reconcileNativeState = async () => {
    phases.push("reminders");
    phases.push("geofences");
  };
  await reconcileNativeState();
  const unsubscribe = onDataRestored(reconcileNativeState);
  try {
    assert.deepEqual(await emitDataRestored(), { status: "reloaded" });
    assert.deepEqual(phases, [
      "reminders",
      "geofences",
      "reminders",
      "geofences",
    ]);
  } finally {
    unsubscribe();
  }

  let currentUserId = "user-a";
  let stops = 0;
  const outcome = await runGeofenceReconciliation({
    isCurrent: async () => currentUserId === "user-a",
    async stop() {
      stops += 1;
    },
    permissionGranted: async () => true,
    hasEnabledPlaces: true,
    async start() {
      currentUserId = "user-b";
    },
  });
  assert.equal(outcome, "stale");
  assert.equal(stops, 2, "the stale native regions are removed after start");
});

test("native restore reconciliation retries without blocking settled cloud data", async () => {
  let attempts = 0;
  assert.equal(
    await runNativeReconciliationWithRetry({
      isCurrent: () => true,
      async reconcile() {
        attempts += 1;
        return attempts >= 2;
      },
      wait: async () => undefined,
    }),
    "reconciled",
  );
  assert.equal(attempts, 2);

  let current = true;
  attempts = 0;
  assert.equal(
    await runNativeReconciliationWithRetry({
      isCurrent: () => current,
      async reconcile() {
        attempts += 1;
        return false;
      },
      async wait() {
        current = false;
      },
    }),
    "stale",
  );
  assert.equal(attempts, 1, "account transition cancels the queued retry");

  let permanentRetry;
  const failures = [];
  const unsubscribe = onDataRestored(() => {
    permanentRetry = runNativeReconciliationWithRetry({
      isCurrent: () => true,
      reconcile: async () => false,
      wait: async () => undefined,
      maxAttempts: 2,
      onFailure: (attempt, willRetry) => failures.push({ attempt, willRetry }),
    });
  });
  try {
    assert.deepEqual(await emitDataRestored(), { status: "reloaded" });
    assert.equal(await permanentRetry, "pending");
    assert.deepEqual(failures, [
      { attempt: 1, willRetry: true },
      { attempt: 2, willRetry: false },
    ]);
  } finally {
    unsubscribe();
  }
});

test("pending arrival leases survive remount, retry dropped navigation, and acknowledge once", async () => {
  class MemoryStorage {
    values = new Map();
    async getItem(key) {
      return this.values.get(key) ?? null;
    }
    async setItem(key, value) {
      this.values.set(key, value);
    }
    async removeItem(key) {
      this.values.delete(key);
    }
  }

  const storage = new MemoryStorage();
  let nowMs = new Date("2026-09-01T12:10:00.000Z").getTime();
  let leaseSequence = 0;
  const createStore = () =>
    new PendingArrivalStore(
      storage,
      () => nowMs,
      () => `lease-${++leaseSequence}`,
    );
  await createStore().record({
    eventId: "arrival-1",
    ownerUserId: "user-a",
    placeId: "gym-1",
    placeName: "Strength Lab",
    autoStartWorkout: true,
    at: "2026-09-01T12:00:00.000Z",
  });

  assert.deepEqual(await createStore().readForUser("user-b"), {
    status: "empty",
  });
  const concurrentRemounts = await Promise.all([
    createStore().readForUser("user-a"),
    createStore().readForUser("user-a"),
  ]);
  const claims = concurrentRemounts.filter(
    (result) => result.status === "claimed",
  );
  assert.equal(claims.length, 1, "only one persisted lease wins");
  const first = claims[0];
  assert.equal(first.status, "claimed");
  assert.equal(first.arrival.placeName, "Strength Lab");

  const remounted = await createStore().readForUser("user-a");
  assert.equal(remounted.status, "leased");
  nowMs += PENDING_ARRIVAL_LEASE_MS + 1;

  // No target acknowledgement models a navigation attempt that was dropped.
  const retry = await createStore().readForUser("user-a");
  assert.equal(retry.status, "claimed");
  assert.notEqual(retry.leaseId, first.leaseId);

  const targetStore = createStore();
  const delivered = await targetStore.acknowledge("user-a", retry.leaseId);
  assert.equal(delivered?.eventId, "arrival-1");
  assert.equal(await targetStore.acknowledge("user-a", retry.leaseId), null);
  assert.deepEqual(await createStore().readForUser("user-a"), {
    status: "empty",
  });
});

test("a live account-safe arrival signal enters the durable lease flow", async () => {
  const storage = new MemoryKeyValueStorage();
  let nowMs = new Date("2026-09-01T12:10:00.000Z").getTime();
  const store = new PendingArrivalStore(
    storage,
    () => nowMs,
    () => "live-lease",
  );
  await store.record({
    eventId: "arrival-live",
    ownerUserId: "user-a",
    placeId: "gym-live",
    placeName: "Live Gym",
    autoStartWorkout: true,
    at: "2026-09-01T12:00:00.000Z",
  });

  let liveClaim = null;
  const unsubscribe = onPendingArrivalRecorded((ownerUserId) => {
    if (ownerUserId === "user-a") {
      liveClaim = store.readForUser("user-a");
    }
  });
  try {
    emitPendingArrivalRecorded("user-b");
    assert.equal(liveClaim, null);
    emitPendingArrivalRecorded("user-a");
    const claimed = await liveClaim;
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.arrival.eventId, "arrival-live");
  } finally {
    unsubscribe();
  }
});

test("authentication recovery and native lifecycle are connected without launch permission prompts", async () => {
  const [
    authScreen,
    coordinator,
    root,
    push,
    notifications,
    workouts,
    auth,
    geofence,
    geofenceTask,
    pushRoute,
    pushLib,
    privacyData,
    profileScreen,
    autoSync,
    deletionRecovery,
    authMiddleware,
    accountDeletion,
    accountDeletionFinalizer,
    privacyRoutes,
    serverIndex,
  ] = await Promise.all([
    source("artifacts/mobile/app/auth.tsx"),
    source("artifacts/mobile/components/NativeLifecycleCoordinator.tsx"),
    source("artifacts/mobile/app/_layout.tsx"),
    source("artifacts/mobile/lib/push.ts"),
    source("artifacts/mobile/lib/notifications.ts"),
    source("artifacts/mobile/app/(tabs)/workouts.tsx"),
    source("artifacts/mobile/lib/auth.tsx"),
    source("artifacts/mobile/lib/geofence.ts"),
    source("artifacts/mobile/lib/geofenceTask.ts"),
    source("artifacts/api-server/src/routes/push.ts"),
    source("artifacts/api-server/src/lib/push.ts"),
    source("artifacts/mobile/app/privacy-data.tsx"),
    source("artifacts/mobile/app/profile-details.tsx"),
    source("artifacts/mobile/components/AutoSync.tsx"),
    source("artifacts/mobile/lib/accountDeletionRecovery.ts"),
    source("artifacts/api-server/src/middlewares/authMiddleware.ts"),
    source("artifacts/api-server/src/lib/accountDeletion.ts"),
    source("artifacts/api-server/src/lib/accountDeletionFinalizer.ts"),
    source("artifacts/api-server/src/routes/privacy.ts"),
    source("artifacts/api-server/src/index.ts"),
  ]);

  assert.match(authScreen, /useAuth\(\)/);
  assert.match(authScreen, /Continue with Google/);
  assert.match(authScreen, /signInInFlight/);
  assert.match(authScreen, /accessibilityRole="button"/);
  assert.match(authScreen, /router\.replace\("\/\(tabs\)"\)/);
  assert.doesNotMatch(authScreen, /^\s*(?:void\s+)?login\(\)/m);

  assert.match(coordinator, /reconcileReminderSchedule/);
  assert.match(coordinator, /onDataRestored/);
  assert.match(coordinator, /reconcileGeofences/);
  assert.match(coordinator, /cancelAllReminders/);
  assert.match(coordinator, /stopAllGeofences/);
  assert.match(coordinator, /reconcilePushRegistration/);
  assert.match(coordinator, /readPendingArrival/);
  assert.match(coordinator, /onPendingArrivalRecorded/);
  assert.match(coordinator, /runNativeReconciliationWithRetry/);
  assert.match(coordinator, /clearNativeAccountState/);
  assert.match(coordinator, /reconcileNativeAccountState/);
  assert.doesNotMatch(coordinator, /NativeRestoreReconciliationFailed/);
  assert.match(coordinator, /arrivalLeaseId/);
  assert.doesNotMatch(coordinator, /clearPendingArrival/);
  assert.match(workouts, /acknowledgePendingArrival/);
  assert.match(workouts, /parsePendingArrivalRouteContext/);
  assert.match(coordinator, /useRootNavigationState/);
  assert.match(coordinator, /isAccountDeletionFinalizing/);
  assert.match(autoSync, /isAccountDeletionFinalizing/);
  assert.match(autoSync, /useSyncExternalStore/);
  assert.match(root, /<NativeLifecycleCoordinator\s*\/>/);

  const reconcileBody = push.match(
    /export async function reconcilePushRegistration[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(reconcileBody);
  assert.doesNotMatch(reconcileBody, /requestPermissionsAsync/);
  assert.match(notifications, /cancelScheduledNotificationAsync/);
  assert.doesNotMatch(notifications, /cancelAllScheduledNotificationsAsync/);
  assert.match(auth, /pushDetached: canCompletePushLogout\(pushDetachment\)/);
  assert.match(
    auth,
    /nativeDetached: canCompleteNativeStateLogout\(nativeCleanup\)/,
  );
  assert.match(auth, /clearNativeAccountState/);
  assert.match(auth, /suspendNativeLifecycleOwner/);
  assert.match(auth, /resumeLifecycleAfterBlockedLogout/);
  assert.match(auth, /LogoutSingleFlight/);
  assert.match(auth, /Promise<LogoutOutcome>/);
  assert.match(auth, /setNativeLifecycleAuthOwner\(null\)/);
  assert.match(auth, /runPushSafeSignOut/);
  assert.match(auth, /recoverAccountDeletionFinalization/);
  assert.match(auth, /request_started/);
  assert.match(auth, /remote_confirmed/);
  assert.match(auth, /abortBeforeRemoteCommit/);
  assert.match(push, /preparePushLogout/);
  assert.match(push, /nativeDetached/);
  assert.match(push, /beginPushRegistrationIntent/);
  assert.match(push, /sessionStillCurrent/);
  assert.doesNotMatch(auth, /Promise\.allSettled/);
  assert.match(
    notifications,
    /remaining\.some\(isEloviaReminderNotification\)/,
  );
  assert.match(notifications, /captureNativeLifecycleFence/);
  assert.match(notifications, /isNativeLifecycleFenceCurrent/);
  assert.match(geofence, /runGeofenceReconciliation/);
  assert.match(geofence, /captureNativeLifecycleFence/);
  assert.match(geofence, /isNativeLifecycleFenceCurrent/);
  assert.match(geofence, /hasStartedGeofencingAsync/);
  assert.match(geofence, /emitPendingArrivalRecorded/);
  assert.match(geofenceTask, /eloviaGeofence/);
  assert.match(geofenceTask, /ELOVIA_GEOFENCE_OWNER_KEY/);

  assert.match(pushRoute, /unregisterPushToken\(req\.user!\.id, token\)/);
  assert.match(pushRoute, /res\.status\(404\)/);
  assert.match(pushRoute, /unregistered: false/);
  assert.doesNotMatch(pushRoute, /req\.log\.error\(\{\s*err\s*\}/);
  assert.match(pushRoute, /errorType: errorType\(err\)/);
  assert.match(
    pushLib,
    /and\([\s\S]*eq\(pushTokensTable\.userId, userId\)[\s\S]*eq\(pushTokensTable\.token, token\)/,
  );
  assert.match(pushLib, /\.returning\(\{ id: pushTokensTable\.id \}\)/);
  assert.match(pushLib, /return affected\.length > 0/);
  assert.match(pushLib, /eloviaPushOwnerUserId: userId/);

  assert.match(deletionRecovery, /deletion_finalizing/);
  assert.match(deletionRecovery, /ACCOUNT_DELETION_MARKER_KEY/);
  assert.match(
    deletionRecovery,
    /multiRemove\(dataKeys\)[\s\S]*removeItem\(ACCOUNT_DELETION_MARKER_KEY\)/,
  );
  assert.match(authMiddleware, /code: "deleted_account"/);
  assert.match(authMiddleware, /provisionAuthenticatedUserIfActive/);
  assert.match(accountDeletion, /pg_advisory_xact_lock/);
  assert.match(accountDeletion, /tombstoneAndDeleteAccountData/);
  assert.match(accountDeletion, /FOR UPDATE SKIP LOCKED/);
  assert.match(accountDeletionFinalizer, /runAccountDeletionFinalizationBatch/);
  assert.match(serverIndex, /startAccountDeletionFinalizer\(\)/);
  assert.match(privacyRoutes, /runAccountDeletionWorkflow/);
  assert.match(privacyRoutes, /account_deletion_finalizing/);
  assert.match(privacyRoutes, /findAccountDeletionTombstoneByRequest/);

  const deletionOutcomeCheck = privacyData.indexOf(
    'logoutOutcome.status !== "signed_out"',
  );
  const localClear = privacyData.indexOf("await AsyncStorage.clear()");
  assert.match(privacyData, /operation: "account_deletion"/);
  assert.match(privacyData, /beforeSignOut/);
  assert.match(privacyData, /logoutOutcome\.status === "finalizing"/);
  assert.match(
    privacyData,
    /if \(!deletingAccount\) await AsyncStorage\.clear/,
  );
  assert.ok(deletionOutcomeCheck >= 0 && deletionOutcomeCheck < localClear);
  assert.match(profileScreen, /outcome\.status === "blocked"/);
  assert.match(profileScreen, /Sign-out needs a retry/);
});
