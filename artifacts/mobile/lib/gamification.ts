/**
 * XP, levels, and achievements.
 *
 * Design stance, because it matters in a HEALTH app specifically:
 *
 *  - Rest days do not break streaks. Recovery is part of training, and a
 *    mechanic that punishes rest pushes people to train injured. Streak
 *    freezes also retain better than brittle streaks, because one bad week
 *    does not delete months of progress and hand the user a reason to quit.
 *  - Nothing rewards eating less. Achievements key off consistency, effort,
 *    and logging - never a calorie deficit - so the reward loop cannot pull
 *    someone toward disordered eating.
 *  - No mechanic expires or is lost. Progress only accumulates. Loss-aversion
 *    pressure works, but it manufactures anxiety around exercise, which is
 *    exactly the association a fitness app should avoid creating.
 */

export interface XpEvent {
  kind:
    | "workout_completed"
    | "run_completed"
    | "meal_logged"
    | "water_goal_hit"
    | "personal_record"
    | "plan_started"
    | "streak_day"
    | "supplement_adherence"
    | "weekly_goal_hit";
  /** Optional magnitude, e.g. workout minutes or run km. */
  magnitude?: number;
}

const XP_TABLE: Record<XpEvent["kind"], number> = {
  workout_completed: 50,
  run_completed: 40,
  meal_logged: 5,
  water_goal_hit: 15,
  personal_record: 75,
  plan_started: 25,
  streak_day: 10,
  supplement_adherence: 10,
  weekly_goal_hit: 100,
};

/** Bonus XP for effort, capped so marathon sessions cannot trivialise levels. */
export function xpForEvent(event: XpEvent): number {
  const base = XP_TABLE[event.kind] ?? 0;

  if (event.kind === "workout_completed" && event.magnitude) {
    return base + Math.min(50, Math.floor(event.magnitude / 5) * 5);
  }
  if (event.kind === "run_completed" && event.magnitude) {
    return base + Math.min(60, Math.floor(event.magnitude) * 10);
  }

  return base;
}

/**
 * Level curve.
 *
 * Quadratic growth: early levels arrive quickly to establish the loop, then
 * stretch out so level 30 still means something a year in.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * (level - 1) ** 1.6);
}

export function levelFromXp(totalXp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  let level = 1;
  while (level < 100 && totalXp >= xpForLevel(level + 1)) level += 1;

  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = Math.max(1, ceiling - floor);

  return {
    level,
    currentLevelXp: totalXp - floor,
    nextLevelXp: span,
    progress: Math.min(1, (totalXp - floor) / span),
  };
}

export const LEVEL_TITLES: { minLevel: number; title: string }[] = [
  { minLevel: 1, title: "Starting Out" },
  { minLevel: 3, title: "Getting Consistent" },
  { minLevel: 6, title: "Building Momentum" },
  { minLevel: 10, title: "Committed" },
  { minLevel: 15, title: "Serious" },
  { minLevel: 21, title: "Dedicated" },
  { minLevel: 28, title: "Relentless" },
  { minLevel: 36, title: "Elite" },
  { minLevel: 50, title: "Legendary" },
];

export function titleForLevel(level: number): string {
  let title = LEVEL_TITLES[0].title;
  for (const entry of LEVEL_TITLES) {
    if (level >= entry.minLevel) title = entry.title;
  }
  return title;
}

export type AchievementCategory =
  | "consistency"
  | "strength"
  | "endurance"
  | "nutrition"
  | "milestone";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  /** Tiered achievements share a family and escalate. */
  family?: string;
  tier?: 1 | 2 | 3 | 4;
  /** The stat this is measured against. */
  metric: AchievementMetric;
  threshold: number;
  xpReward: number;
}

export type AchievementMetric =
  | "total_workouts"
  | "current_streak"
  | "longest_streak"
  | "total_run_km"
  | "longest_run_km"
  | "total_prs"
  | "days_logged_nutrition"
  | "water_goals_hit"
  | "total_workout_minutes"
  | "plans_completed";

