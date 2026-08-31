import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getFirebaseAuth } from "./firebase";
import {
  classifyBackupResponse,
  classifyRestoreResponse,
  revisionStorageKey,
  type BackupOutcome,
  type RestoreOutcome,
} from "./cloudSyncContract";

/**
 * Cloud sync against the Postgres-backed API. Firebase Auth remains the
 * identity provider, but the ID token and uid are never persisted or logged.
 */

const SYNC_KEYS = [
  "@elovia_state",
  "@elovia_plan",
  "@elovia_custom_plans",
  "@elovia_active_plan_type",
  "@elovia_active_custom_plan_id",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_active_meal_plan_type",
  "@elovia_active_custom_meal_plan_id",
  "@elovia_health_data",
] as const;

const FIELD_MAP: Record<string, string> = {
  "@elovia_state": "appState",
  "@elovia_plan": "workoutPlan",
  "@elovia_custom_plans": "customPlans",
  "@elovia_active_plan_type": "activePlanType",
  "@elovia_active_custom_plan_id": "activeCustomPlanId",
  "@elovia_sessions": "sessions",
  "@elovia_prs": "personalRecords",
  "@elovia_meal_plan": "mealPlan",
  "@elovia_food_log": "foodLog",
  "@elovia_custom_meal_plans": "customMealPlans",
  "@elovia_active_meal_plan_type": "activeMealPlanType",
  "@elovia_active_custom_meal_plan_id": "activeCustomMealPlanId",
  "@elovia_health_data": "healthData",
};

const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([key, field]) => [field, key]),
);

const JSON_KEYS = new Set([
  "@elovia_state",
  "@elovia_plan",
  "@elovia_custom_plans",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_health_data",
]);

type AuthIdentity = { uid: string; token: string };

export type LegacyMigrationOutcome =
  | { status: "migrated"; cloudBackup: BackupOutcome }
  | { status: "empty" }
  | { status: "server" };

const conflictBlockedUsers = new Set<string>();

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

async function getAuthIdentity(): Promise<AuthIdentity | null> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    if (!token) return null;
    return { uid: user.uid, token };
  } catch {
    return null;
  }
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

async function readStoredRevision(uid: string): Promise<number | null> {
  const key = revisionStorageKey(uid);
  const stored = await AsyncStorage.getItem(key);
  if (stored === null) return null;

  const revision = Number(stored);
  if (!/^\d+$/.test(stored) || !isRevision(revision)) {
    await AsyncStorage.removeItem(key);
    return null;
  }
  return revision;
}

async function collectLocalPayload(): Promise<Record<string, unknown>> {
  const entries = await AsyncStorage.multiGet([...SYNC_KEYS]);
  const payload: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    const field = FIELD_MAP[key];
    if (!field || value === null) continue;

    if (JSON_KEYS.has(key)) {
      // Refuse a partial backup when a local JSON document is corrupt. A
      // partial snapshot is more dangerous than asking the user to retry.
      payload[field] = JSON.parse(value);
    } else {
      payload[field] = value;
    }
  }

  return payload;
}

export function payloadHasContent(payload: Record<string, unknown>): boolean {
  // Presence, not truthiness, is the contract. A stored JSON null is an
  // intentional clear and must reach the server; a fresh device has no keys.
  return Object.keys(payload).length > 0;
}

export function isCloudSyncConflictBlocked(uid: string): boolean {
  return conflictBlockedUsers.has(uid);
}

/** A newly authenticated session is allowed one fresh restore attempt. */
export function beginCloudSyncSession(uid: string): void {
  conflictBlockedUsers.delete(uid);
}

