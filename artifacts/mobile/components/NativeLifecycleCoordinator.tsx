import { useEffect, useRef } from "react";
import { useRootNavigationState, useRouter } from "expo-router";

import { useAuth } from "@/lib/auth";
import { readPendingArrival, releasePendingArrival } from "@/lib/geofence";
import { reconcileReminderSchedule } from "@/lib/notifications";
import { serializePendingArrivalRouteContext } from "@/lib/pendingArrival";
import { reconcilePushRegistration } from "@/lib/push";
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

    if (isLoading || !isAuthenticated || !userId || !navigationReady) {
      return () => {
        active = false;
      };
    }

    void reconcileReminderSchedule({ expectedUserId: userId })
      .then((ok) => {
        if (!ok) reportLifecycleFailure("ReminderReconciliationError");
      })
      .catch(() => {
        reportLifecycleFailure("ReminderReconciliationError");
      });
    void reconcilePushRegistration(userId)
      .then((result) => {
        if (
          !result.ok &&
          (result.reason === "network" || result.reason === "no_project_id")
        ) {
          reportLifecycleFailure("PushReconciliationError");
        }
      })
      .catch(() => {
        reportLifecycleFailure("PushReconciliationError");
      });

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

    void deliverPendingArrival();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (activeLeaseId) {
        void releasePendingArrival(userId, activeLeaseId);
      }
      generation.current += 1;
    };
  }, [isAuthenticated, isLoading, rootNavigationState?.key, router, user?.id]);

  return null;
}
