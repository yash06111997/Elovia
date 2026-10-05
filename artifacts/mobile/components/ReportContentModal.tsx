import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Radius, Space } from "@/constants/design";
import { PressableScale } from "@/components/Pressable";
import { useTheme } from "@/hooks/useTheme";
import type { ReportReason } from "@/utils/api";

const COMMUNITY_REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "self_harm", label: "Self-harm or immediate danger" },
  { value: "privacy", label: "Privacy or personal information" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
];

const AI_REASONS: { value: ReportReason; label: string }[] = [
  { value: "dangerous_advice", label: "Unsafe health or training advice" },
  { value: "self_harm", label: "Self-harm or crisis concern" },
  { value: "harassment", label: "Offensive or harassing response" },
  { value: "privacy", label: "Privacy concern" },
  { value: "other", label: "Incorrect or something else" },
];

export function ReportContentModal({
  visible,
  context,
  title,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  context: "community" | "ai";
  title: string;
  onClose: () => void;
  onSubmit: (reason: ReportReason, details?: string) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = context === "ai" ? AI_REASONS : COMMUNITY_REASONS;

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setDetails("");
    setError(null);
  }, [visible]);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, details.trim() || undefined);
    } catch {
      setError(
        "The report could not be sent. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: Colors.accentRed }]}>
              SAFETY
            </Text>
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          </View>
          <PressableScale
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close report"
          >
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.intro, { color: theme.textSecondary }]}>
            Choose the reason that best fits. Reports are private and reviewed
            by the safety team.
          </Text>

          <View style={styles.options} accessibilityRole="radiogroup">
            {reasons.map((item) => {
              const selected = reason === item.value;
              return (
                <PressableScale
                  key={item.value}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected
                        ? Colors.primary + "18"
                        : theme.card,
                      borderColor: selected ? Colors.primary : theme.border,
                    },
                  ]}
                  onPress={() => setReason(item.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.label}
                >
                  <Ionicons
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={20}
                    color={selected ? Colors.primary : theme.textMuted}
                  />
                  <Text style={[styles.optionLabel, { color: theme.text }]}>
                    {item.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Additional context (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.card,
              },
            ]}
            value={details}
            onChangeText={setDetails}
            placeholder="Do not include phone numbers, email addresses, or other private details."
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={500}
            accessibilityLabel="Additional report context"
          />

          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: Colors.accentRed }]}
            >
              {error}
            </Text>
          ) : null}

          <PressableScale
            style={[
              styles.submit,
              {
                backgroundColor:
                  reason && !busy ? Colors.accentRed : theme.border,
              },
            ]}
            onPress={() => void submit()}
            disabled={!reason || busy}
            accessibilityRole="button"
            accessibilityLabel="Submit report"
            accessibilityState={{ disabled: !reason || busy, busy }}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitText}>Submit report</Text>
            )}
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
  },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.1 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  content: { padding: Space.xl, gap: Space.lg, paddingBottom: 48 },
  intro: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular" },
  options: { gap: Space.sm },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  optionLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  input: {
    minHeight: 108,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
    textAlignVertical: "top",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  error: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  submit: {
    minHeight: 52,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFF", fontSize: 15, fontFamily: "Inter_700Bold" },
});
