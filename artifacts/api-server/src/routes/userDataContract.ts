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

export type UserDataField = (typeof USER_DATA_FIELDS)[number];

const synchronizedFields = Object.fromEntries(
  USER_DATA_FIELDS.map((field) => [field, z.unknown().optional()]),
) as Record<UserDataField, z.ZodOptional<z.ZodUnknown>>;

const userDataWriteSchema = z
  .object({
    baseRevision: z.number().int().nonnegative().nullable(),
    ...synchronizedFields,
  })
  .strict()
  .superRefine((value, context) => {
    let hasSynchronizedField = false;

    for (const field of USER_DATA_FIELDS) {
      if (!Object.hasOwn(value, field)) {
        continue;
      }

      hasSynchronizedField = true;
      if (value[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Synchronized fields cannot be undefined",
          path: [field],
        });
      }
    }

    if (!hasSynchronizedField) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one synchronized field is required",
      });
    }
  });

export type UserDataWrite = z.infer<typeof userDataWriteSchema>;

export function parseUserDataWrite(input: unknown): UserDataWrite {
  const ownInput =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input))
      : input;

  return userDataWriteSchema.parse(ownInput);
}

export function buildUserDataPatch(
  input: UserDataWrite,
): Partial<Record<UserDataField, unknown>> {
  return Object.fromEntries(
    USER_DATA_FIELDS.filter((field) => Object.hasOwn(input, field)).map(
      (field) => [field, input[field]],
    ),
  ) as Partial<Record<UserDataField, unknown>>;
}

export function revisionMatches(
  current: number | null,
  base: number | null,
): boolean {
  return current === base;
}
