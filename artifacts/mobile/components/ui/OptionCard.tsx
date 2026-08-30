import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Space, Radius } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * The premium pill.
 *
 * Was inlined twice in workouts.tsx with the same style object written out
 * longhand each time, which is how two copies of one idea drift apart.
 */
export function PremiumBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>PREMIUM</Text>
    </View>
  );
}

export interface OptionCardProps {
  icon: IoniconName;
  title: string;
  description: string;
  onPress: () => void;
  /**
   * Tints the icon and, when `emphasised`, the border. Defaults to the brand
   * colour. Use Semantic.manual for user-authored paths so they read as
   * distinct from AI ones.
   */
  accent?: string;
  /** Draws the border in the accent colour, marking the recommended path. */
  emphasised?: boolean;
  /** Shows the PREMIUM pill. Does not itself prevent the press. */
  locked?: boolean;
}

/**
 * A large tappable choice with an icon, title and explanation.
 *
 * Used where a screen offers a handful of mutually exclusive routes forward -
 * the workouts empty state offers four. Written out longhand each card cost
 * roughly 35 lines apiece and let the four drift in padding and radius.
 *
 * `locked` only draws the pill; it deliberately does not block `onPress`,
 * because the press should still do something for a locked user - route them
 * to the paywall - rather than silently ignore them. A control that appears
 * tappable and does nothing is worse than one that explains itself.
 */
export function OptionCard({
  icon,
  title,
  description,
  onPress,
  accent = Colors.primary,
  emphasised = false,
  locked = false,
}: OptionCardProps) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: emphasised ? accent + "40" : theme.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={locked ? `${title}. Premium feature.` : title}
      accessibilityHint={description}
    >
      <View style={[styles.iconWrap, { backgroundColor: accent + "20" }]}>
        <Ionicons name={icon} size={28} color={accent} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.desc, { color: theme.textSecondary }]}>{description}</Text>
      </View>
      {locked ? <PremiumBadge /> : null}
      <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Space.lg + 2,
    borderRadius: Radius.xl,
    borderWidth: 1,
    gap: Space.md + 2,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, gap: Space.xs },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  desc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  badge: {
    backgroundColor: Colors.primary + "20",
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    marginRight: Space.xs,
  },
  badgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: Colors.primary },
});
