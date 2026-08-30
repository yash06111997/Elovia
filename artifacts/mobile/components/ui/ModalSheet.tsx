import React from "react";
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from "react-native";
import { Space, Radius } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";

export interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * A bottom sheet.
 *
 * The scrim is capped at 85% height so the sheet can never cover the whole
 * screen - on a phone that reads as a new page rather than something layered
 * over what you were doing, and users then reach for the back gesture instead
 * of dismissing.
 *
 * Tapping the scrim closes it, which is the expectation on both platforms, and
 * `onRequestClose` wires the Android hardware back button to the same action.
 * Sheets that ignore hardware back are one of the clearest tells that an app
 * was not built for Android.
 */
export function ModalSheet({ visible, onClose, title, children }: ModalSheetProps) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <ScrollView style={{ maxHeight: "85%" }} bounces={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={styles.handle} />
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            {children}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#00000060", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    padding: Space.xxl,
    paddingBottom: Space.huge,
    gap: Space.md + 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#444",
    alignSelf: "center",
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
});
