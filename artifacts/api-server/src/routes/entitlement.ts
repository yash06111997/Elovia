import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/aiGate";
import { resolveEntitlement } from "../lib/entitlements";
import { dailyLimitFor, currentDay, type AiRoute } from "../lib/aiQuota";
import { db, aiUsageTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router: IRouter = Router();

const TRACKED_ROUTES: AiRoute[] = [
  "recognize-food",
  "generate-workout",
  "generate-meal-plan",
  "generate-recipe",
  "coach-chat",
  "analyse-supplement",
];

/**
 * What this user is entitled to and how much of today's allowance is left.
 *
 * The client renders limits from this instead of guessing, so the numbers shown
 * in the UI always match the numbers the gate actually enforces.
 */
router.get("/entitlement", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const entitlement = await resolveEntitlement(userId);

    const rows = await db
      .select({
        route: aiUsageTable.route,
        requestCount: aiUsageTable.requestCount,
      })
      .from(aiUsageTable)
      .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, currentDay())));

    const usedByRoute = new Map(rows.map((r) => [r.route, r.requestCount]));

    const quotas: Record<string, { limit: number; used: number; remaining: number }> = {};
    for (const route of TRACKED_ROUTES) {
      const limit = dailyLimitFor(entitlement.tier, route);
      const used = usedByRoute.get(route) ?? 0;
      quotas[route] = { limit, used, remaining: Math.max(0, limit - used) };
    }

    res.json({
      tier: entitlement.tier,
      hasProAccess: entitlement.hasProAccess,
      status: entitlement.status,
      trialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
      currentPeriodEndsAt: entitlement.currentPeriodEndsAt?.toISOString() ?? null,
      quotas,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to resolve entitlement");
    res.status(500).json({ error: "Failed to resolve entitlement" });
  }
});

export default router;
