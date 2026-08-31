import React from "react";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Meal } from "@/context/NutritionContext";

interface Props {
  meal: Meal;
  onLog?: (meal: Meal) => void;
  logged?: boolean;
}

const mealTypeConfig = {
  breakfast: { icon: "sunny-outline" as const, color: Colors.accentYellow, label: "Breakfast" },
  lunch: { icon: "restaurant-outline" as const, color: Colors.primary, label: "Lunch" },
  dinner: { icon: "moon-outline" as const, color: Colors.accent, label: "Dinner" },
  snack: { icon: "cafe-outline" as const, color: Colors.accentGreen, label: "Snack" },
};

export function MealCard({ meal, onLog, logged }: Props) {
  const { isDark } = useTheme();
  const config = mealTypeConfig[meal.mealType];
  const cardBg = Colors.dark.card;
  const textColor = Colors.dark.text;
  const mutedColor = Colors.dark.textSecondary;
  const borderColor = logged ? config.color : (Colors.dark.border);
  const tagBg = Colors.dark.background;

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.header}>
        <View style={[styles.typeBadge, { backgroundColor: config.color + "20" }]}>
          <Ionicons name={config.icon} size={12} color={config.color} />
          <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
        </View>
        {logged && (
          <View style={[styles.loggedBadge, { backgroundColor: Colors.accentGreen + "20" }]}>
            <Ionicons name="checkmark-circle" size={12} color={Colors.accentGreen} />
            <Text style={[styles.loggedText]}>Logged</Text>
          </View>
        )}
      </View>

      <Text style={[styles.mealName, { color: textColor }]}>{meal.name}</Text>
      <Text style={[styles.description, { color: mutedColor }]} numberOfLines={2}>
        {meal.description}
      </Text>

      <View style={styles.macros}>
        <MacroPill value={meal.calories} unit="kcal" color={Colors.accentYellow} bg={tagBg} />
        <MacroPill value={meal.protein} unit="P" color={Colors.primary} bg={tagBg} />
        <MacroPill value={meal.carbs} unit="C" color={Colors.accent} bg={tagBg} />
        <MacroPill value={meal.fats} unit="F" color={Colors.accentGreen} bg={tagBg} />
      </View>

      {onLog && !logged && (
        <TouchableOpacity
          style={[styles.logBtn, { backgroundColor: config.color }]}
          onPress={() => onLog(meal)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={16} color="#000" />
          <Text style={styles.logBtnText}>Log Meal</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MacroPill({
  value,
  unit,
  color,
  bg,
}: {
  value: number;
  unit: string;
  color: string;
  bg: string;
}) {
  const textColor = Colors.dark.text;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillValue, { color: textColor }]}>{Math.round(value)}</Text>
      <Text style={[styles.pillUnit, { color }]}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  loggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  loggedText: {
    color: Colors.accentGreen,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  mealName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  description: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  macros: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pillValue: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  pillUnit: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    marginTop: 2,
  },
  logBtnText: {
    color: "#000",
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
});
