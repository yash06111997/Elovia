import React, { useEffect } from "react";
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { Radius, Space, Motion } from "@/constants/design";
import { useReduceMotion } from "@/components/Pressable";

/**
 * Skeleton placeholder.
 *
 * Shown instead of a spinner for anything over ~300ms. A skeleton communicates
 * the SHAPE of what is arriving, so the layout does not jump when it lands and
 * the wait feels shorter than an indeterminate spinner of the same duration.
 */
export function Skeleton({
  width,
  height = 16,
  radius = Radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme, isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const shimmer = useSharedValue(0.4);

  useEffect(() => {
    if (reduceMotion) {
      shimmer.value = 0.5;
      return;
    }

    shimmer.value = withRepeat(
      withTiming(0.85, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduceMotion, shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius: radius,
          backgroundColor: isDark ? "#22222E" : "#E4E6F0",
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A card-shaped skeleton, matching the app's standard card geometry. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <View style={styles.cardHeader}>
        <Skeleton width={40} height={40} radius={Radius.md} />
        <View style={{ flex: 1, gap: Space.sm }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={11} />
        </View>
      </View>

      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          // Taper the last line so the block reads as text rather than a slab.
          width={i === lines - 1 ? "70%" : "100%"}
          height={11}
        />
      ))}
    </View>
  );
}

/**
 * Generic empty state.
 *
 * A blank screen is the most common place a fitness app loses someone: they
 * open a tab, see nothing, and cannot tell whether it is broken or simply new.
 * An empty state must always say what goes here and offer the next action.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.card }]}>{icon}</View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>{body}</Text>
      {action ? <View style={{ marginTop: Space.sm }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
    gap: Space.md,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: Space.md },

  empty: {
    alignItems: "center",
    gap: Space.sm,
    paddingVertical: Space.huge,
    paddingHorizontal: Space.xxl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Space.xs,
  },
  emptyTitle: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
