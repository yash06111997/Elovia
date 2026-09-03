import {
  enqueueBackgroundRunLocations,
  RUN_LOCATION_TASK,
} from "./runTrackingStore";

type TaskManagerModule = typeof import("expo-task-manager");
type LocationModule = typeof import("expo-location");

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

const TaskManager = loadTaskManager();
const Location = loadLocation();

/**
 * Must be registered at module scope: the OS can launch this JavaScript entry
 * without mounting any React screen when a background GPS batch arrives.
 */
if (TaskManager && Location) {
  try {
    if (!TaskManager.isTaskDefined(RUN_LOCATION_TASK)) {
      TaskManager.defineTask<{ locations?: unknown[] }>(
        RUN_LOCATION_TASK,
        async ({ data, error }) => {
          if (error || !Array.isArray(data?.locations)) return;
          try {
            await enqueueBackgroundRunLocations(data.locations);
          } catch {
            // A headless task must not throw repeatedly or the OS may suspend it.
            // The durable draft remains available for recovery on next launch.
          }
        },
      );
    }
  } catch {
    // Registration must never take down app startup on an unsupported runtime.
  }
}

export {};
