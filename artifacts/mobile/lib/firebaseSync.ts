import { ref, get } from "firebase/database";
import { getFirebaseDb } from "./firebase";

/** Fetch the legacy RTDB snapshot without mutating local account storage. */
export async function fetchLegacySnapshot(
  userId: string,
): Promise<unknown | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);

  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.val() as unknown;
}

export async function checkFirestoreDataExists(
  userId: string,
): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);
  return snapshot.exists();
}
