import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Alert } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AutoSync } from "@/components/AutoSync";
import { AuthProvider } from "@/lib/auth";
import { initializeRevenueCat, RevenueCatProvider } from "@/lib/revenuecat";
import { AppProvider } from "@/context/AppContext";
import { WorkoutProvider } from "@/context/WorkoutContext";
import { NutritionProvider } from "@/context/NutritionContext";
import { HealthProvider } from "@/context/HealthContext";
import { SubscriptionProvider } from "@/context/SubscriptionContext";

SplashScreen.preventAutoHideAsync();

try {
  initializeRevenueCat();
} catch (err: any) {
  Alert.alert("RevenueCat Unavailable", err?.message ?? "Unknown error");
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding/index" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppProvider>
              <RevenueCatProvider>
                <SubscriptionProvider>
                  <WorkoutProvider>
                    <NutritionProvider>
                      <HealthProvider>
                        <AutoSync />
                        <GestureHandlerRootView>
                          <KeyboardProvider>
                            <RootLayoutNav />
                          </KeyboardProvider>
                        </GestureHandlerRootView>
                      </HealthProvider>
                    </NutritionProvider>
                  </WorkoutProvider>
                </SubscriptionProvider>
              </RevenueCatProvider>
            </AppProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
