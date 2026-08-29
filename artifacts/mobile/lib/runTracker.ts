import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * GPS activity recorder.
 *
 * Handles the parts that separate a usable run tracker from a naive one:
 * accuracy filtering, auto-pause, paused-time exclusion, and per-kilometre
 * splits.
 */

export interface TrackPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Metres of horizontal accuracy reported by the OS. */
  accuracy: number | null;
  speed: number | null;
  timestamp: number;
}

export interface Split {
  /** 1-indexed kilometre (or mile) number. */
  index: number;
  distanceKm: number;
  durationSec: number;
  paceMinPerKm: number;
  elevationGainM: number;
}

export type RunStatus = "idle" | "recording" | "paused" | "finished";

export interface RunStats {
  distanceKm: number;
  /** Seconds actually moving; paused time is excluded. */
  durationSec: number;
  currentPaceMinPerKm: number | null;
  avgPaceMinPerKm: number | null;
  elevationGainM: number;
  calories: number;
  splits: Split[];
  points: TrackPoint[];
}

/**
 * Discard fixes worse than this. Early GPS fixes are routinely 50-100m out and
 * including them adds phantom distance before the user has moved a step - the
 * single most common complaint about amateur run trackers.
 */
const MAX_ACCEPTABLE_ACCURACY_M = 25;

/** Ignore jumps implying faster than ~45 km/h; that is a GPS glitch, not a run. */
const MAX_PLAUSIBLE_SPEED_MPS = 12.5;

/** Below this speed for AUTO_PAUSE_AFTER_MS, assume the user stopped. */
const AUTO_PAUSE_SPEED_MPS = 0.5;
const AUTO_PAUSE_AFTER_MS = 12_000;

export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const R = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function paceFrom(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0.01 || durationSec <= 0) return null;
  return durationSec / 60 / distanceKm;
}

