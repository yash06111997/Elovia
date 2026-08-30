import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Alert, KeyboardAvoidingView, Keyboard, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useWorkout, SetType, type WorkoutFeedback } from "@/context/WorkoutContext";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { allExercises, ExerciseEntry } from "@/utils/exerciseDatabase";
import { trackEvent } from "@/lib/telemetry";

const SET_TYPE_LABELS: Record<SetType, { label: string; color: string; short: string }> = {
  normal: { label: "Normal", color: Colors.primary, short: "" },
  warmup: { label: "Warm-up", color: Colors.accentYellow, short: "W" },
  dropset: { label: "Drop Set", color: Colors.accent, short: "D" },
  failure: { label: "To Failure", color: Colors.accentRed, short: "F" },
};

export default function LogWorkoutScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    checkIn?: string;
    elapsedSeconds?: string;
  }>();
  const {
    activeSession,
    startFreeSession,
    addExerciseToSession,
    addSetToExercise,
    updateSetInExercise,
    removeSetFromExercise,
    removeExerciseFromSession,
    completeSession,
    cancelSession,
    getPersonalRecord,
    getLastPerformance,
  } = useWorkout();

  const initialSeconds = Number.parseInt(params.elapsedSeconds ?? "0", 10);
  const [timer, setTimer] = useState(Number.isFinite(initialSeconds) ? initialSeconds : 0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showExerciseSearch, setShowExerciseSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [effort, setEffort] = useState(7);
  const [pain, setPain] = useState(0);
  const [enjoyment, setEnjoyment] = useState(4);
  const [readiness, setReadiness] = useState(3);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!activeSession) {
      startFreeSession();
    }
    timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    if (params.checkIn === "1" && activeSession) setFeedbackVisible(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const filteredExercises =
    searchQuery.length > 0
      ? allExercises.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.muscleGroup.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20)
      : [];

  const handleAddExercise = (entry: ExerciseEntry) => {
    addExerciseToSession(entry.name, entry.id);
    setShowExerciseSearch(false);
    setSearchQuery("");
    const newIndex = activeSession?.exerciseLogs.length ?? 0;
    setExpandedExercise(newIndex);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddCustomExercise = () => {
    if (!searchQuery.trim()) return;
    addExerciseToSession(searchQuery.trim());
    setShowExerciseSearch(false);
    const newIndex = activeSession?.exerciseLogs.length ?? 0;
    setExpandedExercise(newIndex);
    setSearchQuery("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleFinish = () => {
    if (!activeSession) return;
    const totalSets = activeSession.exerciseLogs.reduce((sum, l) => sum + l.sets.filter((s) => s.completed).length, 0);
    if (totalSets === 0 && activeSession.exerciseLogs.length === 0) {
      Alert.alert("Empty Workout", "Add some exercises and log sets before finishing.", [{ text: "OK" }]);
      return;
    }
    setFeedbackVisible(true);
  };

  const submitFeedback = () => {
    const durationMins = Math.max(1, Math.round(timer / 60));
    const feedback: WorkoutFeedback = { effort, pain, enjoyment, readiness };
    const adjustment = completeSession(durationMins, feedback);
    void trackEvent("workout_feedback_submitted", {
      direction: adjustment?.direction ?? "unknown",
      painBand: pain >= 7 ? "high" : pain >= 4 ? "moderate" : "low",
    });
    setFeedbackVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Workout saved", adjustment?.summary ?? "Your session and feedback were saved.", [{ text: "Done", onPress: () => router.back() }]);
  };

  const handleCancel = () => {
    Alert.alert("Discard Workout?", "This workout won't be saved.", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          cancelSession();
          router.back();
        },
      },
    ]);
  };

  const exercises = activeSession?.exerciseLogs ?? [];

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Platform.OS === "web" ? 16 : insets.top + 4,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Discard workout" onPress={handleCancel} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={Colors.accentRed} />
        </TouchableOpacity>
        <View style={styles.timerContainer}>
          <Ionicons name="timer-outline" size={18} color={Colors.primary} />
          <Text style={[styles.timerText, { color: theme.text }]}>{formatTime(timer)}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Finish workout" onPress={handleFinish} style={[styles.finishBtn]}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.finishBtnText}>Finish</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollArea}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        {exercises.length === 0 && !showExerciseSearch && (
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.textSecondary }]}>Start Your Workout</Text>
            <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>Tap "Add Exercise" below to begin logging</Text>
          </View>
        )}

        {exercises.map((log, exIdx) => (
          <ExerciseLogCard
            key={`${log.exerciseId}-${exIdx}`}
            log={log}
            exerciseIndex={exIdx}
            isExpanded={expandedExercise === exIdx}
            onToggle={() => setExpandedExercise(expandedExercise === exIdx ? null : exIdx)}
            onAddSet={(set) => addSetToExercise(exIdx, set)}
            onUpdateSet={(setIdx, update) => updateSetInExercise(exIdx, setIdx, update)}
            onRemoveSet={(setIdx) => removeSetFromExercise(exIdx, setIdx)}
            onRemoveExercise={() => {
              Alert.alert("Remove Exercise", `Remove ${log.exerciseName}?`, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: () => removeExerciseFromSession(exIdx),
                },
              ]);
            }}
            personalRecord={getPersonalRecord(log.exerciseId)}
            lastPerformance={getLastPerformance(log.exerciseId)}
            theme={theme}
            isDark={isDark}
          />
        ))}

        {showExerciseSearch && (
          <View
            style={[
              styles.searchCard,
              {
                backgroundColor: theme.card,
                borderColor: Colors.primary + "40",
              },
            ]}
          >
            <View style={styles.searchHeader}>
              <Text style={[styles.searchTitle, { color: theme.text }]}>Add Exercise</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowExerciseSearch(false);
                  setSearchQuery("");
                }}
              >
                <Ionicons name="close-circle" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.searchInputRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Ionicons name="search" size={18} color={theme.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search or type exercise name..."
                placeholderTextColor={theme.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleAddCustomExercise}
              />
            </View>

            {searchQuery.length > 0 && (
              <TouchableOpacity style={[styles.customExerciseBtn, { borderColor: Colors.primary + "40" }]} onPress={handleAddCustomExercise}>
                <Ionicons name="add-circle" size={20} color={Colors.primary} />
                <Text style={[styles.customExerciseText, { color: Colors.primary }]}>Add "{searchQuery}" as custom exercise</Text>
              </TouchableOpacity>
            )}

            <ScrollView style={styles.searchResults} keyboardShouldPersistTaps="handled">
              {filteredExercises.map((entry) => (
                <TouchableOpacity key={entry.id} style={[styles.searchResultItem, { borderBottomColor: theme.border }]} onPress={() => handleAddExercise(entry)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.searchResultName, { color: theme.text }]}>{entry.name}</Text>
                    <Text style={[styles.searchResultMeta, { color: theme.textSecondary }]}>
                      {entry.muscleGroup} · {entry.equipment.join(", ")}
                    </Text>
                  </View>
                  <Ionicons name="add" size={22} color={Colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {!showExerciseSearch && (
        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: insets.bottom + 12,
              backgroundColor: theme.background,
              borderTopColor: theme.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.addExerciseBtn,
              {
                backgroundColor: Colors.primary + "15",
                borderColor: Colors.primary + "40",
              },
            ]}
            onPress={() => setShowExerciseSearch(true)}
          >
            <Ionicons name="add-circle" size={22} color={Colors.primary} />
            <Text style={[styles.addExerciseBtnText, { color: Colors.primary }]}>Add Exercise</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={feedbackVisible} transparent animationType="slide" onRequestClose={() => setFeedbackVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.feedbackCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.feedbackContent, { paddingBottom: insets.bottom + 18 }]}>
              <View style={styles.feedbackHandle} />
              <Text accessibilityRole="header" style={[styles.feedbackTitle, { color: theme.text }]}>
                Post-workout check-in
              </Text>
              <Text style={[styles.feedbackSubtitle, { color: theme.textSecondary }]}>Your answers create a conservative recommendation for your next session. Pain always takes priority over progression.</Text>
              <RatingRow label="How hard was it?" value={effort} min={1} max={10} onChange={setEffort} theme={theme} low="Easy" high="Max" />
              <RatingRow label="Pain during training" value={pain} min={0} max={10} onChange={setPain} theme={theme} low="None" high="Severe" />
              <RatingRow label="Enjoyment" value={enjoyment} min={1} max={5} onChange={setEnjoyment} theme={theme} low="Low" high="High" />
              <RatingRow label="Ready for next time?" value={readiness} min={1} max={5} onChange={setReadiness} theme={theme} low="Not ready" high="Ready" />
              {pain >= 7 && (
                <View style={styles.painNotice}>
                  <Ionicons name="warning-outline" size={18} color={Colors.accentRed} />
                  <Text style={styles.painNoticeText}>Stop or modify movements that cause sharp or persistent pain. Consider qualified medical assessment.</Text>
                </View>
              )}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save workout feedback" style={styles.saveFeedbackBtn} onPress={submitFeedback}>
                <Text style={styles.saveFeedbackText}>Save Workout</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Keep training" style={styles.keepTrainingBtn} onPress={() => setFeedbackVisible(false)}>
                <Text style={[styles.keepTrainingText, { color: theme.textSecondary }]}>Keep training</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function RatingRow({
  label,
  value,
  min,
  max,
  onChange,
  theme,
  low,
  high,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  theme: any;
  low: string;
  high: string;
}) {
  return (
    <View style={styles.ratingSection}>
      <View style={styles.ratingHeader}>
        <Text style={[styles.ratingLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.ratingValue, { color: Colors.primary }]}>{value}</Text>
      </View>
      <View style={styles.ratingButtons}>
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((option) => (
          <TouchableOpacity
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${option}`}
            accessibilityState={{ checked: option === value }}
            onPress={() => onChange(option)}
            style={[
              styles.ratingButton,
              {
                backgroundColor: option === value ? Colors.primary : theme.surface,
                borderColor: option === value ? Colors.primary : theme.border,
              },
            ]}
          >
            <Text style={[styles.ratingButtonText, { color: option === value ? "#000" : theme.textSecondary }]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.scaleLabels}>
        <Text style={[styles.scaleText, { color: theme.textMuted }]}>{low}</Text>
        <Text style={[styles.scaleText, { color: theme.textMuted }]}>{high}</Text>
      </View>
    </View>
  );
}

interface ExerciseLogCardProps {
  log: { exerciseId: string; exerciseName: string; sets: any[] };
  exerciseIndex: number;
  isExpanded: boolean;
  onToggle: () => void;
  onAddSet: (set: any) => void;
  onUpdateSet: (setIdx: number, update: any) => void;
  onRemoveSet: (setIdx: number) => void;
  onRemoveExercise: () => void;
  personalRecord: any;
  lastPerformance: any;
  theme: any;
  isDark: boolean;
}

function ExerciseLogCard({
  log,
  exerciseIndex,
  isExpanded,
  onToggle,
  onAddSet,
  onUpdateSet,
  onRemoveSet,
  onRemoveExercise,
  personalRecord,
  lastPerformance,
  theme,
  isDark,
}: ExerciseLogCardProps) {
  const [weightInput, setWeightInput] = useState("");
  const [repsInput, setRepsInput] = useState("");
  const [selectedSetType, setSelectedSetType] = useState<SetType>("normal");
  const weightRef = useRef<TextInput>(null);
  const completedSets = log.sets.filter((s: any) => s.completed).length;
  const totalVolume = log.sets.filter((s: any) => s.completed).reduce((sum: number, s: any) => sum + s.weightKg * s.reps, 0);

  const handleAddSet = () => {
    const weight = parseFloat(weightInput) || 0;
    const reps = parseInt(repsInput) || 0;
    if (reps === 0) {
      Alert.alert("Enter Reps", "Please enter the number of reps.");
      return;
    }
    onAddSet({
      reps,
      weightKg: weight,
      completed: true,
      setType: selectedSetType,
    });
    setWeightInput("");
    setRepsInput("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    weightRef.current?.focus();
  };

  const handleQuickAdd = (type: SetType) => {
    setSelectedSetType(type);
  };

  return (
    <View style={[styles.exerciseCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <TouchableOpacity style={styles.exerciseHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.exerciseName, { color: theme.text }]}>{log.exerciseName}</Text>
          <Text style={[styles.exerciseMeta, { color: theme.textSecondary }]}>
            {completedSets} set{completedSets !== 1 ? "s" : ""}
            {totalVolume > 0 ? ` · ${totalVolume.toLocaleString()} kg vol` : ""}
          </Text>
        </View>
        <TouchableOpacity onPress={onRemoveExercise} style={styles.removeExBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="trash-outline" size={18} color={Colors.accentRed + "80"} />
        </TouchableOpacity>
        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.textMuted} />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.exerciseBody}>
          {personalRecord && (
            <View style={[styles.prBadge, { backgroundColor: Colors.accentYellow + "15" }]}>
              <Ionicons name="trophy" size={14} color={Colors.accentYellow} />
              <Text style={[styles.prText, { color: Colors.accentYellow }]}>
                PR: {personalRecord.maxWeightKg}kg × {personalRecord.maxReps}
              </Text>
            </View>
          )}

          {lastPerformance && (
            <View style={[styles.lastPerfRow, { borderBottomColor: theme.border }]}>
              <Text style={[styles.lastPerfLabel, { color: theme.textMuted }]}>Last:</Text>
              <Text style={[styles.lastPerfValue, { color: theme.textSecondary }]}>
                {lastPerformance.sets
                  .filter((s: any) => s.completed)
                  .map((s: any) => `${s.weightKg}×${s.reps}`)
                  .join(", ")}
              </Text>
            </View>
          )}

          {log.sets.length > 0 && (
            <View style={styles.setsTable}>
              <View style={[styles.setsHeader, { borderBottomColor: theme.border }]}>
                <Text style={[styles.setHeaderCell, styles.setNumCol, { color: theme.textMuted }]}>SET</Text>
                <Text style={[styles.setHeaderCell, styles.typeCol, { color: theme.textMuted }]}>TYPE</Text>
                <Text style={[styles.setHeaderCell, styles.weightCol, { color: theme.textMuted }]}>KG</Text>
                <Text style={[styles.setHeaderCell, styles.repsCol, { color: theme.textMuted }]}>REPS</Text>
                <View style={styles.actionCol} />
              </View>
              {log.sets.map((set: any, setIdx: number) => (
                <View key={setIdx} style={[styles.setRow, { borderBottomColor: theme.border + "60" }]}>
                  <Text style={[styles.setCell, styles.setNumCol, { color: theme.text }]}>{set.setNumber}</Text>
                  <View style={[styles.typeCol, styles.typeBadgeContainer]}>
                    {set.setType && set.setType !== "normal" ? (
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: SET_TYPE_LABELS[set.setType as SetType]?.color + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeBadgeText,
                            {
                              color: SET_TYPE_LABELS[set.setType as SetType]?.color,
                            },
                          ]}
                        >
                          {SET_TYPE_LABELS[set.setType as SetType]?.short}
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.setCell, { color: theme.textMuted }]}>—</Text>
                    )}
                  </View>
                  <Text style={[styles.setCell, styles.weightCol, { color: theme.text, fontWeight: "600" }]}>{set.weightKg}</Text>
                  <Text style={[styles.setCell, styles.repsCol, { color: theme.text, fontWeight: "600" }]}>{set.reps}</Text>
                  <TouchableOpacity style={styles.actionCol} onPress={() => onRemoveSet(setIdx)}>
                    <Ionicons name="close-circle" size={18} color={Colors.accentRed + "60"} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.setTypeRow}>
            {(Object.keys(SET_TYPE_LABELS) as SetType[]).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.setTypeBtn,
                  {
                    backgroundColor: selectedSetType === type ? SET_TYPE_LABELS[type].color + "20" : "transparent",
                    borderColor: selectedSetType === type ? SET_TYPE_LABELS[type].color + "60" : theme.border,
                  },
                ]}
                onPress={() => handleQuickAdd(type)}
              >
                <Text
                  style={[
                    styles.setTypeBtnText,
                    {
                      color: selectedSetType === type ? SET_TYPE_LABELS[type].color : theme.textSecondary,
                    },
                  ]}
                >
                  {SET_TYPE_LABELS[type].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.addSetRow}>
            <View style={[styles.inputGroup, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.inputLabel, { color: theme.textMuted }]}>kg</Text>
              <TextInput
                ref={weightRef}
                style={[styles.setInput, { color: theme.text }]}
                placeholder="0"
                placeholderTextColor={theme.textMuted}
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="decimal-pad"
                returnKeyType="next"
              />
            </View>
            <View style={[styles.inputGroup, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.inputLabel, { color: theme.textMuted }]}>reps</Text>
              <TextInput
                style={[styles.setInput, { color: theme.text }]}
                placeholder="0"
                placeholderTextColor={theme.textMuted}
                value={repsInput}
                onChangeText={setRepsInput}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleAddSet}
              />
            </View>
            <TouchableOpacity style={[styles.logSetBtn, { backgroundColor: Colors.primary }]} onPress={handleAddSet}>
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.logSetBtnText}>Log</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  timerContainer: { flexDirection: "row", alignItems: "center", gap: 6 },
  timerText: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  finishBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accentGreen,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
  },
  finishBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  scrollArea: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  exerciseCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 8,
  },
  exerciseName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  exerciseMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  removeExBtn: { padding: 4 },
  exerciseBody: { paddingHorizontal: 14, paddingBottom: 14 },
  prBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  prText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lastPerfRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  lastPerfLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lastPerfValue: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  setsTable: { marginBottom: 10 },
  setsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
  },
  setHeaderCell: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 0.5,
  },
  setCell: { fontSize: 14, fontFamily: "Inter_400Regular" },
  setNumCol: { width: 36, textAlign: "center" },
  typeCol: { width: 44, alignItems: "center" as any },
  weightCol: { flex: 1, textAlign: "center" as any },
  repsCol: { flex: 1, textAlign: "center" as any },
  actionCol: { width: 30, alignItems: "center" as any },
  typeBadgeContainer: { justifyContent: "center" as any },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  setTypeRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  setTypeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  setTypeBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  addSetRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  inputGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    gap: 4,
    height: 44,
  },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  setInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  logSetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
  },
  logSetBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  addExerciseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  addExerciseBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  searchCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    maxHeight: 400,
  },
  searchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  searchTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    gap: 8,
    height: 44,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  customExerciseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 8,
  },
  customExerciseText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  searchResults: { maxHeight: 250 },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    gap: 8,
  },
  searchResultName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  searchResultMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },
  feedbackCard: {
    maxHeight: "94%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
  },
  feedbackContent: { paddingHorizontal: 18, paddingTop: 10 },
  feedbackHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#6F7480",
    alignSelf: "center",
    marginBottom: 14,
  },
  feedbackTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  feedbackSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 12,
  },
  ratingSection: { marginTop: 11 },
  ratingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 7,
  },
  ratingLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ratingValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  ratingButtons: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  ratingButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingButtonText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  scaleLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
  },
  scaleText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  painNotice: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: Colors.accentRed + "15",
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  painNoticeText: {
    flex: 1,
    color: Colors.accentRed,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_500Medium",
  },
  saveFeedbackBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  saveFeedbackText: {
    color: "#000",
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  keepTrainingBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  keepTrainingText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
