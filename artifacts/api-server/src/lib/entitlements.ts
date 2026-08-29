import { db, subscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Length of the free trial, in days. Must match the client's TRIAL_DURATION_DAYS. */
export const TRIAL_DURATION_DAYS = 15;

export type AccessTier = "free" | "trial" | "premium";

export interface Entitlement {
  tier: AccessTier;
  /** True for trial and premium — i.e. may call gated AI routes. */
  hasProAccess: boolean;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  productId: string | null;
}

/**
 * Resolve what a user is actually entitled to, server-side.
 *
 * Deliberately does NOT trust anything the client sends. There are two sources:
 *
 *   1. `subscriptions` — written only by the RevenueCat webhook. Authoritative
 *      for anyone who has ever transacted.
 *   2. `users.createdAt` — for everyone else, the trial window is DERIVED from
 *      account age. This matters: the client previously stored trial start in
 *      AsyncStorage, which a user can reset by reinstalling the app to farm
 *      unlimited trials. Deriving it from the account row makes the trial
 *      genuinely once-per-account.
 */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const now = new Date();

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId));

  if (sub?.entitlementActive) {
    // RevenueCat says the entitlement is live. Trust it, but still honour an
    // expiry that has since passed (webhooks can be delayed or dropped).
    const notExpired =
      !sub.currentPeriodEndsAt || sub.currentPeriodEndsAt.getTime() > now.getTime();

    if (notExpired) {
      return {
        tier: "premium",
        hasProAccess: true,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt ?? null,
        currentPeriodEndsAt: sub.currentPeriodEndsAt ?? null,
        productId: sub.productId ?? null,
      };
    }
  }

  // RevenueCat-reported trial (store-side introductory offer).
  if (sub?.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime()) {
    return {
      tier: "trial",
      hasProAccess: true,
      status: sub.status || "in_trial",
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEndsAt: sub.currentPeriodEndsAt ?? null,
      productId: sub.productId ?? null,
    };
  }

  // No subscription row, or an expired one: fall back to the app's own trial,
  // derived from account creation so it cannot be reset by reinstalling.
  const [user] = await db
    .select({ createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (user?.createdAt) {
    const trialEnds = new Date(
      user.createdAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );
    if (trialEnds.getTime() > now.getTime()) {
      return {
        tier: "trial",
        hasProAccess: true,
        status: "in_trial",
        trialEndsAt: trialEnds,
        currentPeriodEndsAt: null,
        productId: null,
      };
    }
    return {
      tier: "free",
      hasProAccess: false,
      status: sub?.status === "cancelled" ? "cancelled" : "expired",
      trialEndsAt: trialEnds,
      currentPeriodEndsAt: null,
      productId: null,
    };
  }

  return {
    tier: "free",
    hasProAccess: false,
    status: "free",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    productId: null,
  };
}
