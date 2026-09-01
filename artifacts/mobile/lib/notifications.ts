import { Platform } from "react-native";
import { captureAccountStorageSession } from "./accountSyncStorage";
import {
  buildReminderSchedule,
  DEFAULT_REMINDERS,
  ELOVIA_REMINDER_OWNER,
  isEloviaReminderNotification,
  localDateKey,
  normalizeReminderPreferences,
  type ReminderPreferences,
  type ReminderTrigger,
} from "./reminderSchedule";

export type { ReminderPreferences } from "./reminderSchedule";
export { DEFAULT_REMINDERS } from "./reminderSchedule";

/**
 * Local notification scheduling.
 *
 * Deliberately LOCAL notifications, not push. Every reminder this app needs is
 * time-based and known on-device, so scheduling locally avoids FCM/APNs
 * credentials, push tokens, a delivery backend, and the privacy surface of
 * shipping a device token to a server. It also works with no network.
 *
 * The module is loaded lazily for the same reason as the health providers:
 * expo-notifications is a native module and importing it at the top level
 * breaks environments where it is absent.
 */

type NotificationsModule = typeof import("expo-notifications");

let cached: NotificationsModule | null = null;
let loadAttempted = false;

function loadNotifications(): NotificationsModule | null {
  if (loadAttempted) return cached;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

const PREFS_KEY = "@elovia_reminder_prefs";
let reminderOperation: Promise<void> = Promise.resolve();

async function serializeReminderOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = reminderOperation;
  let release!: () => void;
  reminderOperation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function loadReminderPreferences(): Promise<ReminderPreferences> {
  try {
    const raw = await captureAccountStorageSession().getItem(PREFS_KEY);
    if (!raw) return normalizeReminderPreferences(DEFAULT_REMINDERS);
    return normalizeReminderPreferences(JSON.parse(raw));
  } catch {
    return normalizeReminderPreferences(DEFAULT_REMINDERS);
  }
}

export async function saveReminderPreferences(
  prefs: ReminderPreferences,
): Promise<void> {
  await captureAccountStorageSession().setItem(
    PREFS_KEY,
    JSON.stringify(normalizeReminderPreferences(prefs)),
  );
}

export function isNotificationsAvailable(): boolean {
  return loadNotifications() !== null && Platform.OS !== "web";
}

/** Configure how notifications present while the app is foregrounded. */
export function configureNotificationHandler(): void {
  const N = loadNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Older/newer signature mismatch should never crash startup.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return false;

  try {
    const existing = await N.getPermissionsAsync();
    if (existing.granted) return true;

    const result = await N.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/** Android requires an explicit channel or notifications are silently dropped. */
async function ensureAndroidChannel(N: NotificationsModule): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await N.setNotificationChannelAsync("reminders", {
      name: "Reminders",
      importance: N.AndroidImportance.DEFAULT,
      sound: undefined,
      vibrationPattern: [0, 200],
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    // Channel creation failing is not fatal; the default channel still fires.
  }
}

function toNativeTrigger(
  N: NotificationsModule,
  trigger: ReminderTrigger,
): import("expo-notifications").SchedulableNotificationTriggerInput {
  if (trigger.kind === "date") {
    return {
      type: N.SchedulableTriggerInputTypes.DATE,
      date: trigger.at,
      channelId: "reminders",
    };
  }
  if (trigger.kind === "weekly") {
    return {
      type: N.SchedulableTriggerInputTypes.WEEKLY,
      weekday: trigger.weekday,
      hour: trigger.hour,
      minute: trigger.minute,
      channelId: "reminders",
    };
  }
  return {
    type: N.SchedulableTriggerInputTypes.DAILY,
    hour: trigger.hour,
    minute: trigger.minute,
    channelId: "reminders",
  };
}

async function cancelOwnedReminders(N: NotificationsModule): Promise<void> {
  const scheduled = await N.getAllScheduledNotificationsAsync();
  for (const notification of scheduled) {
    if (isEloviaReminderNotification(notification)) {
      await N.cancelScheduledNotificationAsync(notification.identifier);
    }
  }
}

async function scheduleOwnedReminders(
  N: NotificationsModule,
  prefs: ReminderPreferences,
): Promise<void> {
  await ensureAndroidChannel(N);
  for (const item of buildReminderSchedule(prefs)) {
    await N.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        data: {
          eloviaOwner: ELOVIA_REMINDER_OWNER,
          kind: item.kind,
        },
      },
      trigger: toNativeTrigger(N, item.trigger),
    });
  }
}

/**
 * Rebuild the full notification schedule from preferences.
 *
 * Cancels only notifications tagged as Elovia reminders, then re-creates the
 * desired owned set. Other scheduled notifications are never touched.
 */
export async function rescheduleAllReminders(
  prefs: ReminderPreferences,
): Promise<boolean> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return false;

  try {
    const normalized = normalizeReminderPreferences(prefs);
    await saveReminderPreferences(normalized);
    if (normalized.enabled && !(await requestNotificationPermission())) {
      return false;
    }
    return reconcileReminderSchedule(normalized);
  } catch {
    return false;
  }
}

/** Rebuild enabled reminders without ever prompting for optional permission. */
export async function reconcileReminderSchedule(
  providedPreferences?: ReminderPreferences,
): Promise<boolean> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return false;

  return serializeReminderOperation(async () => {
    try {
      const prefs = normalizeReminderPreferences(
        providedPreferences ?? (await loadReminderPreferences()),
      );
      await cancelOwnedReminders(N);
      if (!prefs.enabled) return true;
      const permission = await N.getPermissionsAsync();
      if (!permission.granted) return false;
      await scheduleOwnedReminders(N, prefs);
      return true;
    } catch {
      return false;
    }
  });
}

export async function cancelAllReminders(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    await serializeReminderOperation(() => cancelOwnedReminders(N));
  } catch {
    // Nothing scheduled, or the module is unavailable.
  }
}

/** How many reminders are currently scheduled, for settings UI. */
export async function countScheduledReminders(): Promise<number> {
  const N = loadNotifications();
  if (!N) return 0;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    return scheduled.filter(isEloviaReminderNotification).length;
  } catch {
    return 0;
  }
}

/**
 * Cancel today's streak nudge once the user has actually logged something.
 *
 * Without this, someone who trains at 6pm still gets told at 8pm that they
 * have not logged anything - the single most irritating possible reminder.
 */
export async function suppressTodayStreakReminder(): Promise<void> {
  try {
    const prefs = await loadReminderPreferences();
    const suppressed = normalizeReminderPreferences({
      ...prefs,
      streakSuppressedOn: localDateKey(new Date()),
    });
    await saveReminderPreferences(suppressed);
    await reconcileReminderSchedule(suppressed);
  } catch {
    // Best effort.
  }
}
