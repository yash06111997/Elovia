import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform, Alert } from "react-native";
import * as Location from "expo-location";

export interface StepData {
  date: string;
  steps: number;
}

export interface RunSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  distanceKm: number;
  durationMins: number;
  avgPaceMinKm: number;
  route: { latitude: number; longitude: number }[];
  caloriesBurned: number;
}

export interface HealthSyncStatus {
  appleHealth: boolean;
  googleFit: boolean;
  stepsEnabled: boolean;
  locationEnabled: boolean;
}

export interface HealthData {
  todaySteps: number;
  weeklySteps: StepData[];
  runSessions: RunSession[];
  syncStatus: HealthSyncStatus;
  lastSynced: string | null;
}

interface HealthContextType {
  healthData: HealthData;
  isTracking: boolean;
  updateSteps: (steps: number) => void;
  startRunTracking: () => Promise<void> | void;
  stopRunTracking: () => RunSession | null;
  addRunSession: (session: Omit<RunSession, "id">) => void;
  toggleSync: (source: keyof HealthSyncStatus) => void;
  syncHealthData: () => Promise<void>;
  currentRun: {
    startTime: string;
    route: { latitude: number; longitude: number }[];
    distanceKm: number;
  } | null;
  addRoutePoint: (lat: number, lng: number) => void;
}

const defaultHealthData: HealthData = {
  todaySteps: 0,
  weeklySteps: [],
  runSessions: [],
  syncStatus: {
    appleHealth: false,
    googleFit: false,
    stepsEnabled: false,
    locationEnabled: false,
  },
  lastSynced: null,
};

const HealthContext = createContext<HealthContextType | null>(null);

function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const [healthData, setHealthData] = useState<HealthData>(defaultHealthData);
  const [isTracking, setIsTracking] = useState(false);
  const [currentRun, setCurrentRun] = useState<{
    startTime: string;
    route: { latitude: number; longitude: number }[];
    distanceKm: number;
  } | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const stored = await AsyncStorage.getItem("@fitai_health_data");
      if (stored) setHealthData(JSON.parse(stored));
    } catch (e) {}
  };

  const saveData = useCallback((data: HealthData) => {
    setHealthData(data);
    AsyncStorage.setItem("@fitai_health_data", JSON.stringify(data));
  }, []);

  const updateSteps = useCallback((steps: number) => {
    setHealthData((prev) => {
      const today = new Date().toISOString().split("T")[0];
      const weeklySteps = [...prev.weeklySteps];
      const todayIdx = weeklySteps.findIndex((s) => s.date === today);
      if (todayIdx >= 0) {
        weeklySteps[todayIdx] = { date: today, steps };
      } else {
        weeklySteps.push({ date: today, steps });
        if (weeklySteps.length > 7) weeklySteps.shift();
      }
      const updated = { ...prev, todaySteps: steps, weeklySteps };
      AsyncStorage.setItem("@fitai_health_data", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const startRunTracking = useCallback(async () => {
    if (Platform.OS === "web") {
      setIsTracking(true);
      setCurrentRun({ startTime: new Date().toISOString(), route: [], distanceKm: 0 });
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Location permission is needed for GPS run tracking.");
        return;
      }
      setIsTracking(true);
      setCurrentRun({ startTime: new Date().toISOString(), route: [], distanceKm: 0 });
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (location) => {
          const { latitude, longitude } = location.coords;
          setCurrentRun((prev) => {
            if (!prev) return prev;
            const newRoute = [...prev.route, { latitude, longitude }];
            let dist = prev.distanceKm;
            if (prev.route.length > 0) {
              const last = prev.route[prev.route.length - 1];
              dist += haversineDistance(last.latitude, last.longitude, latitude, longitude);
            }
            return { ...prev, route: newRoute, distanceKm: dist };
          });
        }
      );
      locationSubRef.current = sub;
    } catch (e: any) {
      Alert.alert("GPS Error", e.message || "Could not start location tracking.");
    }
  }, []);

  const addRoutePoint = useCallback((lat: number, lng: number) => {
    setCurrentRun((prev) => {
      if (!prev) return prev;
      const newRoute = [...prev.route, { latitude: lat, longitude: lng }];
      let dist = prev.distanceKm;
      if (prev.route.length > 0) {
        const last = prev.route[prev.route.length - 1];
        dist += haversineDistance(last.latitude, last.longitude, lat, lng);
      }
      return { ...prev, route: newRoute, distanceKm: dist };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, []);

  const stopRunTracking = useCallback((): RunSession | null => {
    if (!currentRun) return null;
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    setIsTracking(false);
    const endTime = new Date().toISOString();
    const startMs = new Date(currentRun.startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const durationMins = Math.round((endMs - startMs) / 60000);
    const avgPace = currentRun.distanceKm > 0 ? durationMins / currentRun.distanceKm : 0;
    const caloriesBurned = Math.round(durationMins * 8);

    const session: RunSession = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString().split("T")[0],
      startTime: currentRun.startTime,
      endTime,
      distanceKm: Math.round(currentRun.distanceKm * 100) / 100,
      durationMins,
      avgPaceMinKm: Math.round(avgPace * 100) / 100,
      route: currentRun.route,
      caloriesBurned,
    };

    setHealthData((prev) => {
      const updated = {
        ...prev,
        runSessions: [...prev.runSessions, session].slice(-50),
      };
      AsyncStorage.setItem("@fitai_health_data", JSON.stringify(updated));
      return updated;
    });

    setCurrentRun(null);
    return session;
  }, [currentRun]);

  const addRunSession = useCallback((sessionData: Omit<RunSession, "id">) => {
    const session: RunSession = {
      ...sessionData,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    };
    setHealthData((prev) => {
      const updated = {
        ...prev,
        runSessions: [...prev.runSessions, session].slice(-50),
      };
      AsyncStorage.setItem("@fitai_health_data", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const toggleSync = useCallback((source: keyof HealthSyncStatus) => {
    setHealthData((prev) => {
      const updated = {
        ...prev,
        syncStatus: {
          ...prev.syncStatus,
          [source]: !prev.syncStatus[source],
        },
      };
      AsyncStorage.setItem("@fitai_health_data", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const syncHealthData = useCallback(async () => {
    try {
      if (Platform.OS === "web") {
        Alert.alert("Not Available", "Health data sync requires a native device (iPhone or Android).");
        return;
      }
      setHealthData((prev) => {
        const updated = { ...prev, lastSynced: new Date().toISOString() };
        AsyncStorage.setItem("@fitai_health_data", JSON.stringify(updated));
        return updated;
      });
    } catch (e: any) {
      Alert.alert("Sync Error", e.message || "Failed to sync health data.");
    }
  }, []);

  return (
    <HealthContext.Provider
      value={{
        healthData,
        isTracking,
        updateSteps,
        startRunTracking,
        stopRunTracking,
        addRunSession,
        toggleSync,
        syncHealthData,
        currentRun,
        addRoutePoint,
      }}
    >
      {children}
    </HealthContext.Provider>
  );
}

export function useHealth() {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("useHealth must be used within HealthProvider");
  return ctx;
}
