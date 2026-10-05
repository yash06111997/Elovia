import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, Alert, AppState, type AppStateStatus } from "react-native";
import { onDataRestored } from "@/lib/syncEvents";
import { captureAccountStorageSession } from "@/lib/accountSyncStorage";
import { isPlainRecord, runProviderReload } from "@/lib/providerReload";
import { normalizeRunSession, type RunSession } from "@/lib/runSession";
import {
  backendLabel,
  getHealthStatus,
  readHealthSnapshot,
  requestHealthPermissions,
  watchLiveSteps,
  writeWorkoutToHealth,
  type DailyEnergy,
  type HealthStatus,
  type HealthWorkout,
  toLocalDateKey,
  type SleepNight,
  type VitalSample,
} from "@/lib/health";

export interface StepData {
  date: string;
  steps: number;
}

export type { RunSession } from "@/lib/runSession";

type PersistedRunSession = Partial<RunSession> & {
  id?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  distanceKm?: unknown;
  durationMins?: unknown;
  avgPaceMinKm?: unknown;
  elevationGainM?: unknown;
  splits?: unknown;
  route?: unknown;
  caloriesBurned?: unknown;
  durationSec?: unknown;
};

type PersistedStepData = Partial<StepData> & { date?: unknown; steps?: unknown };

/**
 * Retained for the existing profile UI. These now reflect REAL permission
 * state read back from the platform rather than a boolean the app flips
 * itself, which is what the previous implementation did.
 */
export interface HealthSyncStatus {
  appleHealth: boolean;
  googleFit: boolean;
  stepsEnabled: boolean;
  locationEnabled: boolean;
}

export interface HealthData {
  todaySteps: number;
  weeklySteps: StepData[];
  runSessions: RunSession[];
  syncStatus: HealthSyncStatus;
  lastSynced: string | null;
  // Populated from HealthKit / Health Connect when available.
  importedWorkouts: HealthWorkout[];
  sleep: SleepNight[];
  restingHeartRate: VitalSample[];
  heartRateVariability: VitalSample[];
  activeEnergyKcal: DailyEnergy[];
  bodyMassKg: VitalSample[];
}

interface HealthContextType {
  healthData: HealthData;
  /** Real capability + permission state, for rendering honest settings UI. */
  status: HealthStatus | null;
  isSyncing: boolean;
  updateSteps: (steps: number) => void;
  addRunSession: (
    session: Omit<RunSession, "id"> & { id?: string },
  ) => Promise<RunSession>;
  toggleSync: (source: keyof HealthSyncStatus) => void;
  syncHealthData: () => Promise<void>;
  connectHealth: () => Promise<void>;
  backendName: string;
}

const defaultHealthData: HealthData = {
  todaySteps: 0,
  weeklySteps: [],
  runSessions: [],
  syncStatus: {
    appleHealth: false,
    googleFit: false,
    stepsEnabled: false,
    locationEnabled: false,
  },
  lastSynced: null,
  importedWorkouts: [],
  sleep: [],
  restingHeartRate: [],
  heartRateVariability: [],
  activeEnergyKcal: [],
  bodyMassKg: [],
};

const toSafeNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toSafeString = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
};

function sanitizeRoutePoint(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== "object") return null;
  const next = value as { latitude?: unknown; longitude?: unknown };
  const latitude = toSafeNumber(next.latitude, Number.NaN);
  const longitude = toSafeNumber(next.longitude, Number.NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function sanitizeRoutePoints(value: unknown): { latitude: number; longitude: number }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => sanitizeRoutePoint(point))
    .filter((point): point is { latitude: number; longitude: number } => point !== null);
}

function sanitizeSplit(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const split = value as {
    index?: unknown;
    distanceKm?: unknown;
    durationSec?: unknown;
    paceMinPerKm?: unknown;
    elevationGainM?: unknown;
  };

  const index = Math.round(toSafeNumber(split.index, 0));
  if (!Number.isInteger(index) || index <= 0) return null;

  return {
    index,
    distanceKm: Math.max(0, toSafeNumber(split.distanceKm, 0)),
    durationSec: Math.max(0, Math.round(toSafeNumber(split.durationSec, 0))),
    paceMinPerKm: Math.max(0, toSafeNumber(split.paceMinPerKm, 0)),
    elevationGainM: Math.round(Math.max(0, toSafeNumber(split.elevationGainM, 0))),
  };
}

