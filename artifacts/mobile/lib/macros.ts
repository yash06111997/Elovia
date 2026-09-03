export interface MacroGramValues {
  protein: number;
  carbs: number;
  fats: number;
}

export interface CustomMacroTargets extends MacroGramValues {
  enabled: true;
  calories: number;
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

/**
 * Restore the calorie invariant at every persistence boundary. Older builds
 * stored calories as an independent editable value, so synced/local data can
 * legitimately contain 1g/1g/1g alongside 2,000 kcal. The gram targets are
 * authoritative and calories are always derived with 4/4/9 arithmetic.
 */
export function normalizeCustomMacroTargets(
  value: unknown,
): CustomMacroTargets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.enabled !== true) return null;
  const targets: MacroGramValues = {
    protein: normalizeMacroGrams(
      typeof candidate.protein === "string" ||
        typeof candidate.protein === "number"
        ? candidate.protein
        : 0,
    ),
    carbs: normalizeMacroGrams(
      typeof candidate.carbs === "string" || typeof candidate.carbs === "number"
        ? candidate.carbs
        : 0,
    ),
    fats: normalizeMacroGrams(
      typeof candidate.fats === "string" || typeof candidate.fats === "number"
        ? candidate.fats
        : 0,
    ),
  };
  return {
    enabled: true,
    ...targets,
    calories: calculateCaloriesFromMacros(targets),
  };
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
