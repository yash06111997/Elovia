import {
  calculateCaloriesFromMacros,
  normalizeCustomMacroTargets,
  normalizeMacroGrams,
} from "./macros";

describe("macro calorie invariants", () => {
  it("derives calories from protein, carbohydrates, and fat", () => {
    expect(calculateCaloriesFromMacros({ protein: 1, carbs: 1, fats: 1 })).toBe(
      17,
    );
    expect(
      calculateCaloriesFromMacros({ protein: 150, carbs: 200, fats: 70 }),
    ).toBe(2030);
  });

  it("normalizes decimal, negative, and invalid gram values", () => {
    expect(normalizeMacroGrams("12.55")).toBe(12.6);
    expect(normalizeMacroGrams("-2")).toBe(0);
    expect(normalizeMacroGrams("not-a-number")).toBe(0);
  });

  it("repairs a stale persisted calorie total from the gram targets", () => {
    expect(
      normalizeCustomMacroTargets({
        enabled: true,
        calories: 2_000,
        protein: 1,
        carbs: 1,
        fats: 1,
      }),
    ).toEqual({
      enabled: true,
      calories: 17,
      protein: 1,
      carbs: 1,
      fats: 1,
    });
  });

  it("rejects malformed persisted custom macro targets", () => {
    expect(normalizeCustomMacroTargets(null)).toBeNull();
    expect(normalizeCustomMacroTargets({ enabled: false })).toBeNull();
    expect(
      normalizeCustomMacroTargets({
        enabled: true,
        protein: "not-a-number",
        carbs: 1,
        fats: 1,
      }),
    ).toEqual({
      enabled: true,
      calories: 13,
      protein: 0,
      carbs: 1,
      fats: 1,
    });
  });
});
