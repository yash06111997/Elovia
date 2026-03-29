import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { db } from "./firebase";

const ASYNC_STORAGE_KEYS = [
  "@fitai_state",
  "@fitai_plan",
  "@fitai_custom_plans",
  "@fitai_active_plan_type",
  "@fitai_active_custom_plan_id",
  "@fitai_sessions",
  "@fitai_prs",
  "@fitai_meal_plan",
  "@fitai_food_log",
  "@fitai_custom_meal_plans",
  "@fitai_active_meal_plan_type",
  "@fitai_active_custom_meal_plan_id",
  "@fitai_health_data",
];

const FIELD_MAP: Record<string, string> = {
  "@fitai_state": "appState",
  "@fitai_plan": "workoutPlan",
  "@fitai_custom_plans": "customPlans",
  "@fitai_active_plan_type": "activePlanType",
  "@fitai_active_custom_plan_id": "activeCustomPlanId",
  "@fitai_sessions": "sessions",
  "@fitai_prs": "personalRecords",
  "@fitai_meal_plan": "mealPlan",
  "@fitai_food_log": "foodLog",
  "@fitai_custom_meal_plans": "customMealPlans",
  "@fitai_active_meal_plan_type": "activeMealPlanType",
  "@fitai_active_custom_meal_plan_id": "activeCustomMealPlanId",
  "@fitai_health_data": "healthData",
};

const JSON_FIELDS = new Set([
  "@fitai_state",
  "@fitai_plan",
  "@fitai_custom_plans",
  "@fitai_sessions",
  "@fitai_prs",
  "@fitai_meal_plan",
  "@fitai_food_log",
  "@fitai_custom_meal_plans",
  "@fitai_health_data",
]);

export async function backupToFirestore(userId: string): Promise<void> {
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

  const userDocRef = doc(db, "users", userId);
  await setDoc(userDocRef, data, { merge: true });
}

export async function restoreFromFirestore(userId: string): Promise<boolean> {
  const userDocRef = doc(db, "users", userId);
  const snapshot = await getDoc(userDocRef);

  if (!snapshot.exists()) {
    return false;
  }

  const data = snapshot.data();
  const pairs: [string, string][] = [];

  for (const [asyncKey, firestoreField] of Object.entries(FIELD_MAP)) {
    const value = data[firestoreField];
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
  const userDocRef = doc(db, "users", userId);
  const snapshot = await getDoc(userDocRef);
  return snapshot.exists();
}
