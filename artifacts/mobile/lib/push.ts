import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import {
  PushCleanupStore,
  runPushCleanupForUser,
  type PushCleanupIntent,
} from "./pushCleanup";
import {
  persistPushOwnershipOrCompensate,
  parseCachedPushOwnership,
  planPushOwnershipTransition,
  resolvePushPermission,
  runPushOwnershipMutation,
  type PushLogoutDetachmentOutcome,
  type PushOwnership,
} from "./pushOwnership";

/**
 * Expo push registration.
 *
 * The explicit registration entry point may request permission after a user
 * taps a control. Lifecycle reconciliation only observes an already-granted
 * permission, so opening Elovia never causes an optional system prompt.
 */

type NotificationsModule = typeof import("expo-notifications");

let cachedNotifications: NotificationsModule | null = null;
let notificationsLoadAttempted = false;
let pushOperation: Promise<void> = Promise.resolve();
const pushCleanup = new PushCleanupStore(AsyncStorage);
const pushPresentationBlockedUsers = new Set<string>();

function loadNotifications(): NotificationsModule | null {
  if (notificationsLoadAttempted) return cachedNotifications;
  notificationsLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedNotifications = require("expo-notifications") as NotificationsModule;
  } catch {
    cachedNotifications = null;
  }
  return cachedNotifications;
}

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

interface AuthSession {
  userId: string;
  authToken: string;
  authUser: User;
}

async function getAuthSession(
  expectedUserId?: string,
): Promise<AuthSession | null> {
  try {
    const auth = await getFirebaseAuth();
    const current = auth?.currentUser;
    if (!current || (expectedUserId && current.uid !== expectedUserId)) {
      return null;
    }
    const authToken = await current.getIdToken();
    if (!authToken || auth.currentUser !== current) return null;
    return { userId: current.uid, authToken, authUser: current };
  } catch {
    return null;
  }
}

async function sessionStillCurrent(session: AuthSession): Promise<boolean> {
  try {
    return (await getFirebaseAuth())?.currentUser === session.authUser;
  } catch {
    return false;
  }
}

export const TOKEN_CACHE_KEY = "@elovia_push_token";

export function isPushPresentationBlocked(userId: string): boolean {
  return pushPresentationBlockedUsers.has(userId);
}

function getProjectId(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default;
    return (
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      undefined
    );
  } catch {
    return undefined;
  }
}

export interface PushRegistrationResult {
  ok: boolean;
  token?: string;
  reason?:
    | "unsupported"
    | "denied"
    | "no_project_id"
    | "unauthenticated"
    | "network";
}

async function serializePushOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = pushOperation;
  let release!: () => void;
  pushOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function getDeviceName(): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device");
    return Device?.deviceName ?? Device?.modelName ?? undefined;
  } catch {
    return undefined;
  }
}

