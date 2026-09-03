/**
 * Platform-neutral health types.
 *
 * HealthKit and Health Connect model the same concepts with different names,
 * units, and shapes. Everything above this layer speaks only these types, so
 * screens never branch on platform.
 */

export type HealthBackend =
  | "healthkit"
  | "health_connect"
  | "pedometer"
  | "none";

export interface DailySteps {
  /** YYYY-MM-DD, local time. */
  date: string;
  steps: number;
}

export interface HealthWorkout {
  id: string;
  /** Normalised activity name, e.g. "Running", "Traditional Strength Training". */
  activityType: string;
  startISO: string;
  endISO: string;
  durationMins: number;
  energyKcal: number | null;
  distanceKm: number | null;
  /** App or device that recorded it, so we can avoid double-counting our own. */
  source: string | null;
}

export interface SleepNight {
  /** The date the night is attributed to (the morning of waking). */
  date: string;
  asleepMins: number;
  inBedMins: number;
}

export interface VitalSample {
  date: string;
  value: number;
}

export interface HealthSnapshot {
  todaySteps: number;
  weeklySteps: DailySteps[];
  workouts: HealthWorkout[];
  sleep: SleepNight[];
  restingHeartRate: VitalSample[];
  heartRateVariability: VitalSample[];
  activeEnergyKcal: DailyEnergy[];
  bodyMassKg: VitalSample[];
  syncedAt: string;
}

export interface DailyEnergy {
  date: string;
  kcal: number;
}

export interface HealthCapabilities {
  backend: HealthBackend;
  /** The platform can provide health data at all (device + OS support). */
  available: boolean;
  /** The user has actually granted permission. */
  authorized: boolean;
  canReadSteps: boolean;
  canReadWorkouts: boolean;
  canReadSleep: boolean;
  canReadVitals: boolean;
  canWriteWorkouts: boolean;
  /**
   * Set when the backend exists on this platform but the native module is not
   * present in the running binary - i.e. Expo Go. Used to tell the user they
   * need the full app build rather than showing a dead toggle.
   */
  requiresDevBuild: boolean;
}

export const EMPTY_SNAPSHOT: HealthSnapshot = {
  todaySteps: 0,
  weeklySteps: [],
  workouts: [],
  sleep: [],
  restingHeartRate: [],
  heartRateVariability: [],
  activeEnergyKcal: [],
  bodyMassKg: [],
  syncedAt: new Date(0).toISOString(),
};

/** Local YYYY-MM-DD. Deliberately local, not UTC: a user's "today" is local. */
export function toLocalDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function daysAgo(n: number): Date {
  return startOfDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

/**
 * A health provider for one platform. Every method must resolve rather than
 * throw on permission denial, so a partially-authorized user still gets the
 * data they did grant.
 */
export interface HealthProvider {
  readonly backend: HealthBackend;
  getCapabilities(): Promise<HealthCapabilities>;
  requestPermissions(): Promise<boolean>;
  readSnapshot(days: number): Promise<Partial<HealthSnapshot>>;
  writeWorkout?(workout: {
    /** Stable app-owned ID used to make platform writes idempotent. */
    id: string;
    activityType: string;
    start: Date;
    end: Date;
    energyKcal?: number;
    distanceKm?: number;
  }): Promise<boolean>;
}
