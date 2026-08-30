import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

async function source(relativePath) {
  try {
    return await readFile(new URL(relativePath, repositoryRoot), "utf8");
  } catch {
    return "";
  }
}

test("onboarding keeps all seven steps, records privacy acknowledgement, and previews generated value", async () => {
  const onboarding = await source("artifacts/mobile/app/onboarding/index.tsx");
  const preview = await source("artifacts/mobile/app/plan-preview.tsx");
  const rootLayout = await source("artifacts/mobile/app/_layout.tsx");

  assert.match(onboarding, /const TOTAL_STEPS = 7/);
  assert.match(onboarding, /privacyAcknowledged/);
  assert.match(onboarding, /pathname: "\/plan-preview"/);
  assert.match(preview, /Your plan is ready/);
  assert.match(preview, /useWorkout/);
  assert.match(preview, /useNutrition/);
  assert.match(preview, /pathname: "\/paywall"/);
  assert.match(rootLayout, /name="plan-preview"/);
});

test("training feedback produces conservative, deterministic plan adjustments", async () => {
  const { recommendTrainingAdjustment } =
    await import("../../artifacts/mobile/lib/trainingAdaptation.ts");

  assert.deepEqual(
    recommendTrainingAdjustment({
      effort: 7,
      pain: 8,
      enjoyment: 3,
      readiness: 3,
    }),
    {
      direction: "reduce",
      volumeFactor: 0.7,
      summary:
        "Reduce the next session and prioritise recovery. Persistent or sharp pain needs professional assessment.",
    },
  );
  assert.equal(
    recommendTrainingAdjustment({
      effort: 9,
      pain: 2,
      enjoyment: 3,
      readiness: 3,
    }).direction,
    "reduce",
  );
  assert.equal(
    recommendTrainingAdjustment({
      effort: 6,
      pain: 1,
      enjoyment: 5,
      readiness: 5,
    }).direction,
    "progress",
  );
  assert.equal(
    recommendTrainingAdjustment({
      effort: 7,
      pain: 2,
      enjoyment: 3,
      readiness: 3,
    }).direction,
    "maintain",
  );
});

test("completed workouts persist feedback and its adaptive recommendation", async () => {
  const workoutContext = await source(
    "artifacts/mobile/context/WorkoutContext.tsx",
  );
  const workoutLogger = await source("artifacts/mobile/app/log-workout.tsx");

  assert.match(workoutContext, /feedback\?: WorkoutFeedback/);
  assert.match(workoutContext, /recommendTrainingAdjustment/);
  assert.match(
    workoutContext,
    /completeSession:\s*\(\s*durationMins: number,\s*feedback: WorkoutFeedback,?\s*\)/,
  );
  assert.match(workoutLogger, /Post-workout check-in/);
  assert.match(workoutLogger, /completeSession\(durationMins, feedback\)/);
});

test("legacy storage is copied once without overwriting newer Elovia data", async () => {
  const { planStorageNamespaceMigration } =
    await import("../../artifacts/mobile/lib/storageMigration.ts");

  const plan = planStorageNamespaceMigration([
    ["@fitai_state", "old-state"],
    ["@elovia_state", "new-state"],
    ["@fitai_plan", "legacy-plan"],
    ["@elovia_plan", null],
  ]);

  assert.deepEqual(plan.writes, [["@elovia_plan", "legacy-plan"]]);
  assert.deepEqual(plan.remove.sort(), ["@fitai_plan", "@fitai_state"]);
});
