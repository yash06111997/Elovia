import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db, friendshipsTable, socialProfilesTable } from "@workspace/db";

/**
 * Social graph helpers.
 *
 * The friendship table stores ONE row per pair with ids normalised so the
 * lexicographically smaller id is always userAId. Every read and write goes
 * through these helpers, because doing the normalisation ad hoc at call sites
 * is how you end up with A→B and B→A both existing as separate pending
 * requests.
 */

export interface NormalizedPair {
  userAId: string;
  userBId: string;
}

export function normalizePair(one: string, two: string): NormalizedPair {
  return one < two ? { userAId: one, userBId: two } : { userAId: two, userBId: one };
}

/**
 * Generate a friend code.
 *
 * Deliberately excludes 0/O/1/I/L to avoid transcription errors when someone
 * reads a code aloud, and is random rather than sequential so the user base
 * cannot be enumerated by counting upward.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateFriendCode(prefix = "ELV"): string {
  const bytes = randomBytes(6);
  let body = "";
  for (const byte of bytes) {
    body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

/** Ensure the caller has a social profile, creating one on first use. */
export async function ensureSocialProfile(
  userId: string,
  fallbackName: string,
): Promise<typeof socialProfilesTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(socialProfilesTable)
    .where(eq(socialProfilesTable.userId, userId));

  if (existing) return existing;

  // Retry on the (vanishingly unlikely) code collision rather than failing the
  // request; the unique index is the authority, not a pre-check.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [created] = await db
        .insert(socialProfilesTable)
        .values({
          userId,
          displayName: fallbackName.slice(0, 40) || "Athlete",
          friendCode: generateFriendCode(),
        })
        .returning();

      if (created) return created;
    } catch {
      if (attempt === 4) throw new Error("Could not allocate a friend code");
    }
  }

  throw new Error("Could not create social profile");
}

export type FriendshipState = "none" | "pending_sent" | "pending_received" | "friends" | "blocked";

/** What is the relationship between the caller and another user? */
export async function friendshipState(
  callerId: string,
  otherId: string,
): Promise<{ state: FriendshipState; id: string | null }> {
  if (callerId === otherId) return { state: "none", id: null };

  const pair = normalizePair(callerId, otherId);
  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.userAId, pair.userAId),
        eq(friendshipsTable.userBId, pair.userBId),
      ),
    );

  if (!row) return { state: "none", id: null };

  if (row.status === "blocked") return { state: "blocked", id: row.id };
  if (row.status === "accepted") return { state: "friends", id: row.id };

  return {
    state: row.requestedBy === callerId ? "pending_sent" : "pending_received",
    id: row.id,
  };
}

/** Every accepted friend's user id. */
export async function acceptedFriendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: friendshipsTable.userAId, b: friendshipsTable.userBId })
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.status, "accepted"),
        or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)),
      ),
    );

  return rows.map((r) => (r.a === userId ? r.b : r.a));
}

/**
 * Can the caller see this user's shared content?
 *
 * True only for the user themselves, or an accepted friend. There is no public
 * tier anywhere in this feature - the content is health data.
 */
export async function canViewUser(callerId: string, targetId: string): Promise<boolean> {
  if (callerId === targetId) return true;
  const { state } = await friendshipState(callerId, targetId);
  return state === "friends";
}

export function newId(): string {
  return randomUUID();
}

/** Join codes are shorter than friend codes; challenges are lower stakes. */
export function generateJoinCode(): string {
  const bytes = randomBytes(5);
  let body = "";
  for (const byte of bytes) body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return body;
}

/**
 * Rebuild a shared activity's counters from the rows themselves.
 *
 * Denormalised counts drift the moment any path forgets to decrement - an
 * un-kudos, a deleted comment, a cascading user deletion. Recomputing from the
 * source is cheap at this scale and cannot drift.
 */
export async function recountActivity(
  activityId: string,
  tables: {
    sharedActivitiesTable: any;
    kudosTable: any;
    activityCommentsTable: any;
  },
): Promise<void> {
  const { sharedActivitiesTable, kudosTable, activityCommentsTable } = tables;

  await db
    .update(sharedActivitiesTable)
    .set({
      kudosCount: sql`(SELECT COUNT(*)::int FROM ${kudosTable} WHERE ${kudosTable.activityId} = ${activityId})`,
      commentCount: sql`(SELECT COUNT(*)::int FROM ${activityCommentsTable} WHERE ${activityCommentsTable.activityId} = ${activityId} AND ${activityCommentsTable.deletedAt} IS NULL)`,
    })
    .where(eq(sharedActivitiesTable.id, activityId));
}
