import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Per-user, per-day AI spend accounting.
 *
 * Authentication stops strangers from burning the LLM budget; it does nothing
 * about one legitimate paid user looping plan generation. This table is the
 * quota mechanism: one row per (user, UTC day, route), incremented before the
 * upstream call so a burst of concurrent requests cannot slip past the check.
 */
export const aiUsageTable = pgTable(
  "ai_usage",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    // UTC date bucket, "YYYY-MM-DD". Stored as text so the unique key is
    // timezone-stable regardless of server locale.
    day: varchar("day").notNull(),

    // recognize-food | generate-workout | generate-meal-plan | generate-recipe | coach-chat
    route: varchar("route").notNull(),

    requestCount: integer("request_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),

    // Micro-USD (1e-6 USD), including unresolved provider reservations.
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),

    // Which provider actually served the majority of these requests.
    provider: varchar("provider"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The upsert target. Without this, two concurrent requests each insert
    // their own row, both read a count of 0, and the quota never bites.
    uniqueIndex("UQ_ai_usage_user_day_route").on(
      table.userId,
      table.day,
      table.route,
    ),
    index("IDX_ai_usage_user_day").on(table.userId, table.day),
    index("IDX_ai_usage_day").on(table.day),
  ],
);

export type AiUsage = typeof aiUsageTable.$inferSelect;
export type InsertAiUsage = typeof aiUsageTable.$inferInsert;

/** No prompt, image, model output or health data is stored in this ledger. */
export const aiRequestsTable = pgTable(
  "ai_requests",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    day: varchar("day").notNull(),
    route: varchar("route").notNull(),
    costCeilingMicros: integer("cost_ceiling_micros").notNull(),
    status: varchar("status").notNull().default("claimed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_ai_requests_user_day").on(table.userId, table.day),
    check(
      "ai_request_status_valid",
      sql`${table.status} IN ('claimed', 'started', 'closed')`,
    ),
    check("ai_request_ceiling_positive", sql`${table.costCeilingMicros} > 0`),
  ],
);

export const aiAttemptsTable = pgTable(
  "ai_attempts",
  {
    id: varchar("id").primaryKey(),
    requestId: varchar("request_id")
      .notNull()
      .references(() => aiRequestsTable.id, { onDelete: "cascade" }),
    provider: varchar("provider").notNull(),
    model: varchar("model"),
    reservedCostMicros: integer("reserved_cost_micros").notNull(),
    estimatedCostMicros: integer("estimated_cost_micros"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("IDX_ai_attempts_request").on(table.requestId),
    check(
      "ai_attempt_reservation_positive",
      sql`${table.reservedCostMicros} > 0`,
    ),
    check(
      "ai_attempt_usage_nonnegative",
      sql`${table.estimatedCostMicros} >= 0 AND ${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0`,
    ),
  ],
);
