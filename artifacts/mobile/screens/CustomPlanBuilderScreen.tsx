import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CustomWorkoutPlan, WorkoutDay, Exercise } from "@/context/WorkoutContext";
import { ExerciseEntry } from "@/utils/exerciseDatabase";
import { ExerciseLibraryScreen } from "@/screens/ExerciseLibraryScreen";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (plan: Omit<CustomWorkoutPlan, "id" | "createdAt" | "updatedAt">) => void;
  existingPlan?: CustomWorkoutPlan;
  userEquipment?: string[];
}

interface DraftExercise extends Exercise {
  tempId: string;
}

interface DraftDay {
  tempId: string;
  dayName: string;
  exercises: DraftExercise[];
}

function entryToExercise(entry: ExerciseEntry): Exercise {
  return {
    id: entry.id,
    name: entry.name,
    muscleGroup: entry.primaryMuscle,
    sets: entry.sets,
    reps: entry.reps,
    restSeconds: entry.restSeconds,
    notes: entry.notes,
  };
}

export function CustomPlanBuilderScreen({
  visible,
  onClose,
  onSave,
  existingPlan,
  userEquipment = [],
}: Props) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();

  const initDays = (): DraftDay[] => {
    if (existingPlan) {
      return existingPlan.days.map((d) => ({
        tempId: d.id,
        dayName: d.dayName,
        exercises: d.exercises.map((ex) => ({ ...ex, tempId: ex.id })),
      }));
    }
    return [{ tempId: Date.now().toString(), dayName: "Day 1", exercises: [] }];
  };

  const [planName, setPlanName] = useState(existingPlan?.name ?? "");
  const [days, setDays] = useState<DraftDay[]>(initDays);
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editingExercise, setEditingExercise] = useState<{ dayIdx: number; exIdx: number } | null>(null);

  const handleAddDay = () => {
    const newDay: DraftDay = {
      tempId: Date.now().toString(),
      dayName: `Day ${days.length + 1}`,
      exercises: [],
    };
    setDays((prev) => [...prev, newDay]);
    setActiveDayIdx(days.length);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemoveDay = (idx: number) => {
    if (days.length === 1) {
      Alert.alert("Cannot remove", "You need at least one workout day.");
      return;
    }
    setDays((prev) => prev.filter((_, i) => i !== idx));
    setActiveDayIdx((prev) => Math.min(prev, days.length - 2));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleDayNameChange = (idx: number, name: string) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, dayName: name } : d)));
  };

  const handleAddExercise = (entry: ExerciseEntry) => {
    const exercise: DraftExercise = {
      ...entryToExercise(entry),
      tempId: `${entry.id}_${Date.now()}`,
    };
    setDays((prev) =>
      prev.map((d, i) =>
        i === activeDayIdx ? { ...d, exercises: [...d.exercises, exercise] } : d
      )
    );
    setShowLibrary(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemoveExercise = (dayIdx: number, exIdx: number) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === dayIdx
          ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) }
          : d
      )
    );
  };

  const handleUpdateExercise = (
    dayIdx: number,
    exIdx: number,
    field: "sets" | "reps" | "restSeconds",
    value: string
  ) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === dayIdx
          ? {
              ...d,
              exercises: d.exercises.map((ex, j) =>
                j === exIdx
                  ? {
                      ...ex,
                      [field]:
                        field === "reps" ? value : parseInt(value, 10) || ex[field],
                    }
                  : ex
              ),
            }
          : d
      )
    );
  };

  const handleSave = () => {
    if (!planName.trim()) {
      Alert.alert("Name required", "Please give your plan a name.");
      return;
    }
    if (days.some((d) => d.exercises.length === 0)) {
      Alert.alert(
        "Empty day",
        "Each workout day needs at least one exercise. Remove empty days or add exercises.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save anyway",
            onPress: () => commitSave(),
          },
        ]
      );
      return;
    }
    commitSave();
  };

  const commitSave = () => {
    const workoutDays: WorkoutDay[] = days.map((d, i) => ({
      id: d.tempId,
      dayName: d.dayName || `Day ${i + 1}`,
      muscleGroups: [],
      exercises: d.exercises.map((ex) => {
        const { tempId, ...rest } = ex;
        return rest;
      }),
    }));
    onSave({ name: planName.trim(), days: workoutDays });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const currentDay = days[activeDayIdx];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? insets.top + 4 : 16, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {existingPlan ? "Edit Plan" : "Create Plan"}
          </Text>
          <TouchableOpacity onPress={handleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.saveText, { color: Colors.primary }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Plan name */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>PLAN NAME</Text>
            <TextInput
              style={[styles.nameInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
              value={planName}
              onChangeText={setPlanName}
              placeholder="e.g. My Push Pull Legs"
              placeholderTextColor={theme.textMuted}
              returnKeyType="done"
            />
          </View>

          {/* Day tabs */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>WORKOUT DAYS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayTabs}>
              {days.map((day, idx) => (
                <TouchableOpacity
                  key={day.tempId}
                  style={[
                    styles.dayTab,
                    {
                      borderColor: activeDayIdx === idx ? Colors.primary : theme.border,
                      backgroundColor: activeDayIdx === idx ? Colors.primary + "15" : theme.card,
                    },
                  ]}
                  onPress={() => setActiveDayIdx(idx)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.dayTabText,
                      { color: activeDayIdx === idx ? Colors.primary : theme.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {day.dayName || `Day ${idx + 1}`}
                  </Text>
                  <Text style={[styles.dayTabCount, { color: activeDayIdx === idx ? Colors.primary : theme.textMuted }]}>
                    {day.exercises.length}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.addDayBtn, { borderColor: theme.border }]}
                onPress={handleAddDay}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Active day editor */}
          {currentDay && (
            <View style={[styles.dayCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.dayCardHeader}>
                <TextInput
                  style={[styles.dayNameInput, { color: theme.text }]}
                  value={currentDay.dayName}
                  onChangeText={(v) => handleDayNameChange(activeDayIdx, v)}
                  placeholder={`Day ${activeDayIdx + 1}`}
                  placeholderTextColor={theme.textMuted}
                  returnKeyType="done"
                />
                {days.length > 1 && (
                  <TouchableOpacity onPress={() => handleRemoveDay(activeDayIdx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={18} color="#FF5252" />
                  </TouchableOpacity>
                )}
              </View>

              {currentDay.exercises.length === 0 ? (
                <View style={styles.emptyDay}>
                  <Text style={[styles.emptyDayText, { color: theme.textMuted }]}>No exercises yet</Text>
                </View>
              ) : (
                <View style={styles.exerciseList}>
                  {currentDay.exercises.map((ex, exIdx) => (
                    <View key={ex.tempId} style={[styles.exerciseRow, { borderColor: theme.border }]}>
                      <View style={styles.exRowTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.exName, { color: theme.text }]}>{ex.name}</Text>
                          <Text style={[styles.exMuscle, { color: theme.textMuted }]}>{ex.muscleGroup}</Text>
                        </View>
                        <TouchableOpacity onPress={() => handleRemoveExercise(activeDayIdx, exIdx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={20} color="#FF5252" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.exControls}>
                        <View style={styles.exControl}>
                          <Text style={[styles.exControlLabel, { color: theme.textMuted }]}>Sets</Text>
                          <TextInput
                            style={[styles.exControlInput, { backgroundColor: isDark ? "#0A0A0F" : "#F5F6FA", color: theme.text, borderColor: theme.border }]}
                            value={ex.sets.toString()}
                            onChangeText={(v) => handleUpdateExercise(activeDayIdx, exIdx, "sets", v)}
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={styles.exControl}>
                          <Text style={[styles.exControlLabel, { color: theme.textMuted }]}>Reps</Text>
                          <TextInput
                            style={[styles.exControlInput, { backgroundColor: isDark ? "#0A0A0F" : "#F5F6FA", color: theme.text, borderColor: theme.border }]}
                            value={ex.reps}
                            onChangeText={(v) => handleUpdateExercise(activeDayIdx, exIdx, "reps", v)}
                          />
                        </View>
                        <View style={styles.exControl}>
                          <Text style={[styles.exControlLabel, { color: theme.textMuted }]}>Rest (s)</Text>
                          <TextInput
                            style={[styles.exControlInput, { backgroundColor: isDark ? "#0A0A0F" : "#F5F6FA", color: theme.text, borderColor: theme.border }]}
                            value={ex.restSeconds.toString()}
                            onChangeText={(v) => handleUpdateExercise(activeDayIdx, exIdx, "restSeconds", v)}
                            keyboardType="numeric"
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.addExerciseBtn, { borderColor: Colors.primary + "60", backgroundColor: Colors.primary + "10" }]}
                onPress={() => setShowLibrary(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={[styles.addExerciseBtnText, { color: Colors.primary }]}>Add Exercise</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>

      <ExerciseLibraryScreen
        visible={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelectExercise={handleAddExercise}
        selectionMode
        userEquipment={userEquipment}
      />
    </Modal>
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
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  saveText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  nameInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  dayTabs: { gap: 8, paddingRight: 8 },
  dayTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 80,
  },
  dayTabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", maxWidth: 90 },
  dayTabCount: { fontSize: 11, fontFamily: "Inter_500Medium" },
  addDayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    gap: 0,
  },
  dayCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0,
  },
  dayNameInput: { fontSize: 16, fontFamily: "Inter_700Bold", flex: 1 },
  emptyDay: { alignItems: "center", paddingVertical: 20 },
  emptyDayText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  exerciseList: { gap: 0 },
  exerciseRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  exRowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  exName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  exMuscle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  exControls: { flexDirection: "row", gap: 10 },
  exControl: { flex: 1, gap: 4 },
  exControlLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.3 },
  exControlInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  addExerciseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addExerciseBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
