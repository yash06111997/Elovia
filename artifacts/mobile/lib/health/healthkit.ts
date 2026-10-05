import {
  EMPTY_SNAPSHOT,
  daysAgo,
  toLocalDateKey,
  type DailyEnergy,
  type DailySteps,
  type HealthCapabilities,
  type HealthProvider,
  type HealthSnapshot,
  type HealthWorkout,
  type SleepNight,
  type VitalSample,
} from "./types";

/**
 * Apple HealthKit provider.
 *
 * The native module is loaded lazily inside a try/catch. A top-level import
 * would crash the whole app on startup in Expo Go and on web, where the native
 * binary simply is not present - which is exactly the failure mode that makes
 * people give up on health integrations and ship a fake toggle instead.
 */

type HealthKitModule = typeof import("@kingstinct/react-native-healthkit");

let cachedModule: HealthKitModule | null = null;
let loadAttempted = false;

function loadHealthKit(): HealthKitModule | null {
  if (loadAttempted) return cachedModule;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule =
      require("@kingstinct/react-native-healthkit") as HealthKitModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** Types we read. Requesting fewer keeps the permission sheet honest. */
const READ_TYPES = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierBodyMass",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
] as const;

/** Types we write back, so Elovia workouts appear in Apple Health. */
const WRITE_TYPES = [
  "HKWorkoutTypeIdentifier",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
] as const;

function unavailable(requiresDevBuild: boolean): HealthCapabilities {
  return {
    backend: "healthkit",
    available: false,
    authorized: false,
    canReadSteps: false,
    canReadWorkouts: false,
    canReadSleep: false,
    canReadVitals: false,
    canWriteWorkouts: false,
    requiresDevBuild,
  };
}

