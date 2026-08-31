const CLOUD_SYNC_SESSION = Symbol("cloud-sync-session");

export interface CloudSyncSessionToken {
  readonly [CLOUD_SYNC_SESSION]: true;
}

interface CloudSyncSessionRecord extends CloudSyncSessionToken {
  readonly uid: string;
  readonly generation: number;
}

let nextGeneration = 0;
let activeSession: CloudSyncSessionRecord | null = null;

export function beginCloudSyncSession(uid: string): CloudSyncSessionToken {
  const token: CloudSyncSessionRecord = Object.freeze({
    uid,
    generation: ++nextGeneration,
    [CLOUD_SYNC_SESSION]: true as const,
  });
  activeSession = token;
  return token;
}

export function getCurrentCloudSyncSession(
  expectedUid: string,
): CloudSyncSessionToken | null {
  return activeSession?.uid === expectedUid ? activeSession : null;
}

export function cloudSyncSessionUid(token: CloudSyncSessionToken): string {
  return (token as CloudSyncSessionRecord).uid;
}

export function cloudSyncSessionGeneration(
  token: CloudSyncSessionToken,
): number {
  return (token as CloudSyncSessionRecord).generation;
}

export function isCloudSyncSessionCurrent(
  token: CloudSyncSessionToken,
): boolean {
  return activeSession === token;
}

export function endCloudSyncSession(token: CloudSyncSessionToken): void {
  if (activeSession === token) activeSession = null;
}
