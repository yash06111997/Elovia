import { detectRecords, recordBaseline, muscleHistory, summarizeSets } from "./workoutAnalytics";
import type { SetLog, WorkoutSession } from "@/context/WorkoutContext";

const set = (weightKg: number, reps: number, extra: Partial<SetLog> = {}): SetLog => ({ weightKg, reps, setNumber: 1, completed: true, ...extra });
const session = (id: string, sets: SetLog[], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({ id, date: "2026-10-05", workoutDayId: "push", workoutDayName: "Push", durationMins: 20, completed: true, exerciseLogs: [{ exerciseId: "chest_bb_press", exerciseName: "Barbell Bench Press", sets, date: "2026-10-05" }], ...extra });

test("only completed working sets contribute; bodyweight reps still count", () => {
  const totals = summarizeSets([set(50, 10), set(60, 10, { setType: "warmup" }), set(0, 15), set(80, 5, { completed: false }), set(-10, 5), set(40, NaN)]);
  expect(totals).toMatchObject({ sets: 2, reps: 25, volume: 500, maxWeight: 50, maxReps: 15, setVolume: 500 });
});
test("detects weight, reps, set volume and session totals immediately", () => {
  const baseline = recordBaseline([session("1", [set(50, 8)])]);
  const result = detectRecords(session("2", [set(60, 10), set(60, 10)]), baseline);
  expect(result.achievements.map(r => r.kind)).toEqual(expect.arrayContaining(["weight", "reps", "setVolume", "sets", "totalReps", "totalVolume", "workoutVolume", "workoutSets", "workoutReps"]));
  expect(result.achievements.find(r => r.kind === "totalVolume")).toMatchObject({ value: 1200, previous: 400 });
  expect(detectRecords(session("2", [set(60, 10), set(60, 10)]), result.baseline).achievements).toEqual([]);
  expect(detectRecords(session("2", [set(60, 10)]), result.baseline).achievements).toEqual([]);
});
test("repeated exercise rows count as one exercise, not separate records", () => {
  const value = session("1", [set(40, 10)]);
  value.exerciseLogs.push({ ...value.exerciseLogs[0], sets: [set(40, 10)] });
  const result = detectRecords(value, {});
  expect(result.achievements.filter(r => r.kind === "totalVolume")).toHaveLength(1);
  expect(result.achievements.find(r => r.kind === "totalVolume")?.value).toBe(800);
});
test("muscle charts compare saved sessions and do not double-count secondary muscles", () => {
  const older = session("1", [set(50, 8)], { date: "2026-10-01" });
  const newer = session("2", [set(60, 10), set(60, 10)], { date: "2026-10-05" });
  expect(muscleHistory([newer, older, session("draft", [set(100, 10)], { completed: false })], "Chest").map(s => [s.date, s.volume, s.sets, s.reps])).toEqual([["2026-10-01", 400, 1, 8], ["2026-10-05", 1200, 2, 20]]);
  expect(muscleHistory([newer], "Triceps")).toEqual([]);
  expect(muscleHistory([newer], "Chest")[0].exercises[0]).toMatchObject({ volume: 1200, sets: 2, reps: 20 });
});
test("custom primary muscle tags support history and hamstrings are not biceps", () => {
  const custom = session("1", [set(40, 10)]);
  custom.exerciseLogs[0].primaryMuscle = "Biceps femoris";
  expect(muscleHistory([custom], "Hamstrings")).toHaveLength(1);
  expect(muscleHistory([custom], "Biceps")).toHaveLength(0);
});
