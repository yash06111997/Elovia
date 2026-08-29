import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getFirebaseAuth } from "@/lib/firebase";
import { onDataRestored } from "@/lib/syncEvents";
import { toLocalDateKey } from "@/lib/health";

/**
 * Hydration, supplement adherence, and streaks.
 *
 * Hydration and adherence logs live locally (they are high-frequency, tiny,
 * and useless offline if they needed the network). The supplement DEFINITIONS
 * live server-side so they survive a device change.
 */

export interface WaterEntry {
  id: string;
  /** Local YYYY-MM-DD. */
  date: string;
  ml: number;
  at: string;
}

export interface SupplementDefinition {
  id: string;
  name: string;
  kind: "supplement" | "medication";
  dosage: string | null;
  unit: string | null;
  frequency: string;
  times: string[] | null;
  withFood: boolean;
  notes: string | null;
  active: boolean;
  analysis: unknown;
}

export interface SupplementLog {
  id: string;
  supplementId: string;
  date: string;
  at: string;
  /** The scheduled slot this satisfies, e.g. "08:00". */
  slot: string | null;
}

interface WellnessState {
  water: WaterEntry[];
  supplementLogs: SupplementLog[];
  /** Days on which the user logged anything at all. */
  activeDays: string[];
}

const DEFAULT_STATE: WellnessState = { water: [], supplementLogs: [], activeDays: [] };

const STORAGE_KEY = "@elovia_wellness";

/** Common quick-add sizes, in millilitres. */
export const WATER_PRESETS = [
  { label: "Glass", ml: 250, icon: "cafe-outline" },
  { label: "Bottle", ml: 500, icon: "water-outline" },
  { label: "Large", ml: 750, icon: "flask-outline" },
  { label: "Litre", ml: 1000, icon: "beaker-outline" },
] as const;

interface WellnessContextValue {
  todayWaterMl: number;
  waterGoalMl: number;
  waterProgress: number;
  todayEntries: WaterEntry[];
  weeklyWater: { date: string; ml: number }[];
  addWater: (ml: number) => void;
  removeWaterEntry: (id: string) => void;
  setWaterGoal: (litres: number) => void;

  supplements: SupplementDefinition[];
  supplementsLoading: boolean;
  refreshSupplements: () => Promise<void>;
  logSupplementTaken: (supplementId: string, slot?: string) => void;
  isSupplementTaken: (supplementId: string, slot?: string) => boolean;
  todayAdherence: { taken: number; due: number };

  currentStreak: number;
  longestStreak: number;
  markActiveToday: () => void;

  isLoaded: boolean;
}

const WellnessContext = createContext<WellnessContextValue | null>(null);

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

async function authHeader(): Promise<Record<string, string> | null> {
  try {
    const auth = await getFirebaseAuth();
    const token = await auth?.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : null;
  } catch {
    return null;
  }
}

/**
 * Longest run of consecutive days ending today or yesterday.
 *
 * Ending "today OR yesterday" is deliberate: at 9am you have not necessarily
 * logged anything yet, and showing a streak of 0 because the day is young is
 * demoralising and wrong. The streak only breaks once a full day is missed.
 */
function computeStreaks(activeDays: string[]): { current: number; longest: number } {
  if (activeDays.length === 0) return { current: 0, longest: 0 };

  const unique = [...new Set(activeDays)].sort();
  const asDate = (key: string) => new Date(`${key}T00:00:00`);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const gap =
      (asDate(unique[i]).getTime() - asDate(unique[i - 1]).getTime()) / 86_400_000;
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = toLocalDateKey(new Date());
  const yesterday = toLocalDateKey(new Date(Date.now() - 86_400_000));
  const last = unique[unique.length - 1];

  if (last !== today && last !== yesterday) return { current: 0, longest };

  let current = 1;
  for (let i = unique.length - 1; i > 0; i--) {
    const gap =
      (asDate(unique[i]).getTime() - asDate(unique[i - 1]).getTime()) / 86_400_000;
    if (gap !== 1) break;
    current++;
  }

  return { current, longest: Math.max(longest, current) };
}

