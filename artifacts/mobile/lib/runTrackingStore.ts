import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import {
  changeActiveRunMode,
  createActiveRunState,
  ingestTrackPoints,
  locationObjectToTrackPoint,
  parseActiveRunState,
  parseTrackPoint,
  pauseActiveRun,
  resumeActiveRun,
  MAX_ACTIVE_RUN_MS,
  type ActiveRunState,
  type RunTrackingMode,
} from "./runTrackingEngine";

export const RUN_LOCATION_TASK = "elovia-active-run-location-v1";
export const ACTIVE_RUN_STORAGE_KEY = "@elovia_active_run_v1";
export const RUN_LOCATION_BATCH_PREFIX = "@elovia_run_location_batch_v1:";
export const RUN_LOCATION_WRITER_PREFIX = "@elovia_run_location_writer_v1:";
export const RUN_CONTROL_STORAGE_KEY = "@elovia_active_run_control_v1";
export type BackgroundRunStartOutcome = "active" | "inactive" | "unknown";

interface RunControl {
  version: 1;
  sessionId: string;
  phase: "active" | "finalizing" | "closed";
  endedAt: number | null;
}

type LocationModule = typeof import("expo-location");
type ActiveRunListener = (state: ActiveRunState | null) => void;

const listeners = new Set<ActiveRunListener>();
let runOperation: Promise<void> = Promise.resolve();

function loadLocation(): LocationModule | null {
  try {
    // Metro requires a literal module name for background bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-location") as LocationModule;
  } catch {
    return null;
  }
}

async function serializeRunOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = runOperation;
  let release!: () => void;
  runOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function emitActiveRun(state: ActiveRunState | null): void {
  for (const listener of listeners) listener(state);
}

async function readUnserialized(): Promise<ActiveRunState | null> {
  return parseActiveRunState(
    await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY),
  );
}

async function readControlUnserialized(): Promise<RunControl | null> {
  const raw = await AsyncStorage.getItem(RUN_CONTROL_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const control = value as Record<string, unknown>;
    if (
      control.version !== 1 ||
      typeof control.sessionId !== "string" ||
      control.sessionId.length < 1 ||
      (control.phase !== "active" &&
        control.phase !== "finalizing" &&
        control.phase !== "closed") ||
      (control.endedAt !== null &&
        (typeof control.endedAt !== "number" ||
          !Number.isFinite(control.endedAt)))
    ) {
      return null;
    }
    return control as unknown as RunControl;
  } catch {
    return null;
  }
}

async function writeControlUnserialized(control: RunControl): Promise<void> {
  await AsyncStorage.setItem(RUN_CONTROL_STORAGE_KEY, JSON.stringify(control));
}

async function clearControlUnserialized(): Promise<void> {
  await AsyncStorage.removeItem(RUN_CONTROL_STORAGE_KEY);
}

async function writeUnserialized(state: ActiveRunState): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_RUN_STORAGE_KEY, JSON.stringify(state));
  emitActiveRun(state);
}

async function removeUnserialized(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
  emitActiveRun(null);
}

function pendingBatchPrefix(sessionId: string): string {
  return `${RUN_LOCATION_BATCH_PREFIX}${sessionId}:`;
}

function createBackgroundWriterId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function pendingBatchKeys(sessionId: string): Promise<string[]> {
  const prefix = pendingBatchPrefix(sessionId);
  return (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(prefix),
  );
}

async function pendingWriterKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(RUN_LOCATION_WRITER_PREFIX),
  );
}

async function waitForBackgroundWriters(timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await pendingWriterKeys()).length === 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return (await pendingWriterKeys()).length === 0;
}

/**
 * Background TaskManager callbacks can execute in a different JavaScript
 * runtime, so an in-memory Promise queue cannot make read-modify-write updates
 * atomic with the UI. Headless callbacks therefore append immutable batches;
 * only the foreground store reduces those batches into the active draft.
 */
