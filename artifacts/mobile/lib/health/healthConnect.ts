import {
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
 * Android Health Connect provider.
 *
 * Same lazy-load discipline as the HealthKit provider: the native module is
 * absent in Expo Go and on web, and a top-level import would take the whole
 * app down at startup.
 *
 * Health Connect additionally requires the Health Connect app itself to be
 * installed (it ships with Android 14+, and is a Play Store app below that),
 * which is why `getSdkStatus` is checked separately from permissions.
 */

type HealthConnectModule = typeof import("react-native-health-connect");

let cachedModule: HealthConnectModule | null = null;
let loadAttempted = false;
let initialized = false;

function loadHealthConnect(): HealthConnectModule | null {
  if (loadAttempted) return cachedModule;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule =
      require("react-native-health-connect") as HealthConnectModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/** SdkAvailabilityStatus.SDK_AVAILABLE */
const SDK_AVAILABLE = 3;

const PERMISSIONS = [
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "ActiveCaloriesBurned" },
  { accessType: "read", recordType: "TotalCaloriesBurned" },
  { accessType: "read", recordType: "Distance" },
  { accessType: "read", recordType: "ExerciseSession" },
  { accessType: "read", recordType: "SleepSession" },
  { accessType: "read", recordType: "RestingHeartRate" },
  { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
  { accessType: "read", recordType: "Weight" },
  { accessType: "write", recordType: "ExerciseSession" },
  { accessType: "write", recordType: "ActiveCaloriesBurned" },
] as const;

function unavailable(requiresDevBuild: boolean): HealthCapabilities {
  return {
    backend: "health_connect",
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

async function ensureInitialized(hc: HealthConnectModule): Promise<boolean> {
  if (initialized) return true;
  try {
    initialized = await hc.initialize();
    return initialized;
  } catch {
    return false;
  }
}

export const healthConnectProvider: HealthProvider = {
  backend: "health_connect",

  async getCapabilities(): Promise<HealthCapabilities> {
    const hc = loadHealthConnect();
    if (!hc) return unavailable(true);

    try {
      const status = await hc.getSdkStatus();
      if (status !== SDK_AVAILABLE) return unavailable(false);

      if (!(await ensureInitialized(hc))) return unavailable(false);

      const granted = await hc.getGrantedPermissions();
      const has = (recordType: string, accessType = "read") =>
        granted.some(
          (p: any) =>
            p?.recordType === recordType && p?.accessType === accessType,
        );

      return {
        backend: "health_connect",
        available: true,
        authorized: granted.length > 0,
        canReadSteps: has("Steps"),
        canReadWorkouts: has("ExerciseSession"),
        canReadSleep: has("SleepSession"),
        canReadVitals:
          has("RestingHeartRate") || has("HeartRateVariabilityRmssd"),
        canWriteWorkouts: has("ExerciseSession", "write"),
        requiresDevBuild: false,
      };
    } catch {
      return unavailable(false);
    }
  },

  async requestPermissions(): Promise<boolean> {
    const hc = loadHealthConnect();
    if (!hc) return false;
    try {
      if (!(await ensureInitialized(hc))) return false;
      const granted = await hc.requestPermission(PERMISSIONS as never);
      return Array.isArray(granted) && granted.length > 0;
    } catch {
      return false;
    }
  },

  async readSnapshot(days: number): Promise<Partial<HealthSnapshot>> {
    const hc = loadHealthConnect();
    if (!hc) return {};
    if (!(await ensureInitialized(hc))) return {};

    const start = daysAgo(days - 1);
    const end = new Date();
    const timeRangeFilter = {
      operator: "between" as const,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    };

    const [steps, energy, workouts, sleep, restingHr, hrv, weight] =
      await Promise.all([
        aggregateDaily(
          hc,
          "Steps",
          timeRangeFilter,
          (r: any) => Number(r?.result?.COUNT_TOTAL) || 0,
        ),
        aggregateDaily(
          hc,
          "ActiveCaloriesBurned",
          timeRangeFilter,
          (r: any) =>
            Number(r?.result?.ACTIVE_CALORIES_TOTAL?.inKilocalories) || 0,
        ),
        readWorkouts(hc, timeRangeFilter),
        readSleep(hc, timeRangeFilter),
        readVitals(
          hc,
          "RestingHeartRate",
          timeRangeFilter,
          (r: any) => Number(r?.beatsPerMinute) || 0,
        ),
        readVitals(
          hc,
          "HeartRateVariabilityRmssd",
          timeRangeFilter,
          (r: any) => Number(r?.heartRateVariabilityMillis) || 0,
        ),
        readVitals(
          hc,
          "Weight",
          timeRangeFilter,
          (r: any) => Number(r?.weight?.inKilograms) || 0,
        ),
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
    const hc = loadHealthConnect();
    if (!hc) return false;
    try {
      if (!(await ensureInitialized(hc))) return false;
      await hc.insertRecords([
        {
          recordType: "ExerciseSession",
          startTime: workout.start.toISOString(),
          endTime: workout.end.toISOString(),
          exerciseType: mapActivityTypeToHealthConnect(workout.activityType),
          title: workout.activityType,
          metadata: {
            clientRecordId: workout.id,
            clientRecordVersion: 1,
            recordingMethod: 1,
          },
        },
      ] as never);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Daily aggregation. Health Connect can bucket by calendar period natively,
 * which avoids pulling every raw sample across the window.
 */
async function aggregateDaily(
  hc: HealthConnectModule,
  recordType: string,
  timeRangeFilter: any,
  extract: (row: any) => number,
): Promise<{ date: string; value: number }[]> {
  try {
    const results = await hc.aggregateGroupByPeriod({
      recordType: recordType as never,
      timeRangeFilter,
      timeRangeSlicer: { period: "DAYS", length: 1 },
    } as never);

    return (results ?? [])
      .map((r: any) => {
        const startTime = r?.startTime;
        if (!startTime) return null;
        return { date: toLocalDateKey(new Date(startTime)), value: extract(r) };
      })
      .filter((r): r is { date: string; value: number } => r !== null);
  } catch {
    return [];
  }
}

async function readWorkouts(
  hc: HealthConnectModule,
  timeRangeFilter: any,
): Promise<HealthWorkout[]> {
  try {
    const res = await hc.readRecords(
      "ExerciseSession" as never,
      {
        timeRangeFilter,
        ascendingOrder: false,
        pageSize: 100,
      } as never,
    );

    return ((res as any)?.records ?? []).map((w: any) => {
      const start = new Date(w.startTime);
      const end = new Date(w.endTime);
      return {
        id: String(w?.metadata?.id ?? `${w.startTime}-${w.exerciseType}`),
        activityType: String(w.title ?? exerciseTypeName(w.exerciseType)),
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        durationMins: Math.max(
          0,
          Math.round((end.getTime() - start.getTime()) / 60000),
        ),
        energyKcal: null,
        distanceKm: null,
        source: w?.metadata?.dataOrigin ?? null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Health Connect returns one SleepSession per night containing typed stages.
 * Stage type 1 is "awake" and is excluded from asleep time; the session's own
 * span is used for time in bed.
 */
async function readSleep(
  hc: HealthConnectModule,
  timeRangeFilter: any,
): Promise<SleepNight[]> {
  try {
    const res = await hc.readRecords(
      "SleepSession" as never,
      {
        timeRangeFilter,
        ascendingOrder: false,
        pageSize: 100,
      } as never,
    );

    return ((res as any)?.records ?? []).map((s: any) => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      const inBedMins = Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 60000),
      );

      let asleepMins = 0;
      if (Array.isArray(s.stages) && s.stages.length > 0) {
        for (const stage of s.stages) {
          if (Number(stage?.stage) === 1) continue; // awake
          const sStart = new Date(stage.startTime).getTime();
          const sEnd = new Date(stage.endTime).getTime();
          asleepMins += Math.max(0, (sEnd - sStart) / 60000);
        }
        asleepMins = Math.round(asleepMins);
      } else {
        asleepMins = inBedMins;
      }

      return { date: toLocalDateKey(end), asleepMins, inBedMins };
    });
  } catch {
    return [];
  }
}

async function readVitals(
  hc: HealthConnectModule,
  recordType: string,
  timeRangeFilter: any,
  extract: (row: any) => number,
): Promise<VitalSample[]> {
  try {
    const res = await hc.readRecords(
      recordType as never,
      {
        timeRangeFilter,
        ascendingOrder: false,
        pageSize: 200,
      } as never,
    );

    return ((res as any)?.records ?? [])
      .map((r: any) => ({
        date: toLocalDateKey(new Date(r.time ?? r.startTime)),
        value: Math.round(extract(r) * 100) / 100,
      }))
      .filter((r: VitalSample) => r.value > 0);
  } catch {
    return [];
  }
}

/** Health Connect exercise type enum values. */
function mapActivityTypeToHealthConnect(activityType: string): number {
  const t = activityType.toLowerCase();
  if (t.includes("run")) return 56;
  if (t.includes("walk")) return 79;
  if (t.includes("cycl") || t.includes("bike")) return 8;
  if (t.includes("swim")) return 74;
  if (t.includes("yoga")) return 83;
  if (t.includes("hiit") || t.includes("interval")) return 25;
  return 80; // strength training
}

function exerciseTypeName(exerciseType: number): string {
  switch (exerciseType) {
    case 56:
      return "Running";
    case 79:
      return "Walking";
    case 8:
      return "Cycling";
    case 74:
      return "Swimming";
    case 83:
      return "Yoga";
    case 25:
      return "HIIT";
    case 80:
      return "Strength Training";
    default:
      return "Workout";
  }
}
