import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseAuth } from "./firebase";
import {
  parseCachedPushOwnership,
  planPushOwnershipTransition,
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
    if (!authToken || auth.currentUser?.uid !== current.uid) return null;
    return { userId: current.uid, authToken };
  } catch {
    return null;
  }
}

async function sessionStillOwns(userId: string): Promise<boolean> {
  try {
    return (await getFirebaseAuth())?.currentUser?.uid === userId;
  } catch {
    return false;
  }
}

const TOKEN_CACHE_KEY = "@elovia_push_token";

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
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
    const existing = await N.getPermissionsAsync();
    const granted =
      existing.granted ||
      (requestPermission && (await N.requestPermissionsAsync()).granted);
    if (!granted) {
      await disableCachedOwnershipForCurrentUser(expectedUserId);
      return { ok: false, reason: "denied" };
    }

    const projectId = getProjectId();
    if (!projectId) return { ok: false, reason: "no_project_id" };

    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    if (!token) return { ok: false, reason: "unsupported" };

    const session = await getAuthSession(expectedUserId);
    if (!session) return { ok: false, reason: "unauthenticated" };

    const cached = parseCachedPushOwnership(
      await AsyncStorage.getItem(TOKEN_CACHE_KEY),
    );
    const transition = planPushOwnershipTransition(
      cached,
      session.userId,
      token,
    );
    if (transition.action === "noop") return { ok: true, token };

    // Only the same account's rotated token can be unregistered here. An
    // ownership change is transferred by the register upsert and never tries
    // to authorize a previous user's unregister with a new session.
    if (transition.action === "replace-current-token") {
      await postPushOwnership(
        "unregister",
        session,
        transition.unregisterToken,
      );
    }

    if (!(await postPushOwnership("register", session, token))) {
      return { ok: false, reason: "network" };
    }
    if (!(await sessionStillOwns(session.userId))) {
      return { ok: false, reason: "unauthenticated" };
    }

    const ownership: PushOwnership = { userId: session.userId, token };
    await AsyncStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(ownership));
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

/** Stop server-sent notifications while the owning user is still signed in. */
export async function unregisterFromPush(
  expectedUserId?: string,
): Promise<boolean> {
  return serializePushOperation(async () => {
    try {
      const cached = parseCachedPushOwnership(
        await AsyncStorage.getItem(TOKEN_CACHE_KEY),
      );
      if (!cached) return true;
      if (expectedUserId && cached.userId !== expectedUserId) return false;
      const session = await getAuthSession(cached.userId);
      if (!session) return false;
      const ok = await postPushOwnership("unregister", session, cached.token);
      if (ok) await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
      return ok;
    } catch {
      return false;
    }
  });
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
