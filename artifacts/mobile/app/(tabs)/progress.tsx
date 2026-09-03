import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout } from "@/context/WorkoutContext";
import { useNutrition } from "@/context/NutritionContext";
import { useApp } from "@/context/AppContext";
import { useHealth } from "@/context/HealthContext";
import { MacroBar } from "@/components/MacroBar";
import { PremiumLock } from "@/components/PremiumLock";
import { Colors } from "@/constants/colors";
import { Radius, Space, tabularNumbers, Type } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";
import { toLocalDateKey } from "@/lib/health";
import {
  buildNutritionProgress,
  buildRecoverySignals,
  buildWeightTrend,
  buildWorkoutProgress,
  type NutritionProgressDay,
} from "@/lib/progressMetrics";

type WorkoutCtx = ReturnType<typeof useWorkout>;
type AppCtx = ReturnType<typeof useApp>;
type NutritionProgress = ReturnType<typeof buildNutritionProgress>;
type WorkoutProgress = ReturnType<typeof buildWorkoutProgress>;
type WeightTrend = ReturnType<typeof buildWeightTrend>;
type RecoverySignals = ReturnType<typeof buildRecoverySignals>;
type Tab = "strength" | "nutrition" | "body";

const TABS: { key: Tab; label: string }[] = [
  { key: "strength", label: "Strength" },
  { key: "nutrition", label: "Nutrition" },
  { key: "body", label: "Body" },
];

function dateKeyDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return toLocalDateKey(date);
}

export default function ProgressScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { sessions, personalRecords, getActivePlanDays } = useWorkout();
  const { foodLog } = useNutrition();
  const { state: appState, calculateMacros } = useApp();
  const { healthData, status, backendName } = useHealth();
  const [activeTab, setActiveTab] = useState<Tab>("strength");

  const topPadding = Platform.OS === "web" ? 67 : insets.top + Space.md;
  const todayKey = toLocalDateKey(new Date());
  const macroTargets = calculateMacros();
  const activePlanDays = getActivePlanDays();
  const weeklyTarget =
    activePlanDays.length || appState.profile?.workoutDaysPerWeek || 3;

  const workoutProgress = useMemo(
    () => buildWorkoutProgress(sessions, weeklyTarget, todayKey),
    [sessions, weeklyTarget, todayKey],
  );
  const nutritionProgress = useMemo(
    () => buildNutritionProgress(foodLog, macroTargets, todayKey),
    [
      foodLog,
      macroTargets.calories,
      macroTargets.protein,
      macroTargets.carbs,
      macroTargets.fats,
      todayKey,
    ],
  );
  const weightTrend = useMemo(
    () =>
      buildWeightTrend(
        appState.healthMetrics,
        healthData.bodyMassKg,
        dateKeyDaysAgo(6),
        todayKey,
      ),
    [appState.healthMetrics, healthData.bodyMassKg, todayKey],
  );
  const recoverySignals = useMemo(
    () => buildRecoverySignals(healthData),
    [
      healthData.sleep,
      healthData.restingHeartRate,
      healthData.heartRateVariability,
    ],
  );
  const summaryCardWidth = width >= 600 ? "23%" : "48%";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topPadding,
          paddingBottom:
            Platform.OS === "web" ? Space.xxxl : insets.bottom + 80,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headingBlock}>
        <Text
          accessibilityRole="header"
          style={[styles.screenTitle, { color: theme.text }]}
        >
          Progress
        </Text>
        <Text style={[styles.screenSubtitle, { color: theme.textSecondary }]}>
          Your recorded training, nutrition, and health trends—nothing
          estimated.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard
          value={String(workoutProgress.completedSessions)}
          label="Workouts"
          description="completed all time"
          color={Colors.primary}
          width={summaryCardWidth}
        />
        <SummaryCard
          value={`${workoutProgress.week.completedSessions}/${workoutProgress.week.targetSessions}`}
          label="This week"
          description={`${workoutProgress.week.completionPercent}% of plan`}
          color={Colors.accentGreen}
          width={summaryCardWidth}
        />
        <SummaryCard
          value={String(personalRecords.length)}
          label="Records"
          description="personal bests"
          color={Colors.accentYellow}
          width={summaryCardWidth}
        />
        <SummaryCard
          value={formatLoad(workoutProgress.week.volumeKg)}
          label="Weekly load"
          description={`${workoutProgress.week.durationMins} training min`}
          color={Colors.accent}
          width={summaryCardWidth}
        />
      </View>

      <View
        accessibilityRole="tablist"
        accessibilityLabel="Progress sections"
        style={[
          styles.tabBar,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityHint={`Shows ${tab.label.toLowerCase()} progress`}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabSelected,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                setActiveTab(tab.key);
                void Haptics.selectionAsync();
              }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: selected ? "#001014" : theme.textSecondary },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "strength" && (
        <StrengthTab
          personalRecords={personalRecords}
          sessions={sessions}
          progress={workoutProgress}
        />
      )}
      {activeTab === "nutrition" && (
        <PremiumLock feature="advanced_analytics">
          <NutritionTab progress={nutritionProgress} isDark={isDark} />
        </PremiumLock>
      )}
      {activeTab === "body" && (
        <PremiumLock feature="health_insights">
          <BodyTab
            profile={appState.profile}
            weightTrend={weightTrend}
            recovery={recoverySignals}
            healthConnected={Boolean(status?.platform?.authorized)}
            backendName={backendName}
          />
        </PremiumLock>
      )}
    </ScrollView>
  );
}

