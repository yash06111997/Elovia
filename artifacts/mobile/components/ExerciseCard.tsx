import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Exercise, SetLog } from "@/context/WorkoutContext";

interface Props {
  exercise: Exercise;
  isDark: boolean;
  onLogSet?: (set: SetLog) => void;
  personalRecord?: { maxWeightKg: number; maxReps: number } | null;
  isActive?: boolean;
}

export function ExerciseCard({
  exercise,
  isDark,
  onLogSet,
  personalRecord,
  isActive = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [sets, setSets] = useState<SetLog[]>(
    Array.from({ length: exercise.sets }, (_, i) => ({
      setNumber: i + 1,
      reps: 0,
      weightKg: 0,
      completed: false,
    }))
  );

  const cardBg = isDark ? "#1A1A24" : "#FFFFFF";
  const textColor = isDark ? "#FFFFFF" : "#0A0A0F";
  const mutedColor = isDark ? "#8A8A9E" : "#5A5A7A";
  const borderColor = isDark ? "#2A2A3A" : "#E4E6F0";
  const inputBg = isDark ? "#0A0A0F" : "#F5F6FA";

  const completedSets = sets.filter((s) => s.completed).length;

  const toggleSet = (idx: number) => {
    if (!isActive) return;
    const updated = sets.map((s, i) =>
      i === idx ? { ...s, completed: !s.completed } : s
    );
    setSets(updated);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!sets[idx].completed && onLogSet) {
      onLogSet(updated[idx]);
    }
  };

  const updateSet = (idx: number, field: "reps" | "weightKg", value: string) => {
    const num = parseFloat(value) || 0;
    setSets((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: num } : s))
    );
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor },
        completedSets === exercise.sets && isActive && styles.cardComplete,
      ]}
    >
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.muscleBadge,
              { backgroundColor: "#00D4FF20" },
            ]}
          >
            <Text style={[styles.muscleText, { color: "#00D4FF" }]}>
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
              <Ionicons name="information-circle" size={14} color="#00D4FF" />
              <Text style={[styles.notesText, { color: mutedColor }]}>
                {exercise.notes}
              </Text>
            </View>
          ) : null}

          {personalRecord && (
            <View style={[styles.prRow, { backgroundColor: "#FFD60015" }]}>
              <Ionicons name="trophy" size={14} color="#FFD600" />
              <Text style={[styles.prText, { color: "#FFD600" }]}>
                PR: {personalRecord.maxWeightKg}kg × {personalRecord.maxReps}
              </Text>
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
                    placeholder="0"
                    placeholderTextColor={mutedColor}
                  />
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, color: textColor, flex: 1 }]}
                    value={set.reps > 0 ? set.reps.toString() : ""}
                    onChangeText={(v) => updateSet(idx, "reps", v)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={mutedColor}
                  />
                  <TouchableOpacity
                    style={[
                      styles.checkBtn,
                      set.completed && { backgroundColor: "#00E676" },
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
    borderColor: "#00E676",
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
  progressBadge: {
    backgroundColor: "#00D4FF20",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  progressText: {
    color: "#00D4FF",
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
  prRow: {
    flexDirection: "row",
    gap: 6,
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  prText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
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
    backgroundColor: "#00E67610",
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
    backgroundColor: "#2A2A3A",
  },
});
