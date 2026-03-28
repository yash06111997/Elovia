import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
  videoUrl?: string;
}

export interface WorkoutDay {
  id: string;
  dayName: string;
  muscleGroups: string[];
  exercises: Exercise[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  goal: string;
  days: WorkoutDay[];
  generatedAt: string;
}

export interface CustomWorkoutPlan {
  id: string;
  name: string;
  days: WorkoutDay[];
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseLog {
  exerciseId: string;
  exerciseName: string;
  sets: SetLog[];
  date: string;
  notes?: string;
}

export interface SetLog {
  setNumber: number;
  reps: number;
  weightKg: number;
  completed: boolean;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  maxWeightKg: number;
  maxReps: number;
  bestVolume: number;
  lastPerformed: string;
}

export interface WorkoutSession {
  id: string;
  date: string;
  workoutDayId: string;
  workoutDayName: string;
  exerciseLogs: ExerciseLog[];
  durationMins: number;
  completed: boolean;
}

export type ActivePlanType = "ai" | "custom";

interface WorkoutContextType {
  plan: WorkoutPlan | null;
  sessions: WorkoutSession[];
  personalRecords: PersonalRecord[];
  activeSession: WorkoutSession | null;
  customPlans: CustomWorkoutPlan[];
  activePlanType: ActivePlanType;
  activeCustomPlanId: string | null;
  setPlan: (plan: WorkoutPlan) => void;
  startSession: (day: WorkoutDay) => void;
  logSet: (exerciseId: string, exerciseName: string, set: SetLog) => void;
  completeSession: (durationMins: number) => void;
  getExerciseHistory: (exerciseId: string) => SetLog[];
  getPersonalRecord: (exerciseId: string) => PersonalRecord | null;
  todaySession: WorkoutSession | null;
  getWeeklyCompletion: () => number;
  addCustomPlan: (plan: Omit<CustomWorkoutPlan, "id" | "createdAt" | "updatedAt">) => CustomWorkoutPlan;
  updateCustomPlan: (plan: CustomWorkoutPlan) => void;
  deleteCustomPlan: (id: string) => void;
  setActivePlan: (type: ActivePlanType, customPlanId?: string) => void;
  getActivePlanDays: () => WorkoutDay[];
}

const WorkoutContext = createContext<WorkoutContextType | null>(null);

export function WorkoutProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlanState] = useState<WorkoutPlan | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(null);
  const [customPlans, setCustomPlans] = useState<CustomWorkoutPlan[]>([]);
  const [activePlanType, setActivePlanType] = useState<ActivePlanType>("ai");
  const [activeCustomPlanId, setActiveCustomPlanId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const [p, s, pr, active, cp, apt, acpid] = await Promise.all([
        AsyncStorage.getItem("@fitai_plan"),
        AsyncStorage.getItem("@fitai_sessions"),
        AsyncStorage.getItem("@fitai_prs"),
        AsyncStorage.getItem("@fitai_active_session"),
        AsyncStorage.getItem("@fitai_custom_plans"),
        AsyncStorage.getItem("@fitai_active_plan_type"),
        AsyncStorage.getItem("@fitai_active_custom_plan_id"),
      ]);
      if (p) setPlanState(JSON.parse(p));
      if (s) setSessions(JSON.parse(s));
      if (pr) setPersonalRecords(JSON.parse(pr));
      if (active) setActiveSession(JSON.parse(active));
      if (cp) setCustomPlans(JSON.parse(cp));
      if (apt) setActivePlanType(JSON.parse(apt));
      if (acpid) setActiveCustomPlanId(JSON.parse(acpid));
    } catch (e) {}
  };

  const setPlan = useCallback((p: WorkoutPlan) => {
    setPlanState(p);
    AsyncStorage.setItem("@fitai_plan", JSON.stringify(p));
  }, []);

  const startSession = useCallback((day: WorkoutDay) => {
    const session: WorkoutSession = {
      id: Date.now().toString(),
      date: new Date().toISOString().split("T")[0],
      workoutDayId: day.id,
      workoutDayName: day.dayName,
      exerciseLogs: [],
      durationMins: 0,
      completed: false,
    };
    setActiveSession(session);
    AsyncStorage.setItem("@fitai_active_session", JSON.stringify(session));
  }, []);

  const logSet = useCallback(
    (exerciseId: string, exerciseName: string, set: SetLog) => {
      setActiveSession((prev) => {
        if (!prev) return prev;
        const existingLog = prev.exerciseLogs.find(
          (l) => l.exerciseId === exerciseId
        );
        let exerciseLogs: ExerciseLog[];
        if (existingLog) {
          exerciseLogs = prev.exerciseLogs.map((l) =>
            l.exerciseId === exerciseId
              ? { ...l, sets: [...l.sets.filter((s) => s.setNumber !== set.setNumber), set] }
              : l
          );
        } else {
          exerciseLogs = [
            ...prev.exerciseLogs,
            {
              exerciseId,
              exerciseName,
              sets: [set],
              date: prev.date,
            },
          ];
        }
        const updated = { ...prev, exerciseLogs };
        AsyncStorage.setItem("@fitai_active_session", JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const completeSession = useCallback(
    (durationMins: number) => {
      if (!activeSession) return;
      const completed = { ...activeSession, completed: true, durationMins };

      const newSessions = [...sessions, completed].slice(-200);
      setSessions(newSessions);
      AsyncStorage.setItem("@fitai_sessions", JSON.stringify(newSessions));

      const newPRs = [...personalRecords];
      completed.exerciseLogs.forEach((log) => {
        log.sets.filter((s) => s.completed).forEach((s) => {
          const existing = newPRs.find((pr) => pr.exerciseId === log.exerciseId);
          const volume = s.reps * s.weightKg;
          if (!existing) {
            newPRs.push({
              exerciseId: log.exerciseId,
              exerciseName: log.exerciseName,
              maxWeightKg: s.weightKg,
              maxReps: s.reps,
              bestVolume: volume,
              lastPerformed: completed.date,
            });
          } else {
            const idx = newPRs.findIndex((pr) => pr.exerciseId === log.exerciseId);
            newPRs[idx] = {
              ...existing,
              maxWeightKg: Math.max(existing.maxWeightKg, s.weightKg),
              maxReps: Math.max(existing.maxReps, s.reps),
              bestVolume: Math.max(existing.bestVolume, volume),
              lastPerformed: completed.date,
            };
          }
        });
      });
      setPersonalRecords(newPRs);
      AsyncStorage.setItem("@fitai_prs", JSON.stringify(newPRs));

      setActiveSession(null);
      AsyncStorage.removeItem("@fitai_active_session");
    },
    [activeSession, sessions, personalRecords]
  );

  const getExerciseHistory = useCallback(
    (exerciseId: string): SetLog[] => {
      const logs: SetLog[] = [];
      sessions.forEach((s) => {
        s.exerciseLogs.forEach((l) => {
          if (l.exerciseId === exerciseId) {
            logs.push(...l.sets.filter((set) => set.completed));
          }
        });
      });
      return logs;
    },
    [sessions]
  );

  const getPersonalRecord = useCallback(
    (exerciseId: string): PersonalRecord | null => {
      return personalRecords.find((pr) => pr.exerciseId === exerciseId) ?? null;
    },
    [personalRecords]
  );

  const todaySession = sessions.find(
    (s) => s.date === new Date().toISOString().split("T")[0]
  ) ?? null;

  const getWeeklyCompletion = useCallback((): number => {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekSessions = sessions.filter((s) => {
      const d = new Date(s.date);
      return d >= weekStart && d <= today && s.completed;
    });
    const activePlan = activePlanType === "custom"
      ? customPlans.find((cp) => cp.id === activeCustomPlanId)
      : plan;
    const target = activePlan ? activePlan.days.length : 3;
    return Math.min(100, Math.round((weekSessions.length / target) * 100));
  }, [sessions, plan, customPlans, activePlanType, activeCustomPlanId]);

  const addCustomPlan = useCallback(
    (planData: Omit<CustomWorkoutPlan, "id" | "createdAt" | "updatedAt">): CustomWorkoutPlan => {
      const newPlan: CustomWorkoutPlan = {
        ...planData,
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setCustomPlans((prev) => {
        const updated = [...prev, newPlan];
        AsyncStorage.setItem("@fitai_custom_plans", JSON.stringify(updated));
        return updated;
      });
      return newPlan;
    },
    []
  );

  const updateCustomPlan = useCallback((updatedPlan: CustomWorkoutPlan) => {
    setCustomPlans((prev) => {
      const updated = prev.map((p) =>
        p.id === updatedPlan.id
          ? { ...updatedPlan, updatedAt: new Date().toISOString() }
          : p
      );
      AsyncStorage.setItem("@fitai_custom_plans", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteCustomPlan = useCallback((id: string) => {
    setCustomPlans((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      AsyncStorage.setItem("@fitai_custom_plans", JSON.stringify(updated));
      return updated;
    });
    setActiveCustomPlanId((prev) => {
      if (prev === id) {
        AsyncStorage.setItem("@fitai_active_plan_type", JSON.stringify("ai"));
        AsyncStorage.removeItem("@fitai_active_custom_plan_id");
        setActivePlanType("ai");
        return null;
      }
      return prev;
    });
  }, []);

  const setActivePlan = useCallback((type: ActivePlanType, customPlanId?: string) => {
    setActivePlanType(type);
    AsyncStorage.setItem("@fitai_active_plan_type", JSON.stringify(type));
    if (type === "custom" && customPlanId) {
      setActiveCustomPlanId(customPlanId);
      AsyncStorage.setItem("@fitai_active_custom_plan_id", JSON.stringify(customPlanId));
    } else {
      setActiveCustomPlanId(null);
      AsyncStorage.removeItem("@fitai_active_custom_plan_id");
    }
  }, []);

  const getActivePlanDays = useCallback((): WorkoutDay[] => {
    if (activePlanType === "custom" && activeCustomPlanId) {
      const cp = customPlans.find((p) => p.id === activeCustomPlanId);
      return cp ? cp.days : [];
    }
    return plan ? plan.days : [];
  }, [activePlanType, activeCustomPlanId, customPlans, plan]);

  return (
    <WorkoutContext.Provider
      value={{
        plan,
        sessions,
        personalRecords,
        activeSession,
        customPlans,
        activePlanType,
        activeCustomPlanId,
        setPlan,
        startSession,
        logSet,
        completeSession,
        getExerciseHistory,
        getPersonalRecord,
        todaySession,
        getWeeklyCompletion,
        addCustomPlan,
        updateCustomPlan,
        deleteCustomPlan,
        setActivePlan,
        getActivePlanDays,
      }}
    >
      {children}
    </WorkoutContext.Provider>
  );
}

export function useWorkout() {
  const ctx = useContext(WorkoutContext);
  if (!ctx) throw new Error("useWorkout must be used within WorkoutProvider");
  return ctx;
}
