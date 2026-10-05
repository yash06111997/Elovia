import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const userDataTable = pgTable(
  "user_data",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    appState: jsonb("app_state"),
    workoutPlan: jsonb("workout_plan"),
    customPlans: jsonb("custom_plans"),
    activePlanType: varchar("active_plan_type"),
    activeCustomPlanId: varchar("active_custom_plan_id"),
    activeSession: jsonb("active_session"),
    sessions: jsonb("sessions"),
    personalRecords: jsonb("personal_records"),
    mealPlan: jsonb("meal_plan"),
    foodLog: jsonb("food_log"),
    customMealPlans: jsonb("custom_meal_plans"),
    activeMealPlanType: varchar("active_meal_plan_type"),
    activeCustomMealPlanId: varchar("active_custom_meal_plan_id"),
    healthData: jsonb("health_data"),
    wellnessData: jsonb("wellness_data"),
    waterGoal: jsonb("water_goal"),
    reminderPrefs: jsonb("reminder_prefs"),
    places: jsonb("places"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "user_data_revision_safe",
      sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`,
    ),
  ],
);

export type UserData = typeof userDataTable.$inferSelect;
export type InsertUserData = typeof userDataTable.$inferInsert;
