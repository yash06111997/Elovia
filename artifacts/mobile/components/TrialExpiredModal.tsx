import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { TRIAL_EXPIRED_COPY } from "@/constants/subscription";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function TrialExpiredModal({ visible, onDismiss }: Props) {
  const { theme } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.accentYellow + "20" }]}>
            <Ionicons name="time-outline" size={32} color={Colors.accentYellow} />
          </View>

          <Text style={[styles.headline, { color: theme.text }]}>{TRIAL_EXPIRED_COPY.headline}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{TRIAL_EXPIRED_COPY.body}</Text>
          <Text style={[styles.subtext, { color: theme.textMuted }]}>{TRIAL_EXPIRED_COPY.subtext}</Text>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: Colors.primary }]}
            onPress={() => {
              onDismiss();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/paywall");
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="diamond" size={18} color="#000" />
            <Text style={styles.upgradeBtnText}>{TRIAL_EXPIRED_COPY.ctaUpgrade}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.freeBtn} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={[styles.freeBtnText, { color: theme.textSecondary }]}>{TRIAL_EXPIRED_COPY.ctaFree}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: 28, alignItems: "center" },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  headline: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 12 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 8, paddingHorizontal: 8 },
  subtext: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 24 },
  upgradeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 50, borderRadius: 14, marginBottom: 10 },
  upgradeBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#000" },
  freeBtn: { paddingVertical: 12 },
  freeBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