export async function enqueueBackgroundRunLocations(
  rawLocations: readonly unknown[],
): Promise<void> {
  const writerId = createBackgroundWriterId();
  const writerKey = `${RUN_LOCATION_WRITER_PREFIX}${writerId}`;
  let batchKey: string | null = null;
  try {
    // This is deliberately the callback's first persisted operation. A pause
    // finalizer cannot prove quiescence until every callback that entered
    // JavaScript has released its claim.
    await AsyncStorage.setItem(writerKey, String(Date.now()));
    const state = await readUnserialized();
    const control = await readControlUnserialized();
    const finalizingThisSession =
      !!state &&
      control?.sessionId === state.sessionId &&
      control.phase === "finalizing" &&
      control.endedAt !== null;
    if (
      !state ||
      state.status !== "recording" ||
      state.trackingMode !== "background" ||
      !control ||
      control.sessionId !== state.sessionId ||
      (control.phase !== "active" && !finalizingThisSession)
    ) {
      await stopBackgroundRunLocation();
      return;
    }
    const expiresAt = state.startedAt + MAX_ACTIVE_RUN_MS;
    const acceptThrough = finalizingThisSession
      ? Math.min(expiresAt, control.endedAt as number)
      : expiresAt;
    const points = rawLocations
      .map(locationObjectToTrackPoint)
      .filter((point): point is NonNullable<typeof point> => point !== null)
      .filter((point) => point.timestamp <= acceptThrough)
      .slice(-200);
    if (points.length > 0) {
      // Every callback owns an immutable key. A foreground drain can safely
      // remove the exact keys it read without deleting a concurrent append.
      batchKey = `${pendingBatchPrefix(state.sessionId)}${points[0].timestamp}-${writerId}`;
      await AsyncStorage.setItem(batchKey, JSON.stringify(points));

      // Validate after the write. A finalizer may have changed lifecycle state
      // between our initial read and the append; never leave location data
      // behind a cleared or unrelated session.
      const latestState = await readUnserialized();
      const latestControl = await readControlUnserialized();
      const finalizingThisSession =
        latestControl?.sessionId === state.sessionId &&
        latestControl.phase === "finalizing" &&
        latestControl.endedAt !== null;
      const stillActive =
        latestState?.sessionId === state.sessionId &&
        latestState.status === "recording" &&
        latestState.trackingMode === "background" &&
        latestControl?.sessionId === state.sessionId &&
        latestControl.phase === "active";
      if (!stillActive && !finalizingThisSession) {
        await AsyncStorage.removeItem(batchKey);
        batchKey = null;
      } else if (finalizingThisSession) {
        const throughFinish = points.filter(
          (point) => point.timestamp <= (latestControl.endedAt as number),
        );
        if (throughFinish.length > 0) {
          await AsyncStorage.setItem(batchKey, JSON.stringify(throughFinish));
        } else {
          await AsyncStorage.removeItem(batchKey);
          batchKey = null;
        }
      }
    }
    if (Date.now() >= expiresAt) await stopBackgroundRunLocation();
  } catch (error) {
    // If lifecycle validation fails after a location write, fail closed: the
    // callback must not leave location data behind after logout or finalization.
    if (batchKey) {
      try {
        await AsyncStorage.removeItem(batchKey);
      } catch {
        // The caller still receives the original error; the owner cleanup path
        // also removes every run-location key on its next reconciliation.
      }
    }
    throw error;
  } finally {
    try {
      await AsyncStorage.removeItem(writerKey);
    } catch {
      // A stale claim is bounded to the active recorder and removed by
      // recovery/logout.
    }
  }
}

async function drainPendingBatchesUnserialized(
  state: ActiveRunState,
): Promise<ActiveRunState> {
  const keys = await pendingBatchKeys(state.sessionId);
  if (keys.length === 0) return state;
  const entries = await AsyncStorage.multiGet(keys);
  const rawPoints: unknown[] = [];
  for (const [, raw] of entries) {
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) rawPoints.push(...parsed);
    } catch {
      // Invalid batches are removed below so one corrupt callback cannot block
      // recovery of every later location update.
    }
  }
  let next = state;
  if (state.status === "recording" && rawPoints.length > 0) {
    const points = rawPoints
      .map(parseTrackPoint)
      .filter((point): point is NonNullable<typeof point> => point !== null);
    if (points.length > 0) {
      next = ingestTrackPoints(state, points);
      await writeUnserialized(next);
    }
  }
  await AsyncStorage.multiRemove(keys);
  return next;
}

