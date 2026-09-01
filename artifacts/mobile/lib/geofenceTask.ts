import {
  GEOFENCE_TASK,
  loadPlacesForBackgroundTaskContext,
  recordPendingArrival,
} from "./geofence";
import { notificationOwnerMarker } from "./notificationOwner";
import {
  ELOVIA_GEOFENCE_OWNER_KEY,
  ELOVIA_GEOFENCE_PAYLOAD_VERSION,
} from "./pushCleanup";

/**
 * Background geofence handler.
 *
 * MUST be defined at module scope and imported during app startup. The OS can
 * relaunch the app directly into this task after a boundary crossing, and if
 * the task is not defined by the time that happens, the event is dropped
 * silently - the classic "geofencing works in dev, never in production" bug.
 *
 * The task runs with no UI and a short execution budget, so it does exactly
 * two things: post a local notification, and leave a note for the app to act
 * on next time it opens.
 *
 * Every require() below uses a LITERAL string. Metro resolves dependencies
 * statically at bundle time, so `require(someVariable)` is not a runtime
 * fallback - it fails the whole bundle with "Invalid call". TypeScript accepts
 * it happily, which makes it a compile-clean way to break the build.
 */

type TaskManagerModule = typeof import("expo-task-manager");
type LocationModule = typeof import("expo-location");
type NotificationsModule = typeof import("expo-notifications");

function loadTaskManager(): TaskManagerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-task-manager") as TaskManagerModule;
  } catch {
    return null;
  }
}

function loadLocation(): LocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-location") as LocationModule;
  } catch {
    return null;
  }
}

function loadNotifications(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

const TaskManager = loadTaskManager();
const Location = loadLocation();

const ARRIVAL_COPY: Record<string, { title: string; body: string }> = {
  gym: { title: "You are at the gym", body: "Ready to start today's session?" },
  home: { title: "Home", body: "Good time to log your meals or stretch." },
  work: { title: "At work", body: "Remember to move and drink water today." },
  other: { title: "You have arrived", body: "Tap to open Elovia." },
};

async function notifyArrival(
  placeName: string,
  kind: string,
  ownerUserId: string | null,
): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  const copy = ARRIVAL_COPY[kind] ?? ARRIVAL_COPY.other;
  const ownerMarker = await notificationOwnerMarker(ownerUserId);
  if (!ownerMarker) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: `${placeName} — ${copy.body}`,
        data: {
          kind: "geofence",
          placeName,
          eloviaGeofence: ELOVIA_GEOFENCE_PAYLOAD_VERSION,
          [ELOVIA_GEOFENCE_OWNER_KEY]: ownerMarker,
        },
      },
      // A null trigger delivers immediately.
      trigger: null,
    });
  } catch {
    // Notification permission may have been revoked since setup.
  }
}

if (TaskManager && Location) {
  try {
    if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
      TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
        if (error) return;

        const eventType = data?.eventType;
        const region = data?.region;
        if (!region?.identifier) return;

        // Only arrivals are actionable. Exits are still monitored so the OS
        // knows the user left, which is what makes the next entry fire.
        if (eventType !== Location.LocationGeofencingEventType.Enter) return;

        try {
          const context = await loadPlacesForBackgroundTaskContext();
          if (!context) return;
          const place = context.places.find(
            (candidate) => candidate.id === region.identifier,
          );
          if (!place || !place.enabled) return;

          if (place.notifyOnArrive) {
            await notifyArrival(place.name, place.kind, context.ownerUserId);
          }

          if (place.autoStartWorkout && context.ownerUserId) {
            const at = new Date();
            await recordPendingArrival({
              eventId: `${place.id}:${at.getTime()}:${Math.random().toString(36).slice(2, 10)}`,
              ownerUserId: context.ownerUserId,
              placeId: place.id,
              placeName: place.name,
              autoStartWorkout: true,
              at: at.toISOString(),
            });
          }
        } catch {
          // Never throw from a background task: on iOS repeated failures can
          // get the task suspended for the rest of the app's lifetime.
        }
      });
    }
  } catch {
    // defineTask throwing at import time must not take down app startup.
  }
}

export {};
