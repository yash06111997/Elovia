import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";
import { purchasePolicyError } from "./subscriptionOffers";
import { PRODUCT_IDS } from "@/constants/subscription";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useAuth } from "./auth";
import { createStoreIdentity } from "./storeIdentity";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "Elovia Pro";

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

function getRevenueCatApiKey(): string {
  if (Platform.OS === "web" || isExpoGo()) {
    if (REVENUECAT_TEST_API_KEY) return REVENUECAT_TEST_API_KEY;
    throw new Error(
      "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY is required for Expo Go / web. " +
        "See https://rev.cat/sdk-test-store",
    );
  }

  if (Platform.OS === "ios") {
    if (REVENUECAT_IOS_API_KEY) return REVENUECAT_IOS_API_KEY;
    throw new Error(
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is required for iOS production builds",
    );
  }

  if (Platform.OS === "android") {
    if (REVENUECAT_ANDROID_API_KEY) return REVENUECAT_ANDROID_API_KEY;
    throw new Error(
      "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY is required for Android production builds",
    );
  }

  throw new Error(
    "No RevenueCat API key available for platform: " + Platform.OS,
  );
}

export function initializeRevenueCat() {
  const apiKey = getRevenueCatApiKey();

  if (__DEV__) {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  } else {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
  }

  Purchases.configure({ apiKey });
  console.log("Configured RevenueCat");
}

function useRevenueCatContext() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const userId = isAuthenticated ? user?.id ?? null : null;
  const identity = useRef<ReturnType<typeof createStoreIdentity> | null>(null);
  if (!identity.current) identity.current = createStoreIdentity(Purchases);
  const storeIdentity = identity.current;
  storeIdentity.setDesired(userId);
  const [identityUserId, setIdentityUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void storeIdentity.sync().then(ready => {
      if (!active || !ready) return;
      setIdentityUserId(userId);
      void queryClient.invalidateQueries({ queryKey: ["revenuecat", "customer-info", userId] });
    }).catch(() => { if (active) setIdentityUserId(null); });
    return () => { active = false; };
  }, [userId, queryClient, storeIdentity]);
  const isIdentityReady = !!userId && identityUserId === userId;

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info", userId],
    enabled: isIdentityReady,
    queryFn: () => storeIdentity.run(userId, () => Purchases.getCustomerInfo()),
    staleTime: 60 * 1000,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: async () => {
      const offerings = await Purchases.getOfferings();
      return offerings;
    },
    staleTime: 300 * 1000,
  });

  const purchaseMutation = useMutation({
    mutationFn: (packageToPurchase: PurchasesPackage) => storeIdentity.run(userId, async () => {
      const error = purchasePolicyError(packageToPurchase, Platform.OS);
      if (error) throw new Error(error);
      const basePlan = Platform.OS === "android" && packageToPurchase.product.identifier.split(":")[0] === PRODUCT_IDS.monthly
        ? packageToPurchase.product.subscriptionOptions?.find(option => option.isBasePlan && !option.freePhase) : undefined;
      const { customerInfo } = basePlan ? await Purchases.purchaseSubscriptionOption(basePlan) : await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["revenuecat", "customer-info"],
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => storeIdentity.run(userId, () => Purchases.restorePurchases()),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["revenuecat", "customer-info"],
      });
    },
  });

  const isSubscribed = isIdentityReady &&
    customerInfoQuery.data?.entitlements.active?.[
      REVENUECAT_ENTITLEMENT_IDENTIFIER
    ] !== undefined;

  return {
    isIdentityReady,
    customerInfo: isIdentityReady ? customerInfoQuery.data : undefined,
    offerings: offeringsQuery.data,
    offeringsError: offeringsQuery.error,
    isSubscribed,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    isOfferingsLoading: offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
    refetchOfferings: offeringsQuery.refetch,
    refetchCustomerInfo: () =>
      queryClient.invalidateQueries({
        queryKey: ["revenuecat", "customer-info"],
      }),
  };
}

type RevenueCatContextValue = ReturnType<typeof useRevenueCatContext>;
const RevenueCatContext = createContext<RevenueCatContextValue | null>(null);

export function RevenueCatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useRevenueCatContext();
  return (
    <RevenueCatContext.Provider value={value}>
      {children}
    </RevenueCatContext.Provider>
  );
}

export function useRevenueCat() {
  const ctx = useContext(RevenueCatContext);
  if (!ctx) {
    throw new Error("useRevenueCat must be used within a RevenueCatProvider");
  }
  return ctx;
}