export function formatPace(pace: number | null): string {
  if (pace == null || !Number.isFinite(pace) || pace <= 0) return "--:--";
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  // Guard the 59.6 -> 60 rounding case, which would render as "5:60".
  if (seconds === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * MET-based energy estimate.
 *
 * Running economy scales roughly linearly with pace, so MET is derived from
 * speed rather than assumed. Far better than the flat "8 kcal per minute" the
 * app used previously, which was equally wrong for a walk and a sprint.
 */
export function estimateCalories(
  distanceKm: number,
  durationSec: number,
  weightKg: number,
): number {
  if (durationSec <= 0 || distanceKm <= 0) return 0;

  const speedKmh = distanceKm / (durationSec / 3600);
  let met: number;

  if (speedKmh < 4) met = 2.5;
  else if (speedKmh < 6.5) met = 3.5;
  else if (speedKmh < 8) met = 8.3;
  else if (speedKmh < 9.7) met = 9.8;
  else if (speedKmh < 11.3) met = 11.0;
  else if (speedKmh < 12.9) met = 11.8;
  else if (speedKmh < 14.5) met = 12.8;
  else met = 14.5;

  return Math.round((met * 3.5 * weightKg * (durationSec / 60)) / 200);
}

interface UseRunTrackerOptions {
  weightKg: number;
  autoPause: boolean;
}

export function useRunTracker({ weightKg, autoPause }: UseRunTrackerOptions) {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [elevationGainM, setElevationGainM] = useState(0);
  const [movingMs, setMovingMs] = useState(0);
  const [splits, setSplits] = useState<Split[]>([]);
  const [autoPaused, setAutoPaused] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const lastPointRef = useRef<TrackPoint | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const slowSinceRef = useRef<number | null>(null);
  const splitStartRef = useRef({ distanceM: 0, movingMs: 0, elevation: 0 });
  const statusRef = useRef<RunStatus>("idle");
  const tickAccumulatedRef = useRef(0);

  statusRef.current = status;

  const reset = useCallback(() => {
    setPoints([]);
    setDistanceM(0);
    setElevationGainM(0);
    setMovingMs(0);
    setSplits([]);
    setAutoPaused(false);
    setGpsAccuracy(null);
    lastPointRef.current = null;
    lastTickRef.current = null;
    slowSinceRef.current = null;
    tickAccumulatedRef.current = 0;
    splitStartRef.current = { distanceM: 0, movingMs: 0, elevation: 0 };
  }, []);

  const handleLocation = useCallback(
    (raw: any) => {
      const coords = raw?.coords;
      if (!coords) return;

      const point: TrackPoint = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: typeof coords.altitude === "number" ? coords.altitude : null,
        accuracy: typeof coords.accuracy === "number" ? coords.accuracy : null,
        speed: typeof coords.speed === "number" ? coords.speed : null,
        timestamp: raw.timestamp ?? Date.now(),
      };

      setGpsAccuracy(point.accuracy);

      // Reject low-confidence fixes outright rather than smoothing them in.
      if (point.accuracy != null && point.accuracy > MAX_ACCEPTABLE_ACCURACY_M) return;
      if (statusRef.current !== "recording") return;

      const previous = lastPointRef.current;
      const now = point.timestamp;

      if (!previous) {
        lastPointRef.current = point;
        lastTickRef.current = now;
        setPoints([point]);
        return;
      }

      const elapsedMs = Math.max(0, now - (lastTickRef.current ?? now));
      const segmentM = haversineMeters(previous, point);
      const impliedSpeed = elapsedMs > 0 ? segmentM / (elapsedMs / 1000) : 0;

      // A physically impossible jump is a dropped-fix artefact. Re-anchor
      // without accruing distance.
      if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS) {
        lastPointRef.current = point;
        lastTickRef.current = now;
        return;
      }

      const observedSpeed = point.speed != null && point.speed >= 0 ? point.speed : impliedSpeed;

      if (autoPause) {
        if (observedSpeed < AUTO_PAUSE_SPEED_MPS) {
          slowSinceRef.current ??= now;
          if (now - slowSinceRef.current >= AUTO_PAUSE_AFTER_MS) setAutoPaused(true);
        } else {
          slowSinceRef.current = null;
          setAutoPaused(false);
        }
      }

      const movingNow = !autoPause || observedSpeed >= AUTO_PAUSE_SPEED_MPS;

      if (movingNow) {
        setDistanceM((prev) => {
          const nextDistance = prev + segmentM;

          // Close out a split each whole kilometre.
          const previousKm = Math.floor(prev / 1000);
          const nextKm = Math.floor(nextDistance / 1000);
          if (nextKm > previousKm) {
            setMovingMs((currentMoving) => {
              const start = splitStartRef.current;
              setElevationGainM((currentElevation) => {
                setSplits((prevSplits) => [
                  ...prevSplits,
                  {
                    index: nextKm,
                    distanceKm: 1,
                    durationSec: Math.round((currentMoving - start.movingMs) / 1000),
                    paceMinPerKm:
                      (currentMoving - start.movingMs) / 1000 / 60 /
                      Math.max(0.001, (nextDistance - start.distanceM) / 1000),
                    elevationGainM: Math.round(currentElevation - start.elevation),
                  },
                ]);
                splitStartRef.current = {
                  distanceM: nextDistance,
                  movingMs: currentMoving,
                  elevation: currentElevation,
                };
                return currentElevation;
              });
              return currentMoving;
            });
          }

          return nextDistance;
        });

        // Only count ascent, and only when both altitudes look trustworthy.
        if (
          previous.altitude != null &&
          point.altitude != null &&
          point.altitude > previous.altitude
        ) {
          const gain = point.altitude - previous.altitude;
          // Sub-metre changes are noise in consumer GPS altitude.
          if (gain >= 1 && gain < 30) setElevationGainM((prev) => prev + gain);
        }
      }

      setPoints((prev) => [...prev, point]);
      lastPointRef.current = point;
      lastTickRef.current = now;
    },
    [autoPause],
  );

  const start = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") {
      reset();
      setStatus("recording");
      return true;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Location = require("expo-location") as typeof import("expo-location");

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return false;

      reset();
      setStatus("recording");

      // Keep the screen on: a run tracker that stops updating when the display
      // sleeps is worse than useless.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const KeepAwake = require("expo-keep-awake");
        KeepAwake.activateKeepAwakeAsync?.();
      } catch {
        // Optional.
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 2000,
        },
        handleLocation,
      );

      subscriptionRef.current = subscription;
      return true;
    } catch {
      setStatus("idle");
      return false;
    }
  }, [handleLocation, reset]);

  const pause = useCallback(() => {
    setStatus("paused");
    slowSinceRef.current = null;
  }, []);

  const resume = useCallback(() => {
    // Drop the stale anchor so the paused interval does not register as one
    // enormous segment the moment recording resumes.
    lastPointRef.current = null;
    lastTickRef.current = null;
    setStatus("recording");
  }, []);

  const stop = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setStatus("finished");

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const KeepAwake = require("expo-keep-awake");
      KeepAwake.deactivateKeepAwake?.();
    } catch {
      // Optional.
    }
  }, []);

  /**
   * Elapsed-time tick.
   *
   * Kept separate from the location stream so the clock advances smoothly even
   * when GPS fixes are sparse, and stops immediately on pause rather than
   * waiting for the next fix that never comes.
   */
  useEffect(() => {
    if (status !== "recording" || autoPaused) return;

    const startedAt = Date.now();
    const interval = setInterval(() => {
      const delta = Date.now() - startedAt;
      setMovingMs((prev) => prev + Math.min(1000, delta - (tickAccumulatedRef.current ?? 0)));
      tickAccumulatedRef.current = delta;
    }, 1000);

    return () => {
      clearInterval(interval);
      tickAccumulatedRef.current = 0;
    };
  }, [status, autoPaused]);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("expo-keep-awake").deactivateKeepAwake?.();
      } catch {
        // Optional.
      }
    };
  }, []);

  const stats: RunStats = useMemo(() => {
    const distanceKm = distanceM / 1000;
    const durationSec = movingMs / 1000;

    // Current pace from the trailing window, so it responds to the last minute
    // rather than being dragged by the whole run.
    const recent = points.slice(-12);
    let currentPace: number | null = null;
    if (recent.length >= 2) {
      let recentM = 0;
      for (let i = 1; i < recent.length; i++) {
        recentM += haversineMeters(recent[i - 1], recent[i]);
      }
      const recentSec = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000;
      currentPace = paceFrom(recentM / 1000, recentSec);
    }

    return {
      distanceKm,
      durationSec,
      currentPaceMinPerKm: currentPace,
      avgPaceMinPerKm: paceFrom(distanceKm, durationSec),
      elevationGainM: Math.round(elevationGainM),
      calories: estimateCalories(distanceKm, durationSec, weightKg),
      splits,
      points,
    };
  }, [distanceM, movingMs, points, elevationGainM, splits, weightKg]);

  return {
    status,
    stats,
    autoPaused,
    gpsAccuracy,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
