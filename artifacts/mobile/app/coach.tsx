import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/hooks/useTheme";
import { useApp } from "@/context/AppContext";
import { useWorkout } from "@/context/WorkoutContext";
import { coachChat, type CoachMessage } from "@/utils/api";
import { handleAiError } from "@/utils/aiErrors";

const STARTERS = [
  "How do I break through a bench press plateau?",
  "Is it okay to train if I'm still sore?",
  "How much protein do I actually need?",
  "I keep skipping workouts. What should I change?",
];

/**
 * Conversational coach.
 *
 * The user's real profile and recent training are passed as context on every
 * turn, so answers reference what they are actually doing rather than giving
 * generic advice that could have come from a search engine.
 */
export default function CoachScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { state: appState } = useApp();
  const { sessions } = useWorkout();

  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const recentWorkouts = sessions.filter((s: any) => {
    const when = new Date(s.date ?? s.completedAt ?? 0).getTime();
    return Date.now() - when < 7 * 86_400_000;
  }).length;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const next: CoachMessage[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      setDraft("");
      setSending(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

      try {
        const result = await coachChat(next, appState.profile, {
          recentWorkouts,
          dailyCalorieTarget: appState.customMacros?.calories,
        });

        setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      } catch (e) {
        // Drop the optimistic user turn so the conversation does not end on an
        // unanswered question the model never actually saw.
        setMessages((prev) => prev.slice(0, -1));
        setDraft(trimmed);
        handleAiError(e, "Could not reach your coach.");
      } finally {
        setSending(false);
      }
    },
    [messages, sending, appState.profile, appState.customMacros, recentWorkouts],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <Stack.Screen options={{ title: "Coach", headerShown: true }} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.messages}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.intro}>
            <View style={[styles.introIcon, { backgroundColor: Colors.primary + "20" }]}>
              <Ionicons name="chatbubbles-outline" size={26} color={Colors.primary} />
            </View>
            <Text style={[styles.introTitle, { color: theme.text }]}>Ask your coach</Text>
            <Text style={[styles.introBody, { color: theme.textSecondary }]}>
              Training, nutrition, recovery, motivation. Your profile and recent sessions
              are taken into account.
            </Text>

            <View style={styles.starters}>
              {STARTERS.map((starter) => (
                <TouchableOpacity
                  key={starter}
                  style={[styles.starter, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => void send(starter)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.starterText, { color: theme.textSecondary }]}>
                    {starter}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {messages.map((message, index) => (
          <View
            key={`${index}_${message.role}`}
            style={[
              styles.bubble,
              message.role === "user"
                ? [styles.bubbleUser, { backgroundColor: Colors.primary }]
                : [styles.bubbleCoach, { backgroundColor: theme.card, borderColor: theme.border }],
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                { color: message.role === "user" ? "#000" : theme.text },
              ]}
            >
              {message.content}
            </Text>
          </View>
        ))}

        {sending && (
          <View
            style={[
              styles.bubble,
              styles.bubbleCoach,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.background,
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { backgroundColor: theme.card, borderColor: theme.border, color: theme.text },
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask anything about your training"
          placeholderTextColor={theme.textMuted}
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: draft.trim() && !sending ? Colors.primary : theme.border },
          ]}
          onPress={() => void send(draft)}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
        >
          <Ionicons
            name="arrow-up"
            size={20}
            color={draft.trim() && !sending ? "#000" : theme.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messages: { padding: 16, gap: 10 },

  intro: { alignItems: "center", gap: 8, paddingVertical: 28 },
  introIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  introTitle: { fontSize: 19, fontFamily: "Inter_700Bold", marginTop: 6 },
  introBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 20,
  },
  starters: { gap: 8, marginTop: 18, width: "100%" },
  starter: { borderRadius: 12, borderWidth: 1, padding: 13 },
  starterText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  bubble: { maxWidth: "85%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleUser: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleCoach: { alignSelf: "flex-start", borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
