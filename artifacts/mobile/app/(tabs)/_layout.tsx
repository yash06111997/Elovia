import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, router } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useApp } from "@/context/AppContext";
import { Colors } from "@/constants/colors";

function AppGuard({ children }: { children: React.ReactNode }) {
  const { state } = useApp();

  useEffect(() => {
    if (!state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [state.onboardingComplete]);

  if (!state.onboardingComplete) return null;
  return <>{children}</>;
}

function NativeTabLayout() {
  return (
    <AppGuard>
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <Icon sf={{ default: "house", selected: "house.fill" }} />
          <Label>Dashboard</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="workouts">
          <Icon sf={{ default: "dumbbell", selected: "dumbbell.fill" }} />
          <Label>Workouts</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="diet">
          <Icon sf={{ default: "fork.knife", selected: "fork.knife" }} />
          <Label>Diet</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="progress">
          <Icon sf={{ default: "chart.line.uptrend.xyaxis", selected: "chart.line.uptrend.xyaxis" }} />
          <Label>Progress</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <Icon sf={{ default: "person", selected: "person.fill" }} />
          <Label>Profile</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </AppGuard>
  );
}

function ClassicTabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <AppGuard>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: theme.textMuted,
          headerShown: false,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : isDark ? theme.tabBar : theme.tabBar,
            borderTopWidth: 1,
            borderTopColor: theme.tabBarBorder,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={100}
                tint={isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: theme.tabBar }]}
              />
            ),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Dashboard",
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name="house" tintColor={color} size={22} />
              ) : (
                <Ionicons name="home-outline" size={22} color={color} />
              ),
          }}
        />
        <Tabs.Screen
          name="workouts"
          options={{
            title: "Workouts",
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name="dumbbell" tintColor={color} size={22} />
              ) : (
                <Ionicons name="barbell-outline" size={22} color={color} />
              ),
          }}
        />
        <Tabs.Screen
          name="diet"
          options={{
            title: "Diet",
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name="fork.knife" tintColor={color} size={22} />
              ) : (
                <Ionicons name="restaurant-outline" size={22} color={color} />
              ),
          }}
        />
        <Tabs.Screen
          name="progress"
          options={{
            title: "Progress",
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name="chart.line.uptrend.xyaxis" tintColor={color} size={22} />
              ) : (
                <Ionicons name="trending-up-outline" size={22} color={color} />
              ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) =>
              isIOS ? (
                <SymbolView name="person" tintColor={color} size={22} />
              ) : (
                <Ionicons name="person-outline" size={22} color={color} />
              ),
          }}
        />
      </Tabs>
    </AppGuard>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
