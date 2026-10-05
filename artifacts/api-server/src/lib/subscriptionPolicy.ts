export const TRIAL_DURATION_DAYS = 14;
export const COACHING_ENTITLEMENT = "Elovia Coaching";
export type AccessTier = "free" | "trial" | "premium" | "coaching";
export interface Entitlement {
  tier: AccessTier; hasProAccess: boolean; hasCoaching: boolean; status: string;
  trialEndsAt: Date | null; currentPeriodEndsAt: Date | null; productId: string | null;
}
interface StoredSubscription {
  entitlementActive: boolean; entitlementId: string | null; status: string;
  trialEndsAt: Date | null; currentPeriodEndsAt: Date | null; productId: string | null;
  lastEvent?: unknown;
}
export function resolveStoredSubscription(sub?: StoredSubscription | null, now = new Date()): Entitlement {
  const free: Entitlement = { tier: "free", hasProAccess: false, hasCoaching: false, status: sub?.status === "cancelled" ? "cancelled" : sub ? "expired" : "free", trialEndsAt: sub?.trialEndsAt ?? null, currentPeriodEndsAt: sub?.currentPeriodEndsAt ?? null, productId: sub?.productId ?? null };
  if (!sub?.entitlementActive || (sub.currentPeriodEndsAt && sub.currentPeriodEndsAt.getTime() <= now.getTime())) return free;
  if (!["Elovia Pro", "elovia_pro", COACHING_ENTITLEMENT].includes(sub.entitlementId ?? "")) return free;
  const event = sub.lastEvent && typeof sub.lastEvent === "object" ? sub.lastEvent as Record<string, unknown> : {};
  const isTrial = event.period_type === "TRIAL" || sub.status === "in_trial" || (sub.status === "cancelled" && !!sub.trialEndsAt);
  const coaching = sub.entitlementId === COACHING_ENTITLEMENT;
  if (isTrial) {
    const yearly = sub.productId?.split(":")[0] === "elovia_pro_yearly";
    if (!yearly || !sub.trialEndsAt || sub.trialEndsAt.getTime() <= now.getTime()) return free;
    return { ...free, tier: "trial", status: sub.status, hasProAccess: true, hasCoaching: false };
  }
  return { ...free, tier: coaching ? "coaching" : "premium", status: sub.status, hasProAccess: true, hasCoaching: coaching, trialEndsAt: null };
}
