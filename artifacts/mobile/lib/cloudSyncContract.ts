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
