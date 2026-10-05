import { elapsedWorkoutSeconds } from "./workoutClock";
test("elapsed workout time survives suspended JS timers and legacy drafts", () => {
  const start = 1_791_200_000_000;
  expect(elapsedWorkoutSeconds({ id: "session", startedAt: start }, start + 125_000)).toBe(125);
  expect(elapsedWorkoutSeconds({ id: String(start) }, start + 125_000)).toBe(125);
  expect(elapsedWorkoutSeconds({ id: "old" }, start, 60)).toBe(60);
  expect(elapsedWorkoutSeconds({ id: "future", startedAt: start + 5000 }, start)).toBe(0);
});
