import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
} from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { PressableScale, FadeInView } from "@/components/Pressable";
import { useTheme } from "@/hooks/useTheme";
import { useApp } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import {
  buildCuratedDays,
  rankCuratedPlans,
  type CuratedPlan,
} from "@/utils/curatedPlans";

const GOAL_LABELS: Record<string, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  strength: "Strength",
  endurance: "Endurance",
  general_fitness: "General fitness",
};

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/**
 * Curated programme library.
 *
 * These are free for every tier by design. They cost nothing to serve, and a
 * free user who gets a real, structured programme is far more likely to
 * subscribe later than one who hits a locked screen on day one.
 */
export default function PlansScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState } = useApp();
  const { addCustomPlan, setActivePlan } = useWorkout();
  const [selected, setSelected] = useState<CuratedPlan | null>(null);

  const profile = appState.profile;
  const plans = useMemo(() => rankCuratedPlans(profile), [profile]);

  const startPlan = (plan: CuratedPlan) => {
    const days = buildCuratedDays(plan);

    if (days.every((d) => d.exercises.length === 0)) {
      Alert.alert("Could not load plan", "This programme is missing its exercises.");
      return;
    }

    const created = addCustomPlan({ name: plan.name, days });
    setActivePlan("custom", created.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(null);

    Alert.alert(
      `${plan.name} activated`,
      `${plan.daysPerWeek} sessions a week for ${plan.weeks} weeks. You can edit or switch plans any time.`,
      [{ text: "Go to workouts", onPress: () => router.replace("/(tabs)/workouts") }],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Training Programmes", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: theme.textSecondary }]}>
          Structured programmes built on established training principles. Free on every
          plan — pick one and start today.
        </Text>

        {plans.map((plan, index) => (
          <FadeInView key={plan.id} index={index}>
          <PressableScale
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => {
              Haptics.selectionAsync();
              setSelected(plan);
            }}
          >
            {index === 0 && (
              <View style={[styles.bestBadge, { backgroundColor: Colors.primary }]}>
                <Text style={styles.bestBadgeText}>BEST MATCH</Text>
              </View>
            )}

            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardName, { color: theme.text }]}>{plan.name}</Text>
                <Text style={[styles.cardTagline, { color: theme.textSecondary }]}>
                  {plan.tagline}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </View>

            <View style={styles.metaRow}>
              <Meta icon="calendar-outline" label={`${plan.daysPerWeek}x / week`} theme={theme} />
              <Meta icon="time-outline" label={`${plan.sessionMins} min`} theme={theme} />
              <Meta icon="trending-up-outline" label={LEVEL_LABELS[plan.level]} theme={theme} />
            </View>

            <View style={styles.tagRow}>
              {plan.tags.map((tag) => (
                <View
                  key={tag}
                  style={[styles.tag, { backgroundColor: isDark ? "#FFFFFF10" : "#00000008" }]}
                >
                  <Text style={[styles.tagText, { color: theme.textSecondary }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </PressableScale>
          </FadeInView>
        ))}
      </ScrollView>

      <Modal
        visible={selected !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>{selected.name}</Text>
                <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                  {selected.tagline}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={12}>
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 100 }]}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                {selected.description}
              </Text>

              <View style={[styles.methodCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={styles.methodHeader}>
                  <Ionicons name="bulb-outline" size={16} color={Colors.primary} />
                  <Text style={[styles.methodTitle, { color: theme.text }]}>Why it works</Text>
                </View>
                <Text style={[styles.methodBody, { color: theme.textSecondary }]}>
                  {selected.methodology}
                </Text>
              </View>

              <View style={styles.statsGrid}>
                <Stat value={`${selected.daysPerWeek}`} label="days / week" theme={theme} />
                <Stat value={`${selected.weeks}`} label="weeks" theme={theme} />
                <Stat value={`${selected.sessionMins}`} label="min / session" theme={theme} />
                <Stat
                  value={GOAL_LABELS[selected.goal] ?? selected.goal}
                  label="focus"
                  theme={theme}
                  small
                />
              </View>

              <Text style={[styles.sectionTitle, { color: theme.text }]}>Sessions</Text>

              {selected.days.map((day, i) => (
                <View
                  key={`${selected.id}_${i}`}
                  style={[styles.dayCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                >
                  <Text style={[styles.dayName, { color: theme.text }]}>{day.dayName}</Text>
                  {day.exercises.map((ex, j) => (
                    <View key={`${ex.exerciseId}_${j}`} style={styles.exerciseRow}>
                      <Text style={[styles.exerciseIndex, { color: theme.textMuted }]}>
                        {j + 1}
                      </Text>
                      <Text style={[styles.exerciseName, { color: theme.textSecondary }]}>
                        {exerciseDisplayName(ex.exerciseId)}
                      </Text>
                      <Text style={[styles.exerciseScheme, { color: theme.textMuted }]}>
                        {ex.sets ?? 3} × {ex.reps ?? "10"}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>

            <View
              style={[
                styles.footer,
                {
                  backgroundColor: theme.background,
                  borderTopColor: theme.border,
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <PressableScale
                style={[styles.startBtn, { backgroundColor: Colors.primary }]}
                onPress={() => startPlan(selected)}
                haptic
              >
                <Text style={styles.startBtnText}>Start this programme</Text>
              </PressableScale>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

/** Resolve a display name without importing the whole DB into the render path. */
function exerciseDisplayName(exerciseId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { allExercises } = require("@/utils/exerciseDatabase") as typeof import("@/utils/exerciseDatabase");
  return allExercises.find((e) => e.id === exerciseId)?.name ?? exerciseId;
}

function Meta({ icon, label, theme }: { icon: any; label: string; theme: any }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={theme.textMuted} />
      <Text style={[styles.metaText, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function Stat({
  value,
  label,
  theme,
  small,
}: {
  value: string;
  label: string;
  theme: any;
  small?: boolean;
}) {
  return (
    <View style={[styles.stat, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.statValue, { color: theme.text, fontSize: small ? 14 : 20 }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 4 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  bestBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bestBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#000", letterSpacing: 0.5 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  cardTagline: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  metaRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_500Medium" },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  modalContent: { padding: 20, gap: 16 },

  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },

  methodCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  methodHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  methodTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  methodBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flex: 1,
    minWidth: "22%",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },

  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 4 },

  dayCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  dayName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  exerciseRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  exerciseIndex: { fontSize: 11, fontFamily: "Inter_500Medium", width: 14 },
  exerciseName: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  exerciseScheme: { fontSize: 12, fontFamily: "Inter_500Medium" },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  startBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  startBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },
});
