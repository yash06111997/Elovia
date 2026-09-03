import React, { createContext, useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useAuth } from "./auth";

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
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    async function syncIdentity() {
      try {
        if (isAuthenticated && user?.id && user.id !== lastUserId.current) {
          await Purchases.logIn(user.id);
          lastUserId.current = user.id;
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
        } else if (!isAuthenticated && lastUserId.current) {
          await Purchases.logOut();
          lastUserId.current = null;
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
        }
      } catch (e) {
        console.log("RevenueCat identity sync error:", e);
      }
    }
    syncIdentity();
  }, [isAuthenticated, user?.id, queryClient]);

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: async () => {
      const info = await Purchases.getCustomerInfo();
      return info;
    },
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
    mutationFn: async (packageToPurchase: any) => {
      const { customerInfo } =
        await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["revenuecat", "customer-info"],
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      return Purchases.restorePurchases();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["revenuecat", "customer-info"],
      });
    },
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[
      REVENUECAT_ENTITLEMENT_IDENTIFIER
    ] !== undefined;

  return {
    customerInfo: customerInfoQuery.data,
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
