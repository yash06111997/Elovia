import React from "react";
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
import { useHealth } from "@/context/HealthContext";
import { useWellness } from "@/context/WellnessContext";
import { MacroBar } from "@/components/MacroBar";
import { StatCard } from "@/components/StatCard";
import { ProgressRing } from "@/components/ProgressRing";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { localWeekDateKeys, toLocalDateKey } from "@/lib/localDate";

export default function DashboardScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState, calculateMacros } = useApp();
  const { plan, getWeeklyCompletion, sessions, personalRecords } = useWorkout();
  const { getTodayTotals } = useNutrition();
  const { isPremium, isTrialActive, isFree, daysRemaining } = useSubscription();
  const { healthData } = useHealth();
  const { todayWaterMl, currentStreak, addWater: addWaterMl } = useWellness();

  const profile = appState.profile;
  const macros = calculateMacros();
  const consumed = getTodayTotals();
  const weeklyPct = getWeeklyCompletion();
  const calorieProgress = macros.calories > 0 ? consumed.calories / macros.calories : 0;
  const water = todayWaterMl / 1000;
  const steps = healthData.todaySteps;
  const todayKey = toLocalDateKey(new Date());
  const weekDateKeys = localWeekDateKeys(new Date());

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";

  const todayWorkout = plan?.days[new Date().getDay() % (plan.days.length || 1)];

  const addWater = () => addWaterMl(250);

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
          {currentStreak > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: Colors.accent + "20" }]}>
              <Ionicons name="flame" size={14} color={Colors.accent} />
              <Text style={[styles.streakText, { color: Colors.accent }]}>
                {currentStreak} day streak
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

      <View style={styles.quickSection}>
        <Text style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>Quick actions</Text>
        <View style={styles.quickGrid}>
          <QuickAction label="Train" detail="Start or log" icon="barbell-outline" color={Colors.primary} onPress={() => router.push("/(tabs)/workouts")} />
          <QuickAction label="Run" detail="Live GPS map" icon="navigate-outline" color={Colors.accentGreen} onPress={() => router.push("/run")} />
          <QuickAction label="Log food" detail="Meals & macros" icon="restaurant-outline" color={Colors.accent} onPress={() => router.push("/(tabs)/diet")} />
          <QuickAction label="Add water" detail="+250 ml" icon="water-outline" color={Colors.primary} onPress={addWater} />
        </View>
      </View>

      {/* Calorie Ring */}
      <TouchableOpacity
        style={[styles.calorieCard, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => router.push("/(tabs)/diet")}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${Math.round(consumed.calories)} of ${macros.calories} calories. Open nutrition.`}
      >
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
      </TouchableOpacity>

      {/* Macros */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Macros</Text>
        <View style={styles.macros}>
          <MacroBar label="Protein" current={consumed.protein} target={macros.protein} color={Colors.primary} />
          <MacroBar label="Carbs" current={consumed.carbs} target={macros.carbs} color={Colors.accent} />
          <MacroBar label="Fats" current={consumed.fats} target={macros.fats} color={Colors.accentGreen} />
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard
          title="Steps"
          value={steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : `${steps}`}
          icon="footsteps-outline"
          iconColor={Colors.accent}
        />
        <StatCard
          title="Water"
          value={`${water.toFixed(1)}`}
          unit="L"
          icon="water-outline"
          iconColor={Colors.primary}
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
          subtitle={`${plan?.days.length ?? 3} day plan`}
        />
        <StatCard
          title="Total PRs"
          value={`${personalRecords.length}`}
          icon="trophy-outline"
          iconColor={Colors.accentYellow}
          subtitle="Personal records"
        />
      </View>

      {/* Today's Workout */}
      {todayWorkout && (
        <TouchableOpacity
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => router.push("/(tabs)/workouts")}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Today's workout: ${todayWorkout.dayName}`}
        >
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
        </TouchableOpacity>
      )}

      {/* Weekly Summary */}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>This Week</Text>
        <View style={styles.weekRow}>
          {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => {
            const dateKey = weekDateKeys[i];
            const isToday = dateKey === todayKey;
            const hasSession = sessions.some(
              (session) => session.date === dateKey && session.completed,
            );
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

    </ScrollView>
  );
}

function QuickAction({
  label,
  detail,
  icon,
  color,
  onPress,
}: {
  label: string;
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.quickAction, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
    >
      <View style={[styles.quickIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.quickLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.quickDetail, { color: theme.textMuted }]}>{detail}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  name: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  quickSection: { gap: 9 },
  sectionEyebrow: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickAction: { width: "48%", minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: 12, padding: 10 },
  quickIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  quickDetail: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
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
  subBanner: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 4 },
  subBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  subBannerText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 24 },
  premiumBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  premiumBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