function sanitizeRunSession(raw: unknown): RunSession | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as PersistedRunSession;

  const rawDistance = toSafeNumber(record.distanceKm, 0);
  const rawDuration = toSafeNumber(record.durationMins, 0);
  const durationSec =
    record.durationSec == null || Number.isNaN(toSafeNumber(record.durationSec, Number.NaN))
      ? Math.round(rawDuration * 60)
      : Math.round(toSafeNumber(record.durationSec, 0));

  const distanceKm = Math.max(0, rawDistance);
  const avgPaceMinKm = toSafeNumber(record.avgPaceMinKm, rawDuration > 0 ? durationSec / 60 / Math.max(0.01, distanceKm) : 0);

  return {
    id: toSafeString(record.id, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    date: toSafeString(record.date, new Date().toISOString().split("T")[0]),
    startTime: toSafeString(record.startTime, new Date().toISOString()),
    endTime: toSafeString(record.endTime, new Date().toISOString()),
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMins: Math.max(0, Math.round(rawDuration)),
    durationSec,
    avgPaceMinKm: Math.max(0, Number.parseFloat(avgPaceMinKm.toFixed(2))),
    elevationGainM: Math.round(Math.max(0, toSafeNumber(record.elevationGainM, 0))),
    splits: Array.isArray(record.splits)
      ? record.splits
          .map((split) => sanitizeSplit(split))
          .filter((split): split is NonNullable<ReturnType<typeof sanitizeSplit>> => split !== null)
      : [],
    route: sanitizeRoutePoints(record.route),
    caloriesBurned: Math.max(0, Math.round(toSafeNumber(record.caloriesBurned, 0))),
  };
}

function sanitizeStepData(raw: unknown): StepData[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as PersistedStepData;
      const date = typeof item.date === "string" ? item.date : "";
      const steps = Math.max(0, Math.round(toSafeNumber(item.steps, 0)));
      if (!date) return null;
      return { date, steps };
    })
    .filter((entry): entry is StepData => entry !== null);
}

function sanitizeRunSessions(raw: unknown): RunSession[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => sanitizeRunSession(entry))
    .filter((entry): entry is RunSession => entry !== null)
    .slice(-50);
}

function sanitizeHealthData(raw: unknown): HealthData {
  if (!raw || typeof raw !== "object") {
    return defaultHealthData;
  }

  const record = raw as Record<string, unknown>;
  const rawSyncStatus = record.syncStatus;
  const syncStatus =
    rawSyncStatus != null && typeof rawSyncStatus === "object" ? (rawSyncStatus as Record<string, unknown>) : null;

  return {
    ...defaultHealthData,
    ...record,
    todaySteps: Math.max(0, Math.round(toSafeNumber(record.todaySteps, 0))),
    weeklySteps: sanitizeStepData(record.weeklySteps),
    runSessions: sanitizeRunSessions(record.runSessions),
    lastSynced: typeof record.lastSynced === "string" ? record.lastSynced : null,
    importedWorkouts: Array.isArray(record.importedWorkouts) ? (record.importedWorkouts as HealthWorkout[]) : [],
    sleep: Array.isArray(record.sleep) ? (record.sleep as SleepNight[]) : [],
    restingHeartRate: Array.isArray(record.restingHeartRate) ? (record.restingHeartRate as VitalSample[]) : [],
    heartRateVariability: Array.isArray(record.heartRateVariability) ? (record.heartRateVariability as VitalSample[]) : [],
    activeEnergyKcal: Array.isArray(record.activeEnergyKcal) ? (record.activeEnergyKcal as DailyEnergy[]) : [],
    bodyMassKg: Array.isArray(record.bodyMassKg) ? (record.bodyMassKg as VitalSample[]) : [],
    syncStatus: {
      appleHealth: syncStatus != null && typeof syncStatus.appleHealth === "boolean" ? syncStatus.appleHealth : false,
      googleFit: syncStatus != null && typeof syncStatus.googleFit === "boolean" ? syncStatus.googleFit : false,
      stepsEnabled: syncStatus != null && typeof syncStatus.stepsEnabled === "boolean" ? syncStatus.stepsEnabled : false,
      locationEnabled:
        syncStatus != null && typeof syncStatus.locationEnabled === "boolean" ? syncStatus.locationEnabled : false,
    },
  };
}

const HealthContext = createContext<HealthContextType | null>(null);

