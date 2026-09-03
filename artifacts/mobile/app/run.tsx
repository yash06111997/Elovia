import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  BackHandler,
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
import { useAuth } from "@/lib/auth";
import { toLocalDateKey } from "@/lib/health";
import {
  useRunTracker,
  formatPace,
  formatDuration,
  simplifyRunRoute,
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
  const { user } = useAuth();
  const [autoPause, setAutoPause] = useState(true);

  const weightKg = appState.profile?.weightKg ?? 70;

  const {
    status,
    stats,
    autoPaused,
    gpsAccuracy,
    trackingMode,
    recovered,
    recorderError,
    hydrated,
    start,
    pause,
    resume,
    stop,
    completeSave,
    reset,
  } = useRunTracker({ weightKg, autoPause, ownerUserId: user?.id ?? null });

  const discardAndExit = React.useCallback(async () => {
    try {
      if (await reset()) {
        router.back();
        return;
      }
    } catch {
      // The same blocking message applies to a rejected cleanup operation.
    }
    Alert.alert(
      "Could not discard safely",
      "Elovia could not stop background recording yet. Keep this screen open and try again.",
    );
  }, [reset]);

  const confirmDiscardAndExit = React.useCallback(() => {
    Alert.alert("Leave this run?", "Your active recording will be discarded.", [
      { text: "Keep recording", style: "cancel" },
      {
        text: "Discard run",
        style: "destructive",
        onPress: () => void discardAndExit(),
      },
    ]);
  }, [discardAndExit]);

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let result;
    try {
      result = await start();
    } catch {
      Alert.alert(
        "Could not start",
        "Elovia could not create a safe run recording. Check device storage and try again.",
      );
      return;
    }
    if (!result.started) {
      const servicesDisabled = result.reason === "services_disabled";
      Alert.alert(
        servicesDisabled ? "Turn on location services" : "Location needed",
        servicesDisabled
          ? "Location services are off. Turn them on before starting a run."
          : "Elovia could not start GPS recording. Check location access in Settings and try again.",
        [
          { text: "Not now", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
      return;
    }
    if (result.mode === "foreground" && Platform.OS !== "web") {
      Alert.alert(
        "Keep Elovia open",
        "The run has started, but background location is off. Keep this screen open or allow background location in Settings for lock-screen recording.",
        [
          { text: "Continue", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
    }
  };

  const handleFinish = () => {
    if (stats.distanceKm < 0.05) {
      Alert.alert(
        "Nothing recorded yet",
        "Move a little further before saving this one.",
        [
          { text: "Keep going", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => void discardAndExit(),
          },
        ],
      );
      return;
    }

    Alert.alert(
      "Finish this activity?",
      "Your route and splits will be saved.",
      [
        { text: "Keep going", style: "cancel" },
        {
          text: "Finish",
          onPress: async () => {
            try {
              const finished = await stop();
              if (!finished) {
                Alert.alert(
                  "Could not finish",
                  "Elovia could not safely stop and preserve this run. Your draft is still available; try again.",
                );
                return;
              }
              const session = await addRunSession({
                id: finished.sessionId,
                date: toLocalDateKey(new Date(finished.startedAt)),
                startTime: new Date(finished.startedAt).toISOString(),
                endTime: new Date(finished.endedAt).toISOString(),
                distanceKm: Math.round(finished.stats.distanceKm * 100) / 100,
                durationMins: Math.round(finished.stats.durationSec / 60),
                durationSec: Math.round(finished.stats.durationSec),
                avgPaceMinKm:
                  Math.round((finished.stats.avgPaceMinPerKm ?? 0) * 100) / 100,
                elevationGainM: finished.stats.elevationGainM,
                splits: finished.stats.splits,
                route: simplifyRunRoute(finished.stats.points),
                caloriesBurned: finished.stats.calories,
              });
              const cleared = await completeSave(finished.sessionId);
              if (!cleared) {
                throw new Error("The saved run draft could not be cleared.");
              }
              await Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              router.replace({
                pathname: "/run-summary",
                params: { id: session.id },
              });
            } catch {
              Alert.alert(
                "Run not saved yet",
                "Your complete run is still stored safely on this device. Check your connection or storage and tap Finish again.",
              );
            }
          },
        },
      ],
    );
  };

  const isActive = status === "recording" || status === "paused";

  React.useEffect(() => {
    if (!isActive) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        confirmDiscardAndExit();
        return true;
      },
    );
    return () => subscription.remove();
  }, [confirmDiscardAndExit, isActive]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "Record Activity",
          headerShown: true,
          headerBackVisible: !isActive,
          gestureEnabled: !isActive,
          headerLeft: isActive
            ? () => (
                <TouchableOpacity
                  onPress={confirmDiscardAndExit}
                  accessibilityRole="button"
                  accessibilityLabel="Leave active run"
                  testID="run-leave-button"
                  hitSlop={12}
                >
                  <Ionicons name="close" size={25} color={theme.text} />
                </TouchableOpacity>
              )
            : undefined,
        }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <RunRouteMap points={stats.points} live height={230} />

        {recovered && isActive && (
          <View
            style={[
              styles.statusBanner,
              { backgroundColor: Colors.accentGreen + "18" },
            ]}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={18}
              color={Colors.accentGreen}
            />
            <View style={styles.statusCopy}>
              <Text style={[styles.statusTitle, { color: Colors.accentGreen }]}>
                Run restored
              </Text>
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                Your recorded route, time and splits were recovered from this
                device.
              </Text>
            </View>
          </View>
        )}

        {isActive && trackingMode && Platform.OS !== "web" && (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor:
                  trackingMode === "background"
                    ? Colors.primary + "16"
                    : Colors.accentYellow + "18",
              },
            ]}
          >
            <Ionicons
              name={
                trackingMode === "background"
                  ? "lock-closed-outline"
                  : "phone-portrait-outline"
              }
              size={18}
              color={
                trackingMode === "background"
                  ? Colors.primary
                  : Colors.accentYellow
              }
            />
            <View style={styles.statusCopy}>
              <Text
                style={[
                  styles.statusTitle,
                  {
                    color:
                      trackingMode === "background"
                        ? Colors.primary
                        : Colors.accentYellow,
                  },
                ]}
              >
                {trackingMode === "background"
                  ? "Lock-screen tracking on"
                  : "Foreground tracking"}
              </Text>
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                {trackingMode === "background"
                  ? "Elovia keeps recording when this screen is locked or another app is open."
                  : "Keep Elovia open so GPS points are not interrupted."}
              </Text>
            </View>
          </View>
        )}

        {recorderError && (
          <View
            style={[
              styles.statusBanner,
              { backgroundColor: Colors.accentRed + "18" },
            ]}
          >
            <Ionicons
              name="warning-outline"
              size={18}
              color={Colors.accentRed}
            />
            <Text
              accessibilityRole="alert"
              style={[styles.statusText, { color: Colors.accentRed, flex: 1 }]}
            >
              {recorderError}
            </Text>
          </View>
        )}

        <View style={styles.primaryStat}>
          <Text
            style={[
              styles.distanceValue,
              tabularNumbers,
              { color: theme.text },
            ]}
          >
            {stats.distanceKm.toFixed(2)}
          </Text>
          <Text style={[styles.distanceUnit, { color: theme.textMuted }]}>
            kilometres
          </Text>
        </View>

        {autoPaused && status === "recording" && (
          <View
            style={[
              styles.autoPauseBanner,
              { backgroundColor: Colors.accentYellow + "20" },
            ]}
          >
            <Ionicons
              name="pause-circle-outline"
              size={16}
              color={Colors.accentYellow}
            />
            <Text
              style={[styles.autoPauseText, { color: Colors.accentYellow }]}
            >
              Auto-paused — start moving to resume
            </Text>
          </View>
        )}

        <View style={styles.statRow}>
          <BigStat
            label="Time"
            value={formatDuration(stats.durationSec)}
            theme={theme}
          />
          <BigStat
            label="Pace"
            value={formatPace(
              stats.currentPaceMinPerKm ?? stats.avgPaceMinPerKm,
            )}
            suffix="/km"
            theme={theme}
          />
          <BigStat
            label="Calories"
            value={String(stats.calories)}
            theme={theme}
          />
        </View>

        <View style={styles.statRow}>
          <SmallStat
            label="Avg pace"
            value={`${formatPace(stats.avgPaceMinPerKm)} /km`}
            theme={theme}
          />
          <SmallStat
            label="Elevation"
            value={`${stats.elevationGainM} m`}
            theme={theme}
          />
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
            accessibilityRole="checkbox"
            accessibilityState={{ checked: autoPause }}
            accessibilityLabel="Automatically pause when I stop moving"
          >
            <Ionicons
              name={autoPause ? "checkbox-outline" : "square-outline"}
              size={20}
              color={autoPause ? Colors.primary : theme.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionTitle, { color: theme.text }]}>
                Auto-pause
              </Text>
              <Text style={[styles.optionDesc, { color: theme.textMuted }]}>
                Stop the clock automatically at traffic lights and rest stops
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {stats.splits.length > 0 && (
          <View
            style={[
              styles.splitsCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.splitsTitle, { color: theme.text }]}>
              Splits
            </Text>
            {stats.splits.map((split) => {
              const fastest = Math.min(
                ...stats.splits.map((s) => s.paceMinPerKm),
              );
              const isFastest =
                stats.splits.length > 1 && split.paceMinPerKm === fastest;
              return (
                <View key={split.index} style={styles.splitRow}>
                  <Text style={[styles.splitKm, { color: theme.textMuted }]}>
                    {split.index}
                  </Text>
                  <View
                    style={[
                      styles.splitBar,
                      {
                        backgroundColor: isFastest
                          ? Colors.primary
                          : theme.border,
                        // Scale bar length against the slowest split.
                        width: `${Math.max(
                          15,
                          (fastest / Math.max(0.1, split.paceMinPerKm)) * 100,
                        )}%`,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.splitPace,
                      tabularNumbers,
                      { color: theme.text },
                    ]}
                  >
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
            GPS recording needs the mobile app. This screen is preview only on
            web.
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
            style={[
              styles.primaryBtn,
              { backgroundColor: hydrated ? Colors.primary : theme.border },
            ]}
            onPress={handleStart}
            activeOpacity={0.85}
            disabled={!hydrated}
            accessibilityRole="button"
            accessibilityLabel="Start recording run"
            accessibilityState={{ disabled: !hydrated }}
            testID="run-start-button"
          >
            {hydrated ? (
              <Ionicons name="play" size={20} color="#000" />
            ) : (
              <ActivityIndicator size="small" color={theme.textMuted} />
            )}
            <Text style={styles.primaryBtnText}>
              {hydrated ? "Start" : "Preparing…"}
            </Text>
          </TouchableOpacity>
        )}

        {isActive && (
          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: theme.border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                void (status === "recording" ? pause() : resume())
                  .then((changed) => {
                    if (!changed) {
                      Alert.alert(
                        "Run unchanged",
                        `Elovia could not ${status === "recording" ? "pause" : "resume"} this run safely. Try again.`,
                      );
                    }
                  })
                  .catch(() => {
                    Alert.alert(
                      "Run unchanged",
                      `Elovia could not ${status === "recording" ? "pause" : "resume"} this run safely. Try again.`,
                    );
                  });
              }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                status === "recording" ? "Pause run" : "Resume run"
              }
              testID="run-pause-resume-button"
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
              style={[
                styles.primaryBtn,
                { backgroundColor: Colors.accentRed, flex: 1 },
              ]}
              onPress={handleFinish}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Finish and save run"
              testID="run-finish-button"
            >
              <Ionicons name="stop" size={20} color="#FFF" />
              <Text style={[styles.primaryBtnText, { color: "#FFF" }]}>
                Finish
              </Text>
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
      <Text
        style={[styles.bigStatValue, tabularNumbers, { color: theme.text }]}
      >
        {value}
        {suffix ? (
          <Text style={[styles.bigStatSuffix, { color: theme.textMuted }]}>
            {suffix}
          </Text>
        ) : null}
      </Text>
      <Text style={[styles.bigStatLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
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
      <Text
        style={[
          styles.smallStatValue,
          tabularNumbers,
          { color: tone ?? theme.textSecondary },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.smallStatLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },

  primaryStat: { alignItems: "center", gap: 2 },
  distanceValue: {
    fontSize: 56,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.5,
  },
  distanceUnit: { fontSize: 13, fontFamily: "Inter_500Medium" },

  autoPauseBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  autoPauseText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statusBanner: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  statusCopy: { flex: 1, gap: 2 },
  statusTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },

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
  splitsTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  splitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  splitKm: { fontSize: 11, fontFamily: "Inter_500Medium", width: 16 },
  splitBar: { height: 6, borderRadius: 3, maxWidth: "60%" },
  splitPace: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginLeft: "auto",
  },

  webNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },

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
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#000",
  },
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
