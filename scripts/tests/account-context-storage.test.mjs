import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { USER_DATA_FIELDS } from "../../artifacts/api-server/src/routes/userDataContract.ts";

const mobile = new URL("../../artifacts/mobile/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, mobile), "utf8");
}

test("all account-scoped contexts use the guarded storage facade", async () => {
  const contextPaths = [
    "context/AppContext.tsx",
    "context/WorkoutContext.tsx",
    "context/NutritionContext.tsx",
    "context/HealthContext.tsx",
    "context/WellnessContext.tsx",
  ];

  for (const path of contextPaths) {
    const text = await source(path);
    assert.doesNotMatch(text, /@react-native-async-storage\/async-storage/);
    assert.match(text, /captureAccountStorageSession/);
  }
});

test("every synchronized context key participates in cloud and account isolation", async () => {
  const text = await source("lib/accountSyncStorage.ts");
  for (const key of [
    "@elovia_active_session",
    "@elovia_wellness",
    "@elovia_water_goal",
    "@elovia_reminder_prefs",
    "@elovia_places",
  ]) {
    assert.match(text, new RegExp(key));
  }
  assert.match(text, /version: "sync-contract-18"/);
  assert.match(text, /adoptionMigrations: \[SYNC_CONTRACT_18_ADOPTION\]/);

  const cloud = await source("lib/cloudSync.ts");
  assert.match(cloud, /"@elovia_active_session": "activeSession"/);
  assert.match(cloud, /"@elovia_wellness": "wellnessData"/);
  assert.match(cloud, /"@elovia_water_goal": "waterGoal"/);
  assert.match(cloud, /"@elovia_reminder_prefs": "reminderPrefs"/);
  assert.match(cloud, /"@elovia_places": "places"/);
});

