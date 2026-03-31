import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useSubscription } from "@/context/SubscriptionContext";
import {
  PREMIUM_FEATURES,
  PRICING,
  PAYWALL_COPY,
  FAQ_ITEMS,
  FREE_FEATURES,
} from "@/constants/subscription";

export default function PaywallScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { startTrial, upgradePlan, restorePurchases, state } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<"yearly" | "monthly">("yearly");
  const [restoring, setRestoring] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const handleStartTrial = () => {
    startTrial();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const handleUpgrade = () => {
    const platform = Platform.OS === "ios" ? "apple" as const : "google" as const;
    upgradePlan(platform, selectedPlan);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const handleRestore = async () => {
    setRestoring(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await restorePurchases();
    setRestoring(false);
  };

  const showTrialButton = !state.trialUsed;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.primary + "20" }]}>
            <Ionicons name="diamond" size={36} color={Colors.primary} />
          </View>
          <Text style={[styles.headline, { color: theme.text }]}>{PAYWALL_COPY.headline}</Text>
          <Text style={[styles.subheadline, { color: theme.textSecondary }]}>{PAYWALL_COPY.subheadline}</Text>
        </View>

        <View style={styles.featuresSection}>
          {PREMIUM_FEATURES.map((feature, i) => (
            <View key={i} style={[styles.featureRow, { borderBottomColor: theme.border }]}>
              <View style={[styles.featureIcon, { backgroundColor: Colors.primary + "15" }]}>
                <Ionicons name={feature.icon as any} size={20} color={Colors.primary} />
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                <Text style={[styles.featureDesc, { color: theme.textSecondary }]}>{feature.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.planSection}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Choose Your Plan</Text>

          <TouchableOpacity
            style={[
              styles.planCard,
              {
                backgroundColor: selectedPlan === "yearly" ? Colors.primary + "12" : theme.card,
                borderColor: selectedPlan === "yearly" ? Colors.primary : theme.border,
                borderWidth: selectedPlan === "yearly" ? 2 : 1,
              },
            ]}
            onPress={() => { setSelectedPlan("yearly"); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>BEST VALUE</Text>
            </View>
            <View style={styles.planInfo}>
              <View style={styles.planRadio}>
                <View style={[styles.radioOuter, { borderColor: selectedPlan === "yearly" ? Colors.primary : theme.textMuted }]}>
                  {selectedPlan === "yearly" && <View style={[styles.radioInner, { backgroundColor: Colors.primary }]} />}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planName, { color: theme.text }]}>Yearly Premium</Text>
                <Text style={[styles.planPrice, { color: theme.textSecondary }]}>{PRICING.yearly.label}</Text>
                <Text style={[styles.planSaving, { color: Colors.accentGreen }]}>
                  {PRICING.yearly.monthlyEquivalent} · Save {PRICING.yearly.savingsPercent}%
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.planCard,
              {
                backgroundColor: selectedPlan === "monthly" ? Colors.primary + "12" : theme.card,
                borderColor: selectedPlan === "monthly" ? Colors.primary : theme.border,
                borderWidth: selectedPlan === "monthly" ? 2 : 1,
              },
            ]}
            onPress={() => { setSelectedPlan("monthly"); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <View style={styles.planInfo}>
              <View style={styles.planRadio}>
                <View style={[styles.radioOuter, { borderColor: selectedPlan === "monthly" ? Colors.primary : theme.textMuted }]}>
                  {selectedPlan === "monthly" && <View style={[styles.radioInner, { backgroundColor: Colors.primary }]} />}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planName, { color: theme.text }]}>Monthly Premium</Text>
                <Text style={[styles.planPrice, { color: theme.textSecondary }]}>{PRICING.monthly.label}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {showTrialButton ? (
          <TouchableOpacity
            style={[styles.ctaPrimary, { backgroundColor: Colors.primary }]}
            onPress={handleStartTrial}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={20} color="#000" />
            <Text style={styles.ctaPrimaryText}>{PAYWALL_COPY.ctaPrimary}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.ctaPrimary, { backgroundColor: Colors.primary }]}
            onPress={handleUpgrade}
            activeOpacity={0.85}
          >
            <Ionicons name="diamond" size={20} color="#000" />
            <Text style={styles.ctaPrimaryText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        )}

        {showTrialButton && (
          <Text style={[styles.trialNote, { color: theme.textSecondary }]}>
            {PAYWALL_COPY.trialNote}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.ctaSecondary, { borderColor: theme.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={[styles.ctaSecondaryText, { color: theme.textSecondary }]}>{PAYWALL_COPY.ctaSecondary}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.restoreBtn}
          onPress={handleRestore}
          disabled={restoring}
          activeOpacity={0.7}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={theme.textMuted} />
          ) : (
            <Text style={[styles.restoreText, { color: theme.textMuted }]}>{PAYWALL_COPY.ctaRestore}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.trustSection}>
          {PAYWALL_COPY.trustItems.map((item, i) => (
            <View key={i} style={styles.trustRow}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.accentGreen} />
              <Text style={[styles.trustText, { color: theme.textSecondary }]}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.comparisonSection, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 16 }]}>Free vs Premium</Text>
          <View style={styles.compHeader}>
            <Text style={[styles.compHeaderLabel, { color: theme.textMuted, flex: 1 }]}>Feature</Text>
            <Text style={[styles.compHeaderLabel, { color: theme.textMuted, width: 60, textAlign: "center" }]}>Free</Text>
            <Text style={[styles.compHeaderLabel, { color: Colors.primary, width: 72, textAlign: "center" }]}>Premium</Text>
          </View>
          {[
            { name: "Workout tracking", free: true, premium: true },
            { name: "Meal logging", free: true, premium: true },
            { name: "Basic progress", free: true, premium: true },
            { name: "AI workout plans", free: false, premium: true },
            { name: "AI meal plans", free: false, premium: true },
            { name: "Advanced analytics", free: false, premium: true },
            { name: "PR tracking & alerts", free: false, premium: true },
            { name: "Health insights", free: false, premium: true },
            { name: "Adaptive plans", free: false, premium: true },
          ].map((row, i) => (
            <View key={i} style={[styles.compRow, { borderTopColor: theme.border }]}>
              <Text style={[styles.compName, { color: theme.text }]}>{row.name}</Text>
              <View style={{ width: 60, alignItems: "center" }}>
                <Ionicons name={row.free ? "checkmark-circle" : "close-circle"} size={18} color={row.free ? Colors.accentGreen : theme.textMuted} />
              </View>
              <View style={{ width: 72, alignItems: "center" }}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.accentGreen} />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.faqSection}>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 12 }]}>FAQ</Text>
          {FAQ_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.faqItem, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => setExpandedFaq(expandedFaq === i ? null : i)}
              activeOpacity={0.8}
            >
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQuestion, { color: theme.text }]}>{item.question}</Text>
                <Ionicons name={expandedFaq === i ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
              </View>
              {expandedFaq === i && (
                <Text style={[styles.faqAnswer, { color: theme.textSecondary }]}>{item.answer}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 4 },
  closeBtn: { padding: 8 },
  scrollContent: { paddingHorizontal: 20 },
  heroSection: { alignItems: "center", marginTop: 8, marginBottom: 28 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  headline: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 8 },
  subheadline: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, paddingHorizontal: 12 },
  featuresSection: { marginBottom: 28 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 0.5 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 14 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  featureDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  planSection: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  planCard: { borderRadius: 14, padding: 16, marginTop: 12, overflow: "hidden" },
  planBadge: { position: "absolute", top: 0, right: 0, backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10 },
  planBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#000", letterSpacing: 0.5 },
  planInfo: { flexDirection: "row", alignItems: "center" },
  planRadio: { marginRight: 14 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 12, height: 12, borderRadius: 6 },
  planName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  planPrice: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  planSaving: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  ctaPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: 14, marginBottom: 8 },
  ctaPrimaryText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#000" },
  trialNote: { textAlign: "center", fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  ctaSecondary: { alignItems: "center", justifyContent: "center", height: 46, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  ctaSecondaryText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  restoreBtn: { alignItems: "center", paddingVertical: 12, marginBottom: 24 },
  restoreText: { fontSize: 13, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
  trustSection: { marginBottom: 28 },
  trustRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  trustText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  comparisonSection: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 28 },
  compHeader: { flexDirection: "row", alignItems: "center", paddingBottom: 8 },
  compHeaderLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 0.5 },
  compName: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  faqSection: { marginBottom: 20 },
  faqItem: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  faqHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  faqQuestion: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1, marginRight: 8 },
  faqAnswer: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 10 },
});
