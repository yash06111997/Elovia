import { UserProfile, Equipment, FoodPreference } from "@/context/AppContext";
import { WorkoutPlan, WorkoutDay, Exercise } from "@/context/WorkoutContext";
import { MealPlan, Meal } from "@/context/NutritionContext";

// ---- WORKOUT GENERATOR ----

const exerciseDatabase: Record<string, Exercise[]> = {
  chest: [
    { id: "chest_pushup", name: "Push-Up", muscleGroup: "Chest", sets: 3, reps: "10-15", restSeconds: 60, notes: "Keep core tight, elbows at 45° to torso" },
    { id: "chest_db_press", name: "Dumbbell Bench Press", muscleGroup: "Chest", sets: 4, reps: "8-12", restSeconds: 90, notes: "Plant feet firmly, control the descent" },
    { id: "chest_db_fly", name: "Dumbbell Fly", muscleGroup: "Chest", sets: 3, reps: "10-12", restSeconds: 75, notes: "Slight bend in elbows throughout" },
    { id: "chest_bb_press", name: "Barbell Bench Press", muscleGroup: "Chest", sets: 4, reps: "6-10", restSeconds: 120, notes: "Grip slightly wider than shoulder-width" },
    { id: "chest_incline_db", name: "Incline DB Press", muscleGroup: "Upper Chest", sets: 3, reps: "8-12", restSeconds: 90, notes: "30-45° incline for upper chest focus" },
    { id: "chest_cable_fly", name: "Cable Crossover", muscleGroup: "Chest", sets: 3, reps: "12-15", restSeconds: 60, notes: "Contract at center, control the arc" },
  ],
  back: [
    { id: "back_row_db", name: "Dumbbell Row", muscleGroup: "Back", sets: 4, reps: "8-12", restSeconds: 90, notes: "Pull elbow back, squeeze at top" },
    { id: "back_pullup", name: "Pull-Up", muscleGroup: "Back", sets: 3, reps: "5-10", restSeconds: 120, notes: "Full range of motion, dead hang at bottom" },
    { id: "back_bb_row", name: "Barbell Row", muscleGroup: "Back", sets: 4, reps: "6-10", restSeconds: 90, notes: "Hinge at hips, pull to lower chest" },
    { id: "back_cable_row", name: "Seated Cable Row", muscleGroup: "Back", sets: 3, reps: "10-12", restSeconds: 75, notes: "Keep chest up, drive elbows back" },
    { id: "back_lat_pulldown", name: "Lat Pulldown", muscleGroup: "Lats", sets: 4, reps: "10-12", restSeconds: 75, notes: "Pull to upper chest, lean back slightly" },
    { id: "back_deadlift", name: "Romanian Deadlift", muscleGroup: "Back/Hamstrings", sets: 3, reps: "8-10", restSeconds: 120, notes: "Hinge at hips, soft knees, bar close to legs" },
  ],
  legs: [
    { id: "legs_squat", name: "Bodyweight Squat", muscleGroup: "Legs", sets: 3, reps: "15-20", restSeconds: 60, notes: "Chest up, knees track over toes" },
    { id: "legs_db_squat", name: "Goblet Squat", muscleGroup: "Legs", sets: 4, reps: "10-12", restSeconds: 90, notes: "Hold dumbbell at chest, upright torso" },
    { id: "legs_bb_squat", name: "Back Squat", muscleGroup: "Quads/Glutes", sets: 4, reps: "6-10", restSeconds: 120, notes: "Bar on upper traps, break parallel" },
    { id: "legs_lunge", name: "Walking Lunge", muscleGroup: "Legs", sets: 3, reps: "10/leg", restSeconds: 75, notes: "Long stride, front knee over ankle" },
    { id: "legs_rdl", name: "Romanian Deadlift", muscleGroup: "Hamstrings", sets: 3, reps: "10-12", restSeconds: 90, notes: "Hinge at hips, feel hamstring stretch" },
    { id: "legs_calf", name: "Calf Raise", muscleGroup: "Calves", sets: 4, reps: "15-20", restSeconds: 45, notes: "Full range, pause at top" },
    { id: "legs_leg_press", name: "Leg Press", muscleGroup: "Quads", sets: 4, reps: "10-15", restSeconds: 90, notes: "Feet shoulder-width, don't lock out" },
  ],
  shoulders: [
    { id: "sh_lateral", name: "Lateral Raise", muscleGroup: "Shoulders", sets: 3, reps: "12-15", restSeconds: 60, notes: "Slight bend in elbows, lead with elbows" },
    { id: "sh_ohp_db", name: "DB Overhead Press", muscleGroup: "Shoulders", sets: 4, reps: "8-12", restSeconds: 90, notes: "Core tight, press straight overhead" },
    { id: "sh_ohp_bb", name: "Barbell OHP", muscleGroup: "Shoulders", sets: 4, reps: "6-10", restSeconds: 120, notes: "Bar starts at upper chest, press overhead" },
    { id: "sh_front_raise", name: "Front Raise", muscleGroup: "Front Delts", sets: 3, reps: "12-15", restSeconds: 60, notes: "Controlled movement, don't swing" },
    { id: "sh_face_pull", name: "Face Pull", muscleGroup: "Rear Delts", sets: 3, reps: "15-20", restSeconds: 60, notes: "Pull to forehead level, external rotation" },
  ],
  arms: [
    { id: "arm_curl_db", name: "Dumbbell Curl", muscleGroup: "Biceps", sets: 3, reps: "10-12", restSeconds: 60, notes: "Supinate at top, control the descent" },
    { id: "arm_tricep_ext", name: "Tricep Extension", muscleGroup: "Triceps", sets: 3, reps: "10-12", restSeconds: 60, notes: "Keep elbows tucked, extend fully" },
    { id: "arm_hammer_curl", name: "Hammer Curl", muscleGroup: "Biceps/Brachialis", sets: 3, reps: "10-12", restSeconds: 60, notes: "Neutral grip, controlled movement" },
    { id: "arm_tricep_pushdown", name: "Cable Pushdown", muscleGroup: "Triceps", sets: 3, reps: "12-15", restSeconds: 60, notes: "Elbows fixed to sides, full extension" },
    { id: "arm_dips", name: "Tricep Dips", muscleGroup: "Triceps", sets: 3, reps: "8-12", restSeconds: 75, notes: "Lean slightly forward, elbows behind you" },
    { id: "arm_curl_bb", name: "Barbell Curl", muscleGroup: "Biceps", sets: 3, reps: "8-12", restSeconds: 75, notes: "Full range, don't cheat with momentum" },
  ],
  core: [
    { id: "core_plank", name: "Plank", muscleGroup: "Core", sets: 3, reps: "30-60s", restSeconds: 60, notes: "Neutral spine, squeeze everything" },
    { id: "core_crunch", name: "Crunch", muscleGroup: "Abs", sets: 3, reps: "15-20", restSeconds: 45, notes: "Controlled, don't pull on neck" },
    { id: "core_bicycle", name: "Bicycle Crunch", muscleGroup: "Obliques", sets: 3, reps: "15/side", restSeconds: 45, notes: "Slow and controlled rotation" },
    { id: "core_dead_bug", name: "Dead Bug", muscleGroup: "Core", sets: 3, reps: "10/side", restSeconds: 60, notes: "Keep lower back pressed to floor" },
    { id: "core_leg_raise", name: "Leg Raise", muscleGroup: "Lower Abs", sets: 3, reps: "12-15", restSeconds: 60, notes: "Lower back stays on floor" },
  ],
  cardio: [
    { id: "cardio_jumping_jacks", name: "Jumping Jacks", muscleGroup: "Full Body", sets: 3, reps: "30s", restSeconds: 30, notes: "Warm-up or HIIT" },
    { id: "cardio_mountain_climber", name: "Mountain Climbers", muscleGroup: "Core/Cardio", sets: 3, reps: "20s", restSeconds: 30, notes: "Keep hips low" },
    { id: "cardio_burpee", name: "Burpee", muscleGroup: "Full Body", sets: 3, reps: "10", restSeconds: 60, notes: "Land softly from jump" },
    { id: "cardio_treadmill", name: "Treadmill Run", muscleGroup: "Cardio", sets: 1, reps: "20-30 min", restSeconds: 0, notes: "Zone 2 cardio" },
    { id: "cardio_cycle", name: "Cycling", muscleGroup: "Cardio", sets: 1, reps: "20-30 min", restSeconds: 0, notes: "Moderate resistance" },
  ],
};