function StrengthTab({
  personalRecords,
  sessions,
  progress,
}: {
  personalRecords: WorkoutCtx["personalRecords"];
  sessions: WorkoutCtx["sessions"];
  progress: WorkoutProgress;
}) {
  const { theme } = useTheme();
  const completedSessions = [...sessions]
    .filter((session) => session.completed)
    .sort((left, right) => right.date.localeCompare(left.date));

  if (personalRecords.length === 0 && completedSessions.length === 0) {
    return (
      <EmptyState
        icon="barbell-outline"
        title="Your training story starts here"
        description="Complete a workout to unlock consistency, load, and strength trends."
      />
    );
  }

  return (
    <View style={styles.sectionStack}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        This week
      </Text>
      <View
        style={[
          styles.insightCard,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.insightHeader}>
          <View>
            <Text style={[styles.eyebrow, { color: theme.textMuted }]}>
              CONSISTENCY
            </Text>
            <Text
              style={[
                styles.insightValue,
                tabularNumbers,
                { color: theme.text },
              ]}
            >
              {progress.week.completedSessions} of{" "}
              {progress.week.targetSessions} sessions
            </Text>
          </View>
          <Text
            style={[
              styles.percentValue,
              tabularNumbers,
              { color: Colors.accentGreen },
            ]}
          >
            {progress.week.completionPercent}%
          </Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Weekly workout completion"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: progress.week.completionPercent,
          }}
          style={[styles.progressTrack, { backgroundColor: theme.border }]}
        >
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: Colors.accentGreen,
                width: `${progress.week.completionPercent}%`,
              },
            ]}
          />
        </View>
        <View style={styles.metricPair}>
          <InlineMetric
            label="Training time"
            value={`${progress.week.durationMins} min`}
          />
          <InlineMetric
            label="Completed-set load"
            value={formatLoad(progress.week.volumeKg)}
          />
        </View>
      </View>

      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        Personal records
      </Text>
      {personalRecords.length === 0 ? (
        <View
          style={[
            styles.softEmpty,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Ionicons name="trophy-outline" size={24} color={theme.textMuted} />
          <View style={styles.flexOne}>
            <Text style={[styles.softEmptyTitle, { color: theme.text }]}>
              No personal records yet
            </Text>
            <Text
              style={[styles.softEmptyBody, { color: theme.textSecondary }]}
            >
              Your recent workouts still appear below.
            </Text>
          </View>
        </View>
      ) : (
        personalRecords.map((record) => (
          <View
            key={record.exerciseId}
            accessible
            accessibilityLabel={`${record.exerciseName}. ${record.maxWeightKg} kilograms for ${record.maxReps} reps. Best set load ${record.bestVolume} kilograms.`}
            style={[
              styles.recordCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View style={styles.recordIcon}>
              <Ionicons name="trophy" size={18} color={Colors.accentYellow} />
            </View>
            <View style={styles.flexOne}>
              <Text style={[styles.recordName, { color: theme.text }]}>
                {record.exerciseName}
              </Text>
              <Text style={[styles.recordDate, { color: theme.textSecondary }]}>
                Last recorded {formatDate(record.lastPerformed)}
              </Text>
            </View>
            <View style={styles.recordValueBlock}>
              <Text
                style={[
                  styles.recordWeight,
                  tabularNumbers,
                  { color: Colors.primary },
                ]}
              >
                {record.maxWeightKg} kg
              </Text>
              <Text style={[styles.recordReps, { color: theme.textSecondary }]}>
                {record.maxReps} reps · {record.bestVolume} kg best set
              </Text>
            </View>
          </View>
        ))
      )}

      {completedSessions.length > 0 && (
        <>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: theme.text }]}
          >
            Recent Workouts
          </Text>
          {completedSessions.slice(0, 5).map((session) => (
            <View
              key={session.id}
              accessible
              accessibilityLabel={`${session.workoutDayName}, ${formatDate(session.date)}, ${session.durationMins} minutes, ${session.exerciseLogs.length} exercises`}
              style={[
                styles.sessionCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <View style={styles.flexOne}>
                <Text style={[styles.sessionName, { color: theme.text }]}>
                  {session.workoutDayName}
                </Text>
                <Text
                  style={[styles.sessionMeta, { color: theme.textSecondary }]}
                >
                  {formatDate(session.date)} · {session.durationMins} min ·{" "}
                  {session.exerciseLogs.length}{" "}
                  {session.exerciseLogs.length === 1 ? "exercise" : "exercises"}
                </Text>
              </View>
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={Colors.accentGreen}
              />
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function NutritionTab({
  progress,
  isDark,
}: {
  progress: NutritionProgress;
  isDark: boolean;
}) {
  const { theme } = useTheme();
  const { today, targets, days } = progress;
  const caloriePercent =
    targets.calories > 0
      ? Math.round((today.calories / targets.calories) * 100)
      : 0;
  const maxCalories = Math.max(
    targets.calories,
    ...days.map((day) => day.calories),
    1,
  );

  return (
    <View style={styles.sectionStack}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        Today&apos;s nutrition
      </Text>
      <View
        style={[
          styles.nutritionHero,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.insightHeader}>
          <View style={styles.flexOne}>
            <Text style={[styles.eyebrow, { color: theme.textMuted }]}>
              CALORIES RECORDED
            </Text>
            <Text
              style={[
                styles.calorieValue,
                tabularNumbers,
                { color: theme.text },
              ]}
            >
              {formatNumber(today.calories)} / {formatNumber(targets.calories)}{" "}
              kcal today
            </Text>
          </View>
          <Text
            style={[
              styles.percentValue,
              tabularNumbers,
              {
                color:
                  caloriePercent > 110 ? Colors.accentYellow : Colors.primary,
              },
            ]}
          >
            {caloriePercent}%
          </Text>
        </View>
        <View style={styles.macroStack}>
          <MacroBar
            label="Protein"
            current={today.protein}
            target={targets.protein}
            color={Colors.primary}
            isDark={isDark}
          />
          <MacroBar
            label="Carbs"
            current={today.carbs}
            target={targets.carbs}
            color={Colors.accent}
            isDark={isDark}
          />
          <MacroBar
            label="Fats"
            current={today.fats}
            target={targets.fats}
            color={Colors.accentGreen}
            isDark={isDark}
          />
        </View>
      </View>

      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        Seven-day calories
      </Text>
      <View
        accessible
        accessibilityLabel={nutritionChartSummary(days, targets.calories)}
        style={[
          styles.chartCard,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.barChart}>
          {days.map((day) => {
            const fraction = day.calories / maxCalories;
            return (
              <View key={day.date} style={styles.barColumn}>
                <Text
                  style={[
                    styles.barValue,
                    tabularNumbers,
                    { color: theme.textSecondary },
                  ]}
                >
                  {formatCompactNumber(day.calories)}
                </Text>
                <View
                  style={[styles.barTrack, { backgroundColor: theme.border }]}
                >
                  {day.calories > 0 && (
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: `${Math.max(3, fraction * 100)}%`,
                          backgroundColor:
                            day.calories >= targets.calories * 0.8
                              ? Colors.accentGreen
                              : Colors.primary,
                        },
                      ]}
                    />
                  )}
                </View>
                <Text
                  style={[
                    styles.barLabel,
                    {
                      color: day.isToday ? Colors.primary : theme.textSecondary,
                    },
                  ]}
                >
                  {day.label}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={[styles.chartFooter, { borderTopColor: theme.border }]}>
          <View
            style={[styles.targetDot, { backgroundColor: Colors.primary }]}
          />
          <Text
            style={[styles.chartFooterText, { color: theme.textSecondary }]}
          >
            Daily target {formatNumber(targets.calories)} kcal
          </Text>
        </View>
      </View>
    </View>
  );
}

function BodyTab({
  profile,
  weightTrend,
  recovery,
  healthConnected,
  backendName,
}: {
  profile: AppCtx["state"]["profile"];
  weightTrend: WeightTrend;
  recovery: RecoverySignals;
  healthConnected: boolean;
  backendName: string;
}) {
  const { theme } = useTheme();
  const displayWeight = weightTrend.latestKg ?? profile?.weightKg ?? null;

  return (
    <View style={styles.sectionStack}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        Body trend
      </Text>
      <View
        style={[
          styles.bodyCard,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.metricPair}>
          <ProfileStat
            label="Latest weight"
            value={displayWeight === null ? "No data" : `${displayWeight} kg`}
            color={Colors.primary}
          />
          <ProfileStat
            label="Seven-day change"
            value={
              weightTrend.changeKg === null
                ? "Need 2 readings"
                : formatSignedKg(weightTrend.changeKg)
            }
            color={
              weightTrend.changeKg !== null && weightTrend.changeKg <= 0
                ? Colors.accentGreen
                : Colors.accentYellow
            }
          />
        </View>
        {profile && (
          <View
            style={[
              styles.metricPair,
              styles.dividedRow,
              { borderTopColor: theme.border },
            ]}
          >
            <ProfileStat
              label="Height"
              value={`${profile.heightCm} cm`}
              color={Colors.accent}
            />
            <ProfileStat
              label="BMI"
              value={(profile.weightKg / (profile.heightCm / 100) ** 2).toFixed(
                1,
              )}
              color={Colors.accentYellow}
            />
          </View>
        )}
        <Text style={[styles.dataCaption, { color: theme.textMuted }]}>
          {weightTrend.readings.length > 0
            ? `${weightTrend.readings.length} recorded weight ${weightTrend.readings.length === 1 ? "reading" : "readings"} in this window`
            : "Add or sync weight readings to see a measured trend."}
        </Text>
      </View>

      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: theme.text }]}
      >
        Latest recovery signals
      </Text>
      <View style={styles.recoveryGrid}>
        <RecoveryCard
          icon="moon-outline"
          label="Sleep"
          value={formatSleep(recovery.sleep?.value)}
          color={Colors.accent}
        />
        <RecoveryCard
          icon="heart-outline"
          label="Resting HR"
          value={formatUnit(recovery.restingHeartRate?.value, "bpm")}
          color={Colors.accentRed}
        />
        <RecoveryCard
          icon="pulse-outline"
          label="HRV"
          value={formatUnit(recovery.heartRateVariability?.value, "ms")}
          color={Colors.primary}
        />
      </View>

      <View
        style={[
          styles.sourceCard,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Ionicons
          name={healthConnected ? "checkmark-circle-outline" : "watch-outline"}
          size={24}
          color={healthConnected ? Colors.accentGreen : theme.textMuted}
        />
        <View style={styles.flexOne}>
          <Text style={[styles.sourceTitle, { color: theme.text }]}>
            {healthConnected
              ? `Connected to ${backendName}`
              : "No health source connected"}
          </Text>
          <Text style={[styles.sourceBody, { color: theme.textSecondary }]}>
            {healthConnected
              ? "These are the latest recorded signals. Elovia does not invent a readiness score when data is missing."
              : "Connect Apple Health or Health Connect from Profile to add sleep, heart, and body trends."}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SummaryCard({
  value,
  label,
  description,
  color,
  width,
}: {
  value: string;
  label: string;
  description: string;
  color: string;
  width: `${number}%`;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}, ${description}`}
      style={[
        styles.summaryCard,
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
          width,
        },
      ]}
    >
      <Text style={[styles.summaryValue, tabularNumbers, { color }]}>
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.summaryDescription, { color: theme.textMuted }]}>
        {description}
      </Text>
    </View>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.flexOne}>
      <Text style={[styles.inlineMetricLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.inlineMetricValue,
          tabularNumbers,
          { color: theme.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ProfileStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={styles.flexOne}
    >
      <Text style={[styles.profileLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.profileValue, tabularNumbers, { color }]}>
        {value}
      </Text>
    </View>
  );
}

function RecoveryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  color: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.recoveryCard,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text
        style={[styles.recoveryValue, tabularNumbers, { color: theme.text }]}
      >
        {value}
      </Text>
      <Text style={[styles.recoveryLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={42} color={theme.textMuted} />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
        {description}
      </Text>
    </View>
  );
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCompactNumber(value: number): string {
  if (value === 0) return "0";
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}k`
    : String(Math.round(value));
}

function formatLoad(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)} t`
    : `${Math.round(value)} kg`;
}

function formatDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatSignedKg(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} kg`;
}

function formatSleep(minutes: number | undefined): string {
  if (minutes === undefined) return "No data";
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return `${hours}h ${remainder}m`;
}

function formatUnit(value: number | undefined, unit: string): string {
  return value === undefined ? "No data" : `${Math.round(value)} ${unit}`;
}

function nutritionChartSummary(
  days: NutritionProgressDay[],
  target: number,
): string {
  const values = days
    .map((day) => `${day.label} ${Math.round(day.calories)} kilocalories`)
    .join(", ");
  return `Seven-day calorie chart. ${values}. Daily target ${Math.round(target)} kilocalories.`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Space.lg, gap: Space.lg },
  headingBlock: { gap: Space.xs },
  screenTitle: Type.title1,
  screenSubtitle: Type.callout,
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  summaryCard: {
    minWidth: 140,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.md,
    gap: Space.xxs,
  },
  summaryValue: Type.title2,
  summaryLabel: Type.subhead,
  summaryDescription: Type.caption,
  tabBar: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.xs,
    gap: Space.xs,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Space.sm,
  },
  tabSelected: { backgroundColor: Colors.primary },
  pressed: { opacity: 0.72 },
  tabText: Type.subhead,
  sectionStack: { gap: Space.md },
  sectionTitle: Type.title3,
  insightCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.md,
  },
  insightHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Space.md,
  },
  eyebrow: Type.overline,
  insightValue: Type.headline,
  percentValue: Type.title2,
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: Radius.pill,
  },
  progressFill: { height: "100%", borderRadius: Radius.pill },
  metricPair: { flexDirection: "row", gap: Space.lg },
  inlineMetricLabel: Type.caption,
  inlineMetricValue: Type.headline,
  softEmpty: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.md,
  },
  softEmptyTitle: Type.headline,
  softEmptyBody: Type.footnote,
  flexOne: { flex: 1 },
  recordCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  recordIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentYellow + "1F",
  },
  recordName: Type.headline,
  recordDate: Type.caption,
  recordValueBlock: { alignItems: "flex-end", maxWidth: "45%" },
  recordWeight: Type.headline,
  recordReps: { ...Type.caption, textAlign: "right" },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Space.md,
  },
  sessionName: Type.headline,
  sessionMeta: Type.footnote,
  nutritionHero: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.lg,
  },
  calorieValue: Type.headline,
  macroStack: { gap: Space.md },
  chartCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg,
  },
  barChart: {
    flexDirection: "row",
    height: 150,
    gap: Space.xs,
    alignItems: "flex-end",
  },
  barColumn: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    gap: Space.xs,
  },
  barValue: Type.caption,
  barTrack: {
    flex: 1,
    width: "100%",
    borderRadius: Radius.xs,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { borderRadius: Radius.xs, width: "100%" },
  barLabel: Type.caption,
  chartFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
    marginTop: Space.md,
    paddingTop: Space.md,
    borderTopWidth: 1,
  },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  chartFooterText: Type.footnote,
  bodyCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.lg,
  },
  dividedRow: { borderTopWidth: 1, paddingTop: Space.lg },
  profileLabel: Type.caption,
  profileValue: Type.title3,
  dataCaption: Type.footnote,
  recoveryGrid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  recoveryCard: {
    flex: 1,
    minWidth: 96,
    minHeight: 108,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.md,
    justifyContent: "space-between",
  },
  recoveryValue: Type.headline,
  recoveryLabel: Type.caption,
  sourceCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.md,
  },
  sourceTitle: Type.headline,
  sourceBody: Type.footnote,
  emptyState: {
    alignItems: "center",
    gap: Space.sm,
    paddingVertical: Space.huge,
  },
  emptyTitle: { ...Type.title3, textAlign: "center" },
  emptyDescription: { ...Type.callout, textAlign: "center", maxWidth: 300 },
});
