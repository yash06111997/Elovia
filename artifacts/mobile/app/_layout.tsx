import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import * as Font from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AutoSync } from "@/components/AutoSync";
import { AuthProvider } from "@/lib/auth";
import { initializeRevenueCat, RevenueCatProvider } from "@/lib/revenuecat";
import { AppProvider } from "@/context/AppContext";
import { WorkoutProvider } from "@/context/WorkoutContext";
import { NutritionProvider } from "@/context/NutritionContext";
import { HealthProvider } from "@/context/HealthContext";
import { SubscriptionProvider } from "@/context/SubscriptionContext";
import { WellnessProvider } from "@/context/WellnessContext";
import { configureNotificationHandler } from "@/lib/notifications";
import { migrateStorageNamespace } from "@/lib/storageMigration";
import { reportClientError } from "@/lib/telemetry";
// Side-effect import: registers the background geofence task.
import "@/lib/geofenceTask";

SplashScreen.preventAutoHideAsync();

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("RevenueCat init error:", err?.message ?? "Unknown error");
}

// Must run before the first notification is delivered, so it lives at module
// scope rather than in an effect.
configureNotificationHandler();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding/index" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <Stack.Screen
        name="plan-preview"
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
          gestureEnabled: false,
        }}
      />
      <Stack.Screen name="paywall" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <Stack.Screen name="privacy-data" options={{ headerShown: true, title: "Privacy & Data" }} />
      <Stack.Screen name="log-workout" options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <Stack.Screen name="plans" options={{ headerShown: true, title: "Training Programmes" }} />
      <Stack.Screen name="hydration" options={{ headerShown: true, title: "Hydration" }} />
      <Stack.Screen name="supplements" options={{ headerShown: true, title: "Supplements" }} />
      <Stack.Screen name="coach" options={{ headerShown: true, title: "Coach" }} />
      <Stack.Screen name="run" options={{ headerShown: true, title: "Record Activity" }} />
      <Stack.Screen name="places" options={{ headerShown: true, title: "My Places" }} />
      <Stack.Screen name="achievements" options={{ headerShown: true, title: "Achievements" }} />
      <Stack.Screen name="scan" options={{ headerShown: true, title: "Scan barcode" }} />
      <Stack.Screen name="social" options={{ headerShown: true, title: "Community" }} />
      <Stack.Screen name="coaching" options={{ headerShown: true, title: "Coaching" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [iconFontsLoaded, setIconFontsLoaded] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    migrateStorageNamespace(AsyncStorage)
      .catch((error) => console.warn("Storage namespace migration failed", error))
      .finally(() => setStorageReady(true));
  }, []);

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
    if ((fontsLoaded || fontError) && iconFontsLoaded && storageReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, iconFontsLoaded, storageReady]);

  if ((!fontsLoaded && !fontError) || !iconFontsLoaded || !storageReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={reportClientError}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppProvider>
              <RevenueCatProvider>
                <SubscriptionProvider>
                  <WorkoutProvider>
                    <NutritionProvider>
                      <HealthProvider>
                        <WellnessProvider>
                          <AutoSync />
                          <GestureHandlerRootView>
                            <KeyboardProvider>
                              <RootLayoutNav />
                            </KeyboardProvider>
                          </GestureHandlerRootView>
                        </WellnessProvider>
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
