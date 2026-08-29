import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseAuth } from "./firebase";

/**
 * Expo push token registration.
 *
 * Push covers what the SERVER knows and the device cannot: a weekly digest
 * computed from synced data, a subscription event, a coach follow-up. Purely
 * time-based reminders stay in the local scheduler, where they need no network
 * and no token.
 */

type NotificationsModule = typeof import("expo-notifications");

let cachedNotifications: NotificationsModule | null = null;
let notificationsLoadAttempted = false;

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

async function getAuthToken(): Promise<string | null> {
  try {
    const auth = await getFirebaseAuth();
    return (await auth?.currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
}

const TOKEN_CACHE_KEY = "@elovia_push_token";

/**
 * Resolve the Expo project id.
 *
 * getExpoPushTokenAsync requires this in SDK 49+, and omitting it is the most
 * common reason push "silently does nothing" in a production build.
 */
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
  reason?: "unsupported" | "denied" | "no_project_id" | "unauthenticated" | "network";
}

/**
 * Ask for permission, obtain a token, and register it with the server.
 *
 * Safe to call repeatedly: the server upserts on the token, and an unchanged
 * token short-circuits before the network call.
 */
export async function registerForPush(): Promise<PushRegistrationResult> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return { ok: false, reason: "unsupported" };

  try {
    // A simulator cannot receive push. Reporting this honestly beats leaving
    // the user staring at a toggle that appears to work.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device");
    if (Device?.isDevice === false) return { ok: false, reason: "unsupported" };
  } catch {
    // expo-device missing is not fatal; continue and let the token call decide.
  }

  try {
    const existing = await N.getPermissionsAsync();
    let granted = existing.granted;

    if (!granted) {
      const requested = await N.requestPermissionsAsync();
      granted = requested.granted;
    }

    if (!granted) return { ok: false, reason: "denied" };

    const projectId = getProjectId();
    if (!projectId) return { ok: false, reason: "no_project_id" };

    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    if (!token) return { ok: false, reason: "unsupported" };

    const authToken = await getAuthToken();
    if (!authToken) return { ok: false, reason: "unauthenticated" };

    const cached = await AsyncStorage.getItem(TOKEN_CACHE_KEY);
    if (cached === token) return { ok: true, token };

    const response = await fetch(`${getBaseUrl()}/api/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        deviceName: await getDeviceName(),
      }),
    });

    if (!response.ok) return { ok: false, reason: "network" };

    await AsyncStorage.setItem(TOKEN_CACHE_KEY, token);
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "network" };
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

/** Stop server-sent notifications for this device. */
export async function unregisterFromPush(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_CACHE_KEY);
    if (!token) return true;

    const authToken = await getAuthToken();
    if (!authToken) return false;

    const response = await fetch(`${getBaseUrl()}/api/push/unregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });

    if (response.ok) await AsyncStorage.removeItem(TOKEN_CACHE_KEY);
    return response.ok;
  } catch {
    return false;
  }
}

/** Ask the server to push to this account, to verify the pipeline end to end. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const authToken = await getAuthToken();
    if (!authToken) return { ok: false, message: "Please sign in first." };

    const response = await fetch(`${getBaseUrl()}/api/push/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      return { ok: true, message: "Test notification sent. It should arrive shortly." };
    }

    return {
      ok: false,
      message: body?.error ?? "Could not send a test notification.",
    };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
