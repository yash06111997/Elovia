import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Modal,
  useColorScheme,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout, WorkoutDay } from "@/context/WorkoutContext";
import { useApp } from "@/context/AppContext";
import { ExerciseCard } from "@/components/ExerciseCard";
import { generateWorkoutPlan } from "@/utils/aiEngine";
import { generateAIWorkout } from "@/utils/api";
import { Colors } from "@/constants/colors";

export default function WorkoutsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { plan, setPlan, activeSession, startSession, logSet, completeSession, getPersonalRecord } = useWorkout();
  const { state: appState } = useApp();
  const [selectedDay, setSelectedDay] = useState<WorkoutDay | null>(null);
  const [sessionTimer, setSessionTimer] = useState(0);
  const [timerInterval, setTimerInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiPlanType, setAiPlanType] = useState<"daily" | "scheduled">("daily");
  const [aiLoading, setAiLoading] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top + 12;

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
        daysPerWeek: result.days.length,
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
        createdAt: new Date().toISOString(),
      });
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

  if (!plan) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background, paddingTop: topPadding }]}>
        <Ionicons name="barbell-outline" size={64} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No Workout Plan</Text>
        <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Generate a plan using local engine or AI.</Text>
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
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.planHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.planName, { color: theme.text }]}>{plan.name}</Text>
            <Text style={[styles.planMeta, { color: theme.textSecondary }]}>
              {plan.days.length} training days
            </Text>
          </View>
          <View style={styles.planActions}>
            <TouchableOpacity
              style={[styles.regenBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
              onPress={handleRegenerate}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh" size={14} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.regenBtn, { backgroundColor: Colors.accent + "20", borderColor: Colors.accent + "40" }]}
              onPress={() => setAiModalVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="sparkles" size={14} color={Colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

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

        {plan.days.map((day, dayIdx) => (
          <View key={day.id} style={[styles.dayCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.dayHeader}>
              <View>
                <Text style={[styles.dayNumber, { color: theme.textSecondary }]}>Day {dayIdx + 1}</Text>
                <Text style={[styles.dayName, { color: theme.text }]}>{day.dayName}</Text>
                <Text style={[styles.dayMeta, { color: theme.textSecondary }]}>
                  {day.exercises.length} exercises • {day.muscleGroups.join(", ")}
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
        ))}
      </ScrollView>

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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: "#000", fontSize: 14, fontFamily: "Inter_700Bold" },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  planActions: { flexDirection: "row", gap: 8 },
  planName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  planMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  regenBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  regenText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeBanner: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  activeTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeTimer: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  finishBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  finishBtnText: { color: "#000", fontSize: 14, fontFamily: "Inter_700Bold" },
  dayCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 14 },
  dayNumber: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  dayName: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 2 },
  dayMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  startBtnText: { color: "#000", fontSize: 13, fontFamily: "Inter_700Bold" },
  exerciseList: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },
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
