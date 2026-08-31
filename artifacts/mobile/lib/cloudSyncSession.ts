const CLOUD_SYNC_SESSION = Symbol("cloud-sync-session");

export interface CloudSyncSessionToken {
  readonly [CLOUD_SYNC_SESSION]: true;
}

interface CloudSyncSessionRecord extends CloudSyncSessionToken {
  readonly uid: string;
  readonly generation: number;
}

let nextGeneration = 0;
let activeSession: CloudSyncSessionRecord | null = null;
const activeAbortControllers = new WeakMap<
  CloudSyncSessionToken,
  Set<AbortController>
>();
export const CLOUD_SYNC_SESSION_ABORT_REASON = "cloud-sync-session-ended";
export const CLOUD_SYNC_NETWORK_TIMEOUT_MS = 20_000;
const CLOUD_SYNC_TIMEOUT_ABORT_REASON = "cloud-sync-deadline-exceeded";

export type CloudSyncDeadlineReason = "timeout" | "session";

export class CloudSyncDeadlineError extends Error {
  readonly reason: CloudSyncDeadlineReason;

  constructor(reason: CloudSyncDeadlineReason) {
    super(
      reason === "timeout"
        ? "The cloud sync operation timed out."
        : "The cloud sync session ended.",
    );
    this.name = "CloudSyncDeadlineError";
    this.reason = reason;
  }
}

function abortSessionControllers(token: CloudSyncSessionToken): void {
  const controllers = activeAbortControllers.get(token);
  if (!controllers) return;
  activeAbortControllers.delete(token);
  for (const controller of controllers) {
    if (!controller.signal.aborted) {
      controller.abort(CLOUD_SYNC_SESSION_ABORT_REASON);
    }
  }
}

export function beginCloudSyncSession(uid: string): CloudSyncSessionToken {
  if (activeSession) abortSessionControllers(activeSession);
  const token: CloudSyncSessionRecord = Object.freeze({
    uid,
    generation: ++nextGeneration,
    [CLOUD_SYNC_SESSION]: true as const,
  });
  activeSession = token;
  return token;
}

export function registerCloudSyncAbortController(
  token: CloudSyncSessionToken,
  controller: AbortController,
): () => void {
  if (!isCloudSyncSessionCurrent(token)) {
    controller.abort(CLOUD_SYNC_SESSION_ABORT_REASON);
    return () => {};
  }
  let controllers = activeAbortControllers.get(token);
  if (!controllers) {
    controllers = new Set();
    activeAbortControllers.set(token, controllers);
  }
  controllers.add(controller);
  return () => {
    const current = activeAbortControllers.get(token);
    if (!current) return;
    current.delete(controller);
    if (current.size === 0) activeAbortControllers.delete(token);
  };
}

export function cloudSyncSessionAbortControllerCount(
  token: CloudSyncSessionToken,
): number {
  return activeAbortControllers.get(token)?.size ?? 0;
}

export function getCurrentCloudSyncSession(
  expectedUid: string,
): CloudSyncSessionToken | null {
  return activeSession?.uid === expectedUid ? activeSession : null;
}

export function cloudSyncSessionUid(token: CloudSyncSessionToken): string {
  return (token as CloudSyncSessionRecord).uid;
}

export function cloudSyncSessionGeneration(
  token: CloudSyncSessionToken,
): number {
  return (token as CloudSyncSessionRecord).generation;
}

export function isCloudSyncSessionCurrent(
  token: CloudSyncSessionToken,
): boolean {
  return activeSession === token;
}

export function endCloudSyncSession(token: CloudSyncSessionToken): void {
  abortSessionControllers(token);
  if (activeSession === token) activeSession = null;
}

function cancellationReason(signal: AbortSignal): CloudSyncDeadlineReason {
  return signal.reason === CLOUD_SYNC_SESSION_ABORT_REASON
    ? "session"
    : "timeout";
}

export function isCloudSyncDeadlineError(
  error: unknown,
  reason?: CloudSyncDeadlineReason,
): error is CloudSyncDeadlineError {
  return (
    error instanceof CloudSyncDeadlineError &&
    (reason === undefined || error.reason === reason)
  );
}

/**
 * Bound one network read to its opaque account session. The cancellation race
 * releases callers even when the underlying SDK ignores AbortSignal (RTDB).
 */
export async function runCloudSyncBoundedOperation<Value>(
  token: CloudSyncSessionToken,
  operation: (signal: AbortSignal) => Promise<Value>,
  deadlineMs = CLOUD_SYNC_NETWORK_TIMEOUT_MS,
): Promise<Value> {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new RangeError("Cloud sync deadline must be positive.");
  }

  const controller = new AbortController();
  let rejectCancellation: (error: CloudSyncDeadlineError) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const onAbort = () => {
    rejectCancellation(
      new CloudSyncDeadlineError(cancellationReason(controller.signal)),
    );
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const unregister = registerCloudSyncAbortController(token, controller);
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(CLOUD_SYNC_TIMEOUT_ABORT_REASON);
    }
  }, deadlineMs);

  try {
    if (controller.signal.aborted) {
      throw new CloudSyncDeadlineError(cancellationReason(controller.signal));
    }
    return await Promise.race([operation(controller.signal), cancellation]);
  } catch (error) {
    if (error instanceof CloudSyncDeadlineError) throw error;
    if (controller.signal.aborted) {
      throw new CloudSyncDeadlineError(cancellationReason(controller.signal));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", onAbort);
    unregister();
  }
}

export async function cloudSyncFetch<Value>(
  token: CloudSyncSessionToken,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  consume: (response: Response) => Promise<Value> = async (response) =>
    response as Value,
  deadlineMs = CLOUD_SYNC_NETWORK_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Value> {
  return runCloudSyncBoundedOperation(
    token,
    async (signal) => consume(await fetchImpl(input, { ...init, signal })),
    deadlineMs,
  );
}
