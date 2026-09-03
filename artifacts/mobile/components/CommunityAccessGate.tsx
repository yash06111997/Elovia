import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Radius, Space } from "@/constants/design";
import { PressableScale } from "@/components/Pressable";
import { useTheme } from "@/hooks/useTheme";
import { getPublicApiUrl, type CommunityAccess } from "@/utils/api";

export function CommunityAccessGate({
  access,
  age,
  accepting,
  error,
  onAccept,
}: {
  access: CommunityAccess;
  age: number | null | undefined;
  accepting: boolean;
  error: string | null;
  onAccept: () => Promise<void>;
}) {
  const { theme } = useTheme();
  const [confirmed, setConfirmed] = useState(false);
  const eligible = typeof age === "number" && age >= access.minimumAge;

  useEffect(() => {
    setConfirmed(false);
  }, [access.termsVersion]);

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.icon, { backgroundColor: Colors.primary + "18" }]}>
        <Ionicons name="people-outline" size={30} color={Colors.primary} />
      </View>

      <Text style={[styles.title, { color: theme.text }]}>Join Community</Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        Community is where adult athletes can share selected activities, give
        kudos, add friends, and join challenges. Your private workouts, meals,
        health readings, and location are never shared automatically.
      </Text>

      <View
        style={[
          styles.notice,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Ionicons
          name={eligible ? "shield-checkmark-outline" : "lock-closed-outline"}
          size={21}
          color={eligible ? Colors.accentGreen : Colors.accentRed}
        />
        <View style={styles.noticeCopy}>
          <Text style={[styles.noticeTitle, { color: theme.text }]}>
            Adults only
          </Text>
          <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>
            You must be at least {access.minimumAge} years old to use Community.
            {typeof age === "number"
              ? eligible
                ? " Your profile is eligible."
                : " Your profile is not eligible."
              : " Complete your age in your profile before continuing."}
          </Text>
        </View>
      </View>

      {eligible ? (
        <>
          <PressableScale
            style={[
              styles.checkboxRow,
              {
                backgroundColor: confirmed ? Colors.primary + "12" : theme.card,
                borderColor: confirmed ? Colors.primary : theme.border,
              },
            ]}
            onPress={() => setConfirmed((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmed, disabled: accepting }}
            accessibilityLabel={`I confirm I am at least ${access.minimumAge} and agree to the Community Standards`}
            disabled={accepting}
          >
            <Ionicons
              name={confirmed ? "checkbox" : "square-outline"}
              size={24}
              color={confirmed ? Colors.primary : theme.textMuted}
            />
            <Text style={[styles.checkboxLabel, { color: theme.text }]}>
              I confirm I am at least {access.minimumAge} and agree to the
              Community Standards.
            </Text>
          </PressableScale>

          <PressableScale
            style={styles.link}
            onPress={() =>
              void Linking.openURL(
                getPublicApiUrl("/api/legal/community-standards"),
              )
            }
            accessibilityRole="link"
            accessibilityLabel="Read Community Standards"
          >
            <Text style={[styles.linkText, { color: Colors.primary }]}>
              Read Community Standards
            </Text>
            <Ionicons name="open-outline" size={16} color={Colors.primary} />
          </PressableScale>
        </>
      ) : null}

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: Colors.accentRed }]}
        >
          {error}
        </Text>
      ) : null}

      {eligible ? (
        <PressableScale
          style={[
            styles.primaryButton,
            {
              backgroundColor:
                confirmed && !accepting ? Colors.primary : theme.border,
            },
          ]}
          onPress={() => void onAccept()}
          disabled={!confirmed || accepting}
          accessibilityRole="button"
          accessibilityLabel="Accept Community Standards and continue"
          accessibilityState={{
            disabled: !confirmed || accepting,
            busy: accepting,
          }}
        >
          {accepting ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryButtonText}>Enter Community</Text>
          )}
        </PressableScale>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xxl,
    gap: Space.lg,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontSize: 25,
    lineHeight: 31,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  notice: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.lg,
  },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  noticeBody: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  checkboxRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Space.lg,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_500Medium",
  },
  link: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Space.sm,
  },
  linkText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  error: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  primaryButton: {
    minHeight: 52,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
});