test("mobile and server expose one exact eighteen-field sync contract", async () => {
  const [accountStorage, cloudSync, userDataStore] = await Promise.all([
    source("lib/accountSyncStorage.ts"),
    source("lib/cloudSync.ts"),
    source("../api-server/src/services/userDataStore.ts"),
  ]);
  const keysBlock = accountStorage.match(
    /export const SYNC_KEYS = \[([\s\S]*?)\] as const/,
  );
  assert.ok(keysBlock, "SYNC_KEYS must remain a literal auditable list");
  const syncKeys = [...keysBlock[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const fieldPairs = [...cloudSync.matchAll(/"(@elovia_[^"]+)": "([^"]+)"/g)];
  const fieldMap = new Map(
    fieldPairs.map(([, storageKey, serverField]) => [storageKey, serverField]),
  );

  assert.equal(syncKeys.length, 18);
  assert.equal(fieldMap.size, 18);
  assert.deepEqual(
    syncKeys.map((storageKey) => fieldMap.get(storageKey)),
    USER_DATA_FIELDS,
  );
  assert.match(userDataStore, /USER_DATA_FIELDS\.map/);
});

test("reminders and foreground places use account-aware writes while arrivals stay device-local", async () => {
  const [notifications, geofence, placesScreen] = await Promise.all([
    source("lib/notifications.ts"),
    source("lib/geofence.ts"),
    source("app/places.tsx"),
  ]);

  assert.match(notifications, /captureAccountStorageSession/);
  assert.doesNotMatch(
    notifications,
    /@react-native-async-storage\/async-storage/,
  );
  const reminderSave = notifications.slice(
    notifications.indexOf("export async function saveReminderPreferences"),
    notifications.indexOf("export function isNotificationsAvailable"),
  );
  assert.match(reminderSave, /\.setItem\(/);
  assert.doesNotMatch(reminderSave, /catch/);
  assert.match(geofence, /captureAccountStorageSession/);
  assert.match(geofence, /accountStorage\.setItem\(\s*PLACES_KEY/);
  assert.match(geofence, /readStableBackgroundAccountValue\(PLACES_KEY\)/);
  assert.match(geofence, /AsyncStorage\.getItem\(PENDING_KEY\)/);
  assert.match(geofence, /AsyncStorage\.setItem\(PENDING_KEY/);
  assert.match(placesScreen, /onDataRestored/);
  assert.match(placesScreen, /Could not save places/);
  assert.match(placesScreen, /private account backup/);
  assert.doesNotMatch(placesScreen, /never sent anywhere/);
});

test("context reloads reset missing synchronized values to defaults", async () => {
  const [app, workout, nutrition, health, wellness] = await Promise.all([
    source("context/AppContext.tsx"),
    source("context/WorkoutContext.tsx"),
    source("context/NutritionContext.tsx"),
    source("context/HealthContext.tsx"),
    source("context/WellnessContext.tsx"),
  ]);

  assert.match(app, /setState\(defaultState\)/);
  assert.match(workout, /setPlanState\(p \? parseStoredJson[\s\S]*: null\)/);
  assert.match(workout, /setSessions\(s \? parseStoredJson[\s\S]*: \[\]\)/);
  assert.match(
    workout,
    /setPersonalRecords\(pr \? parseStoredJson[\s\S]*: \[\]\)/,
  );
  assert.match(
    workout,
    /setActiveSession\(active \? parseStoredJson[\s\S]*: null\)/,
  );
  assert.match(
    workout,
    /setActivePlanType\(apt \? parseStoredJson[\s\S]*: "ai"\)/,
  );
  assert.match(workout, /setCustomPlans\(cp \? parseStoredJson[\s\S]*: \[\]\)/);
  assert.match(
    workout,
    /setActiveCustomPlanId\(acpid \? parseStoredJson[\s\S]*: null\)/,
  );
  assert.match(
    nutrition,
    /setMealPlanState\(mp \? parseStoredJson[\s\S]*: null\)/,
  );
  assert.match(nutrition, /setFoodLog\(fl \? parseStoredJson[\s\S]*: \[\]\)/);
  assert.match(
    nutrition,
    /setCustomMealPlans\(cmp \? parseStoredJson[\s\S]*: \[\]\)/,
  );
  assert.match(
    nutrition,
    /setActiveMealPlanType\(ampt \? parseStoredJson[\s\S]*: "ai"\)/,
  );
  assert.match(
    nutrition,
    /setActiveCustomMealPlanId\(acmpid \? parseStoredJson[\s\S]*: null\)/,
  );
  assert.match(health, /setHealthData\(defaultHealthData\)/);
  assert.match(wellness, /setState\(DEFAULT_STATE\)/);
  assert.match(wellness, /setWaterGoalMlState\(2500\)/);
});

test("workout and nutrition reload each use one facade multiGet", async () => {
  const [workout, nutrition] = await Promise.all([
    source("context/WorkoutContext.tsx"),
    source("context/NutritionContext.tsx"),
  ]);
  assert.equal((workout.match(/accountStorage\.multiGet\(/g) ?? []).length, 1);
  assert.equal(
    (nutrition.match(/accountStorage\.multiGet\(/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(workout, /accountStorage\.getItem\(/);
  assert.doesNotMatch(nutrition, /accountStorage\.getItem\(/);
});

test("subscription entitlement refresh is outside the storage restore barrier", async () => {
  const subscription = await source("context/SubscriptionContext.tsx");
  assert.doesNotMatch(subscription, /onDataRestored/);
});

test("health capability refresh updates memory without persisting synchronized data", async () => {
  const health = await source("context/HealthContext.tsx");
  const start = health.indexOf("const refreshStatus = useCallback");
  const end = health.indexOf(
    "Read everything the platform will give us",
    start,
  );
  assert.ok(
    start >= 0 && end > start,
    "refreshStatus block should remain inspectable",
  );
  const refreshBlock = health.slice(start, end);
  assert.doesNotMatch(refreshBlock, /persist\(/);
  assert.match(refreshBlock, /setStatus\(next\)/);
  assert.match(refreshBlock, /setHealthData/);
});

test("account providers withhold descendants until initial storage hydration settles", async () => {
  const providers = [
    ["Workout", await source("context/WorkoutContext.tsx"), "hydrated"],
    ["Nutrition", await source("context/NutritionContext.tsx"), "hydrated"],
    ["Health", await source("context/HealthContext.tsx"), "hydrated"],
    ["Wellness", await source("context/WellnessContext.tsx"), "isLoaded"],
  ];

  for (const [name, text, flag] of providers) {
    if (flag === "hydrated") {
      assert.match(text, /const \[hydrated, setHydrated\] = useState\(false\)/);
      assert.match(text, /finally \{[\s\S]*setHydrated\(true\)/);
    } else {
      assert.match(text, /finally \{[\s\S]*setIsLoaded\(true\)/);
    }
    const gate = text.indexOf(`if (!${flag}) return null`);
    const provider = text.indexOf(`<${name}Context.Provider`);
    assert.ok(gate >= 0, `${name} must expose a hydration gate`);
    assert.ok(
      gate < provider,
      `${name} must gate before rendering descendants`,
    );
  }
});

test("a delayed provider load cannot persist a list computed from defaults", async () => {
  let releaseStorage;
  const delayedStorage = new Promise((resolve) => {
    releaseStorage = resolve;
  });
  let hydrated = false;
  let sessions = [];
  let persisted = null;

  const load = (async () => {
    try {
      sessions = await delayedStorage;
    } finally {
      hydrated = true;
    }
  })();
  const renderDescendant = () =>
    hydrated
      ? () => {
          sessions = [...sessions, { id: "new" }];
          persisted = sessions;
        }
      : null;

  assert.equal(renderDescendant(), null);
  assert.equal(persisted, null);
  releaseStorage([{ id: "existing" }]);
  await load;
  renderDescendant()();
  assert.deepEqual(persisted, [{ id: "existing" }, { id: "new" }]);
});

test("auth remounts the account provider subtree and invalidates storage generations", async () => {
  const auth = await source("lib/auth.tsx");
  const facade = await source("lib/accountSyncStorage.ts");
  assert.match(auth, /setAccountStorageAuthScope/);
  assert.match(auth, /React\.Fragment key=\{accountScopeKey\}/);
  assert.match(facade, /generation/);
  assert.match(facade, /StaleAccountStorageSessionError/);
});

test("restore events await all listeners and report aggregate failure", async () => {
  const { emitDataRestored, onDataRestored } =
    await import("../../artifacts/mobile/lib/syncEvents.ts");
  const completed = [];
  const removeSlow = onDataRestored(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed.push("slow");
  });
  const removeFailed = onDataRestored(async () => {
    completed.push("failed");
    throw new Error("reload failed");
  });
  const removeFast = onDataRestored(() => {
    completed.push("fast");
  });

  try {
    const outcome = await emitDataRestored();
    assert.deepEqual(new Set(completed), new Set(["slow", "failed", "fast"]));
    assert.deepEqual(outcome, { status: "failed", failures: 1 });
  } finally {
    removeSlow();
    removeFailed();
    removeFast();
  }
});

test("provider reload helper resets defaults and still propagates storage or parse failures", async () => {
  const { runProviderReload } =
    await import("../../artifacts/mobile/lib/providerReload.ts");
  const events = [];

  await assert.rejects(
    runProviderReload(
      () => events.push("defaults"),
      async () => {
        events.push("load");
        JSON.parse("{");
      },
    ),
    SyntaxError,
  );
  assert.deepEqual(events, ["load", "defaults"]);

  await assert.rejects(
    runProviderReload(
      () => events.push("storage-defaults"),
      async () => {
        throw new Error("storage failed");
      },
    ),
    /storage failed/,
  );
  assert.equal(events.at(-1), "storage-defaults");
});

test("automatic and manual restores await provider reloads before success", async () => {
  const [auto, profile] = await Promise.all([
    source("components/AutoSync.tsx"),
    source("app/(tabs)/profile.tsx"),
  ]);
  assert.match(auto, /await emitDataRestored\(\)/);
  assert.match(auto, /reload\.status === "failed"/);
  assert.match(profile, /await emitDataRestored\(\)/);
  assert.match(profile, /reload\.status === "failed"/);
});

test("provider startup catches safely while restore listeners return rejecting reload promises", async () => {
  const contextPaths = [
    "context/AppContext.tsx",
    "context/WorkoutContext.tsx",
    "context/NutritionContext.tsx",
    "context/HealthContext.tsx",
    "context/WellnessContext.tsx",
  ];

  for (const path of contextPaths) {
    const text = await source(path);
    assert.match(text, /runProviderReload/);
    assert.match(text, /\.catch\(\(\) => \{\}\)/);
    assert.match(
      text,
      /onDataRestored\(\(\) => (?:load|loadState|loadData)\(\)\)/,
    );
  }
});

test("reset surface supports guests without deleting authenticated caches", async () => {
  const [facade, profile] = await Promise.all([
    source("lib/accountSyncStorage.ts"),
    source("app/(tabs)/profile.tsx"),
  ]);
  assert.match(facade, /resetCurrentAccountStorage/);
  assert.match(profile, /resetCurrentAccountStorage/);
  assert.match(
    profile,
    /if \(!isAuthenticated \|\| !user\)[\s\S]*resetCurrentAccountStorage/,
  );
});
