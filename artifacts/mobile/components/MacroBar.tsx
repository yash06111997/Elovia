import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
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

export function MacroBar({ label, current, target, unit = "g", color, isDark = true }: Props) {
  const progress = useSharedValue(0);
  const pct = target > 0 ? Math.min(current / target, 1) : 0;

  useEffect(() => {
    progress.value = withSpring(pct, { damping: 15 });
  }, [pct]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const textColor = isDark ? "#FFFFFF" : "#0A0A0F";
  const mutedColor = isDark ? "#8A8A9E" : "#5A5A7A";
  const trackColor = isDark ? "#1A1A24" : "#E4E6F0";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        <Text style={[styles.value, { color: mutedColor }]}>
          <Text style={{ color: textColor, fontWeight: "600" }}>{Math.round(current)}</Text>
          /{Math.round(target)}{unit}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.bar, { backgroundColor: color }, barStyle]} />
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
