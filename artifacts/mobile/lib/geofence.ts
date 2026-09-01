import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  captureAccountStorageSession,
  readStableBackgroundAccountValue,
  readStableBackgroundAccountValueWithOwner,
} from "./accountSyncStorage";
import {
  PendingArrivalStore,
  type PendingArrival,
  type PendingArrivalReadResult,
} from "./pendingArrival";

export type { PendingArrival } from "./pendingArrival";

/**
 * Place-based triggers ("you arrived at the gym").
 *
 * Uses OS region monitoring rather than polling location. The OS wakes the app
 * on a boundary crossing, which costs a fraction of the battery a background
 * location loop would, and is the only approach Apple will approve.
 *
 * Platform reality worth knowing:
 *  - iOS caps an app at 20 monitored regions and needs "Always" authorisation
 *    for regions to fire when the app is not running. Apple reviews that
 *    permission strictly, so it is requested lazily - only when the user
 *    actually creates a place.
 *  - Android needs ACCESS_BACKGROUND_LOCATION from API 29, requested as a
 *    separate second prompt after foreground access is already granted.
 */

export const GEOFENCE_TASK = "elovia-geofence";

export interface SavedPlace {
  id: string;
  name: string;
  /** gym | home | work | other */
  kind: string;
  latitude: number;
  longitude: number;
  /** Metres. Below ~100m false triggers become common from GPS drift. */
  radius: number;
  /** Notify on arrival. */
  notifyOnArrive: boolean;
  /** Begin recording a workout on arrival without asking. */
  autoStartWorkout: boolean;
  enabled: boolean;
}

const PLACES_KEY = "@elovia_places";
const pendingArrivals = new PendingArrivalStore(AsyncStorage);

/** Below this, GPS drift alone will trip the fence repeatedly. */
export const MIN_RADIUS_M = 100;
export const DEFAULT_RADIUS_M = 150;
/** iOS hard limit on simultaneously monitored regions. */
export const MAX_PLACES = 20;

type LocationModule = typeof import("expo-location");
type TaskManagerModule = typeof import("expo-task-manager");

function loadLocation(): LocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-location") as LocationModule;
  } catch {
    return null;
  }
}

function loadTaskManager(): TaskManagerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-task-manager") as TaskManagerModule;
  } catch {
    return null;
  }
}

function parsePlaces(raw: string | null): SavedPlace[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadPlaces(): Promise<SavedPlace[]> {
  try {
    return parsePlaces(
      await captureAccountStorageSession().getItem(PLACES_KEY),
    );
  } catch {
    return [];
  }
}

/** Headless task read that returns no places unless sync ownership is stable. */
export async function loadPlacesForBackgroundTask(): Promise<SavedPlace[]> {
  return parsePlaces(await readStableBackgroundAccountValue(PLACES_KEY));
}

export async function loadPlacesForBackgroundTaskContext(): Promise<{
  ownerUserId: string | null;
  places: SavedPlace[];
} | null> {
  const stable = await readStableBackgroundAccountValueWithOwner(PLACES_KEY);
  if (!stable) return null;
  return {
    ownerUserId: stable.ownerUserId,
    places: parsePlaces(stable.value),
  };
}

export async function savePlaces(places: SavedPlace[]): Promise<void> {
  const accountStorage = captureAccountStorageSession();
  await accountStorage.setItem(
    PLACES_KEY,
    JSON.stringify(places.slice(0, MAX_PLACES)),
  );
}

/**
 * A crossing recorded by the background task, for the app to act on when it
 * next opens. The background task cannot navigate the UI, so it leaves a note.
 */
export async function readPendingArrival(
  userId: string,
): Promise<PendingArrivalReadResult> {
  return pendingArrivals.readForUser(userId);
}

export async function acknowledgePendingArrival(
  userId: string,
  leaseId: string,
): Promise<PendingArrival | null> {
  return pendingArrivals.acknowledge(userId, leaseId);
}

export async function releasePendingArrival(
  userId: string,
  leaseId: string,
): Promise<boolean> {
  return pendingArrivals.release(userId, leaseId);
}

export async function recordPendingArrival(
  arrival: PendingArrival,
): Promise<boolean> {
  return pendingArrivals.record(arrival);
}

export type PermissionOutcome =
  | "granted"
  | "foreground_only"
  | "denied"
  | "unsupported";

/**
 * Request what region monitoring needs.
 *
 * Foreground is requested first because both platforms REQUIRE it before
 * background can even be asked for. Requesting background first simply fails.
 */
export async function requestGeofencePermissions(): Promise<PermissionOutcome> {
  const Location = loadLocation();
  if (!Location || Platform.OS === "web") return "unsupported";

  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== "granted") return "denied";

    const background = await Location.requestBackgroundPermissionsAsync();
    return background.status === "granted" ? "granted" : "foreground_only";
  } catch {
    return "denied";
  }
}

export async function hasBackgroundPermission(): Promise<boolean> {
  const Location = loadLocation();
  if (!Location || Platform.OS === "web") return false;
  try {
    const result = await Location.getBackgroundPermissionsAsync();
    return result.status === "granted";
  } catch {
    return false;
  }
}

/**
 * Re-register every enabled place.
 *
 * Region monitoring is all-or-nothing per task, so the whole set is replaced
 * rather than diffed. Cheap, and it cannot drift out of sync with storage.
 */
export async function syncGeofences(): Promise<boolean> {
  const Location = loadLocation();
  const TaskManager = loadTaskManager();
  if (!Location || !TaskManager || Platform.OS === "web") return false;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => undefined);
    }

    const places = (await loadPlaces()).filter((p) => p.enabled);
    if (places.length === 0) return true;

    if (!(await hasBackgroundPermission())) return false;

    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      places.slice(0, MAX_PLACES).map((place) => ({
        identifier: place.id,
        latitude: place.latitude,
        longitude: place.longitude,
        radius: Math.max(MIN_RADIUS_M, place.radius),
        notifyOnEnter: true,
        notifyOnExit: true,
      })),
    );

    return true;
  } catch {
    return false;
  }
}

export async function stopAllGeofences(): Promise<void> {
  const Location = loadLocation();
  const TaskManager = loadTaskManager();
  if (!Location || !TaskManager) return;

  try {
    if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // Already stopped.
  }
}

/** Capture the user's current position, for "save this place". */
export async function getCurrentPlaceCoordinates(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  const Location = loadLocation();
  if (!Location || Platform.OS === "web") return null;

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== "granted") return null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    return null;
  }
}

export function makePlaceId(): string {
  return `place_${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}
