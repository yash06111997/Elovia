import { allExercises, type ExerciseEntry } from "@/utils/exerciseDatabase";
import type { Exercise, WorkoutDay } from "@/context/WorkoutContext";
import type { Equipment, FitnessGoal, FitnessLevel } from "@/context/AppContext";

/**
 * Curated, expert-structured training programmes.
 *
 * These are deliberately NOT AI-generated. They are fixed, proven programme
 * structures (linear progression, push/pull/legs, upper/lower) that a coach
 * would recognise, and they cost nothing to serve. They exist for three
 * reasons:
 *
 *   1. Free-tier users get something genuinely useful without burning tokens.
 *   2. A named, structured programme reads as more trustworthy than
 *      "AI-generated" to someone deciding whether to subscribe.
 *   3. They are a deterministic fallback when AI generation is unavailable.
 *
 * Every exercise references an id in exerciseDatabase.ts. `buildCuratedPlan`
 * validates that at runtime and drops unknown ids rather than rendering a
 * broken day.
 */

export interface CuratedExerciseRef {
  /** Must match an id in exerciseDatabase.ts. */
  exerciseId: string;
  /** Programme-specific overrides; falls back to the database defaults. */
  sets?: number;
  reps?: string;
  restSeconds?: number;
  /** Replaces the database note when this programme wants a specific cue. */
  notes?: string;
}

export interface CuratedDay {
  dayName: string;
  focus: string[];
  exercises: CuratedExerciseRef[];
}

export interface CuratedPlan {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** What makes this programme work, in the coach's own words. */
  methodology: string;
  goal: FitnessGoal | "general_fitness";
  level: FitnessLevel;
  daysPerWeek: number;
  weeks: number;
  sessionMins: number;
  equipment: Equipment[];
  /** Shown as a badge; these are programme archetypes, not real endorsements. */
  tags: string[];
  days: CuratedDay[];
}

const byId = new Map<string, ExerciseEntry>(allExercises.map((e) => [e.id, e]));

