import { z } from "zod";

export const USER_DATA_FIELDS = [
  "appState",
  "workoutPlan",
  "customPlans",
  "activePlanType",
  "activeCustomPlanId",
  "activeSession",
  "sessions",
  "personalRecords",
  "mealPlan",
  "foodLog",
  "customMealPlans",
  "activeMealPlanType",
  "activeCustomMealPlanId",
  "healthData",
  "wellnessData",
  "waterGoal",
  "reminderPrefs",
  "places",
] as const;

const synchronizedFields = Object.fromEntries(
  USER_DATA_FIELDS.map((field) => [field, z.unknown().optional()]),
) as Record<(typeof USER_DATA_FIELDS)[number], z.ZodOptional<z.ZodUnknown>>;

const userDataWriteSchema = z
  .object({
    baseRevision: z.number().int().nonnegative().nullable(),
    ...synchronizedFields,
  })
  .strict()
  .refine(
    (value) => USER_DATA_FIELDS.some((field) => Object.hasOwn(value, field)),
    "At least one synchronized field is required",
  );

export type UserDataWrite = z.infer<typeof userDataWriteSchema>;

export function parseUserDataWrite(input: unknown): UserDataWrite {
  return userDataWriteSchema.parse(input);
}

export function buildUserDataPatch(
  input: UserDataWrite,
): Record<string, unknown> {
  return Object.fromEntries(
    USER_DATA_FIELDS.filter((field) => Object.hasOwn(input, field)).map(
      (field) => [field, input[field]],
    ),
  );
}

export function revisionMatches(
  current: number | null,
  base: number | null,
): boolean {
  return current === base;
}
