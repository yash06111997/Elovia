import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/lib/auth";
import { backupToCloud, restoreFromCloud, migrateLegacyFirebaseData } from "@/lib/cloudSync";
import { emitDataRestored } from "@/lib/syncEvents";

const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;
const MIN_BACKUP_GAP = 30 * 1000;

/**
 * Background cloud sync.
 *
 * Ordering on sign-in matters and is the whole point of the guards below:
 *
 *   1. Restore from the API (Postgres).
 *   2. If the server has nothing, try a one-time migration from the legacy
 *      Realtime Database so long-standing accounts are not stranded.
 *   3. Only once one of those has settled is uploading permitted.
 *
 * Step 3 is what the previous implementation got wrong. It cleared its
 * in-progress flag in a `finally`, including on failure, after which the next
 * backgrounding uploaded an empty device over a populated account using a
 * destructive whole-node write.
 */
export function AutoSync() {
  const { user, isAuthenticated } = useAuth();

  const prevAuthRef = useRef(false);
  const backupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBackupRef = useRef(0);
  const sessionIdRef = useRef(0);

  /**
   * Uploading is blocked until a restore attempt has definitively completed
   * for THIS signed-in session. Unlike the old flag, a failed restore leaves
   * this false, so a network error can never open the door to an empty upload.
   */
  const restoreSettledRef = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !prevAuthRef.current && user) {
      const session = ++sessionIdRef.current;
      restoreSettledRef.current = false;

      void (async () => {
        try {
          const restored = await restoreFromCloud();
          if (session !== sessionIdRef.current) return;

          if (restored) {
            emitDataRestored();
            restoreSettledRef.current = true;
            return;
          }

          // Server had nothing. Check the legacy store before concluding this
          // is a genuinely new account.
          const migrated = await migrateLegacyFirebaseData(user.id);
          if (session !== sessionIdRef.current) return;

          if (migrated) emitDataRestored();

          // Reaching here means we know what the server holds, so local data
          // is now safe to upload.
          restoreSettledRef.current = true;
        } catch {
          // Deliberately leave restoreSettledRef false: we do not know what the
          // server holds, so uploading could destroy it.
        }
      })();
    }

    if (!isAuthenticated && prevAuthRef.current) {
      sessionIdRef.current++;
      restoreSettledRef.current = false;
    }

    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (backupTimerRef.current) {
        clearInterval(backupTimerRef.current);
        backupTimerRef.current = null;
      }
      return;
    }

    const doBackup = () => {
      if (!restoreSettledRef.current) return;

      const now = Date.now();
      if (now - lastBackupRef.current < MIN_BACKUP_GAP) return;
      lastBackupRef.current = now;

      // backupToCloud independently refuses to upload an empty payload, so
      // this is defence in depth rather than the only guard.
      void backupToCloud();
    };

    backupTimerRef.current = setInterval(doBackup, AUTO_BACKUP_INTERVAL);

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") doBackup();
    });

    return () => {
      if (backupTimerRef.current) {
        clearInterval(backupTimerRef.current);
        backupTimerRef.current = null;
      }
      sub.remove();
    };
  }, [isAuthenticated, user]);

  return null;
}
