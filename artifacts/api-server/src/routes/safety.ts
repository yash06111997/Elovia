import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { requireAuth } from "../middlewares/aiGate";
import { rateLimit } from "../lib/rateLimit";
import {
  createContentReport,
  hasCurrentCommunityAccess,
  listModerationReports,
  resolveReportTarget,
  updateModerationReport,
} from "../lib/communitySafetyStore";
import { isReportReason } from "../lib/communitySafety";

const router: IRouter = Router();
const TARGET_TYPES = new Set(["activity", "comment", "user", "ai_response"]);
const MODERATION_STATUSES = new Set([
  "queued",
  "reviewing",
  "actioned",
  "dismissed",
]);
const MUTABLE_MODERATION_STATUSES = new Set([
  "reviewing",
  "actioned",
  "dismissed",
]);

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, max);
}

function moderatorIds(): Set<string> {
  return new Set(
    (process.env.MODERATOR_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function requireModerator(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res
      .status(401)
      .json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  if (!moderatorIds().has(req.user.id)) {
    res
      .status(403)
      .json({ error: "Moderator access required", code: "forbidden" });
    return;
  }
  next();
}

router.post(
  "/safety/reports",
  requireAuth,
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyPrefix: "safety-report",
    message: "Too many reports. Please try again later.",
  }),
  async (req: Request, res: Response) => {
    const targetType = clean(req.body?.targetType, 32);
    const targetId = clean(req.body?.targetId, 64);
    const reason = req.body?.reason;
    const details = clean(req.body?.details, 500) || null;
    const aiContent =
      typeof req.body?.content === "string" && req.body.content.length <= 12_000
        ? req.body.content
        : undefined;

    if (!TARGET_TYPES.has(targetType) || !targetId || !isReportReason(reason)) {
      res.status(400).json({ error: "Invalid report", code: "bad_request" });
      return;
    }
    if (targetType === "ai_response" && aiContent === undefined) {
      res.status(400).json({ error: "Invalid AI report", code: "bad_request" });
      return;
    }

    try {
      if (
        targetType !== "ai_response" &&
        !(await hasCurrentCommunityAccess(req.user!.id))
      ) {
        res.status(403).json({
          error: "Accept the Community Standards first",
          code: "community_terms_required",
        });
        return;
      }

      const target = await resolveReportTarget({
        reporterUserId: req.user!.id,
        targetType: targetType as
          | "activity"
          | "comment"
          | "user"
          | "ai_response",
        targetId,
        aiContent,
      });
      if (!target) {
        res.status(404).json({ error: "Not found", code: "not_found" });
        return;
      }

      const result = await createContentReport({
        reporterUserId: req.user!.id,
        target,
        reason,
        details,
      });
      res.status(result.duplicate ? 200 : 201).json({
        report: {
          id: result.report.id,
          status: result.report.status,
          priority: result.report.priority,
          reviewDueAt: result.report.reviewDueAt,
        },
        duplicate: result.duplicate,
      });
    } catch (err) {
      // Never log the request body: report snapshots may contain health data.
      req.log.error(
        {
          errorType: err instanceof Error ? err.name : "UnknownError",
          targetType,
        },
        "Safety report failed",
      );
      res
        .status(500)
        .json({ error: "Could not submit that report", code: "report_failed" });
    }
  },
);

router.get(
  "/safety/moderation/reports",
  requireModerator,
  async (req: Request, res: Response) => {
    const status = clean(req.query.status, 20);
    if (status && !MODERATION_STATUSES.has(status)) {
      res
        .status(400)
        .json({ error: "Invalid moderation status", code: "bad_request" });
      return;
    }
    try {
      const reports = await listModerationReports(status || undefined);
      res.json({ reports });
    } catch (err) {
      req.log.error(
        { errorType: err instanceof Error ? err.name : "UnknownError" },
        "Moderation queue failed",
      );
      res.status(500).json({
        error: "Could not load moderation queue",
        code: "queue_failed",
      });
    }
  },
);

router.patch(
  "/safety/moderation/reports/:id",
  requireModerator,
  async (req: Request, res: Response) => {
    const reportId = clean(req.params.id, 64);
    const status = clean(req.body?.status, 20);
    const note = clean(req.body?.note, 500) || null;
    if (!reportId || !MUTABLE_MODERATION_STATUSES.has(status)) {
      res
        .status(400)
        .json({ error: "Invalid moderation update", code: "bad_request" });
      return;
    }
    try {
      const result = await updateModerationReport({
        reportId,
        moderatorUserId: req.user!.id,
        status: status as "reviewing" | "actioned" | "dismissed",
        note,
      });
      if (result.outcome === "not_found") {
        res.status(404).json({ error: "Not found", code: "not_found" });
        return;
      }
      if (result.outcome === "invalid_transition") {
        res.status(409).json({
          error: "That report has already reached a later moderation state",
          code: "moderation_conflict",
        });
        return;
      }
      res.json({ report: result.report });
    } catch (err) {
      req.log.error(
        {
          errorType: err instanceof Error ? err.name : "UnknownError",
          reportId,
        },
        "Moderation update failed",
      );
      res
        .status(500)
        .json({ error: "Could not update report", code: "update_failed" });
    }
  },
);

export default router;