async function removePendingBatchesUnserialized(
  sessionId: string,
): Promise<void> {
  const keys = await pendingBatchKeys(sessionId);
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

async function removePendingWritersUnserialized(): Promise<void> {
  const keys = await pendingWriterKeys();
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

async function removeAllPendingBatchesUnserialized(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    [RUN_LOCATION_BATCH_PREFIX, RUN_LOCATION_WRITER_PREFIX].some((prefix) =>
      key.startsWith(prefix),
    ),
  );
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

export function subscribeActiveRun(listener: ActiveRunListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readAnyActiveRun(): Promise<ActiveRunState | null> {
  return serializeRunOperation(readUnserialized);
}

export async function readActiveRunForOwner(
  ownerUserId: string | null,
): Promise<ActiveRunState | null> {
  return serializeRunOperation(async () => {
    const state = await readUnserialized();
    if (!state || state.ownerUserId !== ownerUserId) return null;
    const drained = await drainPendingBatchesUnserialized(state);
    if (
      drained.status === "recording" &&
      Date.now() >= drained.startedAt + MAX_ACTIVE_RUN_MS
    ) {
      await stopBackgroundRunLocation();
      const paused = pauseActiveRun(
        drained,
        drained.startedAt + MAX_ACTIVE_RUN_MS,
      );
      await writeUnserialized(paused);
      await clearControlUnserialized();
      return paused;
    }
    return drained;
  });
}

export function createAndPersistActiveRun(options: {
  sessionId: string;
  ownerUserId: string | null;
  startedAt: number;
  trackingMode: RunTrackingMode;
  autoPauseEnabled: boolean;
  weightKg: number;
}): Promise<ActiveRunState> {
  return serializeRunOperation(async () => {
    const existing = await readUnserialized();
    if (existing) {
      throw new Error("A run is already in progress.");
    }
    const state = createActiveRunState(options);
    await writeUnserialized(state);
    try {
      await writeControlUnserialized({
        version: 1,
        sessionId: state.sessionId,
        phase: "active",
        endedAt: null,
      });
    } catch (error) {
      await removeUnserialized();
      throw error;
    }
    return state;
  });
}

export function updateActiveRun(
  ownerUserId: string | null,
  sessionId: string,
  update: (state: ActiveRunState) => ActiveRunState,
): Promise<ActiveRunState | null> {
  return serializeRunOperation(async () => {
    let state = await readUnserialized();
    if (
      !state ||
      state.ownerUserId !== ownerUserId ||
      state.sessionId !== sessionId
    ) {
      return null;
    }
    state = await drainPendingBatchesUnserialized(state);
    const next = update(state);
    await writeUnserialized(next);
    return next;
  });
}

/** Foreground-only fallback. Background callbacks append immutable batches. */
export function ingestActiveRunLocations(
  rawLocations: readonly unknown[],
): Promise<void> {
  return serializeRunOperation(async () => {
    const state = await readUnserialized();
    if (!state || state.status !== "recording") return;
    const points = rawLocations
      .map(locationObjectToTrackPoint)
      .filter((point): point is NonNullable<typeof point> => point !== null);
    if (points.length === 0) return;
    await writeUnserialized(ingestTrackPoints(state, points));
  });
}

export function pausePersistedRun(
  ownerUserId: string | null,
  sessionId: string,
  timestamp = Date.now(),
): Promise<ActiveRunState | null> {
  return updateActiveRun(ownerUserId, sessionId, (state) =>
    pauseActiveRun(state, timestamp),
  ).then(async (state) => {
    if (state) await serializeRunOperation(clearControlUnserialized);
    return state;
  });
}

/**
 * Freeze a background draft through a two-phase control handshake. New native
 * callbacks see `finalizing`; already-running callbacks retain only points at
 * or before the cutoff, and the final drain consumes them before pausing.
 */
export async function stopAndPauseBackgroundRun(
  ownerUserId: string | null,
  sessionId: string,
  timestamp = Date.now(),
): Promise<ActiveRunState | null> {
  const prepared = await serializeRunOperation(async () => {
    const state = await readUnserialized();
    if (
      !state ||
      state.ownerUserId !== ownerUserId ||
      state.sessionId !== sessionId ||
      state.status !== "recording" ||
      state.trackingMode !== "background"
    ) {
      return false;
    }
    await writeControlUnserialized({
      version: 1,
      sessionId,
      phase: "finalizing",
      endedAt: timestamp,
    });
    return true;
  });
  if (!prepared) return null;

  if (!(await stopBackgroundRunLocation())) {
    await serializeRunOperation(async () => {
      const state = await readUnserialized();
      if (
        state?.ownerUserId === ownerUserId &&
        state.sessionId === sessionId &&
        state.status === "recording" &&
        state.trackingMode === "background"
      ) {
        await writeControlUnserialized({
          version: 1,
          sessionId,
          phase: "active",
          endedAt: null,
        });
      }
    });
    return null;
  }

  // Native recording is stopped. Wait for every callback that already entered
  // JavaScript to release its persisted writer claim before the final drain.
  if (!(await waitForBackgroundWriters())) {
    // Keep the durable draft in `finalizing` rather than claiming a complete
    // pause while a callback is still unacknowledged. A retry/recovery can
    // finish once the writer releases its claim.
    return null;
  }
  const paused = await serializeRunOperation(async () => {
    let state = await readUnserialized();
    if (
      !state ||
      state.ownerUserId !== ownerUserId ||
      state.sessionId !== sessionId
    ) {
      await clearControlUnserialized();
      await removePendingBatchesUnserialized(sessionId);
      return null;
    }
    state = await drainPendingBatchesUnserialized(state);
    const paused = pauseActiveRun(state, timestamp);
    await writeUnserialized(paused);
    await writeControlUnserialized({
      version: 1,
      sessionId,
      phase: "closed",
      endedAt: timestamp,
    });
    return paused;
  });
  await serializeRunOperation(() =>
    removePendingBatchesUnserialized(sessionId),
  );
  return paused;
}

export function resumePersistedRun(
  ownerUserId: string | null,
  sessionId: string,
  trackingMode: RunTrackingMode,
  timestamp = Date.now(),
): Promise<ActiveRunState | null> {
  return updateActiveRun(ownerUserId, sessionId, (state) =>
    resumeActiveRun(state, timestamp, trackingMode),
  ).then(async (state) => {
    if (!state) return null;
    await serializeRunOperation(() =>
      trackingMode === "background"
        ? writeControlUnserialized({
            version: 1,
            sessionId,
            phase: "active",
            endedAt: null,
          })
        : clearControlUnserialized(),
    );
    return state;
  });
}

export function changePersistedRunMode(
  ownerUserId: string | null,
  sessionId: string,
  trackingMode: RunTrackingMode,
): Promise<ActiveRunState | null> {
  return updateActiveRun(ownerUserId, sessionId, (state) =>
    changeActiveRunMode(state, trackingMode),
  ).then(async (state) => {
    if (state && trackingMode === "foreground") {
      await serializeRunOperation(clearControlUnserialized);
    }
    return state;
  });
}

export function clearPersistedRun(
  ownerUserId: string | null,
  sessionId: string,
): Promise<boolean> {
  return serializeRunOperation(async () => {
    const state = await readUnserialized();
    if (!state) {
      if ((await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY)) !== null) {
        await removeUnserialized();
      }
      await clearControlUnserialized();
      await removeAllPendingBatchesUnserialized();
      return true;
    }
    if (state.ownerUserId !== ownerUserId || state.sessionId !== sessionId) {
      return false;
    }
    await removeUnserialized();
    await clearControlUnserialized();
    await removePendingBatchesUnserialized(sessionId);
    await removePendingWritersUnserialized();
    return (await readUnserialized()) === null;
  });
}

export async function isBackgroundRunLocationActive(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const Location = loadLocation();
  if (!Location) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startBackgroundRunLocation(): Promise<BackgroundRunStartOutcome> {
  if (Platform.OS === "web") return "inactive";
  const Location = loadLocation();
  if (!Location) return "inactive";
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
      return "active";
    }
    await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      timeInterval: 2_000,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      deferredUpdatesDistance: 10,
      deferredUpdatesInterval: 10_000,
      foregroundService: {
        notificationTitle: "Elovia run in progress",
        notificationBody: "Recording your route, time and pace",
        notificationColor: "#00D4FF",
        killServiceOnDestroy: false,
      },
    });
    try {
      return (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
        ? "active"
        : "inactive";
    } catch {
      // A resolved start call is stronger evidence than a failed verification
      // read. Treat it as active so callers keep the matching background mode
      // and always attempt an explicit stop later.
      return "active";
    }
  } catch {
    // startLocationUpdatesAsync can throw after native registration. A final
    // read prevents us from silently downgrading while leaving a task alive.
    try {
      return (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK))
        ? "active"
        : "inactive";
    } catch {
      return "unknown";
    }
  }
}

