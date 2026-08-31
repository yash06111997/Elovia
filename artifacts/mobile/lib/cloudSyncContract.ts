export type RestoreOutcome =
  | { status: "restored"; revision: number }
  | { status: "empty" }
  | { status: "offline" }
  | { status: "unauthorized" }
  | { status: "server" };

export type BackupOutcome =
  | { status: "saved"; revision: number }
  | { status: "empty" | "offline" | "unauthorized" | "server" }
  | { status: "conflict"; currentRevision: number | null };

export type RestoreFieldKind = "json" | "scalar";
export type SerializedRestoreChange = readonly [
  field: string,
  value: string | null,
];

export type SerializedRestoreFields =
  | { status: "valid"; changes: SerializedRestoreChange[] }
  | { status: "invalid" };

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

export function revisionStorageKey(firebaseUserId: string): string {
  return `@elovia_sync_revision:${encodeURIComponent(firebaseUserId)}`;
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

    if (kind === "scalar") {
      if (typeof value !== "string") return { status: "invalid" };
      changes.push([field, value]);
      continue;
    }

    if (!isJsonCompatible(value, new Set())) return { status: "invalid" };
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { status: "invalid" };
    changes.push([field, serialized]);
  }
  return { status: "valid", changes };
}
