import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import * as Font from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
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
  console.warn("RevenueCat init error:", err?.message ?? "Unknown error");
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding/index" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: "fullScreenModal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [iconFontsLoaded, setIconFontsLoaded] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    async function loadIconFonts() {
      try {
        if (Platform.OS !== "web") {
          await Font.loadAsync({
            Ionicons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf"),
            Feather: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"),
            MaterialCommunityIcons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf"),
          });
        }
      } catch (e) {
        console.log("Icon font loading error (non-fatal):", e);
      }
      setIconFontsLoaded(true);
    }
    loadIconFonts();
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && iconFontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, iconFontsLoaded]);

  if ((!fontsLoaded && !fontError) || !iconFontsLoaded) return null;

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
