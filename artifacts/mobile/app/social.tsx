import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Switch,
  Share,
  RefreshControl,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Space, Radius, tabularNumbers } from "@/constants/design";
import { PressableScale, FadeInView } from "@/components/Pressable";
import { EmptyState, SkeletonCard } from "@/components/Skeleton";
import { useTheme } from "@/hooks/useTheme";
import {
  social,
  type SocialProfile,
  type FriendEntry,
  type FeedActivity,
  type ChallengeEntry,
} from "@/utils/api";
import { handleAiError } from "@/utils/aiErrors";

type Tab = "feed" | "friends" | "challenges";

export default function SocialScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("feed");
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [feed, setFeed] = useState<FeedActivity[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<FriendEntry[]>([]);
  const [challenges, setChallenges] = useState<ChallengeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, feedResult, friendsResult, challengeResult] = await Promise.all([
        social.me(),
        social.feed(),
        social.friends(),
        social.challenges(),
      ]);

      setProfile(me.profile);
      setFeed(feedResult.feed);
      setFriends(friendsResult.friends);
      setIncoming(friendsResult.incoming);
      setChallenges(challengeResult.challenges);
    } catch (e) {
      handleAiError(e, "Could not load your social feed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleKudos = async (activity: FeedActivity) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Optimistic: a kudos that waits for a round trip feels broken.
    setFeed((prev) =>
      prev.map((a) =>
        a.id === activity.id
          ? { ...a, hasKudos: !a.hasKudos, kudosCount: a.kudosCount + (a.hasKudos ? -1 : 1) }
          : a,
      ),
    );

    try {
      const result = await social.toggleKudos(activity.id);
      setFeed((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, hasKudos: result.hasKudos, kudosCount: result.kudosCount }
            : a,
        ),
      );
    } catch {
      // Roll the optimistic update back rather than leaving a lie on screen.
      setFeed((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, hasKudos: activity.hasKudos, kudosCount: activity.kudosCount }
            : a,
        ),
      );
    }
  };

  const shareCode = async () => {
    if (!profile) return;
    await Share.share({
      message: `Add me on Elovia — my friend code is ${profile.friendCode}`,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "Community",
          headerShown: true,
          headerRight: () => (
            <PressableScale onPress={() => setSettingsVisible(true)} hitSlop={12}>
              <Ionicons name="settings-outline" size={21} color={theme.text} />
            </PressableScale>
          ),
        }}
      />

      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        {(["feed", "friends", "challenges"] as Tab[]).map((key) => (
          <PressableScale
            key={key}
            style={styles.tab}
            onPress={() => {
              Haptics.selectionAsync();
              setTab(key);
            }}
            scaleTo={0.94}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: tab === key ? Colors.primary : theme.textMuted },
              ]}
            >
              {key === "feed" ? "Feed" : key === "friends" ? "Friends" : "Challenges"}
            </Text>
            {key === "friends" && incoming.length > 0 && (
              <View style={[styles.badge, { backgroundColor: Colors.accentRed }]}>
                <Text style={styles.badgeText}>{incoming.length}</Text>
              </View>
            )}
            {tab === key && <View style={[styles.tabUnderline, { backgroundColor: Colors.primary }]} />}
          </PressableScale>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
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
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard lines={2} />
          </>
        )}

        {/* ---------------- FEED ---------------- */}
        {!loading && tab === "feed" && (
          <>
            {feed.length === 0 ? (
              <EmptyState
                icon={<Ionicons name="people-outline" size={28} color={theme.textMuted} />}
                title="Nothing here yet"
                body="Share a workout, or add a friend by their code, and activity will appear here."
              />
            ) : (
              feed.map((activity, i) => (
                <FadeInView key={activity.id} index={i}>
                  <View
                    style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={[styles.avatar, { backgroundColor: Colors.primary + "20" }]}>
                        <Text style={[styles.avatarText, { color: Colors.primary }]}>
                          {activity.author.displayName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.authorName, { color: theme.text }]}>
                          {activity.author.isSelf ? "You" : activity.author.displayName}
                        </Text>
                        <Text style={[styles.timestamp, { color: theme.textMuted }]}>
                          {relativeTime(activity.createdAt)}
                        </Text>
                      </View>
                      <Ionicons
                        name={kindIcon(activity.kind)}
                        size={17}
                        color={theme.textMuted}
                      />
                    </View>

                    <Text style={[styles.activityTitle, { color: theme.text }]}>
                      {activity.title}
                    </Text>
                    {activity.caption ? (
                      <Text style={[styles.caption, { color: theme.textSecondary }]}>
                        {activity.caption}
                      </Text>
                    ) : null}

                    <ActivityStats payload={activity.payload} theme={theme} />

                    <View style={[styles.actionRow, { borderTopColor: theme.border }]}>
                      <PressableScale
                        style={styles.action}
                        onPress={() => void toggleKudos(activity)}
                        scaleTo={0.9}
                      >
                        <Ionicons
                          name={activity.hasKudos ? "flame" : "flame-outline"}
                          size={18}
                          color={activity.hasKudos ? Colors.accent : theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.actionText,
                            tabularNumbers,
                            { color: activity.hasKudos ? Colors.accent : theme.textMuted },
                          ]}
                        >
                          {activity.kudosCount}
                        </Text>
                      </PressableScale>

                      <View style={styles.action}>
                        <Ionicons name="chatbubble-outline" size={17} color={theme.textMuted} />
                        <Text style={[styles.actionText, tabularNumbers, { color: theme.textMuted }]}>
                          {activity.commentCount}
                        </Text>
                      </View>
                    </View>
                  </View>
                </FadeInView>
              ))
            )}
          </>
        )}

        {/* ---------------- FRIENDS ---------------- */}
        {!loading && tab === "friends" && (
          <>
            {profile && (
              <PressableScale
                style={[styles.codeCard, { backgroundColor: theme.card, borderColor: Colors.primary + "40" }]}
                onPress={shareCode}
                haptic
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.codeLabel, { color: theme.textMuted }]}>YOUR FRIEND CODE</Text>
                  <Text style={[styles.codeValue, { color: theme.text }]}>{profile.friendCode}</Text>
                </View>
                <Ionicons name="share-outline" size={20} color={Colors.primary} />
              </PressableScale>
            )}

            {incoming.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  Requests ({incoming.length})
                </Text>
                {incoming.map((request) => (
                  <View
                    key={request.friendshipId}
                    style={[styles.friendRow, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <View style={[styles.avatar, { backgroundColor: Colors.primary + "20" }]}>
                      <Text style={[styles.avatarText, { color: Colors.primary }]}>
                        {request.displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.friendName, { color: theme.text }]}>
                      {request.displayName}
                    </Text>
                    <PressableScale
                      style={[styles.miniBtn, { backgroundColor: Colors.primary }]}
                      onPress={async () => {
                        await social.respondFriend(request.friendshipId, true);
                        void load();
                      }}
                    >
                      <Ionicons name="checkmark" size={16} color="#000" />
                    </PressableScale>
                    <PressableScale
                      style={[styles.miniBtn, { borderWidth: 1, borderColor: theme.border }]}
                      onPress={async () => {
                        await social.respondFriend(request.friendshipId, false);
                        void load();
                      }}
                    >
                      <Ionicons name="close" size={16} color={theme.textMuted} />
                    </PressableScale>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Friends ({friends.length})
              </Text>
              {friends.length === 0 ? (
                <Text style={[styles.hint, { color: theme.textMuted }]}>
                  Share your code above, or tap + to add someone by theirs.
                </Text>
              ) : (
                friends.map((friend, i) => (
                  <FadeInView key={friend.friendshipId} index={i}>
                    <View
                      style={[styles.friendRow, { backgroundColor: theme.card, borderColor: theme.border }]}
                    >
                      <View style={[styles.avatar, { backgroundColor: Colors.accentGreen + "20" }]}>
                        <Text style={[styles.avatarText, { color: Colors.accentGreen }]}>
                          {friend.displayName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[styles.friendName, { color: theme.text }]}>
                        {friend.displayName}
                      </Text>
                      <PressableScale
                        hitSlop={10}
                        onPress={() =>
                          Alert.alert("Remove friend?", `${friend.displayName} will be removed.`, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: async () => {
                                await social.removeFriend(friend.friendshipId);
                                void load();
                              },
                            },
                          ])
                        }
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} />
                      </PressableScale>
                    </View>
                  </FadeInView>
                ))
              )}
            </View>
          </>
        )}

        {/* ---------------- CHALLENGES ---------------- */}
        {!loading && tab === "challenges" && (
          <>
            {challenges.length === 0 ? (
              <EmptyState
                icon={<Ionicons name="flag-outline" size={28} color={theme.textMuted} />}
                title="No challenges yet"
                body="Start one and share the code, or join a friend's with theirs."
              />
            ) : (
              challenges.map((challenge, i) => (
                <FadeInView key={challenge.id} index={i}>
                  <View
                    style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.activityTitle, { color: theme.text }]}>
                          {challenge.name}
                        </Text>
                        <Text style={[styles.timestamp, { color: theme.textMuted }]}>
                          {challenge.active
                            ? `${daysLeft(challenge.endsAt)} left · code ${challenge.joinCode}`
                            : "Finished"}
                        </Text>
                      </View>
                      <Text style={[styles.targetText, tabularNumbers, { color: Colors.primary }]}>
                        {challenge.target}
                        <Text style={{ fontSize: 11, color: theme.textMuted }}>
                          {" "}
                          {metricLabel(challenge.metric)}
                        </Text>
                      </Text>
                    </View>

                    {challenge.participants.map((participant) => (
                      <View key={participant.userId} style={styles.participantRow}>
                        <Text
                          style={[
                            styles.participantName,
                            { color: participant.isSelf ? Colors.primary : theme.textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {participant.isSelf ? "You" : participant.displayName}
                        </Text>
                        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
                          <View
                            style={[
                              styles.progressFill,
                              {
                                width: `${Math.min(100, (participant.progress / challenge.target) * 100)}%`,
                                backgroundColor: participant.isSelf ? Colors.primary : theme.textMuted,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.participantValue, tabularNumbers, { color: theme.textMuted }]}>
                          {participant.progress}
                        </Text>
                      </View>
                    ))}
                  </View>
                </FadeInView>
              ))
            )}
          </>
        )}
      </ScrollView>

      {tab !== "feed" && (
        <PressableScale
          style={[styles.fab, { backgroundColor: Colors.primary, bottom: insets.bottom + 20 }]}
          onPress={() => setAddVisible(true)}
          haptic
        >
          <Ionicons name="add" size={26} color="#000" />
        </PressableScale>
      )}

      <AddModal
        visible={addVisible}
        mode={tab === "challenges" ? "challenge" : "friend"}
        onClose={() => setAddVisible(false)}
        onDone={() => {
          setAddVisible(false);
          void load();
        }}
        theme={theme}
      />

      <SettingsModal
        visible={settingsVisible}
        profile={profile}
        onClose={() => setSettingsVisible(false)}
        onSaved={(updated) => setProfile(updated)}
        theme={theme}
      />
    </View>
  );
}

