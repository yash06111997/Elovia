import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseCachedPushOwnership,
  planPushOwnershipTransition,
} from "../../artifacts/mobile/lib/pushOwnership.ts";
import {
  buildReminderSchedule,
  ELOVIA_REMINDER_OWNER,
  isEloviaReminderNotification,
  normalizeReminderPreferences,
} from "../../artifacts/mobile/lib/reminderSchedule.ts";
import { PendingArrivalStore } from "../../artifacts/mobile/lib/pendingArrival.ts";

const repositoryRoot = new URL("../../", import.meta.url);

async function source(relativePath) {
  try {
    return await readFile(new URL(relativePath, repositoryRoot), "utf8");
  } catch {
    return "";
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

test("pending arrivals are account-bound, retryable, and consumed once", async () => {
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
  const pending = new PendingArrivalStore(storage, () =>
    new Date("2026-09-01T12:10:00.000Z").getTime(),
  );
  await pending.record({
    eventId: "arrival-1",
    ownerUserId: "user-a",
    placeId: "gym-1",
    placeName: "Strength Lab",
    autoStartWorkout: true,
    at: "2026-09-01T12:00:00.000Z",
  });

  assert.equal(await pending.readForUser("user-b"), null);
  const first = await pending.readForUser("user-a");
  assert.equal(first?.placeName, "Strength Lab");
  assert.equal(await pending.readForUser("user-a"), null);

  await pending.release(first);
  const concurrentReads = await Promise.all([
    pending.readForUser("user-a"),
    pending.readForUser("user-a"),
  ]);
  assert.equal(concurrentReads.filter(Boolean).length, 1);
  const retry = concurrentReads.find(Boolean);
  assert.equal(retry?.eventId, "arrival-1");
  assert.equal(await pending.complete(retry), true);
  assert.equal(await pending.readForUser("user-a"), null);
});

test("authentication recovery and native lifecycle are connected without launch permission prompts", async () => {
  const [
    authScreen,
    coordinator,
    root,
    push,
    notifications,
    pushRoute,
    pushLib,
  ] = await Promise.all([
    source("artifacts/mobile/app/auth.tsx"),
    source("artifacts/mobile/components/NativeLifecycleCoordinator.tsx"),
    source("artifacts/mobile/app/_layout.tsx"),
    source("artifacts/mobile/lib/push.ts"),
    source("artifacts/mobile/lib/notifications.ts"),
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
  assert.match(coordinator, /reconcilePushRegistration/);
  assert.match(coordinator, /readPendingArrival/);
  assert.match(coordinator, /useRootNavigationState/);
  assert.match(root, /<NativeLifecycleCoordinator\s*\/>/);

  const reconcileBody = push.match(
    /export async function reconcilePushRegistration[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(reconcileBody);
  assert.doesNotMatch(reconcileBody, /requestPermissionsAsync/);
  assert.match(notifications, /cancelScheduledNotificationAsync/);
  assert.doesNotMatch(notifications, /cancelAllScheduledNotificationsAsync/);

  assert.match(pushRoute, /unregisterPushToken\(req\.user!\.id, token\)/);
  assert.doesNotMatch(pushRoute, /req\.log\.error\(\{\s*err\s*\}/);
  assert.match(pushRoute, /errorType: errorType\(err\)/);
  assert.match(
    pushLib,
    /and\([\s\S]*eq\(pushTokensTable\.userId, userId\)[\s\S]*eq\(pushTokensTable\.token, token\)/,
  );
});
