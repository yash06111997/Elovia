import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getFirebaseAuth } from "./firebase";
import {
  classifyBackupResponse,
  classifyRestoreResponse,
  revisionStorageKey,
  serializeRestoreFields,
  type BackupOutcome,
  type RestoreFieldKind,
  type RestoreOutcome,
} from "./cloudSyncContract";
import {
  SyncStorageCoordinator,
  type OwnerPreparationOutcome,
} from "./cloudSyncStorage";

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

const RESTORE_FIELD_KINDS: Record<string, RestoreFieldKind> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([key, field]) => [
    field,
    JSON_KEYS.has(key) ? "json" : "scalar",
  ]),
);

type AuthIdentity = { uid: string; token: string };

export type LocalSyncOwnerOutcome =
  | OwnerPreparationOutcome
  | { status: "server" };

export type LegacyMigrationOutcome =
  | { status: "migrated"; cloudBackup: BackupOutcome }
  | { status: "empty" }
  | { status: "unauthorized" }
  | { status: "server" };

const conflictBlockedUsers = new Set<string>();
const syncStorage = new SyncStorageCoordinator(AsyncStorage, SYNC_KEYS);

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

export async function getCurrentCloudSyncUserId(): Promise<string | null> {
  try {
    const auth = await getFirebaseAuth();
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

async function getAuthIdentity(expectedUserId?: string): Promise<AuthIdentity | null> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user || (expectedUserId !== undefined && user.uid !== expectedUserId)) return null;
    const token = await user.getIdToken();
    if (!token) return null;
    return { uid: user.uid, token };
  } catch {
    return null;
  }
}

