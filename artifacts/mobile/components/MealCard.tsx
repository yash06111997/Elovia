import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Meal } from "@/context/NutritionContext";

interface Props {
  meal: Meal;
  isDark: boolean;
  onLog?: (meal: Meal) => void;
  logged?: boolean;
}

const mealTypeConfig = {
  breakfast: { icon: "sunny-outline" as const, color: "#FFD600", label: "Breakfast" },
  lunch: { icon: "restaurant-outline" as const, color: "#00D4FF", label: "Lunch" },
  dinner: { icon: "moon-outline" as const, color: "#FF6B35", label: "Dinner" },
  snack: { icon: "cafe-outline" as const, color: "#00E676", label: "Snack" },
};

export function MealCard({ meal, isDark, onLog, logged }: Props) {
  const config = mealTypeConfig[meal.mealType];
  const cardBg = isDark ? "#1A1A24" : "#FFFFFF";
  const textColor = isDark ? "#FFFFFF" : "#0A0A0F";
  const mutedColor = isDark ? "#8A8A9E" : "#5A5A7A";
  const borderColor = logged ? config.color : (isDark ? "#2A2A3A" : "#E4E6F0");
  const tagBg = isDark ? "#0A0A0F" : "#F5F6FA";

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.header}>
        <View style={[styles.typeBadge, { backgroundColor: config.color + "20" }]}>
          <Ionicons name={config.icon} size={12} color={config.color} />
          <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
        </View>
        {logged && (
          <View style={[styles.loggedBadge, { backgroundColor: "#00E67620" }]}>
            <Ionicons name="checkmark-circle" size={12} color="#00E676" />
            <Text style={[styles.loggedText]}>Logged</Text>
          </View>
        )}
      </View>

      <Text style={[styles.mealName, { color: textColor }]}>{meal.name}</Text>
      <Text style={[styles.description, { color: mutedColor }]} numberOfLines={2}>
        {meal.description}
      </Text>

      <View style={styles.macros}>
        <MacroPill value={meal.calories} unit="kcal" color="#FFD600" bg={tagBg} isDark={isDark} />
        <MacroPill value={meal.protein} unit="P" color="#00D4FF" bg={tagBg} isDark={isDark} />
        <MacroPill value={meal.carbs} unit="C" color="#FF6B35" bg={tagBg} isDark={isDark} />
        <MacroPill value={meal.fats} unit="F" color="#00E676" bg={tagBg} isDark={isDark} />
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
  isDark,
}: {
  value: number;
  unit: string;
  color: string;
  bg: string;
  isDark: boolean;
}) {
  const textColor = isDark ? "#FFFFFF" : "#0A0A0F";
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
    color: "#00E676",
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
