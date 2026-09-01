import { Platform } from "react-native";
import { getFirebaseAuth } from "@/lib/firebase";

function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === "web") return "";
  return "http://localhost:8080";
}

export function getPublicApiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
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
  // The device could not reach the server at all. Distinct from every other
  // code here, which describe a server that answered.
  | "offline"
  // Booking. `slot_taken` is the race two clients lose when they tap the same
  // time at once; it is a retry-with-a-different-slot, not an error to apologise for.
  | "slot_taken"
  | "intro_used"
  | "coaching_required"
  | "no_coach"
  | "too_late"
  | "in_past"
  | "bad_request"
  | "deleted_account"
  | "authentication_unavailable"
  | "account_deletion_failed"
  | "account_deletion_finalizing"
  | "unknown";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly resetsAt?: string;
  readonly limit?: number;

  constructor(message: string, status: number, code: ApiErrorCode, extra?: { resetsAt?: string; limit?: number }) {
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

/**
 * Wrap fetch so a dead connection becomes a typed error rather than a raw
 * TypeError.
 *
 * fetch rejects with TypeError("Network request failed") when the device has
 * no route to the server. Left alone that string reaches the user verbatim,
 * which is meaningless to them and, in a basement gym with no signal, is the
 * message they will see most often. Elovia is used in exactly those places.
 */
async function fetchOrOffline(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(
      "You appear to be offline. Your workouts are still saved on this device and will sync when you reconnect.",
      0,
      "offline",
    );
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
    throw new ApiError("Please sign in to use AI features.", 401, "unauthenticated");
  }

  const response = await fetchOrOffline(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Unknown error", code: "unknown" as const }));

    throw new ApiError(payload.error || "Request failed", response.status, (payload.code as ApiErrorCode) || "unknown", { resetsAt: payload.resetsAt, limit: payload.limit });
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
  return postAuthed<FoodRecognitionResult>("/api/ai/recognize-food", {
    imageBase64,
  });
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
  return postAuthed<AIMealPlanResult>("/api/ai/generate-meal-plan", {
    profile,
    dietPrefs,
  });
}

export interface AIWorkoutResult {
  days: any[];
  name: string;
  goal: string;
}

export async function generateAIWorkout(profile: any, planType: "daily" | "scheduled", preferences?: { bodyParts?: string[]; message?: string }): Promise<AIWorkoutResult> {
  return postAuthed<AIWorkoutResult>("/api/ai/generate-workout", {
    profile,
    planType,
    preferences,
  });
}

/** Current entitlement + remaining quota, for rendering limits in the UI. */
export interface EntitlementStatus {
  tier: "free" | "trial" | "premium" | "coaching";
  hasProAccess: boolean;
  /** True only for an active one-to-one coaching subscription. */
  hasCoaching: boolean;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  quotas: Record<string, { limit: number; used: number; remaining: number }>;
}

export async function fetchEntitlement(): Promise<EntitlementStatus | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const response = await fetchOrOffline(`${getBaseUrl()}/api/entitlement`, {
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

export async function coachChat(messages: CoachMessage[], profile: any, context?: { recentWorkouts?: number; dailyCalorieTarget?: number }): Promise<CoachReply> {
  return postAuthed<CoachReply>("/api/ai/coach-chat", {
    messages,
    profile,
    context,
  });
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
  return postAuthed<{ recipes: AIRecipe[] }>("/api/ai/generate-recipe", {
    profile,
    options,
  });
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

export async function analyseSupplement(supplementId: string, profile: any, refresh = false): Promise<{ analysis: SupplementAnalysis; cached: boolean }> {
  return postAuthed<{ analysis: SupplementAnalysis; cached: boolean }>(`/api/supplements/${supplementId}/analyse`, { profile, refresh });
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

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

async function getAuthed<T>(path: string): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("Please sign in.", 401, "unauthenticated");

  const response = await fetchOrOffline(`${getBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(payload.error || "Request failed", response.status, payload.code || "unknown");
  }
  return response.json() as Promise<T>;
}

async function sendAuthed<T>(path: string, method: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("Please sign in.", 401, "unauthenticated");

  const response = await fetchOrOffline(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(payload.error || "Request failed", response.status, payload.code || "unknown");
  }
  return response.json() as Promise<T>;
}

export interface AccountDataExport {
  exportedAt: string;
  account: unknown;
  appData: unknown;
  entitlement: EntitlementStatus;
  subscriptions: unknown[];
  aiUsage: unknown[];
  pushDevices: unknown[];
  supplements: unknown[];
  social: unknown;
  challenges: unknown;
  coaching: unknown;
}

export function exportMyData(): Promise<AccountDataExport> {
  return getAuthed<AccountDataExport>("/api/privacy/export");
}

export async function deleteMyAccount(requestId: string): Promise<{ deleted: boolean; finalizing: boolean }> {
  const response = await sendAuthed<unknown>("/api/account", "DELETE", undefined, {
    "X-Elovia-Deletion-Request-ID": requestId,
  });
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    typeof (response as { deleted?: unknown }).deleted !== "boolean" ||
    typeof (response as { finalizing?: unknown }).finalizing !== "boolean" ||
    (response as { deleted: boolean }).deleted ===
      (response as { finalizing: boolean }).finalizing
  ) {
    throw new ApiError("Invalid account deletion response", 502, "unknown");
  }
  return response as { deleted: boolean; finalizing: boolean };
}

export interface AccountDeletionStatus {
  started: boolean;
  finalized: boolean;
  finalizing: boolean;
  requestIdMatches: boolean | null;
}

function parseAccountDeletionStatus(value: unknown): AccountDeletionStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("Invalid deletion status response", 502, "unknown");
  }
  const candidate = value as Partial<AccountDeletionStatus>;
  if (
    typeof candidate.started !== "boolean" ||
    typeof candidate.finalized !== "boolean" ||
    typeof candidate.finalizing !== "boolean" ||
    (candidate.requestIdMatches !== null &&
      typeof candidate.requestIdMatches !== "boolean") ||
    (candidate.finalized && candidate.finalizing) ||
    (candidate.started && !candidate.finalized && !candidate.finalizing) ||
    (!candidate.started && (candidate.finalized || candidate.finalizing))
  ) {
    throw new ApiError("Invalid deletion status response", 502, "unknown");
  }
  return candidate as AccountDeletionStatus;
}

export async function getAccountDeletionStatus(
  requestId: string | null,
  ownerUserId: string | null = null,
): Promise<AccountDeletionStatus> {
  if (requestId && ownerUserId) {
    const response = await fetchOrOffline(
      `${getBaseUrl()}/api/account/deletion-status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: ownerUserId, requestId }),
      },
    );
    if (!response.ok) {
      const payload = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ApiError(
        payload.error || "Request failed",
        response.status,
        payload.code || "unknown",
      );
    }
    return parseAccountDeletionStatus(await response.json());
  }
  return parseAccountDeletionStatus(
    await sendAuthed<unknown>(
      "/api/account/deletion-status",
      "GET",
      undefined,
      requestId ? { "X-Elovia-Deletion-Request-ID": requestId } : undefined,
    ),
  );
}

