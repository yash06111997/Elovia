import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import type { WorkoutSession } from "@/context/WorkoutContext";
jest.mock("@/utils/exerciseDatabase", () => ({ findExercise: () => undefined }));
jest.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: { text: "#fff", textSecondary: "#aaa", border: "#333", card: "#111" } }) }));
import { MuscleProgress } from "../components/MuscleProgress";

const session = (id: string, date: string, weight: number, reps: number): WorkoutSession => ({
  id, date, completed: true, workoutDayId: "upper", workoutDayName: "Upper body", durationMins: 30,
  exerciseLogs: [{ exerciseId: "bench", exerciseName: "Bench press", primaryMuscle: "Pectorals", date,
    sets: [{ setNumber: 1, weightKg: weight, reps, completed: true }, { setNumber: 2, weightKg: 20, reps: 10, completed: true, setType: "warmup" }] }],
});

describe("muscle chart interaction", () => {
  it("compares the previous muscle session and exposes exercise sets/reps/volume", async () => {
    const screen = await render(<MuscleProgress sessions={[session("1", "2026-09-01", 50, 8), session("2", "2026-09-03", 60, 10)]} />);
    expect(screen.getByText("600 kg")).toBeTruthy();
    expect(screen.getByText("Previous session (2026-09-01): 400 kg. Change: +200 kg.")).toBeTruthy();
    expect(screen.getByText("1 sets · 10 reps · 600 kg volume")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reps" }));
    expect(screen.getByText("10 reps")).toBeTruthy();
    expect(screen.getByText("Previous session (2026-09-01): 8 reps. Change: +2 reps.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Chest, 2026-09-01, 8 reps, 1 sets, 8 reps" }));
    expect(screen.getByText("First recorded session for this muscle.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("No working sets logged for Back yet. Finish a workout to start this chart.")).toBeTruthy();
  });
});
