/**
 * Slot generation.
 *
 * The whole problem is that "every Tuesday at 9am for the coach" is not a
 * fixed UTC time. It moves by an hour twice a year, and it moves on different
 * dates depending on the coach's country. So availability is stored as a
 * wall-clock rule in a named zone and expanded to real instants here.
 *
 * Deliberately no date library. Intl.DateTimeFormat has full IANA timezone
 * support built into Node, and the two functions below are the entirety of
 * what is needed.
 */

/**
 * The zone's UTC offset at a given instant, in milliseconds.
 *
 * Works by formatting the instant as wall-clock time in the target zone, then
 * asking how far that wall-clock reading is from the instant itself. That
 * difference IS the offset, and because it is derived per-instant it is
 * automatically correct across daylight saving changes.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  // Intl renders midnight as hour "24" in some locales/zones; normalise it.
  const hour = parts.hour === "24" ? "0" : parts.hour;

  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return wallClockAsUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in a named zone to the real instant it refers to.
 *
 * Two passes. The first guess treats the wall clock as if it were UTC and
 * subtracts the offset at that moment. When the result lands on the other side
 * of a daylight-saving boundary the offset changes, so it is recomputed once
 * against the corrected instant.
 *
 * On the ambiguous hour that occurs when clocks go back, this resolves to the
 * first of the two possible instants. That is a deliberate choice rather than
 * an oversight - it is what most scheduling systems do, and the alternative is
 * asking the coach which 01:30 they meant twice a year.
 */
export function wallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const correction = zoneOffsetMs(firstPass, timeZone);

  return new Date(naive - correction);
}

/** The calendar date, in a given zone, that an instant falls on. */
export function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  };
}

export interface AvailabilityRule {
  weekday: number;
  startMinute: number;
  durationMins: number;
  timezone: string;
}

export interface Slot {
  /** ISO instant. The client renders this in its own local zone. */
  startsAt: string;
  durationMins: number;
}

/**
 * Expand recurring rules into concrete bookable slots.
 *
 * Excludes anything already taken, anything in the past, and anything inside
 * the lead time - a slot starting in nine minutes is not really bookable, and
 * offering it produces a booking nobody can attend.
 */
export function generateSlots(params: {
  rules: AvailabilityRule[];
  bookedInstants: Date[];
  horizonDays: number;
  /** Minimum notice before a slot may be booked. */
  leadTimeMins?: number;
  now?: Date;
}): Slot[] {
  const { rules, bookedInstants, horizonDays } = params;
  const now = params.now ?? new Date();
  const leadTimeMins = params.leadTimeMins ?? 120;

  if (rules.length === 0) return [];

  const earliest = new Date(now.getTime() + leadTimeMins * 60_000);
  const latest = new Date(now.getTime() + horizonDays * 86_400_000);

  // Compare by numeric time: Date objects are never equal by identity, and a
  // Set of ISO strings would break on any formatting difference.
  const taken = new Set(bookedInstants.map((d) => d.getTime()));

  const slots: Slot[] = [];

  for (const rule of rules) {
    // Walk calendar days in the COACH's zone. Iterating UTC days instead would
    // skip or duplicate a day for coaches far from UTC.
    for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
      const probe = new Date(now.getTime() + dayOffset * 86_400_000);
      const local = zonedDateParts(probe, rule.timezone);

      if (local.weekday !== rule.weekday) continue;

      const hour = Math.floor(rule.startMinute / 60);
      const minute = rule.startMinute % 60;

      const startsAt = wallClockToInstant(
        local.year,
        local.month,
        local.day,
        hour,
        minute,
        rule.timezone,
      );

      if (startsAt < earliest || startsAt > latest) continue;
      if (taken.has(startsAt.getTime())) continue;

      slots.push({
        startsAt: startsAt.toISOString(),
        durationMins: rule.durationMins,
      });
    }
  }

  // Two rules can resolve to the same instant across a DST boundary.
  const unique = new Map(slots.map((s) => [s.startsAt, s]));

  return [...unique.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * May this session still be cancelled without penalty?
 *
 * Returns the decision and the reason, so the UI can explain rather than just
 * disabling a button.
 */
export function cancellationWindow(
  startsAt: Date,
  noticeHours: number,
  now = new Date(),
): { allowed: boolean; hoursUntil: number; reason?: string } {
  const hoursUntil = (startsAt.getTime() - now.getTime()) / 3_600_000;

  if (hoursUntil < 0) {
    return { allowed: false, hoursUntil, reason: "That session has already taken place." };
  }
  if (hoursUntil < noticeHours) {
    return {
      allowed: false,
      hoursUntil,
      reason: `Sessions need ${noticeHours} hours' notice to cancel. Message your coach instead.`,
    };
  }

  return { allowed: true, hoursUntil };
}

/**
 * A minimal iCalendar event, so a booking can be added to a real calendar.
 *
 * This is what replaces the calendar sync you would get from a third-party
 * scheduler. Times are emitted as UTC (the trailing Z), which every calendar
 * client converts to the viewer's own zone.
 */
export function buildIcs(params: {
  uid: string;
  startsAt: Date;
  durationMins: number;
  title: string;
  description?: string;
  url?: string;
}): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(params.startsAt.getTime() + params.durationMins * 60_000);

  // Long lines must be folded at 75 octets per RFC 5545, and commas,
  // semicolons and newlines inside values must be escaped.
  const escape = (v: string) =>
    v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Elovia//Coaching//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${params.uid}@elovia.app`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(params.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(params.title)}`,
    params.description ? `DESCRIPTION:${escape(params.description)}` : null,
    params.url ? `URL:${escape(params.url)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
