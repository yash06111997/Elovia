import { Platform } from "react-native";

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

export async function recognizeFood(imageBase64: string): Promise<{
  foods: {
    name: string;
    servingSize: string;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    confidence: string;
  }[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  description: string;
}> {
  const base = getBaseUrl();
  const response = await fetch(`${base}/api/ai/recognize-food`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || "Failed to recognize food");
  }

  return response.json();
}

export async function generateAIMealPlan(
  profile: any,
  dietPrefs: {
    dietType: string;
    favoriteFoods: string;
    mealSuggestions: string;
    mealsPerDay: number;
  }
): Promise<{
  meals: {
    id: string;
    name: string;
    mealType: string;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    ingredients: string[];
    instructions: string;
  }[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  dietType: string;
  summary: string;
}> {
  const base = getBaseUrl();
  const response = await fetch(`${base}/api/ai/generate-meal-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, dietPrefs }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || "Failed to generate meal plan");
  }

  return response.json();
}

export async function generateAIWorkout(
  profile: any,
  planType: "daily" | "scheduled"
): Promise<{
  days: any[];
  name: string;
  goal: string;
}> {
  const base = getBaseUrl();
  const response = await fetch(`${base}/api/ai/generate-workout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, planType }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || "Failed to generate workout");
  }

  return response.json();
}
