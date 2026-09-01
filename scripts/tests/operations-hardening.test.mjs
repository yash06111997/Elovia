import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseCachedPushOwnership,
  persistPushOwnershipOrCompensate,
  planPushOwnershipTransition,
  resolvePushPermission,
  runPushSafeSignOut,
  runPushOwnershipMutation,
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
}

test("telemetry is allowlisted, privacy-safe, rate-limited, and connected to crash reporting", async () => {
  const api = await source("artifacts/api-server/src/routes/telemetry.ts");
  const client = await source("artifacts/mobile/lib/telemetry.ts");
  const root = await source("artifacts/mobile/app/_layout.tsx");

  assert.match(api, /ALLOWED_EVENTS/);
  assert.match(api, /rateLimit/);
  assert.match(api, /res\.sendStatus\(204\)/);
  assert.doesNotMatch(api, /req\.body\.message/);
  assert.match(client, /reportClientError/);
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
  assert.doesNotMatch(coordinator, /NativeRestoreReconciliationFailed/);
  assert.match(coordinator, /arrivalLeaseId/);
  assert.doesNotMatch(coordinator, /clearPendingArrival/);
  assert.match(workouts, /acknowledgePendingArrival/);
  assert.match(workouts, /parsePendingArrivalRouteContext/);
  assert.match(coordinator, /useRootNavigationState/);
  assert.match(root, /<NativeLifecycleCoordinator\s*\/>/);

  const reconcileBody = push.match(
    /export async function reconcilePushRegistration[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(reconcileBody);
  assert.doesNotMatch(reconcileBody, /requestPermissionsAsync/);
  assert.match(notifications, /cancelScheduledNotificationAsync/);
  assert.doesNotMatch(notifications, /cancelAllScheduledNotificationsAsync/);
  assert.match(auth, /if \(!canCompletePushLogout\(pushDetachment\)\)/);
  assert.match(auth, /runPushSafeSignOut/);
  assert.match(push, /preparePushLogout/);
  assert.match(push, /nativeDetached/);
  assert.match(
    auth,
    /Promise\.allSettled\(\[cancelAllReminders\(\), stopAllGeofences\(\)\]\)/,
  );
  assert.match(geofence, /runGeofenceReconciliation/);
  assert.match(geofence, /emitPendingArrivalRecorded/);
  assert.match(geofenceTask, /eloviaGeofence/);
  assert.match(geofenceTask, /ELOVIA_GEOFENCE_OWNER_KEY/);

  assert.match(pushRoute, /unregisterPushToken\(req\.user!\.id, token\)/);
  assert.doesNotMatch(pushRoute, /req\.log\.error\(\{\s*err\s*\}/);
  assert.match(pushRoute, /errorType: errorType\(err\)/);
  assert.match(
    pushLib,
    /and\([\s\S]*eq\(pushTokensTable\.userId, userId\)[\s\S]*eq\(pushTokensTable\.token, token\)/,
  );
  assert.match(pushLib, /eloviaPushOwnerUserId: userId/);
});
