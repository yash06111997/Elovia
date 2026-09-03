import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/** Adult, versioned consent required before any Community data is exposed. */
export const communityMembershipsTable = pgTable(
  "community_memberships",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    termsVersion: varchar("terms_version", { length: 32 }).notNull(),
    adultAttested: boolean("adult_attested").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "community_membership_adult_attested",
      sql`${table.adultAttested} = true`,
    ),
    index("IDX_community_memberships_terms").on(
      table.termsVersion,
      table.revokedAt,
    ),
  ],
);

/**
 * A privacy-minimised receipt for generated AI content.
 *
 * The response body is not retained here. A report can be accepted only when
 * the caller supplies content whose hash matches this server-issued receipt;
 * the sensitive snapshot is persisted only after the user reports it.
 */
export const aiResponseReceiptsTable = pgTable(
  "ai_response_receipts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    route: varchar("route", { length: 40 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "ai_response_receipt_hash_valid",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "ai_response_receipt_expiry_valid",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("IDX_ai_response_receipts_cleanup").on(table.expiresAt),
    index("IDX_ai_response_receipts_user").on(table.userId, table.createdAt),
  ],
);

export const contentReportsTable = pgTable(
  "content_reports",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    reporterUserId: varchar("reporter_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: varchar("target_id", { length: 64 }).notNull(),
    subjectUserId: varchar("subject_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    reason: varchar("reason", { length: 40 }).notNull(),
    details: varchar("details", { length: 500 }),
    contentSnapshot: jsonb("content_snapshot").notNull().default({}),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    priority: varchar("priority", { length: 16 }).notNull().default("standard"),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
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
      "content_report_target_valid",
      sql`${table.targetType} in ('activity','comment','user','ai_response')`,
    ),
    check(
      "content_report_status_valid",
      sql`${table.status} in ('queued','reviewing','actioned','dismissed')`,
    ),
    check(
      "content_report_priority_valid",
      sql`${table.priority} in ('standard','urgent')`,
    ),
    check(
      "content_report_reason_valid",
      sql`${table.reason} in ('harassment','hate','sexual_content','self_harm','dangerous_advice','privacy','spam','other')`,
    ),
    check(
      "content_report_resolution_valid",
      sql`(${table.status} in ('actioned','dismissed') and ${table.resolvedAt} is not null) or (${table.status} in ('queued','reviewing') and ${table.resolvedAt} is null)`,
    ),
    uniqueIndex("UQ_content_reports_reporter_target").on(
      table.reporterUserId,
      table.targetType,
      table.targetId,
    ),
    index("IDX_content_reports_queue").on(
      table.status,
      table.priority,
      table.reviewDueAt,
    ),
    index("IDX_content_reports_subject").on(
      table.subjectUserId,
      table.createdAt,
    ),
  ],
);

/** Insert-only operational history for every moderation state transition. */
export const moderationAuditLogTable = pgTable(
  "moderation_audit_log",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    reportId: varchar("report_id", { length: 64 })
      .notNull()
      .references(() => contentReportsTable.id),
    actorUserId: varchar("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 40 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_moderation_audit_report").on(table.reportId, table.createdAt),
  ],
);

export type CommunityMembership = typeof communityMembershipsTable.$inferSelect;
export type ContentReport = typeof contentReportsTable.$inferSelect;
export type ModerationAuditEntry = typeof moderationAuditLogTable.$inferSelect;
