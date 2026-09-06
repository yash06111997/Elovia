import {
  simplifyRunRoute,
  type RunStats,
  type Split,
} from "./runTrackingEngine";

export interface RunSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  distanceKm: number;
  durationMins: number;
  durationSec: number;
  avgPaceMinKm: number;
  elevationGainM: number;
  splits: Split[];
  route: Array<{ latitude: number; longitude: number }>;
  caloriesBurned: number;
}

const DEFAULT_RUN_WEIGHT_KG = 70;

function distanceKmFromRoute(
  points: readonly { latitude: number; longitude: number }[],
): number {
  if (points.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    const deltaLat = ((point.latitude - previous.latitude) * Math.PI) / 180;
    const deltaLng = ((point.longitude - previous.longitude) * Math.PI) / 180;
    const meanLat = ((point.latitude + previous.latitude) * Math.PI) / 360;
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(meanLat) * Math.cos((previous.latitude * Math.PI) / 180) *
        Math.sin(deltaLng / 2) ** 2;
    const segment = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    meters += segment;
  }
  return meters / 1000;
}

function estimateCaloriesFallback(distanceKm: number, durationSec: number): number {
  if (durationSec <= 0 || distanceKm <= 0) return 0;
  const speedKmh = distanceKm / (durationSec / 3600);
  let met: number;
  if (speedKmh < 4) met = 2.5;
  else if (speedKmh < 6.5) met = 3.5;
  else if (speedKmh < 8) met = 8.3;
  else if (speedKmh < 9.7) met = 9.8;
  else if (speedKmh < 11.3) met = 11;
  else if (speedKmh < 12.9) met = 11.8;
  else met = 12.8;
  return Math.round((met * 3.5 * DEFAULT_RUN_WEIGHT_KG * (durationSec / 60)) / 200);
}

export interface FinishedRunDraftLike {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  stats: RunStats;
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function finiteNonnegative(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeRoute(
  value: unknown,
): Array<{ latitude: number; longitude: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) {
        return null;
      }
      const candidate = point as Record<string, unknown>;
      const latitude = Number(candidate.latitude);
      const longitude = Number(candidate.longitude);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return null;
      }
      return { latitude, longitude };
    })
    .filter(
      (point): point is { latitude: number; longitude: number } =>
        point !== null,
    )
    .slice(0, 1_000);
}

function normalizeSplits(value: unknown): Split[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((split, arrayIndex) => {
      if (!split || typeof split !== "object" || Array.isArray(split)) {
        return null;
      }
      const candidate = split as Record<string, unknown>;
      const distanceKm = finiteNonnegative(candidate.distanceKm);
      const durationSec = finiteNonnegative(candidate.durationSec);
      const paceMinPerKm = finiteNonnegative(
        candidate.paceMinPerKm,
        distanceKm > 0 ? durationSec / 60 / distanceKm : 0,
      );
      return {
        index: Math.max(
          1,
          Math.floor(finiteNonnegative(candidate.index, arrayIndex + 1)),
        ),
        distanceKm,
        durationSec,
        paceMinPerKm,
        elevationGainM: finiteNonnegative(candidate.elevationGainM),
      };
    })
    .filter((split): split is Split => split !== null)
    .slice(0, 1_000);
}

/** Materialize one immutable summary payload from the final recorder state. */
export function createRunSessionFromFinishedDraft(
  draft: FinishedRunDraftLike,
): RunSession {
  const durationSec = Math.max(0, Math.round(draft.stats.durationSec));
  const distanceKm = Math.round(draft.stats.distanceKm * 100) / 100;
  return {
    id: draft.sessionId,
    date: localDateKey(draft.startedAt),
    startTime: new Date(draft.startedAt).toISOString(),
    endTime: new Date(draft.endedAt).toISOString(),
    distanceKm,
    durationMins:
      durationSec > 0 ? Math.max(1, Math.round(durationSec / 60)) : 0,
    durationSec,
    avgPaceMinKm: Math.round((draft.stats.avgPaceMinPerKm ?? 0) * 100) / 100,
    elevationGainM: Math.max(0, Math.round(draft.stats.elevationGainM)),
    splits: normalizeSplits(draft.stats.splits),
    route: simplifyRunRoute(draft.stats.points),
    caloriesBurned: Math.max(0, Math.round(draft.stats.calories)),
  };
}

/**
 * Normalize data written by previous releases before a summary renders. This
 * prevents a legacy session without route/split fields from crashing and
 * preserves all valid metrics that are available.
 */
export function normalizeRunSession(value: unknown): RunSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length < 1 ||
    candidate.id.length > 128 ||
    !validIso(candidate.startTime) ||
    !validIso(candidate.endTime)
    ) {
    return null;
  }

  const route = normalizeRoute(
    candidate.route === undefined ? candidate.points : candidate.route,
  );
  const distanceKm = finiteNonnegative(candidate.distanceKm);
  const fallbackDistanceKm = distanceKmFromRoute(route);
  const storedMinutes = finiteNonnegative(candidate.durationMins);
  const durationSec = Math.round(
    finiteNonnegative(candidate.durationSec, storedMinutes * 60),
  );
  const endTime = String(candidate.endTime);
  const startTime = String(candidate.startTime);
  const derivedDurationFromTimestamps = Math.max(
    0,
    Math.round((Date.parse(endTime) - Date.parse(startTime)) / 1000),
  );
  const finalDistanceKm = distanceKm > 0 ? distanceKm : fallbackDistanceKm;
  const finalDurationSec = durationSec > 0 ? durationSec : derivedDurationFromTimestamps;
  const storedPace = finiteNonnegative(candidate.avgPaceMinKm);
  const avgPaceMinKm =
    storedPace > 0
      ? storedPace
      : finalDistanceKm > 0 && finalDurationSec > 0
        ? finalDurationSec / 60 / finalDistanceKm
        : 0;
  const storedCalories = finiteNonnegative(candidate.caloriesBurned);
  const caloriesBurned =
    storedCalories > 0
      ? storedCalories
      : estimateCaloriesFallback(finalDistanceKm, finalDurationSec);
  return {
    id: candidate.id,
    date:
      typeof candidate.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
        ? candidate.date
        : localDateKey(Date.parse(startTime)),
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    distanceKm: finalDistanceKm,
    durationMins:
      finalDurationSec > 0
        ? Math.max(1, Math.round(finalDurationSec / 60))
        : Math.round(storedMinutes),
    durationSec: finalDurationSec,
    avgPaceMinKm,
    elevationGainM: finiteNonnegative(candidate.elevationGainM),
    splits: normalizeSplits(candidate.splits),
    route,
    caloriesBurned,
  };
}
