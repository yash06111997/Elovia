import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import userDataRouter from "./userData";
import entitlementRouter from "./entitlement";
import diagnosticsRouter from "./diagnostics";
import pushRouter from "./push";
import supplementsRouter from "./supplements";
import revenuecatWebhookRouter from "./webhooks/revenuecat";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

// Webhooks authenticate with their own shared secret, so they bypass the
// per-identity limiter that would otherwise key every RevenueCat call to the
// same server IP and throttle legitimate billing events.
router.use(revenuecatWebhookRouter);

router.use(entitlementRouter);
router.use(diagnosticsRouter);
router.use(pushRouter);
router.use(supplementsRouter);

/**
 * A coarse ceiling in front of the AI routes.
 *
 * The per-user daily quota in aiGate is the real budget control; this is the
 * burst guard that stops a hot loop from opening 500 concurrent Claude calls
 * before the quota rows are even written.
 */
router.use(
  "/ai",
  rateLimit({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "ai",
    message: "Too many AI requests. Please wait a moment and try again.",
  }),
  aiRouter,
);

router.use(userDataRouter);

export default router;
