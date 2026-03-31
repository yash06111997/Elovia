import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useSubscription } from "@/context/SubscriptionContext";
import { FEATURE_LOCK_MESSAGES, type PremiumFeatureKey } from "@/constants/subscription";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  feature: PremiumFeatureKey;
  children: React.ReactNode;
  inline?: boolean;
}

export function PremiumLock({ feature, children, inline }: Props) {
  const { canAccess } = useSubscription();
  const { theme } = useTheme();

  if (canAccess(feature)) {
    return <>{children}</>;
  }

  if (inline) {
    return (
      <TouchableOpacity
        style={[styles.inlineLock, { backgroundColor: theme.card, borderColor: theme.border }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/paywall");
        }}
        activeOpacity={0.8}
      >
        <View style={[styles.lockIconSmall, { backgroundColor: Colors.primary + "20" }]}>
          <Ionicons name="lock-closed" size={14} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.lockTitle, { color: theme.text }]}>{FEATURE_LOCK_MESSAGES[feature]}</Text>
          <Text style={[styles.lockCta, { color: Colors.primary }]}>Upgrade to unlock</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.childWrapper} pointerEvents="none">
        {children}
      </View>
      <View style={[styles.overlay, { backgroundColor: theme.background + "E6" }]}>
        <View style={[styles.lockCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.lockIcon, { backgroundColor: Colors.primary + "20" }]}>
            <Ionicons name="lock-closed" size={22} color={Colors.primary} />
          </View>
          <Text style={[styles.lockText, { color: theme.text }]}>{FEATURE_LOCK_MESSAGES[feature]}</Text>
          <TouchableOpacity
            style={[styles.viewPremiumBtn, { backgroundColor: Colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/paywall");
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.viewPremiumText}>View Premium</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: "relative" },
  childWrapper: { opacity: 0.3 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center", borderRadius: 14, padding: 20 },
  lockCard: { alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 20, width: "100%" },
  lockIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  lockText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 14 },
  viewPremiumBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 },
  viewPremiumText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#000" },
  inlineLock: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  lockIconSmall: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 2 },
  lockCta: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
