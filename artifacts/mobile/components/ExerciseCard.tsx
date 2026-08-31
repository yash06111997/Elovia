import React, { useState, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Exercise, SetLog, PersonalRecord } from "@/context/WorkoutContext";

interface ExerciseHistory {
  date: string;
  sets: SetLog[];
}

interface Props {
  exercise: Exercise;
  onLogSet?: (set: SetLog) => void;
  personalRecord?: PersonalRecord | null;
  isActive?: boolean;
  lastPerformance?: ExerciseHistory | null;
  onNewPR?: (exerciseName: string, weight: number, reps: number) => void;
}

export function ExerciseCard({
  exercise,
  onLogSet,
  personalRecord,
  isActive = false,
  lastPerformance,
  onNewPR,
}: Props) {
  const { isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"log" | "history">("log");
  const [showPRFlash, setShowPRFlash] = useState(false);
  const [prAnim] = useState(new Animated.Value(0));
  const [sets, setSets] = useState<SetLog[]>(
    Array.from({ length: exercise.sets }, (_, i) => ({
      setNumber: i + 1,
      reps: 0,
      weightKg: 0,
      completed: false,
    }))
  );

  const cardBg = Colors.dark.card;
  const textColor = Colors.dark.text;
  const mutedColor = Colors.dark.textSecondary;
  const borderColor = Colors.dark.border;
  const inputBg = Colors.dark.background;
  const surfaceBg = Colors.dark.surface;

  const completedSets = sets.filter((s) => s.completed).length;

  const flashPR = () => {
    setShowPRFlash(true);
    Animated.sequence([
      Animated.timing(prAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(prAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setShowPRFlash(false));
  };

  const toggleSet = (idx: number) => {
    if (!isActive) return;
    const updated = sets.map((s, i) =>
      i === idx ? { ...s, completed: !s.completed } : s
    );
    setSets(updated);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!sets[idx].completed && onLogSet) {
      const completedSet = updated[idx];
      onLogSet(completedSet);

      if (personalRecord && completedSet.weightKg > 0) {
        if (completedSet.weightKg > personalRecord.maxWeightKg ||
            (completedSet.weightKg === personalRecord.maxWeightKg && completedSet.reps > personalRecord.maxReps)) {
          flashPR();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onNewPR?.(exercise.name, completedSet.weightKg, completedSet.reps);
        }
      } else if (!personalRecord && completedSet.weightKg > 0) {
        flashPR();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onNewPR?.(exercise.name, completedSet.weightKg, completedSet.reps);
      }
    }
  };

  const updateSet = (idx: number, field: "reps" | "weightKg", value: string) => {
    const num = parseFloat(value) || 0;
    setSets((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: num } : s))
    );
  };

  const lastBestWeight = lastPerformance?.sets?.reduce((max, s) => Math.max(max, s.weightKg), 0) ?? 0;
  const lastBestReps = lastPerformance?.sets?.reduce((max, s) => Math.max(max, s.reps), 0) ?? 0;
  const lastTotalVolume = lastPerformance?.sets?.filter(s => s.completed).reduce((sum, s) => sum + s.weightKg * s.reps, 0) ?? 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor },
        completedSets === exercise.sets && isActive && styles.cardComplete,
      ]}
    >
      {showPRFlash && (
        <Animated.View style={[styles.prFlash, { opacity: prAnim }]}>
          <Ionicons name="trophy" size={20} color={Colors.accentYellow} />
          <Text style={styles.prFlashText}>NEW PR!</Text>
          <Ionicons name="trophy" size={20} color={Colors.accentYellow} />
        </Animated.View>
      )}

      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.muscleBadge, { backgroundColor: Colors.primary + "20" }]}>
            <Text style={[styles.muscleText, { color: Colors.primary }]}>
              {exercise.muscleGroup}
            </Text>
          </View>
          <Text style={[styles.exerciseName, { color: textColor }]}>
            {exercise.name}
          </Text>
          <Text style={[styles.setsReps, { color: mutedColor }]}>
            {exercise.sets} sets × {exercise.reps} • {exercise.restSeconds}s rest
          </Text>
        </View>
        <View style={styles.headerRight}>
          {personalRecord && (
            <View style={styles.trophyBadge}>
              <Ionicons name="trophy" size={12} color={Colors.accentYellow} />
            </View>
          )}
          {isActive && (
            <View style={styles.progressBadge}>
              <Text style={styles.progressText}>
                {completedSets}/{exercise.sets}
              </Text>
            </View>
          )}
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={mutedColor}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.details}>
          {exercise.notes ? (
            <View style={[styles.notesBox, { backgroundColor: inputBg }]}>
              <Ionicons name="information-circle" size={14} color={Colors.primary} />
              <Text style={[styles.notesText, { color: mutedColor }]}>
                {exercise.notes}
              </Text>
            </View>
          ) : null}

          {(personalRecord || lastPerformance) && (
            <View style={[styles.performanceBox, { backgroundColor: surfaceBg, borderColor }]}>
              <View style={styles.perfRow}>
                {personalRecord && (
                  <View style={styles.perfItem}>
                    <View style={styles.perfHeader}>
                      <Ionicons name="trophy" size={13} color={Colors.accentYellow} />
                      <Text style={[styles.perfLabel, { color: Colors.accentYellow }]}>Best</Text>
                    </View>
                    <Text style={[styles.perfValue, { color: textColor }]}>
                      {personalRecord.maxWeightKg}kg × {personalRecord.maxReps}
                    </Text>
                    <Text style={[styles.perfSub, { color: mutedColor }]}>
                      Vol: {personalRecord.bestVolume > 1000 ? `${(personalRecord.bestVolume / 1000).toFixed(1)}k` : personalRecord.bestVolume}kg
                    </Text>
                  </View>
                )}
                {lastPerformance && (
                  <View style={styles.perfItem}>
                    <View style={styles.perfHeader}>
                      <Ionicons name="time-outline" size={13} color={Colors.primary} />
                      <Text style={[styles.perfLabel, { color: Colors.primary }]}>Last</Text>
                    </View>
                    <Text style={[styles.perfValue, { color: textColor }]}>
                      {lastBestWeight}kg × {lastBestReps}
                    </Text>
                    <Text style={[styles.perfSub, { color: mutedColor }]}>
                      Vol: {lastTotalVolume > 1000 ? `${(lastTotalVolume / 1000).toFixed(1)}k` : lastTotalVolume}kg
                    </Text>
                  </View>
                )}
              </View>
              {lastPerformance && (
                <View style={styles.lastSetsRow}>
                  {lastPerformance.sets.filter(s => s.completed).map((s, i) => (
                    <View key={i} style={[styles.lastSetChip, { backgroundColor: Colors.dark.tabBarBorder }]}>
                      <Text style={[styles.lastSetText, { color: mutedColor }]}>
                        {s.weightKg}kg×{s.reps}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {isActive && (
            <View style={styles.setsTable}>
              <View style={styles.tableHeader}>
                <Text style={[styles.colHeader, { color: mutedColor, flex: 0.5 }]}>SET</Text>
                <Text style={[styles.colHeader, { color: mutedColor, flex: 1 }]}>WEIGHT (kg)</Text>
                <Text style={[styles.colHeader, { color: mutedColor, flex: 1 }]}>REPS</Text>
                <Text style={[styles.colHeader, { color: mutedColor, flex: 0.5 }]}>DONE</Text>
              </View>
              {sets.map((set, idx) => (
                <View key={idx} style={[styles.tableRow, set.completed && styles.completedRow]}>
                  <Text style={[styles.setNum, { color: mutedColor, flex: 0.5 }]}>
                    {set.setNumber}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, color: textColor, flex: 1 }]}
                    value={set.weightKg > 0 ? set.weightKg.toString() : ""}
                    onChangeText={(v) => updateSet(idx, "weightKg", v)}
                    keyboardType="numeric"
                    placeholder={lastPerformance?.sets?.[idx]?.weightKg ? String(lastPerformance.sets[idx].weightKg) : "0"}
                    placeholderTextColor={mutedColor}
                  />
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, color: textColor, flex: 1 }]}
                    value={set.reps > 0 ? set.reps.toString() : ""}
                    onChangeText={(v) => updateSet(idx, "reps", v)}
                    keyboardType="numeric"
                    placeholder={lastPerformance?.sets?.[idx]?.reps ? String(lastPerformance.sets[idx].reps) : "0"}
                    placeholderTextColor={mutedColor}
                  />
                  <TouchableOpacity
                    style={[
                      styles.checkBtn,
                      { backgroundColor: Colors.dark.border },
                      set.completed && { backgroundColor: Colors.accentGreen },
                      { flex: 0.5 },
                    ]}
                    onPress={() => toggleSet(idx)}
                  >
                    <Ionicons
                      name={set.completed ? "checkmark" : "checkmark-outline"}
                      size={16}
                      color={set.completed ? "#000" : mutedColor}
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardComplete: {
    borderColor: Colors.accentGreen,
  },
  header: {
    flexDirection: "row",
    padding: 14,
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flex: 1,
    gap: 4,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  muscleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 2,
  },
  muscleText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  exerciseName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  setsReps: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  trophyBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accentYellow + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  progressBadge: {
    backgroundColor: Colors.primary + "20",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  progressText: {
    color: Colors.primary,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  details: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  notesBox: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    alignItems: "flex-start",
  },
  notesText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
  performanceBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  perfRow: {
    flexDirection: "row",
    gap: 12,
  },
  perfItem: {
    flex: 1,
    gap: 2,
  },
  perfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  perfLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  perfValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  perfSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  lastSetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  lastSetChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  lastSetText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  prFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    backgroundColor: Colors.accentYellow + "20",
    zIndex: 10,
  },
  prFlashText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.accentYellow,
    letterSpacing: 1,
  },
  setsTable: {
    gap: 6,
  },
  tableHeader: {
    flexDirection: "row",
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  colHeader: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 4,
    borderRadius: 8,
  },
  completedRow: {
    backgroundColor: Colors.accentGreen + "10",
  },
  setNum: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  input: {
    padding: 8,
    borderRadius: 8,
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  checkBtn: {
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
