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
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useApp } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { useNutrition } from "@/context/NutritionContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { MacroBar } from "@/components/MacroBar";
import { StatCard } from "@/components/StatCard";
import { ProgressRing } from "@/components/ProgressRing";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

export default function DashboardScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState, calculateMacros, getTodayMetric, updateTodayMetric } = useApp();
  const { plan, getWeeklyCompletion, sessions, personalRecords } = useWorkout();
  const { getTodayTotals, getTodayLog } = useNutrition();
  const { isPremium, isTrialActive, isFree, daysRemaining } = useSubscription();

  const profile = appState.profile;
  const macros = calculateMacros();
  const consumed = getTodayTotals();
  const todayMetric = getTodayMetric();
  const weeklyPct = getWeeklyCompletion();
  const calorieProgress = macros.calories > 0 ? consumed.calories / macros.calories : 0;
  const water = todayMetric?.waterLiters ?? 0;
  const steps = todayMetric?.steps ?? 0;

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";

  const todayWorkout = plan?.days[new Date().getDay() % (plan.days.length || 1)];

  const addWater = () => {
    updateTodayMetric({ waterLiters: Math.min((todayMetric?.waterLiters ?? 0) + 0.25, 6) });
  };

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: theme.textSecondary }]}>{greeting},</Text>
          <Text style={[styles.name, { color: theme.text }]}>{profile?.name ?? "Athlete"}</Text>
        </View>
        <View style={styles.headerRight}>
          {appState.currentStreak > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: Colors.accent + "20" }]}>
              <Ionicons name="flame" size={14} color={Colors.accent} />
              <Text style={[styles.streakText, { color: Colors.accent }]}>
                {appState.currentStreak} day streak
              </Text>
            </View>
          )}
          <View style={[styles.avatarCircle, { backgroundColor: Colors.primary + "20" }]}>
            <Ionicons name="person" size={18} color={Colors.primary} />
          </View>
        </View>
      </View>

      {isTrialActive && (
        <TouchableOpacity
          style={[styles.subBanner, { backgroundColor: Colors.primary + "15", borderColor: Colors.primary + "30" }]}
          onPress={() => { router.push("/paywall"); Haptics.selectionAsync(); }}
          activeOpacity={0.8}
        >
          <View style={styles.subBannerLeft}>
            <Ionicons name="diamond" size={16} color={Colors.primary} />
            <Text style={[styles.subBannerText, { color: Colors.primary }]}>
              {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} left in Premium
            </Text>
          </View>
          <Text style={[styles.subBannerSub, { color: theme.textSecondary }]}>
            Make the most of your plan
          </Text>
        </TouchableOpacity>
      )}
      {isFree && !isTrialActive && (
        <TouchableOpacity
          style={[styles.subBanner, { backgroundColor: Colors.accentYellow + "12", borderColor: Colors.accentYellow + "30" }]}
          onPress={() => { router.push("/paywall"); Haptics.selectionAsync(); }}
          activeOpacity={0.8}
        >
          <View style={styles.subBannerLeft}>
            <Ionicons name="lock-open-outline" size={16} color={Colors.accentYellow} />
            <Text style={[styles.subBannerText, { color: theme.text }]}>
              Unlock Premium
            </Text>
          </View>
          <Text style={[styles.subBannerSub, { color: theme.textSecondary }]}>
            Advanced workouts, nutrition, and tracking
          </Text>
        </TouchableOpacity>
      )}
      {isPremium && !isTrialActive && (
        <View style={[styles.premiumBadgeRow, { backgroundColor: Colors.accentGreen + "12", borderColor: Colors.accentGreen + "30" }]}>
          <Ionicons name="diamond" size={14} color={Colors.accentGreen} />
          <Text style={[styles.premiumBadgeText, { color: Colors.accentGreen }]}>Premium Active</Text>
        </View>
      )}

      {/* Calorie Ring */}
      <View style={[styles.calorieCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.calorieLeft}>
          <ProgressRing
            progress={calorieProgress}
            size={90}
            strokeWidth={9}
            color={Colors.primary}
            backgroundColor={Colors.dark.card}
          >
            <View style={{ alignItems: "center" }}>
              <Text style={[styles.calorieVal, { color: theme.text }]}>
                {Math.round(consumed.calories)}
              </Text>
              <Text style={[styles.calorieUnit, { color: theme.textSecondary }]}>kcal</Text>
            </View>
          </ProgressRing>
        </View>
        <View style={styles.calorieRight}>
          <Text style={[styles.calorieLabel, { color: theme.text }]}>Today's Calories</Text>
          <Text style={[styles.calorieTarget, { color: theme.textSecondary }]}>
            Goal: {macros.calories} kcal
          </Text>
          <Text style={[styles.calorieRemain, { color: calorieProgress < 1 ? Colors.accentGreen : Colors.accentRed }]}>
            {macros.calories - consumed.calories > 0
              ? `${macros.calories - consumed.calories} remaining`
              : "Goal reached!"}
          </Text>
        </View>
      </View>

      {/* Macros */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Macros</Text>
        <View style={styles.macros}>
          <MacroBar label="Protein" current={consumed.protein} target={macros.protein} color={Colors.primary} isDark={isDark} />
          <MacroBar label="Carbs" current={consumed.carbs} target={macros.carbs} color={Colors.accent} isDark={isDark} />
          <MacroBar label="Fats" current={consumed.fats} target={macros.fats} color={Colors.accentGreen} isDark={isDark} />
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard
          title="Steps"
          value={steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : `${steps}`}
          icon="footsteps-outline"
          iconColor={Colors.accent}
          isDark={isDark}
        />
        <StatCard
          title="Water"
          value={`${water.toFixed(1)}`}
          unit="L"
          icon="water-outline"
          iconColor={Colors.primary}
          isDark={isDark}
          onPress={addWater}
          subtitle="Tap to add 250ml"
        />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          title="Weekly Workouts"
          value={`${weeklyPct}%`}
          icon="barbell-outline"
          iconColor={Colors.accentGreen}
          isDark={isDark}
          subtitle={`${plan?.days.length ?? 3} day plan`}
        />
        <StatCard
          title="Total PRs"
          value={`${personalRecords.length}`}
          icon="trophy-outline"
          iconColor={Colors.accentYellow}
          isDark={isDark}
          subtitle="Personal records"
        />
      </View>

      {/* Today's Workout */}
      {todayWorkout && (
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Today's Workout</Text>
            <View style={[styles.dayBadge, { backgroundColor: Colors.accentGreen + "20" }]}>
              <Text style={[styles.dayBadgeText, { color: Colors.accentGreen }]}>Scheduled</Text>
            </View>
          </View>
          <View style={styles.workoutSummary}>
            <View style={[styles.workoutIcon, { backgroundColor: Colors.accentGreen + "20" }]}>
              <Ionicons name="barbell-outline" size={22} color={Colors.accentGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.workoutDayName, { color: theme.text }]}>{todayWorkout.dayName}</Text>
              <Text style={[styles.workoutMeta, { color: theme.textSecondary }]}>
                {todayWorkout.exercises.length} exercises • {todayWorkout.muscleGroups.join(", ")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </View>
        </View>
      )}

      {/* AI Upgrade Prompts for free users */}
      {isFree && (
        <>
          <TouchableOpacity
            style={[styles.upgradePromptCard, { backgroundColor: Colors.primary + "10", borderColor: Colors.primary + "30" }]}
            onPress={() => { router.push("/paywall"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            activeOpacity={0.85}
          >
            <View style={[styles.upgradePromptIcon, { backgroundColor: Colors.primary + "20" }]}>
              <Ionicons name="sparkles" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.upgradePromptTitle, { color: theme.text }]}>Get a personalized AI workout plan</Text>
              <Text style={[styles.upgradePromptSub, { color: theme.textSecondary }]}>
                Tailored to your goals, equipment, and fitness level
              </Text>
            </View>
            <View style={[styles.upgradePromptBadge, { backgroundColor: Colors.primary }]}>
              <Text style={styles.upgradePromptBadgeText}>Try Free</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.upgradePromptCard, { backgroundColor: Colors.accent + "10", borderColor: Colors.accent + "30" }]}
            onPress={() => { router.push("/paywall"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            activeOpacity={0.85}
          >
            <View style={[styles.upgradePromptIcon, { backgroundColor: Colors.accent + "20" }]}>
              <Ionicons name="camera" size={20} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.upgradePromptTitle, { color: theme.text }]}>Scan your food with AI</Text>
              <Text style={[styles.upgradePromptSub, { color: theme.textSecondary }]}>
                Instantly log meals from a photo — no manual entry needed
              </Text>
            </View>
            <View style={[styles.upgradePromptBadge, { backgroundColor: Colors.accent }]}>
              <Text style={styles.upgradePromptBadgeText}>Premium</Text>
            </View>
          </TouchableOpacity>
        </>
      )}

      {/* Weekly Summary */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>This Week</Text>
        <View style={styles.weekRow}>
          {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => {
            const today = new Date().getDay();
            const isToday = i === today;
            const isPast = i < today;
            const hasSession = sessions.some((s) => {
              const d = new Date(s.date);
              const weekStart = new Date();
              weekStart.setDate(weekStart.getDate() - today);
              const target = new Date(weekStart);
              target.setDate(target.getDate() + i);
              return d.toDateString() === target.toDateString() && s.completed;
            });
            return (
              <View key={i} style={styles.weekDayCol}>
                <Text style={[styles.weekDayLabel, { color: isToday ? Colors.primary : theme.textSecondary }]}>{day}</Text>
                <View
                  style={[
                    styles.weekDayDot,
                    { backgroundColor: hasSession ? Colors.accentGreen : isToday ? Colors.primary + "40" : theme.border },
                    isToday && { borderColor: Colors.primary, borderWidth: 2 },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      {/* Recommended Macros */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Daily Targets</Text>
        <View style={styles.targetsGrid}>
          <TargetPill label="Calories" value={`${macros.calories}`} unit="kcal" color={Colors.accentYellow} bg={theme.cardElevated} textColor={theme.text} />
          <TargetPill label="Protein" value={`${macros.protein}`} unit="g" color={Colors.primary} bg={theme.cardElevated} textColor={theme.text} />
          <TargetPill label="Carbs" value={`${macros.carbs}`} unit="g" color={Colors.accent} bg={theme.cardElevated} textColor={theme.text} />
          <TargetPill label="Fats" value={`${macros.fats}`} unit="g" color={Colors.accentGreen} bg={theme.cardElevated} textColor={theme.text} />
        </View>
      </View>
    </ScrollView>
  );
}

function TargetPill({ label, value, unit, color, bg, textColor }: any) {
  return (
    <View style={[styles.targetPill, { backgroundColor: bg }]}>
      <View style={[styles.targetDot, { backgroundColor: color }]} />
      <View>
        <Text style={[styles.targetLabel, { color: textColor + "99" }]}>{label}</Text>
        <Text style={[styles.targetValue, { color: textColor }]}>
          {value} <Text style={{ color, fontSize: 11 }}>{unit}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  name: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  streakBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  streakText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  calorieCard: { flexDirection: "row", padding: 16, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 16 },
  calorieLeft: { alignItems: "center" },
  calorieRight: { flex: 1, gap: 4 },
  calorieVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  calorieUnit: { fontSize: 10, fontFamily: "Inter_400Regular" },
  calorieLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  calorieTarget: { fontSize: 12, fontFamily: "Inter_400Regular" },
  calorieRemain: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dayBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  dayBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  macros: { gap: 10 },
  statsRow: { flexDirection: "row", gap: 12 },
  workoutSummary: { flexDirection: "row", alignItems: "center", gap: 12 },
  workoutIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  workoutDayName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  workoutMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  weekRow: { flexDirection: "row", justifyContent: "space-around" },
  weekDayCol: { alignItems: "center", gap: 6 },
  weekDayLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  weekDayDot: { width: 10, height: 10, borderRadius: 5 },
  targetsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  targetPill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, width: "47%" },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  targetValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  subBanner: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 4 },
  subBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  subBannerText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 24 },
  premiumBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  premiumBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  upgradePromptCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  upgradePromptIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  upgradePromptTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  upgradePromptSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  upgradePromptBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  upgradePromptBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#000" },
});
