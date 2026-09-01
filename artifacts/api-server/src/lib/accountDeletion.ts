import {
  accountDeletionTombstonesTable,
  db,
  usersTable,
  type AccountDeletionTombstone,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const ACCOUNT_DELETION_LOCK_SEED = 2_026_090_101;

export interface ProvisionedAuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

async function lockAccount(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
): Promise<void> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, ${ACCOUNT_DELETION_LOCK_SEED}))`,
  );
}

/**
 * The check and upsert share the same per-UID transaction lock as deletion.
 * This closes the snapshot race where an auth request could otherwise recreate
 * users after a concurrent tombstone transaction commits.
 */
export async function provisionAuthenticatedUserIfActive(
  user: ProvisionedAuthUser,
): Promise<"active" | "deleted"> {
  return db.transaction(async (transaction) => {
    await lockAccount(transaction, user.id);
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

/** Insert the permanent tombstone and cascade-delete account data atomically. */
export async function tombstoneAndDeleteAccountData(
  userId: string,
  requestId: string,
): Promise<AccountDeletionTombstone> {
  return db.transaction(async (transaction) => {
    await lockAccount(transaction, userId);
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
  return db.transaction(async (transaction) => {
    await lockAccount(transaction, userId);
    const finalizedAt = new Date();
    const affected = await transaction
      .update(accountDeletionTombstonesTable)
      .set({
        status: "finalized",
        finalizedAt,
        updatedAt: finalizedAt,
      })
      .where(eq(accountDeletionTombstonesTable.userId, userId))
      .returning({ userId: accountDeletionTombstonesTable.userId });
    return affected.length === 1;
  });
}
