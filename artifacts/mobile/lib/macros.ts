export interface MacroGramValues {
  protein: number;
  carbs: number;
  fats: number;
}

/**
 * Macro targets are user-entered decimal gram values. Keep one decimal place
 * for display/storage, reject negative and non-finite input, and let an empty
 * field mean zero instead of silently restoring an unrelated previous value.
 */
export function normalizeMacroGrams(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 10) / 10;
}

/** Protein and carbohydrate provide 4 kcal/g; fat provides 9 kcal/g. */
export function calculateCaloriesFromMacros(values: MacroGramValues): number {
  const protein = normalizeMacroGrams(values.protein);
  const carbs = normalizeMacroGrams(values.carbs);
  const fats = normalizeMacroGrams(values.fats);
  return Math.round(protein * 4 + carbs * 4 + fats * 9);
}

export function parseMacroForm(values: {
  protein: string;
  carbs: string;
  fats: string;
}): MacroGramValues {
  return {
    protein: normalizeMacroGrams(values.protein),
    carbs: normalizeMacroGrams(values.carbs),
    fats: normalizeMacroGrams(values.fats),
  };
}
