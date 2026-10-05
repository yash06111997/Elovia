/**
 * Pure, versioned run-recording engine.
 *
 * Both the foreground UI and Expo's headless location task use this reducer.
 * Keeping the maths here prevents the two runtimes from disagreeing about
 * distance, elapsed time, pauses, or splits.
 */

export interface TrackPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Metres of horizontal accuracy reported by the OS. */
  accuracy: number | null;
  /** Metres of vertical accuracy reported by the OS. */
  altitudeAccuracy: number | null;
  /** Metres per second reported by the OS. */
  speed: number | null;
  timestamp: number;
}

export interface Split {
  /** 1-indexed kilometre number. */
  index: number;
  distanceKm: number;
  durationSec: number;
  paceMinPerKm: number;
  elevationGainM: number;
}

export type RunStatus = "idle" | "recording" | "paused" | "finished";
export type RunTrackingMode = "background" | "foreground";

export interface RunStats {
  distanceKm: number;
  /** Seconds actually moving; manual and automatic pauses are excluded. */
  durationSec: number;
  currentPaceMinPerKm: number | null;
  avgPaceMinPerKm: number | null;
  elevationGainM: number;
  calories: number;
  splits: Split[];
  points: TrackPoint[];
}

export interface ActiveRunState {
  version: 1;
  revision: number;
  sessionId: string;
  ownerUserId: string | null;
  startedAt: number;
  status: Extract<RunStatus, "recording" | "paused">;
  trackingMode: RunTrackingMode;
  autoPauseEnabled: boolean;
  autoPaused: boolean;
  weightKg: number;
  accumulatedMovingMs: number;
  timerStartedAt: number | null;
  distanceM: number;
  elevationGainM: number;
  points: TrackPoint[];
  splits: Split[];
  lastPoint: TrackPoint | null;
  lastAccuracyM: number | null;
  slowSince: number | null;
  splitStart: {
    distanceM: number;
    movingMs: number;
    elevationM: number;
  };
  lastUpdatedAt: number;
}

export const RUN_ENGINE_VERSION = 1;
export const MAX_ACCEPTABLE_ACCURACY_M = 50;
export const MAX_ACCEPTABLE_ALTITUDE_ACCURACY_M = 30;
export const MAX_ACTIVE_RUN_MS = 24 * 60 * 60 * 1000;
export const MAX_TRACK_POINTS = 5_000;

/** Ignore jumps implying faster than ~45 km/h; that is a GPS glitch, not a run. */
const MAX_PLAUSIBLE_SPEED_MPS = 12.5;
/** Below this speed for twelve seconds, assume the user stopped. */
const AUTO_PAUSE_SPEED_MPS = 0.5;
const AUTO_PAUSE_AFTER_MS = 12_000;
/** Displacements smaller than the reported uncertainty are treated as jitter. */
const MIN_MEANINGFUL_SEGMENT_M = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

export function isAcceptableGpsPoint(point: TrackPoint): boolean {
  return (
    isFiniteNumber(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    isFiniteNumber(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    isFiniteNumber(point.timestamp) &&
    point.timestamp > 0 &&
    (point.accuracy === null ||
      (isFiniteNumber(point.accuracy) &&
        point.accuracy >= 0 &&
        point.accuracy <= MAX_ACCEPTABLE_ACCURACY_M))
  );
}

export function locationObjectToTrackPoint(raw: unknown): TrackPoint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const coords = value.coords;
  if (!coords || typeof coords !== "object" || Array.isArray(coords))
    return null;
  const coordinate = coords as Record<string, unknown>;
  const point: TrackPoint = {
    latitude: Number(coordinate.latitude),
    longitude: Number(coordinate.longitude),
    altitude: isFiniteNumber(coordinate.altitude) ? coordinate.altitude : null,
    accuracy: isFiniteNumber(coordinate.accuracy) ? coordinate.accuracy : null,
    altitudeAccuracy: isFiniteNumber(coordinate.altitudeAccuracy)
      ? coordinate.altitudeAccuracy
      : null,
    speed: isFiniteNumber(coordinate.speed) ? coordinate.speed : null,
    timestamp: isFiniteNumber(value.timestamp) ? value.timestamp : Date.now(),
  };
  return isFiniteNumber(point.latitude) && isFiniteNumber(point.longitude)
    ? point
    : null;
}

export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const earthRadiusM = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

function paceFrom(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0.01 || durationSec <= 0) return null;
  return durationSec / 60 / distanceKm;
}

