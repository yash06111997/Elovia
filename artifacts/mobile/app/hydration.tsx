import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useWellness, WATER_PRESETS } from "@/context/WellnessContext";
import { useApp } from "@/context/AppContext";

export default function HydrationScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState } = useApp();
  const {
    todayWaterMl,
    waterGoalMl,
    waterProgress,
    todayEntries,
    weeklyWater,
    addWater,
    removeWaterEntry,
    setWaterGoal,
  } = useWellness();

  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(waterGoalMl / 1000));
  const [customMl, setCustomMl] = useState("");

  const remaining = Math.max(0, waterGoalMl - todayWaterMl);
  const goalHit = todayWaterMl >= waterGoalMl;

  /**
   * A suggested goal, shown alongside the user's own.
   *
   * Roughly 35ml per kg of bodyweight, plus 500ml per training day. This is a
   * rule of thumb, not a clinical figure, and it is presented as a suggestion
   * rather than silently overwriting whatever the user chose.
   */
  const suggestedLitres = useMemo(() => {
    const weight = appState.profile?.weightKg ?? 70;
    const trains = (appState.profile?.workoutDaysPerWeek ?? 0) > 0;
    return Math.round(((weight * 35) / 1000 + (trains ? 0.5 : 0)) * 10) / 10;
  }, [appState.profile]);

  const weeklyMax = Math.max(waterGoalMl, ...weeklyWater.map((d) => d.ml), 1);

  const handleAdd = (ml: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addWater(ml);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Hydration", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.ringCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <WaterRing progress={waterProgress} isDark={isDark} />
          <Text style={[styles.ringValue, { color: theme.text }]}>
            {(todayWaterMl / 1000).toFixed(2)}
            <Text style={[styles.ringUnit, { color: theme.textMuted }]}> L</Text>
          </Text>
          <Text style={[styles.ringGoal, { color: theme.textSecondary }]}>
            {goalHit
              ? "Goal reached — nice one"
              : `${(remaining / 1000).toFixed(2)} L to go of ${(waterGoalMl / 1000).toFixed(1)} L`}
          </Text>

          <TouchableOpacity
            onPress={() => {
              setGoalDraft(String(waterGoalMl / 1000));
              setGoalModalVisible(true);
            }}
            hitSlop={10}
          >
            <Text style={[styles.editGoal, { color: Colors.primary }]}>Change goal</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.presetGrid}>
          {WATER_PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset.label}
              style={[styles.preset, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => handleAdd(preset.ml)}
              activeOpacity={0.8}
            >
              <Ionicons name={preset.icon as any} size={22} color={Colors.primary} />
              <Text style={[styles.presetLabel, { color: theme.text }]}>{preset.label}</Text>
              <Text style={[styles.presetMl, { color: theme.textMuted }]}>{preset.ml} ml</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.customRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TextInput
            style={[styles.customInput, { color: theme.text }]}
            value={customMl}
            onChangeText={setCustomMl}
            placeholder="Custom amount"
            placeholderTextColor={theme.textMuted}
            keyboardType="number-pad"
            returnKeyType="done"
          />
          <Text style={[styles.customUnit, { color: theme.textMuted }]}>ml</Text>
          <TouchableOpacity
            style={[
              styles.customAdd,
              { backgroundColor: customMl ? Colors.primary : theme.border },
            ]}
            disabled={!customMl}
            onPress={() => {
              const ml = Number(customMl);
              if (Number.isFinite(ml) && ml > 0) {
                handleAdd(ml);
                setCustomMl("");
              }
            }}
          >
            <Ionicons name="add" size={20} color={customMl ? "#000" : theme.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Last 7 days</Text>
          <View style={styles.chart}>
            {weeklyWater.map((day) => {
              const height = Math.max(4, (day.ml / weeklyMax) * 90);
              const hit = day.ml >= waterGoalMl;
              return (
                <View key={day.date} style={styles.chartCol}>
                  <View
                    style={[
                      styles.chartBar,
                      {
                        height,
                        backgroundColor: hit ? Colors.primary : theme.border,
                      },
                    ]}
                  />
                  <Text style={[styles.chartLabel, { color: theme.textMuted }]}>
                    {new Date(`${day.date}T00:00:00`).toLocaleDateString([], {
                      weekday: "narrow",
                    })}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {todayEntries.length > 0 && (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Today</Text>
            {[...todayEntries].reverse().map((entry) => (
              <View key={entry.id} style={styles.entryRow}>
                <Ionicons name="water-outline" size={16} color={Colors.primary} />
                <Text style={[styles.entryMl, { color: theme.text }]}>{entry.ml} ml</Text>
                <Text style={[styles.entryTime, { color: theme.textMuted }]}>
                  {new Date(entry.at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
                <TouchableOpacity onPress={() => removeWaterEntry(entry.id)} hitSlop={10}>
                  <Ionicons name="close" size={16} color={theme.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={goalModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Daily water goal</Text>
            <Text style={[styles.modalHint, { color: theme.textMuted }]}>
              Based on your weight and training, around {suggestedLitres} L a day is a
              reasonable starting point.
            </Text>

            <View style={[styles.goalInputRow, { borderColor: theme.border }]}>
              <TextInput
                style={[styles.goalInput, { color: theme.text }]}
                value={goalDraft}
                onChangeText={setGoalDraft}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Text style={[styles.goalUnit, { color: theme.textMuted }]}>litres</Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: theme.border }]}
                onPress={() => setGoalModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: Colors.primary, borderColor: Colors.primary }]}
                onPress={() => {
                  const litres = Number(goalDraft);
                  if (Number.isFinite(litres) && litres > 0) setWaterGoal(litres);
                  setGoalModalVisible(false);
                }}
              >
                <Text style={[styles.modalBtnText, { color: "#000" }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Progress ring drawn with a stroke-dash offset. */
function WaterRing({ progress, isDark }: { progress: number; isDark: boolean }) {
  const SIZE = 140;
  const STROKE = 12;
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <Svg width={SIZE} height={SIZE} style={styles.ring}>
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        stroke={isDark ? "#2A2A3A" : "#E4E6F0"}
        strokeWidth={STROKE}
        fill="none"
      />
      <Circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        stroke={Colors.primary}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, progress))}
        // Start the arc at 12 o'clock rather than 3 o'clock.
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 14 },

  ringCard: { borderRadius: 18, borderWidth: 1, padding: 22, alignItems: "center", gap: 4 },
  ring: { marginBottom: 8 },
  ringValue: { fontSize: 34, fontFamily: "Inter_700Bold" },
  ringUnit: { fontSize: 16, fontFamily: "Inter_500Medium" },
  ringGoal: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  editGoal: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 10 },

  presetGrid: { flexDirection: "row", gap: 8 },
  preset: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    gap: 4,
  },
  presetLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  presetMl: { fontSize: 10, fontFamily: "Inter_400Regular" },

  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
  },
  customInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  customUnit: { fontSize: 13, fontFamily: "Inter_400Regular" },
  customAdd: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 110, gap: 6 },
  chartCol: { flex: 1, alignItems: "center", gap: 6 },
  chartBar: { width: "70%", borderRadius: 4 },
  chartLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  entryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  entryMl: { fontSize: 13, fontFamily: "Inter_500Medium" },
  entryTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: "auto" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000090",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  modalCard: { width: "100%", borderRadius: 18, padding: 22, gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  modalHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  goalInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  goalInput: { flex: 1, fontSize: 20, fontFamily: "Inter_600SemiBold", paddingVertical: 12 },
  goalUnit: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
