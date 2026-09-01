import { useEffect, useRef } from "react";
import { useRootNavigationState, useRouter } from "expo-router";

import { useAuth } from "@/lib/auth";
import {
  clearPendingArrival,
  readPendingArrival,
  releasePendingArrival,
} from "@/lib/geofence";
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

    void reconcileReminderSchedule()
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

    void serializePendingArrivalDelivery(async () => {
      if (!active || generation.current !== run) return;
      const arrival = await readPendingArrival(userId);
      if (!arrival) return;

      if (!active || generation.current !== run) {
        await releasePendingArrival(arrival);
        return;
      }

      try {
        router.push({
          pathname: "/(tabs)/workouts",
          params: {
            arrival: serializePendingArrivalRouteContext(arrival),
          },
        });
        if (!(await clearPendingArrival(arrival))) {
          reportLifecycleFailure("PendingArrivalCompletionError");
        }
      } catch {
        await releasePendingArrival(arrival);
        reportLifecycleFailure("PendingArrivalDeliveryError");
      }
    }).catch(() => {
      reportLifecycleFailure("PendingArrivalDeliveryError");
    });

    return () => {
      active = false;
      generation.current += 1;
    };
  }, [isAuthenticated, isLoading, rootNavigationState?.key, router, user?.id]);

  return null;
}
