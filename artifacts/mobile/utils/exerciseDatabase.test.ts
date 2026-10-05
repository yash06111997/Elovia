import { allExercises, browseExercises } from "./exerciseDatabase";

test("expanded catalogue preserves stable IDs and imports both sources", () => {
  expect(allExercises.length).toBeGreaterThan(1000);
  expect(new Set(allExercises.map(e => e.id)).size).toBe(allExercises.length);
  expect(allExercises.some(e => e.id === "chest_bb_press")).toBe(true);
  expect(allExercises.some(e => e.source?.provider === "wger")).toBe(true);
  expect(allExercises.some(e => e.source?.provider === "Free Exercise DB")).toBe(true);
  expect(allExercises.filter(e => e.demo).length).toBeGreaterThanOrEqual(40);
});
test("muscle and equipment filters combine and equipment sorting is deterministic", () => {
  const filtered = browseExercises({ category: "Chest", equipment: "dumbbells", sort: "muscle" });
  expect(filtered.length).toBeGreaterThan(5);
  expect(filtered.every(e => e.category === "Chest" && e.equipment.includes("dumbbells"))).toBe(true);
  const sorted = browseExercises({ query: "curl", sort: "equipment" });
  const keys = sorted.map(e => e.equipment.join(", "));
  expect(keys).toEqual([...keys].sort((a,b) => a.localeCompare(b)));
});
test("my-equipment filter requires all listed equipment, including a bench", () => {
  const list = browseExercises({ ownedEquipment: ["dumbbells"] });
  expect(list.some(e => e.id === "chest_db_press")).toBe(false);
  expect(list.some(e => e.id === "chest_floor_press")).toBe(true);
  const bodyweight = browseExercises({ ownedEquipment: ["no_equipment"] });
  expect(bodyweight.every(e => e.equipment.every(eq => eq === "none"))).toBe(true);
});