async function postPushOwnership(
  path: "register" | "unregister",
  session: AuthSession,
  token: string,
  timeoutMs = 20_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getBaseUrl()}/api/push/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.authToken}`,
      },
      body: JSON.stringify(
        path === "register"
          ? {
              token,
              platform: Platform.OS,
              deviceName: await getDeviceName(),
            }
          : { token },
      ),
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

async function disableNativePushDelivery(): Promise<boolean> {
  const N = loadNotifications();
  if (
    !N ||
    Platform.OS === "web" ||
    typeof N.unregisterForNotificationsAsync !== "function"
  ) {
    return false;
  }
  const settleWithin = (operation: Promise<unknown>) =>
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2_000);
      void operation.then(
        () => {
          clearTimeout(timeout);
          resolve(true);
        },
        () => {
          clearTimeout(timeout);
          resolve(false);
        },
      );
    });
  try {
    const unregisterOperation = N.unregisterForNotificationsAsync();
    let dismissOperation: Promise<unknown> = Promise.resolve();
    try {
      dismissOperation = N.dismissAllNotificationsAsync();
    } catch {
      // Delivered-notification cleanup is secondary to token revocation.
    }
    const [nativeDetached] = await Promise.all([
      settleWithin(unregisterOperation),
      settleWithin(dismissOperation),
    ]);
    return nativeDetached;
  } catch {
    return false;
  }
}

async function quarantineUnresolvedOwnership(
  ownership: PushOwnership,
): Promise<void> {
  pushPresentationBlockedUsers.add(ownership.userId);
  await pushCleanup.record(ownership);
  await disableNativePushDelivery();
}

async function retryPendingCleanup(session: AuthSession): Promise<{
  complete: boolean;
  intents: readonly PushCleanupIntent[] | null;
}> {
  const intents = await pushCleanup.read();
  const userIntents = intents?.filter(
    (intent) => intent.userId === session.userId,
  );
  // Process one durable intent per lifecycle pass. This bounds reconnect work;
  // the coordinator retries until the journal is empty.
  const attemptedIntents = userIntents?.slice(0, 1) ?? intents;
  const complete = await runPushCleanupForUser({
    userId: session.userId,
    intents: attemptedIntents,
    isCurrent: () => sessionStillCurrent(session),
    unregister: (intent) =>
      postPushOwnership("unregister", session, intent.token, 4_000),
    remove: (intent) => pushCleanup.remove(intent),
  });
  return {
    complete: complete && (userIntents?.length ?? 0) <= 1,
    intents,
  };
}

async function disableCachedOwnershipForCurrentUser(
  expectedUserId?: string,
): Promise<void> {
  const cached = parseCachedPushOwnership(
    await AsyncStorage.getItem(TOKEN_CACHE_KEY),
  );
  if (!cached || (expectedUserId && cached.userId !== expectedUserId)) return;
  const session = await getAuthSession(cached.userId);
  if (!session) return;
  if (await postPushOwnership("unregister", session, cached.token)) {
    await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
  }
}

async function preparePushLogout(expectedUserId: string): Promise<boolean> {
  pushPresentationBlockedUsers.add(expectedUserId);
  try {
    const cached = parseCachedPushOwnership(
      await AsyncStorage.getItem(TOKEN_CACHE_KEY),
    );
    if (cached?.userId === expectedUserId) {
      const journaled = await pushCleanup.record(cached);
      if (journaled) {
        const raw = await AsyncStorage.getItem(TOKEN_CACHE_KEY);
        const currentCache = parseCachedPushOwnership(raw);
        if (
          currentCache?.userId === cached.userId &&
          currentCache.token === cached.token
        ) {
          await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
        }
      }
    }
  } catch {
    // Keep the cache as a durable fallback when the journal cannot be written.
  }
  // This runs before entering the serialized network queue so a slow in-flight
  // registration cannot postpone local privacy protection during logout.
  return disableNativePushDelivery();
}

async function registerPushOwnership(
  requestPermission: boolean,
  expectedUserId?: string,
): Promise<PushRegistrationResult> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") {
    return { ok: false, reason: "unsupported" };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device");
    if (Device?.isDevice === false) {
      return { ok: false, reason: "unsupported" };
    }
  } catch {
    // A missing optional device module is handled by the token request below.
  }

  try {
    const session = await getAuthSession(expectedUserId);
    if (!session) return { ok: false, reason: "unauthenticated" };
    const cleanup = await retryPendingCleanup(session);

    const existing = await N.getPermissionsAsync();
    const granted = await resolvePushPermission(
      existing.granted,
      requestPermission,
      async () => (await N.requestPermissionsAsync()).granted,
    );
    if (!granted) {
      await disableCachedOwnershipForCurrentUser(expectedUserId);
      return { ok: false, reason: "denied" };
    }

    const projectId = getProjectId();
    if (!projectId) return { ok: false, reason: "no_project_id" };

    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    if (!token) return { ok: false, reason: "unsupported" };

    const cached = parseCachedPushOwnership(
      await AsyncStorage.getItem(TOKEN_CACHE_KEY),
    );
    // A crash can leave both the cache and its write-ahead cleanup intent.
    // Treat that token as unregistered even if cleanup failed: registration is
    // an idempotent upsert and restores the desired current-account state.
    const tokenWasPendingCleanup = cleanup.intents?.some(
      (intent) => intent.userId === session.userId && intent.token === token,
    );
    const transition = planPushOwnershipTransition(
      tokenWasPendingCleanup ? null : cached,
      session.userId,
      token,
    );
    const mutation = await runPushOwnershipMutation({
      session,
      token,
      transition,
      isSessionCurrent: sessionStillCurrent,
      register: (capturedSession, value) =>
        postPushOwnership("register", capturedSession, value),
      unregister: (capturedSession, value) =>
        postPushOwnership("unregister", capturedSession, value),
    });
    if (mutation.status === "network") {
      return { ok: false, reason: "network" };
    }
    if (mutation.status === "stale") {
      if (!mutation.compensated) {
        await quarantineUnresolvedOwnership({
          userId: session.userId,
          token,
        });
      }
      return {
        ok: false,
        reason: mutation.compensated ? "unauthenticated" : "network",
      };
    }

    if (mutation.status === "registered") {
      if (!(await sessionStillCurrent(session))) {
        const compensated = await postPushOwnership(
          "unregister",
          session,
          token,
        );
        if (!compensated) {
          await quarantineUnresolvedOwnership({
            userId: session.userId,
            token,
          });
        }
        return {
          ok: false,
          reason: compensated ? "unauthenticated" : "network",
        };
      }
      const ownership: PushOwnership = { userId: session.userId, token };
      const serializedOwnership = JSON.stringify(ownership);
      await pushCleanup.record(ownership);
      const persistence = await persistPushOwnershipOrCompensate({
        session,
        ownership,
        persist: async () => {
          await AsyncStorage.setItem(TOKEN_CACHE_KEY, serializedOwnership);
        },
        compensate: (capturedSession, value) =>
          postPushOwnership("unregister", capturedSession, value),
      });
      if (persistence.status === "persistence-failed") {
        if (persistence.compensated) {
          await pushCleanup.remove(ownership);
        } else {
          await quarantineUnresolvedOwnership(ownership);
        }
        return {
          ok: false,
          reason: "network",
        };
      }
      if (!(await sessionStillCurrent(session))) {
        const compensated = await postPushOwnership(
          "unregister",
          session,
          token,
        );
        if (
          (await AsyncStorage.getItem(TOKEN_CACHE_KEY)) === serializedOwnership
        ) {
          await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
        }
        if (compensated) {
          await pushCleanup.remove(ownership);
        } else {
          await quarantineUnresolvedOwnership(ownership);
        }
        return {
          ok: false,
          reason: compensated ? "unauthenticated" : "network",
        };
      }
      await pushCleanup.removeToken(token);
      if (cached?.userId === session.userId && cached.token !== token) {
        await pushCleanup.removeToken(cached.token);
      }
    }
    const remainingCleanup = await pushCleanup.read();
    if (
      remainingCleanup === null ||
      remainingCleanup.some((intent) => intent.userId === session.userId)
    ) {
      pushPresentationBlockedUsers.add(session.userId);
      return { ok: false, reason: "network" };
    }
    pushPresentationBlockedUsers.delete(session.userId);
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Explicit user-invoked flow. This is the only path allowed to prompt. */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  return serializePushOperation(() => registerPushOwnership(true));
}

/** Backward-compatible name for existing settings call sites. */
export async function registerForPush(): Promise<PushRegistrationResult> {
  return registerForPushNotifications();
}

/** Launch/account reconciliation. It only uses permission already granted. */
export async function reconcilePushRegistration(
  userId: string,
): Promise<PushRegistrationResult> {
  return serializePushOperation(() => registerPushOwnership(false, userId));
}

interface ServerPushCleanupOutcome {
  serverDetached: boolean;
  cleanupPending: boolean;
}

async function serverPushCleanupForLogout(
  expectedUserId: string,
): Promise<ServerPushCleanupOutcome> {
  try {
    const cached = parseCachedPushOwnership(
      await AsyncStorage.getItem(TOKEN_CACHE_KEY),
    );
    if (cached && cached.userId !== expectedUserId) {
      return { serverDetached: false, cleanupPending: true };
    }

    if (cached) {
      const session = await getAuthSession(expectedUserId);
      if (!session) return { serverDetached: false, cleanupPending: true };
      const journaled = await pushCleanup.record(cached);
      let detached = false;
      for (let attempt = 0; attempt < 2 && !detached; attempt += 1) {
        try {
          detached = await postPushOwnership(
            "unregister",
            session,
            cached.token,
            4_000,
          );
        } catch {
          detached = false;
        }
      }
      if (!detached) return { serverDetached: false, cleanupPending: true };
      const journalRemoved = await pushCleanup.remove(cached);
      try {
        const current = parseCachedPushOwnership(
          await AsyncStorage.getItem(TOKEN_CACHE_KEY),
        );
        if (
          current?.userId === cached.userId &&
          current.token === cached.token
        ) {
          await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
        }
      } catch {
        // Server detachment is authoritative even if local cleanup must retry.
      }
      return {
        serverDetached: true,
        cleanupPending: !journaled || !journalRemoved,
      };
    }

    const pending = await pushCleanup.read();
    if (pending === null) {
      return { serverDetached: false, cleanupPending: true };
    }
    const currentIntents = pending.filter(
      (intent) => intent.userId === expectedUserId,
    );
    if (currentIntents.length === 0) {
      return { serverDetached: true, cleanupPending: false };
    }

    const session = await getAuthSession(expectedUserId);
    if (!session) return { serverDetached: false, cleanupPending: true };
    const intent = currentIntents[0];
    if (!intent) return { serverDetached: false, cleanupPending: true };
    let detached = false;
    try {
      detached = await postPushOwnership(
        "unregister",
        session,
        intent.token,
        4_000,
      );
    } catch {
      detached = false;
    }
    if (!detached) return { serverDetached: false, cleanupPending: true };
    const removed = await pushCleanup.remove(intent);
    return {
      serverDetached: currentIntents.length === 1,
      cleanupPending: currentIntents.length > 1 || !removed,
    };
  } catch {
    return { serverDetached: false, cleanupPending: true };
  }
}

function boundedServerCleanup(
  operation: Promise<ServerPushCleanupOutcome>,
): Promise<ServerPushCleanupOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ServerPushCleanupOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(outcome);
    };
    const timeout = setTimeout(
      () => finish({ serverDetached: false, cleanupPending: true }),
      8_500,
    );
    void operation.then(
      (outcome) => finish(outcome),
      () => finish({ serverDetached: false, cleanupPending: true }),
    );
  });
}

/**
 * Detach server and native push ownership before logout.
 *
 * At least one independently verified channel must be detached before auth is
 * allowed to sign out. The durable journal remains when only native revocation
 * succeeds, so server cleanup can resume when the same account reconnects.
 */
export async function unregisterFromPush(
  expectedUserId: string,
): Promise<PushLogoutDetachmentOutcome> {
  const nativeDetached = await preparePushLogout(expectedUserId);
  const serverCleanup = await boundedServerCleanup(
    serializePushOperation(() => serverPushCleanupForLogout(expectedUserId)),
  );
  return { ...serverCleanup, nativeDetached };
}

/** Ask the server to push to this account, to verify the pipeline end to end. */
export async function sendTestPush(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await getAuthSession();
    if (!session) return { ok: false, message: "Please sign in first." };

    const response = await fetch(`${getBaseUrl()}/api/push/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.authToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      return {
        ok: true,
        message: "Test notification sent. It should arrive shortly.",
      };
    }
    return {
      ok: false,
      message: body?.error ?? "Could not send a test notification.",
    };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
