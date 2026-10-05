import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { WorkoutSession } from "@/context/WorkoutContext";
import { elapsedWorkoutSeconds } from "@/lib/workoutClock";

export function useWorkoutClock(session: WorkoutSession | null, fallbackSeconds = 0) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!session) { setSeconds(0); return; }
    // Wall-clock time survives background suspension, screen navigation and relaunch.
    const update = () => setSeconds(elapsedWorkoutSeconds(session, Date.now(), fallbackSeconds));
    update();
    const interval = setInterval(update, 1000);
    const foreground = AppState.addEventListener("change", state => { if (state === "active") update(); });
    return () => { clearInterval(interval); foreground.remove(); };
  }, [session?.id, session?.startedAt, fallbackSeconds]);
  return seconds;
}
