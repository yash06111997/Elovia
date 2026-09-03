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
  const distanceKm = finiteNonnegative(candidate.distanceKm);
  const storedMinutes = finiteNonnegative(candidate.durationMins);
  const durationSec = Math.round(
    finiteNonnegative(candidate.durationSec, storedMinutes * 60),
  );
  const storedPace = finiteNonnegative(candidate.avgPaceMinKm);
  const avgPaceMinKm =
    storedPace > 0
      ? storedPace
      : distanceKm > 0
        ? durationSec / 60 / distanceKm
        : 0;
  return {
    id: candidate.id,
    date:
      typeof candidate.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
        ? candidate.date
        : localDateKey(Date.parse(candidate.startTime)),
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    distanceKm,
    durationMins:
      durationSec > 0
        ? Math.max(1, Math.round(durationSec / 60))
        : Math.round(storedMinutes),
    durationSec,
    avgPaceMinKm,
    elevationGainM: finiteNonnegative(candidate.elevationGainM),
    splits: normalizeSplits(candidate.splits),
    route: normalizeRoute(candidate.route),
    caloriesBurned: finiteNonnegative(candidate.caloriesBurned),
  };
}
