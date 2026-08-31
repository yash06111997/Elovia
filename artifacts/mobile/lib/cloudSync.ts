import { Platform } from "react-native";
import { getFirebaseAuth } from "./firebase";
import {
  SYNC_KEYS,
  syncStorageCoordinator as syncStorage,
} from "./accountSyncStorage";
import {
  buildCloudResetPayload,
  buildStoredSyncPayload,
  classifyBackupResponse,
  classifyAuthTokenFailure,
  classifyResponseBodyFailure,
  classifyRestoreResponse,
  revisionStorageKey,
  runCloudFirstReset,
  serializeRestoreFields,
  type BackupOutcome,
  type CloudResetOutcome,
  type RestoreFieldKind,
  type RestoreOutcome,
} from "./cloudSyncContract";
import {
  STALE_CURRENT_USER,
  type CurrentUserId,
  type OwnerPreparationOutcome,
} from "./cloudSyncStorage";
import { createCloudSyncNetworkOrchestrator } from "./cloudSyncOrchestrator";
import {
  shouldFinalizeLegacyMigration,
  type LegacySnapshotOutcome,
} from "./legacySnapshot";
import {
  beginCloudSyncSession as beginSessionToken,
  cloudSyncFetch,
  cloudSyncSessionGeneration,
  cloudSyncSessionUid,
  endCloudSyncSession,
  getCurrentCloudSyncSession,
  isCloudSyncDeadlineError,
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

const RESTORE_FIELD_KINDS: Record<string, RestoreFieldKind> = {
  appState: "plain-object",
  workoutPlan: "nullable-object",
  activeSession: "nullable-object",
  customPlans: "array",
  activePlanType: "string",
  activeCustomPlanId: "string",
  sessions: "array",
  personalRecords: "array",
  mealPlan: "nullable-object",
  foodLog: "array",
  customMealPlans: "array",
  activeMealPlanType: "string",
  activeCustomMealPlanId: "string",
  healthData: "plain-object",
  wellnessData: "plain-object",
  waterGoal: "positive-number",
};

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
  | { status: "offline" }
  | { status: "unauthorized" }
  | { status: "server" };

export type LocalResetOutcome = CloudResetOutcome;

export interface RestoreFromCloudOptions {
  /** Manual-only: replace dirty local data after explicit user confirmation. */
  allowOverwriteDirty?: boolean;
}

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
): CurrentUserId {
  return async () =>
    (await sessionMatchesFirebase(sessionToken))
      ? cloudSyncSessionUid(sessionToken)
      : STALE_CURRENT_USER;
}

const networkOrchestrator = createCloudSyncNetworkOrchestrator(
  sessionMatchesFirebase,
);

function classifyNetworkFailure(
  error: unknown,
  sessionToken: CloudSyncSessionToken,
): "offline" | "unauthorized" {
  return isCloudSyncDeadlineError(error, "session") ||
    !isCloudSyncSessionCurrent(sessionToken)
    ? "unauthorized"
    : "offline";
}

interface BufferedCloudResponse {
  status: number;
  ok: boolean;
  body: unknown;
  bodyFailure?: "offline" | "server";
}

async function bufferCloudResponse(
  response: Response,
  shouldReadBody: boolean,
): Promise<BufferedCloudResponse> {
  if (!shouldReadBody) {
    return { status: response.status, ok: response.ok, body: null };
  }
  try {
    return {
      status: response.status,
      ok: response.ok,
      body: await response.json(),
    };
  } catch (error) {
    return {
      status: response.status,
      ok: response.ok,
      body: null,
      bodyFailure: classifyResponseBodyFailure(error),
    };
  }
}

