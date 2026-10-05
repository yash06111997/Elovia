import { canUseEquipment, generateWorkoutPlan } from "./aiEngine";
import { findExercise } from "./exerciseDatabase";
import type { UserProfile } from "@/context/AppContext";
test("planner requires actual equipment and does not treat kettlebells or racks as cable machines", () => {
  expect(canUseEquipment(findExercise("chest_db_press")!, ["dumbbells"])).toBe(false);
  expect(canUseEquipment(findExercise("chest_db_press")!, ["dumbbells", "bench"])).toBe(true);
  expect(canUseEquipment(findExercise("chest_cable_fly")!, ["squat_rack"])).toBe(false);
  expect(canUseEquipment(findExercise("chest_floor_press")!, ["kettlebells"])).toBe(false);
});
test("one-day training preference is not silently expanded to two days", () => {
  const plan = generateWorkoutPlan({ workoutDaysPerWeek: 1, preferredWorkoutDays: ["Sunday"], equipment: ["no_equipment"], fitnessLevel: "beginner", goal: "general_fitness" } as UserProfile);
  expect(plan.days).toHaveLength(1);
  expect(plan.days[0].dayName).toContain("Sunday");
  expect(plan.days[0].exercises.every(ex => canUseEquipment(findExercise(ex.id)!, ["no_equipment"]))).toBe(true);
});
