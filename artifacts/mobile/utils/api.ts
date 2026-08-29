import { Platform } from "react-native";
import { getFirebaseAuth } from "@/lib/firebase";

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

/**
 * Why the client distinguishes these:
 *
 *   401 -> the session lapsed; send them back through sign-in.
 *   402 -> entitlement missing; open the paywall.
 *   429 -> entitled but out of quota today; show the reset time, NOT the paywall.
 *
 * Collapsing 402 and 429 into one "upgrade" prompt is the classic mistake here:
 * it nags paying subscribers to buy something they already own.
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "payment_required"
  | "tier_not_permitted"
  | "daily_limit_reached"
  | "cost_ceiling_reached"
  | "entitlement_unavailable"
  | "quota_unavailable"
  | "unknown";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly resetsAt?: string;
  readonly limit?: number;

  constructor(
    message: string,
    status: number,
    code: ApiErrorCode,
    extra?: { resetsAt?: string; limit?: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.resetsAt = extra?.resetsAt;
    this.limit = extra?.limit;
  }

  /** Caller should route the user to the paywall. */
  get requiresUpgrade(): boolean {
    return this.status === 402 || this.code === "tier_not_permitted";
  }

  /** Caller should show "try again later", not an upsell. */
  get isRateLimited(): boolean {
    return this.status === 429 && this.code !== "tier_not_permitted";
  }

  get requiresSignIn(): boolean {
    return this.status === 401;
  }
}

async function getAuthToken(): Promise<string | null> {
  try {
    const firebaseAuth = await getFirebaseAuth();
    const user = firebaseAuth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * POST to a gated endpoint with the caller's Firebase ID token attached.
 *
 * Every AI route on the server now requires this header. A request without it
 * gets a 401 rather than free inference.
 */
async function postAuthed<T>(path: string, body: unknown): Promise<T> {
  const token = await getAuthToken();

  if (!token) {
    throw new ApiError(
      "Please sign in to use AI features.",
      401,
      "unauthenticated",
    );
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({ error: "Unknown error", code: "unknown" as const }));

    throw new ApiError(
      payload.error || "Request failed",
      response.status,
      (payload.code as ApiErrorCode) || "unknown",
      { resetsAt: payload.resetsAt, limit: payload.limit },
    );
  }

  return response.json() as Promise<T>;
}

export interface RecognizedFood {
  name: string;
  servingSize: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  confidence: string;
}

export interface FoodRecognitionResult {
  foods: RecognizedFood[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  description: string;
}

export async function recognizeFood(imageBase64: string): Promise<FoodRecognitionResult> {
  return postAuthed<FoodRecognitionResult>("/api/ai/recognize-food", { imageBase64 });
}

export interface AIMealPlanResult {
  meals: {
    id: string;
    name: string;
    mealType: string;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    ingredients: string[];
    instructions: string;
  }[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  dietType: string;
  summary: string;
}

export async function generateAIMealPlan(
  profile: any,
  dietPrefs: {
    dietType: string;
    favoriteFoods: string;
    mealSuggestions: string;
    mealsPerDay: number;
  },
): Promise<AIMealPlanResult> {
  return postAuthed<AIMealPlanResult>("/api/ai/generate-meal-plan", { profile, dietPrefs });
}

export interface AIWorkoutResult {
  days: any[];
  name: string;
  goal: string;
}

export async function generateAIWorkout(
  profile: any,
  planType: "daily" | "scheduled",
  preferences?: { bodyParts?: string[]; message?: string },
): Promise<AIWorkoutResult> {
  return postAuthed<AIWorkoutResult>("/api/ai/generate-workout", {
    profile,
    planType,
    preferences,
  });
}

/** Current entitlement + remaining quota, for rendering limits in the UI. */
export interface EntitlementStatus {
  tier: "free" | "trial" | "premium";
  hasProAccess: boolean;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  quotas: Record<string, { limit: number; used: number; remaining: number }>;
}

export async function fetchEntitlement(): Promise<EntitlementStatus | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const response = await fetch(`${getBaseUrl()}/api/entitlement`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) return null;
  return response.json() as Promise<EntitlementStatus>;
}

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CoachReply {
  reply: string;
  provider: string;
}

export async function coachChat(
  messages: CoachMessage[],
  profile: any,
  context?: { recentWorkouts?: number; dailyCalorieTarget?: number },
): Promise<CoachReply> {
  return postAuthed<CoachReply>("/api/ai/coach-chat", { messages, profile, context });
}

export interface AIRecipe {
  id: string;
  name: string;
  description: string;
  prepMins: number;
  cookMins: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

export async function generateRecipes(
  profile: any,
  options: {
    count?: number;
    mealType?: string;
    dietType?: string;
    targetCalories?: number;
    ingredients?: string;
    message?: string;
  },
): Promise<{ recipes: AIRecipe[] }> {
  return postAuthed<{ recipes: AIRecipe[] }>("/api/ai/generate-recipe", { profile, options });
}

export interface SupplementAnalysis {
  identified: boolean;
  displayName: string;
  category: string;
  summary: string;
  evidenceLevel: "strong" | "moderate" | "limited" | "insufficient";
  evidenceNote: string;
  trainingEffects: string[];
  nutritionNotes: string[];
  timingGuidance: string | null;
  commonSideEffects: string[];
  cautions: string[];
  requiresProfessional: boolean;
  disclaimer: string;
}

export async function analyseSupplement(
  supplementId: string,
  profile: any,
  refresh = false,
): Promise<{ analysis: SupplementAnalysis; cached: boolean }> {
  return postAuthed<{ analysis: SupplementAnalysis; cached: boolean }>(
    `/api/supplements/${supplementId}/analyse`,
    { profile, refresh },
  );
}

export async function createSupplement(input: {
  name: string;
  kind: "supplement" | "medication";
  dosage?: string;
  unit?: string;
  frequency?: string;
  times?: string[];
  withFood?: boolean;
  notes?: string;
}): Promise<{ supplement: unknown }> {
  return postAuthed<{ supplement: unknown }>("/api/supplements", input);
}
