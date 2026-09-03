import type { FoodLogEntry } from "@/context/NutritionContext";
import type { HealthMetric } from "@/context/AppContext";
import type { WorkoutSession } from "@/context/WorkoutContext";
import {
  buildNutritionProgress,
  buildRecoverySignals,
  buildWeightTrend,
  buildWorkoutProgress,
} from "./progressMetrics";

const entry = (overrides: Partial<FoodLogEntry>): FoodLogEntry => ({
  id: "food-1",
  date: "2026-09-03",
  name: "Lunch",
  calories: 500,
  protein: 30,
  carbs: 50,
  fats: 12,
  mealType: "lunch",
  servingSize: "1 serving",
  timestamp: "2026-09-03T12:00:00.000Z",
  ...overrides,
});

const session = (overrides: Partial<WorkoutSession>): WorkoutSession => ({
  id: "session-1",
  date: "2026-08-31",
  workoutDayId: "upper",
  workoutDayName: "Upper body",
  durationMins: 45,
  completed: true,
  exerciseLogs: [
    {
      exerciseId: "bench",
      exerciseName: "Bench press",
      date: "2026-08-31",
      sets: [
        { setNumber: 1, reps: 8, weightKg: 60, completed: true },
        { setNumber: 2, reps: 8, weightKg: 60, completed: false },
      ],
    },
  ],
  ...overrides,
});

describe("progress metrics", () => {
  it("builds an honest seven-day nutrition series ending today", () => {
    const result = buildNutritionProgress(
      [
        entry({ id: "today-a" }),
        entry({
          id: "today-b",
          calories: 260,
          protein: 12,
          carbs: 14,
          fats: 6,
        }),
        entry({ id: "monday", date: "2026-08-31", calories: 1_900 }),
      ],
      { calories: 2_030, protein: 150, carbs: 200, fats: 70 },
      "2026-09-03",
    );

    expect(result.today).toEqual({
      calories: 760,
      protein: 42,
      carbs: 64,
      fats: 18,
    });
    expect(result.days).toHaveLength(7);
    expect(result.days.map((day) => day.date)).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(result.days[result.days.length - 1]).toEqual(
      expect.objectContaining({ label: "Thu", isToday: true, calories: 760 }),
    );
  });

  it("counts week-start sessions and excludes incomplete sets from load", () => {
    const result = buildWorkoutProgress(
      [
        session({}),
        session({
          id: "unfinished",
          date: "2026-09-02",
          completed: false,
          durationMins: 90,
        }),
      ],
      3,
      "2026-09-03",
    );

    expect(result.week).toEqual({
      completedSessions: 1,
      targetSessions: 3,
      completionPercent: 33,
      durationMins: 45,
      volumeKg: 480,
    });
    expect(result.completedSessions).toBe(1);
    expect(result.totalVolumeKg).toBe(480);
  });

  it("returns zero rather than NaN when a plan has no workout days", () => {
    const result = buildWorkoutProgress([], 0, "2026-09-03");

    expect(result.week.targetSessions).toBe(0);
    expect(result.week.completionPercent).toBe(0);
  });

  it("sorts and deduplicates weight readings while preferring native health data", () => {
    const manual: HealthMetric[] = [
      { date: "2026-09-03", weightKg: 70.2 },
      { date: "2026-08-30", weightKg: 71 },
      { date: "2026-08-01", weightKg: 75 },
    ];

    const result = buildWeightTrend(
      manual,
      [
        { date: "2026-09-03", value: 70 },
        { date: "2026-09-01", value: 70.5 },
      ],
      "2026-08-28",
      "2026-09-03",
    );

    expect(result.readings).toEqual([
      { date: "2026-08-30", weightKg: 71, source: "manual" },
      { date: "2026-09-01", weightKg: 70.5, source: "health" },
      { date: "2026-09-03", weightKg: 70, source: "health" },
    ]);
    expect(result.latestKg).toBe(70);
    expect(result.changeKg).toBe(-1);
  });

  it("does not invent a weight trend from a single reading", () => {
    const result = buildWeightTrend(
      [{ date: "2026-09-03", weightKg: 70 }],
      [],
      "2026-08-28",
      "2026-09-03",
    );

    expect(result.latestKg).toBe(70);
    expect(result.changeKg).toBeNull();
  });

  it("uses the latest dated recovery samples and leaves missing data explicit", () => {
    const result = buildRecoverySignals({
      sleep: [
        { date: "2026-09-03", asleepMins: 450, inBedMins: 480 },
        { date: "2026-09-01", asleepMins: 420, inBedMins: 450 },
      ],
      restingHeartRate: [{ date: "2026-09-03", value: 58 }],
      heartRateVariability: [],
    });

    expect(result).toEqual({
      sleep: { date: "2026-09-03", value: 450 },
      restingHeartRate: { date: "2026-09-03", value: 58 },
      heartRateVariability: null,
    });
  });
});
