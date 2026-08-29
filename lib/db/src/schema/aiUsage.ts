import { index, integer, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
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

    // Tenth-of-a-cent units (micro-USD / 100) to stay in integer math.
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),

    // Which provider actually served the majority of these requests.
    provider: varchar("provider"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // The upsert target. Without this, two concurrent requests each insert
    // their own row, both read a count of 0, and the quota never bites.
    uniqueIndex("UQ_ai_usage_user_day_route").on(table.userId, table.day, table.route),
    index("IDX_ai_usage_user_day").on(table.userId, table.day),
    index("IDX_ai_usage_day").on(table.day),
  ],
);

export type AiUsage = typeof aiUsageTable.$inferSelect;
export type InsertAiUsage = typeof aiUsageTable.$inferInsert;
