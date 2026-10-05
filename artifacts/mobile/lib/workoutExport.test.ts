import { workoutsToCsv } from "./workoutExport";
test("exports completed offline workouts with units, warm-up labels and safe CSV cells", () => {
  const csv = workoutsToCsv([{ id: "1", date: "2026-10-05", workoutDayId: "free", workoutDayName: "=SUM(1,2)", completed: true, durationMins: 10, exerciseLogs: [{ exerciseId: "press", exerciseName: 'Press, "DB"', date: "2026-10-05", primaryMuscle: "Chest", sets: [{ setNumber: 1, weightKg: 20, reps: 10, completed: true, setType: "warmup" }, { setNumber: 2, weightKg: 20, reps: 10, completed: false }] }] }]);
  expect(csv).toContain('"\'=SUM(1,2)"');
  expect(csv).toContain('"Press, ""DB"""');
  expect(csv).toContain('"warmup","20","10","200"');
  expect(csv.split("\r\n")).toHaveLength(2);
});
