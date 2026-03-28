import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface Meal {
  id: string;
  name: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  description: string;
  ingredients: string[];
}

export interface MealPlan {
  id: string;
  meals: Meal[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  generatedAt: string;
}

export interface FoodLogEntry {
  id: string;
  date: string;
  mealId?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  servingSize: string;
  timestamp: string;
}

interface NutritionContextType {
  mealPlan: MealPlan | null;
  foodLog: FoodLogEntry[];
  setMealPlan: (plan: MealPlan) => void;
  logFood: (entry: Omit<FoodLogEntry, "id" | "timestamp">) => void;
  removeLogEntry: (id: string) => void;
  getTodayLog: () => FoodLogEntry[];
  getTodayTotals: () => {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
  getWeeklyCalories: () => { date: string; calories: number }[];
}

const NutritionContext = createContext<NutritionContextType | null>(null);

export function NutritionProvider({ children }: { children: React.ReactNode }) {
  const [mealPlan, setMealPlanState] = useState<MealPlan | null>(null);
  const [foodLog, setFoodLog] = useState<FoodLogEntry[]>([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const [mp, fl] = await Promise.all([
        AsyncStorage.getItem("@fitai_meal_plan"),
        AsyncStorage.getItem("@fitai_food_log"),
      ]);
      if (mp) setMealPlanState(JSON.parse(mp));
      if (fl) setFoodLog(JSON.parse(fl));
    } catch (e) {}
  };

  const setMealPlan = useCallback((plan: MealPlan) => {
    setMealPlanState(plan);
    AsyncStorage.setItem("@fitai_meal_plan", JSON.stringify(plan));
  }, []);

  const logFood = useCallback((entry: Omit<FoodLogEntry, "id" | "timestamp">) => {
    const newEntry: FoodLogEntry = {
      ...entry,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
    };
    setFoodLog((prev) => {
      const next = [...prev, newEntry].slice(-500);
      AsyncStorage.setItem("@fitai_food_log", JSON.stringify(next));
      return next;
    });
  }, []);

  const removeLogEntry = useCallback((id: string) => {
    setFoodLog((prev) => {
      const next = prev.filter((e) => e.id !== id);
      AsyncStorage.setItem("@fitai_food_log", JSON.stringify(next));
      return next;
    });
  }, []);

  const getTodayLog = useCallback((): FoodLogEntry[] => {
    const today = new Date().toISOString().split("T")[0];
    return foodLog.filter((e) => e.date === today);
  }, [foodLog]);

  const getTodayTotals = useCallback(() => {
    const todayLog = getTodayLog();
    return todayLog.reduce(
      (acc, e) => ({
        calories: acc.calories + e.calories,
        protein: acc.protein + e.protein,
        carbs: acc.carbs + e.carbs,
        fats: acc.fats + e.fats,
      }),
      { calories: 0, protein: 0, carbs: 0, fats: 0 }
    );
  }, [getTodayLog]);

  const getWeeklyCalories = useCallback((): { date: string; calories: number }[] => {
    const result: { date: string; calories: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const cal = foodLog
        .filter((e) => e.date === dateStr)
        .reduce((sum, e) => sum + e.calories, 0);
      result.push({ date: dateStr, calories: cal });
    }
    return result;
  }, [foodLog]);

  return (
    <NutritionContext.Provider
      value={{
        mealPlan,
        foodLog,
        setMealPlan,
        logFood,
        removeLogEntry,
        getTodayLog,
        getTodayTotals,
        getWeeklyCalories,
      }}
    >
      {children}
    </NutritionContext.Provider>
  );
}

export function useNutrition() {
  const ctx = useContext(NutritionContext);
  if (!ctx) throw new Error("useNutrition must be used within NutritionProvider");
  return ctx;
}