/** Stop and then read native state back; swallowing an exception is not proof. */
export async function stopBackgroundRunLocation(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  const Location = loadLocation();
  if (!Location) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let active: boolean;
    try {
      active = await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK);
    } catch {
      return false;
    }
    if (!active) return true;
    try {
      await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
    } catch {
      // The read-back below is authoritative and decides whether to retry.
    }
  }
  try {
    return !(await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK));
  } catch {
    return false;
  }
}

/**
 * Hydrate a draft and reconcile it with the native recorder.
 * Foreground-only drafts cannot survive unmount/process death, so they recover
 * paused at the last persisted fix instead of counting an arbitrary gap.
 */
export function prepareRunRecovery(
  ownerUserId: string | null,
): Promise<{ state: ActiveRunState | null; recovered: boolean }> {
  return serializeRunOperation(async () => {
    let state = await readUnserialized();
    if (!state) {
      await stopBackgroundRunLocation();
      await clearControlUnserialized();
      await removeAllPendingBatchesUnserialized();
      return { state: null, recovered: false };
    }
    if (state.ownerUserId !== ownerUserId) {
      return { state: null, recovered: false };
    }
    if (state.status === "paused") {
      await stopBackgroundRunLocation();
      await clearControlUnserialized();
      await removePendingBatchesUnserialized(state.sessionId);
      await removePendingWritersUnserialized();
      return { state, recovered: true };
    }

    const control = await readControlUnserialized();
    if (
      control?.sessionId === state.sessionId &&
      control.phase === "finalizing" &&
      control.endedAt !== null
    ) {
      await stopBackgroundRunLocation();
      state = await drainPendingBatchesUnserialized(state);
      const paused = pauseActiveRun(state, control.endedAt);
      await writeUnserialized(paused);
      await clearControlUnserialized();
      await removePendingBatchesUnserialized(state.sessionId);
      await removePendingWritersUnserialized();
      return { state: paused, recovered: true };
    }

    const nativeActive =
      state.trackingMode === "background" &&
      (await isBackgroundRunLocationActive());
    state = await drainPendingBatchesUnserialized(state);
    if (nativeActive) {
      if (
        !control ||
        control.sessionId !== state.sessionId ||
        control.phase !== "active"
      ) {
        await writeControlUnserialized({
          version: 1,
          sessionId: state.sessionId,
          phase: "active",
          endedAt: null,
        });
      }
      return { state, recovered: true };
    }

    const paused = pauseActiveRun(state, state.lastUpdatedAt);
    await stopBackgroundRunLocation();
    await writeUnserialized(paused);
    await clearControlUnserialized();
    return { state: paused, recovered: true };
  });
}

