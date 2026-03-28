import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

router.post("/recognize-food", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    const mediaType = imageBase64.startsWith("/9j/") ? "image/jpeg" : "image/png";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Analyze this food image. Identify all food items visible. For each item, estimate the calories, protein (g), carbs (g), and fats (g) based on a typical serving size.

Return ONLY valid JSON in this exact format:
{
  "foods": [
    {
      "name": "Food Name",
      "servingSize": "1 cup / 100g / 1 piece etc",
      "calories": 250,
      "protein": 20,
      "carbs": 30,
      "fats": 8,
      "confidence": "high"
    }
  ],
  "totalCalories": 250,
  "totalProtein": 20,
  "totalCarbs": 30,
  "totalFats": 8,
  "description": "Brief description of the meal"
}

Be accurate with nutritional estimates. If you cannot identify the food clearly, set confidence to "low".`,
            },
          ],
        },
      ],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Failed to parse food analysis" });
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.foods || !Array.isArray(parsed.foods)) {
      res.status(500).json({ error: "Invalid food analysis response" });
      return;
    }
    parsed.foods = parsed.foods.map((f: any) => ({
      name: f.name || "Unknown food",
      servingSize: f.servingSize || "1 serving",
      calories: Number(f.calories) || 0,
      protein: Number(f.protein) || 0,
      carbs: Number(f.carbs) || 0,
      fats: Number(f.fats) || 0,
      confidence: f.confidence || "medium",
    }));
    parsed.totalCalories = Number(parsed.totalCalories) || parsed.foods.reduce((s: number, f: any) => s + f.calories, 0);
    parsed.totalProtein = Number(parsed.totalProtein) || parsed.foods.reduce((s: number, f: any) => s + f.protein, 0);
    parsed.totalCarbs = Number(parsed.totalCarbs) || parsed.foods.reduce((s: number, f: any) => s + f.carbs, 0);
    parsed.totalFats = Number(parsed.totalFats) || parsed.foods.reduce((s: number, f: any) => s + f.fats, 0);
    parsed.description = parsed.description || "Analyzed meal";
    res.json(parsed);
  } catch (error: any) {
    console.error("Food recognition error:", error?.message);
    res.status(500).json({ error: "Failed to analyze food image" });
  }
});

router.post("/generate-workout", async (req, res) => {
  try {
    const { profile, planType } = req.body;
    if (!profile) {
      res.status(400).json({ error: "profile is required" });
      return;
    }

    const prompt = planType === "daily"
      ? `Create a single day workout for this person:
Name: ${profile.name}, Age: ${profile.age}, Gender: ${profile.gender}
Weight: ${profile.weightKg}kg, Height: ${profile.heightCm}cm
Goal: ${profile.goal}, Level: ${profile.fitnessLevel}
Workout preference: ${profile.workoutPreference}
Available equipment: ${profile.equipment?.join(", ") || "no equipment"}
Session duration: ${profile.workoutDurationMins} minutes

Create ONE workout day optimized for their goal. Return ONLY valid JSON:
{
  "days": [
    {
      "id": "day_0",
      "dayName": "Full Body Power",
      "muscleGroups": ["chest", "back", "legs"],
      "exercises": [
        {
          "id": "unique_id",
          "name": "Exercise Name",
          "muscleGroup": "Target Muscle",
          "sets": 4,
          "reps": "8-12",
          "restSeconds": 90,
          "notes": "Form cue or tip"
        }
      ]
    }
  ],
  "name": "AI Daily Workout",
  "goal": "${profile.goal}"
}`
      : `Create a full weekly workout plan for this person:
Name: ${profile.name}, Age: ${profile.age}, Gender: ${profile.gender}
Weight: ${profile.weightKg}kg, Height: ${profile.heightCm}cm
Goal: ${profile.goal}, Level: ${profile.fitnessLevel}
Activity level: ${profile.activityLevel}
Workout preference: ${profile.workoutPreference}
Days per week: ${profile.workoutDaysPerWeek}
Available equipment: ${profile.equipment?.join(", ") || "no equipment"}
Session duration: ${profile.workoutDurationMins} minutes
Medical notes: ${profile.medicalNotes || "none"}

Create a ${profile.workoutDaysPerWeek}-day split optimized for ${profile.goal}. Include 4-6 exercises per day. Return ONLY valid JSON:
{
  "days": [
    {
      "id": "day_0",
      "dayName": "Push Day",
      "muscleGroups": ["chest", "shoulders", "triceps"],
      "exercises": [
        {
          "id": "unique_id",
          "name": "Exercise Name",
          "muscleGroup": "Target Muscle",
          "sets": 4,
          "reps": "8-12",
          "restSeconds": 90,
          "notes": "Form cue or tip"
        }
      ]
    }
  ],
  "name": "AI ${profile.fitnessLevel} ${profile.goal} Plan",
  "goal": "${profile.goal}"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Failed to parse workout plan" });
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.days || !Array.isArray(parsed.days)) {
      res.status(500).json({ error: "Invalid workout plan response" });
      return;
    }
    parsed.days = parsed.days.map((d: any, i: number) => ({
      id: d.id || `day_${i}`,
      dayName: d.dayName || `Day ${i + 1}`,
      muscleGroups: Array.isArray(d.muscleGroups) ? d.muscleGroups : [],
      exercises: Array.isArray(d.exercises) ? d.exercises.map((ex: any, j: number) => ({
        id: ex.id || `ex_${i}_${j}`,
        name: ex.name || "Unknown Exercise",
        muscleGroup: ex.muscleGroup || "",
        sets: Number(ex.sets) || 3,
        reps: String(ex.reps || "10"),
        restSeconds: Number(ex.restSeconds) || 60,
        notes: ex.notes || "",
      })) : [],
    }));
    parsed.name = parsed.name || "AI Workout Plan";
    parsed.goal = parsed.goal || profile.goal || "general_fitness";
    res.json(parsed);
  } catch (error: any) {
    console.error("Workout generation error:", error?.message);
    res.status(500).json({ error: "Failed to generate workout plan" });
  }
});

