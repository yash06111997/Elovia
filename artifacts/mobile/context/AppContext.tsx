import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { onDataRestored } from "@/lib/syncEvents";

export type FitnessGoal =
  | "fat_loss"
  | "muscle_gain"
  | "maintenance"
  | "general_fitness"
  | "strength"
  | "endurance";
export type FitnessLevel = "beginner" | "intermediate" | "advanced";
export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extra_active";
export type WorkoutPreference = "gym" | "home" | "mixed";
export type FoodPreference =
  | "vegetarian"
  | "eggetarian"
  | "non_vegetarian"
  | "vegan";

export type Equipment =
  | "dumbbells"
  | "barbell"
  | "bench"
  | "resistance_bands"
  | "pull_up_bar"
  | "cable_machine"
  | "treadmill"
  | "cycle"
  | "kettlebells"
  | "squat_rack"
  | "smith_machine"
  | "no_equipment";

export type DietType =
  | "balanced"
  | "keto"
  | "low_carb"
  | "high_protein"
  | "mediterranean"
  | "paleo"
  | "vegetarian_focused"
  | "custom";

export interface UserProfile {
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  targetWeeks: number;
  goal: FitnessGoal;
  fitnessLevel: FitnessLevel;
  activityLevel: ActivityLevel;
  workoutPreference: WorkoutPreference;
  workoutDaysPerWeek: number;
  workoutDurationMins: number;
  equipment: Equipment[];
  customEquipment: string;
  foodPreference: FoodPreference;
  dietType: DietType;
  favoriteFoods: string;
  dietaryRestrictions: string;
  dislikedFoods: string;
  mealSuggestions: string;
  medicalNotes: string;
  sleepHours: number;
  waterIntakeLiters: number;
}

