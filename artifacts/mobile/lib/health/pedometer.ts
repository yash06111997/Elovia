import { Platform } from "react-native";
import {
  daysAgo,
  startOfDay,
  toLocalDateKey,
  type DailySteps,
  type HealthCapabilities,
  type HealthProvider,
  type HealthSnapshot,
} from "./types";

/**
 * Pedometer fallback via expo-sensors.
 *
 * This is the baseline that works WITHOUT a custom native build - including in
 * Expo Go - on both iOS (CMPedometer) and Android (step counter sensor). It
 * only provides step counts, but that is the single number the dashboard leans
 * on hardest, so having it real from day one matters more than having every
 * metric behind a build the user has not cut yet.
 *
 * iOS keeps roughly 7 days of pedometer history, which is exactly the window
 * the weekly chart needs. Android's `getStepCountAsync` is not implemented for
 * historical ranges, so there we only report live-session steps and let
 * Health Connect cover history when it is available.
 */

type PedometerModule = typeof import("expo-sensors").Pedometer;

let cachedPedometer: PedometerModule | null = null;
let loadAttempted = false;

function loadPedometer(): PedometerModule | null {
  if (loadAttempted) return cachedPedometer;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sensors = require("expo-sensors") as typeof import("expo-sensors");
    cachedPedometer = sensors.Pedometer;
  } catch {
    cachedPedometer = null;
  }
  return cachedPedometer;
}

const HISTORY_SUPPORTED = Platform.OS === "ios";

export const pedometerProvider: HealthProvider = {
  backend: "pedometer",

  async getCapabilities(): Promise<HealthCapabilities> {
    const pedometer = loadPedometer();
    const base: HealthCapabilities = {
      backend: "pedometer",
      available: false,
      authorized: false,
      canReadSteps: false,
      canReadWorkouts: false,
      canReadSleep: false,
      canReadVitals: false,
      canWriteWorkouts: false,
      requiresDevBuild: false,
    };

    if (!pedometer || Platform.OS === "web") return base;

    try {
      const available = await pedometer.isAvailableAsync();
      if (!available) return base;

      let authorized = true;
      try {
        const perms = await pedometer.getPermissionsAsync();
        authorized = perms?.granted ?? true;
      } catch {
        // Android does not gate the step counter behind this permission check
        // on every OS version; treat an unavailable check as "not blocked".
      }

      return { ...base, available: true, authorized, canReadSteps: true };
    } catch {
      return base;
    }
  },

  async requestPermissions(): Promise<boolean> {
    const pedometer = loadPedometer();
    if (!pedometer) return false;
    try {
      const result = await pedometer.requestPermissionsAsync();
      return result?.granted ?? false;
    } catch {
      return false;
    }
  },

  async readSnapshot(days: number): Promise<Partial<HealthSnapshot>> {
    const pedometer = loadPedometer();
    if (!pedometer) return {};

    const today = startOfDay(new Date());
    const todayKey = toLocalDateKey(today);

    if (!HISTORY_SUPPORTED) {
      // Android: only today, counted from midnight.
      try {
        const result = await pedometer.getStepCountAsync(today, new Date());
        const steps = Number(result?.steps) || 0;
        return {
          todaySteps: steps,
          weeklySteps: [{ date: todayKey, steps }],
          syncedAt: new Date().toISOString(),
        };
      } catch {
        return {};
      }
    }

    // iOS: walk back day by day. Each call is independent so one failure does
    // not lose the rest of the week.
    const window = Math.min(days, 7);
    const weeklySteps: DailySteps[] = [];

    for (let i = window - 1; i >= 0; i--) {
      const dayStart = daysAgo(i);
      const dayEnd = i === 0 ? new Date() : new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      try {
        const result = await pedometer.getStepCountAsync(dayStart, dayEnd);
        weeklySteps.push({
          date: toLocalDateKey(dayStart),
          steps: Number(result?.steps) || 0,
        });
      } catch {
        // Skip days the OS refuses rather than aborting the whole read.
      }
    }

    return {
      todaySteps: weeklySteps.find((s) => s.date === todayKey)?.steps ?? 0,
      weeklySteps,
      syncedAt: new Date().toISOString(),
    };
  },
};

/**
 * Live step subscription for the current session. Returns an unsubscribe
 * function, or null when unavailable.
 */
export function watchLiveSteps(onUpdate: (steps: number) => void): (() => void) | null {
  const pedometer = loadPedometer();
  if (!pedometer || Platform.OS === "web") return null;
  try {
    const subscription = pedometer.watchStepCount((result) => {
      onUpdate(Number(result?.steps) || 0);
    });
    return () => {
      try {
        subscription.remove();
      } catch {
        // Already torn down.
      }
    };
  } catch {
    return null;
  }
}
