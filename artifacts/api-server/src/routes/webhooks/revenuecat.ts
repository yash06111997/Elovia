import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { db, subscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Map a RevenueCat product identifier to our internal tier label.
 * Kept permissive: unknown products still grant access, they just aren't
 * labelled, because refusing entitlement to a real payer is far worse than
 * showing a blank tier name.
 */
function tierForProduct(productId: string | null | undefined): string | null {
  if (!productId) return null;
  const id = productId.toLowerCase();
  if (id.includes("lifetime")) return "lifetime";
  if (id.includes("year") || id.includes("annual")) return "yearly";
  if (id.includes("month")) return "monthly";
  return null;
}

/** RevenueCat event types that mean "this user currently has access". */
const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "PRODUCT_CHANGE",
  "TRANSFER",
]);

/** Events that revoke access immediately. */
const REVOKING_EVENTS = new Set(["EXPIRATION", "REFUND"]);

function statusForEvent(type: string, isTrial: boolean): string {
  if (type === "CANCELLATION") return "cancelled";
  if (type === "EXPIRATION") return "expired";
  if (type === "REFUND") return "expired";
  if (type === "BILLING_ISSUE") return "billing_issue";
  return isTrial ? "in_trial" : "active";
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * RevenueCat server-to-server webhook.
 *
 * This is the ONLY writer to the subscriptions table. The mobile app reports
 * what RevenueCat tells it, but that report is advisory — a modified client can
 * claim anything. Entitlement decisions read exclusively from what lands here.
 *
 * Auth: RevenueCat sends the value configured in its dashboard as the
 * Authorization header. Compared in constant time to avoid leaking the secret
 * through response timing.
 */
router.post("/webhooks/revenuecat", async (req: Request, res: Response) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;

  if (!expected) {
    req.log.error("REVENUECAT_WEBHOOK_SECRET is not set; rejecting webhook");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const provided = req.headers["authorization"];
  if (typeof provided !== "string" || !constantTimeEquals(provided, expected)) {
    req.log.warn("Rejected RevenueCat webhook with bad signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.body?.event;
  if (!event?.type) {
    res.status(400).json({ error: "Malformed event" });
    return;
  }

  // app_user_id is set via Purchases.logIn(firebaseUid), so it IS our user id.
  const userId: string | undefined = event.app_user_id || event.original_app_user_id;
  if (!userId) {
    req.log.warn({ type: event.type }, "RevenueCat event without app_user_id");
    res.status(202).json({ received: true, applied: false });
    return;
  }

  try {
    // A webhook can legitimately arrive before the user has ever hit our API
    // (purchase completes faster than first authenticated request). Without
    // this the FK below fails and RevenueCat retries forever.
    await db
      .insert(usersTable)
      .values({ id: userId })
      .onConflictDoNothing({ target: usersTable.id });

    const type: string = event.type;
    const isTrial = event.period_type === "TRIAL";
    const expiresAtMs: number | null = event.expiration_at_ms ?? null;
    const expiresAt = expiresAtMs ? new Date(expiresAtMs) : null;

    const granting = GRANTING_EVENTS.has(type);
    const revoking = REVOKING_EVENTS.has(type);

    // CANCELLATION means "will not renew", NOT "access ends now" — the user
    // keeps access until the period ends. Treating it as immediate revocation
    // is a common and very visible billing bug.
    const stillWithinPeriod = !expiresAt || expiresAt.getTime() > Date.now();
    const entitlementActive = revoking ? false : granting || stillWithinPeriod;

    const productId: string | null = event.product_id ?? null;

    await db
      .insert(subscriptionsTable)
      .values({
        userId,
        revenuecatUserId: event.original_app_user_id ?? userId,
        entitlementActive,
        entitlementId: Array.isArray(event.entitlement_ids)
          ? event.entitlement_ids[0] ?? null
          : event.entitlement_id ?? null,
        status: statusForEvent(type, isTrial),
        tier: tierForProduct(productId),
        productId,
        store: event.store ?? null,
        trialEndsAt: isTrial ? expiresAt : null,
        currentPeriodEndsAt: expiresAt,
        lastEvent: event,
        lastEventAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptionsTable.userId,
        set: {
          revenuecatUserId: event.original_app_user_id ?? userId,
          entitlementActive,
          status: statusForEvent(type, isTrial),
          tier: tierForProduct(productId),
          productId,
          store: event.store ?? null,
          ...(isTrial ? { trialEndsAt: expiresAt } : {}),
          currentPeriodEndsAt: expiresAt,
          lastEvent: event,
          lastEventAt: new Date(),
          updatedAt: new Date(),
        },
      });

    req.log.info({ type, userId, entitlementActive }, "Applied RevenueCat event");
    res.json({ received: true, applied: true });
  } catch (err) {
    req.log.error({ err, type: event.type }, "Failed to apply RevenueCat event");
    // 500 so RevenueCat retries rather than dropping a real billing event.
    res.status(500).json({ error: "Failed to process event" });
  }
});

export default router;
