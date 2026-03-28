import { Router, type IRouter, type Request, type Response } from "express";
import { db, userDataTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/user-data", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(userDataTable)
      .where(eq(userDataTable.userId, req.user.id));

    if (!row) {
      res.json({ data: null });
      return;
    }

    res.json({
      data: {
        appState: row.appState,
        workoutPlan: row.workoutPlan,
        customPlans: row.customPlans,
        activePlanType: row.activePlanType,
        activeCustomPlanId: row.activeCustomPlanId,
        sessions: row.sessions,
        personalRecords: row.personalRecords,
        mealPlan: row.mealPlan,
        foodLog: row.foodLog,
        customMealPlans: row.customMealPlans,
        activeMealPlanType: row.activeMealPlanType,
        activeCustomMealPlanId: row.activeCustomMealPlanId,
        healthData: row.healthData,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch user data");
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

router.post("/user-data", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { appState, workoutPlan, customPlans, activePlanType, activeCustomPlanId,
      sessions, personalRecords, mealPlan, foodLog, customMealPlans,
      activeMealPlanType, activeCustomMealPlanId, healthData } = req.body;

    await db
      .insert(userDataTable)
      .values({
        userId: req.user.id,
        appState: appState ?? null,
        workoutPlan: workoutPlan ?? null,
        customPlans: customPlans ?? null,
        activePlanType: activePlanType ?? null,
        activeCustomPlanId: activeCustomPlanId ?? null,
        sessions: sessions ?? null,
        personalRecords: personalRecords ?? null,
        mealPlan: mealPlan ?? null,
        foodLog: foodLog ?? null,
        customMealPlans: customMealPlans ?? null,
        activeMealPlanType: activeMealPlanType ?? null,
        activeCustomMealPlanId: activeCustomMealPlanId ?? null,
        healthData: healthData ?? null,
      })
      .onConflictDoUpdate({
        target: userDataTable.userId,
        set: {
          appState: appState ?? null,
          workoutPlan: workoutPlan ?? null,
          customPlans: customPlans ?? null,
          activePlanType: activePlanType ?? null,
          activeCustomPlanId: activeCustomPlanId ?? null,
          sessions: sessions ?? null,
          personalRecords: personalRecords ?? null,
          mealPlan: mealPlan ?? null,
          foodLog: foodLog ?? null,
          customMealPlans: customMealPlans ?? null,
          activeMealPlanType: activeMealPlanType ?? null,
          activeCustomMealPlanId: activeCustomMealPlanId ?? null,
          healthData: healthData ?? null,
          updatedAt: new Date(),
        },
      });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save user data");
    res.status(500).json({ error: "Failed to save user data" });
  }
});

export default router;
