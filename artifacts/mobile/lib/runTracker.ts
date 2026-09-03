import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import * as Crypto from "expo-crypto";
import * as KeepAwake from "expo-keep-awake";
import * as Location from "expo-location";

import {
  runStatsFromState,
  type ActiveRunState,
  type RunStats,
  type RunTrackingMode,
} from "./runTrackingEngine";
import {
  changePersistedRunMode,
  clearPersistedRun,
  createAndPersistActiveRun,
  ingestActiveRunLocations,
  pausePersistedRun,
  prepareRunRecovery,
  readActiveRunForOwner,
  reconcileActiveRunOwner,
  resumePersistedRun,
  startBackgroundRunLocation,
  stopAndPauseBackgroundRun,
  stopBackgroundRunLocation,
  subscribeActiveRun,
} from "./runTrackingStore";

export {
  estimateCalories,
  formatDuration,
  formatPace,
  haversineMeters,
  isAcceptableGpsPoint,
  MAX_ACCEPTABLE_ACCURACY_M,
  simplifyRunRoute,
} from "./runTrackingEngine";
export type {
  ActiveRunState,
  RunStats,
  RunStatus,
  RunTrackingMode,
  Split,
  TrackPoint,
} from "./runTrackingEngine";

export type StartRunResult =
  | { started: true; mode: RunTrackingMode }
  | {
      started: false;
      reason: "permission_denied" | "services_disabled" | "storage" | "native";
    };

export interface FinishedRunDraft {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  stats: RunStats;
}

interface UseRunTrackerOptions {
  weightKg: number;
  autoPause: boolean;
  ownerUserId: string | null;
}

const EMPTY_STATS: RunStats = {
  distanceKm: 0,
  durationSec: 0,
  currentPaceMinPerKm: null,
  avgPaceMinPerKm: null,
  elevationGainM: 0,
  calories: 0,
  splits: [],
  points: [],
};

function activateKeepAwake(): void {
  void KeepAwake.activateKeepAwakeAsync("elovia-active-run").catch(() => {});
}

function deactivateKeepAwake(): void {
  try {
    KeepAwake.deactivateKeepAwake("elovia-active-run");
  } catch {
    // Keep-awake is a convenience; recording state remains authoritative.
  }
}

/**
 * Durable activity recorder.
 *
 * Native background batches and the foreground-only permission fallback both
 * write the same AsyncStorage draft. React renders that durable state instead
 * of owning a second, volatile recording implementation.
 */
