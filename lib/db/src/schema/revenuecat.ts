import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

const cVarchar = customType<{
  data: string;
  config: { length: number };
  configRequired: true;
}>({
  dataType(config) {
    return `varchar(${config.length}) COLLATE "C"`;
  },
});

export const REVENUECAT_SUBJECT_ROLE_MASKS = Object.freeze({
  primary: 1,
  original: 2,
  alias: 4,
  transferredFrom: 8,
  transferredTo: 16,
  redeemedFrom: 32,
  redeemedBy: 64,
} as const);

export const revenuecatWebhookEventsTable = pgTable(
  "revenuecat_webhook_events",
  {
    eventId: cVarchar("event_id", { length: 128 }).primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    environment: varchar("environment", { length: 16 }),
    disposition: varchar("disposition", { length: 32 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    identityCount: integer("identity_count").notNull(),
    retainedIdentityCount: integer("retained_identity_count")
      .notNull()
      .default(0),
    prunedIdentityCount: integer("pruned_identity_count").notNull().default(0),
    identityRequired: boolean("identity_required").notNull(),
    identityAppliedAt: timestamp("identity_applied_at", { withTimezone: true }),
    entitlementRequired: boolean("entitlement_required").notNull(),
    entitlementAppliedAt: timestamp("entitlement_applied_at", {
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    processingLeaseId: varchar("processing_lease_id", { length: 128 }),
    processingLeaseUntil: timestamp("processing_lease_until", {
      withTimezone: true,
    }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    retentionUntil: timestamp("retention_until", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    check(
      "revenuecat_event_identity_valid",
      sql`${table.eventId} ~ '^[A-Za-z0-9_-]{8,128}$' AND ${table.type} ~ '^[A-Z0-9_]{3,64}$' AND ${table.eventAt} > '1970-01-01T00:00:00Z'::timestamptz`,
    ),
    check(
      "revenuecat_event_environment_valid",
      sql`${table.environment} IS NULL OR ${table.environment} IN ('production','sandbox')`,
    ),
    check(
      "revenuecat_event_disposition_valid",
      sql`${table.disposition} IN ('pending','applied','stale','ignored_unknown')`,
    ),
    check(
      "revenuecat_event_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check(
      "revenuecat_event_identity_count_valid",
      sql`${table.identityCount} BETWEEN 0 AND 256 AND ${table.retainedIdentityCount} BETWEEN 0 AND ${table.identityCount} AND ${table.prunedIdentityCount} BETWEEN 0 AND ${table.identityCount} AND ${table.retainedIdentityCount} + ${table.prunedIdentityCount} <= ${table.identityCount}`,
    ),
    check(
      "revenuecat_event_phase_fields_valid",
      sql`${table.identityRequired} = (${table.identityCount} > 0) AND (NOT ${table.entitlementRequired} OR ${table.identityRequired}) AND (${table.identityRequired} OR ${table.identityAppliedAt} IS NULL) AND (${table.entitlementRequired} OR ${table.entitlementAppliedAt} IS NULL)`,
    ),
    check("revenuecat_event_attempt_valid", sql`${table.attemptCount} >= 0`),
    check(
      "revenuecat_event_lease_consistent",
      sql`(${table.processingLeaseId} IS NULL) = (${table.processingLeaseUntil} IS NULL) AND (${table.processingLeaseId} IS NULL OR length(${table.processingLeaseId}) BETWEEN 8 AND 128)`,
    ),
    check(
      "revenuecat_event_state_consistent",
      sql`(${table.disposition} = 'pending' AND ${table.processedAt} IS NULL) OR (${table.disposition} IN ('applied','stale') AND ${table.processedAt} IS NOT NULL AND (NOT ${table.identityRequired} OR ${table.identityAppliedAt} IS NOT NULL) AND (NOT ${table.entitlementRequired} OR ${table.entitlementAppliedAt} IS NOT NULL) AND ${table.processingLeaseId} IS NULL AND ${table.processingLeaseUntil} IS NULL) OR (${table.disposition} = 'ignored_unknown' AND ${table.processedAt} IS NOT NULL AND ${table.identityCount} = 0 AND ${table.identityRequired} = false AND ${table.entitlementRequired} = false AND ${table.identityAppliedAt} IS NULL AND ${table.entitlementAppliedAt} IS NULL AND ${table.processingLeaseId} IS NULL AND ${table.processingLeaseUntil} IS NULL)`,
    ),
    check(
      "revenuecat_event_schedule_valid",
      sql`${table.nextAttemptAt} >= ${table.receivedAt} AND (${table.identityAppliedAt} IS NULL OR ${table.identityAppliedAt} >= ${table.receivedAt}) AND (${table.entitlementAppliedAt} IS NULL OR ${table.entitlementAppliedAt} >= ${table.receivedAt}) AND (${table.processedAt} IS NULL OR (${table.processedAt} >= ${table.receivedAt} AND (${table.identityAppliedAt} IS NULL OR ${table.processedAt} >= ${table.identityAppliedAt}) AND (${table.entitlementAppliedAt} IS NULL OR ${table.processedAt} >= ${table.entitlementAppliedAt})))`,
    ),
    check(
      "revenuecat_event_retention_valid",
      sql`${table.retentionUntil} > ${table.receivedAt}`,
    ),
    index("IDX_revenuecat_events_type_time").on(
      table.type,
      table.eventAt.desc(),
    ),
    index("IDX_revenuecat_events_pending_due").on(
      table.disposition,
      table.nextAttemptAt,
      table.processingLeaseUntil,
      table.identityAppliedAt,
      table.entitlementAppliedAt,
    ),
    index("IDX_revenuecat_events_retention").on(
      table.retentionUntil,
      table.disposition,
    ),
  ],
);

export const revenuecatEventSubjectsTable = pgTable(
  "revenuecat_event_subjects",
  {
    eventId: cVarchar("event_id", { length: 128 })
      .notNull()
      .references(() => revenuecatWebhookEventsTable.eventId, {
        onDelete: "cascade",
      }),
    subjectHash: char("subject_hash", { length: 64 }).notNull(),
    roleMask: smallint("role_mask").notNull(),
    localUserId: varchar("local_user_id").references(() => usersTable.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.subjectHash] }),
    check(
      "revenuecat_subject_hash_valid",
      sql`${table.subjectHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "revenuecat_subject_role_mask_valid",
      sql`${table.roleMask} BETWEEN 1 AND 127`,
    ),
    index("IDX_revenuecat_event_subjects_local").on(
      table.localUserId,
      table.eventId,
    ),
    index("IDX_revenuecat_event_subjects_hash").on(
      table.subjectHash,
      table.eventId,
    ),
  ],
);

export const revenuecatCustomerAliasesTable = pgTable(
  "revenuecat_customer_aliases",
  {
    aliasHash: char("alias_hash", { length: 64 }).primaryKey(),
    localUserId: varchar("local_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    aliasKind: varchar("alias_kind", { length: 32 }).notNull(),
    ownershipSource: varchar("ownership_source", { length: 16 }).notNull(),
    sourceEventAt: timestamp("source_event_at", { withTimezone: true }),
    sourceEventId: cVarchar("source_event_id", { length: 128 }),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "revenuecat_alias_hash_valid",
      sql`${table.aliasHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "revenuecat_alias_kind_valid",
      sql`${table.aliasKind} IN ('authenticated','anonymous','original','ordinary','transferred')`,
    ),
    check(
      "revenuecat_alias_ownership_source_valid",
      sql`${table.ownershipSource} IN ('webhook','authenticated')`,
    ),
    check(
      "revenuecat_alias_provenance_valid",
      sql`(${table.ownershipSource} = 'webhook' AND ${table.sourceEventAt} > '1970-01-01T00:00:00Z'::timestamptz AND ${table.sourceEventId} ~ '^[A-Za-z0-9_-]{8,128}$' AND ${table.authenticatedAt} IS NULL) OR (${table.ownershipSource} = 'authenticated' AND ${table.aliasKind} = 'authenticated' AND ${table.sourceEventAt} IS NULL AND ${table.sourceEventId} IS NULL AND ${table.authenticatedAt} > '1970-01-01T00:00:00Z'::timestamptz)`,
    ),
    index("IDX_revenuecat_aliases_local").on(table.localUserId),
    index("IDX_revenuecat_aliases_source").on(
      table.ownershipSource,
      table.sourceEventAt,
      table.sourceEventId,
    ),
  ],
);

export const revenuecatCustomerStateTable = pgTable(
  "revenuecat_customer_state",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    canonicalizationState: varchar("canonicalization_state", {
      length: 32,
    }).notNull(),
    sourceKind: varchar("source_kind", { length: 32 }).notNull(),
    sourceEnvironment: varchar("source_environment", { length: 16 }),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    lastOperationId: cVarchar("last_operation_id", { length: 192 }),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    reconcileReason: varchar("reconcile_reason", { length: 32 }).notNull(),
    reconcileAfter: timestamp("reconcile_after", {
      withTimezone: true,
    }).notNull(),
    reconcileAttemptCount: integer("reconcile_attempt_count")
      .notNull()
      .default(0),
    reconcileLeaseId: varchar("reconcile_lease_id", { length: 128 }),
    reconcileLeaseUntil: timestamp("reconcile_lease_until", {
      withTimezone: true,
    }),
    reconcileLastErrorCode: varchar("reconcile_last_error_code", {
      length: 64,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "revenuecat_customer_state_valid",
      sql`${table.canonicalizationState} IN ('legacy_unverified','pending','canonical')`,
    ),
    check(
      "revenuecat_customer_source_kind_valid",
      sql`${table.sourceKind} IN ('none','legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')`,
    ),
    check(
      "revenuecat_customer_environment_valid",
      sql`${table.sourceEnvironment} IS NULL OR ${table.sourceEnvironment} IN ('production','sandbox')`,
    ),
    check(
      "revenuecat_customer_reason_valid",
      sql`${table.reconcileReason} IN ('legacy_bootstrap','webhook_failure','authenticated','on_demand','scheduled')`,
    ),
    check(
      "revenuecat_customer_attempt_valid",
      sql`${table.reconcileAttemptCount} >= 0`,
    ),
    check(
      "revenuecat_customer_schedule_valid",
      sql`${table.reconcileAfter} > '1970-01-01T00:00:00Z'::timestamptz AND (${table.lastSnapshotAt} IS NULL OR ${table.lastSnapshotAt} > '1970-01-01T00:00:00Z'::timestamptz) AND (${table.lastReconciledAt} IS NULL OR ${table.lastReconciledAt} > '1970-01-01T00:00:00Z'::timestamptz)`,
    ),
    check(
      "revenuecat_customer_lease_consistent",
      sql`(${table.reconcileLeaseId} IS NULL) = (${table.reconcileLeaseUntil} IS NULL) AND (${table.reconcileLeaseId} IS NULL OR length(${table.reconcileLeaseId}) BETWEEN 8 AND 128)`,
    ),
    check(
      "revenuecat_customer_error_code_valid",
      sql`${table.reconcileLastErrorCode} IS NULL OR ${table.reconcileLastErrorCode} ~ '^[a-z0-9_]{3,64}$'`,
    ),
    check(
      "revenuecat_customer_operation_valid",
      sql`${table.lastOperationId} IS NULL OR ${table.lastOperationId} ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'`,
    ),
    check(
      "revenuecat_customer_operation_source_consistent",
      sql`${table.lastOperationId} IS NULL OR (${table.sourceKind} = 'webhook_canonical' AND ${table.lastOperationId} LIKE 'webhook:%') OR (${table.sourceKind} = 'bootstrap_canonical' AND ${table.lastOperationId} LIKE 'bootstrap:%') OR (${table.sourceKind} = 'auth_canonical' AND ${table.lastOperationId} LIKE 'auth:%') OR (${table.sourceKind} = 'worker_canonical' AND ${table.lastOperationId} LIKE 'worker:%')`,
    ),
    check(
      "revenuecat_customer_canonical_consistent",
      sql`(${table.canonicalizationState} = 'legacy_unverified' AND ${table.sourceKind} = 'legacy_unverified' AND ${table.sourceEnvironment} IS NULL AND ${table.lastSnapshotAt} IS NULL AND ${table.lastOperationId} IS NULL) OR (${table.canonicalizationState} = 'pending' AND ${table.sourceKind} = 'none' AND ${table.sourceEnvironment} IS NULL AND ${table.lastSnapshotAt} IS NULL AND ${table.lastOperationId} IS NULL) OR (${table.canonicalizationState} = 'canonical' AND ${table.sourceKind} IN ('webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical') AND ${table.sourceEnvironment} IS NOT NULL AND ${table.lastSnapshotAt} IS NOT NULL AND ${table.lastOperationId} IS NOT NULL AND ${table.lastReconciledAt} IS NOT NULL)`,
    ),
    index("IDX_revenuecat_customer_reconcile_due").on(
      table.reconcileAfter,
      table.reconcileLeaseUntil,
      table.userId,
    ),
  ],
);

export const subscriptionEntitlementsTable = pgTable(
  "subscription_entitlements",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    entitlementId: varchar("entitlement_id", { length: 128 }).notNull(),
    active: boolean("active").notNull().default(false),
    status: varchar("status", { length: 32 }).notNull(),
    productId: varchar("product_id", { length: 256 }),
    store: varchar("store", { length: 32 }),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    accessEndsAt: timestamp("access_ends_at", { withTimezone: true }),
    willRenew: boolean("will_renew").notNull().default(false),
    sourceEnvironment: varchar("source_environment", { length: 16 }),
    sourceKind: varchar("source_kind", { length: 32 }).notNull(),
    sourceSnapshotAt: timestamp("source_snapshot_at", {
      withTimezone: true,
    }).notNull(),
    sourceOperationId: cVarchar("source_operation_id", {
      length: 192,
    }).notNull(),
    sourceTriggerEventId: cVarchar("source_trigger_event_id", {
      length: 128,
    }).references(() => revenuecatWebhookEventsTable.eventId, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.entitlementId] }),
    check(
      "subscription_entitlement_id_valid",
      sql`length(btrim(${table.entitlementId})) BETWEEN 1 AND 128`,
    ),
    check(
      "subscription_entitlement_status_valid",
      sql`${table.status} IN ('active','trial','intro','prepaid','promotional','cancelled','billing_issue','grace','expired','refunded','paused')`,
    ),
    check(
      "subscription_entitlement_store_valid",
      sql`${table.store} IS NULL OR ${table.store} IN ('app_store','mac_app_store','play_store','amazon','stripe','promotional','rc_billing','paddle','roku','test_store')`,
    ),
    check(
      "subscription_entitlement_environment_valid",
      sql`${table.sourceEnvironment} IS NULL OR ${table.sourceEnvironment} IN ('production','sandbox')`,
    ),
    check(
      "subscription_entitlement_source_kind_valid",
      sql`${table.sourceKind} IN ('legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')`,
    ),
    check(
      "subscription_entitlement_operation_valid",
      sql`${table.sourceOperationId} = 'legacy' OR ${table.sourceOperationId} ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'`,
    ),
    check(
      "subscription_entitlement_operation_source_consistent",
      sql`(${table.sourceKind} = 'legacy_unverified' AND ${table.sourceOperationId} = 'legacy') OR (${table.sourceKind} = 'webhook_canonical' AND ${table.sourceOperationId} LIKE 'webhook:%') OR (${table.sourceKind} = 'bootstrap_canonical' AND ${table.sourceOperationId} LIKE 'bootstrap:%') OR (${table.sourceKind} = 'auth_canonical' AND ${table.sourceOperationId} LIKE 'auth:%') OR (${table.sourceKind} = 'worker_canonical' AND ${table.sourceOperationId} LIKE 'worker:%')`,
    ),
    check(
      "subscription_entitlement_source_consistent",
      sql`(${table.sourceKind} = 'legacy_unverified' AND ${table.sourceEnvironment} IS NULL AND ${table.entitlementId} = '__legacy_unverified__' AND ${table.active} = false AND ${table.status} = 'expired' AND ${table.productId} IS NULL AND ${table.store} IS NULL AND ${table.periodEndsAt} IS NULL AND ${table.graceEndsAt} IS NULL AND ${table.accessEndsAt} IS NULL AND ${table.willRenew} = false AND ${table.sourceSnapshotAt} = '1970-01-01T00:00:00Z'::timestamptz AND ${table.sourceOperationId} = 'legacy' AND ${table.sourceTriggerEventId} IS NULL) OR (${table.sourceKind} <> 'legacy_unverified' AND ${table.sourceEnvironment} IS NOT NULL AND ${table.sourceSnapshotAt} > '1970-01-01T00:00:00Z'::timestamptz AND (${table.sourceKind} = 'webhook_canonical' OR ${table.sourceTriggerEventId} IS NULL))`,
    ),
    check(
      "subscription_entitlement_active_status_valid",
      sql`${table.active} = (${table.status} NOT IN ('expired','refunded'))`,
    ),
    check(
      "subscription_entitlement_renewal_valid",
      sql`${table.willRenew} = false OR (${table.active} = true AND ${table.status} IN ('active','trial','intro','billing_issue','grace'))`,
    ),
    check(
      "subscription_entitlement_access_window_valid",
      sql`${table.status} = 'refunded' OR ${table.accessEndsAt} IS NULL OR ${table.periodEndsAt} IS NULL OR ${table.accessEndsAt} >= ${table.periodEndsAt}`,
    ),
    index("IDX_subscription_entitlements_active").on(
      table.userId,
      table.active,
      table.accessEndsAt,
    ),
    index("IDX_subscription_entitlements_source").on(
      table.userId,
      table.sourceSnapshotAt,
      table.sourceOperationId,
    ),
  ],
);

export type RevenueCatWebhookEvent =
  typeof revenuecatWebhookEventsTable.$inferSelect;
export type InsertRevenueCatWebhookEvent =
  typeof revenuecatWebhookEventsTable.$inferInsert;
export type RevenueCatEventSubject =
  typeof revenuecatEventSubjectsTable.$inferSelect;
export type InsertRevenueCatEventSubject =
  typeof revenuecatEventSubjectsTable.$inferInsert;
export type RevenueCatCustomerAlias =
  typeof revenuecatCustomerAliasesTable.$inferSelect;
export type InsertRevenueCatCustomerAlias =
  typeof revenuecatCustomerAliasesTable.$inferInsert;
export type RevenueCatCustomerState =
  typeof revenuecatCustomerStateTable.$inferSelect;
export type InsertRevenueCatCustomerState =
  typeof revenuecatCustomerStateTable.$inferInsert;
export type SubscriptionEntitlement =
  typeof subscriptionEntitlementsTable.$inferSelect;
export type InsertSubscriptionEntitlement =
  typeof subscriptionEntitlementsTable.$inferInsert;