export const ACHIEVEMENTS: Achievement[] = [
  // --- Consistency ---------------------------------------------------------
  { id: "first_workout", name: "First Rep", description: "Complete your first workout", category: "consistency", icon: "flame-outline", metric: "total_workouts", threshold: 1, xpReward: 50 },
  { id: "workouts_10", name: "Getting Started", description: "Complete 10 workouts", category: "consistency", icon: "flame-outline", family: "workouts", tier: 1, metric: "total_workouts", threshold: 10, xpReward: 100 },
  { id: "workouts_50", name: "Regular", description: "Complete 50 workouts", category: "consistency", icon: "flame", family: "workouts", tier: 2, metric: "total_workouts", threshold: 50, xpReward: 250 },
  { id: "workouts_150", name: "Machine", description: "Complete 150 workouts", category: "consistency", icon: "flame", family: "workouts", tier: 3, metric: "total_workouts", threshold: 150, xpReward: 600 },
  { id: "workouts_365", name: "Unstoppable", description: "Complete 365 workouts", category: "consistency", icon: "flame", family: "workouts", tier: 4, metric: "total_workouts", threshold: 365, xpReward: 1500 },

  { id: "streak_7", name: "Full Week", description: "Stay active 7 days running", category: "consistency", icon: "calendar-outline", family: "streak", tier: 1, metric: "current_streak", threshold: 7, xpReward: 100 },
  { id: "streak_30", name: "One Month", description: "Stay active 30 days running", category: "consistency", icon: "calendar", family: "streak", tier: 2, metric: "current_streak", threshold: 30, xpReward: 400 },
  { id: "streak_100", name: "Century", description: "Stay active 100 days running", category: "consistency", icon: "calendar", family: "streak", tier: 3, metric: "current_streak", threshold: 100, xpReward: 1200 },

  // --- Endurance -----------------------------------------------------------
  { id: "first_run", name: "Off the Blocks", description: "Record your first run", category: "endurance", icon: "walk-outline", metric: "total_run_km", threshold: 1, xpReward: 50 },
  { id: "run_5k", name: "5K", description: "Run 5km in one go", category: "endurance", icon: "trail-sign-outline", family: "distance", tier: 1, metric: "longest_run_km", threshold: 5, xpReward: 150 },
  { id: "run_10k", name: "10K", description: "Run 10km in one go", category: "endurance", icon: "trail-sign-outline", family: "distance", tier: 2, metric: "longest_run_km", threshold: 10, xpReward: 300 },
  { id: "run_half", name: "Half Marathon", description: "Run 21.1km in one go", category: "endurance", icon: "trophy-outline", family: "distance", tier: 3, metric: "longest_run_km", threshold: 21.1, xpReward: 800 },
  { id: "run_full", name: "Marathon", description: "Run 42.2km in one go", category: "endurance", icon: "trophy", family: "distance", tier: 4, metric: "longest_run_km", threshold: 42.2, xpReward: 2000 },

  { id: "total_50km", name: "Fifty Down", description: "Run 50km in total", category: "endurance", icon: "map-outline", family: "total_distance", tier: 1, metric: "total_run_km", threshold: 50, xpReward: 200 },
  { id: "total_250km", name: "Long Hauler", description: "Run 250km in total", category: "endurance", icon: "map-outline", family: "total_distance", tier: 2, metric: "total_run_km", threshold: 250, xpReward: 600 },
  { id: "total_1000km", name: "Four Digits", description: "Run 1,000km in total", category: "endurance", icon: "map", family: "total_distance", tier: 3, metric: "total_run_km", threshold: 1000, xpReward: 2000 },

  // --- Strength ------------------------------------------------------------
  { id: "first_pr", name: "New Best", description: "Set your first personal record", category: "strength", icon: "barbell-outline", metric: "total_prs", threshold: 1, xpReward: 75 },
  { id: "pr_10", name: "Climbing", description: "Set 10 personal records", category: "strength", icon: "barbell-outline", family: "prs", tier: 1, metric: "total_prs", threshold: 10, xpReward: 200 },
  { id: "pr_50", name: "Progressive Overload", description: "Set 50 personal records", category: "strength", icon: "barbell", family: "prs", tier: 2, metric: "total_prs", threshold: 50, xpReward: 700 },

  { id: "minutes_1000", name: "Time Served", description: "Train for 1,000 minutes total", category: "strength", icon: "time-outline", family: "minutes", tier: 1, metric: "total_workout_minutes", threshold: 1000, xpReward: 250 },
  { id: "minutes_5000", name: "Veteran", description: "Train for 5,000 minutes total", category: "strength", icon: "time", family: "minutes", tier: 2, metric: "total_workout_minutes", threshold: 5000, xpReward: 900 },

  // --- Nutrition (consistency of LOGGING, never of restriction) ------------
  { id: "log_7", name: "Paying Attention", description: "Log your food 7 days running", category: "nutrition", icon: "restaurant-outline", family: "logging", tier: 1, metric: "days_logged_nutrition", threshold: 7, xpReward: 100 },
  { id: "log_30", name: "Tracked", description: "Log your food on 30 days", category: "nutrition", icon: "restaurant", family: "logging", tier: 2, metric: "days_logged_nutrition", threshold: 30, xpReward: 300 },
  { id: "hydrated_7", name: "Well Watered", description: "Hit your water goal 7 times", category: "nutrition", icon: "water-outline", family: "water", tier: 1, metric: "water_goals_hit", threshold: 7, xpReward: 100 },
  { id: "hydrated_30", name: "Hydration Habit", description: "Hit your water goal 30 times", category: "nutrition", icon: "water", family: "water", tier: 2, metric: "water_goals_hit", threshold: 30, xpReward: 300 },

  // --- Milestones ----------------------------------------------------------
  { id: "plan_first", name: "On Programme", description: "Start a training programme", category: "milestone", icon: "clipboard-outline", metric: "plans_completed", threshold: 1, xpReward: 50 },
];

