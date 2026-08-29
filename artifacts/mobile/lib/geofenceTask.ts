import { GEOFENCE_TASK, loadPlaces, recordPendingArrival } from "./geofence";

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
 */

type TaskManagerModule = typeof import("expo-task-manager");
type LocationModule = typeof import("expo-location");

function safeRequire<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name) as T;
  } catch {
    return null;
  }
}

const TaskManager = safeRequire<TaskManagerModule>("expo-task-manager");
const Location = safeRequire<LocationModule>("expo-location");

const ARRIVAL_COPY: Record<string, { title: string; body: string }> = {
  gym: { title: "You are at the gym", body: "Ready to start today's session?" },
  home: { title: "Home", body: "Good time to log your meals or stretch." },
  work: { title: "At work", body: "Remember to move and drink water today." },
  other: { title: "You have arrived", body: "Tap to open Elovia." },
};

async function notifyArrival(placeName: string, kind: string): Promise<void> {
  const Notifications = safeRequire<typeof import("expo-notifications")>("expo-notifications");
  if (!Notifications) return;

  const copy = ARRIVAL_COPY[kind] ?? ARRIVAL_COPY.other;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: `${placeName} — ${copy.body}`,
        data: { kind: "geofence", placeName },
      },
      // null trigger delivers immediately.
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
          const places = await loadPlaces();
          const place = places.find((p) => p.id === region.identifier);
          if (!place || !place.enabled) return;

          if (place.notifyOnArrive) {
            await notifyArrival(place.name, place.kind);
          }

          if (place.autoStartWorkout) {
            await recordPendingArrival({
              placeId: place.id,
              placeName: place.name,
              autoStartWorkout: true,
              at: new Date().toISOString(),
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