export interface CustomMacros {
  enabled: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface HealthMetric {
  date: string;
  weightKg?: number;
  steps?: number;
  heartRate?: number;
  sleepHours?: number;
  waterLiters?: number;
}

export interface AppState {
  profile: UserProfile | null;
  onboardingComplete: boolean;
  healthMetrics: HealthMetric[];
  currentStreak: number;
  totalWorkouts: number;
  colorScheme: "dark" | "light";
  customMacros: CustomMacros | null;
}

interface AppContextType {
  state: AppState;
  setProfile: (profile: UserProfile) => void;
  updateProfileField: (key: keyof UserProfile, value: any) => void;
  completeOnboarding: () => void;
  addHealthMetric: (metric: HealthMetric) => void;
  getTodayMetric: () => HealthMetric | null;
  updateTodayMetric: (updates: Partial<HealthMetric>) => void;
  incrementWorkouts: () => void;
  toggleColorScheme: () => void;
  calculateTDEE: () => number;
  calculateMacros: () => {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
  setCustomMacros: (macros: CustomMacros | null) => void;
}

const defaultState: AppState = {
  profile: null,
  onboardingComplete: false,
  healthMetrics: [],
  currentStreak: 0,
  totalWorkouts: 0,
  colorScheme: "dark",
  customMacros: null,
};

export const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    return onDataRestored(() => {
      loadState();
    });
  }, []);

  const loadState = async () => {
    try {
      const saved = await AsyncStorage.getItem("@fitai_state");
      if (saved) {
        const parsed = JSON.parse(saved) as AppState;
        setState({ ...defaultState, ...parsed, healthMetrics: parsed.healthMetrics ?? [] });
      }
    } catch (e) {
    } finally {
      setLoaded(true);
    }
  };

  const saveState = async (newState: AppState) => {
    try {
      await AsyncStorage.setItem("@fitai_state", JSON.stringify(newState));
    } catch (e) {}
  };

  const setProfile = useCallback((profile: UserProfile) => {
    setState((prev) => {
      const next = { ...prev, profile };
      saveState(next);
      return next;
    });
  }, []);

  const updateProfileField = useCallback((key: keyof UserProfile, value: any) => {
    setState((prev) => {
      if (!prev.profile) return prev;
      const next = { ...prev, profile: { ...prev.profile, [key]: value } };
      saveState(next);
      return next;
    });
  }, []);

  const completeOnboarding = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, onboardingComplete: true };
      saveState(next);
      return next;
    });
  }, []);

  const addHealthMetric = useCallback((metric: HealthMetric) => {
    setState((prev) => {
      const existing = (prev.healthMetrics ?? []).filter((m) => m.date !== metric.date);
      const next = {
        ...prev,
        healthMetrics: [...existing, metric].slice(-90),
      };
      saveState(next);
      return next;
    });
  }, []);

  const getTodayMetric = useCallback((): HealthMetric | null => {
    const today = new Date().toISOString().split("T")[0];
    return (
      (state.healthMetrics ?? []).find((m) => m.date === today) ?? {
        date: today,
        steps: 0,
        waterLiters: 0,
      }
    );
  }, [state.healthMetrics]);

  const updateTodayMetric = useCallback((updates: Partial<HealthMetric>) => {
    const today = new Date().toISOString().split("T")[0];
    setState((prev) => {
      const existing =
        (prev.healthMetrics ?? []).find((m) => m.date === today) ?? { date: today };
      const merged = { ...existing, ...updates };
      const filtered = (prev.healthMetrics ?? []).filter((m) => m.date !== today);
      const next = {
        ...prev,
        healthMetrics: [...filtered, merged].slice(-90),
      };
      saveState(next);
      return next;
    });
  }, []);

  const incrementWorkouts = useCallback(() => {
    setState((prev) => {
      const next = {
        ...prev,
        totalWorkouts: prev.totalWorkouts + 1,
        currentStreak: prev.currentStreak + 1,
      };
      saveState(next);
      return next;
    });
  }, []);

  const toggleColorScheme = useCallback(() => {
    setState((prev) => {
      const next = {
        ...prev,
        colorScheme: prev.colorScheme === "dark" ? ("light" as const) : ("dark" as const),
      };
      saveState(next);
      return next;
    });
  }, []);

  const setCustomMacros = useCallback((macros: CustomMacros | null) => {
    setState((prev) => {
      const next = { ...prev, customMacros: macros };
      saveState(next);
      return next;
    });
  }, []);

  const calculateTDEE = useCallback((): number => {
    const p = state.profile;
    if (!p) return 2000;
    const bmr =
      p.gender === "male"
        ? 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + 5
        : 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age - 161;

    const activityMultipliers: Record<ActivityLevel, number> = {
      sedentary: 1.2,
      lightly_active: 1.375,
      moderately_active: 1.55,
      very_active: 1.725,
      extra_active: 1.9,
    };
    return Math.round(bmr * activityMultipliers[p.activityLevel]);
  }, [state.profile]);

  const calculateMacros = useCallback((): {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  } => {
    if (state.customMacros?.enabled) {
      return {
        calories: state.customMacros.calories,
        protein: state.customMacros.protein,
        carbs: state.customMacros.carbs,
        fats: state.customMacros.fats,
      };
    }

    const p = state.profile;
    const tdee = calculateTDEE();
    if (!p) return { calories: 2000, protein: 150, carbs: 200, fats: 70 };

    let calories = tdee;
    const weightDeltaKg = (p.targetWeightKg || p.weightKg) - p.weightKg;
    const weeks = p.targetWeeks || 12;

    if (weightDeltaKg !== 0 && weeks > 0) {
      const totalKcalDelta = weightDeltaKg * 7700;
      const dailyAdjustment = Math.round(totalKcalDelta / (weeks * 7));
      const cappedAdjustment = Math.max(-1000, Math.min(1000, dailyAdjustment));
      calories = tdee + cappedAdjustment;
    } else {
      if (p.goal === "fat_loss") calories = tdee - 400;
      if (p.goal === "muscle_gain") calories = tdee + 300;
    }

    calories = Math.max(1200, calories);

    const protein = Math.round(p.weightKg * 2.0);
    const fats = Math.round((calories * 0.25) / 9);
    const carbs = Math.max(0, Math.round((calories - protein * 4 - fats * 9) / 4));

    return { calories, protein, carbs, fats };
  }, [state.profile, state.customMacros, calculateTDEE]);

  if (!loaded) return null;

  return (
    <AppContext.Provider
      value={{
        state,
        setProfile,
        updateProfileField,
        completeOnboarding,
        addHealthMetric,
        getTodayMetric,
        updateTodayMetric,
        incrementWorkouts,
        toggleColorScheme,
        calculateTDEE,
        calculateMacros,
        setCustomMacros,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
