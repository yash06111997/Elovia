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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useWorkout, WorkoutDay } from "@/context/WorkoutContext";
import { useApp } from "@/context/AppContext";
import { ExerciseCard } from "@/components/ExerciseCard";
import { generateWorkoutPlan } from "@/utils/aiEngine";
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
        <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>Complete onboarding to generate your personalized plan.</Text>
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
          <View>
            <Text style={[styles.planName, { color: theme.text }]}>{plan.name}</Text>
            <Text style={[styles.planMeta, { color: theme.textSecondary }]}>
              {plan.days.length} training days
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.regenBtn, { backgroundColor: Colors.primary + "20", borderColor: Colors.primary + "40" }]}
            onPress={handleRegenerate}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={16} color={Colors.primary} />
            <Text style={[styles.regenText, { color: Colors.primary }]}>Regenerate</Text>
          </TouchableOpacity>
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

            {/* Exercise List (collapsed by default) */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  planName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  planMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  regenBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
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
});
