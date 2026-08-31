import { Platform } from "react-native";
import { getFirebaseAuth } from "./firebase";
import {
  SYNC_KEYS,
  syncStorageCoordinator as syncStorage,
} from "./accountSyncStorage";
import {
  classifyBackupResponse,
  classifyAuthTokenFailure,
  classifyRestoreResponse,
  revisionStorageKey,
  serializeRestoreFields,
  type BackupOutcome,
  type RestoreFieldKind,
  type RestoreOutcome,
} from "./cloudSyncContract";
import { type OwnerPreparationOutcome } from "./cloudSyncStorage";
import { createCloudSyncNetworkOrchestrator } from "./cloudSyncOrchestrator";
import {
  beginCloudSyncSession as beginSessionToken,
  cloudSyncSessionUid,
  endCloudSyncSession,
  getCurrentCloudSyncSession,
  isCloudSyncSessionCurrent,
  type CloudSyncSessionToken,
} from "./cloudSyncSession";

export {
  endCloudSyncSession,
  getCurrentCloudSyncSession,
  isCloudSyncSessionCurrent,
  type CloudSyncSessionToken,
};

/**
 * Cloud sync against the Postgres-backed API. Firebase Auth remains the
 * identity provider, but the ID token and uid are never persisted or logged.
 */

const FIELD_MAP: Record<string, string> = {
  "@elovia_state": "appState",
  "@elovia_plan": "workoutPlan",
  "@elovia_active_session": "activeSession",
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
  "@elovia_wellness": "wellnessData",
  "@elovia_water_goal": "waterGoal",
};

const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([key, field]) => [field, key]),
);

const JSON_KEYS = new Set([
  "@elovia_state",
  "@elovia_plan",
  "@elovia_active_session",
  "@elovia_custom_plans",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_health_data",
  "@elovia_wellness",
  "@elovia_water_goal",
]);

const RESTORE_FIELD_KINDS: Record<string, RestoreFieldKind> =
  Object.fromEntries(
    Object.entries(FIELD_MAP).map(([key, field]) => [
      field,
      JSON_KEYS.has(key) ? "json" : "scalar",
    ]),
  );

type AuthIdentity = { uid: string; token: string };
type AuthIdentityOutcome =
  | { status: "ready"; identity: AuthIdentity }
  | { status: "offline" | "unauthorized" };

export type LocalSyncOwnerOutcome =
  | OwnerPreparationOutcome
  | { status: "server" };

export type LegacyMigrationOutcome =
  | { status: "migrated"; cloudBackup: BackupOutcome }
  | { status: "empty" }
  | { status: "unauthorized" }
  | { status: "server" };

const conflictBlockedUsers = new Set<string>();
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

async function sessionMatchesFirebase(
  sessionToken: CloudSyncSessionToken,
): Promise<boolean> {
  if (!isCloudSyncSessionCurrent(sessionToken)) return false;
  try {
    const auth = await getFirebaseAuth();
    return (
      isCloudSyncSessionCurrent(sessionToken) &&
      auth?.currentUser?.uid === cloudSyncSessionUid(sessionToken)
    );
  } catch {
    return false;
  }
}

function currentUserForSession(
  sessionToken: CloudSyncSessionToken,
): () => Promise<string | null> {
  return async () =>
    (await sessionMatchesFirebase(sessionToken))
      ? cloudSyncSessionUid(sessionToken)
      : "@elovia_sync_owner:stale-cloud-session";
}

const networkOrchestrator = createCloudSyncNetworkOrchestrator(
  sessionMatchesFirebase,
);

