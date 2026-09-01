export interface PushOwnership {
  userId: string;
  token: string;
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

export function parseCachedPushOwnership(
  raw: string | null,
): PushOwnership | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      !isNonEmptyBoundedString(candidate.userId, 256) ||
      !isExpoPushToken(candidate.token)
    ) {
      return null;
    }
    return { userId: candidate.userId, token: candidate.token };
  } catch {
    return null;
  }
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
