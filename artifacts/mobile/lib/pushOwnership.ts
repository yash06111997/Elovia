export interface PushOwnership {
  userId: string;
  token: string;
}

export type PushOwnershipTransition =
  | { action: "register" }
  | { action: "noop" }
  | { action: "replace-current-token"; unregisterToken: string }
  | { action: "transfer-owner" };

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