async function getAuthIdentity(
  sessionToken: CloudSyncSessionToken,
): Promise<AuthIdentityOutcome> {
  if (!isCloudSyncSessionCurrent(sessionToken)) {
    return { status: "unauthorized" };
  }
  let auth;
  try {
    auth = await getFirebaseAuth();
  } catch (error) {
    return isCloudSyncSessionCurrent(sessionToken)
      ? { status: classifyAuthTokenFailure(error) }
      : { status: "unauthorized" };
  }

  const user = auth?.currentUser;
  if (
    !isCloudSyncSessionCurrent(sessionToken) ||
    !user ||
    user.uid !== cloudSyncSessionUid(sessionToken)
  ) {
    return { status: "unauthorized" };
  }

  try {
    const token = await user.getIdToken();
    if (
      !token ||
      !isCloudSyncSessionCurrent(sessionToken) ||
      auth.currentUser?.uid !== cloudSyncSessionUid(sessionToken)
    ) {
      return { status: "unauthorized" };
    }
    return { status: "ready", identity: { uid: user.uid, token } };
  } catch (error) {
    return !isCloudSyncSessionCurrent(sessionToken) ||
      auth.currentUser?.uid !== cloudSyncSessionUid(sessionToken)
      ? { status: "unauthorized" }
      : { status: classifyAuthTokenFailure(error) };
  }
}

