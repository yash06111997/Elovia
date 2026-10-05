import AsyncStorage from "@react-native-async-storage/async-storage";

export const NATIVE_LIFECYCLE_STATE_KEY = "@elovia_native_lifecycle_state";
const NATIVE_LIFECYCLE_STATE_VERSION = 1;

export type NativeLifecyclePersistedState =
  | { status: "unknown" }
  | { status: "clean"; generation: number }
  | { status: "pending"; ownerUserId: string | null; generation: number }
  | { status: "owned"; ownerUserId: string; generation: number };

interface NativeLifecycleStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface NativeCleanupOutcome {
  remindersCleared: boolean;
  geofencesCleared: boolean;
  verified: boolean;
}

export class NativeLifecycleStateStore {
  private readonly storage: NativeLifecycleStorage;

  constructor(storage: NativeLifecycleStorage) {
    this.storage = storage;
  }

  async read(): Promise<NativeLifecyclePersistedState> {
    try {
      const raw = await this.storage.getItem(NATIVE_LIFECYCLE_STATE_KEY);
      if (raw === null) return { status: "unknown" };
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { status: "unknown" };
      }
      const value = parsed as Record<string, unknown>;
      if (
        value.version !== NATIVE_LIFECYCLE_STATE_VERSION ||
        typeof value.generation !== "number" ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 0
      ) {
        return { status: "unknown" };
      }
      if (value.status === "clean") {
        return { status: "clean", generation: value.generation };
      }
      if (
        value.status === "pending" &&
        (value.ownerUserId === null ||
          (typeof value.ownerUserId === "string" &&
            value.ownerUserId.length > 0 &&
            value.ownerUserId.length <= 256))
      ) {
        return {
          status: "pending",
          ownerUserId: value.ownerUserId,
          generation: value.generation,
        };
      }
      if (
        value.status === "owned" &&
        typeof value.ownerUserId === "string" &&
        value.ownerUserId.length > 0 &&
        value.ownerUserId.length <= 256
      ) {
        return {
          status: "owned",
          ownerUserId: value.ownerUserId,
          generation: value.generation,
        };
      }
    } catch {
      // Corrupt or unreadable state is unknown and requires verified cleanup.
    }
    return { status: "unknown" };
  }

  private async write(
    state:
      | { status: "clean"; generation: number }
      | { status: "pending"; ownerUserId: string | null; generation: number }
      | { status: "owned"; ownerUserId: string; generation: number },
  ): Promise<boolean> {
    try {
      await this.storage.setItem(
        NATIVE_LIFECYCLE_STATE_KEY,
        JSON.stringify({ version: NATIVE_LIFECYCLE_STATE_VERSION, ...state }),
      );
      return true;
    } catch {
      return false;
    }
  }

  writePending(ownerUserId: string | null, generation: number) {
    return this.write({ status: "pending", ownerUserId, generation });
  }

  writeClean(generation: number) {
    return this.write({ status: "clean", generation });
  }

  writeOwned(ownerUserId: string, generation: number) {
    return this.write({ status: "owned", ownerUserId, generation });
  }
}

function nextGeneration(state: NativeLifecyclePersistedState): number {
  return state.status === "unknown" ? 1 : state.generation + 1;
}

export function canCompleteNativeStateLogout(
  outcome: NativeCleanupOutcome,
): boolean {
  return outcome.verified;
}

/** Persist intent before touching OS state, then verify both native surfaces. */
export async function runVerifiedNativeCleanup(options: {
  store: NativeLifecycleStateStore;
  ownerUserId: string | null;
  cancelReminders(): Promise<boolean>;
  stopGeofences(): Promise<boolean>;
  timeoutMs?: number;
}): Promise<NativeCleanupOutcome> {
  const previous = await options.store.read();
  const generation = nextGeneration(previous);
  const durable = await options.store.writePending(
    options.ownerUserId ??
      (previous.status === "owned" || previous.status === "pending"
        ? previous.ownerUserId
        : null),
    generation,
  );
  if (!durable) {
    return {
      remindersCleared: false,
      geofencesCleared: false,
      verified: false,
    };
  }

  const timeoutMs = Math.max(1, Math.min(10_000, options.timeoutMs ?? 5_000));
  const settleVerified = (operation: Promise<boolean>) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      void operation.then(
        (result) => finish(result),
        () => finish(false),
      );
    });
  const [remindersCleared, geofencesCleared] = await Promise.all([
    settleVerified(options.cancelReminders()),
    settleVerified(options.stopGeofences()),
  ]);
  const nativeVerified = remindersCleared && geofencesCleared;
  const stateVerified =
    nativeVerified && (await options.store.writeClean(generation));
  return {
    remindersCleared,
    geofencesCleared,
    verified: stateVerified,
  };
}

/**
 * Serialize owner transitions around cleanup + rebuild. A new account never
 * starts native work until a previous/unknown owner is verified empty.
 */
