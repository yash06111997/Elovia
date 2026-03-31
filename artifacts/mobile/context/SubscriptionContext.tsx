import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import {
  TRIAL_DURATION_DAYS,
  type PlanType,
  type SubscriptionStatus,
  type SubscriptionPlatform,
  type PremiumFeatureKey,
} from "@/constants/subscription";

const SUB_STORAGE_KEY = "@fitai_subscription";

interface SubscriptionState {
  status: SubscriptionStatus;
  planType: PlanType;
  trialUsed: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscriptionPlatform: SubscriptionPlatform;
  premiumAccessUntil: string | null;
  renewalDate: string | null;
  purchaseToken: string | null;
}

interface SubscriptionContextValue {
  state: SubscriptionState;
  isPremium: boolean;
  isTrialActive: boolean;
  isFree: boolean;
  daysRemaining: number;
  trialEndDate: string | null;
  canAccess: (feature: PremiumFeatureKey) => boolean;
  startTrial: () => void;
  upgradePlan: (platform: SubscriptionPlatform, period: "monthly" | "yearly") => void;
  restorePurchases: () => Promise<void>;
  cancelSubscription: () => void;
  isLoaded: boolean;
}

const defaultState: SubscriptionState = {
  status: "free",
  planType: "free",
  trialUsed: false,
  trialStartedAt: null,
  trialEndsAt: null,
  subscriptionPlatform: "none",
  premiumAccessUntil: null,
  renewalDate: null,
  purchaseToken: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue>({
  state: defaultState,
  isPremium: false,
  isTrialActive: false,
  isFree: true,
  daysRemaining: 0,
  trialEndDate: null,
  canAccess: () => false,
  startTrial: () => {},
  upgradePlan: () => {},
  restorePurchases: async () => {},
  cancelSubscription: () => {},
  isLoaded: false,
});

function calculateDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function checkAndUpdateStatus(current: SubscriptionState): SubscriptionState {
  const now = Date.now();

  if (current.status === "in_trial" && current.trialEndsAt) {
    const endTime = new Date(current.trialEndsAt).getTime();
    if (now >= endTime) {
      return {
        ...current,
        status: "free",
        planType: "free",
        premiumAccessUntil: null,
      };
    }
  }

  if (current.status === "active" && current.premiumAccessUntil) {
    const endTime = new Date(current.premiumAccessUntil).getTime();
    if (now >= endTime) {
      return {
        ...current,
        status: "expired",
        planType: "free",
      };
    }
  }

  return current;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SubscriptionState>(defaultState);
  const [isLoaded, setIsLoaded] = useState(false);

  const reconcile = useCallback((current: SubscriptionState) => {
    const updated = checkAndUpdateStatus(current);
    setState(updated);
    if (updated !== current) {
      AsyncStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(updated));
    }
    return updated;
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SUB_STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as SubscriptionState;
            reconcile(parsed);
          } catch {
            setState(defaultState);
          }
        }
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, [reconcile]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        setState((current) => {
          const updated = checkAndUpdateStatus(current);
          if (updated !== current) {
            AsyncStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(updated));
          }
          return updated;
        });
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (state.status !== "in_trial" && state.status !== "active") return;
    const interval = setInterval(() => {
      setState((current) => {
        const updated = checkAndUpdateStatus(current);
        if (updated !== current) {
          AsyncStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(updated));
        }
        return updated;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [state.status]);

  const persist = useCallback((newState: SubscriptionState) => {
    setState(newState);
    AsyncStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(newState));
  }, []);

  const isPremium = state.planType === "premium" || state.planType === "trial";
  const isTrialActive = state.status === "in_trial" && calculateDaysRemaining(state.trialEndsAt) > 0;
  const isFree = !isPremium;
  const daysRemaining = calculateDaysRemaining(state.trialEndsAt);

  const trialEndDate = state.trialEndsAt
    ? new Date(state.trialEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  const canAccess = useCallback(
    (_feature: PremiumFeatureKey) => {
      return isPremium;
    },
    [isPremium],
  );

  const startTrial = useCallback(() => {
    if (state.trialUsed) return;
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + TRIAL_DURATION_DAYS);

    const newState: SubscriptionState = {
      ...state,
      status: "in_trial",
      planType: "trial",
      trialUsed: true,
      trialStartedAt: now.toISOString(),
      trialEndsAt: end.toISOString(),
      premiumAccessUntil: end.toISOString(),
    };
    persist(newState);
  }, [state, persist]);

  const upgradePlan = useCallback(
    (platform: SubscriptionPlatform, period: "monthly" | "yearly") => {
      const now = new Date();
      const renewDate = new Date(now);
      if (period === "monthly") {
        renewDate.setMonth(renewDate.getMonth() + 1);
      } else {
        renewDate.setFullYear(renewDate.getFullYear() + 1);
      }

      const newState: SubscriptionState = {
        ...state,
        status: "active",
        planType: "premium",
        subscriptionPlatform: platform,
        premiumAccessUntil: renewDate.toISOString(),
        renewalDate: renewDate.toISOString(),
        purchaseToken: `demo_${platform}_${period}_${Date.now()}`,
      };
      persist(newState);
    },
    [state, persist],
  );

  const restorePurchases = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 1500));
  }, []);

  const cancelSubscription = useCallback(() => {
    const newState: SubscriptionState = {
      ...state,
      status: "cancelled",
    };
    persist(newState);
  }, [state, persist]);

  return (
    <SubscriptionContext.Provider
      value={{
        state,
        isPremium,
        isTrialActive,
        isFree,
        daysRemaining,
        trialEndDate,
        canAccess,
        startTrial,
        upgradePlan,
        restorePurchases,
        cancelSubscription,
        isLoaded,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext);
}
