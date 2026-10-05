const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateKeyParts(key: string): [number, number, number] | null {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!match) return null;
  const parts: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    parsed.getUTCFullYear() !== parts[0] ||
    parsed.getUTCMonth() !== parts[1] - 1 ||
    parsed.getUTCDate() !== parts[2]
  ) {
    return null;
  }
  return parts;
}

/** A user's local calendar day, never a UTC-derived day. */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftedLocalDate(date: Date, amount: number): Date {
  const shifted = new Date(date);
  // Noon avoids rare midnight transitions in historical timezone rules.
  shifted.setHours(12, 0, 0, 0);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

/** Consecutive local date keys, oldest first, ending on the supplied day. */
export function localDateKeysEndingAt(date: Date, count: number): string[] {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Array.from({ length: safeCount }, (_, index) =>
    toLocalDateKey(shiftedLocalDate(date, index - safeCount + 1)),
  );
}

/** Seven local date keys for the containing week. Monday is the default. */
export function localWeekDateKeys(date: Date, weekStartsOn = 1): string[] {
  const safeWeekStart =
    Number.isInteger(weekStartsOn) && weekStartsOn >= 0 && weekStartsOn <= 6
      ? weekStartsOn
      : 1;
  const startOffset = (date.getDay() - safeWeekStart + 7) % 7;
  const weekStart = shiftedLocalDate(date, -startOffset);
  return Array.from({ length: 7 }, (_, index) =>
    toLocalDateKey(shiftedLocalDate(weekStart, index)),
  );
}

/** Parse YYYY-MM-DD as local noon so formatting cannot roll into another day. */
export function dateFromLocalDateKey(key: string): Date | null {
  const parts = dateKeyParts(key);
  if (!parts) return null;
  const [year, month, day] = parts;
  const monthIndex = month - 1;
  const parsed = new Date(year, monthIndex, day, 12, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** Whole calendar-day distance between two valid date keys. */
export function calendarDayDifference(
  fromKey: string,
  toKey: string,
): number | null {
  const from = dateKeyParts(fromKey);
  const to = dateKeyParts(toKey);
  if (!from || !to) return null;
  const fromTime = Date.UTC(from[0], from[1] - 1, from[2]);
  const toTime = Date.UTC(to[0], to[1] - 1, to[2]);
  return Math.round((toTime - fromTime) / 86_400_000);
}
