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

export interface CustomMealPlan {
  id: string;
  name: string;
  meals: Meal[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  createdAt: string;
  updatedAt: string;
}

export type ActiveMealPlanType = "ai" | "custom";

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
  customMealPlans: CustomMealPlan[];
  activeMealPlanType: ActiveMealPlanType;
  activeCustomMealPlanId: string | null;
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
  addCustomMealPlan: (plan: Omit<CustomMealPlan, "id" | "createdAt" | "updatedAt">) => CustomMealPlan;
  updateCustomMealPlan: (plan: CustomMealPlan) => void;
  deleteCustomMealPlan: (id: string) => void;
  setActiveMealPlan: (type: ActiveMealPlanType, customPlanId?: string) => void;
  getActiveMealPlanMeals: () => Meal[];
}

const NutritionContext = createContext<NutritionContextType | null>(null);

export function NutritionProvider({ children }: { children: React.ReactNode }) {
  const [mealPlan, setMealPlanState] = useState<MealPlan | null>(null);
  const [foodLog, setFoodLog] = useState<FoodLogEntry[]>([]);
  const [customMealPlans, setCustomMealPlans] = useState<CustomMealPlan[]>([]);
  const [activeMealPlanType, setActiveMealPlanType] = useState<ActiveMealPlanType>("ai");
  const [activeCustomMealPlanId, setActiveCustomMealPlanId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const [mp, fl, cmp, ampt, acmpid] = await Promise.all([
        AsyncStorage.getItem("@fitai_meal_plan"),
        AsyncStorage.getItem("@fitai_food_log"),
        AsyncStorage.getItem("@fitai_custom_meal_plans"),
        AsyncStorage.getItem("@fitai_active_meal_plan_type"),
        AsyncStorage.getItem("@fitai_active_custom_meal_plan_id"),
      ]);
      if (mp) setMealPlanState(JSON.parse(mp));
      if (fl) setFoodLog(JSON.parse(fl));
      if (cmp) setCustomMealPlans(JSON.parse(cmp));
      if (ampt) setActiveMealPlanType(JSON.parse(ampt));
      if (acmpid) setActiveCustomMealPlanId(JSON.parse(acmpid));
    } catch (e) {}
  };

  const setMealPlan = useCallback((plan: MealPlan) => {
    setMealPlanState(plan);
    setActiveMealPlanType("ai");
    AsyncStorage.setItem("@fitai_meal_plan", JSON.stringify(plan));
    AsyncStorage.setItem("@fitai_active_meal_plan_type", JSON.stringify("ai"));
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

  const addCustomMealPlan = useCallback(
    (planData: Omit<CustomMealPlan, "id" | "createdAt" | "updatedAt">): CustomMealPlan => {
      const newPlan: CustomMealPlan = {
        ...planData,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setCustomMealPlans((prev) => {
        const updated = [...prev, newPlan];
        AsyncStorage.setItem("@fitai_custom_meal_plans", JSON.stringify(updated));
        return updated;
      });
      return newPlan;
    },
    []
  );

  const updateCustomMealPlan = useCallback((updatedPlan: CustomMealPlan) => {
    setCustomMealPlans((prev) => {
      const updated = prev.map((p) =>
        p.id === updatedPlan.id
          ? { ...updatedPlan, updatedAt: new Date().toISOString() }
          : p
      );
      AsyncStorage.setItem("@fitai_custom_meal_plans", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteCustomMealPlan = useCallback((id: string) => {
    setCustomMealPlans((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      AsyncStorage.setItem("@fitai_custom_meal_plans", JSON.stringify(updated));
      return updated;
    });
    setActiveCustomMealPlanId((prev) => {
      if (prev === id) {
        AsyncStorage.setItem("@fitai_active_meal_plan_type", JSON.stringify("ai"));
        AsyncStorage.removeItem("@fitai_active_custom_meal_plan_id");
        setActiveMealPlanType("ai");
        return null;
      }
      return prev;
    });
  }, []);

  const setActiveMealPlan = useCallback((type: ActiveMealPlanType, customPlanId?: string) => {
    setActiveMealPlanType(type);
    AsyncStorage.setItem("@fitai_active_meal_plan_type", JSON.stringify(type));
    if (type === "custom" && customPlanId) {
      setActiveCustomMealPlanId(customPlanId);
      AsyncStorage.setItem("@fitai_active_custom_meal_plan_id", JSON.stringify(customPlanId));
    } else {
      setActiveCustomMealPlanId(null);
      AsyncStorage.removeItem("@fitai_active_custom_meal_plan_id");
    }
  }, []);

  const getActiveMealPlanMeals = useCallback((): Meal[] => {
    if (activeMealPlanType === "custom" && activeCustomMealPlanId) {
      const cp = customMealPlans.find((p) => p.id === activeCustomMealPlanId);
      return cp ? cp.meals : [];
    }
    return mealPlan ? mealPlan.meals : [];
  }, [activeMealPlanType, activeCustomMealPlanId, customMealPlans, mealPlan]);

  return (
    <NutritionContext.Provider
      value={{
        mealPlan,
        foodLog,
        customMealPlans,
        activeMealPlanType,
        activeCustomMealPlanId,
        setMealPlan,
        logFood,
        removeLogEntry,
        getTodayLog,
        getTodayTotals,
        getWeeklyCalories,
        addCustomMealPlan,
        updateCustomMealPlan,
        deleteCustomMealPlan,
        setActiveMealPlan,
        getActiveMealPlanMeals,
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
