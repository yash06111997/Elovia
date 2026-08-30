import { ref, set, get, serverTimestamp } from "firebase/database";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseDb } from "./firebase";

const ASYNC_STORAGE_KEYS = [
  "@elovia_state",
  "@elovia_plan",
  "@elovia_custom_plans",
  "@elovia_active_plan_type",
  "@elovia_active_custom_plan_id",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_active_meal_plan_type",
  "@elovia_active_custom_meal_plan_id",
  "@elovia_health_data",
  "@elovia_subscription",
];

const FIELD_MAP: Record<string, string> = {
  "@elovia_state": "appState",
  "@elovia_plan": "workoutPlan",
  "@elovia_custom_plans": "customPlans",
  "@elovia_active_plan_type": "activePlanType",
  "@elovia_active_custom_plan_id": "activeCustomPlanId",
  "@elovia_sessions": "sessions",
  "@elovia_prs": "personalRecords",
  "@elovia_meal_plan": "mealPlan",
  "@elovia_food_log": "foodLog",
  "@elovia_custom_meal_plans": "customMealPlans",
  "@elovia_active_meal_plan_type": "activeMealPlanType",
  "@elovia_active_custom_meal_plan_id": "activeCustomMealPlanId",
  "@elovia_health_data": "healthData",
  "@elovia_subscription": "subscription",
};

const JSON_FIELDS = new Set([
  "@elovia_state",
  "@elovia_plan",
  "@elovia_custom_plans",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_health_data",
  "@elovia_subscription",
]);

export async function backupToFirestore(userId: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;

  const values = await AsyncStorage.multiGet(ASYNC_STORAGE_KEYS);
  const data: Record<string, any> = {};

  for (const [key, value] of values) {
    const field = FIELD_MAP[key];
    if (!field || !value) continue;

    if (JSON_FIELDS.has(key)) {
      try {
        data[field] = JSON.parse(value);
      } catch {
        data[field] = value;
      }
    } else {
      data[field] = value;
    }
  }

  data.updatedAt = serverTimestamp();

  const userRef = ref(db, `users/${userId}`);
  await set(userRef, data);
}

export async function restoreFromFirestore(userId: string): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);

  if (!snapshot.exists()) {
    return false;
  }

  const data = snapshot.val();
  const pairs: [string, string][] = [];

  for (const [asyncKey, firebaseField] of Object.entries(FIELD_MAP)) {
    const value = data[firebaseField];
    if (value === undefined || value === null) continue;

    if (JSON_FIELDS.has(asyncKey)) {
      pairs.push([asyncKey, JSON.stringify(value)]);
    } else {
      pairs.push([asyncKey, String(value)]);
    }
  }

  if (pairs.length > 0) {
    await AsyncStorage.multiSet(pairs);
  }

  return true;
}

export async function checkFirestoreDataExists(userId: string): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const userRef = ref(db, `users/${userId}`);
  const snapshot = await get(userRef);
  return snapshot.exists();
}
