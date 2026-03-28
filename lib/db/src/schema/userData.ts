import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const userDataTable = pgTable("user_data", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  appState: jsonb("app_state"),
  workoutPlan: jsonb("workout_plan"),
  customPlans: jsonb("custom_plans"),
  activePlanType: varchar("active_plan_type"),
  activeCustomPlanId: varchar("active_custom_plan_id"),
  sessions: jsonb("sessions"),
  personalRecords: jsonb("personal_records"),
  mealPlan: jsonb("meal_plan"),
  foodLog: jsonb("food_log"),
  customMealPlans: jsonb("custom_meal_plans"),
  activeMealPlanType: varchar("active_meal_plan_type"),
  activeCustomMealPlanId: varchar("active_custom_meal_plan_id"),
  healthData: jsonb("health_data"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserData = typeof userDataTable.$inferSelect;
export type InsertUserData = typeof userDataTable.$inferInsert;
