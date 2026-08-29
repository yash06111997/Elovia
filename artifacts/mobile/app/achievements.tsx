import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { Colors } from "@/constants/colors";
import { Space, Radius, tabularNumbers } from "@/constants/design";
import { PressableScale, FadeInView } from "@/components/Pressable";
import { useTheme } from "@/hooks/useTheme";
import { useGameStats } from "@/hooks/useGameStats";
import { useWellness } from "@/context/WellnessContext";
import {
  evaluateAchievements,
  getWeeklyChallenge,
  nextTargets,
  type AchievementCategory,
  type AchievementProgress,
} from "@/lib/gamification";

const CATEGORIES: { key: AchievementCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "consistency", label: "Consistency" },
  { key: "strength", label: "Strength" },
  { key: "endurance", label: "Endurance" },
  { key: "nutrition", label: "Nutrition" },
];

export default function AchievementsScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { stats, totalXp, level, levelTitle, currentLevelXp, nextLevelXp, levelProgress } =
    useGameStats();
  const { currentStreak, longestStreak } = useWellness();
  const [filter, setFilter] = useState<AchievementCategory | "all">("all");

  const all = useMemo(() => evaluateAchievements(stats, []), [stats]);
  const unlocked = all.filter((a) => a.unlocked);
  const targets = useMemo(() => nextTargets(stats, [], 3), [stats]);
  const challenge = useMemo(() => getWeeklyChallenge(), []);

  const visible = useMemo(
    () =>
      filter === "all" ? all : all.filter((a) => a.achievement.category === filter),
    [all, filter],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Achievements", headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Level */}
        <View style={[styles.levelCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <LevelRing progress={levelProgress} level={level} isDark={isDark} theme={theme} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.levelTitle, { color: theme.text }]}>{levelTitle}</Text>
            <Text style={[styles.levelXp, tabularNumbers, { color: theme.textSecondary }]}>
              {currentLevelXp} / {nextLevelXp} XP to level {level + 1}
            </Text>
            <View style={[styles.xpTrack, { backgroundColor: theme.border }]}>
              <View
                style={[
                  styles.xpFill,
                  { width: `${Math.round(levelProgress * 100)}%`, backgroundColor: Colors.primary },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Streak + totals */}
        <View style={styles.statRow}>
          <StatTile
            icon="flame"
            value={String(currentStreak)}
            label="day streak"
            tone={currentStreak > 0 ? Colors.accent : theme.textMuted}
            theme={theme}
          />
          <StatTile
            icon="trophy"
            value={String(unlocked.length)}
            label={`of ${all.length} earned`}
            tone={Colors.accentYellow}
            theme={theme}
          />
          <StatTile
            icon="sparkles"
            value={totalXp >= 1000 ? `${(totalXp / 1000).toFixed(1)}k` : String(totalXp)}
            label="total XP"
            tone={Colors.primary}
            theme={theme}
          />
        </View>

        {/* Weekly challenge */}
        <View
          style={[
            styles.challengeCard,
            { backgroundColor: Colors.primary + "12", borderColor: Colors.primary + "40" },
          ]}
        >
          <View style={[styles.challengeIcon, { backgroundColor: Colors.primary + "20" }]}>
            <Ionicons name={challenge.icon as any} size={20} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.challengeLabel, { color: Colors.primary }]}>THIS WEEK</Text>
            <Text style={[styles.challengeName, { color: theme.text }]}>{challenge.name}</Text>
            <Text style={[styles.challengeDesc, { color: theme.textSecondary }]}>
              {challenge.description}
            </Text>
          </View>
          <Text style={[styles.challengeXp, { color: Colors.primary }]}>+{challenge.xpReward}</Text>
        </View>

        {/* Closest targets */}
        {targets.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Almost there</Text>
            {targets.map((target, i) => (
              <FadeInView key={target.achievement.id} index={i}>
                <TargetRow target={target} theme={theme} />
              </FadeInView>
            ))}
          </View>
        )}

        {/* Category filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {CATEGORIES.map((category) => (
            <PressableScale
              key={category.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === category.key ? Colors.primary : theme.card,
                  borderColor: filter === category.key ? Colors.primary : theme.border,
                },
              ]}
              onPress={() => setFilter(category.key)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === category.key ? "#000" : theme.textSecondary },
                ]}
              >
                {category.label}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        {/* Grid */}
        <View style={styles.grid}>
          {visible.map((item, i) => (
            <FadeInView key={item.achievement.id} index={i} style={styles.gridItem}>
              <AchievementBadge item={item} theme={theme} isDark={isDark} />
            </FadeInView>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function LevelRing({
  progress,
  level,
  isDark,
  theme,
}: {
  progress: number;
  level: number;
  isDark: boolean;
  theme: any;
}) {
  const SIZE = 76;
  const STROKE = 6;
  const radius = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          stroke={isDark ? "#2A2A3A" : "#E4E6F0"}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          stroke={Colors.primary}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <Text style={[styles.levelNumber, tabularNumbers, { color: theme.text }]}>{level}</Text>
    </View>
  );
}

function StatTile({
  icon,
  value,
  label,
  tone,
  theme,
}: {
  icon: any;
  value: string;
  label: string;
  tone: string;
  theme: any;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Ionicons name={icon} size={18} color={tone} />
      <Text style={[styles.statValue, tabularNumbers, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function TargetRow({ target, theme }: { target: AchievementProgress; theme: any }) {
  const { achievement, current, progress } = target;

  return (
    <View style={[styles.targetRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Ionicons name={achievement.icon as any} size={18} color={Colors.primary} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={[styles.targetName, { color: theme.text }]}>{achievement.name}</Text>
        <View style={[styles.targetTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              styles.targetFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: Colors.primary },
            ]}
          />
        </View>
      </View>
      <Text style={[styles.targetCount, tabularNumbers, { color: theme.textMuted }]}>
        {Math.round(current)}/{achievement.threshold}
      </Text>
    </View>
  );
}

function AchievementBadge({
  item,
  theme,
  isDark,
}: {
  item: AchievementProgress;
  theme: any;
  isDark: boolean;
}) {
  const { achievement, unlocked, progress } = item;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.card,
          borderColor: unlocked ? Colors.primary + "50" : theme.border,
        },
      ]}
    >
      <View
        style={[
          styles.badgeIcon,
          {
            backgroundColor: unlocked ? Colors.primary + "20" : isDark ? "#1E1E2A" : "#F0F1F8",
          },
        ]}
      >
        <Ionicons
          name={achievement.icon as any}
          size={22}
          // Locked badges stay visible but recede, so the set reads as a
          // collection with gaps rather than a wall of grey question marks.
          color={unlocked ? Colors.primary : theme.textMuted}
        />
      </View>

      <Text
        style={[styles.badgeName, { color: unlocked ? theme.text : theme.textSecondary }]}
        numberOfLines={2}
      >
        {achievement.name}
      </Text>
      <Text style={[styles.badgeDesc, { color: theme.textMuted }]} numberOfLines={2}>
        {achievement.description}
      </Text>

      {!unlocked && progress > 0 && (
        <View style={[styles.badgeTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              styles.badgeFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: Colors.primary + "80" },
            ]}
          />
        </View>
      )}

      {unlocked && (
        <View style={[styles.badgeXp, { backgroundColor: Colors.primary + "18" }]}>
          <Text style={[styles.badgeXpText, { color: Colors.primary }]}>
            +{achievement.xpReward} XP
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Space.lg, gap: Space.md },

  levelCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.lg,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg,
  },
  levelNumber: { fontSize: 24, fontFamily: "Inter_700Bold" },
  levelTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  levelXp: { fontSize: 12, fontFamily: "Inter_400Regular" },
  xpTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 3 },
  xpFill: { height: "100%", borderRadius: 3 },

  statRow: { flexDirection: "row", gap: Space.sm },
  statTile: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Space.md,
  },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },

  challengeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.lg,
  },
  challengeIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  challengeLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  challengeName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  challengeDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  challengeXp: { fontSize: 14, fontFamily: "Inter_700Bold" },

  section: { gap: Space.sm },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Space.md,
  },
  targetName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  targetTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  targetFill: { height: "100%", borderRadius: 3 },
  targetCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  filterRow: { gap: Space.sm, paddingVertical: Space.xs },
  filterChip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  filterText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: Space.sm },
  gridItem: { width: "48%" },
  badge: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Space.md,
    gap: 5,
    alignItems: "center",
    minHeight: 150,
  },
  badgeIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  badgeName: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  badgeDesc: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 14 },
  badgeTrack: { width: "100%", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4 },
  badgeFill: { height: "100%", borderRadius: 2 },
  badgeXp: { paddingHorizontal: Space.sm, paddingVertical: 3, borderRadius: Radius.xs, marginTop: 3 },
  badgeXpText: { fontSize: 9, fontFamily: "Inter_700Bold" },
});
