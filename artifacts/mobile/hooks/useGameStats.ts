import { useMemo } from "react";
import { useWorkout } from "@/context/WorkoutContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useWellness } from "@/context/WellnessContext";
import {
  EMPTY_STATS,
  levelFromXp,
  titleForLevel,
  xpForEvent,
  type UserStats,
} from "@/lib/gamification";

/**
 * Derives gamification stats from data the app already has.
 *
 * Nothing here is stored separately. Deriving from the source of truth means
 * XP and achievements can never drift out of sync with the workouts and logs
 * they are supposed to represent - which is the usual failure mode when a
 * points total is incremented by hand at each call site and one path forgets.
 */
export function useGameStats(): {
  stats: UserStats;
  totalXp: number;
  level: number;
  levelTitle: string;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgress: number;
} {
  const { sessions, personalRecords } = useWorkout();
  const { healthData } = useHealth();
  const { foodLog } = useNutrition();
  const { currentStreak, longestStreak, weeklyWater, waterGoalMl } = useWellness();

  const stats = useMemo<UserStats>(() => {
    const runs = healthData?.runSessions ?? [];
    const importedWorkouts = healthData?.importedWorkouts ?? [];

    const runKm = runs.reduce((sum, r) => sum + (r.distanceKm || 0), 0);
    const longestRun = runs.reduce((max, r) => Math.max(max, r.distanceKm || 0), 0);

    // Distinct days with at least one food entry, not entry count: logging
    // six things in one day is one day of the habit, not six.
    const nutritionDays = new Set((foodLog ?? []).map((entry: any) => entry.date)).size;

    const workoutMinutes = (sessions ?? []).reduce(
      (sum: number, s: any) => sum + (Number(s.durationMins) || 0),
      0,
    );

    const runMinutes = runs.reduce((sum, r) => sum + (r.durationMins || 0), 0);

    return {
      ...EMPTY_STATS,
      total_workouts: (sessions?.length ?? 0) + importedWorkouts.length,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      total_run_km: Math.round(runKm * 10) / 10,
      longest_run_km: Math.round(longestRun * 10) / 10,
      total_prs: personalRecords?.length ?? 0,
      days_logged_nutrition: nutritionDays,
      water_goals_hit: weeklyWater.filter((d) => d.ml >= waterGoalMl).length,
      total_workout_minutes: workoutMinutes + runMinutes,
      plans_completed: 0,
    };
  }, [
    sessions,
    personalRecords,
    healthData,
    foodLog,
    currentStreak,
    longestStreak,
    weeklyWater,
    waterGoalMl,
  ]);

  const totalXp = useMemo(() => {
    return (
      stats.total_workouts * xpForEvent({ kind: "workout_completed" }) +
      Math.round(stats.total_run_km) * xpForEvent({ kind: "run_completed" }) +
      stats.total_prs * xpForEvent({ kind: "personal_record" }) +
      stats.days_logged_nutrition * xpForEvent({ kind: "meal_logged" }) * 3 +
      stats.water_goals_hit * xpForEvent({ kind: "water_goal_hit" }) +
      stats.longest_streak * xpForEvent({ kind: "streak_day" })
    );
  }, [stats]);

  const level = levelFromXp(totalXp);

  return {
    stats,
    totalXp,
    level: level.level,
    levelTitle: titleForLevel(level.level),
    currentLevelXp: level.currentLevelXp,
    nextLevelXp: level.nextLevelXp,
    levelProgress: level.progress,
  };
}
