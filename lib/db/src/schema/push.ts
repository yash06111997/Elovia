import { boolean, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Expo push tokens, one row per device.
 *
 * Push complements rather than replaces the local scheduler: purely time-based
 * reminders (workout time, water) stay local because they need no network and
 * no token. Push exists for things the SERVER knows and the device does not -
 * a weekly digest computed from synced data, a coach follow-up, a subscription
 * event.
 */
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** ExponentPushToken[...] */
    token: varchar("token").notNull(),
    platform: varchar("platform"), // ios | android | web
    deviceName: varchar("device_name"),

    enabled: boolean("enabled").notNull().default(true),

    /**
     * Set when Expo reports the token is dead (DeviceNotRegistered). Kept
     * rather than deleted so a reinstall can revive the row, and so we can see
     * churn rather than silently losing reach.
     */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    lastError: varchar("last_error"),

    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One row per physical token. Reinstalling reuses the token, so upserting
    // on this avoids accumulating duplicates that would double-send.
    uniqueIndex("UQ_push_tokens_token").on(table.token),
    index("IDX_push_tokens_user").on(table.userId),
  ],
);

export type PushToken = typeof pushTokensTable.$inferSelect;
export type InsertPushToken = typeof pushTokensTable.$inferInsert;

/**
 * Supplement and medication entries.
 *
 * Stored server-side so reminders survive a device change, and so the weekly
 * digest can report adherence.
 */
export const supplementsTable = pgTable(
  "supplements",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    name: varchar("name").notNull(),
    /** supplement | medication */
    kind: varchar("kind").notNull().default("supplement"),
    dosage: varchar("dosage"),
    unit: varchar("unit"),

    /** daily | twice_daily | weekly | as_needed */
    frequency: varchar("frequency").notNull().default("daily"),
    /** ["08:00", "20:00"] local times. */
    times: jsonb("times"),
    withFood: boolean("with_food").notNull().default(false),

    notes: varchar("notes"),
    active: boolean("active").notNull().default(true),

    /**
     * Cached AI analysis so the same substance is not re-analysed on every
     * view. Invalidated by clearing the column.
     */
    analysis: jsonb("analysis"),
    analysedAt: timestamp("analysed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("IDX_supplements_user").on(table.userId)],
);

export type Supplement = typeof supplementsTable.$inferSelect;
export type InsertSupplement = typeof supplementsTable.$inferInsert;
