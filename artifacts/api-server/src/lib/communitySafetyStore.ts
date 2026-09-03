import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import {
  activityCommentsTable,
  aiResponseReceiptsTable,
  communityMembershipsTable,
  contentReportsTable,
  db,
  moderationAuditLogTable,
  sharedActivitiesTable,
  socialProfilesTable,
} from "@workspace/db";
import {
  canTransitionReportStatus,
  COMMUNITY_TERMS_VERSION,
  reportPriority,
  reviewDeadline,
  type ModerationStatus,
  type MutableModerationStatus,
  type ReportReason,
} from "./communitySafety";
import { canViewUser } from "./social";

const AI_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function cleanupExpiredAiResponseReceipts(now: Date): Promise<void> {
  try {
    await db
      .delete(aiResponseReceiptsTable)
      .where(lt(aiResponseReceiptsTable.expiresAt, now));
  } catch {
    // Cleanup is opportunistic. A transient cleanup error must not discard an
    // otherwise valid coach response; the next successful request retries it.
  }
}

export async function hasCurrentCommunityAccess(
  userId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ userId: communityMembershipsTable.userId })
    .from(communityMembershipsTable)
    .where(
      and(
        eq(communityMembershipsTable.userId, userId),
        eq(communityMembershipsTable.termsVersion, COMMUNITY_TERMS_VERSION),
        eq(communityMembershipsTable.adultAttested, true),
        isNull(communityMembershipsTable.revokedAt),
      ),
    );
  return Boolean(membership);
}

export async function acceptCommunityAccess(userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(communityMembershipsTable)
    .values({
      userId,
      termsVersion: COMMUNITY_TERMS_VERSION,
      adultAttested: true,
      acceptedAt: now,
      revokedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: communityMembershipsTable.userId,
      set: {
        termsVersion: COMMUNITY_TERMS_VERSION,
        adultAttested: true,
        acceptedAt: now,
        revokedAt: null,
        updatedAt: now,
      },
    });
}

/** Keep only a hash until a user deliberately reports the response. */
export async function createAiResponseReceipt(
  userId: string,
  route: string,
  content: string,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(aiResponseReceiptsTable).values({
    id,
    userId,
    route: route.slice(0, 40),
    contentHash: contentHash(content),
    createdAt: now,
    expiresAt: new Date(now.getTime() + AI_RECEIPT_TTL_MS),
  });

  // Bounded opportunistic cleanup avoids a separate worker for a tiny table.
  await cleanupExpiredAiResponseReceipts(now);
  return id;
}

export type ReportTarget = Readonly<{
  targetType: "activity" | "comment" | "user" | "ai_response";
  targetId: string;
  subjectUserId: string | null;
  contentSnapshot: Record<string, unknown>;
}>;

export async function resolveReportTarget(input: {
  reporterUserId: string;
  targetType: ReportTarget["targetType"];
  targetId: string;
  aiContent?: string;
}): Promise<ReportTarget | null> {
  if (input.targetType === "activity") {
    const [activity] = await db
      .select({
        id: sharedActivitiesTable.id,
        userId: sharedActivitiesTable.userId,
        kind: sharedActivitiesTable.kind,
        title: sharedActivitiesTable.title,
        caption: sharedActivitiesTable.caption,
      })
      .from(sharedActivitiesTable)
      .where(eq(sharedActivitiesTable.id, input.targetId));
    if (
      !activity ||
      activity.userId === input.reporterUserId ||
      !(await canViewUser(input.reporterUserId, activity.userId))
    ) {
      return null;
    }
    return {
      targetType: input.targetType,
      targetId: activity.id,
      subjectUserId: activity.userId,
      contentSnapshot: {
        kind: activity.kind,
        title: activity.title,
        caption: activity.caption,
      },
    };
  }

  if (input.targetType === "comment") {
    const [comment] = await db
      .select({
        id: activityCommentsTable.id,
        userId: activityCommentsTable.userId,
        body: activityCommentsTable.body,
        deletedAt: activityCommentsTable.deletedAt,
        activityOwnerId: sharedActivitiesTable.userId,
      })
      .from(activityCommentsTable)
      .innerJoin(
        sharedActivitiesTable,
        eq(activityCommentsTable.activityId, sharedActivitiesTable.id),
      )
      .where(eq(activityCommentsTable.id, input.targetId));
    if (
      !comment ||
      comment.deletedAt ||
      comment.userId === input.reporterUserId ||
      !(await canViewUser(input.reporterUserId, comment.activityOwnerId))
    ) {
      return null;
    }
    return {
      targetType: input.targetType,
      targetId: comment.id,
      subjectUserId: comment.userId,
      contentSnapshot: { body: comment.body },
    };
  }

  if (input.targetType === "user") {
    const [profile] = await db
      .select({
        userId: socialProfilesTable.userId,
        displayName: socialProfilesTable.displayName,
        bio: socialProfilesTable.bio,
      })
      .from(socialProfilesTable)
      .where(eq(socialProfilesTable.userId, input.targetId));
    if (
      !profile ||
      profile.userId === input.reporterUserId ||
      !(await canViewUser(input.reporterUserId, profile.userId))
    ) {
      return null;
    }
    return {
      targetType: input.targetType,
      targetId: profile.userId,
      subjectUserId: profile.userId,
      contentSnapshot: {
        displayName: profile.displayName,
        bio: profile.bio,
      },
    };
  }

  const content = input.aiContent ?? "";
  const [receipt] = await db
    .select()
    .from(aiResponseReceiptsTable)
    .where(
      and(
        eq(aiResponseReceiptsTable.id, input.targetId),
        eq(aiResponseReceiptsTable.userId, input.reporterUserId),
      ),
    );
  if (
    !receipt ||
    receipt.expiresAt.getTime() <= Date.now() ||
    !content ||
    !hashesMatch(receipt.contentHash, contentHash(content))
  ) {
    return null;
  }
  return {
    targetType: input.targetType,
    targetId: receipt.id,
    subjectUserId: null,
    contentSnapshot: {
      route: receipt.route,
      response: content.slice(0, 6_000),
    },
  };
}

