import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout } from "@/context/WorkoutContext";
import { useNutrition } from "@/context/NutritionContext";
import { useApp } from "@/context/AppContext";
import { MacroBar } from "@/components/MacroBar";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

type Tab = "strength" | "nutrition" | "body";

export default function ProgressScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { sessions, personalRecords, getWeeklyCompletion, plan } = useWorkout();
  const { getWeeklyCalories } = useNutrition();
  const { state: appState, calculateMacros } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>("strength");

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const macros = calculateMacros();
  const weeklyCalories = getWeeklyCalories();
  const weeklyCompletion = getWeeklyCompletion();

  const totalVolume = sessions
    .flatMap((s) => s.exerciseLogs)
    .flatMap((l) => l.sets)
    .filter((s) => s.completed)
    .reduce((sum, s) => sum + s.reps * s.weightKg, 0);

  const completedSessions = sessions.filter((s) => s.completed).length;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={[styles.screenTitle, { color: theme.text }]}>Progress</Text>

      {/* Summary Row */}
      <View style={styles.summaryRow}>
        <SummaryCard value={completedSessions.toString()} label="Sessions" color={Colors.primary} theme={theme} />
        <SummaryCard value={`${weeklyCompletion}%`} label="Weekly" color={Colors.accentGreen} theme={theme} />
        <SummaryCard value={personalRecords.length.toString()} label="PRs" color={Colors.accentYellow} theme={theme} />
        <SummaryCard value={totalVolume > 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume.toString()} label="Volume" color={Colors.accent} theme={theme} />
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {(["strength", "nutrition", "body"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { backgroundColor: Colors.primary }]}
            onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? "#000" : theme.textSecondary }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "strength" && (
        <StrengthTab personalRecords={personalRecords} sessions={sessions} isDark={isDark} theme={theme} />
      )}
      {activeTab === "nutrition" && (
        <NutritionTab weeklyCalories={weeklyCalories} macros={macros} isDark={isDark} theme={theme} />
      )}
      {activeTab === "body" && (
        <BodyTab healthMetrics={appState.healthMetrics} profile={appState.profile} isDark={isDark} theme={theme} />
      )}
    </ScrollView>
  );
}

