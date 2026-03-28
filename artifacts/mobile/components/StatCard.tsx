import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  title: string;
  value: string;
  unit?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  isDark?: boolean;
  onPress?: () => void;
  trend?: "up" | "down" | "neutral";
  subtitle?: string;
}

export function StatCard({
  title,
  value,
  unit,
  icon,
  iconColor = "#00D4FF",
  isDark = true,
  onPress,
  trend,
  subtitle,
}: Props) {
  const cardBg = isDark ? "#1A1A24" : "#FFFFFF";
  const textColor = isDark ? "#FFFFFF" : "#0A0A0F";
  const mutedColor = isDark ? "#8A8A9E" : "#5A5A7A";
  const borderColor = isDark ? "#2A2A3A" : "#E4E6F0";

  const trendColor =
    trend === "up" ? "#00E676" : trend === "down" ? "#FF3D71" : "#8A8A9E";
  const trendIcon =
    trend === "up" ? "trending-up" : trend === "down" ? "trending-down" : undefined;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: cardBg, borderColor }]}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={!onPress}
    >
      <View style={[styles.iconBg, { backgroundColor: iconColor + "20" }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.title, { color: mutedColor }]}>{title}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: textColor }]}>{value}</Text>
        {unit && <Text style={[styles.unit, { color: mutedColor }]}>{unit}</Text>}
        {trendIcon && (
          <Ionicons name={trendIcon as any} size={14} color={trendColor} style={{ marginLeft: 4 }} />
        )}
      </View>
      {subtitle && <Text style={[styles.subtitle, { color: mutedColor }]}>{subtitle}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  title: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  unit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  subtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
