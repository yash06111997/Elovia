import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * Permanent deletion boundary. Deliberately has no FK to users: deleting the
 * account row must not delete the evidence that prevents reprovisioning.
 */
export const accountDeletionTombstonesTable = pgTable(
  "account_deletions",
  {
    userId: varchar("user_id").primaryKey(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 })
      .notNull()
      .default("identity_pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataDeletedAt: timestamp("data_deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("IDX_account_deletions_status").on(table.status),
    check(
      "account_deletions_status_valid",
      sql`${table.status} IN ('identity_pending', 'finalized')`,
    ),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type AccountDeletionTombstone =
  typeof accountDeletionTombstonesTable.$inferSelect;
