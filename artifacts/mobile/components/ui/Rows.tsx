import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Space, Radius, MIN_TOUCH } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";

/**
 * Row primitives.
 *
 * These lived inside app/(tabs)/profile.tsx, which meant no other screen could
 * use them - so every other screen built its own row out of raw View and inline
 * styles, and chose its own colours doing it. That is the mechanism behind the
 * hardcoded literals this refactor removed, and moving these out is what stops
 * it recurring.
 *
 * None of them take a `theme` prop. The originals all did, which drilled the
 * same object through every call site for no benefit now the app is dark-only.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface NavRowProps {
  icon: IoniconName;
  label: string;
  /** Secondary line under the label. Omit for a single-line row. */
  hint?: string;
  onPress: () => void;
}

/** A row that navigates somewhere. Always shows a chevron. */
export function NavRow({ icon, label, hint, onPress }: NavRowProps) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.navIcon, { backgroundColor: Colors.primary + "15" }]}>
        <Ionicons name={icon} size={17} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.navLabel, { color: theme.text }]}>{label}</Text>
        {hint ? <Text style={[styles.navHint, { color: theme.textMuted }]}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

export interface InfoRowProps {
  label: string;
  value: string;
  /** Renders the value in the brand colour, for the one figure that matters. */
  highlight?: boolean;
}

/** A read-only label/value pair. */
export function InfoRow({ label, value, highlight }: InfoRowProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.infoRow, { borderBottomColor: theme.border }]}>
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: highlight ? Colors.primary : theme.text }]}>
        {value}
      </Text>
    </View>
  );
}

export interface TappableRowProps {
  label: string;
  value: string;
  onPress: () => void;
  /** Short status word shown as a pill, e.g. "Connected". */
  badge?: string;
  badgeColor?: string;
}

/** A label/value pair that opens something, with an optional status pill. */
export function TappableRow({ label, value, onPress, badge, badgeColor }: TappableRowProps) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.infoRow, { borderBottomColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.tappableRight}>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: (badgeColor ?? Colors.primary) + "20" }]}>
            <Text style={[styles.badgeText, { color: badgeColor ?? Colors.primary }]}>{badge}</Text>
          </View>
        ) : null}
        <Text style={[styles.infoValue, { color: theme.text }]}>{value}</Text>
        <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export interface StatItemProps {
  label: string;
  value: string;
  style?: ViewStyle;
}

/** A compact metric, sized to sit several-across in a row. */
export function StatItem({ label, value, style }: StatItemProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statItem, style]}>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    paddingVertical: 11,
    minHeight: MIN_TOUCH,
  },
  navIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  navHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: Space.sm + 2,
    borderBottomWidth: 1,
  },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "right" },

  tappableRight: { flexDirection: "row", alignItems: "center", gap: Space.sm },
  badge: { paddingHorizontal: Space.sm, paddingVertical: 3, borderRadius: Radius.pill },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  statItem: { flex: 1, alignItems: "center", gap: Space.xs },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