function sessionStorageGeneration(sessionToken: CloudSyncSessionToken): string {
  return `cloud-generation-${cloudSyncSessionGeneration(sessionToken)}`;
}

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
async function backupToCloudUnlocked(
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
    ownedRead = await syncStorage.readSyncSnapshotOwned(
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
  const capturedChangeGeneration = ownedRead.value.changeGeneration;
  try {
    const values = new Map(ownedRead.value.entries);
    const parsedRevision = parseStoredRevision(values.get(revisionKey) ?? null);
    if (parsedRevision === "corrupt") {
      const removed = await syncStorage.commitOwned(
        identity.uid,
        currentUserForSession(sessionToken),
        [],
        [revisionKey],
        [],
        sessionStorageGeneration(sessionToken),
      );
      if (removed.status === "stale") return { status: "unauthorized" };
      if (!(await sessionMatchesFirebase(sessionToken))) {
        return { status: "unauthorized" };
      }
      baseRevision = null;
    } else {
      baseRevision = parsedRevision;
    }

    const storedFields = SYNC_KEYS.map(
      (key) => [FIELD_MAP[key], values.get(key) ?? null] as const,
    );
    const built = buildStoredSyncPayload(
      storedFields,
      RESTORE_FIELD_KINDS,
      baseRevision !== null,
    );
    if (built.status === "invalid") return { status: "server" };
    payload = built.payload;
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
        cloudSyncFetch(
          sessionToken,
          `${getBaseUrl()}/api/user-data`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${identity.token}`,
            },
            body: requestBody,
          },
          (response) =>
            bufferCloudResponse(
              response,
              response.ok || response.status === 409,
            ),
        ),
      async (response) => response,
    );
  } catch (error) {
    return { status: classifyNetworkFailure(error, sessionToken) };
  }
  if (guardedResponse.status === "stale") return { status: "unauthorized" };
  const response = guardedResponse.value;
  if (response.bodyFailure) return { status: response.bodyFailure };
  const body = response.body;
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
      const persisted = await syncStorage.commitBackupSavedOwned(
        identity.uid,
        currentUserForSession(sessionToken),
        capturedChangeGeneration,
        [[revisionKey, String(outcome.revision)]],
        sessionStorageGeneration(sessionToken),
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

export async function backupToCloud(
  sessionToken: CloudSyncSessionToken,
): Promise<BackupOutcome> {
  const guarded = await networkOrchestrator.runExclusive(sessionToken, () =>
    backupToCloudUnlocked(sessionToken),
  );
  return guarded.status === "stale"
    ? { status: "unauthorized" }
    : guarded.value;
}

/** Pull a validated server snapshot into the expected account's local keys. */
async function restoreFromCloudUnlocked(
  sessionToken: CloudSyncSessionToken,
  options: RestoreFromCloudOptions = {},
): Promise<RestoreOutcome> {
  const auth = await getAuthIdentity(sessionToken);
  if (auth.status !== "ready") return { status: auth.status };
  const identity = auth.identity;

  const owner = await prepareLocalSyncOwner(sessionToken);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  let capturedChangeGeneration: number;
  let capturedWasDirty: boolean;
  try {
    const localSnapshot = await syncStorage.readSyncSnapshotOwned(
      identity.uid,
      currentUserForSession(sessionToken),
      [],
    );
    if (localSnapshot.status === "stale") {
      return { status: "unauthorized" };
    }
    capturedWasDirty = localSnapshot.value.dirty;
    if (capturedWasDirty && !options.allowOverwriteDirty) {
      return { status: "local_changes" };
    }
    capturedChangeGeneration = localSnapshot.value.changeGeneration;
  } catch {
    return { status: "server" };
  }

  let guardedResponse;
  try {
    guardedResponse = await networkOrchestrator.execute(
      sessionToken,
      () =>
        cloudSyncFetch(
          sessionToken,
          `${getBaseUrl()}/api/user-data`,
          {
            headers: { Authorization: `Bearer ${identity.token}` },
          },
          (response) => bufferCloudResponse(response, response.ok),
        ),
      async (response) => response,
    );
  } catch (error) {
    return { status: classifyNetworkFailure(error, sessionToken) };
  }
  if (guardedResponse.status === "stale") return { status: "unauthorized" };
  const response = guardedResponse.value;

  if (response.status === 401 || response.status === 403) {
    return { status: "unauthorized" };
  }
  if (!response.ok) return { status: "server" };

  if (response.bodyFailure) return { status: response.bodyFailure };
  const body = response.body;
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
      const committed = await syncStorage.commitRestoreOwned(
        identity.uid,
        currentUserForSession(sessionToken),
        capturedChangeGeneration,
        [],
        options.allowOverwriteDirty && capturedWasDirty
          ? [...SYNC_KEYS, revisionKey]
          : [revisionKey],
        [],
        sessionStorageGeneration(sessionToken),
        options,
      );
      if (committed.status === "stale") return { status: "unauthorized" };
      if (!committed.value.committed) return { status: "local_changes" };
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
    const committed = await syncStorage.commitRestoreOwned(
      identity.uid,
      currentUserForSession(sessionToken),
      capturedChangeGeneration,
      pairs,
      removals,
      [[revisionKey, String(outcome.revision)]],
      sessionStorageGeneration(sessionToken),
      options,
    );
    if (committed.status === "stale") return { status: "unauthorized" };
    if (!committed.value.committed) return { status: "local_changes" };
    if (!(await sessionMatchesFirebase(sessionToken))) {
      return { status: "unauthorized" };
    }
    conflictBlockedUsers.delete(identity.uid);
    return outcome;
  } catch {
    return { status: "server" };
  }
}

export async function restoreFromCloud(
  sessionToken: CloudSyncSessionToken,
  options: RestoreFromCloudOptions = {},
): Promise<RestoreOutcome> {
  const guarded = await networkOrchestrator.runExclusive(sessionToken, () =>
    restoreFromCloudUnlocked(sessionToken, options),
  );
  return guarded.status === "stale"
    ? { status: "unauthorized" }
    : guarded.value;
}

const MIGRATION_FLAG = "@elovia_rtdb_migrated";

async function resetCurrentAccountDataUnlocked(
  sessionToken: CloudSyncSessionToken,
): Promise<LocalResetOutcome> {
  const auth = await getAuthIdentity(sessionToken);
  if (auth.status !== "ready") return { status: auth.status };
  const { uid: expectedUserId, token } = auth.identity;
  const owner = await prepareLocalSyncOwner(sessionToken);
  if (owner.status === "stale") return { status: "unauthorized" };
  if (owner.status === "server") return { status: "server" };

  const revisionKey = revisionStorageKey(expectedUserId);
  const migrationKey = `${MIGRATION_FLAG}:${encodeURIComponent(expectedUserId)}`;
  let baseRevision: number | null;
  try {
    const revisionRead = await syncStorage.readSyncSnapshotOwned(
      expectedUserId,
      currentUserForSession(sessionToken),
      [revisionKey],
    );
    if (revisionRead.status === "stale") return { status: "unauthorized" };
    const parsed = parseStoredRevision(
      revisionRead.value.entries[0]?.[1] ?? null,
    );
    baseRevision = parsed === "corrupt" ? null : parsed;
  } catch {
    return { status: "server" };
  }

  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }

  const requestBody = JSON.stringify(
    buildCloudResetPayload(RESTORE_FIELD_KINDS, baseRevision),
  );
  let guardedResponse;
  try {
    guardedResponse = await networkOrchestrator.execute(
      sessionToken,
      () =>
        cloudSyncFetch(
          sessionToken,
          `${getBaseUrl()}/api/user-data`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: requestBody,
          },
          (response) =>
            bufferCloudResponse(
              response,
              response.ok || response.status === 409,
            ),
        ),
      async (response) => response,
    );
  } catch (error) {
    return { status: classifyNetworkFailure(error, sessionToken) };
  }
  if (guardedResponse.status === "stale") return { status: "unauthorized" };
  const response = guardedResponse.value;

  if (response.bodyFailure) return { status: response.bodyFailure };
  const body = response.body;
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }

  const envelope =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const cloud = classifyBackupResponse(
    response.status,
    envelope.revision,
    Object.hasOwn(envelope, "currentRevision")
      ? envelope.currentRevision
      : undefined,
  );
  if (cloud.status === "conflict") conflictBlockedUsers.add(expectedUserId);

  const outcome = await runCloudFirstReset(
    async () => cloud,
    async (revision) => {
      const revisionSet = [[revisionKey, String(revision)]] as const;
      const reset = await syncStorage.resetOwned(
        expectedUserId,
        currentUserForSession(sessionToken),
        [migrationKey],
        sessionStorageGeneration(sessionToken),
        revisionSet,
        revisionSet,
      );
      if (reset.status === "stale") {
        throw new Error("Cloud sync session changed during reset.");
      }
      if (!(await sessionMatchesFirebase(sessionToken))) {
        throw new Error("Cloud sync session changed during reset.");
      }
    },
  );
  if (outcome.status === "reset") conflictBlockedUsers.delete(expectedUserId);
  return outcome;
}

export async function resetCurrentAccountData(
  sessionToken: CloudSyncSessionToken,
): Promise<LocalResetOutcome> {
  const guarded = await networkOrchestrator.runExclusive(sessionToken, () =>
    resetCurrentAccountDataUnlocked(sessionToken),
  );
  return guarded.status === "stale"
    ? { status: "unauthorized" }
    : guarded.value;
}

/** Pull a legacy snapshot only for the currently authenticated local owner. */
async function migrateLegacyFirebaseDataUnlocked(
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
  let legacyStatus: LegacySnapshotOutcome["status"] = "unavailable";
  try {
    const flag = await syncStorage.readOwned(expectedUserId, currentUser, [
      migrationKey,
    ]);
    if (flag.status === "stale") return { status: "unauthorized" };
    if (flag.value[0]?.[1]) return { status: "empty" };

    // Network I/O deliberately happens outside the storage coordinator mutex.
    const { fetchLegacySnapshot } = await import("./firebaseSync");
    const legacyRead = await fetchLegacySnapshot(expectedUserId, sessionToken);
    legacyStatus = legacyRead.status;
    if (!(await sessionMatchesFirebase(sessionToken))) {
      return { status: "unauthorized" };
    }

    if (legacyRead.status === "unavailable") return { status: "server" };
    if (legacyRead.status === "offline") return { status: "offline" };

    if (legacyRead.status === "empty") {
      if (!shouldFinalizeLegacyMigration(legacyRead.status)) {
        return { status: "server" };
      }
      const flagged = await syncStorage.commitOwned(
        expectedUserId,
        currentUser,
        [[migrationKey, new Date().toISOString()]],
        [],
        [],
        sessionStorageGeneration(sessionToken),
      );
      if (
        flagged.status === "stale" ||
        !(await sessionMatchesFirebase(sessionToken))
      ) {
        return { status: "unauthorized" };
      }
      return { status: "empty" };
    }

    const serialized = serializeRestoreFields(
      legacyRead.data,
      RESTORE_FIELD_KINDS,
    );
    if (serialized.status === "invalid") return { status: "server" };

    const pairs: [string, string][] = [];
    const removals: string[] = [];
    for (const [field, value] of serialized.changes) {
      const key = REVERSE_FIELD_MAP[field];
      if (!key) continue;
      if (value === null) removals.push(key);
      else pairs.push([key, value]);
    }
    if (pairs.length === 0 && removals.length === 0) {
      return { status: "server" };
    }

    const committed = await syncStorage.commitLocalChangeOwned(
      expectedUserId,
      currentUser,
      pairs,
      removals,
      sessionStorageGeneration(sessionToken),
    );
    if (committed.status === "stale") return { status: "unauthorized" };
  } catch {
    return { status: "server" };
  }

  const cloudBackup = await backupToCloudUnlocked(sessionToken).catch(
    (): BackupOutcome => ({ status: "server" }),
  );
  if (!(await sessionMatchesFirebase(sessionToken))) {
    return { status: "unauthorized" };
  }
  if (shouldFinalizeLegacyMigration(legacyStatus, cloudBackup.status)) {
    try {
      const flagged = await syncStorage.commitOwned(
        expectedUserId,
        currentUser,
        [[migrationKey, new Date().toISOString()]],
        [],
        [],
        sessionStorageGeneration(sessionToken),
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

export async function migrateLegacyFirebaseData(
  sessionToken: CloudSyncSessionToken,
): Promise<LegacyMigrationOutcome> {
  const guarded = await networkOrchestrator.runExclusive(sessionToken, () =>
    migrateLegacyFirebaseDataUnlocked(sessionToken),
  );
  return guarded.status === "stale"
    ? { status: "unauthorized" }
    : guarded.value;
}
