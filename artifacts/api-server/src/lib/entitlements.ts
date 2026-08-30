import { db, subscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Length of the free trial, in days. Must match the client's TRIAL_DURATION_DAYS. */
export const TRIAL_DURATION_DAYS = 15;

/**
 * Access tiers, lowest to highest.
 *
 * "coaching" sits above "premium" and includes everything in it. It is granted
 * by a SEPARATE RevenueCat entitlement, because one-to-one coaching is a
 * service with a hard capacity ceiling - a coach can carry roughly 30 clients -
 * priced roughly 30x the software tier. Conflating the two would make it
 * impossible to tell a $4.99 subscriber from a $149 one.
 */
export type AccessTier = "free" | "trial" | "premium" | "coaching";

/** The RevenueCat entitlement that grants one-to-one coaching. */
export const COACHING_ENTITLEMENT = "Elovia Coaching";

export interface Entitlement {
  tier: AccessTier;
  /** True for trial, premium and coaching — i.e. may call gated AI routes. */
  hasProAccess: boolean;
  /** True only for an active one-to-one coaching subscription. */
  hasCoaching: boolean;
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
      // The coaching entitlement is checked by name: a coaching subscriber
      // holds both entitlements, and the higher one wins.
      const isCoaching = sub.entitlementId === COACHING_ENTITLEMENT;

      return {
        tier: isCoaching ? "coaching" : "premium",
        hasProAccess: true,
        hasCoaching: isCoaching,
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
      hasCoaching: false,
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
        hasCoaching: false,
        status: "in_trial",
        trialEndsAt: trialEnds,
        currentPeriodEndsAt: null,
        productId: null,
      };
    }
    return {
      tier: "free",
      hasProAccess: false,
      hasCoaching: false,
      status: sub?.status === "cancelled" ? "cancelled" : "expired",
      trialEndsAt: trialEnds,
      currentPeriodEndsAt: null,
      productId: null,
    };
  }

  return {
    tier: "free",
    hasProAccess: false,
    hasCoaching: false,
    status: "free",
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    productId: null,
  };
}