export interface SocialProfile {
  userId: string;
  displayName: string;
  friendCode: string;
  avatarUrl: string | null;
  bio: string | null;
  discoverable: boolean;
  leaderboardOptIn: boolean;
}

export interface FriendEntry {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  since: string;
}

export interface FeedActivity {
  id: string;
  kind: string;
  title: string;
  caption: string | null;
  payload: Record<string, unknown>;
  kudosCount: number;
  commentCount: number;
  createdAt: string;
  hasKudos: boolean;
  author: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    isSelf: boolean;
  };
}

export interface ChallengeEntry {
  id: string;
  name: string;
  description: string | null;
  metric: string;
  target: number;
  endsAt: string;
  joinCode: string;
  active: boolean;
  participants: {
    userId: string;
    displayName: string;
    progress: number;
    isSelf: boolean;
  }[];
}

export const social = {
  me: () => getAuthed<{ profile: SocialProfile }>("/api/social/me"),
  updateMe: (patch: Partial<Pick<SocialProfile, "displayName" | "bio" | "discoverable" | "leaderboardOptIn">>) =>
    sendAuthed<{ profile: SocialProfile }>("/api/social/me", "PATCH", patch),

  lookup: (code: string) =>
    getAuthed<{
      user: { userId: string; displayName: string; bio: string | null };
      state: string;
    }>(`/api/social/lookup/${encodeURIComponent(code)}`),

  friends: () =>
    getAuthed<{
      friends: FriendEntry[];
      incoming: FriendEntry[];
      outgoing: FriendEntry[];
    }>("/api/social/friends"),
  requestFriend: (userId: string) =>
    sendAuthed<{ state: string }>("/api/social/friends/request", "POST", {
      userId,
    }),
  respondFriend: (friendshipId: string, accept: boolean) => sendAuthed<{ state: string }>(`/api/social/friends/${friendshipId}/respond`, "POST", { accept }),
  removeFriend: (friendshipId: string) => sendAuthed<{ removed: boolean }>(`/api/social/friends/${friendshipId}`, "DELETE"),

  feed: (limit = 25) => getAuthed<{ feed: FeedActivity[] }>(`/api/social/feed?limit=${limit}`),
  share: (input: { kind: string; title: string; caption?: string; payload?: unknown }) => sendAuthed<{ activity: unknown }>("/api/social/activities", "POST", input),
  deleteActivity: (id: string) => sendAuthed<{ deleted: boolean }>(`/api/social/activities/${id}`, "DELETE"),
  toggleKudos: (id: string) => sendAuthed<{ hasKudos: boolean; kudosCount: number }>(`/api/social/activities/${id}/kudos`, "POST"),

  leaderboard: (days = 7) =>
    getAuthed<{
      leaderboard: {
        userId: string;
        displayName: string;
        activities: number;
        isSelf: boolean;
      }[];
      optedIn: boolean;
    }>(`/api/social/leaderboard?days=${days}`),

  challenges: () => getAuthed<{ challenges: ChallengeEntry[] }>("/api/social/challenges"),
  createChallenge: (input: { name: string; description?: string; metric: string; target: number; days: number }) =>
    sendAuthed<{ challenge: ChallengeEntry }>("/api/social/challenges", "POST", input),
  joinChallenge: (joinCode: string) => sendAuthed<{ challenge: ChallengeEntry }>("/api/social/challenges/join", "POST", { joinCode }),
};

