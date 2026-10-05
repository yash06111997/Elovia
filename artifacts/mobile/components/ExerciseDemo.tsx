import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";
import type { ExerciseEntry, ExerciseSource } from "@/utils/exerciseDatabase";

function Credit({ source }: { source?: ExerciseSource }) {
  const { theme } = useTheme();
  if (!source) return null;
  return <View style={{ gap: 4 }}><TouchableOpacity accessibilityRole="link" accessibilityLabel={`Exercise source: ${source.provider}, ${source.author}`} onPress={() => void Linking.openURL(source.url)}><Text style={{ color: theme.textSecondary, fontSize: 12 }}>{source.provider} · {source.author}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="link" accessibilityLabel={`License: ${source.license}`} onPress={() => void Linking.openURL(source.licenseUrl)}><Text style={{ color: theme.textSecondary, fontSize: 12 }}>{source.license}</Text></TouchableOpacity></View>;
}
function Clip({ demo }: { demo: NonNullable<ExerciseEntry["demo"]> }) {
  const { theme } = useTheme();
  const player = useVideoPlayer(demo.url, p => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = .25; });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  // Replay at ten seconds; short source clips loop at their natural end.
  React.useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => { if (currentTime >= 10) player.currentTime = 0; });
    return () => sub.remove();
  }, [player]);
  return <View style={{ gap: 8 }}>
    {status === "error" ? <Text style={{ color: theme.textSecondary }}>Video couldn’t load. Try again when connected.</Text> : <>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls allowsFullscreen={false} />
      <TouchableOpacity style={styles.play} accessibilityRole="button" accessibilityLabel="Replay exercise demo" disabled={status !== "readyToPlay"} onPress={() => { player.currentTime = 0; player.play(); }}><Ionicons name="play-circle" size={24} color={Colors.primary} /><Text style={{ color: theme.text }}>{status === "loading" ? "Loading video…" : "Play 10-second demo"}</Text></TouchableOpacity>
    </>}
    <Credit source={demo.source} />
  </View>;
}
export function ExerciseDemo({ exercise }: { exercise: ExerciseEntry }) {
  const { theme } = useTheme();
  const [frame, setFrame] = useState(0);
  return <View style={{ gap: 12, marginVertical: 12 }}>
    {exercise.demo ? <Clip key={exercise.demo.url} demo={exercise.demo} /> : exercise.images?.length ? <>
      <Image source={exercise.images[frame % exercise.images.length]} style={styles.video} contentFit="contain" accessibilityLabel={`${exercise.name}, demonstration position ${frame + 1}`} />
      <TouchableOpacity style={styles.play} accessibilityRole="button" accessibilityLabel="Show next demonstration position" onPress={() => setFrame((frame + 1) % exercise.images!.length)}><Ionicons name="images-outline" size={22} color={Colors.primary} /><Text style={{ color: theme.text }}>View next position</Text></TouchableOpacity>
      <Text style={{ color: theme.textSecondary }}>Photo guide · video not yet available</Text>
    </> : <Text style={{ color: theme.textSecondary }}>Follow the instructions below. Video not yet available.</Text>}
    <Credit source={exercise.source} />
  </View>;
}
const styles = StyleSheet.create({ video: { height: 210, width: "100%", borderRadius: 12, backgroundColor: "#111" }, play: { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 48 } });