function ActivityStats({ payload, theme }: { payload: Record<string, unknown>; theme: any }) {
  const entries: { label: string; value: string }[] = [];

  if (typeof payload.distanceKm === "number") {
    entries.push({ label: "km", value: payload.distanceKm.toFixed(2) });
  }
  if (typeof payload.durationMins === "number") {
    entries.push({ label: "min", value: String(payload.durationMins) });
  }
  if (typeof payload.calories === "number") {
    entries.push({ label: "kcal", value: String(payload.calories) });
  }
  if (typeof payload.exercises === "number") {
    entries.push({ label: "exercises", value: String(payload.exercises) });
  }

  if (entries.length === 0) return null;

  return (
    <View style={styles.statsRow}>
      {entries.map((entry) => (
        <View key={entry.label} style={styles.stat}>
          <Text style={[styles.statValue, tabularNumbers, { color: theme.text }]}>
            {entry.value}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textMuted }]}>{entry.label}</Text>
        </View>
      ))}
    </View>
  );
}

function AddModal({
  visible,
  mode,
  onClose,
  onDone,
  theme,
}: {
  visible: boolean;
  mode: "friend" | "challenge";
  onClose: () => void;
  onDone: () => void;
  theme: any;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("4");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "friend") {
        const found = await social.lookup(code.trim().toUpperCase());
        await social.requestFriend(found.user.userId);
        Alert.alert("Request sent", `${found.user.displayName} will see your request.`);
      } else if (code.trim()) {
        await social.joinChallenge(code.trim().toUpperCase());
      } else {
        await social.createChallenge({
          name: name.trim(),
          metric: "workouts",
          target: Number(target) || 4,
          days: 7,
        });
      }
      setCode("");
      setName("");
      onDone();
    } catch (e) {
      handleAiError(e, "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "friend" ? code.trim().length > 3 : code.trim() || name.trim();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>
            {mode === "friend" ? "Add a friend" : "Challenges"}
          </Text>
          <PressableScale onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.formContent}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            {mode === "friend" ? "Their friend code" : "Join with a code"}
          </Text>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            value={code}
            onChangeText={setCode}
            placeholder={mode === "friend" ? "ELV-XXXXXX" : "Paste a code"}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          {mode === "challenge" && (
            <>
              <Text style={[styles.orDivider, { color: theme.textMuted }]}>or start your own</Text>

              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Name</Text>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Four sessions this week"
                placeholderTextColor={theme.textMuted}
              />

              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                Target workouts in 7 days
              </Text>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={target}
                onChangeText={setTarget}
                keyboardType="number-pad"
              />
            </>
          )}

          <PressableScale
            style={[styles.saveBtn, { backgroundColor: canSubmit ? Colors.primary : theme.border }]}
            onPress={submit}
            disabled={!canSubmit || busy}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveBtnText}>
                {mode === "friend" ? "Send request" : code.trim() ? "Join" : "Create"}
              </Text>
            )}
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SettingsModal({
  visible,
  profile,
  onClose,
  onSaved,
  theme,
}: {
  visible: boolean;
  profile: SocialProfile | null;
  onClose: () => void;
  onSaved: (p: SocialProfile) => void;
  theme: any;
}) {
  const [name, setName] = useState("");
  const [discoverable, setDiscoverable] = useState(true);
  const [leaderboard, setLeaderboard] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.displayName);
    setDiscoverable(profile.discoverable);
    setLeaderboard(profile.leaderboardOptIn);
  }, [profile]);

  const save = async () => {
    try {
      const result = await social.updateMe({
        displayName: name,
        discoverable,
        leaderboardOptIn: leaderboard,
      });
      onSaved(result.profile);
      onClose();
    } catch (e) {
      handleAiError(e, "Could not save.");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Privacy</Text>
          <PressableScale onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.formContent}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Display name</Text>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            value={name}
            onChangeText={setName}
            placeholder="How friends see you"
            placeholderTextColor={theme.textMuted}
          />

          <View style={[styles.switchRow, { borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text }]}>Findable by code</Text>
              <Text style={[styles.switchHint, { color: theme.textMuted }]}>
                Turn off and nobody can find you, even with your code.
              </Text>
            </View>
            <Switch value={discoverable} onValueChange={setDiscoverable} trackColor={{ true: Colors.primary }} />
          </View>

          <View style={[styles.switchRow, { borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: theme.text }]}>Show me on leaderboards</Text>
              <Text style={[styles.switchHint, { color: theme.textMuted }]}>
                Off by default. Being someone's friend is not consent to have your training
                ranked against theirs.
              </Text>
            </View>
            <Switch value={leaderboard} onValueChange={setLeaderboard} trackColor={{ true: Colors.primary }} />
          </View>

          <View style={[styles.privacyNote, { borderColor: theme.border }]}>
            <Ionicons name="lock-closed-outline" size={15} color={Colors.accentGreen} />
            <Text style={[styles.privacyText, { color: theme.textSecondary }]}>
              Nothing is shared automatically. Your workouts, meals, weight and health data stay
              private unless you explicitly share an individual activity.
            </Text>
          </View>

          <PressableScale
            style={[styles.saveBtn, { backgroundColor: Colors.primary }]}
            onPress={save}
            haptic
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

function kindIcon(kind: string): any {
  switch (kind) {
    case "run":
      return "walk-outline";
    case "achievement":
      return "trophy-outline";
    case "personal_record":
      return "trending-up-outline";
    default:
      return "barbell-outline";
  }
}

function metricLabel(metric: string): string {
  switch (metric) {
    case "distance_km":
      return "km";
    case "active_days":
      return "days";
    case "workout_minutes":
      return "min";
    default:
      return "sessions";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

function daysLeft(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  if (days <= 0) return "ending today";
  return days === 1 ? "1 day" : `${days} days`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Space.lg, gap: Space.md },

  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: "center", paddingVertical: Space.md, position: "relative" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabUnderline: { position: "absolute", bottom: 0, height: 2, width: "60%", borderRadius: 2 },
  badge: {
    position: "absolute",
    top: 6,
    right: "24%",
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" },

  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Space.lg, gap: Space.sm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: Space.md },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  authorName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timestamp: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  activityTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  caption: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  statsRow: { flexDirection: "row", gap: Space.xl, marginTop: 2 },
  stat: { alignItems: "flex-start" },
  statValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  actionRow: { flexDirection: "row", gap: Space.xl, borderTopWidth: 1, paddingTop: Space.md, marginTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
  },
  codeLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  codeValue: { fontSize: 21, fontFamily: "Inter_700Bold", letterSpacing: 1, marginTop: 3 },

  section: { gap: Space.sm },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: Space.xs },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Space.md,
  },
  friendName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  miniBtn: { width: 34, height: 34, borderRadius: Radius.sm, alignItems: "center", justifyContent: "center" },

  targetText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  participantRow: { flexDirection: "row", alignItems: "center", gap: Space.md },
  participantName: { width: 74, fontSize: 12, fontFamily: "Inter_500Medium" },
  progressTrack: { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  participantValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 26, textAlign: "right" },

  fab: {
    position: "absolute",
    right: Space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    padding: Space.xl,
    paddingTop: Space.xxl,
    borderBottomWidth: 1,
  },
  modalTitle: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  formContent: { padding: Space.xl, gap: Space.md },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  orDivider: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginVertical: Space.sm },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.md,
  },
  switchLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  switchHint: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 2 },

  privacyNote: {
    flexDirection: "row",
    gap: Space.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Space.md,
  },
  privacyText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  saveBtn: { borderRadius: Radius.lg, paddingVertical: 15, alignItems: "center", marginTop: Space.sm },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#000" },
});