function StrengthTab({ personalRecords, sessions, isDark, theme }: any) {
  if (personalRecords.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="trophy-outline" size={48} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No records yet</Text>
        <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Complete workouts to track your strength progress</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Personal Records</Text>
      {personalRecords.map((pr: any) => (
        <View key={pr.exerciseId} style={[styles.prCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.prTrophyBg, { backgroundColor: Colors.accentYellow + "20" }]}>
            <Ionicons name="trophy" size={18} color={Colors.accentYellow} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.prName, { color: theme.text }]}>{pr.exerciseName}</Text>
            <Text style={[styles.prDate, { color: theme.textSecondary }]}>Last: {pr.lastPerformed}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.prWeight, { color: Colors.primary }]}>{pr.maxWeightKg} kg</Text>
            <Text style={[styles.prReps, { color: theme.textSecondary }]}>× {pr.maxReps} reps</Text>
          </View>
        </View>
      ))}

      {sessions.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 8 }]}>Recent Workouts</Text>
          {sessions.slice(-5).reverse().map((session: any) => (
            <View key={session.id} style={[styles.sessionCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sessionName, { color: theme.text }]}>{session.workoutDayName}</Text>
                <Text style={[styles.sessionMeta, { color: theme.textSecondary }]}>
                  {session.date} • {session.durationMins} min • {session.exerciseLogs.length} exercises
                </Text>
              </View>
              {session.completed && <Ionicons name="checkmark-circle" size={20} color={Colors.accentGreen} />}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function NutritionTab({ weeklyCalories, macros, isDark, theme }: any) {
  const maxCal = Math.max(...weeklyCalories.map((d: any) => d.calories), macros.calories);

  return (
    <View style={{ gap: 14 }}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Weekly Calories</Text>
      <View style={[styles.chartCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.barChart}>
          {weeklyCalories.map((day: any, i: number) => {
            const pct = maxCal > 0 ? day.calories / maxCal : 0;
            const dayLabel = ["S", "M", "T", "W", "T", "F", "S"];
            const today = new Date().getDay();
            const isToday = i === (7 - (7 - today) % 7) % 7;
            return (
              <View key={i} style={styles.barCol}>
                <Text style={[styles.barValue, { color: theme.textSecondary }]}>
                  {day.calories > 0 ? (day.calories >= 1000 ? `${(day.calories / 1000).toFixed(1)}k` : day.calories) : ""}
                </Text>
                <View style={[styles.barTrack, { backgroundColor: isDark ? "#1A1A24" : "#E4E6F0" }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        height: `${Math.max(4, pct * 100)}%`,
                        backgroundColor: day.calories >= macros.calories * 0.8 ? Colors.accentGreen : Colors.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.barLabel, { color: isToday ? Colors.primary : theme.textSecondary }]}>
                  {dayLabel[i]}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={[styles.calTarget, { borderTopColor: theme.border }]}>
          <View style={[styles.targetDot, { backgroundColor: Colors.primary }]} />
          <Text style={[styles.targetLabel, { color: theme.textSecondary }]}>Target: {macros.calories} kcal</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>Daily Macro Targets</Text>
      <View style={[styles.macroTargetCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <MacroBar label="Protein" current={macros.protein} target={macros.protein} color={Colors.primary} isDark={isDark} />
        <MacroBar label="Carbs" current={macros.carbs} target={macros.carbs} color={Colors.accent} isDark={isDark} />
        <MacroBar label="Fats" current={macros.fats} target={macros.fats} color={Colors.accentGreen} isDark={isDark} />
      </View>
    </View>
  );
}

function BodyTab({ healthMetrics, profile, isDark, theme }: any) {
  const weights = healthMetrics.filter((m: any) => m.weightKg).slice(-7);
  const latest = weights[weights.length - 1];
  const first = weights[0];
  const change = latest && first ? (latest.weightKg - first.weightKg).toFixed(1) : null;

  return (
    <View style={{ gap: 14 }}>
      {profile && (
        <View style={[styles.profileCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.profileCardRow}>
            <ProfileStat label="Current Weight" value={`${profile.weightKg} kg`} color={Colors.primary} theme={theme} />
            <ProfileStat label="Height" value={`${profile.heightCm} cm`} color={Colors.accent} theme={theme} />
          </View>
          <View style={styles.profileCardRow}>
            <ProfileStat label="BMI" value={`${(profile.weightKg / ((profile.heightCm / 100) ** 2)).toFixed(1)}`} color={Colors.accentYellow} theme={theme} />
            <ProfileStat label="Goal" value={profile.goal.replace("_", " ")} color={Colors.accentGreen} theme={theme} />
          </View>
          {change && (
            <View style={[styles.changeRow, { borderTopColor: theme.border }]}>
              <Ionicons
                name={parseFloat(change) < 0 ? "trending-down" : "trending-up"}
                size={16}
                color={parseFloat(change) < 0 ? Colors.accentGreen : Colors.accentRed}
              />
              <Text style={{ color: theme.textSecondary, fontSize: 13, fontFamily: "Inter_400Regular" }}>
                Weight change (7 days): <Text style={{ color: parseFloat(change) < 0 ? Colors.accentGreen : Colors.accentRed, fontFamily: "Inter_600SemiBold" }}>{change} kg</Text>
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.infoCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Ionicons name="watch-outline" size={32} color={theme.textMuted} />
        <Text style={[styles.infoTitle, { color: theme.text }]}>Advanced Health Tracking</Text>
        <Text style={[styles.infoDesc, { color: theme.textSecondary }]}>
          Connect Apple Health, Google Fit, or a wearable to sync heart rate, sleep, and advanced metrics.
        </Text>
      </View>
    </View>
  );
}

function SummaryCard({ value, label, color, theme }: any) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

function ProfileStat({ label, value, color, theme }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 11, fontFamily: "Inter_500Medium" }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  screenTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCard: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 4 },
  summaryValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  tabBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260 },
  prCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  prTrophyBg: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  prName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  prDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  prWeight: { fontSize: 16, fontFamily: "Inter_700Bold" },
  prReps: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sessionCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  sessionName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sessionMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  chartCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  barChart: { flexDirection: "row", height: 120, gap: 6, alignItems: "flex-end" },
  barCol: { flex: 1, alignItems: "center", gap: 4 },
  barValue: { fontSize: 9, fontFamily: "Inter_400Regular" },
  barTrack: { flex: 1, width: "100%", borderRadius: 4, justifyContent: "flex-end" },
  barFill: { borderRadius: 4, width: "100%" },
  barLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  calTarget: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  macroTargetCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  profileCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  profileCardRow: { flexDirection: "row", gap: 12 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 12, borderTopWidth: 1 },
  infoCard: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 10, alignItems: "center" },
  infoTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  infoDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
