import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert, ActivityIndicator, Modal, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout, WorkoutDay, CustomWorkoutPlan, WorkoutSession } from "@/context/WorkoutContext";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { ExerciseCard } from "@/components/ExerciseCard";
import { router } from "expo-router";
import { generateWorkoutPlan } from "@/utils/aiEngine";
import { generateAIWorkout } from "@/utils/api";
import { handleAiError } from "@/utils/aiErrors";
import { Colors } from "@/constants/colors";
import { ExerciseLibraryScreen } from "@/screens/ExerciseLibraryScreen";
import { CustomPlanBuilderScreen } from "@/screens/CustomPlanBuilderScreen";
import { useTheme } from "@/hooks/useTheme";

type ViewMode = "plan" | "history";

export default function WorkoutsScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    plan,
    setPlan,
    sessions,
    activeSession,
    startSession,
    logSet,
    getPersonalRecord,
    getLastPerformance,
    customPlans,
    activePlanType,
    activeCustomPlanId,
    addCustomPlan,
    updateCustomPlan,
    deleteCustomPlan,
    setActivePlan,
    getActivePlanDays,
  } = useWorkout();
  const { state: appState } = useApp();
  const { canAccess } = useSubscription();

  const [selectedDay, setSelectedDay] = useState<WorkoutDay | null>(null);
  const [sessionTimer, setSessionTimer] = useState(0);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiPlanType, setAiPlanType] = useState<"daily" | "scheduled">("daily");
  const [aiLoading, setAiLoading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPlanBuilder, setShowPlanBuilder] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CustomWorkoutPlan | undefined>(undefined);
  const [showPlanSwitcher, setShowPlanSwitcher] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("plan");
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [aiPreferences, setAiPreferences] = useState<{
    bodyParts: string[];
    message: string;
  }>({ bodyParts: [], message: "" });

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const activeDays = getActivePlanDays();

  const activeCustomPlan = customPlans.find((p) => p.id === activeCustomPlanId) ?? null;
  const displayPlanName = activePlanType === "custom" && activeCustomPlan ? activeCustomPlan.name : plan ? plan.name : "No Plan";

  const handleStartWorkout = (day: WorkoutDay) => {
    startSession(day);
    setSelectedDay(day);
    const interval = setInterval(() => setSessionTimer((t) => t + 1), 1000);
    setTimerInterval(interval);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleFinishWorkout = () => {
    if (timerInterval) clearInterval(timerInterval);
    router.push({
      pathname: "/log-workout",
      params: { checkIn: "1", elapsedSeconds: String(sessionTimer) },
    });
  };

  const handleRegenerate = () => {
    if (!appState.profile) return;
    const newPlan = generateWorkoutPlan(appState.profile);
    setPlan(newPlan);
    setActivePlan("ai");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleAIGenerate = async () => {
    if (!appState.profile) return;
    setAiLoading(true);
    try {
      const result = await generateAIWorkout(appState.profile, aiPlanType, {
        bodyParts: aiPreferences.bodyParts,
        message: aiPreferences.message,
      });
      const uid = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);
      setPlan({
        id: uid(),
        name: result.name || `AI ${aiPlanType === "daily" ? "Daily" : "Weekly"} Plan`,
        goal: result.goal || appState.profile.goal,
        days: result.days.map((d: any, i: number) => ({
          id: d.id || `day_${i}`,
          dayName: d.dayName || `Day ${i + 1}`,
          muscleGroups: d.muscleGroups || [],
          exercises: (d.exercises || []).map((ex: any, j: number) => ({
            id: ex.id || `ex_${i}_${j}`,
            name: ex.name,
            muscleGroup: ex.muscleGroup || "",
            sets: ex.sets || 3,
            reps: ex.reps || "10",
            restSeconds: ex.restSeconds || 60,
            notes: ex.notes || "",
          })),
        })),
        generatedAt: new Date().toISOString(),
      });
      setActivePlan("ai");
      setAiModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Plan Generated", `AI created a ${result.days.length}-day plan tailored to your profile!`);
    } catch (e: any) {
      handleAiError(e, "Failed to generate AI workout plan.");
    } finally {
      setAiLoading(false);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleDeleteCustomPlan = (id: string) => {
    Alert.alert("Delete Plan", "Are you sure you want to delete this plan?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteCustomPlan(id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  };

  const noPlan = !plan && customPlans.length === 0;

  const sortedSessions = [...sessions].filter((s) => s.completed).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const groupedSessions: Record<string, WorkoutSession[]> = {};
  sortedSessions.forEach((s) => {
    if (!groupedSessions[s.date]) groupedSessions[s.date] = [];
    groupedSessions[s.date].push(s);
  });
  const dateGroups = Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    if (dateStr === today) return "Today";
    if (dateStr === yesterday) return "Yesterday";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  if (noPlan && sessions.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: topPadding }]}>
        <View style={styles.emptyHeader}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>Start Your Journey</Text>
          <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Choose how you want to train</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.optionCard,
            {
              backgroundColor: theme.card,
              borderColor: Colors.accentGreen + "40",
            },
          ]}
          onPress={() => router.push("/log-workout")}
          activeOpacity={0.8}
        >
          <View style={[styles.optionIconWrap, { backgroundColor: Colors.accentGreen + "20" }]}>
            <Ionicons name="add-circle" size={28} color={Colors.accentGreen} />
          </View>
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>Log Workout</Text>
            <Text style={[styles.optionDesc, { color: theme.textSecondary }]}>Start an empty workout. Add exercises and log sets one by one as you go.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>

        {/* Curated programmes: free on every tier, so this sits ABOVE the
            AI option rather than below it. A free user hitting a locked AI
            card as their first experience has nothing to do; this gives them
            a real programme immediately. */}
        <TouchableOpacity
          style={[styles.optionCard, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/plans");
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.optionIconWrap, { backgroundColor: Colors.accentGreen + "20" }]}>
            <Ionicons name="library-outline" size={28} color={Colors.accentGreen} />
          </View>
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>Training Programmes</Text>
            <Text style={[styles.optionDesc, { color: theme.textSecondary }]}>Proven programmes built on established training principles. Free on every plan.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionCard, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => {
            setEditingPlan(undefined);
            setShowPlanBuilder(true);
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.optionIconWrap, { backgroundColor: "#A78BFA20" }]}>
            <Ionicons name="barbell-outline" size={28} color="#A78BFA" />
          </View>
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>Custom Self Tracking</Text>
            <Text style={[styles.optionDesc, { color: theme.textSecondary }]}>Build your own workout plan. Choose exercises, sets, and reps. Track your progress manually.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionCard, { backgroundColor: theme.card, borderColor: Colors.primary + "40" }]}
          onPress={() => {
            if (!canAccess("ai_workout")) {
              router.push("/paywall");
              return;
            }
            setAiModalVisible(true);
          }}
          activeOpacity={0.8}
        >
          <View style={[styles.optionIconWrap, { backgroundColor: Colors.primary + "20" }]}>
            <Ionicons name="sparkles" size={28} color={Colors.primary} />
          </View>
          <View style={styles.optionContent}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>AI Powered Workout</Text>
            <Text style={[styles.optionDesc, { color: theme.textSecondary }]}>Get a personalized plan generated by AI based on your goals, equipment, and fitness level.</Text>
          </View>
          {!canAccess("ai_workout") && (
            <View
              style={{
                backgroundColor: Colors.primary + "20",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
                marginRight: 4,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontFamily: "Inter_700Bold",
                  color: Colors.primary,
                }}
              >
                PREMIUM
              </Text>
            </View>
          )}
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.quickGenBtn,
            {
              backgroundColor: isDark ? "#1A1A24" : "#F0F0F8",
              borderColor: theme.border,
            },
          ]}
          onPress={() => {
            if (!canAccess("ai_workout")) {
              router.push("/paywall");
              return;
            }
            handleRegenerate();
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="flash-outline" size={16} color={Colors.primary} />
          <Text style={[styles.quickGenText, { color: Colors.primary }]}>Quick Generate from Profile</Text>
          {!canAccess("ai_workout") && (
            <View
              style={{
                backgroundColor: Colors.primary + "20",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontFamily: "Inter_700Bold",
                  color: Colors.primary,
                }}
              >
                PREMIUM
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <AIGenerateModal
          visible={aiModalVisible}
          onClose={() => setAiModalVisible(false)}
          planType={aiPlanType}
          setPlanType={setAiPlanType}
          onGenerate={handleAIGenerate}
          loading={aiLoading}
          theme={theme}
          isDark={isDark}
          preferences={aiPreferences}
          setPreferences={setAiPreferences}
        />
        <CustomPlanBuilderScreen
          visible={showPlanBuilder}
          onClose={() => setShowPlanBuilder(false)}
          onSave={(planData) => {
            const saved = addCustomPlan(planData);
            setActivePlan("custom", saved.id);
          }}
          userEquipment={appState.profile?.equipment ?? []}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPadding,
            paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={[
            styles.freeWorkoutBtn,
            {
              backgroundColor: Colors.accentGreen + "15",
              borderColor: Colors.accentGreen + "40",
            },
          ]}
          onPress={() => router.push("/log-workout")}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle" size={20} color={Colors.accentGreen} />
          <Text style={[styles.freeWorkoutBtnText, { color: Colors.accentGreen }]}>Log Workout</Text>
        </TouchableOpacity>

        {/* Plan/History Toggle */}
        <View style={[styles.viewToggle, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === "plan" && { backgroundColor: Colors.primary }]}
            onPress={() => {
              setViewMode("plan");
              Haptics.selectionAsync();
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="barbell-outline" size={14} color={viewMode === "plan" ? "#000" : theme.textSecondary} />
            <Text style={[styles.viewToggleText, { color: viewMode === "plan" ? "#000" : theme.textSecondary }]}>Plan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewToggleBtn, viewMode === "history" && { backgroundColor: Colors.primary }]}
            onPress={() => {
              setViewMode("history");
              Haptics.selectionAsync();
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="time-outline" size={14} color={viewMode === "history" ? "#000" : theme.textSecondary} />
            <Text
              style={[
                styles.viewToggleText,
                {
                  color: viewMode === "history" ? "#000" : theme.textSecondary,
                },
              ]}
            >
              History
            </Text>
            {sessions.length > 0 && (
              <View
                style={[
                  styles.historyBadge,
                  {
                    backgroundColor: viewMode === "history" ? "#00000030" : Colors.primary + "30",
                  },
                ]}
              >
                <Text style={[styles.historyBadgeText, { color: viewMode === "history" ? "#000" : Colors.primary }]}>{sessions.filter((s) => s.completed).length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {viewMode === "plan" && (
          <>
            {/* Plan Header */}
            <View style={styles.planHeader}>
              <TouchableOpacity style={styles.planNameRow} onPress={() => setShowPlanSwitcher(true)} activeOpacity={0.8}>
                <View>
                  <Text style={[styles.planName, { color: theme.text }]} numberOfLines={1}>
                    {displayPlanName}
                  </Text>
                  <View style={styles.planSubRow}>
                    <Text style={[styles.planMeta, { color: theme.textSecondary }]}>
                      {activeDays.length} training day
                      {activeDays.length !== 1 ? "s" : ""}
                    </Text>
                    {customPlans.length > 0 || plan ? (
                      <View style={[styles.switchBadge, { backgroundColor: Colors.primary + "20" }]}>
                        <Ionicons name="swap-horizontal" size={11} color={Colors.primary} />
                        <Text style={[styles.switchBadgeText, { color: Colors.primary }]}>Switch</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>

              <View style={styles.headerActions}>
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: isDark ? "#1A1A24" : "#EDEDF5",
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setShowLibrary(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="search" size={16} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: isDark ? "#1A1A24" : "#EDEDF5",
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => {
                    setEditingPlan(undefined);
                    setShowPlanBuilder(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={18} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: Colors.accent + "20",
                      borderColor: Colors.accent + "40",
                    },
                  ]}
                  onPress={() => {
                    if (!canAccess("ai_workout")) {
                      router.push("/paywall");
                      return;
                    }
                    setAiModalVisible(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="sparkles" size={14} color={Colors.accent} />
                </TouchableOpacity>
                {activePlanType === "ai" && plan && (
                  <TouchableOpacity
                    style={[
                      styles.iconBtn,
                      {
                        backgroundColor: Colors.primary + "20",
                        borderColor: Colors.primary + "40",
                      },
                    ]}
                    onPress={() => {
                      if (!canAccess("ai_workout")) {
                        router.push("/paywall");
                        return;
                      }
                      handleRegenerate();
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh" size={16} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Active Session Banner */}
            {activeSession && (
              <View
                style={[
                  styles.activeBanner,
                  {
                    backgroundColor: Colors.accentGreen + "15",
                    borderColor: Colors.accentGreen + "40",
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.activeTitle, { color: Colors.accentGreen }]}>Active: {activeSession.workoutDayName}</Text>
                  <Text style={[styles.activeTimer, { color: theme.text }]}>{formatTimer(sessionTimer)}</Text>
                </View>
                <TouchableOpacity style={[styles.finishBtn, { backgroundColor: Colors.accentGreen }]} onPress={handleFinishWorkout} activeOpacity={0.8}>
                  <Text style={styles.finishBtnText}>Finish</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Workout Days */}
            {activeDays.length === 0 ? (
              <View style={[styles.emptyDays, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.emptyDaysText, { color: theme.textMuted }]}>No workout days in this plan.</Text>
              </View>
            ) : (
              activeDays.map((day, dayIdx) => (
                <View key={day.id} style={[styles.dayCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={styles.dayHeader}>
                    <View>
                      <Text style={[styles.dayNumber, { color: theme.textSecondary }]}>Day {dayIdx + 1}</Text>
                      <Text style={[styles.dayName, { color: theme.text }]}>{day.dayName}</Text>
                      <Text style={[styles.dayMeta, { color: theme.textSecondary }]}>
                        {day.exercises.length} exercise
                        {day.exercises.length !== 1 ? "s" : ""}
                        {day.muscleGroups.length > 0 && ` · ${day.muscleGroups.join(", ")}`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.startBtn, activeSession?.workoutDayId === day.id ? { backgroundColor: Colors.accentGreen } : { backgroundColor: Colors.primary }]}
                      onPress={() => {
                        if (activeSession?.workoutDayId === day.id) {
                          setSelectedDay(day);
                        } else {
                          handleStartWorkout(day);
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={activeSession?.workoutDayId === day.id ? "play" : "play-outline"} size={14} color="#000" />
                      <Text style={styles.startBtnText}>{activeSession?.workoutDayId === day.id ? "In Progress" : "Start"}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.exerciseList}>
                    {day.exercises.map((ex) => (
                      <ExerciseCard
                        key={ex.id}
                        exercise={ex}
                        isDark={isDark}
                        onLogSet={(set) => logSet(ex.id, ex.name, set)}
                        personalRecord={getPersonalRecord(ex.id)}
                        lastPerformance={getLastPerformance(ex.id)}
                        isActive={activeSession?.workoutDayId === day.id}
                        onNewPR={(name, weight, reps) => {
                          Alert.alert("New PR!", `${name}: ${weight}kg × ${reps} reps`);
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}

            {/* Custom Plans Management */}
            {customPlans.length > 0 && (
              <View style={styles.customSection}>
                <Text style={[styles.customSectionTitle, { color: theme.textSecondary }]}>CUSTOM PLANS</Text>
                {customPlans.map((cp) => (
                  <View
                    key={cp.id}
                    style={[
                      styles.customPlanRow,
                      {
                        backgroundColor: theme.card,
                        borderColor: activeCustomPlanId === cp.id && activePlanType === "custom" ? Colors.primary : theme.border,
                      },
                    ]}
                  >
                    <TouchableOpacity style={styles.customPlanInfo} onPress={() => setActivePlan("custom", cp.id)} activeOpacity={0.8}>
                      {activeCustomPlanId === cp.id && activePlanType === "custom" && <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.customPlanName, { color: theme.text }]}>{cp.name}</Text>
                        <Text style={[styles.customPlanMeta, { color: theme.textMuted }]}>
                          {cp.days.length} day{cp.days.length !== 1 ? "s" : ""}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingPlan(cp);
                        setShowPlanBuilder(true);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteCustomPlan(cp.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="trash-outline" size={18} color="#FF5252" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {viewMode === "history" && (
          <>
            {sortedSessions.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Ionicons name="time-outline" size={48} color={theme.textMuted} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No Workout History</Text>
                <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Complete workouts to see your training history here.</Text>
              </View>
            ) : (
              <>
                <View style={[styles.historyStats, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={styles.historyStatItem}>
                    <Text style={[styles.historyStatValue, { color: Colors.primary }]}>{sortedSessions.length}</Text>
                    <Text style={[styles.historyStatLabel, { color: theme.textSecondary }]}>Total</Text>
                  </View>
                  <View style={styles.historyStatItem}>
                    <Text style={[styles.historyStatValue, { color: Colors.accentGreen }]}>{sortedSessions.reduce((s, sess) => s + sess.durationMins, 0)}</Text>
                    <Text style={[styles.historyStatLabel, { color: theme.textSecondary }]}>Min</Text>
                  </View>
                  <View style={styles.historyStatItem}>
                    <Text style={[styles.historyStatValue, { color: Colors.accent }]}>{sortedSessions.reduce((s, sess) => s + sess.exerciseLogs.length, 0)}</Text>
                    <Text style={[styles.historyStatLabel, { color: theme.textSecondary }]}>Exercises</Text>
                  </View>
                  <View style={styles.historyStatItem}>
                    <Text style={[styles.historyStatValue, { color: Colors.accentYellow }]}>
                      {Math.round(
                        sortedSessions.reduce(
                          (s, sess) =>
                            s +
                            sess.exerciseLogs
                              .flatMap((l) => l.sets)
                              .filter((st) => st.completed)
                              .reduce((v, st) => v + st.reps * st.weightKg, 0),
                          0,
                        ) / 1000,
                      )}
                      k
                    </Text>
                    <Text style={[styles.historyStatLabel, { color: theme.textSecondary }]}>Volume</Text>
                  </View>
                </View>

                {dateGroups.map((date) => (
                  <View key={date} style={{ gap: 8 }}>
                    <Text style={[styles.dateHeader, { color: theme.textSecondary }]}>{formatDate(date)}</Text>
                    {groupedSessions[date].map((session) => {
                      const isExpanded = expandedSessionId === session.id;
                      const totalVolume = session.exerciseLogs
                        .flatMap((l) => l.sets)
                        .filter((s) => s.completed)
                        .reduce((sum, s) => sum + s.reps * s.weightKg, 0);
                      return (
                        <TouchableOpacity
                          key={session.id}
                          style={[
                            styles.historyCard,
                            {
                              backgroundColor: theme.card,
                              borderColor: theme.border,
                            },
                          ]}
                          onPress={() => setExpandedSessionId(isExpanded ? null : session.id)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.historyCardHeader}>
                            <View style={[styles.historyIcon, { backgroundColor: Colors.primary + "15" }]}>
                              <Ionicons name="barbell" size={18} color={Colors.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.historyName, { color: theme.text }]}>{session.workoutDayName}</Text>
                              <View style={styles.historyMeta}>
                                <View style={styles.historyMetaItem}>
                                  <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                                  <Text style={[styles.historyMetaText, { color: theme.textSecondary }]}>{session.durationMins} min</Text>
                                </View>
                                <View style={styles.historyMetaItem}>
                                  <Ionicons name="fitness-outline" size={12} color={theme.textSecondary} />
                                  <Text style={[styles.historyMetaText, { color: theme.textSecondary }]}>{session.exerciseLogs.length} exercises</Text>
                                </View>
                                {totalVolume > 0 && (
                                  <View style={styles.historyMetaItem}>
                                    <Ionicons name="trending-up" size={12} color={theme.textSecondary} />
                                    <Text style={[styles.historyMetaText, { color: theme.textSecondary }]}>
                                      {totalVolume > 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : totalVolume} kg
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
                          </View>

                          {isExpanded && session.exerciseLogs.length > 0 && (
                            <View style={[styles.historyDetails, { borderTopColor: theme.border }]}>
                              {session.exerciseLogs.map((log, idx) => (
                                <View key={idx} style={styles.historyExercise}>
                                  <Text style={[styles.historyExName, { color: theme.text }]}>{log.exerciseName}</Text>
                                  <View style={styles.historySets}>
                                    {log.sets
                                      .filter((s) => s.completed)
                                      .map((set, sIdx) => (
                                        <View
                                          key={sIdx}
                                          style={[
                                            styles.historySet,
                                            {
                                              backgroundColor: isDark ? "#1A1A24" : "#F0F0F8",
                                            },
                                          ]}
                                        >
                                          <Text style={[styles.historySetText, { color: theme.text }]}>
                                            {set.weightKg}kg × {set.reps}
                                          </Text>
                                        </View>
                                      ))}
                                    {log.sets.filter((s) => s.completed).length === 0 && <Text style={[styles.historyMetaText, { color: theme.textMuted }]}>No sets logged</Text>}
                                  </View>
                                </View>
                              ))}
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Plan Switcher Modal */}
      {showPlanSwitcher && (
        <View style={styles.switcherOverlay}>
          <TouchableOpacity style={styles.switcherBackdrop} onPress={() => setShowPlanSwitcher(false)} />
          <View style={[styles.switcherSheet, { backgroundColor: theme.card }]}>
            <Text style={[styles.switcherTitle, { color: theme.text }]}>Choose Active Plan</Text>

            {plan && (
              <TouchableOpacity
                style={[
                  styles.switcherOption,
                  {
                    borderColor: activePlanType === "ai" ? Colors.primary : theme.border,
                  },
                ]}
                onPress={() => {
                  setActivePlan("ai");
                  setShowPlanSwitcher(false);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.switcherIcon, { backgroundColor: Colors.primary + "20" }]}>
                  <Ionicons name="sparkles" size={16} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switcherOptionName, { color: theme.text }]}>{plan.name}</Text>
                  <Text style={[styles.switcherOptionMeta, { color: theme.textMuted }]}>AI Generated · {plan.days.length} days</Text>
                </View>
                {activePlanType === "ai" && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
              </TouchableOpacity>
            )}

            {customPlans.map((cp) => (
              <TouchableOpacity
                key={cp.id}
                style={[
                  styles.switcherOption,
                  {
                    borderColor: activePlanType === "custom" && activeCustomPlanId === cp.id ? Colors.primary : theme.border,
                  },
                ]}
                onPress={() => {
                  setActivePlan("custom", cp.id);
                  setShowPlanSwitcher(false);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.switcherIcon, { backgroundColor: "#A78BFA20" }]}>
                  <Ionicons name="list" size={16} color="#A78BFA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switcherOptionName, { color: theme.text }]}>{cp.name}</Text>
                  <Text style={[styles.switcherOptionMeta, { color: theme.textMuted }]}>Custom · {cp.days.length} days</Text>
                </View>
                {activePlanType === "custom" && activeCustomPlanId === cp.id && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.switcherNewBtn, { borderColor: theme.border }]}
              onPress={() => {
                setShowPlanSwitcher(false);
                setEditingPlan(undefined);
                setShowPlanBuilder(true);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={16} color={theme.textSecondary} />
              <Text style={[styles.switcherNewBtnText, { color: theme.textSecondary }]}>New Custom Plan</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <AIGenerateModal
        visible={aiModalVisible}
        onClose={() => setAiModalVisible(false)}
        planType={aiPlanType}
        setPlanType={setAiPlanType}
        onGenerate={handleAIGenerate}
        loading={aiLoading}
        theme={theme}
        isDark={isDark}
        preferences={aiPreferences}
        setPreferences={setAiPreferences}
      />

      <ExerciseLibraryScreen visible={showLibrary} onClose={() => setShowLibrary(false)} userEquipment={appState.profile?.equipment ?? []} />

      <CustomPlanBuilderScreen
        visible={showPlanBuilder}
        onClose={() => {
          setShowPlanBuilder(false);
          setEditingPlan(undefined);
        }}
        onSave={(planData) => {
          if (editingPlan) {
            updateCustomPlan({ ...editingPlan, ...planData });
          } else {
            const saved = addCustomPlan(planData);
            setActivePlan("custom", saved.id);
          }
        }}
        existingPlan={editingPlan}
        userEquipment={appState.profile?.equipment ?? []}
      />
    </View>
  );
}

function AIGenerateModal({ visible, onClose, planType, setPlanType, onGenerate, loading, theme, isDark, preferences, setPreferences }: any) {
  const BODY_PARTS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Glutes", "Core", "Full Body"];

  const toggleBodyPart = (part: string) => {
    const current = preferences.bodyParts || [];
    if (current.includes(part)) {
      setPreferences({
        ...preferences,
        bodyParts: current.filter((p: string) => p !== part),
      });
    } else {
      setPreferences({ ...preferences, bodyParts: [...current, part] });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: theme.surface, maxHeight: "85%" }]}>
          <View style={styles.modalHandle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>AI Workout Generator</Text>
            <Text style={[styles.modalDesc, { color: theme.textSecondary }]}>Tell us what you want to train and we'll build a plan just for you.</Text>

            <Text style={[styles.modalLabel, { color: theme.textSecondary }]}>Plan Type</Text>
            <View style={[styles.toggleRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <TouchableOpacity style={[styles.toggleBtn, planType === "daily" && { backgroundColor: Colors.primary }]} onPress={() => setPlanType("daily")} activeOpacity={0.8}>
                <Ionicons name="today-outline" size={16} color={planType === "daily" ? "#000" : theme.textSecondary} />
                <Text
                  style={[
                    styles.toggleText,
                    {
                      color: planType === "daily" ? "#000" : theme.textSecondary,
                    },
                  ]}
                >
                  Single Day
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  planType === "scheduled" && {
                    backgroundColor: Colors.primary,
                  },
                ]}
                onPress={() => setPlanType("scheduled")}
                activeOpacity={0.8}
              >
                <Ionicons name="calendar-outline" size={16} color={planType === "scheduled" ? "#000" : theme.textSecondary} />
                <Text
                  style={[
                    styles.toggleText,
                    {
                      color: planType === "scheduled" ? "#000" : theme.textSecondary,
                    },
                  ]}
                >
                  Full Week
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalLabel, { color: theme.textSecondary, marginTop: 12 }]}>Target Body Parts</Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              {BODY_PARTS.map((part) => {
                const selected = (preferences.bodyParts || []).includes(part);
                return (
                  <TouchableOpacity
                    key={part}
                    onPress={() => toggleBodyPart(part)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: selected ? Colors.primary : theme.card,
                      borderWidth: 1,
                      borderColor: selected ? Colors.primary : theme.border,
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular",
                        color: selected ? "#000" : theme.textSecondary,
                      }}
                    >
                      {part}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.modalLabel, { color: theme.textSecondary }]}>Your Preferences</Text>
            <View style={[styles.aiInputBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <TextInput
                style={[styles.aiInput, { color: theme.text }]}
                placeholder="E.g. I want heavy compound lifts, no machines, focus on strength. I have dumbbells and a barbell..."
                placeholderTextColor={theme.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                value={preferences.message || ""}
                onChangeText={(text: string) => setPreferences({ ...preferences, message: text })}
              />
            </View>

            <View style={[styles.infoBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="sparkles" size={16} color={Colors.accent} />
              <Text style={[styles.infoText, { color: theme.textSecondary }]}>
                {planType === "daily" ? "Generates one optimized workout based on your preferences." : "Creates a full weekly split tailored to your goals."}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: Colors.accent, opacity: loading ? 0.7 : 1 }]}
              onPress={onGenerate}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color="#000" />
                  <Text style={styles.generateBtnText}>Generate with AI</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, paddingHorizontal: 20, gap: 16 },
  emptyHeader: { alignItems: "center", marginBottom: 8, gap: 6 },
  emptyTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
  },
  optionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: { flex: 1, gap: 4 },
  optionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  optionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  quickGenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickGenText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  freeWorkoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  freeWorkoutBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  viewToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  viewToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  historyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  historyBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  planNameRow: { flex: 1 },
  planName: { fontSize: 19, fontFamily: "Inter_700Bold" },
  planSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },
  planMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  switchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  switchBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingTop: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  activeTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeTimer: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  finishBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  finishBtnText: { color: "#000", fontSize: 14, fontFamily: "Inter_700Bold" },
  dayCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
  },
  dayNumber: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dayName: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 2 },
  dayMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
    textTransform: "capitalize",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  startBtnText: { color: "#000", fontSize: 13, fontFamily: "Inter_700Bold" },
  exerciseList: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  emptyDays: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
  },
  emptyDaysText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  customSection: { gap: 8, marginTop: 4 },
  customSectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 2,
  },
  customPlanRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  customPlanInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  customPlanName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  customPlanMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  historyEmpty: { alignItems: "center", gap: 12, paddingVertical: 60 },
  historyStats: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  historyStatItem: { flex: 1, alignItems: "center", gap: 2 },
  historyStatValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  historyStatLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateHeader: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  historyCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  historyCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  historyName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  historyMeta: {
    flexDirection: "row",
    gap: 12,
    marginTop: 3,
    flexWrap: "wrap",
  },
  historyMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyMetaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  historyDetails: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
    gap: 10,
  },
  historyExercise: { gap: 4 },
  historyExName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  historySets: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  historySet: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  historySetText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  switcherOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
  switcherBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  switcherSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
    paddingBottom: 36,
  },
  switcherTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  switcherOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  switcherIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  switcherOptionName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  switcherOptionMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  switcherNewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 4,
  },
  switcherNewBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000060",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#444",
    alignSelf: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  modalDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  modalLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: 14,
    marginTop: 4,
  },
  generateBtnText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
  aiInputBox: { borderRadius: 12, borderWidth: 1, padding: 12, minHeight: 100 },
  aiInput: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    minHeight: 80,
  },
});