const STORAGE_KEY = "@elovia_health_data";

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [healthData, setHealthData] = useState<HealthData>(defaultHealthData);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const liveStepsUnsubRef = useRef<(() => void) | null>(null);
  const syncInFlightRef = useRef(false);
  const healthDataRef = useRef(healthData);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const healthWriteAttemptedRunIdsRef = useRef(new Set<string>());
  const [accountStorage] = useState(captureAccountStorageSession);

  healthDataRef.current = healthData;

  const enqueuePersist = useCallback(
    (data: HealthData): Promise<void> => {
      const operation = persistenceQueueRef.current
        .catch(() => {})
        .then(() => accountStorage.setItem(STORAGE_KEY, JSON.stringify(data)));
      persistenceQueueRef.current = operation.catch(() => {});
      return operation;
    },
    [accountStorage],
  );

  const persist = useCallback(
    (data: HealthData) => {
      void enqueuePersist(data).catch(() => {});
    },
    [enqueuePersist],
  );

  const loadData = useCallback(async () => {
    try {
      await runProviderReload(
        () => setHealthData(defaultHealthData),
        async () => {
          const stored = await accountStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed: unknown = JSON.parse(stored);
            if (!isPlainRecord(parsed)) {
              throw new TypeError("Stored health data is malformed.");
            }
            for (const key of [
              "weeklySteps",
              "runSessions",
              "importedWorkouts",
              "sleep",
              "restingHeartRate",
              "heartRateVariability",
              "activeEnergyKcal",
              "bodyMassKg",
            ]) {
              if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
                throw new TypeError("Stored health data is malformed.");
              }
            }
            // Merge onto defaults so data persisted by older builds, which lacked
            // the sleep/vitals fields, does not yield undefined arrays.
            const restoredHealthData: HealthData = {
              ...defaultHealthData,
              ...(parsed as Partial<HealthData>),
              runSessions: Array.isArray(parsed.runSessions)
                ? parsed.runSessions
                    .map(normalizeRunSession)
                    .filter(
                      (session): session is RunSession => session !== null,
                    )
                    .slice(-50)
                : [],
            };
            setHealthData(restoredHealthData);
            void accountStorage
              .setItem(STORAGE_KEY, JSON.stringify(restoredHealthData))
              .catch(() => {});
          } else setHealthData(defaultHealthData);
        },
      );
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void loadData().catch(() => {});
  }, [loadData]);

  useEffect(() => onDataRestored(() => loadData()), [loadData]);

  /** Pull real capability + permission state from the platform. */
  const refreshStatus = useCallback(async () => {
    try {
      const next = await getHealthStatus();
      setStatus(next);

      setHealthData((prev) => {
        const updated: HealthData = {
          ...prev,
          syncStatus: {
            ...prev.syncStatus,
            appleHealth:
              next.platform?.backend === "healthkit" &&
              next.platform.available &&
              next.platform.authorized,
            googleFit:
              next.platform?.backend === "health_connect" &&
              next.platform.available &&
              next.platform.authorized,
            stepsEnabled: next.hasAnySource,
          },
        };
        return updated;
      });

      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  /**
   * Read everything the platform will give us and fold it into state.
   * Guarded against overlapping runs: the app-foreground handler and a manual
   * pull can easily fire together.
   */
  const syncHealthData = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncing(true);

    try {
      const snapshot = await readHealthSnapshot(7);

      setHealthData((prev) => {
        const updated: HealthData = {
          ...prev,
          todaySteps: snapshot.todaySteps || prev.todaySteps,
          weeklySteps: snapshot.weeklySteps.length
            ? snapshot.weeklySteps
            : prev.weeklySteps,
          importedWorkouts: snapshot.workouts,
          sleep: snapshot.sleep,
          restingHeartRate: snapshot.restingHeartRate,
          heartRateVariability: snapshot.heartRateVariability,
          activeEnergyKcal: snapshot.activeEnergyKcal,
          bodyMassKg: snapshot.bodyMassKg,
          lastSynced: snapshot.syncedAt,
        };
        persist(updated);
        return updated;
      });
    } catch {
      // Never surface a modal here: sync runs automatically on foreground and
      // an alert on every cold start would be intolerable.
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [persist]);

  /** Explicit user action: request permission, then immediately pull data. */
  const connectHealth = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        "Not available on web",
        "Health syncing needs the iOS or Android app.",
      );
      return;
    }

    try {
      const next = await requestHealthPermissions();
      setStatus(next);

      if (next.platform?.requiresDevBuild) {
        Alert.alert(
          `${backendLabel(next.platform.backend)} unavailable`,
          "This build cannot access the system health store. Step tracking still works; install the full app build to sync workouts, sleep, and heart data.",
        );
      } else if (!next.hasAnySource) {
        Alert.alert(
          "Permission needed",
          "Elovia could not access health data. You can grant access later in your device settings.",
        );
      }

      await refreshStatus();
      await syncHealthData();
    } catch (e: any) {
      Alert.alert(
        "Connection failed",
        e?.message ?? "Could not connect to health data.",
      );
    }
  }, [refreshStatus, syncHealthData]);

  /**
   * Kept for the existing settings rows. Health permissions cannot be revoked
   * from inside an app on either platform, so turning a connected source OFF
   * has to send the user to system settings rather than silently pretending.
   */
  const toggleSync = useCallback(
    (source: keyof HealthSyncStatus) => {
      if (source === "locationEnabled") {
        setHealthData((prev) => {
          const updated = {
            ...prev,
            syncStatus: {
              ...prev.syncStatus,
              locationEnabled: !prev.syncStatus.locationEnabled,
            },
          };
          persist(updated);
          return updated;
        });
        return;
      }

      const isConnected =
        source === "appleHealth"
          ? healthData.syncStatus.appleHealth
          : source === "googleFit"
            ? healthData.syncStatus.googleFit
            : healthData.syncStatus.stepsEnabled;

      if (isConnected) {
        Alert.alert(
          "Manage in Settings",
          Platform.OS === "ios"
            ? "To stop sharing health data, open Settings > Health > Data Access & Devices > Elovia."
            : "To stop sharing health data, open the Health Connect app and revoke access for Elovia.",
        );
        return;
      }

      void connectHealth();
    },
    [healthData.syncStatus, connectHealth, persist],
  );

  /** Re-sync whenever the app comes back to the foreground. */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void syncHealthData();
    });
    return () => sub.remove();
  }, [syncHealthData]);

  /** Live step updates while the app is open. */
  useEffect(() => {
    if (!status?.hasAnySource) return;

    liveStepsUnsubRef.current = watchLiveSteps(() => {
      // The delta reported here is session-scoped, so re-read the authoritative
      // daily total rather than accumulating, which would double-count.
      void syncHealthData();
    });

    return () => {
      liveStepsUnsubRef.current?.();
      liveStepsUnsubRef.current = null;
    };
  }, [status?.hasAnySource, syncHealthData]);

  const updateSteps = useCallback(
    (steps: number) => {
      setHealthData((prev) => {
        const today = toLocalDateKey(new Date());
        const weeklySteps = [...prev.weeklySteps];
        const todayIdx = weeklySteps.findIndex((s) => s.date === today);
        if (todayIdx >= 0) weeklySteps[todayIdx] = { date: today, steps };
        else {
          weeklySteps.push({ date: today, steps });
          if (weeklySteps.length > 7) weeklySteps.shift();
        }
        const updated = { ...prev, todaySteps: steps, weeklySteps };
        persist(updated);
        return updated;
      });
    },
    [persist],
  );

  const addRunSession = useCallback(
    async (sessionData: Omit<RunSession, "id"> & { id?: string }) => {
      const session: RunSession = {
        ...sessionData,
        id:
          sessionData.id ??
          `${Date.now()}${Math.random().toString(36).slice(2, 11)}`,
      };
      const previous = healthDataRef.current;
      const updated: HealthData = {
        ...previous,
        runSessions: [
          ...previous.runSessions.filter(
            (candidate) => candidate.id !== session.id,
          ),
          session,
        ].slice(-50),
      };
      healthDataRef.current = updated;
      setHealthData(updated);

      // The screen must not display “saved” until the account-scoped local
      // commit has resolved. The stable run ID makes a retry idempotent.
      await enqueuePersist(updated);
      if (!healthWriteAttemptedRunIdsRef.current.has(session.id)) {
        healthWriteAttemptedRunIdsRef.current.add(session.id);
        void writeWorkoutToHealth({
          id: session.id,
          activityType: "Running",
          start: new Date(session.startTime),
          end: new Date(session.endTime),
          energyKcal: session.caloriesBurned,
          distanceKm: session.distanceKm,
        }).then((written) => {
          if (!written)
            healthWriteAttemptedRunIdsRef.current.delete(session.id);
        });
      }
      return session;
    },
    [enqueuePersist],
  );

  if (!hydrated) return null;

  return (
    <HealthContext.Provider
      value={{
        healthData,
        status,
        isSyncing,
        updateSteps,
        addRunSession,
        toggleSync,
        syncHealthData,
        connectHealth,
        backendName: backendLabel(status?.active.backend ?? "none"),
      }}
    >
      {children}
    </HealthContext.Provider>
  );
}

export function useHealth() {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("useHealth must be used within HealthProvider");
  return ctx;
}