/** Stop a run only when it belongs to the account being signed out. */
export async function stopAndClearActiveRunForOwner(
  ownerUserId: string | null,
): Promise<boolean> {
  const state = await readAnyActiveRun();
  if (state && state.ownerUserId !== ownerUserId) return false;
  if (!(await stopBackgroundRunLocation())) return false;
  if (!state) {
    return serializeRunOperation(async () => {
      await AsyncStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
      await clearControlUnserialized();
      await removeAllPendingBatchesUnserialized();
      emitActiveRun(null);
      return true;
    });
  }
  return clearPersistedRun(ownerUserId, state.sessionId);
}

/** Remove a stale recorder whenever the authenticated owner changes. */
export async function reconcileActiveRunOwner(
  ownerUserId: string | null,
): Promise<boolean> {
  const state = await readAnyActiveRun();
  if (
    state?.ownerUserId === ownerUserId &&
    state.status === "recording" &&
    state.trackingMode === "background"
  ) {
    return true;
  }
  if (!(await stopBackgroundRunLocation())) return false;
  return serializeRunOperation(async () => {
    const current = await readUnserialized();
    if (!current) {
      await AsyncStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
      await clearControlUnserialized();
      await removeAllPendingBatchesUnserialized();
      emitActiveRun(null);
      return true;
    }
    if (current.ownerUserId === ownerUserId) {
      if (current.status === "paused") {
        await removePendingBatchesUnserialized(current.sessionId);
        await removePendingWritersUnserialized();
      }
      return true;
    }
    const staleSessionId = current.sessionId;
    await removeUnserialized();
    await clearControlUnserialized();
    await removePendingBatchesUnserialized(staleSessionId);
    await removePendingWritersUnserialized();
    return (await readUnserialized()) === null;
  });
}
