import { Platform } from "react-native";
import { healthKitProvider } from "./healthkit";
import { healthConnectProvider } from "./healthConnect";
import { pedometerProvider, watchLiveSteps } from "./pedometer";
import {
  EMPTY_SNAPSHOT,
  toLocalDateKey,
  type HealthCapabilities,
  type HealthProvider,
  type HealthSnapshot,
} from "./types";

export * from "./types";
export { watchLiveSteps };

/**
 * The platform's richest provider: HealthKit on iOS, Health Connect on Android.
 * Null on web, where neither exists.
 */
function platformProvider(): HealthProvider | null {
  if (Platform.OS === "ios") return healthKitProvider;
  if (Platform.OS === "android") return healthConnectProvider;
  return null;
}

export interface HealthStatus {
  /** The backend actually serving data right now. */
  active: HealthCapabilities;
  /** The richer backend, when it exists but is not currently usable. */
  platform: HealthCapabilities | null;
  /** Steps are available from somewhere (pedometer counts). */
  hasAnySource: boolean;
}

/**
 * Work out what this device can actually do.
 *
 * Two providers are probed because they degrade independently: a user on iOS
 * without a dev build gets no HealthKit but still gets real pedometer steps,
 * and the UI needs to tell those apart so it can explain WHY something is
 * unavailable rather than showing a switch that does nothing.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const platform = platformProvider();

  const [platformCaps, pedometerCaps] = await Promise.all([
    platform ? platform.getCapabilities() : Promise.resolve(null),
    pedometerProvider.getCapabilities(),
  ]);

  const platformUsable = Boolean(
    platformCaps?.available && platformCaps.authorized,
  );

  return {
    active: platformUsable ? platformCaps! : pedometerCaps,
    platform: platformCaps,
    hasAnySource: platformUsable || pedometerCaps.available,
  };
}

/**
 * Ask for permission on the best available backend, falling back to the
 * pedometer when the platform provider cannot be used.
 *
 * Returns the resulting status so the caller can render the outcome without a
 * second round trip.
 */
export async function requestHealthPermissions(): Promise<HealthStatus> {
  const platform = platformProvider();

  if (platform) {
    const caps = await platform.getCapabilities();
    if (caps.available) {
      await platform.requestPermissions();
    }
  }

  const pedometerCaps = await pedometerProvider.getCapabilities();
  if (pedometerCaps.available && !pedometerCaps.authorized) {
    await pedometerProvider.requestPermissions();
  }

  return getHealthStatus();
}

/**
 * Read a full snapshot, preferring the platform provider and using the
 * pedometer to fill gaps.
 *
 * The merge matters on iOS: HealthKit returns nothing for step days the user
 * has not granted, while CMPedometer still reports them. Taking the larger of
 * the two per day avoids a chart that reads zero on days the user definitely
 * walked.
 */
export async function readHealthSnapshot(days = 7): Promise<HealthSnapshot> {
  const platform = platformProvider();

  const empty = (): Partial<HealthSnapshot> => ({});

  const [platformData, pedometerData] = await Promise.all<
    Partial<HealthSnapshot>
  >([
    platform
      ? platform.readSnapshot(days).catch(empty)
      : Promise.resolve(empty()),
    pedometerProvider.readSnapshot(days).catch(empty),
  ]);

  const merged: HealthSnapshot = {
    ...EMPTY_SNAPSHOT,
    ...pedometerData,
    ...platformData,
    syncedAt: new Date().toISOString(),
  };

  // Per-day step reconciliation across both sources.
  const stepsByDate = new Map<string, number>();
  for (const entry of pedometerData.weeklySteps ?? []) {
    stepsByDate.set(entry.date, entry.steps);
  }
  for (const entry of platformData.weeklySteps ?? []) {
    const existing = stepsByDate.get(entry.date) ?? 0;
    stepsByDate.set(entry.date, Math.max(existing, entry.steps));
  }

  merged.weeklySteps = [...stepsByDate.entries()]
    .map(([date, steps]) => ({ date, steps }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const todayKey = toLocalDateKey(new Date());
  merged.todaySteps = Math.max(
    platformData.todaySteps ?? 0,
    pedometerData.todaySteps ?? 0,
    merged.weeklySteps.find((s) => s.date === todayKey)?.steps ?? 0,
  );

  return merged;
}

/**
 * Push a completed workout back to the platform health store, so Elovia
 * sessions show up in Apple Health / Health Connect alongside everything else.
 *
 * Best-effort: a false return is not an error the user needs to see.
 */
export async function writeWorkoutToHealth(workout: {
  id: string;
  activityType: string;
  start: Date;
  end: Date;
  energyKcal?: number;
  distanceKm?: number;
}): Promise<boolean> {
  const platform = platformProvider();
  if (!platform?.writeWorkout) return false;

  try {
    const caps = await platform.getCapabilities();
    if (!caps.canWriteWorkouts) return false;
    return await platform.writeWorkout(workout);
  } catch {
    return false;
  }
}

/** Human-readable label for the active backend, for settings UI. */
export function backendLabel(backend: HealthCapabilities["backend"]): string {
  switch (backend) {
    case "healthkit":
      return "Apple Health";
    case "health_connect":
      return "Health Connect";
    case "pedometer":
      return Platform.OS === "ios" ? "Motion & Fitness" : "Step Counter";
    default:
      return "Not connected";
  }
}