// ---------------------------------------------------------------------------
// Coaching
// ---------------------------------------------------------------------------

export interface CoachingSlot {
  /** Absolute ISO instant. Render it in the device's own timezone. */
  startsAt: string;
  durationMins: number;
}

export interface CoachingSession {
  id: string;
  startsAt: string;
  durationMins: number;
  status: string;
  kind: "intro" | "coaching";
  meetingUrl: string | null;
  clientNote: string | null;
  coachNote: string | null;
  coachName: string;
  isPast: boolean;
  canCancel: boolean;
  cancelBlockedReason: string | null;
}

export const coaching = {
  slots: () =>
    getAuthed<{
      slots: CoachingSlot[];
      acceptingClients: boolean;
      coachName?: string;
      cancellationNoticeHours?: number;
      reason?: string;
    }>("/api/coaching/slots"),

  sessions: () => getAuthed<{ sessions: CoachingSession[] }>("/api/coaching/sessions"),

  book: (startsAt: string, kind: "intro" | "coaching", note?: string) =>
    sendAuthed<{ session: CoachingSession }>("/api/coaching/sessions", "POST", {
      startsAt,
      kind,
      note,
    }),

  cancel: (id: string, reason?: string) => sendAuthed<{ cancelled: boolean }>(`/api/coaching/sessions/${id}/cancel`, "POST", { reason }),

  /**
   * A short-lived signed URL for the session's .ics file.
   *
   * Two steps rather than one because the OS, not the app, opens the final
   * URL — so it carries no auth header. The app trades its token for a signed
   * link here, and only the signed link is handed to Linking.
   */
  calendarLink: (id: string) => getAuthed<{ url: string }>(`/api/coaching/sessions/${id}/calendar-link`),
};
