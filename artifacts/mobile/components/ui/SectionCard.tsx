import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Space, Radius, MIN_TOUCH } from "@/constants/design";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

export interface SectionCardProps {
  title: string;
  /** Right-aligned qualifier on the title line, e.g. "Updated today". */
  subtitle?: string;
  /** Shows an Edit affordance in the header when provided. */
  onEdit?: () => void;
  children: React.ReactNode;
}

/**
 * A titled group of related content.
 *
 * Previously defined inside profile.tsx and therefore unavailable to every
 * other screen, which is why several of them hand-rolled a near-identical card
 * with slightly different padding and radius.
 */
export function SectionCard({ title, subtitle, onEdit, children }: SectionCardProps) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {onEdit ? (
          <TouchableOpacity
            onPress={onEdit}
            style={styles.editButton}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${title}`}
          >
            <Text style={[styles.edit, { color: Colors.primary }]}>Edit</Text>
          </TouchableOpacity>
        ) : subtitle ? (
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xl, borderWidth: 1, padding: Space.lg, gap: 0 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: Space.md,
  },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 11, fontFamily: "Inter_400Regular" },
  editButton: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: "flex-end",
    justifyContent: "center",
    marginVertical: -Space.md,
  },
  edit: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