function canUseEquipment(ex: Exercise, equipment: Equipment[]): boolean {
  const hasGym = equipment.some((e) => ["barbell", "cable_machine", "squat_rack", "smith_machine"].includes(e));
  const hasDumbbells = equipment.includes("dumbbells");
  const hasBarbell = equipment.includes("barbell");
  const hasPullUp = equipment.includes("pull_up_bar");
  const hasBands = equipment.includes("resistance_bands");
  const hasTreadmill = equipment.includes("treadmill");
  const hasCycle = equipment.includes("cycle");
  const noEquip = equipment.includes("no_equipment");

  const id = ex.id;
  if (id.includes("bb_") || id.includes("_bb_")) return hasBarbell;
  if (id.includes("cable")) return hasGym;
  if (id.includes("pullup") || id.includes("pull_up")) return hasPullUp || hasGym;
  if (id === "legs_squat" || id === "core_plank" || id === "core_crunch" ||
      id === "core_bicycle" || id === "core_dead_bug" || id === "core_leg_raise" ||
      id === "cardio_jumping_jacks" || id === "cardio_mountain_climber" ||
      id === "cardio_burpee" || id.includes("lunge") || id === "legs_squat") return true;
  if (id.includes("treadmill")) return hasTreadmill;
  if (id.includes("cycle")) return hasCycle;
  if (id.includes("leg_press")) return hasGym;
  if (id.includes("db_") || id.includes("_db") || id.includes("lateral") ||
      id.includes("front_raise") || id.includes("face_pull") || id.includes("dips")) return hasDumbbells || hasGym;
  if (noEquip) return id.includes("squat") || id.includes("lunge") || id.includes("pushup") || id.includes("core") || id.includes("cardio");
  return hasDumbbells || hasBarbell || hasGym;
}

