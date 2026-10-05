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

export const MAX_SYNC_REVISION = Number.MAX_SAFE_INTEGER;

const varcharField = z.string().nullable().optional();
const objectField = z.record(z.string(), z.unknown()).nullable().optional();
const arrayField = z.array(z.unknown()).nullable().optional();
const positiveNumberField = z
  .number()
  .finite()
  .positive()
  .nullable()
  .optional();

const userDataWriteSchema = z
  .object({
    baseRevision: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_SYNC_REVISION)
      .nullable(),
    appState: objectField,
    workoutPlan: objectField,
    customPlans: arrayField,
    activePlanType: varcharField,
    activeCustomPlanId: varcharField,
    activeSession: objectField,
    sessions: arrayField,
    personalRecords: arrayField,
    mealPlan: objectField,
    foodLog: arrayField,
    customMealPlans: arrayField,
    activeMealPlanType: varcharField,
    activeCustomMealPlanId: varcharField,
    healthData: objectField,
    wellnessData: objectField,
    waterGoal: positiveNumberField,
    reminderPrefs: objectField,
    places: arrayField,
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
export type UserDataPatch = Partial<Omit<UserDataWrite, "baseRevision">>;

export function parseUserDataWrite(input: unknown): UserDataWrite {
  const ownInput =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input))
      : input;

  return userDataWriteSchema.parse(ownInput);
}

export function buildUserDataPatch(input: UserDataWrite): UserDataPatch {
  return {
    ...(Object.hasOwn(input, "appState") && { appState: input.appState }),
    ...(Object.hasOwn(input, "workoutPlan") && {
      workoutPlan: input.workoutPlan,
    }),
    ...(Object.hasOwn(input, "customPlans") && {
      customPlans: input.customPlans,
    }),
    ...(Object.hasOwn(input, "activePlanType") && {
      activePlanType: input.activePlanType,
    }),
    ...(Object.hasOwn(input, "activeCustomPlanId") && {
      activeCustomPlanId: input.activeCustomPlanId,
    }),
    ...(Object.hasOwn(input, "activeSession") && {
      activeSession: input.activeSession,
    }),
    ...(Object.hasOwn(input, "sessions") && { sessions: input.sessions }),
    ...(Object.hasOwn(input, "personalRecords") && {
      personalRecords: input.personalRecords,
    }),
    ...(Object.hasOwn(input, "mealPlan") && { mealPlan: input.mealPlan }),
    ...(Object.hasOwn(input, "foodLog") && { foodLog: input.foodLog }),
    ...(Object.hasOwn(input, "customMealPlans") && {
      customMealPlans: input.customMealPlans,
    }),
    ...(Object.hasOwn(input, "activeMealPlanType") && {
      activeMealPlanType: input.activeMealPlanType,
    }),
    ...(Object.hasOwn(input, "activeCustomMealPlanId") && {
      activeCustomMealPlanId: input.activeCustomMealPlanId,
    }),
    ...(Object.hasOwn(input, "healthData") && {
      healthData: input.healthData,
    }),
    ...(Object.hasOwn(input, "wellnessData") && {
      wellnessData: input.wellnessData,
    }),
    ...(Object.hasOwn(input, "waterGoal") && { waterGoal: input.waterGoal }),
    ...(Object.hasOwn(input, "reminderPrefs") && {
      reminderPrefs: input.reminderPrefs,
    }),
    ...(Object.hasOwn(input, "places") && { places: input.places }),
  };
}

export function revisionMatches(
  current: number | null,
  base: number | null,
): boolean {
  return current === base;
}
