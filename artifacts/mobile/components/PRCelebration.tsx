import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import type { RecordAchievement } from "@/lib/workoutAnalytics";
import { useWorkout } from "@/context/WorkoutContext";
import { useFocusEffect } from "expo-router";

export function LiveRecordCelebration() {
  const { liveRecords, dismissRecords } = useWorkout();
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(React.useCallback(() => { setIsFocused(true); return () => setIsFocused(false); }, []));
  return <PRCelebration records={isFocused ? liveRecords : []} onDismiss={dismissRecords} />;
}

export function PRCelebration({ records, onDismiss }: { records: RecordAchievement[]; onDismiss: () => void }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [reducedMotion, setReducedMotion] = useState(true);
  const fall = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss); dismissRef.current = onDismiss;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setReducedMotion(v); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { active = false; sub.remove(); };
  }, []);
  useEffect(() => {
    if (!records.length) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility(`Personal record. ${records.map(r => `${r.exerciseName}: ${r.label}, ${r.value} ${r.unit}`).join(". ")}`);
    fall.setValue(0);
    const animation = Animated.timing(fall, { toValue: 1, duration: 1800, useNativeDriver: true });
    if (!reducedMotion) animation.start();
    const timeout = setTimeout(() => dismissRef.current(), 6500);
    return () => { clearTimeout(timeout); animation.stop(); };
  }, [records, reducedMotion, fall]);
  if (!records.length) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
    {!reducedMotion && <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 28 }, (_, i) => <Animated.View key={i} style={{ position: "absolute", left: ((i * 37) % 100) / 100 * width, top: -20 - (i % 4) * 40, width: 6 + i % 5, height: 12, borderRadius: 2, backgroundColor: [Colors.primary, Colors.accentYellow, Colors.accent, Colors.accentGreen][i % 4], opacity: fall.interpolate({ inputRange: [0, .8, 1], outputRange: [1, 1, 0] }), transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, height * .65] }) }, { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${i % 2 ? 270 : -270}deg`] }) }] }} />)}
    </View>}
    <View style={[styles.card, { top: insets.top + 56, backgroundColor: theme.card, borderColor: Colors.accentYellow }]}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Ionicons name="trophy" size={32} color={Colors.accentYellow} />
        <View style={{ flex: 1 }}><Text style={[styles.title, { color: theme.text }]}>Personal record!</Text><Text style={{ color: theme.textSecondary }}>{records[0].exerciseName}</Text></View>
        <TouchableOpacity onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss personal record celebration" style={styles.close}><Ionicons name="close" size={22} color={theme.text} /></TouchableOpacity>
      </View>
      <Text style={{ color: theme.text, marginTop: 8 }}>{records.map(r => `${r.label}: ${r.value.toLocaleString()} ${r.unit}`).join(" · ")}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({ card: { position: "absolute", left: 16, right: 16, padding: 16, borderRadius: 20, borderWidth: 1, elevation: 10 }, title: { fontFamily: "Inter_700Bold", fontSize: 19 }, close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" } });
