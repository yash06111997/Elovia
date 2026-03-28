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
  ActivityIndicator,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout, WorkoutDay, CustomWorkoutPlan } from "@/context/WorkoutContext";
import { useApp } from "@/context/AppContext";
import { ExerciseCard } from "@/components/ExerciseCard";
import { generateWorkoutPlan } from "@/utils/aiEngine";
import { generateAIWorkout } from "@/utils/api";
import { Colors } from "@/constants/colors";
import { ExerciseLibraryScreen } from "@/screens/ExerciseLibraryScreen";
import { CustomPlanBuilderScreen } from "@/screens/CustomPlanBuilderScreen";

export default function WorkoutsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const {
    plan,
    setPlan,
    activeSession,
    startSession,
    logSet,
    completeSession,
    getPersonalRecord,
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

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;
  const activeDays = getActivePlanDays();

  const activeCustomPlan = customPlans.find((p) => p.id === activeCustomPlanId) ?? null;
  const displayPlanName =
    activePlanType === "custom" && activeCustomPlan
      ? activeCustomPlan.name
      : plan
      ? plan.name
      : "No Plan";

  const handleStartWorkout = (day: WorkoutDay) => {
    startSession(day);
    setSelectedDay(day);
    const interval = setInterval(() => setSessionTimer((t) => t + 1), 1000);
    setTimerInterval(interval);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleFinishWorkout = () => {
    if (timerInterval) clearInterval(timerInterval);
    const durationMins = Math.round(sessionTimer / 60);
    completeSession(durationMins);
    setSelectedDay(null);
    setSessionTimer(0);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      const result = await generateAIWorkout(appState.profile, aiPlanType);
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
      Alert.alert("Error", e.message || "Failed to generate AI workout plan.");
    } finally {
      setAiLoading(false);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
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

  if (noPlan) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: topPadding }]}>
        <Ionicons name="barbell-outline" size={64} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No Workout Plan</Text>
        <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Generate a plan using local engine or AI, or build your own.</Text>
        <View style={styles.emptyActions}>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: Colors.primary }]}
            onPress={handleRegenerate}
            activeOpacity={0.8}
          >
            <Ionicons name="flash-outline" size={16} color="#000" />
            <Text style={styles.emptyBtnText}>Quick Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: Colors.accent }]}
            onPress={() => setAiModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="sparkles" size={16} color="#000" />
            <Text style={styles.emptyBtnText}>AI Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: "#A78BFA" }]}
            onPress={() => { setEditingPlan(undefined); setShowPlanBuilder(true); }}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={16} color="#000" />
            <Text style={styles.emptyBtnText}>Custom Plan</Text>
          </TouchableOpacity>
        </View>

        <AIGenerateModal
          visible={aiModalVisible}
          onClose={() => setAiModalVisible(false)}
          planType={aiPlanType}
          setPlanType={setAiPlanType}
          onGenerate={handleAIGenerate}
          loading={aiLoading}
          theme={theme}
          isDark={isDark}
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
        contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan Header */}
        <View style={styles.planHeader}>
          <TouchableOpacity
            style={styles.planNameRow}
            onPress={() => setShowPlanSwitcher(true)}
            activeOpacity={0.8}
          >
            <View>
              <Text style={[styles.planName, { color: theme.text }]} numberOfLines={1}>{displayPlanName}</Text>
              <View style={styles.planSubRow}>
                <Text style={[styles.planMeta, { color: theme.textSecondary }]}>
                  {activeDays.length} training day{activeDays.length !== 1 ? "s" : ""}
                </Text>
                {(customPlans.length > 0 || plan) ? (
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
              style={[styles.iconBtn, { backgroundColor: isDark ? "#1A1A24" : "#EDEDF5", borderColor: theme.border }]}
              onPress={() => setShowLibrary(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="search" size={16} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: isDark ? "#1A1A24" : "#EDEDF5", borderColor: theme.border }]}
              onPress={() => { setEditingPlan(undefined); setShowPlanBuilder(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={18} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20", borderColor: Colors.accent + "40" }]}
              onPress={() => setAiModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={14} color={Colors.accent} />
            </TouchableOpacity>
            {activePlanType === "ai" && plan && (
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
                onPress={handleRegenerate}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={16} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Active Session Banner */}
        {activeSession && (
          <View style={[styles.activeBanner, { backgroundColor: Colors.accentGreen + "15", borderColor: Colors.accentGreen + "40" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.activeTitle, { color: Colors.accentGreen }]}>
                Active: {activeSession.workoutDayName}
              </Text>
              <Text style={[styles.activeTimer, { color: theme.text }]}>{formatTimer(sessionTimer)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.finishBtn, { backgroundColor: Colors.accentGreen }]}
              onPress={handleFinishWorkout}
              activeOpacity={0.8}
            >
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
                    {day.exercises.length} exercise{day.exercises.length !== 1 ? "s" : ""}
                    {day.muscleGroups.length > 0 && ` · ${day.muscleGroups.join(", ")}`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.startBtn,
                    activeSession?.workoutDayId === day.id
                      ? { backgroundColor: Colors.accentGreen }
                      : { backgroundColor: Colors.primary },
                  ]}
                  onPress={() => {
                    if (activeSession?.workoutDayId === day.id) {
                      setSelectedDay(day);
                    } else {
                      handleStartWorkout(day);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={activeSession?.workoutDayId === day.id ? "play" : "play-outline"}
                    size={14}
                    color="#000"
                  />
                  <Text style={styles.startBtnText}>
                    {activeSession?.workoutDayId === day.id ? "In Progress" : "Start"}
                  </Text>
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
                    isActive={activeSession?.workoutDayId === day.id}
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
              <View key={cp.id} style={[styles.customPlanRow, { backgroundColor: theme.card, borderColor: activeCustomPlanId === cp.id && activePlanType === "custom" ? Colors.primary : theme.border }]}>
                <TouchableOpacity
                  style={styles.customPlanInfo}
                  onPress={() => setActivePlan("custom", cp.id)}
                  activeOpacity={0.8}
                >
                  {activeCustomPlanId === cp.id && activePlanType === "custom" && (
                    <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.customPlanName, { color: theme.text }]}>{cp.name}</Text>
                    <Text style={[styles.customPlanMeta, { color: theme.textMuted }]}>
                      {cp.days.length} day{cp.days.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setEditingPlan(cp); setShowPlanBuilder(true); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteCustomPlan(cp.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={18} color="#FF5252" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
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
                style={[styles.switcherOption, { borderColor: activePlanType === "ai" ? Colors.primary : theme.border }]}
                onPress={() => { setActivePlan("ai"); setShowPlanSwitcher(false); }}
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
                style={[styles.switcherOption, { borderColor: activePlanType === "custom" && activeCustomPlanId === cp.id ? Colors.primary : theme.border }]}
                onPress={() => { setActivePlan("custom", cp.id); setShowPlanSwitcher(false); }}
                activeOpacity={0.8}
              >
                <View style={[styles.switcherIcon, { backgroundColor: "#A78BFA20" }]}>
                  <Ionicons name="list" size={16} color="#A78BFA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switcherOptionName, { color: theme.text }]}>{cp.name}</Text>
                  <Text style={[styles.switcherOptionMeta, { color: theme.textMuted }]}>Custom · {cp.days.length} days</Text>
                </View>
                {activePlanType === "custom" && activeCustomPlanId === cp.id && (
                  <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.switcherNewBtn, { borderColor: theme.border }]}
              onPress={() => { setShowPlanSwitcher(false); setEditingPlan(undefined); setShowPlanBuilder(true); }}
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
      />

      <ExerciseLibraryScreen
        visible={showLibrary}
        onClose={() => setShowLibrary(false)}
        userEquipment={appState.profile?.equipment ?? []}
      />

      <CustomPlanBuilderScreen
        visible={showPlanBuilder}
        onClose={() => { setShowPlanBuilder(false); setEditingPlan(undefined); }}
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

function AIGenerateModal({ visible, onClose, planType, setPlanType, onGenerate, loading, theme, isDark }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: theme.surface }]}>
          <View style={styles.modalHandle} />
          <Text style={[styles.modalTitle, { color: theme.text }]}>AI Workout Generator</Text>
          <Text style={[styles.modalDesc, { color: theme.textSecondary }]}>
            Create a personalized plan using AI based on your profile, goals, and equipment.
          </Text>

          <Text style={[styles.modalLabel, { color: theme.textSecondary }]}>Plan Type</Text>
          <View style={[styles.toggleRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.toggleBtn, planType === "daily" && { backgroundColor: Colors.primary }]}
              onPress={() => setPlanType("daily")}
              activeOpacity={0.8}
            >
              <Ionicons name="today-outline" size={16} color={planType === "daily" ? "#000" : theme.textSecondary} />
              <Text style={[styles.toggleText, { color: planType === "daily" ? "#000" : theme.textSecondary }]}>
                Single Day
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, planType === "scheduled" && { backgroundColor: Colors.primary }]}
              onPress={() => setPlanType("scheduled")}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={16} color={planType === "scheduled" ? "#000" : theme.textSecondary} />
              <Text style={[styles.toggleText, { color: planType === "scheduled" ? "#000" : theme.textSecondary }]}>
                Full Week
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.infoBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="sparkles" size={16} color={Colors.accent} />
            <Text style={[styles.infoText, { color: theme.textSecondary }]}>
              {planType === "daily"
                ? "Generates one optimized workout based on your goal and equipment."
                : "Creates a full weekly split with progressive overload built in."}
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyActions: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap", justifyContent: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: "#000", fontSize: 14, fontFamily: "Inter_700Bold" },
  createPlanBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, marginTop: 8 },
  createPlanBtnText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  planNameRow: { flex: 1 },
  planName: { fontSize: 19, fontFamily: "Inter_700Bold" },
  planSubRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  planMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  switchBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  switchBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center", paddingTop: 2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  activeBanner: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  activeTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeTimer: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  finishBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  finishBtnText: { color: "#000", fontSize: 14, fontFamily: "Inter_700Bold" },
  dayCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 14 },
  dayNumber: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  dayName: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 2 },
  dayMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, textTransform: "capitalize" },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  startBtnText: { color: "#000", fontSize: 13, fontFamily: "Inter_700Bold" },
  exerciseList: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
  emptyDays: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: "center" },
  emptyDaysText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  customSection: { gap: 8, marginTop: 4 },
  customSectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 2 },
  customPlanRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  customPlanInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  customPlanName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  customPlanMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  switcherOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  switcherBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  switcherSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
    paddingBottom: 36,
  },
  switcherTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  switcherOption: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  switcherIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  switcherOptionName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  switcherOptionMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  switcherNewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", marginTop: 4 },
  switcherNewBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, backgroundColor: "#00000060", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalDesc: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  modalLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  toggleRow: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 9 },
  toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 14, marginTop: 4 },
  generateBtnText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
});
