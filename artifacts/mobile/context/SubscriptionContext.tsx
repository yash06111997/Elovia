import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { type PlanType, type PremiumFeatureKey, type SubscriptionPlatform, type SubscriptionStatus } from "@/constants/subscription";
import { useAuth } from "@/lib/auth";
import { useRevenueCat } from "@/lib/revenuecat";
import { onDataRestored } from "@/lib/syncEvents";
import { fetchEntitlement, type EntitlementStatus } from "@/utils/api";

interface SubscriptionContextValue {
  isPremium: boolean;
  isTrialActive: boolean;
  isFree: boolean;
  daysRemaining: number;
  trialEndDate: string | null;
  canAccess: (feature: PremiumFeatureKey) => boolean;
  startTrial: () => Promise<void>;
  refreshEntitlement: () => Promise<EntitlementStatus | null>;
  upgradePlan: (platform: SubscriptionPlatform, period: "monthly" | "yearly") => void;
  restorePurchases: () => Promise<void>;
  cancelSubscription: () => void;
  isLoaded: boolean;
  state: {
    status: SubscriptionStatus;
    planType: PlanType;
    trialEndsAt: string | null;
    subscriptionPlatform: SubscriptionPlatform;
    premiumAccessUntil: string | null;
    renewalDate: string | null;
    purchaseToken: string | null;
  };
}

const defaultState: SubscriptionContextValue["state"] = {
  status: "free",
  planType: "free",
  trialEndsAt: null,
  subscriptionPlatform: "none",
  premiumAccessUntil: null,
  renewalDate: null,
  purchaseToken: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue>({
  isPremium: false,
  isTrialActive: false,
  isFree: true,
  daysRemaining: 0,
  trialEndDate: null,
  canAccess: () => false,
  startTrial: async () => {},
  refreshEntitlement: async () => null,
  upgradePlan: () => {},
  restorePurchases: async () => {},
  cancelSubscription: () => {},
  isLoaded: false,
  state: defaultState,
});

function calculateDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function normalizeStatus(entitlement: EntitlementStatus): SubscriptionStatus {
  if (entitlement.hasProAccess && entitlement.tier !== "trial") return "active";
  if (entitlement.tier === "trial") return "in_trial";
  if (entitlement.status === "cancelled") return "cancelled";
  if (entitlement.status === "expired") return "expired";
  return "free";
}

function toState(entitlement: EntitlementStatus): SubscriptionContextValue["state"] {
  const planType: PlanType = entitlement.tier === "trial" ? "trial" : entitlement.tier === "premium" || entitlement.tier === "coaching" ? "premium" : "free";

  return {
    status: normalizeStatus(entitlement),
    planType,
    trialEndsAt: entitlement.trialEndsAt,
    subscriptionPlatform: "none",
    premiumAccessUntil: entitlement.currentPeriodEndsAt,
    renewalDate: entitlement.currentPeriodEndsAt,
    purchaseToken: null,
  };
}

/**
 * Access is intentionally fail-closed and comes only from the authenticated
 * API. RevenueCat on the device initiates purchases, but it never grants
 * features by itself; the webhook-backed server entitlement is authoritative.
 */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const rc = useRevenueCat();
  const [entitlement, setEntitlement] = useState<EntitlementStatus | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshEntitlement = useCallback(async () => {
    if (!isAuthenticated) {
      setEntitlement(null);
      setIsLoaded(!isAuthLoading);
      return null;
    }

    try {
      const next = await fetchEntitlement();
      setEntitlement(next);
      return next;
    } catch (error) {
      console.warn("Unable to refresh subscription entitlement", error);
      setEntitlement(null);
      return null;
    } finally {
      setIsLoaded(true);
    }
  }, [isAuthenticated, isAuthLoading]);

  useEffect(() => {
    setIsLoaded(false);
    void refreshEntitlement();
  }, [refreshEntitlement, user?.id]);

  useEffect(() => onDataRestored(() => void refreshEntitlement()), [refreshEntitlement]);

  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") void refreshEntitlement();
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [refreshEntitlement]);

  const isPremium = entitlement?.hasProAccess === true;
  const isTrialActive = entitlement?.tier === "trial" && entitlement.hasProAccess;
  const isFree = !isPremium;
  const daysRemaining = isTrialActive ? calculateDaysRemaining(entitlement?.trialEndsAt ?? null) : 0;
  const trialEndDate = entitlement?.trialEndsAt
    ? new Date(entitlement.trialEndsAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const canAccess = useCallback((_feature: PremiumFeatureKey) => entitlement?.hasProAccess === true, [entitlement?.hasProAccess]);

  const startTrial = useCallback(async () => {
    // The server derives a single trial window from the account creation date.
    // This refresh acknowledges that trial; it never creates mutable local access.
    await refreshEntitlement();
  }, [refreshEntitlement]);

  const restorePurchases = useCallback(async () => {
    await rc.restore();
    await refreshEntitlement();
  }, [rc, refreshEntitlement]);

  const upgradePlan = useCallback((_platform: SubscriptionPlatform, _period: "monthly" | "yearly") => {}, []);

  const cancelSubscription = useCallback(() => {}, []);
  const state = entitlement ? toState(entitlement) : defaultState;

  return (
    <SubscriptionContext.Provider
      value={{
        isPremium,
        isTrialActive,
        isFree,
        daysRemaining,
        trialEndDate,
        canAccess,
        startTrial,
        refreshEntitlement,
        upgradePlan,
        restorePurchases,
        cancelSubscription,
        isLoaded: isLoaded && !isAuthLoading,
        state,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
