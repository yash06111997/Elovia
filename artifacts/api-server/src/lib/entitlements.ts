import {
  db,
  revenuecatCustomerStateTable,
  subscriptionEntitlementsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadRevenueCatConfig } from "./revenuecatConfig.js";
import {
  resolveNormalizedEntitlement,
  type SafeEntitlement,
} from "./revenuecatWorkerCore.js";
import { enqueueTrustedCustomerState } from "./revenuecatWorker.js";

/** Length of the once-per-account free trial. */
export const TRIAL_DURATION_DAYS = 15;
export type AccessTier = "free" | "trial" | "premium" | "coaching";
export const COACHING_ENTITLEMENT = "Elovia Coaching";
export interface Entitlement extends SafeEntitlement {}

/**
 * Resolve only normalized canonical rows. Legacy subscription rows are never a
 * grant source in either per_user or strict mode.
 */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const config = loadRevenueCatConfig(process.env);
  const [users, states] = await Promise.all([
    db
      .select({ createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
    db
      .select({
        canonicalizationState:
          revenuecatCustomerStateTable.canonicalizationState,
        reconcileAfter: revenuecatCustomerStateTable.reconcileAfter,
      })
      .from(revenuecatCustomerStateTable)
      .where(eq(revenuecatCustomerStateTable.userId, userId))
      .limit(1),
  ]);
  const user = users[0] ?? null;
  const state = states[0] ?? null;
  if (
    user &&
    (!state ||
      state.canonicalizationState !== "canonical" ||
      state.reconcileAfter.getTime() <= Date.now())
  ) {
    await enqueueTrustedCustomerState(userId, "on_demand");
  }
  const rows =
    state?.canonicalizationState === "canonical"
      ? await db
          .select({
            entitlementId: subscriptionEntitlementsTable.entitlementId,
            active: subscriptionEntitlementsTable.active,
            status: subscriptionEntitlementsTable.status,
            accessEndsAt: subscriptionEntitlementsTable.accessEndsAt,
            productId: subscriptionEntitlementsTable.productId,
            sourceEnvironment: subscriptionEntitlementsTable.sourceEnvironment,
          })
          .from(subscriptionEntitlementsTable)
          .where(eq(subscriptionEntitlementsTable.userId, userId))
      : [];
  return resolveNormalizedEntitlement({
    userCreatedAt: user?.createdAt ?? null,
    canonicalizationState: state?.canonicalizationState ?? null,
    rows,
    proEntitlementId: config.proEntitlementId,
    coachingEntitlementId: config.coachingEntitlementId,
    expectedEnvironment: config.environment,
  });
}
