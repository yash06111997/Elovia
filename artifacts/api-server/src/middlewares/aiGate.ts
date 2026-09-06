import { type Request, type Response, type NextFunction } from "express";
import { resolveEntitlement, type Entitlement } from "../lib/entitlements";
import {
  claimQuota,
  releaseQuota,
  type AiRoute,
  type QuotaDecision,
} from "../lib/aiQuota";

declare global {
  namespace Express {
    interface Request {
      /** Populated by gateAiRoute for downstream handlers. */
      entitlement?: Entitlement;
      quota?: QuotaDecision;
      aiRoute?: AiRoute;
    }
  }
}

/**
 * The gate every AI route must sit behind.
 *
 * Three checks, in increasing order of cost:
 *   1. Authenticated?      — cheap, no I/O beyond the token already verified upstream.
 *   2. Entitled?           — one indexed read.
 *   3. Within quota?       — one upsert; claims the slot atomically.
 *
 * Returns 401 / 402 / 429 respectively. 402 (Payment Required) is used
 * deliberately rather than 403 so the client can distinguish "you need to
 * subscribe" (show the paywall) from "you're rate limited" (show a retry time).
 */
export function gateAiRoute(route: AiRoute) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({
        error: "Authentication required",
        code: "unauthenticated",
      });
      return;
    }

    const userId = req.user.id;

    let entitlement: Entitlement;
    try {
      entitlement = await resolveEntitlement(userId);
    } catch (err) {
      req.log.error({ err }, "Failed to resolve entitlement");
      res.status(503).json({
        error: "Could not verify subscription status",
        code: "entitlement_unavailable",
      });
      return;
    }

    if (!entitlement.hasProAccess) {
      res.status(402).json({
        error: "This feature requires Elovia Pro",
        code: "payment_required",
        tier: entitlement.tier,
        status: entitlement.status,
        trialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
      });
      return;
    }

    let decision: QuotaDecision;
    try {
      decision = await claimQuota(userId, entitlement.tier, route);
    } catch (err) {
      req.log.error({ err }, "Quota check failed");
      res.status(503).json({
        error: "Could not verify usage quota",
        code: "quota_unavailable",
      });
      return;
    }

    if (!decision.allowed) {
      res.status(429).json({
        error:
          decision.reason === "cost_ceiling_reached"
            ? "You have reached today's AI usage limit"
            : `Daily limit reached for this feature (${decision.limit}/day)`,
        code: decision.reason,
        limit: decision.limit,
        used: decision.used,
        resetsAt: decision.resetsAt,
      });
      return;
    }

    req.entitlement = entitlement;
    req.quota = decision;
    req.aiRoute = route;

    // Validation/cache hits refund the unused claim, even for successful HTTP
    // responses. Provider failures stay counted. Closing is durable/idempotent.
    let settled = false;
    const closeClaim = () => {
      if (settled) return;
      settled = true;
      if (decision.claim) {
        void releaseQuota(decision.claim).catch(() => {
          req.log.error({ route }, "Could not close AI quota claim");
        });
      }
    };
    res.once("finish", closeClaim);
    res.once("close", closeClaim);
    if (res.destroyed) {
      closeClaim();
      return;
    }

    // Surface remaining budget so the client can render it without a second call.
    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", decision.resetsAt);

    next();
  };
}

/** Guard for non-AI routes that still require a signed-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res
      .status(401)
      .json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  next();
}
