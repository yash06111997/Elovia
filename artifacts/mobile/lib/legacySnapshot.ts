import type { CloudSyncSessionToken } from "./cloudSyncSession";

export type LegacySnapshotOutcome =
  | { status: "found"; data: unknown }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "offline" };

export function shouldFinalizeLegacyMigration(
  legacyStatus: LegacySnapshotOutcome["status"],
  cloudBackupStatus?: string,
): boolean {
  return (
    legacyStatus === "empty" ||
    (legacyStatus === "found" && cloudBackupStatus === "saved")
  );
}

interface LegacySnapshotReader {
  exists(): boolean;
  val(): unknown;
}

interface LegacySnapshotDependencies {
  getDb(): unknown | null;
  makeRef(db: unknown, path: string): unknown;
  read(reference: unknown): Promise<LegacySnapshotReader>;
  runBounded<Value>(
    token: CloudSyncSessionToken,
    operation: (signal: AbortSignal) => Promise<Value>,
    deadlineMs?: number,
  ): Promise<Value>;
}

export function createLegacySnapshotFetcher(
  dependencies: LegacySnapshotDependencies,
) {
  return async function fetchLegacySnapshotWithDependencies(
    userId: string,
    sessionToken: CloudSyncSessionToken,
    deadlineMs?: number,
  ): Promise<LegacySnapshotOutcome> {
    let userRef: unknown;
    try {
      const db = dependencies.getDb();
      if (!db) return { status: "unavailable" };
      userRef = dependencies.makeRef(db, `users/${userId}`);
    } catch {
      return { status: "unavailable" };
    }

    try {
      const snapshot = await dependencies.runBounded(
        sessionToken,
        () => dependencies.read(userRef),
        deadlineMs,
      );
      if (!snapshot.exists()) return { status: "empty" };
      return { status: "found", data: snapshot.val() };
    } catch {
      return { status: "offline" };
    }
  };
}
