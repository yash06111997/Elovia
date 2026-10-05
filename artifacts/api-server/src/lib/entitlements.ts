import { db, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveStoredSubscription } from "./subscriptionPolicy";
export { COACHING_ENTITLEMENT, TRIAL_DURATION_DAYS, resolveStoredSubscription } from "./subscriptionPolicy";
export type { AccessTier, Entitlement } from "./subscriptionPolicy";

/** Only verified store transactions grant access. Creating an account is free. */
export async function resolveEntitlement(userId: string) {
  const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId));
  return resolveStoredSubscription(subscription);
}
