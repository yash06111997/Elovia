export interface PushOwnership {
  userId: string;
  token: string;
}

export const PUSH_REGISTRATION_STATE_VERSION = 1;

export type PersistedPushRegistrationState =
  | {
      status: "owned";
      ownership: PushOwnership;
      /** False only for the short-lived Task 6 pre-versioned upgrade shape. */
      versioned: boolean;
    }
  | { status: "detached" }
  | { status: "legacy-token"; token: string }
  | { status: "unknown" };

export interface PushLogoutDetachmentOutcome {
  serverDetached: boolean;
  nativeDetached: boolean;
  cleanupPending: boolean;
}

export function canCompletePushLogout(
  outcome: PushLogoutDetachmentOutcome,
): boolean {
  return outcome.serverDetached || outcome.nativeDetached;
}

export async function runPushSafeSignOut(
  outcome: PushLogoutDetachmentOutcome,
  signOut: () => Promise<void>,
): Promise<"signed-out" | "blocked"> {
  if (!canCompletePushLogout(outcome)) return "blocked";
  await signOut();
  return "signed-out";
}

export type PushOwnershipTransition =
  | { action: "register" }
  | { action: "noop" }
  | { action: "replace-current-token"; unregisterToken: string }
  | { action: "transfer-owner" };

export type PushOwnershipMutationOutcome =
  | { status: "registered" | "noop" }
  | { status: "network" }
  | { status: "stale"; compensated: boolean };

export interface PushOwnershipMutationOperation<Session> {
  session: Session;
  token: string;
  transition: PushOwnershipTransition;
  isSessionCurrent(session: Session): Promise<boolean>;
  register(session: Session, token: string): Promise<boolean>;
  unregister(session: Session, token: string): Promise<boolean>;
}

export type PushOwnershipPersistenceOutcome =
  | { status: "persisted" }
  | { status: "persistence-failed"; compensated: boolean };

export async function persistPushOwnershipOrCompensate<Session>(options: {
  session: Session;
  ownership: PushOwnership;
  persist(ownership: PushOwnership): Promise<void>;
  compensate(session: Session, token: string): Promise<boolean>;
}): Promise<PushOwnershipPersistenceOutcome> {
  try {
    await options.persist(options.ownership);
    return { status: "persisted" };
  } catch {
    let compensated = false;
    try {
      compensated = await options.compensate(
        options.session,
        options.ownership.token,
      );
    } catch {
      compensated = false;
    }
    return { status: "persistence-failed", compensated };
  }
}

export async function resolvePushPermission(
  alreadyGranted: boolean,
  requestPermission: boolean,
  request: () => Promise<boolean>,
): Promise<boolean> {
  if (alreadyGranted) return true;
  return requestPermission ? request() : false;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < 200 &&
    (value.startsWith("ExponentPushToken[") ||
      value.startsWith("ExpoPushToken[")) &&
    value.endsWith("]")
  );
}

/**
 * Decode the complete durable push state.
 *
 * Absence, corruption, and the pre-Task 6 raw-token format are deliberately
 * distinct from a verified detached marker. An upgrade must never infer that
 * the backend has no token simply because the new ownership object is absent.
 */
export function parsePersistedPushRegistrationState(
  raw: string | null,
): PersistedPushRegistrationState {
  if (raw === null) return { status: "unknown" };
  if (isExpoPushToken(raw)) return { status: "legacy-token", token: raw };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "unknown" };
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version === PUSH_REGISTRATION_STATE_VERSION &&
      candidate.status === "detached"
    ) {
      return { status: "detached" };
    }
    if (
      candidate.version === PUSH_REGISTRATION_STATE_VERSION &&
      candidate.status === "owned" &&
      isNonEmptyBoundedString(candidate.userId, 256) &&
      isExpoPushToken(candidate.token)
    ) {
      return {
        status: "owned",
        ownership: { userId: candidate.userId, token: candidate.token },
        versioned: true,
      };
    }
    // Upgrade compatibility for ownership objects written by earlier Task 6
    // builds. They are known ownership, but are rewritten versioned next time.
    if (
      candidate.version === undefined &&
      isNonEmptyBoundedString(candidate.userId, 256) &&
      isExpoPushToken(candidate.token)
    ) {
      return {
        status: "owned",
        ownership: { userId: candidate.userId, token: candidate.token },
        versioned: false,
      };
    }
  } catch {
    // Invalid state is unknown, never detached.
  }
  return { status: "unknown" };
}