export function useRunTracker({
  weightKg,
  autoPause,
  ownerUserId,
}: UseRunTrackerOptions) {
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const foregroundSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const startInFlightRef = useRef<Promise<StartRunResult> | null>(null);
  const lifecycleOperationRef = useRef<Promise<void>>(Promise.resolve());
  const lifecycleGenerationRef = useRef(0);
  const foregroundInterruptedRef = useRef(false);
  const foregroundInterruptedAtRef = useRef<number | null>(null);
  const activeRunRef = useRef<ActiveRunState | null>(null);

  activeRunRef.current = activeRun;

  const stopForegroundWatch = useCallback(() => {
    foregroundSubscriptionRef.current?.remove();
    foregroundSubscriptionRef.current = null;
  }, []);

  const startForegroundWatch = useCallback(
    async (sessionId: string): Promise<boolean> => {
      stopForegroundWatch();
      if (Platform.OS === "web") return true;
      try {
        foregroundSubscriptionRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 5,
            timeInterval: 2_000,
          },
          (location) => {
            void ingestActiveRunLocations([location]).catch(() => {
              setRecorderError("Elovia could not save the latest GPS point.");
            });
          },
          (message) => {
            setRecorderError(
              message || "Location updates stopped unexpectedly.",
            );
            stopForegroundWatch();
            void pausePersistedRun(ownerUserId, sessionId)
              .then((paused) => {
                if (paused) setActiveRun(paused);
              })
              .catch(() => {
                setRecorderError(
                  "Location stopped and the run could not be paused safely.",
                );
              });
          },
        );
        return true;
      } catch {
        foregroundSubscriptionRef.current = null;
        return false;
      }
    },
    [ownerUserId, stopForegroundWatch],
  );

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeActiveRun((state) => {
      if (!mounted) return;
      setActiveRun(state?.ownerUserId === ownerUserId ? state : null);
    });

    void prepareRunRecovery(ownerUserId)
      .then(({ state, recovered: wasRecovered }) => {
        if (!mounted) return;
        setActiveRun(state);
        setRecovered(wasRecovered);
      })
      .catch(() => {
        if (mounted)
          setRecorderError("Elovia could not restore the previous run.");
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });

    // TaskManager can run in a separate JS runtime, so an in-memory event is
    // not guaranteed. Poll the tiny draft header while this screen is visible.
    const poll = setInterval(() => {
      void readActiveRunForOwner(ownerUserId)
        .then((next) => {
          if (!mounted) return;
          setActiveRun((current) =>
            current?.revision === next?.revision ? current : next,
          );
        })
        .catch(() => {
          if (mounted)
            setRecorderError("Elovia could not refresh the saved run state.");
        });
    }, 1_500);

    return () => {
      mounted = false;
      clearInterval(poll);
      unsubscribe();
      stopForegroundWatch();
      deactivateKeepAwake();
    };
  }, [ownerUserId, stopForegroundWatch]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;
    const isCurrent = () => lifecycleGenerationRef.current === generation;
    const handleAppState = (nextAppState: AppStateStatus) => {
      lifecycleOperationRef.current = lifecycleOperationRef.current
        .catch(() => {})
        .then(async () => {
          const current = activeRunRef.current;
          if (
            nextAppState !== "active" &&
            current?.status === "recording" &&
            current.trackingMode === "foreground"
          ) {
            foregroundInterruptedRef.current = true;
            foregroundInterruptedAtRef.current ??= Date.now();
            stopForegroundWatch();
            const paused = await pausePersistedRun(
              ownerUserId,
              current.sessionId,
              foregroundInterruptedAtRef.current,
            );
            if (paused && isCurrent()) {
              setActiveRun(paused);
              setRecorderError(
                "Run paused because background location is off. Return to Elovia to resume.",
              );
            }
            return;
          }

          if (nextAppState === "active" && foregroundInterruptedRef.current) {
            let stored = await readActiveRunForOwner(ownerUserId);
            if (!isCurrent()) return;
            if (!stored || stored.trackingMode !== "foreground") {
              foregroundInterruptedRef.current = false;
              foregroundInterruptedAtRef.current = null;
              return;
            }
            if (stored.status === "recording") {
              stored = await pausePersistedRun(
                ownerUserId,
                stored.sessionId,
                foregroundInterruptedAtRef.current ?? stored.lastUpdatedAt,
              );
              if (!isCurrent()) return;
              if (!stored) {
                setRecorderError(
                  "The interrupted run could not be frozen safely.",
                );
                return;
              }
            }
            if (!(await startForegroundWatch(stored.sessionId))) {
              if (!isCurrent()) return;
              setRecorderError("Location updates could not be resumed.");
              return;
            }
            const resumed = await resumePersistedRun(
              ownerUserId,
              stored.sessionId,
              "foreground",
              Date.now(),
            );
            if (!isCurrent()) {
              stopForegroundWatch();
              return;
            }
            if (!resumed) {
              stopForegroundWatch();
              setRecorderError("The paused run could not be resumed safely.");
              return;
            }
            foregroundInterruptedRef.current = false;
            foregroundInterruptedAtRef.current = null;
            setRecorderError(null);
            setActiveRun(resumed);
          }
        })
        .catch(() => {
          if (isCurrent()) {
            setRecorderError(
              "Elovia could not safely update the run after app state changed.",
            );
          }
        });
    };
    const subscription = AppState.addEventListener("change", handleAppState);
    return () => {
      lifecycleGenerationRef.current += 1;
      subscription.remove();
    };
  }, [ownerUserId, startForegroundWatch, stopForegroundWatch]);

  useEffect(() => {
    if (activeRun?.status !== "recording" || activeRun.autoPaused) return;
    const interval = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [activeRun?.autoPaused, activeRun?.status]);

  const performStart = useCallback(async (): Promise<StartRunResult> => {
    setRecorderError(null);
    setRecovered(false);

    if (!(await reconcileActiveRunOwner(ownerUserId))) {
      return { started: false, reason: "storage" };
    }
    if (activeRun) return { started: true, mode: activeRun.trackingMode };

    let mode: RunTrackingMode = "foreground";
    if (Platform.OS !== "web") {
      try {
        const provider = await Location.getProviderStatusAsync();
        if (!provider.locationServicesEnabled) {
          return { started: false, reason: "services_disabled" };
        }
        const foreground = await Location.requestForegroundPermissionsAsync();
        if (foreground.status !== "granted") {
          return { started: false, reason: "permission_denied" };
        }
        let background = await Location.getBackgroundPermissionsAsync();
        if (background.status !== "granted" && background.canAskAgain) {
          background = await Location.requestBackgroundPermissionsAsync();
        }
        mode = background.status === "granted" ? "background" : "foreground";
      } catch {
        return { started: false, reason: "native" };
      }
    }

    const startedAt = Date.now();
    const sessionId = Crypto.randomUUID();
    let state: ActiveRunState;
    try {
      state = await createAndPersistActiveRun({
        sessionId,
        ownerUserId,
        startedAt,
        trackingMode: mode,
        autoPauseEnabled: autoPause,
        weightKg,
      });
    } catch {
      return { started: false, reason: "storage" };
    }

    setActiveRun(state);
    setClockNow(startedAt);
    activateKeepAwake();

    if (mode === "background") {
      const backgroundStart = await startBackgroundRunLocation();
      if (backgroundStart === "active") return { started: true, mode };
      if (
        backgroundStart === "unknown" &&
        !(await stopBackgroundRunLocation())
      ) {
        setRecorderError(
          "Background recorder status could not be verified. Elovia will keep treating this as an active background run so it never starts a second GPS recorder.",
        );
        return { started: true, mode };
      }
      mode = "foreground";
      const changed = await changePersistedRunMode(
        ownerUserId,
        sessionId,
        mode,
      );
      if (changed) setActiveRun(changed);
    }

    if (await startForegroundWatch(sessionId)) {
      return { started: true, mode: "foreground" };
    }

    await clearPersistedRun(ownerUserId, sessionId).catch(() => false);
    setActiveRun(null);
    deactivateKeepAwake();
    return { started: false, reason: "native" };
  }, [activeRun, autoPause, ownerUserId, startForegroundWatch, weightKg]);

  const start = useCallback((): Promise<StartRunResult> => {
    if (startInFlightRef.current) return startInFlightRef.current;
    const operation = performStart().finally(() => {
      startInFlightRef.current = null;
    });
    startInFlightRef.current = operation;
    return operation;
  }, [performStart]);

  const pause = useCallback(async (): Promise<boolean> => {
    if (!activeRun) return false;
    stopForegroundWatch();
    const paused =
      activeRun.trackingMode === "background"
        ? await stopAndPauseBackgroundRun(
            ownerUserId,
            activeRun.sessionId,
            Date.now(),
          )
        : await pausePersistedRun(ownerUserId, activeRun.sessionId, Date.now());
    if (!paused) {
      if (activeRun.trackingMode === "background") {
        setRecorderError(
          "Background GPS could not be stopped cleanly. Try pausing again.",
        );
      }
      return false;
    }
    setActiveRun(paused);
    return true;
  }, [activeRun, ownerUserId, stopForegroundWatch]);

  const resume = useCallback(async (): Promise<boolean> => {
    if (!activeRun || activeRun.status !== "paused") return false;
    setRecorderError(null);
    let mode = activeRun.trackingMode;
    let resumed = await resumePersistedRun(
      ownerUserId,
      activeRun.sessionId,
      mode,
      Date.now(),
    );
    if (!resumed) return false;
    setActiveRun(resumed);
    activateKeepAwake();
    if (mode === "background") {
      const backgroundStart = await startBackgroundRunLocation();
      if (backgroundStart === "active") return true;
      if (
        backgroundStart === "unknown" &&
        !(await stopBackgroundRunLocation())
      ) {
        setRecorderError(
          "Background recorder status could not be verified. Elovia will not start a second GPS recorder.",
        );
        return true;
      }
      mode = "foreground";
      const changed = await changePersistedRunMode(
        ownerUserId,
        activeRun.sessionId,
        mode,
      );
      if (!changed) return false;
      resumed = changed;
      setActiveRun(changed);
    }
    if (
      mode === "foreground" &&
      !(await startForegroundWatch(activeRun.sessionId))
    ) {
      const paused = await pausePersistedRun(ownerUserId, activeRun.sessionId);
      if (paused) setActiveRun(paused);
      setRecorderError("Location updates could not be resumed.");
      return false;
    }
    return true;
  }, [activeRun, ownerUserId, startForegroundWatch]);

  /** Keep the frozen draft until HealthContext confirms its durable write. */
  const stop = useCallback(async (): Promise<FinishedRunDraft | null> => {
    if (!activeRun) return null;
    const endedAt = Date.now();
    stopForegroundWatch();
    const paused =
      activeRun.trackingMode === "background"
        ? await stopAndPauseBackgroundRun(
            ownerUserId,
            activeRun.sessionId,
            endedAt,
          )
        : await pausePersistedRun(ownerUserId, activeRun.sessionId, endedAt);
    deactivateKeepAwake();
    if (!paused) return null;
    setActiveRun(paused);
    return {
      sessionId: paused.sessionId,
      startedAt: paused.startedAt,
      endedAt,
      stats: runStatsFromState(paused, endedAt),
    };
  }, [activeRun, ownerUserId, stopForegroundWatch]);

  const completeSave = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const cleared = await clearPersistedRun(ownerUserId, sessionId);
      if (cleared) {
        setActiveRun(null);
        setRecovered(false);
      }
      return cleared;
    },
    [ownerUserId],
  );

  const reset = useCallback(async (): Promise<boolean> => {
    if (!activeRun) return true;
    stopForegroundWatch();
    const nativeStopped = await stopBackgroundRunLocation();
    if (!nativeStopped) return false;
    const cleared = await clearPersistedRun(ownerUserId, activeRun.sessionId);
    if (cleared) {
      setActiveRun(null);
      setRecovered(false);
      setRecorderError(null);
    }
    deactivateKeepAwake();
    return cleared;
  }, [activeRun, ownerUserId, stopForegroundWatch]);

  const stats = useMemo(
    () => (activeRun ? runStatsFromState(activeRun, clockNow) : EMPTY_STATS),
    [activeRun, clockNow],
  );

  return {
    status: activeRun?.status ?? ("idle" as const),
    stats,
    autoPaused: activeRun?.autoPaused ?? false,
    gpsAccuracy: activeRun?.lastAccuracyM ?? null,
    trackingMode: activeRun?.trackingMode ?? null,
    startedAt: activeRun?.startedAt ?? null,
    recovered,
    recorderError,
    hydrated,
    start,
    pause,
    resume,
    stop,
    completeSave,
    reset,
  };
}
