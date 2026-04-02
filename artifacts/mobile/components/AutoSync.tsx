import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/lib/auth";
import { backupToFirestore, restoreFromFirestore } from "@/lib/firebaseSync";
import { emitDataRestored } from "@/lib/syncEvents";

const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;

export function AutoSync() {
  const { user, isAuthenticated } = useAuth();
  const prevAuthRef = useRef(false);
  const backupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBackupRef = useRef<number>(0);
  const restoreInProgressRef = useRef(false);
  const sessionIdRef = useRef(0);

  useEffect(() => {
    if (isAuthenticated && !prevAuthRef.current && user) {
      const currentSession = ++sessionIdRef.current;
      restoreInProgressRef.current = true;

      console.log("[AutoSync] Restoring data for user:", user.id);
      restoreFromFirestore(user.id)
        .then((found) => {
          if (currentSession !== sessionIdRef.current) return;
          console.log("[AutoSync] Restore result:", found ? "data found" : "no data");
          if (found) {
            emitDataRestored();
          }
        })
        .catch((e) => { console.log("[AutoSync] Restore error:", e); })
        .finally(() => {
          if (currentSession === sessionIdRef.current) {
            restoreInProgressRef.current = false;
          }
        });
    }

    if (!isAuthenticated && prevAuthRef.current) {
      sessionIdRef.current++;
      restoreInProgressRef.current = false;
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

    const currentUserId = user.id;

    const doBackup = () => {
      if (restoreInProgressRef.current) return;
      const now = Date.now();
      if (now - lastBackupRef.current < 30000) return;
      lastBackupRef.current = now;
      console.log("[AutoSync] Backing up data for user:", currentUserId);
      backupToFirestore(currentUserId)
        .then(() => { console.log("[AutoSync] Backup complete"); })
        .catch((e) => { console.log("[AutoSync] Backup error:", e); });
    };

    backupTimerRef.current = setInterval(doBackup, AUTO_BACKUP_INTERVAL);

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "background" || nextState === "inactive") {
        doBackup();
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);

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
