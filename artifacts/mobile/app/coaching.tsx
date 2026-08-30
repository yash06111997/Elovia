import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Space, Radius, tabularNumbers } from "@/constants/design";
import { PressableScale, FadeInView } from "@/components/Pressable";
import { useTheme } from "@/hooks/useTheme";
import { COACHING } from "@/constants/subscription";
import { fetchEntitlement, type EntitlementStatus } from "@/utils/api";

/**
 * One-to-one coaching.
 *
 * Two states: someone who already has coaching sees how to reach their coach;
 * everyone else sees what it is and can book a free intro call.
 *
 * Payment happens on the web rather than through in-app purchase. Apple's
 * Review Guideline 3.1.3(d) permits this for one-to-one real-time services,
 * which live coaching calls are. Consequently this screen must never present
 * a price as a purchasable in-app product or link to a checkout - it offers a
 * conversation, and the commercial discussion happens on the call.
 */
export default function CoachingScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [entitlement, setEntitlement] = useState<EntitlementStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEntitlement()
      .then(setEntitlement)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const openBooking = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(COACHING.bookingUrl);
      if (!supported) throw new Error("unsupported");
      await Linking.openURL(COACHING.bookingUrl);
    } catch {
      Alert.alert(
        "Could not open the booking page",
        `Visit ${COACHING.bookingUrl} in your browser to book a call.`,
      );
    }
  }, []);

  const hasCoaching = entitlement?.hasCoaching === true;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Coaching", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />}

        {!loading && hasCoaching && (
          <FadeInView>
            <View
              style={[
                styles.activeCard,
                { backgroundColor: Colors.accentGreen + "12", borderColor: Colors.accentGreen + "40" },
              ]}
            >
              <View style={[styles.activeIcon, { backgroundColor: Colors.accentGreen + "20" }]}>
                <Ionicons name="checkmark-circle" size={24} color={Colors.accentGreen} />
              </View>
              <Text style={[styles.activeTitle, { color: theme.text }]}>
                Your coaching is active
              </Text>
              <Text style={[styles.activeBody, { color: theme.textSecondary }]}>
                Book your next session whenever you're ready. Your coach can see everything you
                log here, so there's no need to write it up beforehand.
              </Text>
            </View>
          </FadeInView>
        )}

        {!loading && !hasCoaching && (
          <>
            <FadeInView>
              <Text style={[styles.headline, { color: theme.text }]}>{COACHING.headline}</Text>
              <Text style={[styles.subheadline, { color: theme.textSecondary }]}>
                {COACHING.subheadline}
              </Text>
            </FadeInView>

            <FadeInView index={1}>
              <View
                style={[styles.priceCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              >
                <View style={styles.priceRow}>
                  <Text style={[styles.price, tabularNumbers, { color: theme.text }]}>
                    {COACHING.priceLabel}
                  </Text>
                  <Text style={[styles.period, { color: theme.textMuted }]}>
                    per {COACHING.period}
                  </Text>
                </View>
                <Text style={[styles.priceNote, { color: theme.textMuted }]}>
                  Billed separately from your Elovia subscription. Cancel any time.
                </Text>
              </View>
            </FadeInView>

            <View style={styles.includes}>
              {COACHING.includes.map((item, i) => (
                <FadeInView key={item} index={i + 2}>
                  <View style={styles.includeRow}>
                    <View style={[styles.tick, { backgroundColor: Colors.primary + "18" }]}>
                      <Ionicons name="checkmark" size={13} color={Colors.primary} />
                    </View>
                    <Text style={[styles.includeText, { color: theme.textSecondary }]}>{item}</Text>
                  </View>
                </FadeInView>
              ))}
            </View>

            <FadeInView index={8}>
              <View
                style={[
                  styles.honestyCard,
                  { backgroundColor: isDark ? "#FFFFFF08" : "#00000005", borderColor: theme.border },
                ]}
              >
                <Ionicons name="people-outline" size={17} color={theme.textMuted} />
                <Text style={[styles.honestyText, { color: theme.textSecondary }]}>
                  Coaching is limited by how many people one coach can genuinely look after, so
                  places are capped. If none are free we'll tell you rather than take your money.
                </Text>
              </View>
            </FadeInView>
          </>
        )}
      </ScrollView>

      {!loading && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.background,
              borderTopColor: theme.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <PressableScale
            style={[styles.cta, { backgroundColor: Colors.primary }]}
            onPress={openBooking}
            haptic
          >
            <Ionicons name="videocam-outline" size={19} color="#000" />
            <Text style={styles.ctaText}>
              {hasCoaching ? "Book your next session" : COACHING.introCallLabel}
            </Text>
          </PressableScale>

          {!hasCoaching && (
            <Text style={[styles.ctaNote, { color: theme.textMuted }]}>
              {COACHING.introCallNote}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Space.xl, gap: Space.lg },

  headline: {
    fontSize: 27,
    lineHeight: 33,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    marginBottom: Space.sm,
  },
  subheadline: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },

  priceCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: 6 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  price: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  period: { fontSize: 14, fontFamily: "Inter_400Regular" },
  priceNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  includes: { gap: Space.md },
  includeRow: { flexDirection: "row", alignItems: "flex-start", gap: Space.md },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  includeText: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular" },

  honestyCard: {
    flexDirection: "row",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.lg,
  },
  honestyText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },

  activeCard: { borderRadius: Radius.xl, borderWidth: 1, padding: Space.xl, gap: Space.sm },
  activeIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Space.xs,
  },
  activeTitle: { fontSize: 19, fontFamily: "Inter_700Bold" },
  activeBody: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular" },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    gap: Space.sm,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Space.sm,
    borderRadius: Radius.lg,
    paddingVertical: 16,
  },
  ctaText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },
  ctaNote: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
});
