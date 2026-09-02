import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/Pressable";
import { NavRow, SectionCard, StatItem } from "@/components/ui";
import { Colors } from "@/constants/colors";
import { MIN_TOUCH, Radius, Space, Type } from "@/constants/design";
import { MORE_CAPABILITY_GROUPS, type MoreCapability } from "@/constants/navigation";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useWellness } from "@/context/WellnessContext";
import { useWorkout } from "@/context/WorkoutContext";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/hooks/useTheme";

const goalLabels: Record<string, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  strength: "Strength",
  endurance: "Endurance",
  maintenance: "Maintenance",
  general_fitness: "General fitness",
};

const capabilityToneColors: Record<MoreCapability["tone"], string> = {
  primary: Colors.primary,
  green: Colors.accentGreen,
  orange: Colors.accent,
  yellow: Colors.accentYellow,
  violet: Colors.accentAi,
};

export default function MoreScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useApp();
  const { sessions, personalRecords } = useWorkout();
  const { currentStreak } = useWellness();
  const { isPremium, isTrialActive, daysRemaining } = useSubscription();
  const { user, isAuthenticated } = useAuth();
  const profile = state.profile;

  const topPadding = Platform.OS === "web" ? 67 : insets.top + Space.md;
  const completedWorkouts = sessions.filter((session) => session.completed).length;
  const planLabel = isTrialActive
    ? `Premium trial · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`
    : isPremium
      ? "Premium active"
      : "Free plan";

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? Space.xxxl : insets.bottom + 80 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>More</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Tools, coaching, health connections and account controls.</Text>
      </View>

      <PressableScale
        style={[styles.profileCard, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => router.push("/profile-details")}
        haptic
        accessibilityRole="button"
        accessibilityLabel={`Profile and settings for ${profile?.name ?? "Athlete"}`}
        accessibilityHint="Open body, fitness, nutrition, health sync and account settings"
      >
        <View style={[styles.avatar, { backgroundColor: Colors.primary + "18" }]}>
          <Text style={[styles.avatarText, { color: Colors.primary }]}>{profile?.name?.charAt(0).toUpperCase() || "A"}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.profileName, { color: theme.text }]}>{profile?.name || "Athlete"}</Text>
          <Text style={[styles.profileMeta, { color: theme.textSecondary }]}>{profile ? goalLabels[profile.goal] : "Complete your profile"}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </PressableScale>

      <View style={[styles.stats, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <StatItem label="Workouts" value={completedWorkouts.toString()} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <StatItem label="PRs" value={personalRecords.length.toString()} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <StatItem label="Streak" value={`${currentStreak}d`} />
      </View>

      {MORE_CAPABILITY_GROUPS.map((group) => (
        <View key={group.title} style={styles.capabilitySection}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{group.title}</Text>
          <View style={styles.capabilityGrid}>
            {group.items.map((capability) => (
              <CapabilityTile
                key={capability.route}
                capability={capability}
                onPress={() => router.push(capability.route as Href)}
              />
            ))}
          </View>
        </View>
      ))}

      <SectionCard title="Account & safety" subtitle={isAuthenticated ? user?.email || "Signed in" : "Local profile"}>
        <NavRow icon="person-circle-outline" label="Profile & settings" hint="Goals, macros, health sync and account" onPress={() => router.push("/profile-details")} />
        <NavRow icon="diamond-outline" label="Subscription" hint={planLabel} onPress={() => router.push("/paywall")} />
        <NavRow icon="shield-checkmark-outline" label="Privacy & data" hint="Export or permanently delete your data" onPress={() => router.push("/privacy-data")} />
      </SectionCard>
    </ScrollView>
  );
}

function CapabilityTile({ capability, onPress }: { capability: MoreCapability; onPress: () => void }) {
  const { theme } = useTheme();
  const color = capabilityToneColors[capability.tone];

  return (
    <PressableScale
      style={[styles.capabilityTile, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={onPress}
      haptic
      accessibilityRole="button"
      accessibilityLabel={capability.label}
      accessibilityHint={capability.description}
    >
      <View style={[styles.capabilityIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={capability.icon as React.ComponentProps<typeof Ionicons>["name"]} size={20} color={color} />
      </View>
      <Text style={[styles.capabilityLabel, { color: theme.text }]}>{capability.label}</Text>
      <Text style={[styles.capabilityDescription, { color: theme.textMuted }]}>{capability.description}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Space.lg, gap: Space.lg },
  header: { gap: Space.xs },
  title: Type.title1,
  subtitle: Type.subhead,
  profileCard: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.md,
  },
  avatar: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },
  avatarText: Type.title2,
  profileCopy: { flex: 1, gap: Space.xs },
  profileName: Type.headline,
  profileMeta: Type.footnote,
  stats: { minHeight: 76, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: Radius.lg, padding: Space.md },
  divider: { width: 1, height: 32 },
  capabilitySection: { gap: Space.sm },
  sectionLabel: Type.overline,
  capabilityGrid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  capabilityTile: { width: "48%", minHeight: 120, borderWidth: 1, borderRadius: Radius.lg, padding: Space.md },
  capabilityIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: "center", justifyContent: "center", marginBottom: Space.sm },
  capabilityLabel: Type.subhead,
  capabilityDescription: { ...Type.caption, marginTop: Space.xs },
});