export function formatPace(pace: number | null): string {
  if (pace == null || !Number.isFinite(pace) || pace <= 0) return "--:--";
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  if (seconds === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDuration(totalSeconds: number): string {
  const value = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Pace-sensitive MET estimate, bounded to a plausible body weight. */
export function estimateCalories(
  distanceKm: number,
  durationSec: number,
  weightKg: number,
): number {
  if (durationSec <= 0 || distanceKm <= 0) return 0;
  const boundedWeightKg = Math.max(25, Math.min(350, weightKg));
  const speedKmh = distanceKm / (durationSec / 3600);
  let met: number;
  if (speedKmh < 4) met = 2.5;
  else if (speedKmh < 6.5) met = 3.5;
  else if (speedKmh < 8) met = 8.3;
  else if (speedKmh < 9.7) met = 9.8;
  else if (speedKmh < 11.3) met = 11;
  else if (speedKmh < 12.9) met = 11.8;
  else if (speedKmh < 14.5) met = 12.8;
  else met = 14.5;
  return Math.round((met * 3.5 * boundedWeightKg * (durationSec / 60)) / 200);
}

export function createActiveRunState(options: {
  sessionId: string;
  ownerUserId: string | null;
  startedAt: number;
  trackingMode: RunTrackingMode;
  autoPauseEnabled: boolean;
  weightKg: number;
}): ActiveRunState {
  const startedAt = Math.max(1, Math.floor(options.startedAt));
  return {
    version: RUN_ENGINE_VERSION,
    revision: 1,
    sessionId: options.sessionId,
    ownerUserId: options.ownerUserId,
    startedAt,
    status: "recording",
    trackingMode: options.trackingMode,
    autoPauseEnabled: options.autoPauseEnabled,
    autoPaused: false,
    weightKg: Math.max(25, Math.min(350, options.weightKg)),
    accumulatedMovingMs: 0,
    timerStartedAt: startedAt,
    distanceM: 0,
    elevationGainM: 0,
    points: [],
    splits: [],
    lastPoint: null,
    lastAccuracyM: null,
    slowSince: null,
    splitStart: { distanceM: 0, movingMs: 0, elevationM: 0 },
    lastUpdatedAt: startedAt,
  };
}

function boundedRunTimestamp(state: ActiveRunState, timestamp: number): number {
  return Math.max(
    state.startedAt,
    Math.min(timestamp, state.startedAt + MAX_ACTIVE_RUN_MS),
  );
}

export function elapsedMovingMs(
  state: ActiveRunState,
  timestamp = Date.now(),
): number {
  if (
    state.status !== "recording" ||
    state.autoPaused ||
    state.timerStartedAt === null
  ) {
    return state.accumulatedMovingMs;
  }
  const now = boundedRunTimestamp(state, timestamp);
  return state.accumulatedMovingMs + Math.max(0, now - state.timerStartedAt);
}

function closeTimer(state: ActiveRunState, timestamp: number): ActiveRunState {
  return {
    ...state,
    accumulatedMovingMs: elapsedMovingMs(state, timestamp),
    timerStartedAt: null,
  };
}

export function pauseActiveRun(
  state: ActiveRunState,
  timestamp = Date.now(),
): ActiveRunState {
  const paused = closeTimer(state, timestamp);
  return {
    ...paused,
    revision: state.revision + 1,
    status: "paused",
    autoPaused: false,
    slowSince: null,
    lastPoint: null,
    lastUpdatedAt: boundedRunTimestamp(state, timestamp),
  };
}

export function resumeActiveRun(
  state: ActiveRunState,
  timestamp = Date.now(),
  trackingMode = state.trackingMode,
): ActiveRunState {
  const now = boundedRunTimestamp(state, timestamp);
  return {
    ...state,
    revision: state.revision + 1,
    status: "recording",
    trackingMode,
    autoPaused: false,
    slowSince: null,
    lastPoint: null,
    timerStartedAt: now,
    lastUpdatedAt: now,
  };
}

export function changeActiveRunMode(
  state: ActiveRunState,
  trackingMode: RunTrackingMode,
): ActiveRunState {
  return {
    ...state,
    revision: state.revision + 1,
    trackingMode,
  };
}

function meaningfulSegmentMeters(
  previous: TrackPoint,
  point: TrackPoint,
  rawDistanceM: number,
): number {
  const uncertaintyM = Math.max(previous.accuracy ?? 0, point.accuracy ?? 0);
  const noiseFloorM = Math.max(MIN_MEANINGFUL_SEGMENT_M, uncertaintyM * 0.12);
  return rawDistanceM >= noiseFloorM ? rawDistanceM : 0;
}

function compactTrackPoints(points: TrackPoint[]): TrackPoint[] {
  let compacted = points;
  while (compacted.length > MAX_TRACK_POINTS) {
    const lastIndex = compacted.length - 1;
    compacted = compacted.filter(
      (_, index) => index === 0 || index === lastIndex || index % 2 === 0,
    );
  }
  return compacted;
}

function maybeAddSplit(
  state: ActiveRunState,
  timestamp: number,
): ActiveRunState {
  const completedKm = Math.floor(state.distanceM / 1000);
  if (completedKm <= state.splits.length) return state;
  const movingMs = elapsedMovingMs(state, timestamp);
  const splits = [...state.splits];
  let start = state.splitStart;
  while (splits.length < completedKm) {
    const boundaryDistanceM = (splits.length + 1) * 1_000;
    const remainingDistanceM = Math.max(
      0.001,
      state.distanceM - start.distanceM,
    );
    const boundaryFraction = Math.min(
      1,
      Math.max(0, (boundaryDistanceM - start.distanceM) / remainingDistanceM),
    );
    const boundaryMovingMs =
      start.movingMs + (movingMs - start.movingMs) * boundaryFraction;
    const boundaryElevationM =
      start.elevationM +
      (state.elevationGainM - start.elevationM) * boundaryFraction;
    const splitDistanceKm = Math.max(
      0.001,
      (boundaryDistanceM - start.distanceM) / 1_000,
    );
    const durationSec = Math.max(
      0,
      (boundaryMovingMs - start.movingMs) / 1_000,
    );
    splits.push({
      index: splits.length + 1,
      distanceKm: Math.round(splitDistanceKm * 1_000) / 1_000,
      durationSec: Math.round(durationSec),
      paceMinPerKm: durationSec / 60 / splitDistanceKm,
      elevationGainM: Math.round(boundaryElevationM - start.elevationM),
    });
    start = {
      distanceM: boundaryDistanceM,
      movingMs: boundaryMovingMs,
      elevationM: boundaryElevationM,
    };
  }
  return {
    ...state,
    splits,
    splitStart: start,
  };
}

export function ingestTrackPoints(
  state: ActiveRunState,
  incoming: readonly TrackPoint[],
): ActiveRunState {
  let next: ActiveRunState = {
    ...state,
    points: [...state.points],
    splits: [...state.splits],
    splitStart: { ...state.splitStart },
  };

  const sorted = [...incoming].sort((a, b) => a.timestamp - b.timestamp);
  for (const point of sorted) {
    next.lastAccuracyM =
      point.accuracy !== null && Number.isFinite(point.accuracy)
        ? point.accuracy
        : null;
    if (!isAcceptableGpsPoint(point)) continue;
    if (point.timestamp > Date.now() + 60_000) continue;
    if (point.timestamp > next.startedAt + MAX_ACTIVE_RUN_MS) continue;
    next.lastUpdatedAt = Math.max(next.lastUpdatedAt, point.timestamp);
    if (next.status !== "recording") continue;

    const previous = next.lastPoint;
    if (!previous) {
      next.lastPoint = point;
      next.points.push(point);
      if (
        next.autoPauseEnabled &&
        point.speed !== null &&
        point.speed >= 0 &&
        point.speed < AUTO_PAUSE_SPEED_MPS
      ) {
        next.slowSince = point.timestamp;
      }
      continue;
    }
    if (point.timestamp <= previous.timestamp) continue;

    const elapsedMs = point.timestamp - previous.timestamp;
    const rawSegmentM = haversineMeters(previous, point);
    const impliedSpeedMps = rawSegmentM / (elapsedMs / 1000);
    if (
      !Number.isFinite(impliedSpeedMps) ||
      impliedSpeedMps > MAX_PLAUSIBLE_SPEED_MPS
    ) {
      next.lastPoint = point;
      continue;
    }

    const reportedSpeedMps =
      point.speed !== null &&
      point.speed >= 0 &&
      point.speed <= MAX_PLAUSIBLE_SPEED_MPS
        ? point.speed
        : null;
    const observedSpeedMps = reportedSpeedMps ?? impliedSpeedMps;

    if (next.autoPauseEnabled) {
      if (observedSpeedMps < AUTO_PAUSE_SPEED_MPS) {
        next.slowSince ??= point.timestamp;
        if (
          !next.autoPaused &&
          point.timestamp - next.slowSince >= AUTO_PAUSE_AFTER_MS
        ) {
          next = {
            // Exclude the whole stationary window, not just time after the
            // twelve-second confidence delay.
            ...closeTimer(next, next.slowSince),
            autoPaused: true,
          };
        }
      } else {
        next.slowSince = null;
        if (next.autoPaused) {
          next.autoPaused = false;
          next.timerStartedAt = point.timestamp;
        }
      }
    } else if (next.autoPaused) {
      next.autoPaused = false;
      next.timerStartedAt = point.timestamp;
      next.slowSince = null;
    }

    const movingNow =
      !next.autoPauseEnabled || observedSpeedMps >= AUTO_PAUSE_SPEED_MPS;
    if (movingNow) {
      const segmentM = meaningfulSegmentMeters(previous, point, rawSegmentM);
      next.distanceM += segmentM;

      const verticalAccuracyOk =
        previous.altitudeAccuracy === null ||
        point.altitudeAccuracy === null ||
        (previous.altitudeAccuracy <= MAX_ACCEPTABLE_ALTITUDE_ACCURACY_M &&
          point.altitudeAccuracy <= MAX_ACCEPTABLE_ALTITUDE_ACCURACY_M);
      if (
        verticalAccuracyOk &&
        previous.altitude !== null &&
        point.altitude !== null &&
        point.altitude > previous.altitude
      ) {
        const gainM = point.altitude - previous.altitude;
        if (gainM >= 1 && gainM < 30) next.elevationGainM += gainM;
      }
      next = maybeAddSplit(next, point.timestamp);
    }

    next.points.push(point);
    if (next.points.length > MAX_TRACK_POINTS) {
      next.points = compactTrackPoints(next.points);
    }
    next.lastPoint = point;
  }

  return { ...next, revision: state.revision + 1 };
}

export function runStatsFromState(
  state: ActiveRunState,
  timestamp = Date.now(),
): RunStats {
  const distanceKm = state.distanceM / 1000;
  const durationSec = elapsedMovingMs(state, timestamp) / 1000;
  const recent = state.points.slice(-12);
  let recentDistanceM = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const point = recent[index];
    const elapsedMs = point.timestamp - previous.timestamp;
    if (elapsedMs <= 0) continue;
    const segmentM = haversineMeters(previous, point);
    if (segmentM / (elapsedMs / 1000) <= MAX_PLAUSIBLE_SPEED_MPS) {
      recentDistanceM += meaningfulSegmentMeters(previous, point, segmentM);
    }
  }
  const recentDurationSec =
    recent.length >= 2
      ? Math.max(
          0,
          (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000,
        )
      : 0;
  return {
    distanceKm,
    durationSec,
    currentPaceMinPerKm: paceFrom(recentDistanceM / 1000, recentDurationSec),
    avgPaceMinPerKm: paceFrom(distanceKm, durationSec),
    elevationGainM: Math.round(state.elevationGainM),
    calories: estimateCalories(distanceKm, durationSec, state.weightKg),
    splits: state.splits,
    points: state.points,
  };
}

/**
 * Keep a route visually faithful without retaining thousands of redundant
 * timestamped fixes in synchronized history. The active recovery draft remains
 * local until the run is safely finalized.
 */
export function simplifyRunRoute(
  points: readonly TrackPoint[],
  maxPoints = 1_000,
): Array<{ latitude: number; longitude: number }> {
  const limit = Math.max(2, Math.floor(maxPoints));
  if (points.length <= limit) {
    return points.map(({ latitude, longitude }) => ({ latitude, longitude }));
  }
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * (points.length - 1)) / (limit - 1));
    const point = points[sourceIndex];
    return { latitude: point.latitude, longitude: point.longitude };
  });
}

