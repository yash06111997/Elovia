import { boolean, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Server-side source of truth for subscription state.
 *
 * The client reports what RevenueCat tells it, but a client can lie. This table
 * is populated by the RevenueCat webhook (see routes/webhooks/revenuecat.ts) and
 * is the ONLY thing consulted when gating a paid feature server-side.
 */
export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    // RevenueCat's own identifier for the subscriber, kept so webhook events
    // that arrive before the user row exists can still be reconciled later.
    revenuecatUserId: varchar("revenuecat_user_id"),

    // "Elovia Pro" entitlement state.
    entitlementActive: boolean("entitlement_active").notNull().default(false),
    entitlementId: varchar("entitlement_id"),

    // free | trial | active | expired | cancelled | billing_issue
    status: varchar("status").notNull().default("free"),

    // monthly | yearly | lifetime | null
    tier: varchar("tier"),
    productId: varchar("product_id"),
    store: varchar("store"), // app_store | play_store | promotional

    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),

    // Last raw webhook event, for debugging disputes without replaying history.
    lastEvent: jsonb("last_event"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("IDX_subscriptions_revenuecat_user").on(table.revenuecatUserId),
    index("IDX_subscriptions_entitlement_active").on(table.entitlementActive),
  ],
);

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;
