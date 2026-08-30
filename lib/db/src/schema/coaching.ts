import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * In-app session booking.
 *
 * Time handling is the whole difficulty here, so it is settled once, at the
 * schema level:
 *
 *   - Availability is RECURRING and stored in the coach's own IANA timezone as
 *     a weekday plus minutes-from-midnight. It cannot be stored as UTC,
 *     because "every Tuesday at 9am for the coach" is a different UTC instant
 *     before and after daylight saving.
 *   - Bookings are ABSOLUTE and stored as timestamptz, i.e. a real instant.
 *     Once a slot is taken it refers to one moment in time regardless of what
 *     either party's clock later does.
 *   - Clients render everything in their own device timezone. Nothing in the
 *     database is ever in the client's zone.
 */

export const coachAvailabilityTable = pgTable(
  "coach_availability",
  {
    id: varchar("id").primaryKey(),
    coachUserId: varchar("coach_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** 0 = Sunday through 6 = Saturday, in the coach's timezone. */
    weekday: integer("weekday").notNull(),
    /** Minutes from local midnight. 540 = 09:00. */
    startMinute: integer("start_minute").notNull(),
    durationMins: integer("duration_mins").notNull().default(45),

    /**
     * IANA zone, e.g. "Europe/London". Required: without it a weekday plus a
     * minute offset does not identify any actual moment.
     */
    timezone: varchar("timezone").notNull(),

    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("UQ_availability_slot").on(table.coachUserId, table.weekday, table.startMinute),
    index("IDX_availability_coach").on(table.coachUserId, table.active),
  ],
);

export type CoachAvailability = typeof coachAvailabilityTable.$inferSelect;

/**
 * A booked session.
 *
 * `startsAt` is the source of truth. The unique index on (coach, startsAt) is
 * what actually prevents double-booking — checking for a clash in application
 * code loses the race between two clients tapping the same slot, whereas the
 * database cannot.
 */
export const coachingSessionsTable = pgTable(
  "coaching_sessions",
  {
    id: varchar("id").primaryKey(),

    coachUserId: varchar("coach_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientUserId: varchar("client_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMins: integer("duration_mins").notNull().default(45),

    /** booked | completed | cancelled_by_client | cancelled_by_coach | no_show */
    status: varchar("status").notNull().default("booked"),

    /** intro | coaching — intro calls are free and shorter. */
    kind: varchar("kind").notNull().default("coaching"),

    /** Where the call happens. A room link, set per coach or per session. */
    meetingUrl: varchar("meeting_url"),

    /** What the client wants to cover, captured at booking time. */
    clientNote: varchar("client_note"),
    /** The coach's write-up afterwards, visible to the client. */
    coachNote: varchar("coach_note"),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: varchar("cancelled_reason"),

    /** Set once the reminder has gone out, so it is never sent twice. */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The double-booking guard. Application-level checks lose the race.
    uniqueIndex("UQ_session_coach_start").on(table.coachUserId, table.startsAt),
    index("IDX_sessions_client").on(table.clientUserId, table.startsAt),
    index("IDX_sessions_coach").on(table.coachUserId, table.startsAt),
    index("IDX_sessions_upcoming").on(table.startsAt, table.status),
  ],
);

export type CoachingSession = typeof coachingSessionsTable.$inferSelect;
export type InsertCoachingSession = typeof coachingSessionsTable.$inferInsert;

/**
 * Coach profile.
 *
 * Separate from social_profiles: a coach is a role with scheduling settings,
 * not a variation on a user's social presence.
 */
export const coachProfilesTable = pgTable("coach_profiles", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  displayName: varchar("display_name").notNull(),
  timezone: varchar("timezone").notNull().default("UTC"),

  /** Default room used for sessions when one is not set individually. */
  defaultMeetingUrl: varchar("default_meeting_url"),

  /**
   * Hard cap on concurrent clients. Coaching quality collapses past roughly
   * 30, so the limit is enforced rather than left to judgement.
   */
  maxClients: integer("max_clients").notNull().default(30),

  /** Hours of notice required to cancel without losing the session. */
  cancellationNoticeHours: integer("cancellation_notice_hours").notNull().default(24),

  /** How far ahead clients may book. */
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(28),

  acceptingClients: boolean("accepting_clients").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CoachProfile = typeof coachProfilesTable.$inferSelect;