export function parseTrackPoint(value: unknown): TrackPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  const candidate: TrackPoint = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    altitude: nullableFiniteNumber(point.altitude) ? point.altitude : null,
    accuracy: nullableFiniteNumber(point.accuracy) ? point.accuracy : null,
    altitudeAccuracy: nullableFiniteNumber(point.altitudeAccuracy)
      ? point.altitudeAccuracy
      : null,
    speed: nullableFiniteNumber(point.speed) ? point.speed : null,
    timestamp: Number(point.timestamp),
  };
  return isAcceptableGpsPoint(candidate) ? candidate : null;
}

function parseSplit(value: unknown): Split | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const split = value as Record<string, unknown>;
  if (
    !isFiniteNumber(split.index) ||
    !isFiniteNumber(split.distanceKm) ||
    !isFiniteNumber(split.durationSec) ||
    !isFiniteNumber(split.paceMinPerKm) ||
    !isFiniteNumber(split.elevationGainM)
  ) {
    return null;
  }
  return {
    index: Math.max(1, Math.floor(split.index)),
    distanceKm: Math.max(0, split.distanceKm),
    durationSec: Math.max(0, split.durationSec),
    paceMinPerKm: Math.max(0, split.paceMinPerKm),
    elevationGainM: Math.max(0, split.elevationGainM),
  };
}

