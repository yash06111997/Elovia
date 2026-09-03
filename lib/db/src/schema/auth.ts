import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

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
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Durable, short-lived Google OAuth state for native sign-in.
 *
 * Provider state and redemption codes are persisted only as SHA-256 hashes.
 * The Google token is authenticated-encrypted until a PKCE-bound exchange
 * consumes it; it is never sent through an app/custom-scheme URL.
 */
export const mobileOAuthAttemptsTable = pgTable(
  "mobile_oauth_attempts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    providerStateHash: varchar("provider_state_hash", { length: 64 }).notNull(),
    clientState: varchar("client_state", { length: 128 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    returnUrl: varchar("return_url", { length: 512 }),
    codeChallenge: varchar("code_challenge", { length: 64 }),
    providerClaimedAt: timestamp("provider_claimed_at", {
      withTimezone: true,
    }),
    exchangeCodeHash: varchar("exchange_code_hash", { length: 64 }),
    encryptedProviderToken: text("encrypted_provider_token"),
    exchangeExpiresAt: timestamp("exchange_expires_at", {
      withTimezone: true,
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("UQ_mobile_oauth_provider_state_hash").on(
      table.providerStateHash,
    ),
    uniqueIndex("UQ_mobile_oauth_exchange_code_hash")
      .on(table.exchangeCodeHash)
      .where(sql`${table.exchangeCodeHash} IS NOT NULL`),
    index("IDX_mobile_oauth_cleanup").on(table.expiresAt, table.consumedAt),
    check(
      "mobile_oauth_state_valid",
      sql`${table.providerStateHash} ~ '^[a-f0-9]{64}$' AND length(${table.clientState}) BETWEEN 16 AND 128`,
    ),
    check(
      "mobile_oauth_mode_valid",
      sql`${table.mode} IN ('redirect','popup')`,
    ),
    check(
      "mobile_oauth_redirect_valid",
      sql`(${table.mode} = 'redirect' AND ${table.returnUrl} IS NOT NULL AND ${table.codeChallenge} ~ '^[A-Za-z0-9_-]{43}$') OR (${table.mode} = 'popup' AND ${table.returnUrl} IS NULL AND ${table.codeChallenge} IS NULL)`,
    ),
    check(
      "mobile_oauth_exchange_valid",
      sql`(${table.exchangeCodeHash} IS NULL AND ${table.encryptedProviderToken} IS NULL AND ${table.exchangeExpiresAt} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.exchangeCodeHash} ~ '^[a-f0-9]{64}$' AND ${table.exchangeExpiresAt} IS NOT NULL AND (${table.encryptedProviderToken} IS NOT NULL OR ${table.consumedAt} IS NOT NULL))`,
    ),
    check(
      "mobile_oauth_expiry_valid",
      sql`${table.expiresAt} > ${table.createdAt} AND (${table.exchangeExpiresAt} IS NULL OR (${table.exchangeExpiresAt} >= ${table.createdAt} AND ${table.exchangeExpiresAt} <= ${table.expiresAt}))`,
    ),
  ],
);

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
    identityAttemptCount: integer("identity_attempt_count")
      .notNull()
      .default(0),
    identityNextAttemptAt: timestamp("identity_next_attempt_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    identityLeaseId: varchar("identity_lease_id", { length: 128 }),
    identityLeaseUntil: timestamp("identity_lease_until", {
      withTimezone: true,
    }),
    identityLastAttemptAt: timestamp("identity_last_attempt_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    index("IDX_account_deletions_status").on(table.status),
    index("IDX_account_deletions_identity_retry").on(
      table.status,
      table.identityNextAttemptAt,
      table.identityLeaseUntil,
    ),
    check(
      "account_deletions_status_valid",
      sql`${table.status} IN ('identity_pending', 'finalized')`,
    ),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
export type MobileOAuthAttempt = typeof mobileOAuthAttemptsTable.$inferSelect;
export type AccountDeletionTombstone =
  typeof accountDeletionTombstonesTable.$inferSelect;
