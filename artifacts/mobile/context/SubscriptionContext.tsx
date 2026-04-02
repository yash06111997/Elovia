import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { onDataRestored } from "@/lib/syncEvents";
import { useRevenueCat } from "@/lib/revenuecat";
import {
  TRIAL_DURATION_DAYS,
  type PlanType,
  type SubscriptionStatus,
  type SubscriptionPlatform,
  type PremiumFeatureKey,
} from "@/constants/subscription";

const SUB_STORAGE_KEY = "@fitai_subscription";

interface TrialState {
  trialUsed: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
}

const defaultTrialState: TrialState = {
  trialUsed: false,
  trialStartedAt: null,
  trialEndsAt: null,
};

interface SubscriptionContextValue {
  isPremium: boolean;
  isTrialActive: boolean;
  isFree: boolean;
  daysRemaining: number;
  trialEndDate: string | null;
  canAccess: (feature: PremiumFeatureKey) => boolean;
  startTrial: () => void;
  clearTrial: () => void;
  upgradePlan: (platform: SubscriptionPlatform, period: "monthly" | "yearly") => void;
  restorePurchases: () => Promise<void>;
  cancelSubscription: () => void;
  isLoaded: boolean;
  state: {
    status: SubscriptionStatus;
    planType: PlanType;
    trialUsed: boolean;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    subscriptionPlatform: SubscriptionPlatform;
    premiumAccessUntil: string | null;
    renewalDate: string | null;
    purchaseToken: string | null;
  };
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  isPremium: false,
  isTrialActive: false,
  isFree: true,
  daysRemaining: 0,
  trialEndDate: null,
  canAccess: () => false,
  startTrial: () => {},
  clearTrial: () => {},
  upgradePlan: () => {},
  restorePurchases: async () => {},
  cancelSubscription: () => {},
  isLoaded: false,
  state: {
    status: "free",
    planType: "free",
    trialUsed: false,
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionPlatform: "none",
    premiumAccessUntil: null,
    renewalDate: null,
    purchaseToken: null,
  },
});

function calculateDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const rc = useRevenueCat();
  const [trialState, setTrialState] = useState<TrialState>(defaultTrialState);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadTrialState = useCallback(() => {
    AsyncStorage.getItem(SUB_STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setTrialState({
              trialUsed: parsed.trialUsed ?? false,
              trialStartedAt: parsed.trialStartedAt ?? null,
              trialEndsAt: parsed.trialEndsAt ?? null,
            });
          } catch {
            setTrialState(defaultTrialState);
          }
        }
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  useEffect(() => {
    loadTrialState();
  }, [loadTrialState]);

  useEffect(() => {
    return onDataRestored(() => {
      loadTrialState();
    });
  }, [loadTrialState]);

  const persistTrialState = useCallback((newState: TrialState) => {
    setTrialState(newState);
    AsyncStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(newState));
  }, []);

  const isTrialExpired =
    trialState.trialEndsAt && new Date(trialState.trialEndsAt).getTime() <= Date.now();
  const isTrialActiveLocal =
    trialState.trialUsed &&
    !!trialState.trialEndsAt &&
    !isTrialExpired;

  const rcSubscribed = rc.isSubscribed;
  const isTrialActive = isTrialActiveLocal && !rcSubscribed;
  const isPremium = rcSubscribed || isTrialActiveLocal;
  const isFree = !isPremium;

  useEffect(() => {
    if (isLoaded) {
      console.log("[Subscription]", JSON.stringify({
        isPremium,
        rcSubscribed,
        isTrialActiveLocal,
        trialUsed: trialState.trialUsed,
        trialEndsAt: trialState.trialEndsAt,
        rcLoading: rc.isLoading,
      }));
    }
  }, [isLoaded, isPremium, rcSubscribed, isTrialActiveLocal, trialState, rc.isLoading]);
  const daysRemaining = isTrialActive ? calculateDaysRemaining(trialState.trialEndsAt) : 0;

  const trialEndDate = trialState.trialEndsAt
    ? new Date(trialState.trialEndsAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const canAccess = useCallback(
    (feature: PremiumFeatureKey) => {
      console.log(`[canAccess] feature=${feature} isPremium=${isPremium} rcSub=${rcSubscribed} trialActive=${isTrialActiveLocal} trialUsed=${trialState.trialUsed}`);
      return isPremium;
    },
    [isPremium, rcSubscribed, isTrialActiveLocal, trialState.trialUsed],
  );

  const startTrial = useCallback(() => {
    if (trialState.trialUsed) return;
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + TRIAL_DURATION_DAYS);

    persistTrialState({
      trialUsed: true,
      trialStartedAt: now.toISOString(),
      trialEndsAt: end.toISOString(),
    });
  }, [trialState.trialUsed, persistTrialState]);

  const clearTrial = useCallback(() => {
    persistTrialState(defaultTrialState);
  }, [persistTrialState]);

  const upgradePlan = useCallback(
    (_platform: SubscriptionPlatform, _period: "monthly" | "yearly") => {
    },
    [],
  );

  const restorePurchases = useCallback(async () => {
    try {
      await rc.restore();
    } catch (e) {
      console.log("Restore failed:", e);
    }
  }, [rc]);

  const cancelSubscription = useCallback(() => {
  }, []);

  let status: SubscriptionStatus = "free";
  if (rcSubscribed) {
    status = "active";
  } else if (isTrialActive) {
    status = "in_trial";
  } else if (trialState.trialUsed && isTrialExpired) {
    status = "expired";
  }

  const state = {
    status,
    planType: (rcSubscribed ? "premium" : isTrialActive ? "trial" : "free") as PlanType,
    trialUsed: trialState.trialUsed,
    trialStartedAt: trialState.trialStartedAt,
    trialEndsAt: trialState.trialEndsAt,
    subscriptionPlatform: "none" as SubscriptionPlatform,
    premiumAccessUntil: null,
    renewalDate: null,
    purchaseToken: null,
  };

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
        clearTrial,
        upgradePlan,
        restorePurchases,
        cancelSubscription,
        isLoaded: isLoaded && !rc.isLoading,
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
