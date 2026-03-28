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

export default router;
