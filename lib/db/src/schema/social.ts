import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Social graph and shared activity.
 *
 * Privacy shapes every decision in this file, because the underlying data is
 * health data:
 *
 *  - Users are found by a short FRIEND CODE, never by email or fuzzy name
 *    search. An endpoint that resolves an email to an account lets anyone test
 *    whether a given person uses the app, which for a fitness app is a real
 *    disclosure.
 *  - Nothing is shared automatically. A workout reaches the feed only when the
 *    user explicitly shares that specific activity.
 *  - Shared activities store a SNAPSHOT, not a reference. Editing or deleting
 *    the original later must not silently rewrite what friends already saw.
 */

export const socialProfilesTable = pgTable(
  "social_profiles",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Name shown to friends. Distinct from the account's real name. */
    displayName: varchar("display_name").notNull(),

    /**
     * Short, shareable, non-sequential code (e.g. "ELV-7K2Q9M"). Non-sequential
     * matters: a counter would let anyone walk the whole user base.
     */
    friendCode: varchar("friend_code").notNull(),

    avatarUrl: varchar("avatar_url"),
    bio: varchar("bio"),

    /** Master switch. Off means invisible: no lookups, no feed, no leaderboard. */
    discoverable: boolean("discoverable").notNull().default(true),
    /** Appear in friends-only leaderboards. */
    leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("UQ_social_profiles_friend_code").on(table.friendCode),
    index("IDX_social_profiles_discoverable").on(table.discoverable),
  ],
);

export type SocialProfile = typeof socialProfilesTable.$inferSelect;
export type InsertSocialProfile = typeof socialProfilesTable.$inferInsert;

/**
 * Friendship edges.
 *
 * Stored as a single directed row from requester to addressee, with the pair
 * normalised so the lower id is always `userAId`. That normalisation is what
 * makes the unique index able to prevent A→B and B→A existing as two separate
 * "pending" requests, which is otherwise a very common duplicate-request bug.
 */
export const friendshipsTable = pgTable(
  "friendships",
  {
    id: varchar("id").primaryKey(),

    /** Lexicographically smaller user id of the pair. */
    userAId: varchar("user_a_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Lexicographically larger user id of the pair. */
    userBId: varchar("user_b_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Who actually sent the request; needed to render "accept" vs "pending". */
    requestedBy: varchar("requested_by").notNull(),

    /** pending | accepted | blocked */
    status: varchar("status").notNull().default("pending"),

    /**
     * Who blocked, when status is blocked. A block must survive the other party
     * deleting and re-sending, so it is a state on the edge rather than a
     * deletion of it.
     */
    blockedBy: varchar("blocked_by"),

    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("UQ_friendships_pair").on(table.userAId, table.userBId),
    index("IDX_friendships_user_a").on(table.userAId, table.status),
    index("IDX_friendships_user_b").on(table.userBId, table.status),
  ],
);

export type Friendship = typeof friendshipsTable.$inferSelect;
export type InsertFriendship = typeof friendshipsTable.$inferInsert;

/**
 * A deliberately shared activity.
 *
 * The payload is a snapshot taken at share time. Storing a foreign key to the
 * live workout instead would mean a later edit silently rewrites history in
 * everyone's feed, and a later delete blanks a post friends already reacted to.
 */
export const sharedActivitiesTable = pgTable(
  "shared_activities",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** workout | run | achievement | personal_record */
    kind: varchar("kind").notNull(),

    title: varchar("title").notNull(),
    caption: varchar("caption"),

    /** Snapshot: distance, duration, exercises, etc. Never a live reference. */
    payload: jsonb("payload").notNull(),

    /** friends | private. No public tier: this is health data. */
    visibility: varchar("visibility").notNull().default("friends"),

    kudosCount: integer("kudos_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("IDX_shared_activities_user").on(table.userId, table.createdAt),
    index("IDX_shared_activities_created").on(table.createdAt),
  ],
);

export type SharedActivity = typeof sharedActivitiesTable.$inferSelect;
export type InsertSharedActivity = typeof sharedActivitiesTable.$inferInsert;

/** One kudos per person per activity, enforced by the unique index. */
export const kudosTable = pgTable(
  "kudos",
  {
    id: varchar("id").primaryKey(),
    activityId: varchar("activity_id")
      .notNull()
      .references(() => sharedActivitiesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("UQ_kudos_activity_user").on(table.activityId, table.userId),
    index("IDX_kudos_activity").on(table.activityId),
  ],
);

export type Kudos = typeof kudosTable.$inferSelect;

export const activityCommentsTable = pgTable(
  "activity_comments",
  {
    id: varchar("id").primaryKey(),
    activityId: varchar("activity_id")
      .notNull()
      .references(() => sharedActivitiesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    body: varchar("body").notNull(),

    /** Soft delete, so a removed comment does not orphan replies or counts. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_comments_activity").on(table.activityId, table.createdAt)],
);

export type ActivityComment = typeof activityCommentsTable.$inferSelect;

/**
 * Group challenges.
 *
 * Metrics are deliberately limited to workouts, distance and active days -
 * things you accumulate by DOING more. There is no weight-loss or
 * calorie-deficit challenge: a competitive leaderboard ranked on eating less
 * is an obvious pathway to disordered eating, and not something to ship.
 */
export const challengesTable = pgTable(
  "challenges",
  {
    id: varchar("id").primaryKey(),
    createdBy: varchar("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    name: varchar("name").notNull(),
    description: varchar("description"),

    /** workouts | distance_km | active_days | workout_minutes */
    metric: varchar("metric").notNull(),
    target: integer("target").notNull(),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),

    /** Short code friends use to join, same non-enumerable reasoning as above. */
    joinCode: varchar("join_code").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("UQ_challenges_join_code").on(table.joinCode),
    index("IDX_challenges_ends").on(table.endsAt),
  ],
);

export type Challenge = typeof challengesTable.$inferSelect;

export const challengeParticipantsTable = pgTable(
  "challenge_participants",
  {
    id: varchar("id").primaryKey(),
    challengeId: varchar("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Client-reported progress, recomputed server-side on each submission. */
    progress: integer("progress").notNull().default(0),

    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("UQ_challenge_participant").on(table.challengeId, table.userId),
    index("IDX_challenge_participants_challenge").on(table.challengeId, table.progress),
  ],
);

export type ChallengeParticipant = typeof challengeParticipantsTable.$inferSelect;