export async function runNativeOwnerReconciliation(options: {
  store: NativeLifecycleStateStore;
  ownerUserId: string;
  isCurrent(): boolean;
  cancelReminders(): Promise<boolean>;
  stopGeofences(): Promise<boolean>;
  reconcileReminders(): Promise<boolean>;
  reconcileGeofences(): Promise<boolean>;
}): Promise<boolean> {
  const before = await options.store.read();
  if (!options.isCurrent()) return false;
  if (before.status !== "owned" || before.ownerUserId !== options.ownerUserId) {
    const cleanup = await runVerifiedNativeCleanup({
      store: options.store,
      ownerUserId:
        before.status === "owned" || before.status === "pending"
          ? before.ownerUserId
          : null,
      cancelReminders: options.cancelReminders,
      stopGeofences: options.stopGeofences,
    });
    if (!cleanup.verified || !options.isCurrent()) return false;
  }

  const state = await options.store.read();
  const generation = nextGeneration(state);
  if (!(await options.store.writePending(options.ownerUserId, generation))) {
    return false;
  }

  const remindersReconciled = await options
    .reconcileReminders()
    .catch(() => false);
  if (!options.isCurrent()) {
    await runVerifiedNativeCleanup({
      store: options.store,
      ownerUserId: options.ownerUserId,
      cancelReminders: options.cancelReminders,
      stopGeofences: options.stopGeofences,
    });
    return false;
  }
  const geofencesReconciled = await options
    .reconcileGeofences()
    .catch(() => false);
  if (
    remindersReconciled &&
    geofencesReconciled &&
    options.isCurrent() &&
    (await options.store.writeOwned(options.ownerUserId, generation))
  ) {
    return true;
  }

  await runVerifiedNativeCleanup({
    store: options.store,
    ownerUserId: options.ownerUserId,
    cancelReminders: options.cancelReminders,
    stopGeofences: options.stopGeofences,
  });
  return false;
}

const nativeLifecycleState = new NativeLifecycleStateStore(AsyncStorage);
let nativeLifecycleOperation: Promise<void> = Promise.resolve();
let currentAuthOwnerUserId: string | null = null;
const activeSuspensionLeases = new Map<symbol, string>();
let authLifecycleGeneration = 0;

export interface NativeLifecycleFence {
  ownerUserId: string | null;
  generation: number;
}

export interface NativeLifecycleSuspensionLease {
  readonly ownerUserId: string;
  readonly token: symbol;
}

function isOwnerSuspended(ownerUserId: string): boolean {
  for (const suspendedOwnerUserId of activeSuspensionLeases.values()) {
    if (suspendedOwnerUserId === ownerUserId) return true;
  }
  return false;
}

/** Synchronous auth-generation fence for the gap around Firebase sign-out. */
export function setNativeLifecycleAuthOwner(ownerUserId: string | null): void {
  const ownerChanged = currentAuthOwnerUserId !== ownerUserId;
  if (ownerChanged) authLifecycleGeneration += 1;
  currentAuthOwnerUserId = ownerUserId;
  if (ownerChanged) {
    for (const [token, suspendedOwnerUserId] of activeSuspensionLeases) {
      if (suspendedOwnerUserId !== ownerUserId) {
        activeSuspensionLeases.delete(token);
      }
    }
  }
}

export function suspendNativeLifecycleOwner(
  ownerUserId: string,
): NativeLifecycleSuspensionLease {
  const lease = Object.freeze({ ownerUserId, token: Symbol(ownerUserId) });
  authLifecycleGeneration += 1;
  activeSuspensionLeases.set(lease.token, ownerUserId);
  return lease;
}

export function resumeNativeLifecycleOwner(
  lease: NativeLifecycleSuspensionLease,
): boolean {
  if (activeSuspensionLeases.get(lease.token) !== lease.ownerUserId) {
    return false;
  }
  authLifecycleGeneration += 1;
  activeSuspensionLeases.delete(lease.token);
  return true;
}

export function captureNativeLifecycleFence(
  ownerUserId: string | null,
): NativeLifecycleFence | null {
  if (
    currentAuthOwnerUserId !== ownerUserId ||
    (ownerUserId !== null && isOwnerSuspended(ownerUserId))
  ) {
    return null;
  }
  return { ownerUserId, generation: authLifecycleGeneration };
}

export function isNativeLifecycleFenceCurrent(
  fence: NativeLifecycleFence,
): boolean {
  return (
    fence.generation === authLifecycleGeneration &&
    fence.ownerUserId === currentAuthOwnerUserId &&
    (fence.ownerUserId === null || !isOwnerSuspended(fence.ownerUserId))
  );
}

export function isNativeLifecycleOwnerCurrent(ownerUserId: string): boolean {
  return (
    currentAuthOwnerUserId === ownerUserId && !isOwnerSuspended(ownerUserId)
  );
}

async function serializeNativeLifecycleOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = nativeLifecycleOperation;
  let release!: () => void;
  nativeLifecycleOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function clearNativeAccountState(options: {
  ownerUserId: string | null;
  cancelReminders(): Promise<boolean>;
  stopGeofences(): Promise<boolean>;
}): Promise<NativeCleanupOutcome> {
  return serializeNativeLifecycleOperation(() =>
    runVerifiedNativeCleanup({ store: nativeLifecycleState, ...options }),
  );
}

export function reconcileNativeAccountState(
  options: Omit<Parameters<typeof runNativeOwnerReconciliation>[0], "store">,
): Promise<boolean> {
  return serializeNativeLifecycleOperation(() =>
    runNativeOwnerReconciliation({ store: nativeLifecycleState, ...options }),
  );
}