export async function createContentReport(input: {
  reporterUserId: string;
  target: ReportTarget;
  reason: ReportReason;
  details: string | null;
}) {
  const priority = reportPriority(input.reason);
  const report = {
    id: randomUUID(),
    reporterUserId: input.reporterUserId,
    targetType: input.target.targetType,
    targetId: input.target.targetId,
    subjectUserId: input.target.subjectUserId,
    reason: input.reason,
    details: input.details,
    contentSnapshot: input.target.contentSnapshot,
    status: "queued" as const,
    priority,
    reviewDueAt: reviewDeadline(priority),
  };

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentReportsTable)
      .values(report)
      .onConflictDoNothing()
      .returning();

    if (created) {
      await tx.insert(moderationAuditLogTable).values({
        id: randomUUID(),
        reportId: created.id,
        actorUserId: input.reporterUserId,
        action: "report_created",
        metadata: { reason: input.reason, priority },
      });
      return { report: created, duplicate: false };
    }

    const [existing] = await tx
      .select()
      .from(contentReportsTable)
      .where(
        and(
          eq(contentReportsTable.reporterUserId, input.reporterUserId),
          eq(contentReportsTable.targetType, input.target.targetType),
          eq(contentReportsTable.targetId, input.target.targetId),
        ),
      );
    if (!existing) throw new Error("Report conflict could not be resolved");
    return { report: existing, duplicate: true };
  });
}

export async function listModerationReports(status?: string) {
  const reports = await db
    .select()
    .from(contentReportsTable)
    .where(status ? eq(contentReportsTable.status, status) : undefined)
    .orderBy(contentReportsTable.reviewDueAt)
    .limit(100);
  if (!reports.length) return [];

  const audit = await db
    .select()
    .from(moderationAuditLogTable)
    .where(
      inArray(
        moderationAuditLogTable.reportId,
        reports.map((report) => report.id),
      ),
    )
    .orderBy(desc(moderationAuditLogTable.createdAt));
  const auditByReport = new Map<string, typeof audit>();
  for (const entry of audit) {
    const entries = auditByReport.get(entry.reportId) ?? [];
    entries.push(entry);
    auditByReport.set(entry.reportId, entries);
  }
  return reports.map((report) => ({
    ...report,
    audit: auditByReport.get(report.id) ?? [],
  }));
}

export async function updateModerationReport(input: {
  reportId: string;
  moderatorUserId: string;
  status: MutableModerationStatus;
  note: string | null;
}) {
  return db.transaction(async (tx) => {
    const allowedCurrentStatuses = (
      ["queued", "reviewing"] as ModerationStatus[]
    ).filter((current) => canTransitionReportStatus(current, input.status));
    const terminal =
      input.status === "actioned" || input.status === "dismissed";
    const [updated] = await tx
      .update(contentReportsTable)
      .set({
        status: input.status,
        resolvedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentReportsTable.id, input.reportId),
          inArray(contentReportsTable.status, allowedCurrentStatuses),
        ),
      )
      .returning();
    if (!updated) {
      const [existing] = await tx
        .select({ id: contentReportsTable.id })
        .from(contentReportsTable)
        .where(eq(contentReportsTable.id, input.reportId));
      return {
        outcome: existing
          ? ("invalid_transition" as const)
          : ("not_found" as const),
        report: null,
      };
    }

    await tx.insert(moderationAuditLogTable).values({
      id: randomUUID(),
      reportId: updated.id,
      actorUserId: input.moderatorUserId,
      action: `status_${input.status}`,
      metadata: input.note ? { note: input.note } : {},
    });
    return { outcome: "updated" as const, report: updated };
  });
}
