import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/lib/auth";
import {
  backupToCloud,
  beginCloudSyncSession,
  getCurrentCloudSyncUserId,
  isCloudSyncConflictBlocked,
  migrateLegacyFirebaseData,
  prepareLocalSyncOwner,
  restoreFromCloud,
} from "@/lib/cloudSync";
import { canUploadAfterRestore } from "@/lib/cloudSyncContract";
import { emitDataRestored } from "@/lib/syncEvents";
import { trackEvent } from "@/lib/telemetry";

const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000;
const MIN_BACKUP_GAP = 30 * 1000;

function reportAutomaticBackupFailure(
  status: "conflict" | "offline" | "server",
): void {
  void trackEvent("cloud_sync_failed", { direction: "backup", status });
}

/**
 * Restores before allowing upload and keeps failures distinct from a confirmed
 * empty account. Optimistic-concurrency conflicts pause automatic backup until
 * the user restores or starts a new authenticated session.
 */
export function AutoSync() {
  const { user, isAuthenticated } = useAuth();

  const activeUserIdRef = useRef<string | null>(null);
  const backupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backupInFlightRef = useRef(false);
  const lastBackupRef = useRef(0);
  const sessionIdRef = useRef(0);
  const restoreSettledRef = useRef(false);

  useEffect(() => {
    const currentUserId = isAuthenticated && user ? user.id : null;

    if (currentUserId && currentUserId !== activeUserIdRef.current) {
      const session = ++sessionIdRef.current;
      activeUserIdRef.current = currentUserId;
      restoreSettledRef.current = false;
      beginCloudSyncSession(currentUserId);

      void (async () => {
        const sessionIsCurrent = async () =>
          session === sessionIdRef.current &&
          (await getCurrentCloudSyncUserId()) === currentUserId;

        const owner = await prepareLocalSyncOwner(currentUserId);
        if (!(await sessionIsCurrent())) return;
        if (owner.status !== "ready") return;
        if (owner.changed) {
          const reload = await emitDataRestored();
          if (!(await sessionIsCurrent()) || reload.status === "failed") return;
        }

        const outcome = await restoreFromCloud(currentUserId);
        if (!(await sessionIsCurrent())) return;
        if (!canUploadAfterRestore(outcome)) return;

        if (outcome.status === "restored") {
          const reload = await emitDataRestored();
          if (!(await sessionIsCurrent()) || reload.status === "failed") return;
          restoreSettledRef.current = true;
          return;
        }

        // Legacy RTDB is consulted only after the API definitively confirms
        // that this account has no Postgres snapshot.
        const migration = await migrateLegacyFirebaseData(currentUserId);
        if (!(await sessionIsCurrent())) return;

        if (migration.status === "empty") {
          restoreSettledRef.current = true;
          return;
        }

        if (migration.status === "migrated") {
          const reload = await emitDataRestored();
          if (!(await sessionIsCurrent()) || reload.status === "failed") return;
          const backupStatus = migration.cloudBackup.status;
          if (backupStatus === "saved") {
            restoreSettledRef.current = true;
          } else if (
            backupStatus === "conflict" ||
            backupStatus === "offline" ||
            backupStatus === "server"
          ) {
            reportAutomaticBackupFailure(backupStatus);
          }
        }
      })();
    }

    if (!currentUserId && activeUserIdRef.current) {
      sessionIdRef.current++;
      activeUserIdRef.current = null;
      restoreSettledRef.current = false;
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      if (backupTimerRef.current) {
        clearInterval(backupTimerRef.current);
        backupTimerRef.current = null;
      }
      return;
    }

    const userId = user.id;
    const doBackup = async () => {
      if (
        !restoreSettledRef.current ||
        backupInFlightRef.current ||
        isCloudSyncConflictBlocked(userId)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastBackupRef.current < MIN_BACKUP_GAP) return;
      lastBackupRef.current = now;
      backupInFlightRef.current = true;
      const session = sessionIdRef.current;

      try {
        const outcome = await backupToCloud(userId);
        if (session !== sessionIdRef.current) return;
        if (
          outcome.status === "conflict" ||
          outcome.status === "offline" ||
          outcome.status === "server"
        ) {
          reportAutomaticBackupFailure(outcome.status);
        }
      } finally {
        backupInFlightRef.current = false;
      }
    };

    backupTimerRef.current = setInterval(
      () => void doBackup(),
      AUTO_BACKUP_INTERVAL,
    );

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") void doBackup();
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
