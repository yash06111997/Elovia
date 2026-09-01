import { Platform } from "react-native";
import { captureAccountStorageSession } from "./accountSyncStorage";
import { shouldPresentNotification } from "./notificationPresentation";
import { ELOVIA_REMINDER_ACCOUNT_KEY } from "./pushCleanup";
import { runReminderReconciliation } from "./reminderReconciliation";
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
      handleNotification: async (notification) => {
        const present = await shouldPresentNotification(
          notification.request.content.data,
        );
        return {
          shouldShowBanner: present,
          shouldShowList: present,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      },
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

type ScheduledNotification = Awaited<
  ReturnType<NotificationsModule["getAllScheduledNotificationsAsync"]>
>[number];

function toRestorableTrigger(
  N: NotificationsModule,
  trigger: ScheduledNotification["trigger"],
): import("expo-notifications").NotificationTriggerInput | null {
  if (!trigger || typeof trigger !== "object") return null;
  const value = trigger as unknown as Record<string, unknown>;
  const channelId =
    typeof value.channelId === "string" ? value.channelId : "reminders";
  const boundedInteger = (
    candidate: unknown,
    minimum: number,
    maximum: number,
  ) =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= minimum &&
    candidate <= maximum
      ? candidate
      : null;
  if (value.type === "date") {
    const date = value.date ?? value.timestamp;
    return (typeof date === "number" && Number.isFinite(date)) ||
      (date instanceof Date && Number.isFinite(date.getTime()))
      ? { type: N.SchedulableTriggerInputTypes.DATE, date, channelId }
      : null;
  }
  if (value.type === "daily") {
    const hour = boundedInteger(value.hour, 0, 23);
    const minute = boundedInteger(value.minute, 0, 59);
    if (hour === null || minute === null) return null;
    return {
      type: N.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId,
    };
  }
  if (value.type === "weekly") {
    const weekday = boundedInteger(value.weekday, 1, 7);
    const hour = boundedInteger(value.hour, 0, 23);
    const minute = boundedInteger(value.minute, 0, 59);
    if (weekday === null || hour === null || minute === null) return null;
    return {
      type: N.SchedulableTriggerInputTypes.WEEKLY,
      weekday,
      hour,
      minute,
      channelId,
    };
  }
  return null;
}

async function cancelOwnedReminders(N: NotificationsModule): Promise<void> {
  const scheduled = await N.getAllScheduledNotificationsAsync();
  for (const notification of scheduled) {
    if (isEloviaReminderNotification(notification)) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await N.cancelScheduledNotificationAsync(notification.identifier);
          break;
        } catch {
          // Retry once, then continue so one bad identifier never prevents the
          // rest of the previous account's reminders from being removed.
        }
      }
    }
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
    const accountStorage = captureAccountStorageSession();
    const normalized = normalizeReminderPreferences(prefs);
    await accountStorage.setItem(PREFS_KEY, JSON.stringify(normalized));
    if (normalized.enabled && !(await requestNotificationPermission())) {
      return false;
    }
    if (!(await accountStorage.isCurrent())) return false;
    return reconcileReminderSchedule({
      expectedUserId: accountStorage.ownerToken.uid,
      preferences: normalized,
    });
  } catch {
    return false;
  }
}

export interface ReconcileReminderScheduleOptions {
  /** The authenticated owner that initiated this lifecycle run. */
  expectedUserId?: string | null;
  preferences?: ReminderPreferences;
}

/** Rebuild enabled reminders without ever prompting for optional permission. */
export async function reconcileReminderSchedule(
  options: ReconcileReminderScheduleOptions = {},
): Promise<boolean> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return false;

  return serializeReminderOperation(async () => {
    try {
      const accountStorage = captureAccountStorageSession();
      if (
        options.expectedUserId !== undefined &&
        accountStorage.ownerToken.uid !== options.expectedUserId
      ) {
        return false;
      }
      const stored = options.preferences
        ? null
        : await accountStorage.getItem(PREFS_KEY);
      const prefs = normalizeReminderPreferences(
        options.preferences ??
          (stored ? JSON.parse(stored) : DEFAULT_REMINDERS),
      );
      const schedule = prefs.enabled ? buildReminderSchedule(prefs) : [];
      if (schedule.length > 0) {
        await ensureAndroidChannel(N);
      }

      const outcome = await runReminderReconciliation({
        isCurrent: () => accountStorage.isCurrent(),
        async listOwned() {
          const scheduled = await N.getAllScheduledNotificationsAsync();
          return scheduled.filter(isEloviaReminderNotification);
        },
        identifier: (notification) => notification.identifier,
        canRestore: (notification) =>
          toRestorableTrigger(N, notification.trigger) !== null,
        cancel: (identifier) => N.cancelScheduledNotificationAsync(identifier),
        async permissionGranted() {
          return (await N.getPermissionsAsync()).granted;
        },
        scheduleCount: schedule.length,
        async schedule(index) {
          const item = schedule[index];
          if (!item) throw new Error("Reminder schedule changed unexpectedly.");
          return N.scheduleNotificationAsync({
            content: {
              title: item.title,
              body: item.body,
              data: {
                eloviaOwner: ELOVIA_REMINDER_OWNER,
                [ELOVIA_REMINDER_ACCOUNT_KEY]:
                  accountStorage.ownerToken.uid ?? "system:guest",
                kind: item.kind,
              },
            },
            trigger: toNativeTrigger(N, item.trigger),
          });
        },
        async restore(notification) {
          const trigger = toRestorableTrigger(N, notification.trigger);
          if (!trigger) throw new Error("Reminder trigger cannot be restored.");
          return N.scheduleNotificationAsync({
            identifier: notification.identifier,
            content: {
              title: notification.content.title,
              body: notification.content.body,
              data: notification.content.data,
              sound: notification.content.sound ?? false,
            },
            trigger,
          });
        },
      });
      return outcome === "reconciled" || outcome === "permission-denied";
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
    const accountStorage = captureAccountStorageSession();
    const stored = await accountStorage.getItem(PREFS_KEY);
    const prefs = normalizeReminderPreferences(
      stored ? JSON.parse(stored) : DEFAULT_REMINDERS,
    );
    const suppressed = normalizeReminderPreferences({
      ...prefs,
      streakSuppressedOn: localDateKey(new Date()),
    });
    await accountStorage.setItem(PREFS_KEY, JSON.stringify(suppressed));
    if (!(await accountStorage.isCurrent())) return;
    await reconcileReminderSchedule({
      expectedUserId: accountStorage.ownerToken.uid,
      preferences: suppressed,
    });
  } catch {
    // Best effort.
  }
}