function getExercisesForMuscle(muscle: string, equipment: Equipment[], count: number, fitnessLevel: string): Exercise[] {
  const pool = (exerciseDatabase[muscle] ?? []).filter((ex) => canUseEquipment(ex, equipment));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  return selected.map((ex) => {
    let sets = ex.sets;
    let reps = ex.reps;
    if (fitnessLevel === "beginner") {
      sets = Math.max(2, sets - 1);
    } else if (fitnessLevel === "advanced") {
      sets = sets + 1;
    }
    return { ...ex, sets };
  });
}

const workoutSplits: Record<number, { dayName: string; muscles: string[] }[]> = {
  2: [
    { dayName: "Upper Body", muscles: ["chest", "back", "shoulders", "arms"] },
    { dayName: "Lower Body", muscles: ["legs", "core"] },
  ],
  3: [
    { dayName: "Push", muscles: ["chest", "shoulders", "arms"] },
    { dayName: "Pull", muscles: ["back", "arms"] },
    { dayName: "Legs & Core", muscles: ["legs", "core"] },
  ],
  4: [
    { dayName: "Chest & Triceps", muscles: ["chest", "arms"] },
    { dayName: "Back & Biceps", muscles: ["back", "arms"] },
    { dayName: "Shoulders & Core", muscles: ["shoulders", "core"] },
    { dayName: "Legs", muscles: ["legs"] },
  ],
  5: [
    { dayName: "Chest", muscles: ["chest", "arms"] },
    { dayName: "Back", muscles: ["back"] },
    { dayName: "Shoulders", muscles: ["shoulders", "core"] },
    { dayName: "Arms", muscles: ["arms", "core"] },
    { dayName: "Legs", muscles: ["legs"] },
  ],
  6: [
    { dayName: "Chest", muscles: ["chest"] },
    { dayName: "Back", muscles: ["back"] },
    { dayName: "Shoulders", muscles: ["shoulders"] },
    { dayName: "Arms", muscles: ["arms"] },
    { dayName: "Legs", muscles: ["legs"] },
    { dayName: "Core & Cardio", muscles: ["core", "cardio"] },
  ],
};

