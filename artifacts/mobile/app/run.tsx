import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { tabularNumbers } from "@/constants/design";
import { RunRouteMap } from "@/components/RunRouteMap";
import { useTheme } from "@/hooks/useTheme";
import { useApp } from "@/context/AppContext";
import { useHealth } from "@/context/HealthContext";
import {
  useRunTracker,
  formatPace,
  formatDuration,
} from "@/lib/runTracker";

/**
 * Live activity recorder.
 *
 * The platform map keeps the runner oriented while the route and live metrics
 * update over it.
 */
export default function RunScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState } = useApp();
  const { addRunSession } = useHealth();
  const [autoPause, setAutoPause] = useState(true);

  const weightKg = appState.profile?.weightKg ?? 70;

  const { status, stats, autoPaused, gpsAccuracy, start, pause, resume, stop, reset } =
    useRunTracker({ weightKg, autoPause });

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await start();
    if (!ok) {
      Alert.alert(
        "Location needed",
        "Elovia needs location access to record your route. You can enable it in Settings.",
      );
    }
  };

  const handleFinish = () => {
    if (stats.distanceKm < 0.05) {
      Alert.alert("Nothing recorded yet", "Move a little further before saving this one.", [
        { text: "Keep going", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            reset();
            router.back();
          },
        },
      ]);
      return;
    }

    Alert.alert("Finish this activity?", "Your route and splits will be saved.", [
      { text: "Keep going", style: "cancel" },
      {
        text: "Finish",
        onPress: () => {
          stop();
          const now = new Date();
          const startedAt = new Date(now.getTime() - stats.durationSec * 1000);

          const session = addRunSession({
            date: now.toISOString().split("T")[0],
            startTime: startedAt.toISOString(),
            endTime: now.toISOString(),
            distanceKm: Math.round(stats.distanceKm * 100) / 100,
            durationMins: Math.round(stats.durationSec / 60),
            durationSec: Math.round(stats.durationSec),
            avgPaceMinKm: Math.round((stats.avgPaceMinPerKm ?? 0) * 100) / 100,
            elevationGainM: stats.elevationGainM,
            splits: stats.splits,
            route: stats.points.map((p) => ({
              latitude: p.latitude,
              longitude: p.longitude,
            })),
            caloriesBurned: stats.calories,
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace({ pathname: "/run-summary", params: { id: session.id } });
        },
      },
    ]);
  };

  const isActive = status === "recording" || status === "paused";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Record Activity", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <RunRouteMap points={stats.points} live height={230} />

        <View style={styles.primaryStat}>
          <Text style={[styles.distanceValue, tabularNumbers, { color: theme.text }]}>
            {stats.distanceKm.toFixed(2)}
          </Text>
          <Text style={[styles.distanceUnit, { color: theme.textMuted }]}>kilometres</Text>
        </View>

        {autoPaused && status === "recording" && (
          <View style={[styles.autoPauseBanner, { backgroundColor: Colors.accentYellow + "20" }]}>
            <Ionicons name="pause-circle-outline" size={16} color={Colors.accentYellow} />
            <Text style={[styles.autoPauseText, { color: Colors.accentYellow }]}>
              Auto-paused — start moving to resume
            </Text>
          </View>
        )}

        <View style={styles.statRow}>
          <BigStat label="Time" value={formatDuration(stats.durationSec)} theme={theme} />
          <BigStat
            label="Pace"
            value={formatPace(stats.currentPaceMinPerKm ?? stats.avgPaceMinPerKm)}
            suffix="/km"
            theme={theme}
          />
          <BigStat label="Calories" value={String(stats.calories)} theme={theme} />
        </View>

        <View style={styles.statRow}>
          <SmallStat label="Avg pace" value={`${formatPace(stats.avgPaceMinPerKm)} /km`} theme={theme} />
          <SmallStat label="Elevation" value={`${stats.elevationGainM} m`} theme={theme} />
          <SmallStat
            label="GPS"
            value={gpsAccuracy == null ? "—" : `±${Math.round(gpsAccuracy)} m`}
            theme={theme}
            tone={
              gpsAccuracy == null
                ? undefined
                : gpsAccuracy <= 10
                  ? Colors.accentGreen
                  : gpsAccuracy <= 25
                    ? Colors.accentYellow
                    : Colors.accentRed
            }
          />
        </View>

        {status === "idle" && (
          <TouchableOpacity
            style={[styles.optionRow, { borderColor: theme.border }]}
            onPress={() => setAutoPause((v) => !v)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={autoPause ? "checkbox-outline" : "square-outline"}
              size={20}
              color={autoPause ? Colors.primary : theme.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionTitle, { color: theme.text }]}>Auto-pause</Text>
              <Text style={[styles.optionDesc, { color: theme.textMuted }]}>
                Stop the clock automatically at traffic lights and rest stops
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {stats.splits.length > 0 && (
          <View style={[styles.splitsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.splitsTitle, { color: theme.text }]}>Splits</Text>
            {stats.splits.map((split) => {
              const fastest = Math.min(...stats.splits.map((s) => s.paceMinPerKm));
              const isFastest = stats.splits.length > 1 && split.paceMinPerKm === fastest;
              return (
                <View key={split.index} style={styles.splitRow}>
                  <Text style={[styles.splitKm, { color: theme.textMuted }]}>
                    {split.index}
                  </Text>
                  <View
                    style={[
                      styles.splitBar,
                      {
                        backgroundColor: isFastest ? Colors.primary : theme.border,
                        // Scale bar length against the slowest split.
                        width: `${Math.max(
                          15,
                          (fastest / Math.max(0.1, split.paceMinPerKm)) * 100,
                        )}%`,
                      },
                    ]}
                  />
                  <Text style={[styles.splitPace, tabularNumbers, { color: theme.text }]}>
                    {formatPace(split.paceMinPerKm)}
                  </Text>
                  {isFastest && (
                    <Ionicons name="flash" size={13} color={Colors.primary} />
                  )}
                </View>
              );
            })}
          </View>
        )}

        {Platform.OS === "web" && (
          <Text style={[styles.webNote, { color: theme.textMuted }]}>
            GPS recording needs the mobile app. This screen is preview only on web.
          </Text>
        )}
      </ScrollView>

      <View
        style={[
          styles.controls,
          {
            backgroundColor: theme.background,
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        {status === "idle" && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: Colors.primary }]}
            onPress={handleStart}
            activeOpacity={0.85}
          >
            <Ionicons name="play" size={20} color="#000" />
            <Text style={styles.primaryBtnText}>Start</Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                status === "recording" ? pause() : resume();
              }}
              activeOpacity={0.85}
            >
              <Ionicons
                name={status === "recording" ? "pause" : "play"}
                size={20}
                color={theme.text}
              />
              <Text style={[styles.secondaryBtnText, { color: theme.text }]}>
                {status === "recording" ? "Pause" : "Resume"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: Colors.accentRed, flex: 1 }]}
              onPress={handleFinish}
              activeOpacity={0.85}
            >
              <Ionicons name="stop" size={20} color="#FFF" />
              <Text style={[styles.primaryBtnText, { color: "#FFF" }]}>Finish</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function BigStat({
  label,
  value,
  suffix,
  theme,
}: {
  label: string;
  value: string;
  suffix?: string;
  theme: any;
}) {
  return (
    <View style={styles.bigStat}>
      <Text style={[styles.bigStatValue, tabularNumbers, { color: theme.text }]}>
        {value}
        {suffix ? <Text style={[styles.bigStatSuffix, { color: theme.textMuted }]}>{suffix}</Text> : null}
      </Text>
      <Text style={[styles.bigStatLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function SmallStat({
  label,
  value,
  theme,
  tone,
}: {
  label: string;
  value: string;
  theme: any;
  tone?: string;
}) {
  return (
    <View style={styles.smallStat}>
      <Text style={[styles.smallStatValue, tabularNumbers, { color: tone ?? theme.textSecondary }]}>
        {value}
      </Text>
      <Text style={[styles.smallStatLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },

  primaryStat: { alignItems: "center", gap: 2 },
  distanceValue: { fontSize: 56, fontFamily: "Inter_700Bold", letterSpacing: -1.5 },
  distanceUnit: { fontSize: 13, fontFamily: "Inter_500Medium" },

  autoPauseBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  autoPauseText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  statRow: { flexDirection: "row", gap: 10 },
  bigStat: { flex: 1, alignItems: "center", gap: 2 },
  bigStatValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  bigStatSuffix: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bigStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },

  smallStat: { flex: 1, alignItems: "center", gap: 2 },
  smallStatValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  smallStatLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  optionTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  optionDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  splitsCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  splitsTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  splitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  splitKm: { fontSize: 11, fontFamily: "Inter_500Medium", width: 16 },
  splitBar: { height: 6, borderRadius: 3, maxWidth: "60%" },
  splitPace: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginLeft: "auto" },

  webNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },

  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  controlRow: { flexDirection: "row", gap: 10 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#000" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 22,
  },
  secondaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
