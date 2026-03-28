import { UserProfile, Equipment, FoodPreference } from "@/context/AppContext";
import { WorkoutPlan, WorkoutDay, Exercise } from "@/context/WorkoutContext";
import { MealPlan, Meal } from "@/context/NutritionContext";
import { allExercises, ExerciseEntry } from "@/utils/exerciseDatabase";

// ---- WORKOUT GENERATOR ----

function entryToExercise(e: ExerciseEntry): Exercise {
  return {
    id: e.id,
    name: e.name,
    muscleGroup: e.primaryMuscle,
    sets: e.sets,
    reps: e.reps,
    restSeconds: e.restSeconds,
    notes: e.notes,
  };
}

function canUseEquipment(e: ExerciseEntry, equipment: Equipment[]): boolean {
  const has = (eq: string) => equipment.includes(eq as Equipment);
  const hasGym = has("barbell") || has("cable_machine") || has("squat_rack") || has("smith_machine");
  const hasDumbbells = has("dumbbells") || has("kettlebells");
  const noEquip = has("no_equipment");

  if (e.equipment.includes("none")) return true;

  if (noEquip) {
    return e.equipment.includes("none");
  }

  return e.equipment.some((eq) => {
    if (eq === "none") return true;
    if (eq === "barbell") return has("barbell");
    if (eq === "bench") return has("bench") || hasGym;
    if (eq === "dumbbells") return hasDumbbells;
    if (eq === "kettlebells") return has("kettlebells") || hasDumbbells;
    if (eq === "pull_up_bar") return has("pull_up_bar") || hasGym;
    if (eq === "cable_machine") return has("cable_machine") || has("squat_rack") || has("smith_machine");
    if (eq === "squat_rack") return has("squat_rack") || has("smith_machine");
    if (eq === "resistance_bands") return has("resistance_bands") || has("cable_machine") || hasGym;
    if (eq === "treadmill") return has("treadmill");
    if (eq === "cycle") return has("cycle");
    if (eq === "dip_bars") return has("pull_up_bar") || hasGym;
    if (eq === "box") return has("bench") || hasGym;
    if (eq === "ab_wheel") return false;
    return false;
  });
}

const CATEGORY_KEYS: Record<string, string[]> = {
  chest: ["Chest"],
  back: ["Back"],
  legs: ["Legs"],
  shoulders: ["Shoulders"],
  arms: ["Arms"],
  core: ["Core"],
  glutes: ["Glutes"],
  cardio: ["Cardio"],
};

function getExercisesForCategory(
  categoryKey: string,
  equipment: Equipment[],
  count: number,
  fitnessLevel: string
): Exercise[] {
  const cats = CATEGORY_KEYS[categoryKey] ?? [categoryKey];
  const pool = allExercises.filter(
    (e) =>
      cats.includes(e.category) &&
      canUseEquipment(e, equipment) &&
      (fitnessLevel === "beginner"
        ? e.difficulty !== "advanced"
        : fitnessLevel === "intermediate"
        ? e.difficulty !== "advanced" || Math.random() > 0.5
        : true)
  );
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((e) => {
    let sets = e.sets;
    if (fitnessLevel === "beginner") sets = Math.max(2, sets - 1);
    if (fitnessLevel === "advanced") sets = sets + 1;
    return { ...entryToExercise(e), sets };
  });
}

const workoutSplits: Record<number, { dayName: string; muscles: string[] }[]> = {
  2: [
    { dayName: "Upper Body", muscles: ["chest", "back", "shoulders", "arms"] },
    { dayName: "Lower Body", muscles: ["legs", "glutes", "core"] },
  ],
  3: [
    { dayName: "Push", muscles: ["chest", "shoulders", "arms"] },
    { dayName: "Pull", muscles: ["back", "arms"] },
    { dayName: "Legs & Glutes", muscles: ["legs", "glutes", "core"] },
  ],
  4: [
    { dayName: "Chest & Triceps", muscles: ["chest", "arms"] },
    { dayName: "Back & Biceps", muscles: ["back", "arms"] },
    { dayName: "Shoulders & Core", muscles: ["shoulders", "core"] },
    { dayName: "Legs & Glutes", muscles: ["legs", "glutes"] },
  ],
  5: [
    { dayName: "Chest", muscles: ["chest", "arms"] },
    { dayName: "Back", muscles: ["back"] },
    { dayName: "Shoulders", muscles: ["shoulders", "core"] },
    { dayName: "Arms", muscles: ["arms", "core"] },
    { dayName: "Legs & Glutes", muscles: ["legs", "glutes"] },
  ],
  6: [
    { dayName: "Chest", muscles: ["chest"] },
    { dayName: "Back", muscles: ["back"] },
    { dayName: "Shoulders", muscles: ["shoulders"] },
    { dayName: "Arms", muscles: ["arms"] },
    { dayName: "Legs & Glutes", muscles: ["legs", "glutes"] },
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
      const count = day.muscles.length === 1 ? 5 : day.muscles.length === 2 ? 3 : 2;
      exercises.push(...getExercisesForCategory(muscle, profile.equipment, count, profile.fitnessLevel));
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