export function serializeOwnedPushRegistrationState(
  ownership: PushOwnership,
): string {
  return JSON.stringify({
    version: PUSH_REGISTRATION_STATE_VERSION,
    status: "owned",
    ...ownership,
  });
}

export function serializeDetachedPushRegistrationState(): string {
  return JSON.stringify({
    version: PUSH_REGISTRATION_STATE_VERSION,
    status: "detached",
  });
}

export function hasVerifiedServerDetachment(
  state: PersistedPushRegistrationState,
  authenticatedUnregisterSucceeded: boolean,
): boolean {
  return authenticatedUnregisterSucceeded || state.status === "detached";
}

export interface PushServerCleanupPlan {
  alreadyDetached: boolean;
  ownershipConflict: boolean;
  candidates: PushOwnership[];
}

/** Resolve upgrade and journal state into user-authorized unregister targets. */
export function planPushServerCleanup(
  state: PersistedPushRegistrationState,
  expectedUserId: string,
  pending: readonly PushOwnership[],
): PushServerCleanupPlan {
  if (state.status === "detached") {
    return { alreadyDetached: true, ownershipConflict: false, candidates: [] };
  }
  if (state.status === "owned" && state.ownership.userId !== expectedUserId) {
    return { alreadyDetached: false, ownershipConflict: true, candidates: [] };
  }
  const candidates = new Map<string, PushOwnership>();
  if (state.status === "owned") {
    candidates.set(state.ownership.token, state.ownership);
  } else if (state.status === "legacy-token") {
    candidates.set(state.token, { userId: expectedUserId, token: state.token });
  }
  for (const ownership of pending) {
    if (ownership.userId === expectedUserId) {
      candidates.set(ownership.token, ownership);
    }
  }
  return {
    alreadyDetached: false,
    ownershipConflict: false,
    candidates: [...candidates.values()],
  };
}

export function parseCachedPushOwnership(
  raw: string | null,
): PushOwnership | null {
  const state = parsePersistedPushRegistrationState(raw);
  return state.status === "owned" ? state.ownership : null;
}

/**
 * Decide what can be changed using the current account's authorization.
 *
 * A token owned by another account is deliberately never returned as an
 * unregister candidate. Registering the device's current token transfers that
 * token atomically on the server, while attempting to unregister the previous
 * owner with the new account's credential would be both misleading and unsafe.
 */
export function planPushOwnershipTransition(
  cached: PushOwnership | null,
  currentUserId: string,
  currentToken: string,
): PushOwnershipTransition {
  if (!cached) return { action: "register" };
  if (cached.userId !== currentUserId) return { action: "transfer-owner" };
  if (cached.token === currentToken) return { action: "noop" };
  return {
    action: "replace-current-token",
    unregisterToken: cached.token,
  };
}

/**
 * Guard a push ownership mutation with the exact credential that began it.
 *
 * If registration finishes after an account transition, compensation uses
 * that captured credential. The server's user+token predicate means it can
 * remove only the stale owner's row and can never unregister a new owner.
 */
export async function runPushOwnershipMutation<Session>(
  operation: PushOwnershipMutationOperation<Session>,
): Promise<PushOwnershipMutationOutcome> {
  const { session, token, transition } = operation;
  if (!(await operation.isSessionCurrent(session))) {
    return { status: "stale", compensated: true };
  }
  if (transition.action === "noop") return { status: "noop" };

  if (transition.action === "replace-current-token") {
    const unregistered = await operation.unregister(
      session,
      transition.unregisterToken,
    );
    if (!unregistered) return { status: "network" };
    if (!(await operation.isSessionCurrent(session))) {
      return { status: "stale", compensated: true };
    }
  }

  if (!(await operation.isSessionCurrent(session))) {
    return { status: "stale", compensated: true };
  }
  if (!(await operation.register(session, token))) {
    return { status: "network" };
  }
  if (await operation.isSessionCurrent(session)) {
    return { status: "registered" };
  }

  let compensated = false;
  try {
    compensated = await operation.unregister(session, token);
  } catch {
    compensated = false;
  }
  return { status: "stale", compensated };
}