export interface UserStats {
  total_workouts: number;
  current_streak: number;
  longest_streak: number;
  total_run_km: number;
  longest_run_km: number;
  total_prs: number;
  days_logged_nutrition: number;
  water_goals_hit: number;
  total_workout_minutes: number;
  plans_completed: number;
}

export const EMPTY_STATS: UserStats = {
  total_workouts: 0,
  current_streak: 0,
  longest_streak: 0,
  total_run_km: 0,
  longest_run_km: 0,
  total_prs: 0,
  days_logged_nutrition: 0,
  water_goals_hit: 0,
  total_workout_minutes: 0,
  plans_completed: 0,
};

export interface AchievementProgress {
  achievement: Achievement;
  unlocked: boolean;
  current: number;
  progress: number;
}

export function evaluateAchievements(
  stats: UserStats,
  unlockedIds: string[],
): AchievementProgress[] {
  const unlocked = new Set(unlockedIds);

  return ACHIEVEMENTS.map((achievement) => {
    const current = stats[achievement.metric] ?? 0;
    return {
      achievement,
      unlocked: unlocked.has(achievement.id) || current >= achievement.threshold,
      current,
      progress: Math.min(1, current / achievement.threshold),
    };
  });
}

/** Achievements newly satisfied but not yet recorded, so the UI can celebrate. */
export function findNewlyUnlocked(stats: UserStats, unlockedIds: string[]): Achievement[] {
  const unlocked = new Set(unlockedIds);
  return ACHIEVEMENTS.filter(
    (a) => !unlocked.has(a.id) && (stats[a.metric] ?? 0) >= a.threshold,
  );
}

/**
 * The next achievement worth showing someone.
 *
 * Picks the closest unearned one that is already meaningfully underway. An
 * "almost there" target motivates; one at 2% just reads as noise.
 */
export function nextTargets(
  stats: UserStats,
  unlockedIds: string[],
  count = 3,
): AchievementProgress[] {
  return evaluateAchievements(stats, unlockedIds)
    .filter((a) => !a.unlocked && a.progress > 0.05)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, count);
}

export interface WeeklyChallenge {
  id: string;
  name: string;
  description: string;
  metric: "workouts" | "run_km" | "active_days" | "water_days";
  target: number;
  xpReward: number;
  icon: string;
}

/**
 * A rotating weekly challenge, seeded by ISO week so everyone sees the same one
 * and it is stable across app restarts.
 */
const CHALLENGE_POOL: Omit<WeeklyChallenge, "id">[] = [
  { name: "Three Sessions", description: "Complete 3 workouts this week", metric: "workouts", target: 3, xpReward: 150, icon: "barbell-outline" },
  { name: "Four Sessions", description: "Complete 4 workouts this week", metric: "workouts", target: 4, xpReward: 200, icon: "barbell-outline" },
  { name: "Ten Kilometres", description: "Cover 10km on foot this week", metric: "run_km", target: 10, xpReward: 200, icon: "walk-outline" },
  { name: "Five Active Days", description: "Do something on 5 days this week", metric: "active_days", target: 5, xpReward: 180, icon: "calendar-outline" },
  { name: "Hydration Week", description: "Hit your water goal on 5 days", metric: "water_days", target: 5, xpReward: 150, icon: "water-outline" },
  { name: "Twenty Kilometres", description: "Cover 20km on foot this week", metric: "run_km", target: 20, xpReward: 350, icon: "trail-sign-outline" },
];

export function currentWeekNumber(date = new Date()): number {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.valueOf() - firstThursday.valueOf();
  return 1 + Math.round(diff / (7 * 86_400_000));
}

export function getWeeklyChallenge(date = new Date()): WeeklyChallenge {
  const week = currentWeekNumber(date);
  const entry = CHALLENGE_POOL[week % CHALLENGE_POOL.length];
  return { ...entry, id: `week_${date.getFullYear()}_${week}` };
}
