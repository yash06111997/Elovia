import type { HealthMetric } from "@/context/AppContext";
import type { FoodLogEntry } from "@/context/NutritionContext";
import type { WorkoutSession } from "@/context/WorkoutContext";
import type { SleepNight, VitalSample } from "@/lib/health";

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface NutritionProgressDay extends MacroTotals {
  date: string;
  label: string;
  isToday: boolean;
}

const EMPTY_MACROS: MacroTotals = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDateKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new TypeError(`Invalid date key: ${key}`);
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(key: string, amount: number): string {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return toDateKey(date);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildNutritionProgress(
  foodLog: FoodLogEntry[],
  targets: MacroTotals,
  todayKey: string,
): {
  today: MacroTotals;
  targets: MacroTotals;
  days: NutritionProgressDay[];
} {
  const totalsByDate = new Map<string, MacroTotals>();

  for (const item of foodLog) {
    const previous = totalsByDate.get(item.date) ?? EMPTY_MACROS;
    totalsByDate.set(item.date, {
      calories: previous.calories + item.calories,
      protein: previous.protein + item.protein,
      carbs: previous.carbs + item.carbs,
      fats: previous.fats + item.fats,
    });
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(todayKey, index - 6);
    const totals = totalsByDate.get(date) ?? EMPTY_MACROS;
    return {
      date,
      label: DAY_LABELS[parseDateKey(date).getUTCDay()],
      isToday: date === todayKey,
      ...totals,
    };
  });

  return {
    today: { ...(totalsByDate.get(todayKey) ?? EMPTY_MACROS) },
    targets,
    days,
  };
}

function sessionVolume(session: WorkoutSession): number {
  return session.exerciseLogs.reduce(
    (sessionTotal, exercise) =>
      sessionTotal +
      exercise.sets.reduce(
        (exerciseTotal, set) =>
          exerciseTotal + (set.completed ? set.reps * set.weightKg : 0),
        0,
      ),
    0,
  );
}

export function buildWorkoutProgress(
  sessions: WorkoutSession[],
  weeklyTarget: number,
  todayKey: string,
): {
  completedSessions: number;
  totalVolumeKg: number;
  week: {
    completedSessions: number;
    targetSessions: number;
    completionPercent: number;
    durationMins: number;
    volumeKg: number;
  };
} {
  const completed = sessions.filter((item) => item.completed);
  const today = parseDateKey(todayKey);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const weekStartKey = addDays(todayKey, -mondayOffset);
  const weekSessions = completed.filter(
    (item) => item.date >= weekStartKey && item.date <= todayKey,
  );
  const targetSessions = Number.isFinite(weeklyTarget)
    ? Math.max(0, Math.round(weeklyTarget))
    : 0;
  const completedThisWeek = weekSessions.length;

  return {
    completedSessions: completed.length,
    totalVolumeKg: completed.reduce(
      (total, item) => total + sessionVolume(item),
      0,
    ),
    week: {
      completedSessions: completedThisWeek,
      targetSessions,
      completionPercent:
        targetSessions > 0
          ? Math.min(
              100,
              Math.round((completedThisWeek / targetSessions) * 100),
            )
          : 0,
      durationMins: weekSessions.reduce(
        (total, item) => total + Math.max(0, item.durationMins),
        0,
      ),
      volumeKg: weekSessions.reduce(
        (total, item) => total + sessionVolume(item),
        0,
      ),
    },
  };
}

export interface WeightReading {
  date: string;
  weightKg: number;
  source: "manual" | "health";
}

export function buildWeightTrend(
  manualMetrics: HealthMetric[],
  nativeBodyMass: VitalSample[],
  startKey: string,
  endKey: string,
): {
  readings: WeightReading[];
  latestKg: number | null;
  changeKg: number | null;
} {
  const byDate = new Map<string, WeightReading>();

  for (const metric of manualMetrics) {
    if (
      typeof metric.weightKg !== "number" ||
      !Number.isFinite(metric.weightKg)
    )
      continue;
    byDate.set(metric.date, {
      date: metric.date,
      weightKg: metric.weightKg,
      source: "manual",
    });
  }

  for (const sample of nativeBodyMass) {
    if (!Number.isFinite(sample.value)) continue;
    byDate.set(sample.date, {
      date: sample.date,
      weightKg: sample.value,
      source: "health",
    });
  }

  const readings = [...byDate.values()]
    .filter((reading) => reading.date >= startKey && reading.date <= endKey)
    .sort((left, right) => left.date.localeCompare(right.date));
  const first = readings[0];
  const latest = readings[readings.length - 1];

  return {
    readings,
    latestKg: latest?.weightKg ?? null,
    changeKg:
      readings.length >= 2 && first && latest
        ? roundOne(latest.weightKg - first.weightKg)
        : null,
  };
}

function latestSample(samples: VitalSample[]): VitalSample | null {
  return samples.reduce<VitalSample | null>(
    (latest, sample) =>
      !latest || sample.date > latest.date ? sample : latest,
    null,
  );
}

export function buildRecoverySignals(data: {
  sleep: SleepNight[];
  restingHeartRate: VitalSample[];
  heartRateVariability: VitalSample[];
}): {
  sleep: { date: string; value: number } | null;
  restingHeartRate: { date: string; value: number } | null;
  heartRateVariability: { date: string; value: number } | null;
} {
  const sleep = data.sleep.reduce<SleepNight | null>(
    (latest, night) => (!latest || night.date > latest.date ? night : latest),
    null,
  );
  const restingHeartRate = latestSample(data.restingHeartRate);
  const heartRateVariability = latestSample(data.heartRateVariability);

  return {
    sleep: sleep ? { date: sleep.date, value: sleep.asleepMins } : null,
    restingHeartRate: restingHeartRate
      ? { date: restingHeartRate.date, value: restingHeartRate.value }
      : null,
    heartRateVariability: heartRateVariability
      ? { date: heartRateVariability.date, value: heartRateVariability.value }
      : null,
  };
}
