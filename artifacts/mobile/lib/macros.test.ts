import { calculateCaloriesFromMacros, normalizeMacroGrams } from "./macros";

describe("macro calorie invariants", () => {
  it("derives calories from protein, carbohydrates, and fat", () => {
    expect(calculateCaloriesFromMacros({ protein: 1, carbs: 1, fats: 1 })).toBe(17);
    expect(calculateCaloriesFromMacros({ protein: 150, carbs: 200, fats: 70 })).toBe(2030);
  });

  it("normalizes decimal, negative, and invalid gram values", () => {
    expect(normalizeMacroGrams("12.55")).toBe(12.6);
    expect(normalizeMacroGrams("-2")).toBe(0);
    expect(normalizeMacroGrams("not-a-number")).toBe(0);
  });
});