router.post("/generate-meal-plan", async (req, res) => {
  try {
    const { profile, dietPrefs } = req.body;
    if (!profile) {
      res.status(400).json({ error: "profile is required" });
      return;
    }

    const dp = dietPrefs || {};
    const dietType = dp.dietType || "balanced";
    const favoriteFoods = dp.favoriteFoods || "";
    const mealSuggestions = dp.mealSuggestions || "";
    const mealsPerDay = dp.mealsPerDay || 4;
    const foodPreference = profile.foodPreference || "non_vegetarian";
    const restrictions = profile.dietaryRestrictions || "";
    const disliked = profile.dislikedFoods || "";

    const weightDelta = (profile.targetWeightKg || profile.weightKg) - profile.weightKg;
    const weeks = profile.targetWeeks || 12;
    let dailyCalories = 2000;
    const bmr = profile.gender === "male"
      ? 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + 5
      : 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age - 161;
    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2, lightly_active: 1.375, moderately_active: 1.55,
      very_active: 1.725, extra_active: 1.9,
    };
    const tdee = Math.round(bmr * (activityMultipliers[profile.activityLevel] || 1.55));
    if (weightDelta !== 0 && weeks > 0) {
      const adj = Math.max(-1000, Math.min(1000, Math.round((weightDelta * 7700) / (weeks * 7))));
      dailyCalories = Math.max(1200, tdee + adj);
    } else {
      dailyCalories = tdee;
      if (profile.goal === "fat_loss") dailyCalories = tdee - 400;
      if (profile.goal === "muscle_gain") dailyCalories = tdee + 300;
    }

    const prompt = `You are an expert nutritionist. Create a personalized daily meal plan for this person:

Profile:
- Name: ${profile.name}, Age: ${profile.age}, Gender: ${profile.gender}
- Weight: ${profile.weightKg}kg, Target: ${profile.targetWeightKg || profile.weightKg}kg
- Height: ${profile.heightCm}cm
- Goal: ${profile.goal}
- Activity: ${profile.activityLevel}
- TDEE: ${tdee} kcal, Daily target: ${dailyCalories} kcal

Diet Preferences:
- Diet type: ${dietType}
- Food preference: ${foodPreference}
${restrictions ? `- Restrictions/allergies: ${restrictions}` : ""}
${disliked ? `- Foods to avoid: ${disliked}` : ""}
${favoriteFoods ? `- Favorite foods (try to include): ${favoriteFoods}` : ""}
${mealSuggestions ? `- Special requests: ${mealSuggestions}` : ""}
- Meals per day: ${mealsPerDay}

Create exactly ${mealsPerDay} meals that total approximately ${dailyCalories} calories.
${dietType === "keto" ? "Keep carbs under 25g total. High fat, moderate protein." : ""}
${dietType === "low_carb" ? "Keep carbs under 100g total." : ""}
${dietType === "high_protein" ? "Protein should be at least 35% of calories." : ""}
${dietType === "mediterranean" ? "Focus on olive oil, fish, vegetables, whole grains, legumes." : ""}
${dietType === "paleo" ? "No grains, dairy, legumes, or processed foods." : ""}

Return ONLY valid JSON in this exact format:
{
  "meals": [
    {
      "name": "Meal Name",
      "mealType": "breakfast|lunch|dinner|snack",
      "calories": 500,
      "protein": 35,
      "carbs": 40,
      "fats": 20,
      "ingredients": ["ingredient 1", "ingredient 2"],
      "instructions": "Brief preparation instructions"
    }
  ],
  "totalCalories": ${dailyCalories},
  "totalProtein": 150,
  "totalCarbs": 200,
  "totalFats": 65,
  "dietType": "${dietType}",
  "summary": "Brief overview of the meal plan"
}

Be creative with meals, use realistic portions, and make the plan delicious and practical.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Failed to parse meal plan" });
      return;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.meals || !Array.isArray(parsed.meals)) {
      res.status(500).json({ error: "Invalid meal plan response" });
      return;
    }
    const mealTypeMap: Record<number, string> = { 0: "breakfast", 1: "lunch", 2: "dinner", 3: "snack" };
    parsed.meals = parsed.meals.map((m: any, i: number) => ({
      id: `ai_meal_${Date.now()}_${i}`,
      name: m.name || `Meal ${i + 1}`,
      mealType: m.mealType || mealTypeMap[i] || "snack",
      calories: Number(m.calories) || 0,
      protein: Number(m.protein) || 0,
      carbs: Number(m.carbs) || 0,
      fats: Number(m.fats) || 0,
      ingredients: Array.isArray(m.ingredients) ? m.ingredients : [],
      instructions: m.instructions || "",
    }));
    parsed.totalCalories = Number(parsed.totalCalories) || parsed.meals.reduce((s: number, m: any) => s + m.calories, 0);
    parsed.totalProtein = Number(parsed.totalProtein) || parsed.meals.reduce((s: number, m: any) => s + m.protein, 0);
    parsed.totalCarbs = Number(parsed.totalCarbs) || parsed.meals.reduce((s: number, m: any) => s + m.carbs, 0);
    parsed.totalFats = Number(parsed.totalFats) || parsed.meals.reduce((s: number, m: any) => s + m.fats, 0);
    parsed.dietType = parsed.dietType || dietType;
    parsed.summary = parsed.summary || "AI-generated meal plan";
    res.json(parsed);
  } catch (error: any) {
    console.error("Meal plan generation error:", error?.message);
    res.status(500).json({ error: "Failed to generate meal plan" });
  }
});

export default router;
