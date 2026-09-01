import {
  accountDeletionTombstonesTable,
  db,
  usersTable,
  type AccountDeletionTombstone,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const ACCOUNT_DELETION_LOCK_SEED = 2_026_090_101;

export type AccountLockTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export interface ProvisionedAuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

async function lockAccount(
  transaction: AccountLockTransaction,
  userId: string,
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, ${ACCOUNT_DELETION_LOCK_SEED}))`,
  );
}

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function orderedAccountIds(userIds: readonly string[]): string[] {
  for (const userId of userIds) {
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("Account id must not be empty.");
    }
  }
  return [...new Set(userIds)].sort(byteCompare);
}

/**
 * Run a callback under neutral account locks. Locks exist independently of a
 * users row, so deletion, provisioning, and provider reconciliation serialize
 * for existing, missing, and tombstoned identities alike.
 */
export async function withAccountLocks<T>(
  userIds: readonly string[],
  callback: (transaction: AccountLockTransaction) => Promise<T>,
): Promise<T> {
  const ordered = orderedAccountIds(userIds);
  return db.transaction(async (transaction) => {
    for (const userId of ordered) {
      await lockAccount(transaction, userId);
    }
    return callback(transaction);
  });
}

export async function withAccountLock<T>(
  userId: string,
  callback: (transaction: AccountLockTransaction) => Promise<T>,
): Promise<T> {
  return withAccountLocks([userId], callback);
}

/**
 * The check and upsert share the same per-UID transaction lock as deletion.
 * This closes the snapshot race where an auth request could otherwise recreate
 * users after a concurrent tombstone transaction commits.
 */
export async function provisionAuthenticatedUserIfActive(
  user: ProvisionedAuthUser,
): Promise<"active" | "deleted"> {
  return withAccountLock(user.id, async (transaction) => {
    const tombstone = await transaction
      .select({ userId: accountDeletionTombstonesTable.userId })
      .from(accountDeletionTombstonesTable)
      .where(eq(accountDeletionTombstonesTable.userId, user.id))
      .limit(1);
    if (tombstone.length > 0) return "deleted";

    await transaction
      .insert(usersTable)
      .values({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          updatedAt: new Date(),
        },
      });
    return "active";
  });
}

export async function findAccountDeletionTombstone(
  userId: string,
): Promise<AccountDeletionTombstone | null> {
  const rows = await db
    .select()
    .from(accountDeletionTombstonesTable)
    .where(eq(accountDeletionTombstonesTable.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAccountDeletionTombstoneByRequest(
  userId: string,
  requestId: string,
): Promise<AccountDeletionTombstone | null> {
  const rows = await db
    .select()
    .from(accountDeletionTombstonesTable)
    .where(
      and(
        eq(accountDeletionTombstonesTable.userId, userId),
        eq(accountDeletionTombstonesTable.requestId, requestId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface AccountDeletionIdentityClaim {
  userId: string;
  requestId: string;
  leaseId: string;
  attemptCount: number;
}

/**
 * Lease durable identity-deletion work. SKIP LOCKED lets every API replica run
 * the worker without processing the same account concurrently. A lease ID
 * prevents a slow expired worker from releasing a newer worker's claim.
 */
export async function claimPendingAccountDeletionIdentities(options: {
  leaseId: string;
  limit: number;
  leaseSeconds: number;
}): Promise<AccountDeletionIdentityClaim[]> {
  const claimed = await db.execute<{
    user_id: string;
    request_id: string;
    identity_attempt_count: number;
  }>(sql`
    WITH candidates AS (
      SELECT "user_id"
      FROM "account_deletions"
      WHERE "status" = 'identity_pending'
        AND "identity_next_attempt_at" <= now()
        AND ("identity_lease_until" IS NULL OR "identity_lease_until" <= now())
      ORDER BY "identity_next_attempt_at", "requested_at"
      FOR UPDATE SKIP LOCKED
      LIMIT ${options.limit}
    )
    UPDATE "account_deletions" AS deletion
    SET
      "identity_lease_id" = ${options.leaseId},
      "identity_lease_until" = now() + (${options.leaseSeconds} * interval '1 second'),
      "identity_last_attempt_at" = now(),
      "identity_attempt_count" = deletion."identity_attempt_count" + 1,
      "updated_at" = now()
    FROM candidates
    WHERE deletion."user_id" = candidates."user_id"
    RETURNING deletion."user_id", deletion."request_id", deletion."identity_attempt_count"
  `);
  return claimed.rows.map((row) => ({
    userId: row.user_id,
    requestId: row.request_id,
    leaseId: options.leaseId,
    attemptCount: row.identity_attempt_count,
  }));
}

export async function finalizeClaimedAccountDeletionIdentity(
  claim: AccountDeletionIdentityClaim,
): Promise<boolean> {
  const finalizedAt = new Date();
  const affected = await db
    .update(accountDeletionTombstonesTable)
    .set({
      status: "finalized",
      finalizedAt,
      identityLeaseId: null,
      identityLeaseUntil: null,
      updatedAt: finalizedAt,
    })
    .where(
      and(
        eq(accountDeletionTombstonesTable.userId, claim.userId),
        eq(accountDeletionTombstonesTable.status, "identity_pending"),
        eq(accountDeletionTombstonesTable.identityLeaseId, claim.leaseId),
      ),
    )
    .returning({ userId: accountDeletionTombstonesTable.userId });
  return affected.length === 1;
}

export async function rescheduleClaimedAccountDeletionIdentity(
  claim: AccountDeletionIdentityClaim,
  nextAttemptAt: Date,
): Promise<boolean> {
  const affected = await db
    .update(accountDeletionTombstonesTable)
    .set({
      identityNextAttemptAt: nextAttemptAt,
      identityLeaseId: null,
      identityLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountDeletionTombstonesTable.userId, claim.userId),
        eq(accountDeletionTombstonesTable.status, "identity_pending"),
        eq(accountDeletionTombstonesTable.identityLeaseId, claim.leaseId),
      ),
    )
    .returning({ userId: accountDeletionTombstonesTable.userId });
  return affected.length === 1;
}

/** Insert the permanent tombstone and cascade-delete account data atomically. */
export async function tombstoneAndDeleteAccountData(
  userId: string,
  requestId: string,
): Promise<AccountDeletionTombstone> {
  return withAccountLock(userId, async (transaction) => {
    await transaction
      .insert(accountDeletionTombstonesTable)
      .values({ userId, requestId })
      .onConflictDoNothing({ target: accountDeletionTombstonesTable.userId });
    await transaction.delete(usersTable).where(eq(usersTable.id, userId));

    const rows = await transaction
      .select()
      .from(accountDeletionTombstonesTable)
      .where(eq(accountDeletionTombstonesTable.userId, userId))
      .limit(1);
    if (!rows[0])
      throw new Error("Account deletion tombstone was not written.");
    return rows[0];
  });
}

export async function finalizeAccountDeletion(
  userId: string,
): Promise<boolean> {
  return withAccountLock(userId, async (transaction) => {
    const finalizedAt = new Date();
    const affected = await transaction
      .update(accountDeletionTombstonesTable)
      .set({
        status: "finalized",
        finalizedAt,
        identityLeaseId: null,
        identityLeaseUntil: null,
        updatedAt: finalizedAt,
      })
      .where(eq(accountDeletionTombstonesTable.userId, userId))
      .returning({ userId: accountDeletionTombstonesTable.userId });
    return affected.length === 1;
  });
}
