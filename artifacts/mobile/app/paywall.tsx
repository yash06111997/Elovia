import React, { useState, useEffect } from "react";
import { getPublicApiUrl } from "@/utils/api";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  BackHandler,
  Alert,
  Linking,
} from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Space } from "@/constants/design";
import { useTheme } from "@/hooks/useTheme";
import { useSubscription } from "@/context/SubscriptionContext";
import { useRevenueCat } from "@/lib/revenuecat";
import { useAuth } from "@/lib/auth";
import {
  PREMIUM_FEATURES,
  PAYWALL_COPY,
  FAQ_ITEMS,
} from "@/constants/subscription";
import { trackEvent } from "@/lib/telemetry";

type PlanKey = "yearly" | "monthly" | "lifetime";

export default function PaywallScreen() {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { startTrial, refreshEntitlement, isTrialActive } = useSubscription();
  const { isAuthenticated, login } = useAuth();
  const rc = useRevenueCat();
  const params = useLocalSearchParams<{ postOnboarding?: string }>();
  const isPostOnboarding = params.postOnboarding === "1";
  const navigation = useNavigation();
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("yearly");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

  useEffect(() => {
    void trackEvent("paywall_viewed", {
      source: isPostOnboarding ? "onboarding" : "app",
    });
  }, [isPostOnboarding]);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !isPostOnboarding });
  }, [isPostOnboarding, navigation]);

  useEffect(() => {
    if (!isPostOnboarding) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [isPostOnboarding]);

  const currentOffering = rc.offerings?.current;
  const packages = currentOffering?.availablePackages ?? [];

  const monthlyPkg = packages.find(
    (p) => p.packageType === "MONTHLY" || p.identifier === "$rc_monthly",
  );
  const yearlyPkg = packages.find(
    (p) => p.packageType === "ANNUAL" || p.identifier === "$rc_annual",
  );
  const lifetimePkg = packages.find(
    (p) => p.packageType === "LIFETIME" || p.identifier === "$rc_lifetime",
  );

  const monthlyPrice = monthlyPkg?.product.priceString;
  const yearlyPrice = yearlyPkg?.product.priceString;
  const lifetimePrice = lifetimePkg?.product.priceString;

  const monthlyRaw = monthlyPkg?.product.price ?? 0;
  const yearlyRaw = yearlyPkg?.product.price ?? 0;

  const yearlyMonthlyFormatted = (() => {
    if (!yearlyPkg || !monthlyRaw) return "";
    const perMonth = yearlyRaw / 12;
    const sym =
      yearlyPkg.product.priceString?.replace(/[\d.,\s]/g, "").trim() || "";
    return `${sym}${perMonth.toFixed(2)}/mo`;
  })();
  const savingsPercent =
    monthlyRaw > 0 ? Math.round((1 - yearlyRaw / (monthlyRaw * 12)) * 100) : 0;

  const selectedPackage =
    selectedPlan === "yearly"
      ? yearlyPkg
      : selectedPlan === "lifetime"
        ? lifetimePkg
        : monthlyPkg;
  const firstAvailablePlan: PlanKey | null = yearlyPkg
    ? "yearly"
    : monthlyPkg
      ? "monthly"
      : lifetimePkg
        ? "lifetime"
        : null;

  useEffect(() => {
    if (!selectedPackage && firstAvailablePlan) {
      setSelectedPlan(firstAvailablePlan);
    }
  }, [firstAvailablePlan, selectedPackage]);

  const waitForServerAccess = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const entitlement = await refreshEntitlement();
      if (entitlement?.hasProAccess) return true;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return false;
  };

  const handleStartTrial = async () => {
    await startTrial();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (isPostOnboarding) {
      router.replace("/(tabs)");
    } else {
      router.back();
    }
  };

  const handleContinueFree = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPostOnboarding) {
      router.replace("/(tabs)");
    } else {
      router.back();
    }
  };

  const handlePurchase = async () => {
    if (!selectedPackage) return;
    setConfirmVisible(true);
  };

  const confirmPurchase = async () => {
    setConfirmVisible(false);
    if (!selectedPackage) return;
    try {
      await rc.purchase(selectedPackage);
      const accessReady = await waitForServerAccess();
      if (!accessReady) {
        Alert.alert(
          "Purchase received",
          "The store confirmed your purchase, but Elovia is still syncing access. Use Restore Purchases in a moment; you will not be charged again.",
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (isPostOnboarding) {
        router.replace("/(tabs)");
      } else {
        router.back();
      }
    } catch (e: any) {
      if (!e?.userCancelled) {
        console.log("Purchase error:", e);
      }
    }
  };

  const handleRestore = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await rc.restore();
      const accessReady = await waitForServerAccess();
      Alert.alert(
        accessReady ? "Purchases restored" : "No active access found",
        accessReady
          ? "Your Elovia access is active."
          : "No active Elovia subscription was found for this signed-in account.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.log("Restore error:", e);
    }
  };

  const showTrialButton = isTrialActive;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 },
        ]}
      >
        {!isPostOnboarding && (
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.closeBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={theme.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: Colors.primary + "20" },
            ]}
          >
            <Ionicons name="diamond" size={36} color={Colors.primary} />
          </View>
          <Text style={[styles.headline, { color: theme.text }]}>
            {PAYWALL_COPY.headline}
          </Text>
          <Text style={[styles.subheadline, { color: theme.textSecondary }]}>
            {PAYWALL_COPY.subheadline}
          </Text>
        </View>

        <View style={styles.featuresSection}>
          {PREMIUM_FEATURES.map((feature, i) => (
            <View
              key={i}
              style={[styles.featureRow, { borderBottomColor: theme.border }]}
            >
              <View
                style={[
                  styles.featureIcon,
                  { backgroundColor: Colors.primary + "15" },
                ]}
              >
                <Ionicons
                  name={feature.icon as any}
                  size={20}
                  color={Colors.primary}
                />
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: theme.text }]}>
                  {feature.title}
                </Text>
                <Text
                  style={[styles.featureDesc, { color: theme.textSecondary }]}
                >
                  {feature.description}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.planSection}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Choose Your Plan
          </Text>

          {yearlyPkg && (
            <TouchableOpacity
              style={[
                styles.planCard,
                {
                  backgroundColor:
                    selectedPlan === "yearly"
                      ? Colors.primary + "12"
                      : theme.card,
                  borderColor:
                    selectedPlan === "yearly" ? Colors.primary : theme.border,
                  borderWidth: selectedPlan === "yearly" ? 2 : 1,
                },
              ]}
              onPress={() => {
                setSelectedPlan("yearly");
                Haptics.selectionAsync();
              }}
              activeOpacity={0.8}
            >
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>BEST VALUE</Text>
              </View>
              <View style={styles.planInfo}>
                <View style={styles.planRadio}>
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor:
                          selectedPlan === "yearly"
                            ? Colors.primary
                            : theme.textMuted,
                      },
                    ]}
                  >
                    {selectedPlan === "yearly" && (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: Colors.primary },
                        ]}
                      />
                    )}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: theme.text }]}>
                    Yearly Premium
                  </Text>
                  <Text
                    style={[styles.planPrice, { color: theme.textSecondary }]}
                  >
                    {yearlyPrice}
                  </Text>
                  <Text
                    style={[styles.planSaving, { color: Colors.accentGreen }]}
                  >
                    {yearlyMonthlyFormatted} · Save {savingsPercent}%
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {monthlyPkg && (
            <TouchableOpacity
              style={[
                styles.planCard,
                {
                  backgroundColor:
                    selectedPlan === "monthly"
                      ? Colors.primary + "12"
                      : theme.card,
                  borderColor:
                    selectedPlan === "monthly" ? Colors.primary : theme.border,
                  borderWidth: selectedPlan === "monthly" ? 2 : 1,
                },
              ]}
              onPress={() => {
                setSelectedPlan("monthly");
                Haptics.selectionAsync();
              }}
              activeOpacity={0.8}
            >
              <View style={styles.planInfo}>
                <View style={styles.planRadio}>
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor:
                          selectedPlan === "monthly"
                            ? Colors.primary
                            : theme.textMuted,
                      },
                    ]}
                  >
                    {selectedPlan === "monthly" && (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: Colors.primary },
                        ]}
                      />
                    )}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: theme.text }]}>
                    Monthly Premium
                  </Text>
                  <Text
                    style={[styles.planPrice, { color: theme.textSecondary }]}
                  >
                    {monthlyPrice}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {lifetimePkg && (
            <TouchableOpacity
              style={[
                styles.planCard,
                {
                  backgroundColor:
                    selectedPlan === "lifetime"
                      ? Colors.primary + "12"
                      : theme.card,
                  borderColor:
                    selectedPlan === "lifetime" ? Colors.primary : theme.border,
                  borderWidth: selectedPlan === "lifetime" ? 2 : 1,
                },
              ]}
              onPress={() => {
                setSelectedPlan("lifetime");
                Haptics.selectionAsync();
              }}
              activeOpacity={0.8}
            >
              <View style={styles.planBadgeLifetime}>
                <Text style={styles.planBadgeLifetimeText}>ONE TIME</Text>
              </View>
              <View style={styles.planInfo}>
                <View style={styles.planRadio}>
                  <View
                    style={[
                      styles.radioOuter,
                      {
                        borderColor:
                          selectedPlan === "lifetime"
                            ? Colors.primary
                            : theme.textMuted,
                      },
                    ]}
                  >
                    {selectedPlan === "lifetime" && (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: Colors.primary },
                        ]}
                      />
                    )}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: theme.text }]}>
                    Lifetime Premium
                  </Text>
                  <Text
                    style={[styles.planPrice, { color: theme.textSecondary }]}
                  >
                    {lifetimePrice}
                  </Text>
                  <Text
                    style={[styles.planSaving, { color: Colors.accentGreen }]}
                  >
                    Pay once, own forever
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {rc.isOfferingsLoading && (
            <View
              style={[
                styles.planState,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
              ]}
            >
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.planStateTitle, { color: theme.text }]}>
                Loading subscription plans…
              </Text>
              <Text
                style={[styles.planStateBody, { color: theme.textSecondary }]}
              >
                Checking the App Store for current prices.
              </Text>
            </View>
          )}

          {packages.length === 0 && !rc.isOfferingsLoading && (
            <View
              style={[
                styles.planState,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons
                name="cloud-offline-outline"
                size={26}
                color={theme.textMuted}
              />
              <Text
                accessibilityRole="alert"
                style={[styles.planStateTitle, { color: theme.text }]}
              >
                Plans unavailable
              </Text>
              <Text
                style={[styles.planStateBody, { color: theme.textSecondary }]}
              >
                We couldn&apos;t load current store prices. Check your
                connection and try again.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={[styles.retryButton, { borderColor: Colors.primary }]}
                onPress={() => void rc.refetchOfferings()}
                activeOpacity={0.75}
              >
                <Text
                  style={[styles.retryButtonText, { color: Colors.primary }]}
                >
                  Try again
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {!isAuthenticated ? (
          <TouchableOpacity
            style={[styles.ctaPrimary, { backgroundColor: Colors.primary }]}
            onPress={login}
            activeOpacity={0.85}
          >
            <Ionicons name="log-in-outline" size={20} color="#000" />
            <Text style={styles.ctaPrimaryText}>
              Sign in to Start Trial or Subscribe
            </Text>
          </TouchableOpacity>
        ) : showTrialButton ? (
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
            style={[
              styles.ctaPrimary,
              {
                backgroundColor: Colors.primary,
                opacity: rc.isPurchasing ? 0.7 : 1,
              },
            ]}
            onPress={handlePurchase}
            activeOpacity={0.85}
            disabled={
              rc.isPurchasing || rc.isOfferingsLoading || !selectedPackage
            }
          >
            {rc.isPurchasing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="diamond" size={20} color="#000" />
                <Text style={styles.ctaPrimaryText}>
                  {selectedPlan === "lifetime"
                    ? "Buy Lifetime Access"
                    : "Subscribe Now"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {showTrialButton && (
          <Text style={[styles.trialNote, { color: theme.textSecondary }]}>
            {PAYWALL_COPY.trialNote}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.ctaSecondary, { borderColor: theme.border }]}
          onPress={handleContinueFree}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.ctaSecondaryText, { color: theme.textSecondary }]}
          >
            {isPostOnboarding
              ? "Continue with Free"
              : PAYWALL_COPY.ctaSecondary}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.restoreBtn}
          onPress={handleRestore}
          disabled={rc.isRestoring}
          activeOpacity={0.7}
        >
          {rc.isRestoring ? (
            <ActivityIndicator size="small" color={theme.textMuted} />
          ) : (
            <Text style={[styles.restoreText, { color: theme.textMuted }]}>
              {PAYWALL_COPY.ctaRestore}
            </Text>
          )}
        </TouchableOpacity>

        {/*
          Required by App Store Review 3.1.2 and Play's subscription policy: the
          purchase screen itself must state the renewal terms and carry working
          links to the terms and the privacy policy. Burying these in Settings
          is a routine rejection, and it is the kind of rejection that costs a
          review cycle rather than an afternoon.
        */}
        <View style={styles.legalSection}>
          <Text style={[styles.legalText, { color: theme.textMuted }]}>
            Subscriptions renew automatically at the price shown until
            cancelled. Cancel any time in your{" "}
            {Platform.OS === "ios" ? "Apple ID" : "Google Play"} account
            settings; cancelling takes effect at the end of the current period.
            Lifetime access is a one-time purchase and does not renew.
          </Text>
          <View style={styles.legalLinks}>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(getPublicApiUrl("/api/legal/terms"))
              }
              hitSlop={10}
              accessibilityRole="link"
              accessibilityLabel="Terms of Use"
            >
              <Text style={[styles.legalLink, { color: theme.textSecondary }]}>
                Terms of Use
              </Text>
            </TouchableOpacity>
            <Text style={[styles.legalText, { color: theme.textMuted }]}>
              ·
            </Text>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(getPublicApiUrl("/api/legal/privacy"))
              }
              hitSlop={10}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              <Text style={[styles.legalLink, { color: theme.textSecondary }]}>
                Privacy Policy
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.trustSection}>
          {PAYWALL_COPY.trustItems.map((item, i) => (
            <View key={i} style={styles.trustRow}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={Colors.accentGreen}
              />
              <Text style={[styles.trustText, { color: theme.textSecondary }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.comparisonSection,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.text, marginBottom: 16 },
            ]}
          >
            Free vs Premium
          </Text>
          <View style={styles.compHeader}>
            <Text
              style={[
                styles.compHeaderLabel,
                { color: theme.textMuted, flex: 1 },
              ]}
            >
              Feature
            </Text>
            <Text
              style={[
                styles.compHeaderLabel,
                { color: theme.textMuted, width: 60, textAlign: "center" },
              ]}
            >
              Free
            </Text>
            <Text
              style={[
                styles.compHeaderLabel,
                { color: Colors.primary, width: 72, textAlign: "center" },
              ]}
            >
              Premium
            </Text>
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
            <View
              key={i}
              style={[styles.compRow, { borderTopColor: theme.border }]}
            >
              <Text style={[styles.compName, { color: theme.text }]}>
                {row.name}
              </Text>
              <View style={{ width: 60, alignItems: "center" }}>
                <Ionicons
                  name={row.free ? "checkmark-circle" : "close-circle"}
                  size={18}
                  color={row.free ? Colors.accentGreen : theme.textMuted}
                />
              </View>
              <View style={{ width: 72, alignItems: "center" }}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={Colors.accentGreen}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.faqSection}>
          <Text
            style={[
              styles.sectionTitle,
              { color: theme.text, marginBottom: 12 },
            ]}
          >
            FAQ
          </Text>
          {FAQ_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.faqItem,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
              onPress={() => setExpandedFaq(expandedFaq === i ? null : i)}
              activeOpacity={0.8}
            >
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQuestion, { color: theme.text }]}>
                  {item.question}
                </Text>
                <Ionicons
                  name={expandedFaq === i ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={theme.textMuted}
                />
              </View>
              {expandedFaq === i && (
                <Text
                  style={[styles.faqAnswer, { color: theme.textSecondary }]}
                >
                  {item.answer}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              Confirm Purchase
            </Text>
            <Text style={[styles.modalBody, { color: theme.textSecondary }]}>
              {selectedPlan === "lifetime"
                ? `You are about to purchase Lifetime Premium for ${lifetimePrice ?? "the listed price"}.`
                : selectedPlan === "yearly"
                  ? `You are about to subscribe to Yearly Premium for ${yearlyPrice ?? "the listed price"}.`
                  : `You are about to subscribe to Monthly Premium for ${monthlyPrice ?? "the listed price"}.`}
            </Text>
            <TouchableOpacity
              style={[styles.modalConfirm, { backgroundColor: Colors.primary }]}
              onPress={confirmPurchase}
              activeOpacity={0.85}
            >
              <Text style={styles.modalConfirmText}>Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setConfirmVisible(false)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.modalCancelText, { color: theme.textSecondary }]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  closeBtn: { padding: 8 },
  scrollContent: { paddingHorizontal: 20 },
  heroSection: { alignItems: "center", marginTop: 8, marginBottom: 28 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  headline: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subheadline: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  featuresSection: { marginBottom: 28 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  featureDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  planSection: { marginBottom: 24 },
  planState: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  planStateTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  planStateBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    maxWidth: 300,
  },
  retryButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  retryButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  planCard: {
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    overflow: "hidden",
  },
  planBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  planBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#000",
    letterSpacing: 0.5,
  },
  planBadgeLifetime: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: Colors.accentGreen,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  planBadgeLifetimeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#000",
    letterSpacing: 0.5,
  },
  planInfo: { flexDirection: "row", alignItems: "center" },
  planRadio: { marginRight: 14 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 12, height: 12, borderRadius: 6 },
  planName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  planPrice: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  planSaving: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  ctaPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 14,
    marginBottom: 8,
  },
  ctaPrimaryText: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#000" },
  trialNote: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
  },
  ctaSecondary: {
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  ctaSecondaryText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  restoreBtn: { alignItems: "center", paddingVertical: 12, marginBottom: 24 },
  restoreText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "underline",
  },
  legalSection: {
    gap: Space.sm,
    paddingHorizontal: Space.xs,
    marginTop: Space.lg,
  },
  legalText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Space.sm,
  },
  legalLink: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textDecorationLine: "underline",
  },
  trustSection: { marginBottom: 28 },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  trustText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  comparisonSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 28,
  },
  compHeader: { flexDirection: "row", alignItems: "center", paddingBottom: 8 },
  compHeaderLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
  },
  compRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 0.5,
  },
  compName: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  faqSection: { marginBottom: 20 },
  faqItem: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  faqHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  faqQuestion: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    marginRight: 8,
  },
  faqAnswer: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginTop: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 12 },
  modalBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
  },
  modalConfirm: {
    width: "100%",
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  modalConfirmText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#000",
  },
  modalCancel: { paddingVertical: 12 },
  modalCancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
