import React from "react";
import { Colors } from "@/constants/colors";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useEffect } from "react";

interface Props {
  label: string;
  current: number;
  target: number;
  unit?: string;
  color: string;
  isDark?: boolean;
}

export function MacroBar({ label, current, target, unit = "g", color }: Props) {
  const progress = useSharedValue(0);
  const safeCurrent = Math.max(0, Number.isFinite(current) ? current : 0);
  const safeTarget = Math.max(0, Number.isFinite(target) ? target : 0);
  const pct = safeTarget > 0 ? Math.min(safeCurrent / safeTarget, 1) : 0;
  const roundedCurrent = Math.round(safeCurrent);
  const roundedTarget = Math.round(safeTarget);
  const spokenUnit = unit === "g" ? "grams" : unit;

  useEffect(() => {
    progress.value = withSpring(pct, {
      damping: 15,
      reduceMotion: ReduceMotion.System,
    });
  }, [pct]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const textColor = Colors.dark.text;
  const mutedColor = Colors.dark.textSecondary;
  const trackColor = Colors.dark.card;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        <Text style={[styles.value, { color: mutedColor }]}>
          <Text style={{ color: textColor, fontWeight: "600" }}>
            {roundedCurrent}
          </Text>
          /{roundedTarget}
          {unit}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{
          min: 0,
          max: safeTarget > 0 ? roundedTarget : 1,
          now: safeTarget > 0 ? Math.min(roundedCurrent, roundedTarget) : 0,
          text:
            safeTarget > 0
              ? `${roundedCurrent} of ${roundedTarget} ${spokenUnit}`
              : `${roundedCurrent} ${spokenUnit} recorded; no target set`,
        }}
        style={[styles.track, { backgroundColor: trackColor }]}
      >
        <Animated.View
          style={[styles.bar, { backgroundColor: color }, barStyle]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  value: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    borderRadius: 3,
  },
});