export function WellnessProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WellnessState>(DEFAULT_STATE);
  const [waterGoalMl, setWaterGoalMlState] = useState(2500);
  const [supplements, setSupplements] = useState<SupplementDefinition[]>([]);
  const [supplementsLoading, setSupplementsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const persist = useCallback((next: WellnessState) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [raw, goal] = await AsyncStorage.multiGet([STORAGE_KEY, "@elovia_water_goal"]);

      if (raw[1]) {
        const parsed = JSON.parse(raw[1]);
        // Keep 60 days: enough for streaks and the weekly chart without letting
        // the blob grow unbounded on a long-lived install.
        const cutoff = toLocalDateKey(new Date(Date.now() - 60 * 86_400_000));
        setState({
          water: (parsed.water ?? []).filter((w: WaterEntry) => w.date >= cutoff),
          supplementLogs: (parsed.supplementLogs ?? []).filter(
            (l: SupplementLog) => l.date >= cutoff,
          ),
          activeDays: (parsed.activeDays ?? []).filter((d: string) => d >= cutoff),
        });
      }

      if (goal[1]) {
        const parsedGoal = Number(goal[1]);
        if (Number.isFinite(parsedGoal) && parsedGoal > 0) setWaterGoalMlState(parsedGoal);
      }
    } catch {
      // Corrupt cache falls back to defaults.
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => onDataRestored(() => void load()), [load]);

  const today = toLocalDateKey(new Date());

  const todayEntries = useMemo(
    () => state.water.filter((w) => w.date === today),
    [state.water, today],
  );

  const todayWaterMl = useMemo(
    () => todayEntries.reduce((sum, w) => sum + w.ml, 0),
    [todayEntries],
  );

  const weeklyWater = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      buckets.set(toLocalDateKey(new Date(Date.now() - i * 86_400_000)), 0);
    }
    for (const entry of state.water) {
      if (buckets.has(entry.date)) {
        buckets.set(entry.date, (buckets.get(entry.date) ?? 0) + entry.ml);
      }
    }
    return [...buckets.entries()].map(([date, ml]) => ({ date, ml }));
  }, [state.water]);

  const markActiveToday = useCallback(() => {
    setState((prev) => {
      if (prev.activeDays.includes(today)) return prev;
      const next = { ...prev, activeDays: [...prev.activeDays, today] };
      persist(next);
      return next;
    });
  }, [today, persist]);

  const addWater = useCallback(
    (ml: number) => {
      if (!Number.isFinite(ml) || ml <= 0) return;
      const entry: WaterEntry = {
        id: `${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        date: today,
        ml: Math.min(3000, Math.round(ml)),
        at: new Date().toISOString(),
      };

      setState((prev) => {
        const next = {
          ...prev,
          water: [...prev.water, entry],
          activeDays: prev.activeDays.includes(today)
            ? prev.activeDays
            : [...prev.activeDays, today],
        };
        persist(next);
        return next;
      });
    },
    [today, persist],
  );

  const removeWaterEntry = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { ...prev, water: prev.water.filter((w) => w.id !== id) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setWaterGoal = useCallback((litres: number) => {
    const ml = Math.round(Math.min(8, Math.max(0.5, litres)) * 1000);
    setWaterGoalMlState(ml);
    AsyncStorage.setItem("@elovia_water_goal", String(ml)).catch(() => {});
  }, []);

  const refreshSupplements = useCallback(async () => {
    setSupplementsLoading(true);
    try {
      const headers = await authHeader();
      if (!headers) return;

      const response = await fetch(`${getBaseUrl()}/api/supplements`, { headers });
      if (!response.ok) return;

      const body = (await response.json()) as { supplements: SupplementDefinition[] };
      setSupplements(body.supplements ?? []);
    } catch {
      // Offline: keep whatever is already in memory.
    } finally {
      setSupplementsLoading(false);
    }
  }, []);

  const logSupplementTaken = useCallback(
    (supplementId: string, slot?: string) => {
      const log: SupplementLog = {
        id: `${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        supplementId,
        date: today,
        at: new Date().toISOString(),
        slot: slot ?? null,
      };

      setState((prev) => {
        // Idempotent per slot per day, so double-tapping cannot inflate
        // adherence above 100%.
        const already = prev.supplementLogs.some(
          (l) =>
            l.supplementId === supplementId &&
            l.date === today &&
            (l.slot ?? null) === (slot ?? null),
        );
        if (already) return prev;

        const next = {
          ...prev,
          supplementLogs: [...prev.supplementLogs, log],
          activeDays: prev.activeDays.includes(today)
            ? prev.activeDays
            : [...prev.activeDays, today],
        };
        persist(next);
        return next;
      });
    },
    [today, persist],
  );

  const isSupplementTaken = useCallback(
    (supplementId: string, slot?: string) =>
      state.supplementLogs.some(
        (l) =>
          l.supplementId === supplementId &&
          l.date === today &&
          (slot === undefined || (l.slot ?? null) === slot),
      ),
    [state.supplementLogs, today],
  );

  const todayAdherence = useMemo(() => {
    const active = supplements.filter((s) => s.active && s.frequency !== "as_needed");
    let due = 0;
    let taken = 0;

    for (const supplement of active) {
      const slots = supplement.times?.length ? supplement.times : [null];
      for (const slot of slots) {
        due += 1;
        if (
          state.supplementLogs.some(
            (l) =>
              l.supplementId === supplement.id &&
              l.date === today &&
              (l.slot ?? null) === slot,
          )
        ) {
          taken += 1;
        }
      }
    }

    return { taken, due };
  }, [supplements, state.supplementLogs, today]);

  const { current: currentStreak, longest: longestStreak } = useMemo(
    () => computeStreaks(state.activeDays),
    [state.activeDays],
  );

  const value: WellnessContextValue = {
    todayWaterMl,
    waterGoalMl,
    waterProgress: waterGoalMl > 0 ? Math.min(1, todayWaterMl / waterGoalMl) : 0,
    todayEntries,
    weeklyWater,
    addWater,
    removeWaterEntry,
    setWaterGoal,
    supplements,
    supplementsLoading,
    refreshSupplements,
    logSupplementTaken,
    isSupplementTaken,
    todayAdherence,
    currentStreak,
    longestStreak,
    markActiveToday,
    isLoaded,
  };

  return <WellnessContext.Provider value={value}>{children}</WellnessContext.Provider>;
}

export function useWellness(): WellnessContextValue {
  const ctx = useContext(WellnessContext);
  if (!ctx) throw new Error("useWellness must be used within WellnessProvider");
  return ctx;
}
