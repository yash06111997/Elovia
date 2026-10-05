import { randomUUID } from "node:crypto";
import {
  db,
  aiUsageTable,
  aiRequestsTable,
  aiAttemptsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { AccessTier } from "./entitlements";
import {
  withAccountLock,
  type AccountLockTransaction,
} from "./accountDeletion";
import type { ProviderName } from "./ai/types";

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

/** Daily estimated budget (not an exact provider invoice cap), in micro-USD (1e-6 USD). */
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

/** Issued by the server; never accepted from a client body. */
export interface QuotaClaim {
  id: string;
  userId: string;
}
export interface QuotaDecision {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  reason?:
    | "tier_not_permitted"
    | "daily_limit_reached"
    | "cost_ceiling_reached";
  resetsAt: string;
  claim?: QuotaClaim;
}
function resetFor(day: string): string {
  return new Date(Date.parse(day + "T00:00:00Z") + 86_400_000).toISOString();
}
export class AiBudgetError extends Error {
  readonly code = "cost_ceiling_reached";
  constructor(readonly resetsAt: string) {
    super("Today's estimated AI budget has been reached");
  }
}
export class AiAccountingError extends Error {
  readonly code = "quota_unavailable";
  constructor() {
    super("Could not safely account for AI usage");
  }
}
function usageKey(row: { userId: string; day: string; route: string }) {
  return and(
    eq(aiUsageTable.userId, row.userId),
    eq(aiUsageTable.day, row.day),
    eq(aiUsageTable.route, row.route),
  );
}
async function spendFor(
  tx: AccountLockTransaction,
  userId: string,
  day: string,
): Promise<number> {
  const [row] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${aiUsageTable.estimatedCostMicros}), 0)::int`,
    })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, day)));
  return row?.total ?? 0;
}
async function requestFor(tx: AccountLockTransaction, claim: QuotaClaim) {
  const [row] = await tx
    .select()
    .from(aiRequestsTable)
    .where(
      and(
        eq(aiRequestsTable.id, claim.id),
        eq(aiRequestsTable.userId, claim.userId),
      ),
    );
  if (!row) throw new AiAccountingError();
  return row;
}

/** Count and durable claim commit together under the account's transaction lock. */
export async function claimQuota(
  userId: string,
  tier: AccessTier,
  route: AiRoute,
): Promise<QuotaDecision> {
  const day = currentDay();
  const limit = dailyLimitFor(tier, route);
  const resetsAt = resetFor(day);
  const decision = (
    used: number,
    reason?: QuotaDecision["reason"],
  ): QuotaDecision => ({
    allowed: !reason,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt,
    ...(reason ? { reason } : {}),
  });
  if (limit <= 0) return decision(0, "tier_not_permitted");
  return withAccountLock(userId, async (tx) => {
    const key = { userId, day, route };
    const [row] = await tx.select().from(aiUsageTable).where(usageKey(key));
    const used = row?.requestCount ?? 0;
    if (used >= limit) return decision(used, "daily_limit_reached");
    const ceiling = DAILY_COST_CEILING_MICROS[tier];
    if ((await spendFor(tx, userId, day)) >= ceiling)
      return decision(used, "cost_ceiling_reached");
    const id = randomUUID();
    await tx
      .insert(aiRequestsTable)
      .values({ id, ...key, costCeilingMicros: ceiling });
    await tx
      .insert(aiUsageTable)
      .values({ id: randomUUID(), ...key, requestCount: 1 })
      .onConflictDoUpdate({
        target: [aiUsageTable.userId, aiUsageTable.day, aiUsageTable.route],
        set: {
          requestCount: sql`${aiUsageTable.requestCount} + 1`,
          updatedAt: new Date(),
        },
      });
    return { ...decision(used + 1), claim: { id, userId } };
  });
}

/** Close on finish OR disconnect. Refund only claims with no provider attempt. */
export async function releaseQuota(claim: QuotaClaim): Promise<void> {
  await withAccountLock(claim.userId, async (tx) => {
    const row = await requestFor(tx, claim);
    if (row.status === "closed") return;
    if (row.status === "claimed") {
      await tx
        .update(aiUsageTable)
        .set({
          requestCount: sql`GREATEST(${aiUsageTable.requestCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(usageKey(row));
    }
    await tx
      .update(aiRequestsTable)
      .set({ status: "closed" })
      .where(eq(aiRequestsTable.id, row.id));
  });
}

