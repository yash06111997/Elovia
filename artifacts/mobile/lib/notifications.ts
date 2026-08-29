import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

export interface ReminderPreferences {
  enabled: boolean;
  /** Daily workout nudge, "HH:mm" 24h local. */
  workoutTime: string;
  workoutEnabled: boolean;
  /** Water reminders every N hours between wakingStart and wakingEnd. */
  hydrationEnabled: boolean;
  hydrationIntervalHours: number;
  wakingStartHour: number;
  wakingEndHour: number;
  /** Evening nudge, only fires if nothing was logged that day. */
  streakGuardEnabled: boolean;
  streakGuardHour: number;
  /** Weekly summary. 0 = Sunday. */
  weeklyDigestEnabled: boolean;
  weeklyDigestDay: number;
  weeklyDigestHour: number;
}

export const DEFAULT_REMINDERS: ReminderPreferences = {
  enabled: false,
  workoutTime: "18:00",
  workoutEnabled: true,
  hydrationEnabled: true,
  hydrationIntervalHours: 3,
  wakingStartHour: 8,
  wakingEndHour: 21,
  streakGuardEnabled: true,
  streakGuardHour: 20,
  weeklyDigestEnabled: true,
  weeklyDigestDay: 0,
  weeklyDigestHour: 9,
};

const PREFS_KEY = "@elovia_reminder_prefs";

export async function loadReminderPreferences(): Promise<ReminderPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_REMINDERS;
    return { ...DEFAULT_REMINDERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export async function saveReminderPreferences(prefs: ReminderPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // A failed preference write is not worth interrupting the user over.
  }
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

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":");
  const hour = Number(h);
  const minute = Number(m);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 18,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

const WORKOUT_COPY = [
  { title: "Time to train", body: "Your session is waiting. Even a short one counts." },
  { title: "Session time", body: "Twenty minutes now beats a perfect workout you skip." },
  { title: "Ready when you are", body: "Open Elovia and knock today's session out." },
];

const HYDRATION_COPY = [
  { title: "Water break", body: "A glass now keeps you on track for today's goal." },
  { title: "Hydrate", body: "Quick one - drink some water and log it." },
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Rebuild the full notification schedule from preferences.
 *
 * Cancels everything first and re-creates. Reconciling individual triggers
 * would be more efficient but far easier to get wrong, and the resulting
 * duplicate-reminder bug is exactly the kind that makes people uninstall.
 */
export async function rescheduleAllReminders(prefs: ReminderPreferences): Promise<boolean> {
  const N = loadNotifications();
  if (!N || Platform.OS === "web") return false;

  try {
    await N.cancelAllScheduledNotificationsAsync();

    if (!prefs.enabled) return true;

    const granted = await requestNotificationPermission();
    if (!granted) return false;

    await ensureAndroidChannel(N);

    const daily = N.SchedulableTriggerInputTypes.DAILY;
    const weekly = N.SchedulableTriggerInputTypes.WEEKLY;

    if (prefs.workoutEnabled) {
      const { hour, minute } = parseTime(prefs.workoutTime);
      const copy = pick(WORKOUT_COPY);
      await N.scheduleNotificationAsync({
        content: { ...copy, data: { kind: "workout" } },
        trigger: { type: daily, hour, minute, channelId: "reminders" },
      });
    }

    if (prefs.hydrationEnabled) {
      // Discrete daily triggers across waking hours. A repeating interval
      // trigger would fire overnight, which is the fastest way to get
      // notifications disabled entirely.
      const step = Math.max(1, Math.min(6, prefs.hydrationIntervalHours));
      for (let hour = prefs.wakingStartHour; hour <= prefs.wakingEndHour; hour += step) {
        const copy = pick(HYDRATION_COPY);
        await N.scheduleNotificationAsync({
          content: { ...copy, data: { kind: "hydration" } },
          trigger: { type: daily, hour, minute: 0, channelId: "reminders" },
        });
      }
    }

    if (prefs.streakGuardEnabled) {
      await N.scheduleNotificationAsync({
        content: {
          title: "Keep your streak",
          body: "You have not logged anything today. A quick entry keeps it alive.",
          data: { kind: "streak" },
        },
        trigger: {
          type: daily,
          hour: Math.min(23, Math.max(0, prefs.streakGuardHour)),
          minute: 0,
          channelId: "reminders",
        },
      });
    }

    if (prefs.weeklyDigestEnabled) {
      await N.scheduleNotificationAsync({
        content: {
          title: "Your week in review",
          body: "See how your training and nutrition went this week.",
          data: { kind: "digest" },
        },
        trigger: {
          type: weekly,
          // expo-notifications weekday is 1-7 with 1 = Sunday.
          weekday: Math.min(7, Math.max(1, prefs.weeklyDigestDay + 1)),
          hour: prefs.weeklyDigestHour,
          minute: 0,
          channelId: "reminders",
        },
      });
    }

    return true;
  } catch {
    return false;
  }
}

export async function cancelAllReminders(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    await N.cancelAllScheduledNotificationsAsync();
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
    return scheduled.length;
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
  const N = loadNotifications();
  if (!N) return;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    const streakOnes = scheduled.filter(
      (s) => (s.content?.data as { kind?: string } | undefined)?.kind === "streak",
    );
    for (const item of streakOnes) {
      await N.cancelScheduledNotificationAsync(item.identifier);
    }
  } catch {
    // Best effort.
  }
}