export function generateWorkoutPlan(profile: UserProfile): WorkoutPlan {
  const days = profile.workoutDaysPerWeek;
  const closestSplit = [2, 3, 4, 5, 6].reduce((prev, curr) =>
    Math.abs(curr - days) < Math.abs(prev - days) ? curr : prev
  );
  const split = workoutSplits[closestSplit] ?? workoutSplits[3];

  const workoutDays: WorkoutDay[] = split.map((day, i) => {
    const exercises: Exercise[] = [];
    day.muscles.forEach((muscle) => {
      const count = day.muscles.length === 1 ? 4 : day.muscles.length === 2 ? 3 : 2;
      exercises.push(...getExercisesForMuscle(muscle, profile.equipment, count, profile.fitnessLevel));
    });
    return {
      id: `day_${i}`,
      dayName: day.dayName,
      muscleGroups: day.muscles,
      exercises: exercises.slice(0, 8),
    };
  });

  const goalNames: Record<string, string> = {
    fat_loss: "Fat Loss",
    muscle_gain: "Muscle Building",
    strength: "Strength",
    endurance: "Endurance",
    maintenance: "Maintenance",
    general_fitness: "General Fitness",
  };

  return {
    id: Date.now().toString(),
    name: `${profile.fitnessLevel.charAt(0).toUpperCase() + profile.fitnessLevel.slice(1)} ${goalNames[profile.goal]} Plan`,
    goal: profile.goal,
    days: workoutDays,
    generatedAt: new Date().toISOString(),
  };
}

// ---- MEAL PLAN GENERATOR ----

interface FoodItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  servingSize: string;
  types: FoodPreference[];
}