export const curatedPlans: CuratedPlan[] = [
  {
    id: "foundations_full_body",
    name: "Foundations",
    tagline: "Full body, three days a week",
    description:
      "The programme most people should actually start with. Three full-body sessions a week, built around six fundamental movement patterns, with enough recovery between sessions to keep showing up.",
    methodology:
      "Full-body training beats a split for beginners because each movement is practised three times a week rather than once. Skill improves fastest with frequency, and strength early on is mostly skill. Add a small amount of weight whenever you complete all sets at the top of the rep range.",
    goal: "general_fitness",
    level: "beginner",
    daysPerWeek: 3,
    weeks: 8,
    sessionMins: 45,
    equipment: ["dumbbells", "bench"],
    tags: ["Beginner friendly", "Minimal equipment", "Full body"],
    days: [
      {
        dayName: "Day A — Squat Focus",
        focus: ["legs", "chest", "back", "core"],
        exercises: [
          { exerciseId: "legs_db_squat", sets: 3, reps: "8-10", restSeconds: 90 },
          { exerciseId: "chest_db_press", sets: 3, reps: "8-10", restSeconds: 90 },
          { exerciseId: "back_row_db", sets: 3, reps: "10-12", restSeconds: 75 },
          { exerciseId: "core_plank", sets: 3, reps: "30-45s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Day B — Hinge Focus",
        focus: ["back", "shoulders", "legs", "core"],
        exercises: [
          { exerciseId: "legs_rdl", sets: 3, reps: "8-10", restSeconds: 90 },
          { exerciseId: "sh_ohp_db", sets: 3, reps: "8-10", restSeconds: 90 },
          { exerciseId: "back_lat_pulldown", sets: 3, reps: "10-12", restSeconds: 75 },
          { exerciseId: "core_dead_bug", sets: 3, reps: "8-10 each", restSeconds: 45 },
        ],
      },
      {
        dayName: "Day C — Lunge Focus",
        focus: ["legs", "chest", "back", "glutes"],
        exercises: [
          { exerciseId: "legs_lunge", sets: 3, reps: "10 each leg", restSeconds: 75 },
          { exerciseId: "chest_incline_db", sets: 3, reps: "8-12", restSeconds: 90 },
          { exerciseId: "back_inverted_row", sets: 3, reps: "8-12", restSeconds: 75 },
          { exerciseId: "glute_bridge", sets: 3, reps: "12-15", restSeconds: 60 },
        ],
      },
    ],
  },

  {
    id: "linear_5x5_strength",
    name: "Linear 5×5",
    tagline: "Classic barbell strength progression",
    description:
      "Two alternating barbell sessions run three times a week. Five sets of five on the big lifts, adding weight every session for as long as your body allows.",
    methodology:
      "Five sets of five sits in the sweet spot between heavy enough to build strength and enough total volume to build size. Alternate A and B sessions across the week. Add the smallest available increment each time you complete all five sets; when you miss the same lift three sessions running, drop it by 10% and climb again.",
    goal: "strength",
    level: "intermediate",
    daysPerWeek: 3,
    weeks: 12,
    sessionMins: 60,
    equipment: ["barbell", "squat_rack", "bench"],
    tags: ["Strength", "Barbell", "Progressive overload"],
    days: [
      {
        dayName: "Workout A",
        focus: ["legs", "chest", "back"],
        exercises: [
          { exerciseId: "legs_bb_squat", sets: 5, reps: "5", restSeconds: 180, notes: "Add weight when all 5 sets hit 5 reps" },
          { exerciseId: "chest_bb_press", sets: 5, reps: "5", restSeconds: 180 },
          { exerciseId: "back_bb_row", sets: 5, reps: "5", restSeconds: 180 },
          { exerciseId: "core_plank", sets: 3, reps: "45-60s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Workout B",
        focus: ["legs", "shoulders", "back"],
        exercises: [
          { exerciseId: "legs_bb_squat", sets: 5, reps: "5", restSeconds: 180 },
          { exerciseId: "sh_ohp_bb", sets: 5, reps: "5", restSeconds: 180 },
          { exerciseId: "back_deadlift", sets: 1, reps: "5", restSeconds: 240, notes: "One heavy set only — deadlifts recover slowly" },
          { exerciseId: "core_hollow_hold", sets: 3, reps: "20-30s", restSeconds: 45 },
        ],
      },
    ],
  },

  {
    id: "push_pull_legs",
    name: "Push / Pull / Legs",
    tagline: "Six days, maximum volume",
    description:
      "The highest-volume programme here. Each muscle group is trained twice a week across six sessions, grouped by movement direction so nothing is worked on consecutive days.",
    methodology:
      "Grouping by movement pattern means the muscles that assist a lift are trained on the same day, so they get a full 48 hours before being loaded again. This is a lot of sessions — if you cannot reliably make six, run the same three days once a week instead of forcing it.",
    goal: "muscle_gain",
    level: "advanced",
    daysPerWeek: 6,
    weeks: 12,
    sessionMins: 70,
    equipment: ["barbell", "dumbbells", "bench", "cable_machine", "pull_up_bar", "squat_rack"],
    tags: ["Hypertrophy", "High volume", "Gym"],
    days: [
      {
        dayName: "Push A — Chest Focus",
        focus: ["chest", "shoulders", "arms"],
        exercises: [
          { exerciseId: "chest_bb_press", sets: 4, reps: "6-8", restSeconds: 150 },
          { exerciseId: "sh_ohp_db", sets: 3, reps: "8-12", restSeconds: 90 },
          { exerciseId: "chest_incline_db", sets: 3, reps: "8-12", restSeconds: 90 },
          { exerciseId: "sh_lateral", sets: 4, reps: "12-15", restSeconds: 60 },
          { exerciseId: "arm_tricep_pushdown", sets: 3, reps: "10-15", restSeconds: 60 },
        ],
      },
      {
        dayName: "Pull A — Back Thickness",
        focus: ["back", "arms"],
        exercises: [
          { exerciseId: "back_bb_row", sets: 4, reps: "6-8", restSeconds: 150 },
          { exerciseId: "back_pullup", sets: 3, reps: "AMRAP", restSeconds: 120 },
          { exerciseId: "back_cable_row", sets: 3, reps: "10-12", restSeconds: 90 },
          { exerciseId: "sh_face_pull", sets: 3, reps: "15-20", restSeconds: 60 },
          { exerciseId: "arm_curl_bb", sets: 3, reps: "8-12", restSeconds: 60 },
        ],
      },
      {
        dayName: "Legs A — Quad Focus",
        focus: ["legs", "glutes", "core"],
        exercises: [
          { exerciseId: "legs_bb_squat", sets: 4, reps: "6-8", restSeconds: 180 },
          { exerciseId: "legs_leg_press", sets: 3, reps: "10-12", restSeconds: 120 },
          { exerciseId: "legs_split_squat", sets: 3, reps: "10 each", restSeconds: 90 },
          { exerciseId: "legs_leg_ext", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "legs_calf", sets: 4, reps: "15-20", restSeconds: 45 },
        ],
      },
      {
        dayName: "Push B — Shoulder Focus",
        focus: ["shoulders", "chest", "arms"],
        exercises: [
          { exerciseId: "sh_ohp_bb", sets: 4, reps: "6-8", restSeconds: 150 },
          { exerciseId: "chest_incline_bb", sets: 3, reps: "8-10", restSeconds: 120 },
          { exerciseId: "sh_arnold_press", sets: 3, reps: "10-12", restSeconds: 90 },
          { exerciseId: "chest_cable_fly", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "arm_skull_crusher", sets: 3, reps: "10-12", restSeconds: 60 },
        ],
      },
      {
        dayName: "Pull B — Back Width",
        focus: ["back", "arms"],
        exercises: [
          { exerciseId: "back_deadlift", sets: 3, reps: "5", restSeconds: 240 },
          { exerciseId: "back_wide_pulldown", sets: 4, reps: "8-12", restSeconds: 90 },
          { exerciseId: "back_tbar_row", sets: 3, reps: "8-12", restSeconds: 90 },
          { exerciseId: "back_straight_arm_pulldown", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "arm_hammer_curl", sets: 3, reps: "10-12", restSeconds: 60 },
        ],
      },
      {
        dayName: "Legs B — Posterior Chain",
        focus: ["legs", "glutes", "core"],
        exercises: [
          { exerciseId: "legs_rdl", sets: 4, reps: "8-10", restSeconds: 150 },
          { exerciseId: "glute_hip_thrust_bb", sets: 4, reps: "8-12", restSeconds: 120 },
          { exerciseId: "legs_leg_curl", sets: 3, reps: "12-15", restSeconds: 75 },
          { exerciseId: "legs_step_up", sets: 3, reps: "10 each", restSeconds: 75 },
          { exerciseId: "core_ab_wheel", sets: 3, reps: "8-12", restSeconds: 60 },
        ],
      },
    ],
  },

  {
    id: "upper_lower_four",
    name: "Upper / Lower",
    tagline: "Four days, the best volume-to-time ratio",
    description:
      "Two upper-body and two lower-body sessions a week. The most efficient structure for anyone who can train four times but not six.",
    methodology:
      "Four sessions hits each muscle group twice weekly, which research consistently favours over once, while leaving three rest days. The second session of each pair deliberately uses different rep ranges so you accumulate both heavy and moderate volume.",
    goal: "muscle_gain",
    level: "intermediate",
    daysPerWeek: 4,
    weeks: 10,
    sessionMins: 60,
    equipment: ["barbell", "dumbbells", "bench", "cable_machine", "pull_up_bar"],
    tags: ["Balanced", "4 days", "Hypertrophy"],
    days: [
      {
        dayName: "Upper — Heavy",
        focus: ["chest", "back", "shoulders", "arms"],
        exercises: [
          { exerciseId: "chest_bb_press", sets: 4, reps: "5-8", restSeconds: 150 },
          { exerciseId: "back_bb_row", sets: 4, reps: "6-8", restSeconds: 150 },
          { exerciseId: "sh_ohp_db", sets: 3, reps: "8-10", restSeconds: 90 },
          { exerciseId: "back_lat_pulldown", sets: 3, reps: "8-12", restSeconds: 90 },
          { exerciseId: "arm_curl_db", sets: 3, reps: "10-12", restSeconds: 60 },
        ],
      },
      {
        dayName: "Lower — Heavy",
        focus: ["legs", "glutes", "core"],
        exercises: [
          { exerciseId: "legs_bb_squat", sets: 4, reps: "5-8", restSeconds: 180 },
          { exerciseId: "legs_rdl", sets: 3, reps: "8-10", restSeconds: 120 },
          { exerciseId: "legs_leg_press", sets: 3, reps: "10-12", restSeconds: 90 },
          { exerciseId: "legs_calf", sets: 4, reps: "12-15", restSeconds: 45 },
          { exerciseId: "core_leg_raise", sets: 3, reps: "10-15", restSeconds: 60 },
        ],
      },
      {
        dayName: "Upper — Volume",
        focus: ["chest", "back", "shoulders", "arms"],
        exercises: [
          { exerciseId: "chest_incline_db", sets: 4, reps: "10-12", restSeconds: 90 },
          { exerciseId: "back_cable_row", sets: 4, reps: "10-12", restSeconds: 90 },
          { exerciseId: "sh_lateral", sets: 4, reps: "12-15", restSeconds: 60 },
          { exerciseId: "chest_cable_fly", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "arm_tricep_pushdown", sets: 3, reps: "12-15", restSeconds: 60 },
        ],
      },
      {
        dayName: "Lower — Volume",
        focus: ["legs", "glutes", "core"],
        exercises: [
          { exerciseId: "legs_front_squat", sets: 3, reps: "8-10", restSeconds: 120 },
          { exerciseId: "glute_hip_thrust_bb", sets: 4, reps: "10-12", restSeconds: 90 },
          { exerciseId: "legs_leg_curl", sets: 3, reps: "12-15", restSeconds: 75 },
          { exerciseId: "legs_db_lunge_walking", sets: 3, reps: "12 each", restSeconds: 75 },
          { exerciseId: "core_pallof_press", sets: 3, reps: "10 each", restSeconds: 45 },
        ],
      },
    ],
  },

  {
    id: "home_bodyweight",
    name: "No Equipment",
    tagline: "Nothing but the floor",
    description:
      "A complete four-day programme requiring no equipment at all. Progression comes from leverage and tempo rather than added weight.",
    methodology:
      "Without weights, you make an exercise harder by changing leverage, slowing the tempo, or reducing the base of support. Take every set to two or three reps short of failure — with bodyweight movements that proximity to failure is what drives the adaptation.",
    goal: "fat_loss",
    level: "beginner",
    daysPerWeek: 4,
    weeks: 8,
    sessionMins: 35,
    equipment: ["no_equipment"],
    tags: ["No equipment", "At home", "Travel friendly"],
    days: [
      {
        dayName: "Upper Body",
        focus: ["chest", "back", "arms"],
        exercises: [
          { exerciseId: "chest_pushup", sets: 4, reps: "8-15", restSeconds: 75 },
          { exerciseId: "chest_diamond_pushup", sets: 3, reps: "6-12", restSeconds: 75 },
          { exerciseId: "chest_wide_pushup", sets: 3, reps: "8-15", restSeconds: 60 },
          { exerciseId: "core_plank_shoulder_tap", sets: 3, reps: "16-20", restSeconds: 45 },
        ],
      },
      {
        dayName: "Lower Body",
        focus: ["legs", "glutes"],
        exercises: [
          { exerciseId: "legs_squat", sets: 4, reps: "15-25", restSeconds: 75 },
          { exerciseId: "legs_reverse_lunge", sets: 3, reps: "12 each", restSeconds: 60 },
          { exerciseId: "glute_bridge", sets: 3, reps: "15-20", restSeconds: 60 },
          { exerciseId: "legs_wall_sit", sets: 3, reps: "30-60s", restSeconds: 60 },
        ],
      },
      {
        dayName: "Core & Conditioning",
        focus: ["core", "cardio"],
        exercises: [
          { exerciseId: "cardio_burpee", sets: 4, reps: "10-15", restSeconds: 60 },
          { exerciseId: "core_mountain", sets: 3, reps: "30-40", restSeconds: 45 },
          { exerciseId: "core_bicycle", sets: 3, reps: "20 each", restSeconds: 45 },
          { exerciseId: "core_hollow_hold", sets: 3, reps: "20-40s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Full Body Circuit",
        focus: ["chest", "legs", "core", "cardio"],
        exercises: [
          { exerciseId: "legs_jump_squat", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "chest_pushup", sets: 3, reps: "10-15", restSeconds: 60 },
          { exerciseId: "cardio_high_knees", sets: 3, reps: "40-60s", restSeconds: 45 },
          { exerciseId: "core_v_up", sets: 3, reps: "12-15", restSeconds: 45 },
        ],
      },
    ],
  },

  {
    id: "dumbbell_only",
    name: "Dumbbells Only",
    tagline: "One pair, four days, full programme",
    description:
      "Built for a home gym with a single adjustable pair of dumbbells and a bench. Covers every major muscle group without a rack or barbell.",
    methodology:
      "Dumbbells force each side to work independently, which evens out strength imbalances a barbell lets you hide. Rep ranges here run slightly higher than a barbell programme because loading is capped by what you can get into position.",
    goal: "muscle_gain",
    level: "intermediate",
    daysPerWeek: 4,
    weeks: 10,
    sessionMins: 50,
    equipment: ["dumbbells", "bench"],
    tags: ["Home gym", "Dumbbells", "4 days"],
    days: [
      {
        dayName: "Chest & Triceps",
        focus: ["chest", "arms"],
        exercises: [
          { exerciseId: "chest_db_press", sets: 4, reps: "8-12", restSeconds: 90 },
          { exerciseId: "chest_incline_db", sets: 3, reps: "10-12", restSeconds: 90 },
          { exerciseId: "chest_db_fly", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "arm_skull_crusher", sets: 3, reps: "10-12", restSeconds: 60 },
          { exerciseId: "arm_kickback", sets: 3, reps: "12-15", restSeconds: 45 },
        ],
      },
      {
        dayName: "Back & Biceps",
        focus: ["back", "arms"],
        exercises: [
          { exerciseId: "back_row_db", sets: 4, reps: "8-12", restSeconds: 90 },
          { exerciseId: "back_seal_row", sets: 3, reps: "10-12", restSeconds: 90 },
          { exerciseId: "chest_db_pullover", sets: 3, reps: "10-12", restSeconds: 75 },
          { exerciseId: "arm_curl_db", sets: 3, reps: "10-12", restSeconds: 60 },
          { exerciseId: "arm_hammer_curl", sets: 3, reps: "10-12", restSeconds: 60 },
        ],
      },
      {
        dayName: "Legs & Glutes",
        focus: ["legs", "glutes"],
        exercises: [
          { exerciseId: "legs_db_squat", sets: 4, reps: "10-12", restSeconds: 120 },
          { exerciseId: "legs_rdl", sets: 4, reps: "10-12", restSeconds: 90 },
          { exerciseId: "legs_split_squat", sets: 3, reps: "10 each", restSeconds: 90 },
          { exerciseId: "glute_hip_thrust_bw", sets: 3, reps: "15-20", restSeconds: 75 },
          { exerciseId: "legs_calf", sets: 4, reps: "15-20", restSeconds: 45 },
        ],
      },
      {
        dayName: "Shoulders & Core",
        focus: ["shoulders", "core"],
        exercises: [
          { exerciseId: "sh_ohp_db", sets: 4, reps: "8-12", restSeconds: 90 },
          { exerciseId: "sh_lateral", sets: 4, reps: "12-15", restSeconds: 60 },
          { exerciseId: "sh_reverse_fly", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "sh_db_shrug", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "core_russian_twist", sets: 3, reps: "20 each", restSeconds: 45 },
        ],
      },
    ],
  },

  {
    id: "glute_focus",
    name: "Glute Specialisation",
    tagline: "Targeted lower-body development",
    description:
      "Four sessions built around hip extension and abduction, the two patterns that actually drive glute growth, with enough quad and hamstring work to keep the leg balanced.",
    methodology:
      "The glutes respond to two things: heavy hip extension loaded at the top (thrusts, bridges) and abduction under tension. Squats alone under-train them because the hardest point of a squat is at the bottom, where the glutes are least active.",
    goal: "muscle_gain",
    level: "intermediate",
    daysPerWeek: 4,
    weeks: 10,
    sessionMins: 50,
    equipment: ["barbell", "dumbbells", "resistance_bands", "bench"],
    tags: ["Glutes", "Lower body", "Specialisation"],
    days: [
      {
        dayName: "Heavy Hip Extension",
        focus: ["glutes", "legs"],
        exercises: [
          { exerciseId: "glute_hip_thrust_bb", sets: 4, reps: "6-10", restSeconds: 150 },
          { exerciseId: "legs_rdl", sets: 4, reps: "8-10", restSeconds: 120 },
          { exerciseId: "glute_band_walk", sets: 3, reps: "20 each", restSeconds: 45 },
          { exerciseId: "glute_abduction", sets: 3, reps: "15-20", restSeconds: 60 },
        ],
      },
      {
        dayName: "Quad & Accessory",
        focus: ["legs", "core"],
        exercises: [
          { exerciseId: "legs_bb_squat", sets: 4, reps: "8-10", restSeconds: 150 },
          { exerciseId: "legs_step_up", sets: 3, reps: "12 each", restSeconds: 90 },
          { exerciseId: "legs_leg_ext", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "core_plank", sets: 3, reps: "45-60s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Volume Glutes",
        focus: ["glutes"],
        exercises: [
          { exerciseId: "glute_hip_thrust_bw", sets: 4, reps: "15-20", restSeconds: 75 },
          { exerciseId: "glute_curtsy_lunge_g", sets: 3, reps: "12 each", restSeconds: 75 },
          { exerciseId: "glute_cable_kickback", sets: 3, reps: "15 each", restSeconds: 60 },
          { exerciseId: "glute_frog_pump", sets: 3, reps: "20-25", restSeconds: 45 },
        ],
      },
      {
        dayName: "Posterior & Conditioning",
        focus: ["glutes", "legs", "cardio"],
        exercises: [
          { exerciseId: "glute_rdl_single", sets: 3, reps: "10 each", restSeconds: 90 },
          { exerciseId: "glute_kb_swing", sets: 4, reps: "15-20", restSeconds: 60 },
          { exerciseId: "legs_leg_curl", sets: 3, reps: "12-15", restSeconds: 60 },
          { exerciseId: "cardio_walk_incline", sets: 1, reps: "15-20 min", restSeconds: 0 },
        ],
      },
    ],
  },

  {
    id: "fat_loss_hybrid",
    name: "Lean Out",
    tagline: "Strength plus conditioning, five days",
    description:
      "Three lifting sessions to hold onto muscle while in a deficit, plus two conditioning days. Built to preserve strength while losing fat, not to burn the most calories per session.",
    methodology:
      "In a calorie deficit the job of lifting is to signal that muscle is worth keeping, which means keeping intensity high and volume moderate. Conditioning is separate and deliberately low-impact, because recovery is already compromised when you are under-eating.",
    goal: "fat_loss",
    level: "intermediate",
    daysPerWeek: 5,
    weeks: 8,
    sessionMins: 45,
    equipment: ["dumbbells", "bench", "treadmill"],
    tags: ["Fat loss", "Hybrid", "Conditioning"],
    days: [
      {
        dayName: "Full Body Strength A",
        focus: ["legs", "chest", "back"],
        exercises: [
          { exerciseId: "legs_db_squat", sets: 4, reps: "6-8", restSeconds: 120 },
          { exerciseId: "chest_db_press", sets: 4, reps: "6-8", restSeconds: 120 },
          { exerciseId: "back_row_db", sets: 4, reps: "8-10", restSeconds: 90 },
          { exerciseId: "core_plank", sets: 3, reps: "45s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Conditioning — Intervals",
        focus: ["cardio"],
        exercises: [
          { exerciseId: "cardio_hiit_run", sets: 8, reps: "30s hard / 90s easy", restSeconds: 0 },
          { exerciseId: "core_dead_bug", sets: 3, reps: "10 each", restSeconds: 45 },
        ],
      },
      {
        dayName: "Full Body Strength B",
        focus: ["legs", "shoulders", "back"],
        exercises: [
          { exerciseId: "legs_rdl", sets: 4, reps: "6-8", restSeconds: 120 },
          { exerciseId: "sh_ohp_db", sets: 4, reps: "6-8", restSeconds: 120 },
          { exerciseId: "back_lat_pulldown", sets: 4, reps: "8-10", restSeconds: 90 },
          { exerciseId: "core_side_plank", sets: 3, reps: "30s each", restSeconds: 45 },
        ],
      },
      {
        dayName: "Conditioning — Steady",
        focus: ["cardio"],
        exercises: [
          { exerciseId: "cardio_walk_incline", sets: 1, reps: "35-45 min", restSeconds: 0, notes: "Keep it conversational — this is recovery, not a workout" },
        ],
      },
      {
        dayName: "Full Body Strength C",
        focus: ["legs", "chest", "glutes"],
        exercises: [
          { exerciseId: "legs_lunge", sets: 3, reps: "10 each", restSeconds: 90 },
          { exerciseId: "chest_incline_db", sets: 4, reps: "8-10", restSeconds: 90 },
          { exerciseId: "glute_hip_thrust_bw", sets: 3, reps: "15-20", restSeconds: 60 },
          { exerciseId: "core_hollow_hold", sets: 3, reps: "30s", restSeconds: 45 },
        ],
      },
    ],
  },

  {
    id: "core_builder",
    name: "Core Builder",
    tagline: "Three short sessions, add to any programme",
    description:
      "A focused core block designed to run alongside whatever else you are doing. Fifteen minutes, three times a week.",
    methodology:
      "The core resists movement more than it creates it, so this leans on anti-extension and anti-rotation work rather than endless crunches. Progress by adding time under tension before adding reps.",
    goal: "general_fitness",
    level: "beginner",
    daysPerWeek: 3,
    weeks: 6,
    sessionMins: 15,
    equipment: ["no_equipment"],
    tags: ["Core", "Short sessions", "Add-on"],
    days: [
      {
        dayName: "Anti-Extension",
        focus: ["core"],
        exercises: [
          { exerciseId: "core_plank", sets: 3, reps: "45-60s", restSeconds: 45 },
          { exerciseId: "core_dead_bug", sets: 3, reps: "10 each", restSeconds: 45 },
          { exerciseId: "core_hollow_hold", sets: 3, reps: "20-40s", restSeconds: 45 },
        ],
      },
      {
        dayName: "Anti-Rotation",
        focus: ["core"],
        exercises: [
          { exerciseId: "core_pallof_press", sets: 3, reps: "10 each", restSeconds: 45 },
          { exerciseId: "core_side_plank", sets: 3, reps: "30-45s each", restSeconds: 45 },
          { exerciseId: "core_bird_dog", sets: 3, reps: "10 each", restSeconds: 45 },
        ],
      },
      {
        dayName: "Flexion & Rotation",
        focus: ["core"],
        exercises: [
          { exerciseId: "core_reverse_crunch", sets: 3, reps: "12-15", restSeconds: 45 },
          { exerciseId: "core_bicycle", sets: 3, reps: "20 each", restSeconds: 45 },
          { exerciseId: "core_russian_twist", sets: 3, reps: "15 each", restSeconds: 45 },
        ],
      },
    ],
  },
];

/**
 * Resolve a curated plan into concrete workout days.
 *
 * Exercise ids are validated against the database and unknown ids are dropped
 * with a console warning rather than rendering a day with a blank exercise.
 * That turns a content typo into a slightly shorter workout instead of a
 * broken screen.
 */
export function buildCuratedDays(plan: CuratedPlan): WorkoutDay[] {
  return plan.days.map((day, dayIndex) => {
    const exercises: Exercise[] = [];

    for (const [exerciseIndex, ref] of day.exercises.entries()) {
      const entry = byId.get(ref.exerciseId);
      if (!entry) {
        if (__DEV__) {
          console.warn(
            `[curatedPlans] "${plan.id}" references unknown exercise "${ref.exerciseId}"`,
          );
        }
        continue;
      }

      exercises.push({
        id: `${plan.id}_${dayIndex}_${exerciseIndex}_${entry.id}`,
        name: entry.name,
        muscleGroup: entry.primaryMuscle,
        sets: ref.sets ?? entry.sets,
        reps: ref.reps ?? entry.reps,
        restSeconds: ref.restSeconds ?? entry.restSeconds,
        notes: ref.notes ?? entry.notes,
      });
    }

    return {
      id: `${plan.id}_day_${dayIndex}`,
      dayName: day.dayName,
      muscleGroups: day.focus,
      exercises,
    };
  });
}

export function getCuratedPlan(id: string): CuratedPlan | undefined {
  return curatedPlans.find((p) => p.id === id);
}

/**
 * Rank curated plans against a user's profile.
 *
 * Deliberately a soft score rather than a filter: a user with no equipment
 * should still SEE the barbell programmes, just lower down, because equipment
 * access changes and an empty list is a worse experience than a sorted one.
 */
export function rankCuratedPlans(profile: {
  goal?: string;
  fitnessLevel?: string;
  workoutDaysPerWeek?: number;
  equipment?: string[];
} | null): CuratedPlan[] {
  if (!profile) return curatedPlans;

  const owned = new Set(profile.equipment ?? []);
  const hasNoEquipment = owned.has("no_equipment") || owned.size === 0;

  const levelRank: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
  const userLevel = levelRank[profile.fitnessLevel ?? "beginner"] ?? 0;

  return [...curatedPlans]
    .map((plan) => {
      let score = 0;

      if (profile.goal && plan.goal === profile.goal) score += 40;

      const planLevel = levelRank[plan.level] ?? 0;
      // Same level is ideal; one step away is fine; two is a poor fit.
      score += 25 - Math.abs(planLevel - userLevel) * 12;

      if (profile.workoutDaysPerWeek) {
        score += 20 - Math.abs(plan.daysPerWeek - profile.workoutDaysPerWeek) * 5;
      }

      const needsEquipment = plan.equipment.filter((e) => e !== "no_equipment");
      if (needsEquipment.length === 0) {
        score += 10;
      } else if (hasNoEquipment) {
        score -= 25;
      } else {
        const covered = needsEquipment.filter((e) => owned.has(e)).length;
        score += Math.round((covered / needsEquipment.length) * 20);
      }

      return { plan, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.plan);
}
