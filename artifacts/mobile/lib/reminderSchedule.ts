export interface ReminderPreferences {
  enabled: boolean;
  workoutTime: string;
  workoutEnabled: boolean;
  hydrationEnabled: boolean;
  hydrationIntervalHours: number;
  wakingStartHour: number;
  wakingEndHour: number;
  streakGuardEnabled: boolean;
  streakGuardHour: number;
  streakSuppressedOn: string | null;
  weeklyDigestEnabled: boolean;
  weeklyDigestDay: number;
  weeklyDigestHour: number;
}

export const DEFAULT_REMINDERS: Readonly<ReminderPreferences> = Object.freeze({
  enabled: false,
  workoutTime: "18:00",
  workoutEnabled: true,
  hydrationEnabled: true,
  hydrationIntervalHours: 3,
  wakingStartHour: 8,
  wakingEndHour: 21,
  streakGuardEnabled: true,
  streakGuardHour: 20,
  streakSuppressedOn: null,
  weeklyDigestEnabled: true,
  weeklyDigestDay: 0,
  weeklyDigestHour: 9,
});

export const ELOVIA_REMINDER_OWNER = "elovia-reminder-v1";

export type ReminderKind = "workout" | "hydration" | "streak" | "digest";

export type ReminderTrigger =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "date"; at: Date };

export interface ReminderScheduleItem {
  kind: ReminderKind;
  title: string;
  body: string;
  trigger: ReminderTrigger;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizedTime(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_REMINDERS.workoutTime;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return DEFAULT_REMINDERS.workoutTime;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_REMINDERS.workoutTime;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizedLocalDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  return value;
}

export function normalizeReminderPreferences(
  value: unknown,
): ReminderPreferences {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const wakingStartHour = boundedInteger(
    input.wakingStartHour,
    0,
    23,
    DEFAULT_REMINDERS.wakingStartHour,
  );
  const wakingEndHour = Math.max(
    wakingStartHour,
    boundedInteger(input.wakingEndHour, 0, 23, DEFAULT_REMINDERS.wakingEndHour),
  );

  return {
    enabled: booleanOrDefault(input.enabled, DEFAULT_REMINDERS.enabled),
    workoutTime: normalizedTime(input.workoutTime),
    workoutEnabled: booleanOrDefault(
      input.workoutEnabled,
      DEFAULT_REMINDERS.workoutEnabled,
    ),
    hydrationEnabled: booleanOrDefault(
      input.hydrationEnabled,
      DEFAULT_REMINDERS.hydrationEnabled,
    ),
    hydrationIntervalHours: boundedInteger(
      input.hydrationIntervalHours,
      1,
      6,
      DEFAULT_REMINDERS.hydrationIntervalHours,
    ),
    wakingStartHour,
    wakingEndHour,
    streakGuardEnabled: booleanOrDefault(
      input.streakGuardEnabled,
      DEFAULT_REMINDERS.streakGuardEnabled,
    ),
    streakGuardHour: boundedInteger(
      input.streakGuardHour,
      0,
      23,
      DEFAULT_REMINDERS.streakGuardHour,
    ),
    streakSuppressedOn: normalizedLocalDate(input.streakSuppressedOn),
    weeklyDigestEnabled: booleanOrDefault(
      input.weeklyDigestEnabled,
      DEFAULT_REMINDERS.weeklyDigestEnabled,
    ),
    weeklyDigestDay: boundedInteger(
      input.weeklyDigestDay,
      0,
      6,
      DEFAULT_REMINDERS.weeklyDigestDay,
    ),
    weeklyDigestHour: boundedInteger(
      input.weeklyDigestHour,
      0,
      23,
      DEFAULT_REMINDERS.weeklyDigestHour,
    ),
  };
}

export function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function atLocalTime(date: Date, hour: number, minute = 0): Date {
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

/** Build a bounded schedule that remains below iOS's 64-pending limit. */
export function buildReminderSchedule(
  preferences: ReminderPreferences,
  now = new Date(),
): ReminderScheduleItem[] {
  const prefs = normalizeReminderPreferences(preferences);
  if (!prefs.enabled) return [];
  const result: ReminderScheduleItem[] = [];

  if (prefs.workoutEnabled) {
    const [hour, minute] = prefs.workoutTime.split(":").map(Number);
    result.push({
      kind: "workout",
      title: "Time to train",
      body: "Your session is waiting. Even a short one counts.",
      trigger: { kind: "daily", hour, minute },
    });
  }

  if (prefs.hydrationEnabled) {
    for (
      let hour = prefs.wakingStartHour;
      hour <= prefs.wakingEndHour;
      hour += prefs.hydrationIntervalHours
    ) {
      result.push({
        kind: "hydration",
        title: "Water break",
        body: "A glass now keeps you on track for today's goal.",
        trigger: { kind: "daily", hour, minute: 0 },
      });
    }
  }

  if (prefs.streakGuardEnabled) {
    // One-shot dates let today be suppressed without deleting tomorrow's
    // reminder. Thirty-one days plus the other recurring reminders remains
    // comfortably under the iOS limit of 64 scheduled notifications.
    for (let offset = 0; offset < 31; offset += 1) {
      const day = new Date(now);
      day.setDate(day.getDate() + offset);
      const at = atLocalTime(day, prefs.streakGuardHour);
      if (at.getTime() <= now.getTime()) continue;
      if (localDateKey(day) === prefs.streakSuppressedOn) continue;
      result.push({
        kind: "streak",
        title: "Keep your streak",
        body: "You have not logged anything today. A quick entry keeps it alive.",
        trigger: { kind: "date", at },
      });
    }
  }

  if (prefs.weeklyDigestEnabled) {
    result.push({
      kind: "digest",
      title: "Your week in review",
      body: "See how your training and nutrition went this week.",
      trigger: {
        kind: "weekly",
        weekday: prefs.weeklyDigestDay + 1,
        hour: prefs.weeklyDigestHour,
        minute: 0,
      },
    });
  }

  return result;
}

export function isEloviaReminderNotification(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const content = (value as { content?: unknown }).content;
  if (!content || typeof content !== "object") return false;
  const data = (content as { data?: unknown }).data;
  return (
    !!data &&
    typeof data === "object" &&
    (data as { eloviaOwner?: unknown }).eloviaOwner === ELOVIA_REMINDER_OWNER
  );
}
