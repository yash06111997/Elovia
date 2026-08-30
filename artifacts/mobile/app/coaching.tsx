import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Space, Radius, tabularNumbers } from "@/constants/design";
import { PressableScale, FadeInView } from "@/components/Pressable";
import { EmptyState } from "@/components/Skeleton";
import { useTheme } from "@/hooks/useTheme";
import { COACHING } from "@/constants/subscription";
import {
  ApiError,
  coaching,
  fetchEntitlement,
  type CoachingSlot,
  type CoachingSession,
} from "@/utils/api";
import { handleAiError } from "@/utils/aiErrors";

/**
 * Coaching: booking and sessions, entirely in-app.
 *
 * Every time from the server is an absolute instant. This screen is the only
 * place it becomes a wall-clock reading, and it does so in the DEVICE's
 * timezone — so a client travelling sees their session move to the correct
 * local time rather than staying at a number that no longer means anything.
 */
export default function CoachingScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [slots, setSlots] = useState<CoachingSlot[]>([]);
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [hasCoaching, setHasCoaching] = useState(false);
  const [coachName, setCoachName] = useState<string>("your coach");
  const [accepting, setAccepting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<CoachingSlot | null>(null);

  const load = useCallback(async () => {
    try {
      const [slotResult, sessionResult, entitlement] = await Promise.all([
        coaching.slots(),
        coaching.sessions(),
        fetchEntitlement().catch(() => null),
      ]);

      setSlots(slotResult.slots);
      setAccepting(slotResult.acceptingClients);
      if (slotResult.coachName) setCoachName(slotResult.coachName);
      setSessions(sessionResult.sessions);
      setHasCoaching(entitlement?.hasCoaching === true);
    } catch (e) {
      handleAiError(e, "Could not load coaching.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(
    () => sessions.filter((s) => !s.isPast && s.status === "booked"),
    [sessions],
  );
  const past = useMemo(
    () => sessions.filter((s) => s.isPast || s.status !== "booked"),
    [sessions],
  );

  const hasUsedIntro = sessions.some(
    (s) => s.kind === "intro" && s.status !== "cancelled_by_client",
  );

  /** Slots grouped by the calendar day they fall on IN THE DEVICE's zone. */
  const slotsByDay = useMemo(() => {
    const groups = new Map<string, CoachingSlot[]>();
    for (const slot of slots) {
      const key = new Date(slot.startsAt).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    }
    return [...groups.entries()];
  }, [slots]);

  /**
   * The .ics is opened by the OS, which sends none of our headers, so the app
   * exchanges its token for a signed URL first and opens that.
   */
  const addToCalendar = async (id: string) => {
    try {
      const { url } = await coaching.calendarLink(id);
      await Linking.openURL(url);
    } catch (e) {
      handleAiError(e, "Could not open the calendar file.");
    }
  };

  const cancel = (session: CoachingSession) => {
    Alert.alert("Cancel this session?", "Your coach will be notified.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel session",
        style: "destructive",
        onPress: async () => {
          try {
            await coaching.cancel(session.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            void load();
          } catch (e) {
            handleAiError(e, "Could not cancel that session.");
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Coaching", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        {loading && <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />}

        {/* ---------- Upcoming ---------- */}
        {!loading && upcoming.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Upcoming</Text>
            {upcoming.map((session, i) => (
              <FadeInView key={session.id} index={i}>
                <View
                  style={[
                    styles.sessionCard,
                    { backgroundColor: theme.card, borderColor: Colors.primary + "40" },
                  ]}
                >
                  <View style={styles.sessionHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sessionWhen, tabularNumbers, { color: theme.text }]}>
                        {formatSessionTime(session.startsAt)}
                      </Text>
                      <Text style={[styles.sessionMeta, { color: theme.textMuted }]}>
                        {session.kind === "intro" ? "Intro call" : "Coaching session"} ·{" "}
                        {session.durationMins} min · with {session.coachName}
                      </Text>
                    </View>
                    <Text style={[styles.countdown, { color: Colors.primary }]}>
                      {relativeDay(session.startsAt)}
                    </Text>
                  </View>

                  <View style={styles.sessionActions}>
                    {session.meetingUrl && (
                      <PressableScale
                        style={[styles.smallBtn, { backgroundColor: Colors.primary }]}
                        onPress={() => void Linking.openURL(session.meetingUrl!)}
                      >
                        <Ionicons name="videocam" size={15} color="#000" />
                        <Text style={styles.smallBtnText}>Join</Text>
                      </PressableScale>
                    )}

                    <PressableScale
                      style={[styles.smallBtn, { borderWidth: 1, borderColor: theme.border }]}
                      onPress={() => void addToCalendar(session.id)}
                    >
                      <Ionicons name="calendar-outline" size={15} color={theme.textSecondary} />
                      <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>
                        Add to calendar
                      </Text>
                    </PressableScale>

                    {session.canCancel ? (
                      <PressableScale onPress={() => cancel(session)} hitSlop={10}>
                        <Text style={[styles.cancelLink, { color: Colors.accentRed }]}>Cancel</Text>
                      </PressableScale>
                    ) : session.cancelBlockedReason ? (
                      <Text style={[styles.blockedNote, { color: theme.textMuted }]}>
                        {session.cancelBlockedReason}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </FadeInView>
            ))}
          </View>
        )}

        {/* ---------- Pitch, for anyone without coaching ---------- */}
        {!loading && !hasCoaching && upcoming.length === 0 && (
          <FadeInView>
            <Text style={[styles.headline, { color: theme.text }]}>{COACHING.headline}</Text>
            <Text style={[styles.subheadline, { color: theme.textSecondary }]}>
              {COACHING.subheadline}
            </Text>

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
                Billed separately from Elovia Pro. Cancel any time.
              </Text>
            </View>

            <View style={styles.includes}>
              {COACHING.includes.map((item) => (
                <View key={item} style={styles.includeRow}>
                  <View style={[styles.tick, { backgroundColor: Colors.primary + "18" }]}>
                    <Ionicons name="checkmark" size={13} color={Colors.primary} />
                  </View>
                  <Text style={[styles.includeText, { color: theme.textSecondary }]}>{item}</Text>
                </View>
              ))}
            </View>

            {!hasUsedIntro && (
              <View style={[styles.introBanner, { backgroundColor: Colors.accentGreen + "12", borderColor: Colors.accentGreen + "40" }]}>
                <Ionicons name="gift-outline" size={18} color={Colors.accentGreen} />
                <Text style={[styles.introText, { color: theme.textSecondary }]}>
                  Your first {COACHING.introCallMinutes}-minute call is free. Pick a time below — no
                  payment, no commitment.
                </Text>
              </View>
            )}
          </FadeInView>
        )}

        {/* ---------- Slot picker ---------- */}
        {!loading && accepting && slotsByDay.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {hasCoaching ? "Book your next session" : hasUsedIntro ? "Available times" : "Pick a time for your free call"}
            </Text>
            <Text style={[styles.tzNote, { color: theme.textMuted }]}>
              Times shown in your local timezone.
            </Text>

            {slotsByDay.map(([day, daySlots], i) => (
              <FadeInView key={day} index={i}>
                <View style={styles.dayGroup}>
                  <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>{day}</Text>
                  <View style={styles.slotRow}>
                    {daySlots.map((slot) => (
                      <PressableScale
                        key={slot.startsAt}
                        style={[
                          styles.slot,
                          { backgroundColor: theme.card, borderColor: theme.border },
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setPicking(slot);
                        }}
                      >
                        <Text style={[styles.slotTime, tabularNumbers, { color: theme.text }]}>
                          {formatClock(slot.startsAt)}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              </FadeInView>
            ))}
          </View>
        )}

        {!loading && (!accepting || slots.length === 0) && upcoming.length === 0 && (
          <EmptyState
            icon={<Ionicons name="calendar-outline" size={28} color={theme.textMuted} />}
            title={accepting ? "No times available" : "Not taking new clients"}
            body={
              accepting
                ? "There are no free slots in the next few weeks. Check back soon."
                : "Coaching places are full right now. We'd rather say so than take your money."
            }
          />
        )}

        {/* ---------- History ---------- */}
        {!loading && past.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Past sessions</Text>
            {past.map((session) => (
              <View
                key={session.id}
                style={[styles.pastCard, { backgroundColor: theme.card, borderColor: theme.border }]}
              >
                <Text style={[styles.pastWhen, { color: theme.textSecondary }]}>
                  {formatSessionTime(session.startsAt)}
                </Text>
                <Text style={[styles.pastStatus, { color: theme.textMuted }]}>
                  {statusLabel(session.status)}
                </Text>
                {session.coachNote ? (
                  <Text style={[styles.coachNote, { color: theme.textSecondary }]}>
                    {session.coachNote}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <BookingSheet
        slot={picking}
        kind={hasCoaching ? "coaching" : "intro"}
        coachName={coachName}
        onClose={() => setPicking(null)}
        onBooked={() => {
          setPicking(null);
          void load();
        }}
        onSlotLost={() => {
          setPicking(null);
          void load();
        }}
        theme={theme}
      />
    </View>
  );
}

function BookingSheet({
  slot,
  kind,
  coachName,
  onClose,
  onBooked,
  onSlotLost,
  theme,
}: {
  slot: CoachingSlot | null;
  kind: "intro" | "coaching";
  coachName: string;
  onClose: () => void;
  onBooked: () => void;
  onSlotLost: () => void;
  theme: any;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      await coaching.book(slot.startsAt, kind, note.trim() || undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote("");
      onBooked();
    } catch (e) {
      // Losing the race for a slot is an ordinary outcome, not a failure: the
      // useful response is a refreshed list, not an apology.
      if (e instanceof ApiError && e.code === "slot_taken") {
        Alert.alert("That time just went", "Someone booked it a moment ago. Pick another time.");
        onSlotLost();
        return;
      }
      handleAiError(e, "Could not book that time.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={slot !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Confirm booking</Text>
          <PressableScale onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.sheetContent}>
          {slot && (
            <View style={[styles.confirmCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.confirmWhen, tabularNumbers, { color: theme.text }]}>
                {formatSessionTime(slot.startsAt)}
              </Text>
              <Text style={[styles.confirmMeta, { color: theme.textMuted }]}>
                {kind === "intro" ? "Free intro call" : "Coaching session"} ·{" "}
                {kind === "intro" ? COACHING.introCallMinutes : slot.durationMins} minutes · with{" "}
                {coachName}
              </Text>
            </View>
          )}

          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            What would you like to cover? (optional)
          </Text>
          <TextInput
            style={[styles.noteInput, { color: theme.text, borderColor: theme.border }]}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. My squat has stalled and I'm not sure why"
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={500}
          />
          <Text style={[styles.fieldHint, { color: theme.textMuted }]}>
            Your coach can already see your logged training, so there's no need to write it up.
          </Text>

          <PressableScale
            style={[styles.confirmBtn, { backgroundColor: Colors.primary }]}
            onPress={confirm}
            disabled={busy}
            haptic
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.confirmBtnText}>
                {kind === "intro" ? "Book free call" : "Book session"}
              </Text>
            )}
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Absolute instant -> the device's local wall clock. */
function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function relativeDay(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `in ${Math.round(days / 7)} wk`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "cancelled_by_client":
      return "You cancelled";
    case "cancelled_by_coach":
      return "Cancelled by coach";
    case "no_show":
      return "Missed";
    default:
      return "Booked";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Space.xl, gap: Space.xl },

  headline: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginBottom: Space.sm },
  subheadline: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: Space.lg },

  priceCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: 6, marginBottom: Space.lg },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  price: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  period: { fontSize: 14, fontFamily: "Inter_400Regular" },
  priceNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  includes: { gap: Space.md, marginBottom: Space.lg },
  includeRow: { flexDirection: "row", alignItems: "flex-start", gap: Space.md },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginTop: 1 },
  includeText: { flex: 1, fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular" },

  introBanner: { flexDirection: "row", gap: Space.md, borderWidth: 1, borderRadius: Radius.md, padding: Space.lg },
  introText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },

  section: { gap: Space.md },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  tzNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -6 },

  dayGroup: { gap: Space.sm },
  dayLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  slotRow: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  slot: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Space.lg, paddingVertical: Space.md, minWidth: 88, alignItems: "center" },
  slotTime: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  sessionCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: Space.md },
  sessionHeader: { flexDirection: "row", alignItems: "flex-start", gap: Space.md },
  sessionWhen: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sessionMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  countdown: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sessionActions: { flexDirection: "row", alignItems: "center", gap: Space.sm, flexWrap: "wrap" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  smallBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#000" },
  cancelLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginLeft: "auto" },
  blockedNote: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },

  pastCard: { borderRadius: Radius.md, borderWidth: 1, padding: Space.md, gap: 3 },
  pastWhen: { fontSize: 13, fontFamily: "Inter_500Medium" },
  pastStatus: { fontSize: 11, fontFamily: "Inter_400Regular" },
  coachNote: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: Space.sm },

  sheetHeader: { flexDirection: "row", alignItems: "center", gap: Space.md, padding: Space.xl, paddingTop: Space.xxl, borderBottomWidth: 1 },
  sheetTitle: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  sheetContent: { padding: Space.xl, gap: Space.md },
  confirmCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: 4 },
  confirmWhen: { fontSize: 18, fontFamily: "Inter_700Bold" },
  confirmMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: Space.sm },
  noteInput: { borderWidth: 1, borderRadius: Radius.md, padding: Space.lg, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 96, textAlignVertical: "top" },
  fieldHint: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  confirmBtn: { borderRadius: Radius.lg, paddingVertical: 16, alignItems: "center", marginTop: Space.sm },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },
});