export async function prepareLocalSyncOwner(
  sessionToken: CloudSyncSessionToken,
): Promise<LocalSyncOwnerOutcome> {
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "stale" };
  }
  try {
    return await syncStorage.prepareOwner(
      cloudSyncSessionUid(sessionToken),
      currentUserForSession(sessionToken),
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
export function beginCloudSyncSession(uid: string): CloudSyncSessionToken {
  conflictBlockedUsers.delete(uid);
  return beginSessionToken(uid);
}

/** Upload local state without ever reading another account's shared keys. */
export async function backupToCloud(
  sessionToken: CloudSyncSessionToken,
): Promise<BackupOutcome> {
  const auth = await getAuthIdentity(sessionToken);
  if (auth.status !== "ready") return { status: auth.status };
  const identity = auth.identity;

  const owner = await prepareLocalSyncOwner(sessionToken);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  const revisionKey = revisionStorageKey(identity.uid);
  let ownedRead;
  try {
    ownedRead = await syncStorage.readOwned(
      identity.uid,
      currentUserForSession(sessionToken),
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
        currentUserForSession(sessionToken),
        [],
        [revisionKey],
      );
      if (removed.status === "stale") return { status: "unauthorized" };
      if (!(await sessionMatchesFirebase(sessionToken))) {
        return { status: "unauthorized" };
      }
      baseRevision = null;
    } else {
      baseRevision = parsedRevision;
    }
  } catch {
    return { status: "server" };
  }

  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }
  if (!payloadHasContent(payload)) return { status: "empty" };

  const requestBody = JSON.stringify({ baseRevision, ...payload });

  let guardedResponse;
  try {
    guardedResponse = await networkOrchestrator.execute(
      sessionToken,
      () =>
        fetch(`${getBaseUrl()}/api/user-data`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${identity.token}`,
          },
          body: requestBody,
        }),
      async (response) => response,
    );
  } catch {
    return { status: "offline" };
  }
  if (guardedResponse.status === "stale") return { status: "unauthorized" };
  const response = guardedResponse.value;

  let body: unknown = null;
  if (response.ok || response.status === 409) {
    try {
      body = await response.json();
    } catch {
      return { status: "server" };
    }
  }
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
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
        currentUserForSession(sessionToken),
        [[revisionKey, String(outcome.revision)]],
        [],
      );
      if (persisted.status === "stale") return { status: "unauthorized" };
      if (!(await sessionMatchesFirebase(sessionToken))) {
        return { status: "unauthorized" };
      }
    } catch {
      return { status: "server" };
    }
  }

  return outcome;
}

/** Pull a validated server snapshot into the expected account's local keys. */
export async function restoreFromCloud(
  sessionToken: CloudSyncSessionToken,
): Promise<RestoreOutcome> {
  const auth = await getAuthIdentity(sessionToken);
  if (auth.status !== "ready") return { status: auth.status };
  const identity = auth.identity;

  const owner = await prepareLocalSyncOwner(sessionToken);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  let guardedResponse;
  try {
    guardedResponse = await networkOrchestrator.execute(
      sessionToken,
      () =>
        fetch(`${getBaseUrl()}/api/user-data`, {
          headers: { Authorization: `Bearer ${identity.token}` },
        }),
      async (response) => response,
    );
  } catch {
    return { status: "offline" };
  }
  if (guardedResponse.status === "stale") return { status: "unauthorized" };
  const response = guardedResponse.value;

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
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "server" };
  }
  const envelope = body as Record<string, unknown>;
  if (
    !Object.hasOwn(envelope, "data") ||
    !Object.hasOwn(envelope, "revision")
  ) {
    return { status: "server" };
  }

  const revisionKey = revisionStorageKey(identity.uid);
  const data = envelope.data;
  if (data === null) {
    if (envelope.revision !== null) return { status: "server" };
    try {
      const committed = await syncStorage.commitOwned(
        identity.uid,
        currentUserForSession(sessionToken),
        [],
        [revisionKey],
      );
      if (committed.status === "stale") return { status: "unauthorized" };
      if (!(await sessionMatchesFirebase(sessionToken))) {
        return { status: "unauthorized" };
      }
      conflictBlockedUsers.delete(identity.uid);
      return { status: "empty" };
    } catch {
      return { status: "server" };
    }
  }

  const outcome = classifyRestoreResponse(
    response.status,
    true,
    envelope.revision,
  );
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
      currentUserForSession(sessionToken),
      pairs,
      removals,
      [[revisionKey, String(outcome.revision)]],
    );
    if (committed.status === "stale") return { status: "unauthorized" };
    if (!(await sessionMatchesFirebase(sessionToken))) {
      return { status: "unauthorized" };
    }
    conflictBlockedUsers.delete(identity.uid);
    return outcome;
  } catch {
    return { status: "server" };
  }
}

const MIGRATION_FLAG = "@elovia_rtdb_migrated";

/** Pull a legacy snapshot only for the currently authenticated local owner. */
export async function migrateLegacyFirebaseData(
  sessionToken: CloudSyncSessionToken,
): Promise<LegacyMigrationOutcome> {
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }
  const expectedUserId = cloudSyncSessionUid(sessionToken);
  const currentUser = currentUserForSession(sessionToken);

  const owner = await prepareLocalSyncOwner(sessionToken);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  const migrationKey = `${MIGRATION_FLAG}:${encodeURIComponent(expectedUserId)}`;
  try {
    const flag = await syncStorage.readOwned(expectedUserId, currentUser, [
      migrationKey,
    ]);
    if (flag.status === "stale") return { status: "unauthorized" };
    if (flag.value[0]?.[1]) return { status: "empty" };

    const { restoreFromFirestore } = await import("./firebaseSync");
    const legacyRestore = await syncStorage.runOwnedMutation(
      expectedUserId,
      currentUser,
      () => restoreFromFirestore(expectedUserId),
    );
    if (legacyRestore.status === "stale") return { status: "unauthorized" };
    if (!(await sessionMatchesFirebase(sessionToken))) {
      return { status: "unauthorized" };
    }

    if (!legacyRestore.value) {
      const flagged = await syncStorage.commitOwned(
        expectedUserId,
        currentUser,
        [[migrationKey, new Date().toISOString()]],
        [],
      );
      if (
        flagged.status === "stale" ||
        !(await sessionMatchesFirebase(sessionToken))
      ) {
        return { status: "unauthorized" };
      }
      return { status: "empty" };
    }
  } catch {
    return { status: "server" };
  }

  const cloudBackup = await backupToCloud(sessionToken).catch(
    (): BackupOutcome => ({ status: "server" }),
  );
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }
  if (cloudBackup.status === "saved") {
    try {
      const flagged = await syncStorage.commitOwned(
        expectedUserId,
        currentUser,
        [[migrationKey, new Date().toISOString()]],
        [],
      );
      if (
        flagged.status === "stale" ||
        !(await sessionMatchesFirebase(sessionToken))
      ) {
        return { status: "unauthorized" };
      }
    } catch {
      // Local restore and cloud save already succeeded. Optimistic concurrency
      // keeps a future migration check from overwriting a newer revision.
    }
  }
  return { status: "migrated", cloudBackup };
}