export async function prepareLocalSyncOwner(
  expectedUserId: string,
): Promise<LocalSyncOwnerOutcome> {
  try {
    return await syncStorage.prepareOwner(
      expectedUserId,
      getCurrentCloudSyncUserId,
    );
  } catch {
    return { status: "server" };
  }
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function parseStoredRevision(stored: string | null): number | null | "corrupt" {
  if (stored === null) return null;
  const revision = Number(stored);
  return /^\d+$/.test(stored) && isRevision(revision) ? revision : "corrupt";
}

function collectLocalPayload(
  entries: readonly (readonly [string, string | null])[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const field = FIELD_MAP[key];
    if (!field || value === null) continue;
    payload[field] = JSON_KEYS.has(key) ? JSON.parse(value) : value;
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

/** Upload local state without ever reading another account's shared keys. */
export async function backupToCloud(expectedUserId?: string): Promise<BackupOutcome> {
  const identity = await getAuthIdentity(expectedUserId);
  if (!identity) return { status: "unauthorized" };

  const owner = await prepareLocalSyncOwner(identity.uid);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  const revisionKey = revisionStorageKey(identity.uid);
  let ownedRead;
  try {
    ownedRead = await syncStorage.readOwned(
      identity.uid,
      getCurrentCloudSyncUserId,
      [...SYNC_KEYS, revisionKey],
    );
  } catch {
    return { status: "server" };
  }
  if (ownedRead.status === "stale") return { status: "unauthorized" };

  let payload: Record<string, unknown>;
  let baseRevision: number | null;
  try {
    const values = new Map(ownedRead.value);
    payload = collectLocalPayload(
      SYNC_KEYS.map((key) => [key, values.get(key) ?? null] as const),
    );
    const parsedRevision = parseStoredRevision(values.get(revisionKey) ?? null);
    if (parsedRevision === "corrupt") {
      const removed = await syncStorage.commitOwned(
        identity.uid,
        getCurrentCloudSyncUserId,
        [],
        [revisionKey],
      );
      if (removed.status === "stale") return { status: "unauthorized" };
      baseRevision = null;
    } else {
      baseRevision = parsedRevision;
    }
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
      const persisted = await syncStorage.commitOwned(
        identity.uid,
        getCurrentCloudSyncUserId,
        [[revisionKey, String(outcome.revision)]],
        [],
      );
      if (persisted.status === "stale") return { status: "unauthorized" };
    } catch {
      return { status: "server" };
    }
  }

  return outcome;
}

/** Pull a validated server snapshot into the expected account's local keys. */
export async function restoreFromCloud(
  expectedUserId?: string,
): Promise<RestoreOutcome> {
  const identity = await getAuthIdentity(expectedUserId);
  if (!identity) return { status: "unauthorized" };

  const owner = await prepareLocalSyncOwner(identity.uid);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}/api/user-data`, {
      headers: { Authorization: `Bearer ${identity.token}` },
    });
  } catch {
    return { status: "offline" };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: "unauthorized" };
  }
  if (!response.ok) return { status: "server" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "server" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "server" };
  }
  const envelope = body as Record<string, unknown>;
  if (!Object.hasOwn(envelope, "data") || !Object.hasOwn(envelope, "revision")) {
    return { status: "server" };
  }

  const revisionKey = revisionStorageKey(identity.uid);
  const data = envelope.data;
  if (data === null) {
    if (envelope.revision !== null) return { status: "server" };
    try {
      const committed = await syncStorage.commitOwned(
        identity.uid,
        getCurrentCloudSyncUserId,
        [],
        [revisionKey],
      );
      if (committed.status === "stale") return { status: "unauthorized" };
      conflictBlockedUsers.delete(identity.uid);
      return { status: "empty" };
    } catch {
      return { status: "server" };
    }
  }

  const outcome = classifyRestoreResponse(response.status, true, envelope.revision);
  if (outcome.status !== "restored") return outcome;

  // Validate and serialize every known field before the storage mutex is
  // acquired, so malformed scalar/JSON data cannot partially mutate storage.
  const serialized = serializeRestoreFields(data, RESTORE_FIELD_KINDS);
  if (serialized.status === "invalid") return { status: "server" };

  const pairs: [string, string][] = [];
  const removals: string[] = [];
  for (const [field, value] of serialized.changes) {
    const key = REVERSE_FIELD_MAP[field];
    if (!key) continue;
    if (value === null) removals.push(key);
    else pairs.push([key, value]);
  }

  try {
    const committed = await syncStorage.commitOwned(
      identity.uid,
      getCurrentCloudSyncUserId,
      pairs,
      removals,
      [[revisionKey, String(outcome.revision)]],
    );
    if (committed.status === "stale") return { status: "unauthorized" };
    conflictBlockedUsers.delete(identity.uid);
    return outcome;
  } catch {
    return { status: "server" };
  }
}

const MIGRATION_FLAG = "@elovia_rtdb_migrated";

/** Pull a legacy snapshot only for the currently authenticated local owner. */
export async function migrateLegacyFirebaseData(
  expectedUserId: string,
): Promise<LegacyMigrationOutcome> {
  if ((await getCurrentCloudSyncUserId()) !== expectedUserId) {
    return { status: "unauthorized" };
  }

  const owner = await prepareLocalSyncOwner(expectedUserId);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  const migrationKey = `${MIGRATION_FLAG}:${encodeURIComponent(expectedUserId)}`;
  try {
    const flag = await syncStorage.readOwned(
      expectedUserId,
      getCurrentCloudSyncUserId,
      [migrationKey],
    );
    if (flag.status === "stale") return { status: "unauthorized" };
    if (flag.value[0]?.[1]) return { status: "empty" };

    const { restoreFromFirestore } = await import("./firebaseSync");
    const legacyRestore = await syncStorage.runOwnedMutation(
      expectedUserId,
      getCurrentCloudSyncUserId,
      () => restoreFromFirestore(expectedUserId),
    );
    if (legacyRestore.status === "stale") return { status: "unauthorized" };

    if (!legacyRestore.value) {
      const flagged = await syncStorage.commitOwned(
        expectedUserId,
        getCurrentCloudSyncUserId,
        [[migrationKey, new Date().toISOString()]],
        [],
      );
      return flagged.status === "stale"
        ? { status: "unauthorized" }
        : { status: "empty" };
    }
  } catch {
    return { status: "server" };
  }

  const cloudBackup = await backupToCloud(expectedUserId).catch(
    (): BackupOutcome => ({ status: "server" }),
  );
  if (cloudBackup.status === "saved") {
    try {
      await syncStorage.commitOwned(
        expectedUserId,
        getCurrentCloudSyncUserId,
        [[migrationKey, new Date().toISOString()]],
        [],
      );
    } catch {
      // Local restore and cloud save already succeeded. Optimistic concurrency
      // keeps a future migration check from overwriting a newer revision.
    }
  }
  return { status: "migrated", cloudBackup };
}
