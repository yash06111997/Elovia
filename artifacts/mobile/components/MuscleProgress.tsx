import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import type { WorkoutSession } from "@/context/WorkoutContext";
import { MUSCLE_GROUPS, muscleHistory } from "@/lib/workoutAnalytics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";

export function MuscleProgress({ sessions }: { sessions: WorkoutSession[] }) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const [muscle, setMuscle] = useState("Chest");
  const [metric, setMetric] = useState<"volume" | "sets" | "reps">("volume");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useMemo(() => muscleHistory(sessions, muscle), [sessions, muscle]);
  const points = history.slice(-12);
  const selected = history.find(s => s.sessionId === selectedId) || history[history.length - 1];
  const previous = selected ? history[history.indexOf(selected) - 1] : undefined;
  const max = Math.max(1, ...points.map(p => p[metric]));
  const unit = metric === "volume" ? "kg" : metric;
  const delta = selected && previous ? selected[metric] - previous[metric] : null;
  const totals = new Map<string, { name: string; sets: number; reps: number; volume: number }>();
  for (const session of history) for (const ex of session.exercises) {
    const prev = totals.get(ex.id) || { name: ex.name, sets: 0, reps: 0, volume: 0 };
    totals.set(ex.id, { name: ex.name, sets: prev.sets + ex.sets, reps: prev.reps + ex.reps, volume: prev.volume + ex.volume });
  }
  const card = { padding: 16, borderRadius: 16, backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, gap: 12 } as const;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.text, fontSize: 20, fontFamily: "Inter_700Bold" }}>Muscle progress</Text>
    <Text style={{ color: theme.textSecondary }}>Compare sessions for each primary muscle. Volume = logged kg × reps. Warm-ups are excluded; bodyweight movements track sets and reps.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {MUSCLE_GROUPS.map(group => <TouchableOpacity key={group} onPress={() => { setMuscle(group); setSelectedId(null); }} accessibilityRole="button" accessibilityState={{ selected: muscle === group }} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: muscle === group ? Colors.primary : theme.card, justifyContent: "center" }}><Text style={{ color: muscle === group ? "#000" : theme.text }}>{group}</Text></TouchableOpacity>)}
    </ScrollView>
    <View style={{ flexDirection: "row", gap: 8 }}>{(["volume", "sets", "reps"] as const).map(value => <TouchableOpacity key={value} onPress={() => setMetric(value)} accessibilityRole="button" accessibilityState={{ selected: metric === value }} style={{ minHeight: 48, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: metric === value ? Colors.primary + "25" : theme.card }}><Text style={{ color: metric === value ? Colors.primary : theme.text }}>{value === "volume" ? "Volume (kg)" : value === "sets" ? "Sets" : "Reps"}</Text></TouchableOpacity>)}</View>
    {!selected ? <View style={card}><Text style={{ color: theme.textSecondary }}>No working sets logged for {muscle} yet. Finish a workout to start this chart.</Text></View> : <>
      <View style={card}>
        <Text style={{ color: theme.text, fontFamily: "Inter_600SemiBold" }}>{muscle} · {selected.date}</Text>
        <Text style={{ color: Colors.primary, fontSize: 28, fontFamily: "Inter_700Bold" }}>{selected[metric].toLocaleString()} {unit}</Text>
        <Text style={{ color: theme.textSecondary }}>{previous ? `Previous session (${previous.date}): ${previous[metric].toLocaleString()} ${unit}. Change: ${delta! > 0 ? "+" : ""}${delta!.toLocaleString()} ${unit}.` : "First recorded session for this muscle."}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: width - 72, gap: 12, alignItems: "flex-end", paddingTop: 8 }}>
          {points.map((point, i) => <TouchableOpacity key={point.sessionId} onPress={() => setSelectedId(point.sessionId)} accessibilityRole="button" accessibilityLabel={`${muscle}, ${point.date}, ${point[metric]} ${unit}, ${point.sets} sets, ${point.reps} reps`} accessibilityState={{ selected: point.sessionId === selected.sessionId }} style={{ minWidth: 48, alignItems: "center", gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 11 }}>{point[metric].toLocaleString()}</Text>
            <View style={{ height: Math.max(3, point[metric] / max * 120), width: 30, borderRadius: 6, backgroundColor: point.sessionId === selected.sessionId ? Colors.primary : Colors.accent }} />
            <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{point.date.slice(5)}</Text>
          </TouchableOpacity>)}
        </ScrollView>
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Last {points.length} muscle sessions · tap a bar for details</Text>
      </View>
      <View style={card}><Text style={{ color: theme.text, fontFamily: "Inter_700Bold" }}>{selected.name} · exercise breakdown</Text>
        <Text style={{ color: theme.textSecondary }}>{selected.sets} working sets · {selected.reps} reps · {selected.volume.toLocaleString()} kg volume</Text>
        {selected.exercises.map(ex => <View key={ex.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}><Text style={{ color: theme.text }}>{ex.name}</Text><Text style={{ color: theme.textSecondary }}>{ex.sets} sets · {ex.reps} reps · {ex.volume.toLocaleString()} kg volume</Text></View>)}
      </View>
      <View style={card}><Text style={{ color: theme.text, fontFamily: "Inter_700Bold" }}>{muscle} · totals across saved history</Text>{[...totals].map(([id, ex]) => <View key={id} style={{ gap: 4 }}><Text style={{ color: theme.text }}>{ex.name}</Text><Text style={{ color: theme.textSecondary }}>{ex.sets} sets · {ex.reps} reps · {ex.volume.toLocaleString()} kg volume</Text></View>)}</View>
    </>}
  </View>;
}
