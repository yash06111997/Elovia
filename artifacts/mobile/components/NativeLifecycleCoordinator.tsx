import { useEffect, useRef } from "react";
import { useRootNavigationState, useRouter } from "expo-router";

import { useAuth } from "@/lib/auth";
import {
  readPendingArrival,
  reconcileGeofences,
  releasePendingArrival,
  stopAllGeofences,
} from "@/lib/geofence";
import {
  cancelAllReminders,
  reconcileReminderSchedule,
} from "@/lib/notifications";
import { serializePendingArrivalRouteContext } from "@/lib/pendingArrival";
import { reconcilePushRegistration } from "@/lib/push";
import { onDataRestored } from "@/lib/syncEvents";
import { reportClientError } from "@/lib/telemetry";

let pendingArrivalOperation: Promise<void> = Promise.resolve();

async function serializePendingArrivalDelivery(
  operation: () => Promise<void>,
): Promise<void> {
  const previous = pendingArrivalOperation;
  let release!: () => void;
  pendingArrivalOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await operation();
  } finally {
    release();
  }
}

function reportLifecycleFailure(name: string): void {
  const error = new Error();
  error.name = name;
  reportClientError(error);
}

/**
 * Connect account-ready React state to native services that cannot live in a
 * screen. Providers above this component have already completed their scoped
 * hydration, and the router readiness key prevents early navigation.
 */
export function NativeLifecycleCoordinator() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const rootNavigationState = useRootNavigationState();
  const router = useRouter();
  const generation = useRef(0);

  useEffect(() => {
    const run = generation.current + 1;
    generation.current = run;
    let active = true;
    const userId = user?.id ?? null;
    const navigationReady = Boolean(rootNavigationState?.key);

    if (isLoading) {
      return () => {
        active = false;
      };
    }

    if (!isAuthenticated || !userId) {
      void Promise.allSettled([cancelAllReminders(), stopAllGeofences()]);
      return () => {
        active = false;
        generation.current += 1;
      };
    }

    const reconcileNativeState = async () => {
      const reminderOk = await reconcileReminderSchedule({
        expectedUserId: userId,
      });
      if (!active || generation.current !== run) return false;
      const geofenceOk = await reconcileGeofences(userId);
      if (!active || generation.current !== run) return false;
      if (!reminderOk) {
        reportLifecycleFailure("ReminderReconciliationError");
      }
      return reminderOk && geofenceOk;
    };

    const unsubscribeRestore = onDataRestored(async () => {
      if (!active || generation.current !== run) {
        throw new Error("StaleNativeRestoreReconciliation");
      }
      if (!(await reconcileNativeState())) {
        throw new Error("NativeRestoreReconciliationFailed");
      }
    });
    void reconcileNativeState().catch(() => {
      reportLifecycleFailure("NativeReconciliationError");
    });

    let pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const reconcilePush = async () => {
      if (!active || generation.current !== run) return;
      try {
        const result = await reconcilePushRegistration(userId);
        if (!active || generation.current !== run) return;
        if (!result.ok && result.reason === "network") {
          reportLifecycleFailure("PushReconciliationError");
          pushRetryTimer = setTimeout(() => void reconcilePush(), 15_000);
        } else if (!result.ok && result.reason === "no_project_id") {
          reportLifecycleFailure("PushReconciliationError");
        }
      } catch {
        reportLifecycleFailure("PushReconciliationError");
        if (active && generation.current === run) {
          pushRetryTimer = setTimeout(() => void reconcilePush(), 15_000);
        }
      }
    };
    void reconcilePush();

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let activeLeaseId: string | null = null;

    const scheduleRetry = (delayMs: number) => {
      if (!active || generation.current !== run) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          void deliverPendingArrival();
        },
        Math.max(100, delayMs + 25),
      );
    };

    const deliverPendingArrival = () =>
      serializePendingArrivalDelivery(async () => {
        if (!active || generation.current !== run) return;
        const pending = await readPendingArrival(userId);

        if (!active || generation.current !== run) {
          if (pending.status === "claimed") {
            await releasePendingArrival(userId, pending.leaseId);
          }
          return;
        }
        if (pending.status === "empty") {
          activeLeaseId = null;
          return;
        }
        if (pending.status === "leased") {
          scheduleRetry(pending.retryAfterMs);
          return;
        }

        activeLeaseId = pending.leaseId;
        try {
          router.push({
            pathname: "/(tabs)/workouts",
            params: {
              arrival: serializePendingArrivalRouteContext(pending.arrival),
              arrivalLeaseId: pending.leaseId,
            },
          });
          // Router push is only an attempt. The mounted Train screen owns the
          // durable acknowledgement; a dropped navigation retries on expiry.
          scheduleRetry(pending.retryAfterMs);
        } catch {
          await releasePendingArrival(userId, pending.leaseId);
          activeLeaseId = null;
          scheduleRetry(250);
          reportLifecycleFailure("PendingArrivalDeliveryError");
        }
      }).catch(() => {
        scheduleRetry(500);
        reportLifecycleFailure("PendingArrivalDeliveryError");
      });

    if (navigationReady) void deliverPendingArrival();

    return () => {
      active = false;
      unsubscribeRestore();
      if (pushRetryTimer) clearTimeout(pushRetryTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (activeLeaseId) {
        void releasePendingArrival(userId, activeLeaseId);
      }
      void Promise.allSettled([cancelAllReminders(), stopAllGeofences()]);
      generation.current += 1;
    };
  }, [isAuthenticated, isLoading, rootNavigationState?.key, router, user?.id]);

  return null;
}
