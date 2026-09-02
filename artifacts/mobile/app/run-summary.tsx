import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RunRouteMap } from "@/components/RunRouteMap";
import { Colors } from "@/constants/colors";
import { tabularNumbers } from "@/constants/design";
import { useHealth } from "@/context/HealthContext";
import { useTheme } from "@/hooks/useTheme";
import { formatDuration, formatPace } from "@/lib/runTracker";

export default function RunSummaryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const runId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { healthData } = useHealth();
  const run = healthData.runSessions.find((session) => session.id === runId);

  if (!run) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: "Run summary" }} />
        <Ionicons name="map-outline" size={42} color={theme.textMuted} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>Run not found</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>This activity may not have finished saving.</Text>
        <TouchableOpacity style={[styles.doneButton, { backgroundColor: Colors.primary }]} onPress={() => router.back()}>
          <Text style={styles.doneButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const durationSec = run.durationSec ?? run.durationMins * 60;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Run summary", headerShown: true }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headingRow}>
          <View>
            <Text style={[styles.eyebrow, { color: Colors.accentGreen }]}>ACTIVITY SAVED</Text>
            <Text style={[styles.title, { color: theme.text }]}>Outdoor run</Text>
            <Text style={[styles.date, { color: theme.textSecondary }]}>{new Date(run.startTime).toLocaleString()}</Text>
          </View>
          <View style={[styles.savedIcon, { backgroundColor: Colors.accentGreen + "20" }]}>
            <Ionicons name="checkmark" size={24} color={Colors.accentGreen} />
          </View>
        </View>

        <RunRouteMap points={run.route} height={300} />

        <View style={styles.metricGrid}>
          <Metric label="Distance" value={run.distanceKm.toFixed(2)} suffix="km" />
          <Metric label="Moving time" value={formatDuration(durationSec)} />
          <Metric label="Average pace" value={formatPace(run.avgPaceMinKm)} suffix="/km" />
          <Metric label="Calories" value={String(run.caloriesBurned)} suffix="kcal" />
          <Metric label="Elevation" value={String(run.elevationGainM ?? 0)} suffix="m" />
          <Metric label="GPS points" value={String(run.route.length)} />
        </View>

        {!!run.splits?.length && (
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Kilometre splits</Text>
            {run.splits.map((split) => (
              <View key={split.index} style={[styles.splitRow, { borderTopColor: theme.border }]}>
                <Text style={[styles.splitIndex, { color: theme.textSecondary }]}>Km {split.index}</Text>
                <Text style={[styles.splitValue, tabularNumbers, { color: theme.text }]}>{formatPace(split.paceMinPerKm)}</Text>
                <Text style={[styles.splitElevation, { color: theme.textMuted }]}>+{split.elevationGainM} m</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={[styles.doneButton, { backgroundColor: Colors.primary }]} onPress={() => router.back()} activeOpacity={0.85}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.metricValue, tabularNumbers, { color: theme.text }]}>
        {value}{suffix ? <Text style={[styles.metricSuffix, { color: theme.textMuted }]}> {suffix}</Text> : null}
      </Text>
      <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 18 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.1 },
  title: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold", marginTop: 3 },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  savedIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "48%", flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  metricValue: { fontSize: 21, fontFamily: "Inter_700Bold" },
  metricSuffix: { fontSize: 11, fontFamily: "Inter_500Medium" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  splitRow: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 11 },
  splitIndex: { width: 64, fontSize: 12, fontFamily: "Inter_500Medium" },
  splitValue: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  splitElevation: { fontSize: 11, fontFamily: "Inter_400Regular" },
  doneButton: { borderRadius: 14, alignItems: "center", justifyContent: "center", paddingVertical: 16 },
  doneButtonText: { color: "#000", fontSize: 16, fontFamily: "Inter_700Bold" },
  empty: { flex: 1, padding: 32, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 8 },
});
