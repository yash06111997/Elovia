import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  useColorScheme,
  Alert,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useApp } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { Colors } from "@/constants/colors";

const goalLabels: Record<string, string> = {
  fat_loss: "Fat Loss",
  muscle_gain: "Muscle Gain",
  strength: "Strength",
  endurance: "Endurance",
  maintenance: "Maintenance",
  general_fitness: "General Fitness",
};

const levelLabels: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { state: appState, calculateTDEE, calculateMacros, toggleColorScheme } = useApp();
  const { sessions, personalRecords, plan } = useWorkout();
  const profile = appState.profile;

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const tdee = calculateTDEE();
  const macros = calculateMacros();

  const handleResetOnboarding = () => {
    Alert.alert(
      "Reset App",
      "This will clear all your data and restart the onboarding. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            const AsyncStorage = require("@react-native-async-storage/async-storage").default;
            await AsyncStorage.clear();
            router.replace("/onboarding");
          },
        },
      ]
    );
  };

  if (!profile) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: topPadding }]}>
        <Ionicons name="person-circle-outline" size={64} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No Profile</Text>
        <TouchableOpacity style={[styles.setupBtn, { backgroundColor: Colors.primary }]} onPress={() => router.push("/onboarding")}>
          <Text style={styles.setupBtnText}>Complete Setup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar + Name */}
      <View style={styles.avatarSection}>
        <View style={[styles.avatarLarge, { backgroundColor: Colors.primary + "20" }]}>
          <Text style={[styles.avatarInitial, { color: Colors.primary }]}>
            {profile.name.charAt(0).toUpperCase() || "A"}
          </Text>
        </View>
        <Text style={[styles.userName, { color: theme.text }]}>{profile.name}</Text>
        <View style={styles.goalBadge}>
          <Ionicons name="flag-outline" size={12} color={Colors.primary} />
          <Text style={[styles.goalBadgeText, { color: Colors.primary }]}>{goalLabels[profile.goal]}</Text>
        </View>
      </View>

      {/* Stats Row */}
      <View style={[styles.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <StatItem label="Workouts" value={sessions.filter((s) => s.completed).length.toString()} theme={theme} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="PRs" value={personalRecords.length.toString()} theme={theme} />
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <StatItem label="Streak" value={`${appState.currentStreak}d`} theme={theme} />
      </View>

      {/* Body Stats */}
      <SectionCard title="Body Stats" isDark={isDark} theme={theme}>
        <InfoRow label="Age" value={`${profile.age} years`} theme={theme} />
        <InfoRow label="Gender" value={profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)} theme={theme} />
        <InfoRow label="Height" value={`${profile.heightCm} cm`} theme={theme} />
        <InfoRow label="Weight" value={`${profile.weightKg} kg`} theme={theme} />
        <InfoRow label="BMI" value={`${(profile.weightKg / ((profile.heightCm / 100) ** 2)).toFixed(1)}`} theme={theme} />
        <InfoRow label="TDEE" value={`${tdee} kcal`} theme={theme} highlight />
      </SectionCard>

      {/* Daily Nutrition Targets */}
      <SectionCard title="Daily Nutrition Targets" isDark={isDark} theme={theme}>
        <InfoRow label="Calories" value={`${macros.calories} kcal`} theme={theme} highlight />
        <InfoRow label="Protein" value={`${macros.protein} g`} theme={theme} />
        <InfoRow label="Carbs" value={`${macros.carbs} g`} theme={theme} />
        <InfoRow label="Fats" value={`${macros.fats} g`} theme={theme} />
      </SectionCard>

      {/* Fitness Profile */}
      <SectionCard title="Fitness Profile" isDark={isDark} theme={theme}>
        <InfoRow label="Goal" value={goalLabels[profile.goal]} theme={theme} />
        <InfoRow label="Level" value={levelLabels[profile.fitnessLevel]} theme={theme} />
        <InfoRow label="Activity" value={profile.activityLevel.replace("_", " ")} theme={theme} />
        <InfoRow label="Workout Days" value={`${profile.workoutDaysPerWeek} days/week`} theme={theme} />
        <InfoRow label="Session Length" value={`${profile.workoutDurationMins} min`} theme={theme} />
        <InfoRow label="Preference" value={profile.workoutPreference} theme={theme} />
      </SectionCard>

      {/* Diet Profile */}
      <SectionCard title="Diet Profile" isDark={isDark} theme={theme}>
        <InfoRow label="Food Type" value={profile.foodPreference.replace("_", " ")} theme={theme} />
        {profile.dietaryRestrictions ? (
          <InfoRow label="Restrictions" value={profile.dietaryRestrictions} theme={theme} />
        ) : null}
        {profile.dislikedFoods ? (
          <InfoRow label="Dislikes" value={profile.dislikedFoods} theme={theme} />
        ) : null}
        {profile.medicalNotes ? (
          <InfoRow label="Medical Notes" value={profile.medicalNotes} theme={theme} />
        ) : null}
      </SectionCard>

      {/* Equipment */}
      <SectionCard title="Equipment" isDark={isDark} theme={theme}>
        <View style={styles.equipmentList}>
          {profile.equipment.map((eq) => (
            <View key={eq} style={[styles.equipTag, { backgroundColor: Colors.primary + "20" }]}>
              <Text style={[styles.equipTagText, { color: Colors.primary }]}>
                {eq.replace(/_/g, " ")}
              </Text>
            </View>
          ))}
        </View>
      </SectionCard>

      {/* Health Habits */}
      <SectionCard title="Health Habits" isDark={isDark} theme={theme}>
        <InfoRow label="Sleep" value={`${profile.sleepHours} hours/night`} theme={theme} />
        <InfoRow label="Water Goal" value={`${profile.waterIntakeLiters} L/day`} theme={theme} />
      </SectionCard>

      {/* Settings */}
      <SectionCard title="Settings" isDark={isDark} theme={theme}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <Ionicons name="moon-outline" size={18} color={theme.textSecondary} />
            <Text style={[styles.settingLabel, { color: theme.text }]}>Dark Mode</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={() => { toggleColorScheme(); Haptics.selectionAsync(); }}
            trackColor={{ false: theme.border, true: Colors.primary + "80" }}
            thumbColor={isDark ? Colors.primary : theme.textMuted}
          />
        </View>
      </SectionCard>

      {/* Actions */}
      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
        onPress={() => router.push("/onboarding")}
        activeOpacity={0.8}
      >
        <Ionicons name="create-outline" size={18} color={Colors.primary} />
        <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Update Profile</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: Colors.accentRed + "15", borderColor: Colors.accentRed + "40" }]}
        onPress={handleResetOnboarding}
        activeOpacity={0.8}
      >
        <Ionicons name="trash-outline" size={18} color={Colors.accentRed} />
        <Text style={[styles.actionBtnText, { color: Colors.accentRed }]}>Reset All Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionCard({ title, children, isDark, theme }: any) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, theme, highlight }: any) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: theme.border }]}>
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: highlight ? Colors.primary : theme.text }]}>{value}</Text>
    </View>
  );
}

function StatItem({ label, value, theme }: any) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  setupBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  setupBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  avatarSection: { alignItems: "center", gap: 8, paddingVertical: 8 },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 32, fontFamily: "Inter_700Bold" },
  userName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  goalBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.primary + "20", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  goalBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statsCard: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 16 },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  statDivider: { width: 1, marginVertical: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 0 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "right" },
  equipmentList: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  equipTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  equipTagText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