export const healthKitProvider: HealthProvider = {
  backend: "healthkit",

  async getCapabilities(): Promise<HealthCapabilities> {
    const hk = loadHealthKit();
    if (!hk) return unavailable(true);

    try {
      const available = await hk.isHealthDataAvailableAsync();
      if (!available) return unavailable(false);

      // requestStatus tells us whether the permission sheet has been answered.
      // HealthKit deliberately never reveals whether READ access was granted
      // (that would leak the absence of data), so "authorized" here means
      // "the user has been asked", and empty reads are handled downstream.
      const status = await hk.getRequestStatusForAuthorization({
        toRead: READ_TYPES as unknown as never,
        toShare: WRITE_TYPES as unknown as never,
      });

      // 0 = unknown, 1 = shouldRequest, 2 = unnecessary (already asked)
      const authorized = Number(status) === 2;

      return {
        backend: "healthkit",
        available: true,
        authorized,
        canReadSteps: true,
        canReadWorkouts: true,
        canReadSleep: true,
        canReadVitals: true,
        canWriteWorkouts: true,
        requiresDevBuild: false,
      };
    } catch {
      return unavailable(false);
    }
  },

  async requestPermissions(): Promise<boolean> {
    const hk = loadHealthKit();
    if (!hk) return false;
    try {
      return await hk.requestAuthorization({
        toRead: READ_TYPES as unknown as never,
        toShare: WRITE_TYPES as unknown as never,
      });
    } catch {
      return false;
    }
  },

  async readSnapshot(days: number): Promise<Partial<HealthSnapshot>> {
    const hk = loadHealthKit();
    if (!hk) return {};

    const from = daysAgo(days - 1);
    const filter = { startDate: from, endDate: new Date() };

    // Each read is independent: one denied permission must not blank the rest.
    const [steps, energy, workouts, sleep, restingHr, hrv, weight] =
      await Promise.all([
        readDailyStatistic(
          hk,
          "HKQuantityTypeIdentifierStepCount",
          "count",
          from,
        ),
        readDailyStatistic(
          hk,
          "HKQuantityTypeIdentifierActiveEnergyBurned",
          "kcal",
          from,
        ),
        readWorkouts(hk, filter),
        readSleep(hk, filter),
        readVitals(
          hk,
          "HKQuantityTypeIdentifierRestingHeartRate",
          "count/min",
          filter,
        ),
        readVitals(
          hk,
          "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
          "ms",
          filter,
        ),
        readVitals(hk, "HKQuantityTypeIdentifierBodyMass", "kg", filter),
      ]);

    const todayKey = toLocalDateKey(new Date());
    const weeklySteps: DailySteps[] = steps.map((s) => ({
      date: s.date,
      steps: Math.round(s.value),
    }));
    const activeEnergyKcal: DailyEnergy[] = energy.map((s) => ({
      date: s.date,
      kcal: Math.round(s.value),
    }));

    return {
      todaySteps: weeklySteps.find((s) => s.date === todayKey)?.steps ?? 0,
      weeklySteps,
      activeEnergyKcal,
      workouts,
      sleep,
      restingHeartRate: restingHr,
      heartRateVariability: hrv,
      bodyMassKg: weight,
      syncedAt: new Date().toISOString(),
    };
  },

  async writeWorkout(workout): Promise<boolean> {
    const hk = loadHealthKit();
    if (!hk) return false;
    try {
      const existing = await hk.queryWorkoutSamples({
        filter: {
          metadata: {
            withMetadataKey: "HKExternalUUID",
            operatorType: 4,
            value: workout.id,
          },
        },
        limit: 1,
      });
      if (existing.length > 0) return true;
      const quantities = workout.energyKcal
        ? [
            {
              quantityType: "HKQuantityTypeIdentifierActiveEnergyBurned",
              unit: "kcal",
              quantity: workout.energyKcal,
              startDate: workout.start,
              endDate: workout.end,
            },
          ]
        : [];

      await hk.saveWorkoutSample(
        mapActivityTypeToHealthKit(workout.activityType) as never,
        quantities as never,
        workout.start,
        workout.end,
        undefined,
        { HKExternalUUID: workout.id },
      );
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Daily buckets via a statistics collection query. Far cheaper than fetching
 * every sample and summing in JS - HealthKit does the aggregation natively,
 * and a heavy step-count history can be tens of thousands of samples.
 */
async function readDailyStatistic(
  hk: HealthKitModule,
  identifier: string,
  unit: string,
  anchor: Date,
): Promise<{ date: string; value: number }[]> {
  try {
    const results = await hk.queryStatisticsCollectionForQuantity(
      identifier as never,
      ["cumulativeSum"] as never,
      anchor,
      { day: 1 },
      {
        unit: unit as never,
        filter: { startDate: anchor, endDate: new Date() },
      } as never,
    );

    return (results ?? [])
      .map((r: any) => {
        const value = r?.sumQuantity?.quantity ?? 0;
        const date = r?.startDate ? new Date(r.startDate) : null;
        if (!date) return null;
        return { date: toLocalDateKey(date), value: Number(value) || 0 };
      })
      .filter((r): r is { date: string; value: number } => r !== null);
  } catch {
    return [];
  }
}

async function readWorkouts(
  hk: HealthKitModule,
  filter: any,
): Promise<HealthWorkout[]> {
  try {
    const samples = await hk.queryWorkoutSamples({
      filter,
      limit: 100,
      ascending: false,
      energyUnit: "kcal",
      distanceUnit: "m",
    } as never);

    return (samples ?? []).map((w: any) => {
      const start = new Date(w.startDate);
      const end = new Date(w.endDate);
      const distanceMeters = Number(w?.totalDistance?.quantity) || 0;
      return {
        id: String(w.uuid ?? `${w.startDate}-${w.workoutActivityType}`),
        activityType: String(w.workoutActivityType ?? "Workout"),
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        durationMins: Math.max(
          0,
          Math.round((end.getTime() - start.getTime()) / 60000),
        ),
        energyKcal: Number(w?.totalEnergyBurned?.quantity) || null,
        distanceKm: distanceMeters
          ? Math.round((distanceMeters / 1000) * 100) / 100
          : null,
        source: w?.sourceRevision?.source?.name ?? null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Sleep, folded into nights.
 *
 * HealthKit stores sleep as many short interval samples, not one per night, so
 * they must be summed. Only "asleep" values count toward asleepMins; value 0 is
 * inBed. Samples are attributed to the date they END on, which is the
 * convention users expect ("last night's sleep" shows on this morning).
 */
async function readSleep(
  hk: HealthKitModule,
  filter: any,
): Promise<SleepNight[]> {
  try {
    const samples = await hk.queryCategorySamples(
      "HKCategoryTypeIdentifierSleepAnalysis" as never,
      {
        filter,
        limit: 2000,
        ascending: false,
      } as never,
    );

    const byNight = new Map<string, { asleep: number; inBed: number }>();

    for (const s of samples ?? []) {
      const raw = s as any;
      const start = new Date(raw.startDate);
      const end = new Date(raw.endDate);
      const mins = Math.max(0, (end.getTime() - start.getTime()) / 60000);
      const key = toLocalDateKey(end);

      const bucket = byNight.get(key) ?? { asleep: 0, inBed: 0 };
      // 0 = inBed; 1 = asleepUnspecified; 3/4/5 = core/deep/REM.
      if (Number(raw.value) === 0) bucket.inBed += mins;
      else bucket.asleep += mins;
      byNight.set(key, bucket);
    }

    return [...byNight.entries()]
      .map(([date, v]) => ({
        date,
        asleepMins: Math.round(v.asleep),
        inBedMins: Math.round(v.inBed || v.asleep),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

async function readVitals(
  hk: HealthKitModule,
  identifier: string,
  unit: string,
  filter: any,
): Promise<VitalSample[]> {
  try {
    const samples = await hk.queryQuantitySamples(
      identifier as never,
      {
        filter,
        limit: 200,
        ascending: false,
        unit: unit as never,
      } as never,
    );

    return (samples ?? []).map((s: any) => ({
      date: toLocalDateKey(new Date(s.startDate)),
      value: Math.round((Number(s.quantity) || 0) * 100) / 100,
    }));
  } catch {
    return [];
  }
}

/** Map our internal activity names onto HealthKit's activity enum names. */
function mapActivityTypeToHealthKit(activityType: string): string {
  const t = activityType.toLowerCase();
  if (t.includes("run")) return "running";
  if (t.includes("walk")) return "walking";
  if (t.includes("cycl") || t.includes("bike")) return "cycling";
  if (t.includes("swim")) return "swimming";
  if (t.includes("yoga")) return "yoga";
  if (t.includes("hiit") || t.includes("interval"))
    return "highIntensityIntervalTraining";
  if (t.includes("cardio")) return "mixedCardio";
  return "traditionalStrengthTraining";
}

export { EMPTY_SNAPSHOT };
