/**
 * Defensive normalizers for model output.
 *
 * Every field is coerced and defaulted, because a model response is untrusted
 * input like any other. The app renders these values directly into the UI, and
 * a missing `sets` or a string where a number belongs crashes a screen.
 *
 * Hand-rolled rather than schema-library-based to avoid adding a runtime
 * dependency to the server package for this alone.
 */

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num(value, fallback)));
}

function str(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

export interface NormalizedExercise {
  id: string;
  name: string;
  muscleGroup: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
}

export interface NormalizedWorkoutDay {
  id: string;
  dayName: string;
  muscleGroups: string[];
  exercises: NormalizedExercise[];
}

export interface NormalizedWorkoutPlan {
  days: NormalizedWorkoutDay[];
  name: string;
  goal: string;
}

export function normalizeWorkoutPlan(raw: any, fallbackGoal: string): NormalizedWorkoutPlan {
  if (!raw?.days || !Array.isArray(raw.days) || raw.days.length === 0) {
    throw new Error("Model response contained no workout days");
  }

  const days: NormalizedWorkoutDay[] = raw.days.map((d: any, i: number) => ({
    id: str(d?.id, `day_${i}`),
    dayName: str(d?.dayName, `Day ${i + 1}`),
    muscleGroups: strArray(d?.muscleGroups),
    exercises: Array.isArray(d?.exercises)
      ? d.exercises.map((ex: any, j: number) => ({
          id: str(ex?.id, `ex_${i}_${j}`),
          name: str(ex?.name, "Unknown Exercise"),
          muscleGroup: str(ex?.muscleGroup, ""),
          // Clamped: a model occasionally emits absurd values like 100 sets,
          // which renders as an unusable screen and an unsafe instruction.
          sets: clampNum(ex?.sets, 3, 1, 10),
          reps: str(ex?.reps, "10"),
          restSeconds: clampNum(ex?.restSeconds, 60, 0, 600),
          notes: str(ex?.notes, ""),
        }))
      : [],
  }));

  if (days.every((d) => d.exercises.length === 0)) {
    throw new Error("Model response contained no exercises");
  }

  return {
    days,
    name: str(raw?.name, "AI Workout Plan"),
    goal: str(raw?.goal, fallbackGoal || "general_fitness"),
  };
}

export interface NormalizedMeal {
  id: string;
  name: string;
  mealType: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: string[];
  instructions: string;
}

export interface NormalizedMealPlan {
  meals: NormalizedMeal[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  dietType: string;
  summary: string;
}

const MEAL_TYPE_BY_INDEX: Record<number, string> = {
  0: "breakfast",
  1: "lunch",
  2: "dinner",
  3: "snack",
};

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

export function normalizeMealPlan(raw: any, fallbackDietType: string): NormalizedMealPlan {
  if (!raw?.meals || !Array.isArray(raw.meals) || raw.meals.length === 0) {
    throw new Error("Model response contained no meals");
  }

  const meals: NormalizedMeal[] = raw.meals.map((m: any, i: number) => {
    const declaredType = str(m?.mealType, "").toLowerCase();
    return {
      id: `ai_meal_${Date.now()}_${i}`,
      name: str(m?.name, `Meal ${i + 1}`),
      mealType: VALID_MEAL_TYPES.has(declaredType)
        ? declaredType
        : MEAL_TYPE_BY_INDEX[i] ?? "snack",
      calories: clampNum(m?.calories, 0, 0, 5000),
      protein: clampNum(m?.protein, 0, 0, 500),
      carbs: clampNum(m?.carbs, 0, 0, 800),
      fats: clampNum(m?.fats, 0, 0, 400),
      ingredients: strArray(m?.ingredients),
      instructions: str(m?.instructions, ""),
    };
  });

  const sum = (key: "calories" | "protein" | "carbs" | "fats") =>
    meals.reduce((acc, m) => acc + m[key], 0);

  // Prefer the model's own totals only when they land within 15% of the sum of
  // the parts. Models routinely state a target total that contradicts the meals
  // they actually listed, and a total that visibly does not add up destroys
  // trust in every other number on the screen.
  function reconcile(declared: unknown, actual: number): number {
    const d = num(declared, NaN);
    if (!Number.isFinite(d) || actual === 0) return Math.round(actual);
    const drift = Math.abs(d - actual) / actual;
    return drift <= 0.15 ? Math.round(d) : Math.round(actual);
  }

  return {
    meals,
    totalCalories: reconcile(raw?.totalCalories, sum("calories")),
    totalProtein: reconcile(raw?.totalProtein, sum("protein")),
    totalCarbs: reconcile(raw?.totalCarbs, sum("carbs")),
    totalFats: reconcile(raw?.totalFats, sum("fats")),
    dietType: str(raw?.dietType, fallbackDietType),
    summary: str(raw?.summary, "AI-generated meal plan"),
  };
}

export interface NormalizedFood {
  name: string;
  servingSize: string;
  /** Estimated portion weight; the model derives calories from this. */
  estimatedGrams: number | null;
  cookingMethod: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  confidence: string;
  note: string | null;
}

export interface NormalizedFoodRecognition {
  foods: NormalizedFood[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  /** Honest uncertainty band for the whole meal. */
  calorieRangeLow: number;
  calorieRangeHigh: number;
  scaleReference: string | null;
  portionNote: string | null;
  description: string;
}

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

export function normalizeFoodRecognition(raw: any): NormalizedFoodRecognition {
  if (!raw?.foods || !Array.isArray(raw.foods)) {
    throw new Error("Model response contained no foods");
  }

  const foods: NormalizedFood[] = raw.foods.map((f: any) => {
    const confidence = str(f?.confidence, "medium").toLowerCase();
    const grams = num(f?.estimatedGrams, NaN);
    return {
      name: str(f?.name, "Unknown food"),
      servingSize: str(f?.servingSize, "1 serving"),
      estimatedGrams: Number.isFinite(grams) && grams > 0 ? Math.round(Math.min(5000, grams)) : null,
      cookingMethod: f?.cookingMethod ? str(f.cookingMethod, "") || null : null,
      calories: clampNum(f?.calories, 0, 0, 5000),
      protein: clampNum(f?.protein, 0, 0, 500),
      carbs: clampNum(f?.carbs, 0, 0, 800),
      fats: clampNum(f?.fats, 0, 0, 400),
      confidence: VALID_CONFIDENCE.has(confidence) ? confidence : "medium",
      note: f?.note ? str(f.note, "") || null : null,
    };
  });

  const sum = (key: "calories" | "protein" | "carbs" | "fats") =>
    foods.reduce((acc, f) => acc + f[key], 0);

  const totalCalories = Math.round(num(raw?.totalCalories, 0) || sum("calories"));

  // The model is asked for an honest uncertainty band. If it gives a nonsense
  // one (inverted, or not bracketing the total) fall back to +/-20%, which is
  // roughly the real-world accuracy of visual portion estimation.
  let low = Math.round(num(raw?.calorieRangeLow, NaN));
  let high = Math.round(num(raw?.calorieRangeHigh, NaN));
  const bandValid =
    Number.isFinite(low) && Number.isFinite(high) && low <= totalCalories && high >= totalCalories;

  if (!bandValid) {
    low = Math.round(totalCalories * 0.8);
    high = Math.round(totalCalories * 1.2);
  }

  return {
    foods,
    totalCalories,
    totalProtein: Math.round(num(raw?.totalProtein, 0) || sum("protein")),
    totalCarbs: Math.round(num(raw?.totalCarbs, 0) || sum("carbs")),
    totalFats: Math.round(num(raw?.totalFats, 0) || sum("fats")),
    calorieRangeLow: Math.max(0, low),
    calorieRangeHigh: Math.max(0, high),
    scaleReference: raw?.scaleReference ? str(raw.scaleReference, "") || null : null,
    portionNote: raw?.portionNote ? str(raw.portionNote, "") || null : null,
    description: str(raw?.description, "Analyzed meal"),
  };
}

export interface NormalizedRecipe {
  id: string;
  name: string;
  description: string;
  prepMins: number;
  cookMins: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

export function normalizeRecipes(raw: any): NormalizedRecipe[] {
  const list = Array.isArray(raw?.recipes) ? raw.recipes : Array.isArray(raw) ? raw : null;
  if (!list || list.length === 0) {
    throw new Error("Model response contained no recipes");
  }

  return list.map((r: any, i: number) => ({
    id: `ai_recipe_${Date.now()}_${i}`,
    name: str(r?.name, `Recipe ${i + 1}`),
    description: str(r?.description, ""),
    prepMins: clampNum(r?.prepMins, 10, 0, 480),
    cookMins: clampNum(r?.cookMins, 15, 0, 480),
    servings: clampNum(r?.servings, 1, 1, 20),
    calories: clampNum(r?.calories, 0, 0, 5000),
    protein: clampNum(r?.protein, 0, 0, 500),
    carbs: clampNum(r?.carbs, 0, 0, 800),
    fats: clampNum(r?.fats, 0, 0, 400),
    ingredients: strArray(r?.ingredients),
    steps: strArray(r?.steps ?? r?.instructions),
    tags: strArray(r?.tags),
  }));
}

export interface NormalizedSupplementAnalysis {
  identified: boolean;
  displayName: string;
  category: string;
  summary: string;
  evidenceLevel: "strong" | "moderate" | "limited" | "insufficient";
  evidenceNote: string;
  trainingEffects: string[];
  nutritionNotes: string[];
  timingGuidance: string | null;
  commonSideEffects: string[];
  cautions: string[];
  requiresProfessional: boolean;
  disclaimer: string;
}

const VALID_EVIDENCE = new Set(["strong", "moderate", "limited", "insufficient"]);

const DEFAULT_DISCLAIMER =
  "This is general information, not medical advice. Check with a doctor or pharmacist before making any change.";

export function normalizeSupplementAnalysis(
  raw: any,
  fallbackName: string,
  isMedication: boolean,
): NormalizedSupplementAnalysis {
  const evidence = str(raw?.evidenceLevel, "insufficient").toLowerCase();

  // Fail SAFE on the two fields that carry real-world risk: an unidentified
  // substance and anything the model was unsure about must escalate to a human,
  // never quietly render as ordinary advice. Medications always escalate.
  const identified = raw?.identified === true;
  const requiresProfessional =
    raw?.requiresProfessional === true || isMedication || !identified;

  return {
    identified,
    displayName: str(raw?.displayName, fallbackName),
    category: str(raw?.category, isMedication ? "Medication" : "Supplement"),
    summary: str(
      raw?.summary,
      identified
        ? ""
        : "This substance could not be identified confidently, so no information is shown.",
    ),
    evidenceLevel: (VALID_EVIDENCE.has(evidence)
      ? evidence
      : "insufficient") as NormalizedSupplementAnalysis["evidenceLevel"],
    evidenceNote: str(raw?.evidenceNote, ""),
    trainingEffects: strArray(raw?.trainingEffects).slice(0, 8),
    nutritionNotes: strArray(raw?.nutritionNotes).slice(0, 8),
    timingGuidance: raw?.timingGuidance ? str(raw.timingGuidance, "") || null : null,
    commonSideEffects: strArray(raw?.commonSideEffects).slice(0, 8),
    cautions: strArray(raw?.cautions).slice(0, 8),
    requiresProfessional,
    disclaimer: str(raw?.disclaimer, DEFAULT_DISCLAIMER),
  };
}