/** Parse untrusted/corrupt AsyncStorage data without reviving impossible runs. */
export function parseActiveRunState(raw: string | null): ActiveRunState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const value = parsed as Record<string, unknown>;
    if (
      value.version !== RUN_ENGINE_VERSION ||
      !Number.isSafeInteger(value.revision) ||
      !isFiniteNumber(value.startedAt) ||
      !isFiniteNumber(value.lastUpdatedAt) ||
      typeof value.sessionId !== "string" ||
      value.sessionId.length < 1 ||
      value.sessionId.length > 128 ||
      (value.ownerUserId !== null &&
        (typeof value.ownerUserId !== "string" ||
          value.ownerUserId.length < 1 ||
          value.ownerUserId.length > 256)) ||
      (value.status !== "recording" && value.status !== "paused") ||
      (value.trackingMode !== "background" &&
        value.trackingMode !== "foreground") ||
      typeof value.autoPauseEnabled !== "boolean" ||
      typeof value.autoPaused !== "boolean" ||
      !isFiniteNumber(value.weightKg) ||
      !isFiniteNumber(value.accumulatedMovingMs) ||
      (value.timerStartedAt !== null &&
        !isFiniteNumber(value.timerStartedAt)) ||
      !isFiniteNumber(value.distanceM) ||
      !isFiniteNumber(value.elevationGainM) ||
      !Array.isArray(value.points) ||
      !Array.isArray(value.splits)
    ) {
      return null;
    }
    const splitStart = value.splitStart;
    if (
      !splitStart ||
      typeof splitStart !== "object" ||
      Array.isArray(splitStart)
    ) {
      return null;
    }
    const split = splitStart as Record<string, unknown>;
    if (
      !isFiniteNumber(split.distanceM) ||
      !isFiniteNumber(split.movingMs) ||
      !isFiniteNumber(split.elevationM)
    ) {
      return null;
    }
    const points = compactTrackPoints(
      value.points
        .map(parseTrackPoint)
        .filter((point): point is TrackPoint => point !== null),
    );
    // Explicit null is meaningful: pause/resume deliberately drops the anchor
    // so the next fix cannot draw a straight line across the paused interval.
    const lastPoint =
      value.lastPoint === null ? null : parseTrackPoint(value.lastPoint);
    const splits = value.splits
      .map(parseSplit)
      .filter((item): item is Split => item !== null)
      .slice(0, 1_000);
    return {
      version: RUN_ENGINE_VERSION,
      revision: Math.max(1, Math.floor(value.revision as number)),
      sessionId: value.sessionId,
      ownerUserId: value.ownerUserId as string | null,
      startedAt: value.startedAt,
      status: value.status,
      trackingMode: value.trackingMode,
      autoPauseEnabled: value.autoPauseEnabled,
      autoPaused: value.autoPaused,
      weightKg: Math.max(25, Math.min(350, value.weightKg)),
      accumulatedMovingMs: Math.max(0, value.accumulatedMovingMs),
      timerStartedAt: value.timerStartedAt as number | null,
      distanceM: Math.max(0, value.distanceM),
      elevationGainM: Math.max(0, value.elevationGainM),
      points,
      splits,
      lastPoint,
      lastAccuracyM:
        nullableFiniteNumber(value.lastAccuracyM) &&
        (value.lastAccuracyM === null || value.lastAccuracyM >= 0)
          ? value.lastAccuracyM
          : null,
      slowSince: nullableFiniteNumber(value.slowSince) ? value.slowSince : null,
      splitStart: {
        distanceM: Math.max(0, split.distanceM),
        movingMs: Math.max(0, split.movingMs),
        elevationM: Math.max(0, split.elevationM),
      },
      lastUpdatedAt: value.lastUpdatedAt,
    };
  } catch {
    return null;
  }
}
