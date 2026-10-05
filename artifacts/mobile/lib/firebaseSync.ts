import { ref, get } from "firebase/database";
import { getFirebaseDb } from "./firebase";
import {
  createLegacySnapshotFetcher,
  shouldFinalizeLegacyMigration,
} from "./legacySnapshot";
import { runCloudSyncBoundedOperation } from "./cloudSyncSession";

export type { LegacySnapshotOutcome } from "./legacySnapshot";
export { shouldFinalizeLegacyMigration };

/** Fetch the legacy RTDB snapshot without mutating local account storage. */
export const fetchLegacySnapshot = createLegacySnapshotFetcher({
  getDb: getFirebaseDb,
  makeRef: (db, path) =>
    ref(db as NonNullable<ReturnType<typeof getFirebaseDb>>, path),
  read: (reference) => get(reference as ReturnType<typeof ref>),
  runBounded: runCloudSyncBoundedOperation,
});

export async function checkFirestoreDataExists(
  userId: string,
): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);
  return snapshot.exists();
}
