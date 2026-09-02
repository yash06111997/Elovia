import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Space, Radius, MIN_TOUCH } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";

export interface Option<T extends string> {
  value: T;
  label: string;
}

export interface OptionPickerProps<T extends string> {
  label: string;
  options: readonly Option<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
}

/**
 * Single-select from a small set of choices.
 *
 * Chips rather than a dropdown: on a phone a picker costs a tap to open, a
 * scroll, and a tap to confirm, and hides the alternatives until you commit.
 * Chips show every option at once and select in one tap. Use a picker only
 * when the list is long enough that showing it all would swamp the screen.
 *
 * Selection fires a haptic because the visual change is small - a border and a
 * tint - and on a phone in a gym that is easy to miss.
 *
 * Generic over the value type so callers get exhaustive checking on their own
 * union rather than a bare string.
 */
export function OptionPicker<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: OptionPickerProps<T>) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: Space.sm }}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <View style={styles.grid}>
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? Colors.primary + "20" : theme.card,
                  borderColor: active ? Colors.primary : theme.border,
                },
              ]}
              onPress={() => {
                onSelect(opt.value);
                Haptics.selectionAsync();
              }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.chipText, { color: active ? Colors.primary : theme.text }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  chip: {
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm + 2,
    borderRadius: Radius.sm + 2,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: MIN_TOUCH,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
