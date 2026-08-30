import { randomUUID } from "node:crypto";
import { db, aiUsageTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { AccessTier } from "./entitlements";

export type AiRoute =
  | "recognize-food"
  | "generate-workout"
  | "generate-meal-plan"
  | "generate-recipe"
  | "coach-chat"
  | "analyse-supplement";

/**
 * Daily request ceilings per tier.
 *
 * `free` is 0 across the board — free users get the deterministic, zero-cost
 * generator instead (utils/aiEngine.ts), not a cheaper model. Trial users get a
 * real taste but a tighter cap than payers, because trial traffic is pure cost
 * with no offsetting revenue.
 */
const DAILY_LIMITS: Record<AccessTier, Record<AiRoute, number>> = {
  free: {
    "recognize-food": 0,
    "generate-workout": 0,
    "generate-meal-plan": 0,
    "generate-recipe": 0,
    "coach-chat": 0,
    "analyse-supplement": 0,
  },
  trial: {
    "recognize-food": 10,
    "generate-workout": 5,
    "generate-meal-plan": 5,
    "generate-recipe": 10,
    "coach-chat": 25,
    "analyse-supplement": 10,
  },
  // Coaching clients pay roughly 30x the software tier; metering them like a
  // $4.99 subscriber would be indefensible. Still bounded, because "unlimited"
  // plus a scripted client is how you get a surprise invoice.
  coaching: {
    "recognize-food": 150,
    "generate-workout": 60,
    "generate-meal-plan": 60,
    "generate-recipe": 120,
    "coach-chat": 500,
    "analyse-supplement": 100,
  },
  premium: {
    "recognize-food": 50,
    "generate-workout": 20,
    "generate-meal-plan": 20,
    "generate-recipe": 40,
    "coach-chat": 200,
    // Analyses are cached per substance, so a high cap costs little in practice.
    "analyse-supplement": 40,
  },
};

/** Hard ceiling on a single user's daily AI spend, in micro-USD (1e-6 USD). */
export const DAILY_COST_CEILING_MICROS: Record<AccessTier, number> = {
  free: 0,
  trial: 300_000, // $0.30
  premium: 2_000_000, // $2.00
  coaching: 8_000_000, // $8.00 - still a rounding error against $149/month
};

export function dailyLimitFor(tier: AccessTier, route: AiRoute): number {
  return DAILY_LIMITS[tier][route] ?? 0;
}

/** UTC day bucket. Deliberately UTC so the reset time is not server-locale dependent. */
export function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface QuotaDecision {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  reason?: "tier_not_permitted" | "daily_limit_reached" | "cost_ceiling_reached";
  resetsAt: string;
}

function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * Atomically claim one request against the user's daily quota.
 *
 * The increment happens BEFORE the upstream LLM call, and the post-increment
 * count is what's compared against the limit. Checking first and incrementing
 * after would let a burst of concurrent requests all read the same
 * under-limit value and sail through together.
 *
 * On refusal the claim is released, so a blocked request doesn't consume budget.
 */
export async function claimQuota(
  userId: string,
  tier: AccessTier,
  route: AiRoute,
): Promise<QuotaDecision> {
  const limit = dailyLimitFor(tier, route);
  const resetsAt = nextUtcMidnight();

  if (limit <= 0) {
    return {
      allowed: false,
      limit: 0,
      used: 0,
      remaining: 0,
      reason: "tier_not_permitted",
      resetsAt,
    };
  }

  const day = currentDay();

  const [row] = await db
    .insert(aiUsageTable)
    .values({ id: randomUUID(), userId, day, route, requestCount: 1 })
    .onConflictDoUpdate({
      target: [aiUsageTable.userId, aiUsageTable.day, aiUsageTable.route],
      set: {
        requestCount: sql`${aiUsageTable.requestCount} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({
      requestCount: aiUsageTable.requestCount,
      estimatedCostMicros: aiUsageTable.estimatedCostMicros,
    });

  const used = row?.requestCount ?? 1;

  if (used > limit) {
    await releaseQuota(userId, route);
    return {
      allowed: false,
      limit,
      used: limit,
      remaining: 0,
      reason: "daily_limit_reached",
      resetsAt,
    };
  }

  // Cost ceiling is evaluated across every route for the day, not just this one.
  const spentToday = await dailySpendMicros(userId);
  if (spentToday >= DAILY_COST_CEILING_MICROS[tier]) {
    await releaseQuota(userId, route);
    return {
      allowed: false,
      limit,
      used: used - 1,
      remaining: Math.max(0, limit - (used - 1)),
      reason: "cost_ceiling_reached",
      resetsAt,
    };
  }

  return { allowed: true, limit, used, remaining: Math.max(0, limit - used), resetsAt };
}

/** Give back a claim when the request never reached the provider. */
export async function releaseQuota(userId: string, route: AiRoute): Promise<void> {
  try {
    await db
      .update(aiUsageTable)
      .set({ requestCount: sql`GREATEST(${aiUsageTable.requestCount} - 1, 0)` })
      .where(
        and(
          eq(aiUsageTable.userId, userId),
          eq(aiUsageTable.day, currentDay()),
          eq(aiUsageTable.route, route),
        ),
      );
  } catch {
    // A failed release only over-counts against the user's own daily quota,
    // which resets at UTC midnight. Never fail the request over it.
  }
}

/** Total estimated spend for this user today, across all AI routes. */
export async function dailySpendMicros(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${aiUsageTable.estimatedCostMicros}), 0)::int`,
    })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, currentDay())));

  return row?.total ?? 0;
}

/** Record what a completed call actually cost, for the ceiling above. */
export async function recordUsage(
  userId: string,
  route: AiRoute,
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
    provider: string;
  },
): Promise<void> {
  try {
    await db
      .update(aiUsageTable)
      .set({
        inputTokens: sql`${aiUsageTable.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${aiUsageTable.outputTokens} + ${usage.outputTokens}`,
        estimatedCostMicros: sql`${aiUsageTable.estimatedCostMicros} + ${usage.estimatedCostMicros}`,
        provider: usage.provider,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiUsageTable.userId, userId),
          eq(aiUsageTable.day, currentDay()),
          eq(aiUsageTable.route, route),
        ),
      );
  } catch {
    // Accounting is best-effort; never fail a served response over it.
  }
}
