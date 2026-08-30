import React, { useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { useNutrition } from "@/context/NutritionContext";
import { useWorkout } from "@/context/WorkoutContext";
import { useTheme } from "@/hooks/useTheme";
import { trackEvent } from "@/lib/telemetry";

export default function PlanPreviewScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { plan } = useWorkout();
  const { mealPlan } = useNutrition();

  useEffect(() => {
    void trackEvent("plan_preview_viewed", { source: "onboarding" });
  }, []);

  const continueToPlans = () => {
    router.replace({ pathname: "/paywall", params: { postOnboarding: "1" } });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 112 },
        ]}
      >
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={34} color="#000" />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.text }]}
        >
          Your plan is ready
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Here is a real preview built from all seven onboarding steps. Your
          full workout and nutrition tools remain available in the app.
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Ionicons name="barbell-outline" size={22} color={Colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {plan?.name ?? "Personalised workout plan"}
            </Text>
          </View>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {plan?.days.length ?? 0} training days · tailored to your goal,
            level and equipment
          </Text>
          {plan?.days.slice(0, 3).map((day) => (
            <View
              key={day.id}
              style={[styles.row, { borderTopColor: theme.border }]}
            >
              <View style={styles.number}>
                <Text style={styles.numberText}>{day.dayName.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {day.dayName}
                </Text>
                <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                  {day.exercises.length} exercises ·{" "}
                  {day.muscleGroups.join(", ")}
                </Text>
              </View>
            </View>
          ))}
          {(plan?.days.length ?? 0) > 3 && (
            <Text style={[styles.more, { color: Colors.primary }]}>
              + {(plan?.days.length ?? 0) - 3} more training days
            </Text>
          )}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Ionicons
              name="nutrition-outline"
              size={22}
              color={Colors.accentGreen}
            />
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              Nutrition preview
            </Text>
          </View>
          <View style={styles.macroRow}>
            <Macro
              label="Calories"
              value={`${mealPlan?.totalCalories ?? 0}`}
              theme={theme}
            />
            <Macro
              label="Protein"
              value={`${mealPlan?.totalProtein ?? 0}g`}
              theme={theme}
            />
            <Macro
              label="Carbs"
              value={`${mealPlan?.totalCarbs ?? 0}g`}
              theme={theme}
            />
          </View>
          {mealPlan?.meals.slice(0, 3).map((meal) => (
            <View
              key={meal.id}
              style={[styles.row, { borderTopColor: theme.border }]}
            >
              <Ionicons
                name="restaurant-outline"
                size={18}
                color={Colors.accentGreen}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>
                  {meal.name}
                </Text>
                <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                  {meal.mealType} · {meal.calories} kcal · {meal.protein}g
                  protein
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.notice,
            {
              borderColor: Colors.primary + "50",
              backgroundColor: Colors.primary + "12",
            },
          ]}
        >
          <Ionicons name="sparkles-outline" size={18} color={Colors.primary} />
          <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
            Your plan can adapt after each logged workout using effort, pain,
            enjoyment and readiness feedback.
          </Text>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            backgroundColor: theme.background,
            borderTopColor: theme.border,
          },
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Continue to plan options"
          style={styles.button}
          onPress={continueToPlans}
        >
          <Text style={styles.buttonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={19} color="#000" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Macro({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View style={styles.macro}>
      <Text style={[styles.macroValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.macroLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 16 },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  card: { borderWidth: 1, borderRadius: 18, padding: 17 },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 6,
  },
  cardTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold" },
  meta: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  number: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.primary + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { color: Colors.primary, fontFamily: "Inter_700Bold" },
  rowTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    textTransform: "capitalize",
  },
  more: { fontSize: 13, fontFamily: "Inter_600SemiBold", paddingTop: 7 },
  macroRow: { flexDirection: "row", marginVertical: 10 },
  macro: { flex: 1, alignItems: "center" },
  macroValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  macroLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  notice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  button: {
    height: 54,
    borderRadius: 15,
    backgroundColor: Colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { color: "#000", fontSize: 17, fontFamily: "Inter_700Bold" },
});