/** Upload local state without ever overwriting a newer cloud revision. */
export async function backupToCloud(): Promise<BackupOutcome> {
  const identity = await getAuthIdentity();
  if (!identity) return { status: "unauthorized" };

  let payload: Record<string, unknown>;
  let baseRevision: number | null;
  try {
    payload = await collectLocalPayload();
    baseRevision = await readStoredRevision(identity.uid);
  } catch {
    return { status: "server" };
  }

  if (!payloadHasContent(payload)) return { status: "empty" };

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}/api/user-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${identity.token}`,
      },
      body: JSON.stringify({ baseRevision, ...payload }),
    });
  } catch {
    return { status: "offline" };
  }

  let body: unknown = null;
  if (response.ok || response.status === 409) {
    try {
      body = await response.json();
    } catch {
      return { status: "server" };
    }
  }

  const envelope =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const outcome = classifyBackupResponse(
    response.status,
    envelope.revision,
    Object.hasOwn(envelope, "currentRevision")
      ? envelope.currentRevision
      : undefined,
  );

  if (outcome.status === "conflict") {
    conflictBlockedUsers.add(identity.uid);
    return outcome;
  }

  if (outcome.status === "saved") {
    try {
      await AsyncStorage.setItem(
        revisionStorageKey(identity.uid),
        String(outcome.revision),
      );
    } catch {
      return { status: "server" };
    }
  }

  return outcome;
}

/** Pull a validated server snapshot into AsyncStorage. */
export async function restoreFromCloud(): Promise<RestoreOutcome> {
  const identity = await getAuthIdentity();
  if (!identity) return { status: "unauthorized" };

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}/api/user-data`, {
      headers: { Authorization: `Bearer ${identity.token}` },
    });
  } catch {
    return { status: "offline" };
  }

  if (response.status === 401 || response.status === 403)
    return { status: "unauthorized" };
  if (!response.ok) return { status: "server" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "server" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body))
    return { status: "server" };
  const envelope = body as Record<string, unknown>;
  if (
    !Object.hasOwn(envelope, "data") ||
    !Object.hasOwn(envelope, "revision")
  ) {
    return { status: "server" };
  }

  const data = envelope.data;
  if (data === null) {
    if (envelope.revision !== null) return { status: "server" };
    try {
      await AsyncStorage.removeItem(revisionStorageKey(identity.uid));
      conflictBlockedUsers.delete(identity.uid);
      return { status: "empty" };
    } catch {
      return { status: "server" };
    }
  }

  if (typeof data !== "object" || Array.isArray(data))
    return { status: "server" };
  const outcome = classifyRestoreResponse(
    response.status,
    true,
    envelope.revision,
  );
  if (outcome.status !== "restored") return outcome;

  const pairs: [string, string][] = [];
  const removals: string[] = [];
  try {
    for (const [field, value] of Object.entries(data)) {
      const key = REVERSE_FIELD_MAP[field];
      if (!key) continue;

      if (value === null) {
        removals.push(key);
        continue;
      }

      const serialized = JSON_KEYS.has(key)
        ? JSON.stringify(value)
        : String(value);
      if (serialized === undefined) return { status: "server" };
      pairs.push([key, serialized]);
    }

    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
    if (removals.length > 0) await AsyncStorage.multiRemove(removals);
    await AsyncStorage.setItem(
      revisionStorageKey(identity.uid),
      String(outcome.revision),
    );
    conflictBlockedUsers.delete(identity.uid);
    return outcome;
  } catch {
    return { status: "server" };
  }
}

const MIGRATION_FLAG = "@elovia_rtdb_migrated";

/**
 * Pull an old Realtime Database snapshot only after Postgres definitively
 * reported an empty account. The typed result preserves local-restore success
 * even when securing that migrated copy in Postgres fails.
 */
export async function migrateLegacyFirebaseData(
  userId: string,
): Promise<LegacyMigrationOutcome> {
  const migrationKey = `${MIGRATION_FLAG}:${encodeURIComponent(userId)}`;
  let found: boolean;
  try {
    if (await AsyncStorage.getItem(migrationKey)) return { status: "empty" };

    const { restoreFromFirestore } = await import("./firebaseSync");
    found = await restoreFromFirestore(userId);
    if (!found) {
      await AsyncStorage.setItem(migrationKey, new Date().toISOString());
      return { status: "empty" };
    }
  } catch {
    return { status: "server" };
  }

  // Once the legacy read succeeded, preserve that fact even if securing the
  // local copy in Postgres or writing the one-time flag fails.
  const cloudBackup = await backupToCloud().catch(
    (): BackupOutcome => ({ status: "server" }),
  );
  if (cloudBackup.status === "saved") {
    try {
      await AsyncStorage.setItem(migrationKey, new Date().toISOString());
    } catch {
      // The data is already restored locally and saved remotely. A future
      // launch may recheck legacy storage, but optimistic concurrency keeps it
      // from overwriting the newer Postgres revision.
    }
  }
  return { status: "migrated", cloudBackup };
}
