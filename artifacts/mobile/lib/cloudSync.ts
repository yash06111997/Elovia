import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getFirebaseAuth } from "./firebase";

/**
 * Cloud sync against the Postgres-backed API.
 *
 * This replaces the previous Firebase Realtime Database sync as the primary
 * store. The app had TWO server-side stores - RTDB (written by the client) and
 * a `user_data` Postgres table (exposed by the API but never called) - with
 * nothing reconciling them. Entitlements and AI quotas already live in
 * Postgres, so consolidating there leaves exactly one source of truth.
 *
 * Firebase Auth is unchanged and still issues the token used here.
 */

const SYNC_KEYS = [
  "@fitai_state",
  "@fitai_plan",
  "@fitai_custom_plans",
  "@fitai_active_plan_type",
  "@fitai_active_custom_plan_id",
  "@fitai_sessions",
  "@fitai_prs",
  "@fitai_meal_plan",
  "@fitai_food_log",
  "@fitai_custom_meal_plans",
  "@fitai_active_meal_plan_type",
  "@fitai_active_custom_meal_plan_id",
  "@fitai_health_data",
] as const;

const FIELD_MAP: Record<string, string> = {
  "@fitai_state": "appState",
  "@fitai_plan": "workoutPlan",
  "@fitai_custom_plans": "customPlans",
  "@fitai_active_plan_type": "activePlanType",
  "@fitai_active_custom_plan_id": "activeCustomPlanId",
  "@fitai_sessions": "sessions",
  "@fitai_prs": "personalRecords",
  "@fitai_meal_plan": "mealPlan",
  "@fitai_food_log": "foodLog",
  "@fitai_custom_meal_plans": "customMealPlans",
  "@fitai_active_meal_plan_type": "activeMealPlanType",
  "@fitai_active_custom_meal_plan_id": "activeCustomMealPlanId",
  "@fitai_health_data": "healthData",
};

const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k]),
);

const JSON_KEYS = new Set([
  "@fitai_state",
  "@fitai_plan",
  "@fitai_custom_plans",
  "@fitai_sessions",
  "@fitai_prs",
  "@fitai_meal_plan",
  "@fitai_food_log",
  "@fitai_custom_meal_plans",
  "@fitai_health_data",
]);

/**
 * Subscription state is deliberately NOT synced from the client any more.
 * It is derived server-side from the RevenueCat webhook, so uploading the
 * client's opinion of it would be, at best, ignored.
 */

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

async function getAuthToken(): Promise<string | null> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/** Collect the locally-stored payload for upload. */
async function collectLocalPayload(): Promise<Record<string, unknown>> {
  const entries = await AsyncStorage.multiGet([...SYNC_KEYS]);
  const payload: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    const field = FIELD_MAP[key];
    if (!field || value == null) continue;

    if (JSON_KEYS.has(key)) {
      try {
        payload[field] = JSON.parse(value);
      } catch {
        // Skip unparseable blobs rather than uploading a corrupt string into
        // a jsonb column.
      }
    } else {
      payload[field] = value;
    }
  }

  return payload;
}

/**
 * Does the local device actually hold anything worth uploading?
 *
 * This is the guard that was missing. The old backup wrote whatever
 * AsyncStorage held straight over the cloud record with a destructive `set()`.
 * On a fresh install where restore had failed, that meant an empty payload
 * silently erased the user's entire history the next time the app was
 * backgrounded.
 */
export function payloadHasContent(payload: Record<string, unknown>): boolean {
  const meaningful = [
    "appState",
    "workoutPlan",
    "customPlans",
    "sessions",
    "personalRecords",
    "mealPlan",
    "foodLog",
  ];

  return meaningful.some((field) => {
    const value = payload[field];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
  });
}

export interface SyncResult {
  ok: boolean;
  reason?: "unauthenticated" | "empty" | "network" | "server";
}

/** Upload local state to the server. Refuses to upload an empty payload. */
export async function backupToCloud(): Promise<SyncResult> {
  const token = await getAuthToken();
  if (!token) return { ok: false, reason: "unauthenticated" };

  const payload = await collectLocalPayload();

  if (!payloadHasContent(payload)) {
    // Nothing to save. Critically, this is NOT an error - it is the guard that
    // stops an empty device from wiping a populated account.
    return { ok: false, reason: "empty" };
  }

  try {
    const response = await fetch(`${getBaseUrl()}/api/user-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    return response.ok ? { ok: true } : { ok: false, reason: "server" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Pull server state into AsyncStorage. Returns false when nothing is stored. */
export async function restoreFromCloud(): Promise<boolean> {
  const token = await getAuthToken();
  if (!token) return false;

  try {
    const response = await fetch(`${getBaseUrl()}/api/user-data`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return false;

    const body = (await response.json()) as { data: Record<string, unknown> | null };
    if (!body?.data) return false;

    const pairs: [string, string][] = [];

    for (const [field, value] of Object.entries(body.data)) {
      if (field === "updatedAt") continue;
      const key = REVERSE_FIELD_MAP[field];
      if (!key || value == null) continue;

      pairs.push([key, JSON_KEYS.has(key) ? JSON.stringify(value) : String(value)]);
    }

    if (pairs.length === 0) return false;

    await AsyncStorage.multiSet(pairs);
    return true;
  } catch {
    return false;
  }
}

const MIGRATION_FLAG = "@elovia_rtdb_migrated";

/**
 * One-time migration for accounts whose only copy lives in the old Realtime
 * Database.
 *
 * Runs only when the server has nothing for this user, so it can never clobber
 * newer Postgres data. After a successful pull it uploads to the API and marks
 * the device so this never runs again.
 */
export async function migrateLegacyFirebaseData(userId: string): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(MIGRATION_FLAG)) return false;

    const { restoreFromFirestore } = await import("./firebaseSync");
    const found = await restoreFromFirestore(userId);

    if (!found) {
      await AsyncStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
      return false;
    }

    const result = await backupToCloud();
    if (result.ok) {
      await AsyncStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
      return true;
    }

    // Upload failed: leave the flag unset so migration is retried next launch
    // rather than stranding the data.
    return true;
  } catch {
    return false;
  }
}