const foodDatabase: Record<string, FoodItem[]> = {
  breakfast: [
    { name: "Oatmeal with berries", calories: 320, protein: 10, carbs: 55, fats: 7, servingSize: "1 bowl", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Eggs & whole wheat toast", calories: 380, protein: 22, carbs: 35, fats: 14, servingSize: "2 eggs + 2 slices", types: ["eggetarian", "non_vegetarian"] },
    { name: "Greek yogurt parfait", calories: 290, protein: 20, carbs: 38, fats: 5, servingSize: "1 cup", types: ["vegetarian", "eggetarian", "non_vegetarian"] },
    { name: "Protein pancakes", calories: 350, protein: 25, carbs: 42, fats: 8, servingSize: "3 pancakes", types: ["eggetarian", "non_vegetarian"] },
    { name: "Avocado toast", calories: 280, protein: 8, carbs: 30, fats: 16, servingSize: "2 slices", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Tofu scramble", calories: 260, protein: 18, carbs: 12, fats: 14, servingSize: "1 serving", types: ["vegetarian", "vegan"] },
    { name: "Muesli with almond milk", calories: 310, protein: 9, carbs: 52, fats: 8, servingSize: "1 bowl", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Chicken & egg whites", calories: 320, protein: 40, carbs: 10, fats: 10, servingSize: "1 serving", types: ["non_vegetarian"] },
  ],
  lunch: [
    { name: "Grilled chicken salad", calories: 380, protein: 40, carbs: 20, fats: 14, servingSize: "1 bowl", types: ["non_vegetarian"] },
    { name: "Quinoa veggie bowl", calories: 360, protein: 14, carbs: 52, fats: 10, servingSize: "1 bowl", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Tuna wrap", calories: 420, protein: 35, carbs: 40, fats: 12, servingSize: "1 wrap", types: ["non_vegetarian"] },
    { name: "Lentil soup & bread", calories: 340, protein: 18, carbs: 52, fats: 5, servingSize: "1 bowl + 1 slice", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Paneer tikka rice bowl", calories: 410, protein: 22, carbs: 45, fats: 14, servingSize: "1 bowl", types: ["vegetarian", "eggetarian"] },
    { name: "Tofu stir-fry", calories: 350, protein: 20, carbs: 38, fats: 12, servingSize: "1 serving", types: ["vegetarian", "vegan"] },
    { name: "Salmon & brown rice", calories: 440, protein: 38, carbs: 42, fats: 14, servingSize: "1 plate", types: ["non_vegetarian"] },
    { name: "Chickpea curry & rice", calories: 390, protein: 16, carbs: 58, fats: 10, servingSize: "1 plate", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
  ],
  dinner: [
    { name: "Grilled salmon & veggies", calories: 420, protein: 40, carbs: 18, fats: 18, servingSize: "1 plate", types: ["non_vegetarian"] },
    { name: "Chicken breast & sweet potato", calories: 430, protein: 45, carbs: 42, fats: 7, servingSize: "1 plate", types: ["non_vegetarian"] },
    { name: "Dal tadka & roti", calories: 380, protein: 18, carbs: 56, fats: 8, servingSize: "2 rotis + dal", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Egg fried rice", calories: 400, protein: 18, carbs: 55, fats: 12, servingSize: "1 bowl", types: ["eggetarian", "non_vegetarian"] },
    { name: "Stir-fried tofu & noodles", calories: 380, protein: 20, carbs: 48, fats: 12, servingSize: "1 bowl", types: ["vegetarian", "vegan"] },
    { name: "Beef steak & salad", calories: 480, protein: 52, carbs: 10, fats: 22, servingSize: "1 plate", types: ["non_vegetarian"] },
    { name: "Paneer palak & jeera rice", calories: 420, protein: 20, carbs: 50, fats: 14, servingSize: "1 plate", types: ["vegetarian", "eggetarian"] },
    { name: "Grilled shrimp & quinoa", calories: 370, protein: 38, carbs: 35, fats: 8, servingSize: "1 plate", types: ["non_vegetarian"] },
  ],
  snack: [
    { name: "Protein shake", calories: 180, protein: 25, carbs: 12, fats: 3, servingSize: "1 scoop", types: ["vegetarian", "eggetarian", "non_vegetarian"] },
    { name: "Almonds & walnuts", calories: 200, protein: 6, carbs: 8, fats: 18, servingSize: "30g", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Banana & peanut butter", calories: 220, protein: 6, carbs: 32, fats: 9, servingSize: "1 banana + 1 tbsp", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Cottage cheese", calories: 150, protein: 18, carbs: 6, fats: 4, servingSize: "100g", types: ["vegetarian", "eggetarian", "non_vegetarian"] },
    { name: "Rice cakes & hummus", calories: 160, protein: 5, carbs: 28, fats: 5, servingSize: "2 cakes + 2 tbsp", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
    { name: "Greek yogurt", calories: 130, protein: 15, carbs: 10, fats: 3, servingSize: "150g", types: ["vegetarian", "eggetarian", "non_vegetarian"] },
    { name: "Mixed berries & seeds", calories: 120, protein: 3, carbs: 20, fats: 5, servingSize: "1 cup", types: ["vegetarian", "eggetarian", "vegan", "non_vegetarian"] },
  ],
};

function pickMeal(
  type: keyof typeof foodDatabase,
  foodPref: FoodPreference,
  restrictions: string,
  disliked: string
): FoodItem | null {
  const pool = (foodDatabase[type] ?? []).filter((f) => {
    if (!f.types.includes(foodPref)) return false;
    const lowerRestrict = restrictions.toLowerCase();
    const lowerDislike = disliked.toLowerCase();
    if (lowerRestrict && f.name.toLowerCase().includes(lowerRestrict.split(",")[0]?.trim())) return false;
    if (lowerDislike && f.name.toLowerCase().includes(lowerDislike.split(",")[0]?.trim())) return false;
    return true;
  });
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function generateMealPlan(profile: UserProfile): MealPlan {
  const targetMacros = calculateMacrosForProfile(profile);
  const mealTypes: ("breakfast" | "lunch" | "dinner" | "snack")[] = ["breakfast", "lunch", "dinner", "snack"];
  const meals: Meal[] = [];

  mealTypes.forEach((type) => {
    const food = pickMeal(type, profile.foodPreference, profile.dietaryRestrictions, profile.dislikedFoods);
    if (!food) return;

    const meal: Meal = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: food.name,
      mealType: type,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fats: food.fats,
      description: `A nutritious ${type} option for your ${profile.goal.replace("_", " ")} goal.`,
      ingredients: [food.servingSize],
    };
    meals.push(meal);
  });

  const totals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fats: acc.fats + m.fats,
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );

  return {
    id: Date.now().toString(),
    meals,
    ...totals,
    generatedAt: new Date().toISOString(),
  };
}

function calculateMacrosForProfile(profile: UserProfile) {
  const bmr =
    profile.gender === "male"
      ? 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + 5
      : 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age - 161;

  const activityMultipliers: Record<string, number> = {
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
  };
  const tdee = Math.round(bmr * (activityMultipliers[profile.activityLevel] ?? 1.55));

  let calories = tdee;
  if (profile.goal === "fat_loss") calories = tdee - 400;
  if (profile.goal === "muscle_gain") calories = tdee + 300;

  const protein = Math.round(profile.weightKg * 2.0);
  const fats = Math.round((calories * 0.25) / 9);
  const carbs = Math.round((calories - protein * 4 - fats * 9) / 4);

  return { calories, protein, carbs, fats };
}
