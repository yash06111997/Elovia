export type RestoreOutcome =
  | { status: "restored"; revision: number }
  | { status: "empty" }
  | { status: "offline" }
  | { status: "unauthorized" }
  | { status: "local_changes" }
  | { status: "server" };

export type BackupOutcome =
  | { status: "saved"; revision: number }
  | { status: "empty" | "offline" | "unauthorized" | "server" }
  | { status: "conflict"; currentRevision: number | null };

export type RestoreFieldKind =
  | "string"
  | "plain-object"
  | "nullable-object"
  | "array"
  | "positive-number";
export type SerializedRestoreChange = readonly [
  field: string,
  value: string | null,
];

export type SerializedRestoreFields =
  | { status: "valid"; changes: SerializedRestoreChange[] }
  | { status: "invalid" };

export type StoredSyncPayload =
  | { status: "valid"; payload: Record<string, unknown> }
  | { status: "invalid" };

export type AuthTokenFailureStatus = "offline" | "unauthorized";
export type ResponseBodyFailureStatus = "offline" | "server";
export type CloudResetOutcome =
  | { status: "reset"; revision: number }
  | { status: "local"; revision: number }
  | { status: "offline" | "unauthorized" | "server" }
  | { status: "conflict"; currentRevision: number | null };

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 1;
}

export function classifyRestoreResponse(
  httpStatus: number,
  hasData: boolean,
  revision: unknown,
): RestoreOutcome {
  if (httpStatus === 401 || httpStatus === 403)
    return { status: "unauthorized" };
  if (httpStatus < 200 || httpStatus >= 300) return { status: "server" };
  if (!hasData) return { status: "empty" };
  if (!isRevision(revision)) return { status: "server" };
  return { status: "restored", revision };
}

export function classifyBackupResponse(
  httpStatus: number,
  revision: unknown,
  currentRevision: unknown,
): BackupOutcome {
  if (httpStatus === 401 || httpStatus === 403)
    return { status: "unauthorized" };
  if (httpStatus === 409) {
    if (currentRevision !== null && !isRevision(currentRevision))
      return { status: "server" };
    return { status: "conflict", currentRevision };
  }
  if (httpStatus < 200 || httpStatus >= 300) return { status: "server" };
  if (!isRevision(revision)) return { status: "server" };
  return { status: "saved", revision };
}

export function canUploadAfterRestore(outcome: RestoreOutcome): boolean {
  return outcome.status === "restored" || outcome.status === "empty";
}

/** A validated local legacy commit is settled unless its auth session failed. */
export function canSettleAfterLegacyCommit(outcome: BackupOutcome): boolean {
  return outcome.status !== "unauthorized";
}

export function revisionStorageKey(firebaseUserId: string): string {
  return `@elovia_sync_revision:${encodeURIComponent(firebaseUserId)}`;
}

/** Classify Firebase token refresh failures without retaining error details. */
export function classifyAuthTokenFailure(
  error: unknown,
): AuthTokenFailureStatus {
  if (!error || typeof error !== "object") return "unauthorized";

  const record = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";

  if (
    code === "auth/network-request-failed" ||
    code === "auth/timeout" ||
    name === "aborterror" ||
    name === "timeouterror" ||
    (name === "typeerror" && /network|fetch|offline/.test(message))
  ) {
    return "offline";
  }
  return "unauthorized";
}

/** Classify response stream failures without retaining or logging error data. */
export function classifyResponseBodyFailure(
  error: unknown,
): ResponseBodyFailureStatus {
  if (!error || typeof error !== "object") return "server";
  const name =
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name.toLowerCase()
      : "";
  if (
    name === "aborterror" ||
    name === "timeouterror" ||
    name === "typeerror"
  ) {
    return "offline";
  }
  return "server";
}

/** A reset is a complete server patch: every known field is a tombstone. */
export function buildCloudResetPayload(
  fieldKinds: Readonly<Record<string, RestoreFieldKind>>,
  baseRevision: number | null,
): Record<string, number | null> {
  return {
    baseRevision,
    ...Object.fromEntries(
      Object.keys(fieldKinds).map((field) => [field, null]),
    ),
  };
}

/** Keep local data intact unless the cloud reset was definitively saved. */
export async function runCloudFirstReset(
  saveCloud: () => Promise<BackupOutcome>,
  clearLocal: (revision: number) => Promise<void>,
): Promise<CloudResetOutcome> {
  const cloud = await saveCloud();
  if (cloud.status === "empty") return { status: "server" };
  if (cloud.status === "offline") return { status: "offline" };
  if (cloud.status === "unauthorized") return { status: "unauthorized" };
  if (cloud.status === "server") return { status: "server" };
  if (cloud.status === "conflict") return cloud;
  if (!("revision" in cloud)) return { status: "server" };
  try {
    await clearLocal(cloud.revision);
    return { status: "reset", revision: cloud.revision };
  } catch {
    return { status: "local", revision: cloud.revision };
  }
}

function isJsonCompatible(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    return false;

  ancestors.add(value);
  const compatible = Array.isArray(value)
    ? value.every((item) => isJsonCompatible(item, ancestors))
    : Object.values(value).every((item) => isJsonCompatible(item, ancestors));
  ancestors.delete(value);
  return compatible;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidFieldValue(value: unknown, kind: RestoreFieldKind): boolean {
  if (value === null) return true;
  if (!isJsonCompatible(value, new Set())) return false;

  switch (kind) {
    case "string":
      return typeof value === "string";
    case "plain-object":
    case "nullable-object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "positive-number":
      return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
}

function parseStoredFieldValue(
  stored: string,
  kind: RestoreFieldKind,
): unknown | typeof INVALID_STORED_VALUE {
  try {
    return JSON.parse(stored);
  } catch {
    // Earlier app versions stored the four scalar selectors without JSON
    // quoting. Accept only those legacy strings; all structured values fail.
    return kind === "string" ? stored : INVALID_STORED_VALUE;
  }
}

const INVALID_STORED_VALUE = Symbol("invalid-stored-sync-value");

/** Build an upload patch and optionally materialize absent keys as tombstones. */
export function buildStoredSyncPayload(
  storedFields: readonly (readonly [string, string | null])[],
  fieldKinds: Readonly<Record<string, RestoreFieldKind>>,
  includeMissingAsNull: boolean,
): StoredSyncPayload {
  const storedByField = new Map(storedFields);
  const payload: Record<string, unknown> = {};

  for (const [field, kind] of Object.entries(fieldKinds)) {
    const stored = storedByField.get(field);
    if (stored === undefined || stored === null) {
      if (includeMissingAsNull) payload[field] = null;
      continue;
    }

    const value = parseStoredFieldValue(stored, kind);
    if (value === INVALID_STORED_VALUE || !isValidFieldValue(value, kind)) {
      return { status: "invalid" };
    }
    payload[field] = value;
  }

  return { status: "valid", payload };
}

/** Validate and serialize the complete known restore change set before storage mutates. */
export function serializeRestoreFields(
  input: unknown,
  fieldKinds: Readonly<Record<string, RestoreFieldKind>>,
): SerializedRestoreFields {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { status: "invalid" };

  const data = input as Record<string, unknown>;
  const changes: SerializedRestoreChange[] = [];
  for (const [field, kind] of Object.entries(fieldKinds)) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];

    if (value === null) {
      changes.push([field, null]);
      continue;
    }

    if (!isValidFieldValue(value, kind)) return { status: "invalid" };
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { status: "invalid" };
    changes.push([field, serialized]);
  }
  return { status: "valid", changes };
}
