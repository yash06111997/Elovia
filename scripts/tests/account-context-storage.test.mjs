import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  ]) {
    assert.match(text, new RegExp(key));
  }

  const cloud = await source("lib/cloudSync.ts");
  assert.match(cloud, /"@elovia_active_session": "activeSession"/);
  assert.match(cloud, /"@elovia_wellness": "wellnessData"/);
  assert.match(cloud, /"@elovia_water_goal": "waterGoal"/);
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
  assert.match(workout, /setPlanState\(p \? JSON\.parse\(p\) : null\)/);
  assert.match(workout, /setSessions\(s \? JSON\.parse\(s\) : \[\]\)/);
  assert.match(workout, /setPersonalRecords\(pr \? JSON\.parse\(pr\) : \[\]\)/);
  assert.match(
    workout,
    /setActiveSession\(active \? JSON\.parse\(active\) : null\)/,
  );
  assert.match(
    workout,
    /setActivePlanType\(apt \? JSON\.parse\(apt\) : "ai"\)/,
  );
  assert.match(workout, /setCustomPlans\(cp \? JSON\.parse\(cp\) : \[\]\)/);
  assert.match(
    workout,
    /setActiveCustomPlanId\(acpid \? JSON\.parse\(acpid\) : null\)/,
  );
  assert.match(nutrition, /setMealPlanState\(mp \? JSON\.parse\(mp\) : null\)/);
  assert.match(nutrition, /setFoodLog\(fl \? JSON\.parse\(fl\) : \[\]\)/);
  assert.match(
    nutrition,
    /setCustomMealPlans\(cmp \? JSON\.parse\(cmp\) : \[\]\)/,
  );
  assert.match(
    nutrition,
    /setActiveMealPlanType\(ampt \? JSON\.parse\(ampt\) : "ai"\)/,
  );
  assert.match(
    nutrition,
    /setActiveCustomMealPlanId\(acmpid \? JSON\.parse\(acmpid\) : null\)/,
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
