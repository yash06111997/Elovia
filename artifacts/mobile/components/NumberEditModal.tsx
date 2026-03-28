import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (value: number) => void;
  title: string;
  unit: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  isDark: boolean;
}

export function NumberEditModal({
  visible,
  onClose,
  onSave,
  title,
  unit,
  value,
  min = 0,
  max = 999,
  step = 1,
  isDark,
}: Props) {
  const [input, setInput] = useState(value.toString());
  const theme = isDark ? Colors.dark : Colors.light;

  const handleSave = () => {
    const num = parseFloat(input);
    if (isNaN(num) || num < min || num > max) return;
    onSave(num);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={styles.handle} />
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>

          <View style={styles.inputRow}>
            <TouchableOpacity
              style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => {
                const v = Math.max(min, parseFloat(input || "0") - step);
                setInput(v.toFixed(step < 1 ? 1 : 0));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Ionicons name="remove" size={20} color={theme.text} />
            </TouchableOpacity>

            <View style={[styles.inputWrapper, { backgroundColor: theme.card, borderColor: Colors.primary }]}>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                value={input}
                onChangeText={setInput}
                keyboardType="numeric"
                autoFocus
                selectTextOnFocus
              />
              <Text style={[styles.unit, { color: theme.textSecondary }]}>{unit}</Text>
            </View>

            <TouchableOpacity
              style={[styles.stepBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => {
                const v = Math.min(max, parseFloat(input || "0") + step);
                setInput(v.toFixed(step < 1 ? 1 : 0));
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Ionicons name="add" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: theme.border }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: Colors.primary }]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000060" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 20 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#444", alignSelf: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "center" },
  stepBtn: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputWrapper: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 2, paddingHorizontal: 16, height: 56, minWidth: 140, justifyContent: "center" },
  input: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", minWidth: 60 },
  unit: { fontSize: 14, fontFamily: "Inter_500Medium", marginLeft: 4 },
  actions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: "center" },
  saveText: { color: "#000", fontSize: 15, fontFamily: "Inter_700Bold" },
});