/** Each fallback reserves separately; no database lock is held during provider IO. */
export async function reserveAttempt(
  claim: QuotaClaim,
  provider: ProviderName,
  reservedCostMicros: number,
): Promise<string> {
  if (
    !Number.isSafeInteger(reservedCostMicros) ||
    reservedCostMicros <= 0 ||
    reservedCostMicros > 2_147_483_647
  ) {
    throw new AiAccountingError();
  }
  return withAccountLock(claim.userId, async (tx) => {
    const row = await requestFor(tx, claim);
    if (row.status === "closed") throw new Error("AI request is closed");
    const spent = await spendFor(tx, row.userId, row.day);
    if (spent + reservedCostMicros > row.costCeilingMicros)
      throw new AiBudgetError(resetFor(row.day));
    const id = randomUUID();
    await tx
      .insert(aiAttemptsTable)
      .values({ id, requestId: row.id, provider, reservedCostMicros });
    const updated = await tx
      .update(aiUsageTable)
      .set({
        estimatedCostMicros: sql`${aiUsageTable.estimatedCostMicros} + ${reservedCostMicros}`,
        updatedAt: new Date(),
      })
      .where(usageKey(row))
      .returning({ id: aiUsageTable.id });
    if (updated.length !== 1) throw new AiAccountingError();
    await tx
      .update(aiRequestsTable)
      .set({ status: "started" })
      .where(eq(aiRequestsTable.id, row.id));
    return id;
  });
}

interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
  provider: ProviderName;
  model: string;
}
function validCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

/** Settle once. Unknown usage or a failed write leaves the reservation debited. */
export async function settleAttempt(
  claim: QuotaClaim,
  attemptId: string,
  usage: MeasuredUsage,
): Promise<void> {
  if (
    ![usage.inputTokens, usage.outputTokens, usage.estimatedCostMicros].every(
      validCount,
    ) ||
    usage.inputTokens + usage.outputTokens === 0
  )
    return;
  await withAccountLock(claim.userId, async (tx) => {
    const request = await requestFor(tx, claim);
    const [attempt] = await tx
      .select()
      .from(aiAttemptsTable)
      .where(
        and(
          eq(aiAttemptsTable.id, attemptId),
          eq(aiAttemptsTable.requestId, request.id),
        ),
      );
    if (!attempt || attempt.provider !== usage.provider)
      throw new AiAccountingError();
    if (attempt.settledAt) return;
    await tx
      .update(aiAttemptsTable)
      .set({
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMicros: usage.estimatedCostMicros,
        settledAt: new Date(),
      })
      .where(eq(aiAttemptsTable.id, attempt.id));
    const delta = usage.estimatedCostMicros - attempt.reservedCostMicros;
    const updated = await tx
      .update(aiUsageTable)
      .set({
        inputTokens: sql`${aiUsageTable.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${aiUsageTable.outputTokens} + ${usage.outputTokens}`,
        estimatedCostMicros: sql`${aiUsageTable.estimatedCostMicros} + ${delta}`,
        provider: usage.provider,
        updatedAt: new Date(),
      })
      .where(usageKey(request))
      .returning({ id: aiUsageTable.id });
    if (updated.length !== 1) throw new AiAccountingError();
  });
}

/** Includes unresolved reservations, not just successfully parsed responses. */
export async function dailySpendMicros(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${aiUsageTable.estimatedCostMicros}), 0)::int`,
    })
    .from(aiUsageTable)
    .where(
      and(eq(aiUsageTable.userId, userId), eq(aiUsageTable.day, currentDay())),
    );
  return row?.total ?? 0;
}
