import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  socialProfilesTable,
  friendshipsTable,
  sharedActivitiesTable,
  kudosTable,
  activityCommentsTable,
  challengesTable,
  challengeParticipantsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/aiGate";
import { rateLimit } from "../lib/rateLimit";
import {
  acceptedFriendIds,
  blockedUserIds,
  canViewUser,
  ensureSocialProfile,
  friendshipState,
  generateJoinCode,
  newId,
  normalizePair,
} from "../lib/social";
import {
  COMMUNITY_MINIMUM_AGE,
  COMMUNITY_TERMS_VERSION,
  screenCommunityText,
} from "../lib/communitySafety";
import {
  acceptCommunityAccess,
  hasCurrentCommunityAccess,
} from "../lib/communitySafetyStore";

const router: IRouter = Router();

const VALID_KINDS = new Set([
  "workout",
  "run",
  "achievement",
  "personal_record",
]);
const VALID_METRICS = new Set([
  "workouts",
  "distance_km",
  "active_days",
  "workout_minutes",
]);

function displayNameFor(user: Express.User): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "Athlete";
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, max);
}

function screenForPublish(
  value: unknown,
  max: number,
  res: Response,
): string | undefined {
  const decision = screenCommunityText(clean(value, max));
  if (!decision.allowed) {
    const messages = {
      personal_contact: "Keep personal contact details out of Community posts.",
      external_link: "External links are not allowed in Community posts.",
      threatening_language: "That content cannot be shared in Community.",
    } as const;
    res.status(422).json({
      error: messages[decision.code],
      code: "content_not_allowed",
      reason: decision.code,
    });
    return undefined;
  }
  return decision.text;
}

async function requireCommunityAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!(await hasCurrentCommunityAccess(req.user!.id))) {
      res.status(403).json({
        error: "Accept the Community Standards first",
        code: "community_terms_required",
        termsVersion: COMMUNITY_TERMS_VERSION,
        minimumAge: COMMUNITY_MINIMUM_AGE,
      });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Community access check failed");
    res.status(503).json({
      error: "Could not verify Community access",
      code: "community_access_unavailable",
    });
  }
}

router.get(
  "/social/access",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      res.json({
        accepted: await hasCurrentCommunityAccess(req.user!.id),
        adultOnly: true,
        minimumAge: COMMUNITY_MINIMUM_AGE,
        termsVersion: COMMUNITY_TERMS_VERSION,
      });
    } catch (err) {
      req.log.error({ err }, "Community access status failed");
      res.status(503).json({
        error: "Could not verify Community access",
        code: "community_access_unavailable",
      });
    }
  },
);

router.post(
  "/social/access/accept",
  requireAuth,
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyPrefix: "community-consent",
    message: "Please wait before trying again.",
  }),
  async (req: Request, res: Response) => {
    if (req.body?.adultConfirmed !== true || req.body?.acceptedTerms !== true) {
      res.status(403).json({
        error: `Community is available only to people aged ${COMMUNITY_MINIMUM_AGE} or older who accept the Community Standards.`,
        code: "community_age_restricted",
      });
      return;
    }
    if (req.body?.termsVersion !== COMMUNITY_TERMS_VERSION) {
      res.status(409).json({
        error: "Community Standards have changed. Review the latest version.",
        code: "community_terms_changed",
        termsVersion: COMMUNITY_TERMS_VERSION,
      });
      return;
    }
    try {
      await acceptCommunityAccess(req.user!.id);
      res.status(201).json({
        accepted: true,
        termsVersion: COMMUNITY_TERMS_VERSION,
      });
    } catch (err) {
      req.log.error({ err }, "Community acceptance failed");
      res.status(500).json({
        error: "Could not save Community acceptance",
        code: "community_acceptance_failed",
      });
    }
  },
);

// All remaining Community routes require current, adult, versioned consent.
router.use("/social", requireAuth, requireCommunityAccess);

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get("/social/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const profile = await ensureSocialProfile(
      req.user!.id,
      displayNameFor(req.user!),
    );
    res.json({ profile });
  } catch (err) {
    req.log.error({ err }, "Failed to load social profile");
    res.status(500).json({ error: "Could not load your profile" });
  }
});

router.patch("/social/me", requireAuth, async (req: Request, res: Response) => {
  const { displayName, bio, discoverable, leaderboardOptIn } = req.body ?? {};

  try {
    await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof displayName === "string" && displayName.trim()) {
      const screened = screenForPublish(displayName, 40, res);
      if (screened === undefined) return;
      updates.displayName = screened;
    }
    if (typeof bio === "string") {
      const screened = screenForPublish(bio, 160, res);
      if (screened === undefined) return;
      updates.bio = screened;
    }
    if (typeof discoverable === "boolean") updates.discoverable = discoverable;
    if (typeof leaderboardOptIn === "boolean")
      updates.leaderboardOptIn = leaderboardOptIn;

    const [updated] = await db
      .update(socialProfilesTable)
      .set(updates)
      .where(eq(socialProfilesTable.userId, req.user!.id))
      .returning();

    res.json({ profile: updated });
  } catch (err) {
    req.log.error({ err }, "Failed to update social profile");
    res.status(500).json({ error: "Could not save your profile" });
  }
});

/**
 * Look up a user by friend code.
 *
 * Rate limited hard. Codes are random rather than sequential, but a limiter is
 * what stops someone brute-forcing the code space to enumerate accounts.
 */
router.get(
  "/social/lookup/:code",
  requireAuth,
  rateLimit({
    windowMs: 60_000,
    max: 12,
    keyPrefix: "lookup",
    message: "Too many lookups. Please wait a moment.",
  }),
  async (req: Request, res: Response) => {
    const code = clean(req.params.code, 20).toUpperCase();

    try {
      const [found] = await db
        .select({
          userId: socialProfilesTable.userId,
          displayName: socialProfilesTable.displayName,
          avatarUrl: socialProfilesTable.avatarUrl,
          bio: socialProfilesTable.bio,
          discoverable: socialProfilesTable.discoverable,
        })
        .from(socialProfilesTable)
        .where(eq(socialProfilesTable.friendCode, code));

      // A user who has turned off discoverability reads as "not found", not as
      // "found but hidden" - the latter still confirms they use the app.
      if (!found || !found.discoverable) {
        res
          .status(404)
          .json({ error: "No one found with that code", code: "not_found" });
        return;
      }

      if (found.userId === req.user!.id) {
        res.status(400).json({ error: "That is your own code", code: "self" });
        return;
      }

      const { state } = await friendshipState(req.user!.id, found.userId);

      if (state === "blocked") {
        res
          .status(404)
          .json({ error: "No one found with that code", code: "not_found" });
        return;
      }

      res.json({
        user: {
          userId: found.userId,
          displayName: found.displayName,
          avatarUrl: found.avatarUrl,
          bio: found.bio,
        },
        state,
      });
    } catch (err) {
      req.log.error({ err }, "Friend lookup failed");
      res.status(500).json({ error: "Lookup failed" });
    }
  },
);

// ---------------------------------------------------------------------------
// Friendships
// ---------------------------------------------------------------------------

router.get(
  "/social/friends",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(friendshipsTable)
        .where(
          or(
            eq(friendshipsTable.userAId, req.user!.id),
            eq(friendshipsTable.userBId, req.user!.id),
          ),
        );

      const otherIds = rows.map((r) =>
        r.userAId === req.user!.id ? r.userBId : r.userAId,
      );

      const profiles = otherIds.length
        ? await db
            .select({
              userId: socialProfilesTable.userId,
              displayName: socialProfilesTable.displayName,
              avatarUrl: socialProfilesTable.avatarUrl,
            })
            .from(socialProfilesTable)
            .where(inArray(socialProfilesTable.userId, otherIds))
        : [];

      const byId = new Map(profiles.map((p) => [p.userId, p]));

      const friends: unknown[] = [];
      const incoming: unknown[] = [];
      const outgoing: unknown[] = [];

      for (const row of rows) {
        const otherId =
          row.userAId === req.user!.id ? row.userBId : row.userAId;
        const profile = byId.get(otherId);
        const entry = {
          friendshipId: row.id,
          userId: otherId,
          displayName: profile?.displayName ?? "Athlete",
          avatarUrl: profile?.avatarUrl ?? null,
          since: row.respondedAt ?? row.createdAt,
        };

        if (row.status === "accepted") friends.push(entry);
        else if (row.status === "pending") {
          (row.requestedBy === req.user!.id ? outgoing : incoming).push(entry);
        }
        // Blocked edges are intentionally returned in none of the lists.
      }

      res.json({ friends, incoming, outgoing });
    } catch (err) {
      req.log.error({ err }, "Failed to list friends");
      res.status(500).json({ error: "Could not load your friends" });
    }
  },
);

router.post(
  "/social/friends/request",
  requireAuth,
  rateLimit({
    windowMs: 3_600_000,
    max: 30,
    keyPrefix: "friendreq",
    message: "Too many friend requests. Try again later.",
  }),
  async (req: Request, res: Response) => {
    const targetUserId = clean(req.body?.userId, 64);
    if (!targetUserId) {
      res
        .status(400)
        .json({ error: "userId is required", code: "bad_request" });
      return;
    }
    if (targetUserId === req.user!.id) {
      res.status(400).json({ error: "You cannot add yourself", code: "self" });
      return;
    }

    try {
      const [target] = await db
        .select({ discoverable: socialProfilesTable.discoverable })
        .from(socialProfilesTable)
        .where(eq(socialProfilesTable.userId, targetUserId));

      if (!target || !target.discoverable) {
        res.status(404).json({ error: "No one found", code: "not_found" });
        return;
      }

      const existing = await friendshipState(req.user!.id, targetUserId);

      if (existing.state === "blocked") {
        // Deliberately indistinguishable from "not found": telling someone they
        // have been blocked invites retaliation and reveals a decision the
        // blocker made privately.
        res.status(404).json({ error: "No one found", code: "not_found" });
        return;
      }
      if (existing.state === "friends") {
        res
          .status(409)
          .json({ error: "You are already friends", code: "already_friends" });
        return;
      }
      if (existing.state === "pending_sent") {
        res
          .status(409)
          .json({ error: "Request already sent", code: "already_pending" });
        return;
      }
      if (existing.state === "pending_received") {
        // They asked first. Accept rather than creating a mirrored request.
        await db
          .update(friendshipsTable)
          .set({ status: "accepted", respondedAt: new Date() })
          .where(eq(friendshipsTable.id, existing.id!));
        res.json({ state: "friends", autoAccepted: true });
        return;
      }

      await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));
      const pair = normalizePair(req.user!.id, targetUserId);

      await db.insert(friendshipsTable).values({
        id: newId(),
        ...pair,
        requestedBy: req.user!.id,
        status: "pending",
      });

      res.status(201).json({ state: "pending_sent" });
    } catch (err) {
      req.log.error({ err }, "Friend request failed");
      res.status(500).json({ error: "Could not send that request" });
    }
  },
);

router.post(
  "/social/friends/:id/respond",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const accept = req.body?.accept === true;

    try {
      const [row] = await db
        .select()
        .from(friendshipsTable)
        .where(eq(friendshipsTable.id, id));

      const isParticipant =
        row && (row.userAId === req.user!.id || row.userBId === req.user!.id);

      // Only the ADDRESSEE may respond: without this check the requester could
      // accept their own request.
      if (
        !row ||
        !isParticipant ||
        row.status !== "pending" ||
        row.requestedBy === req.user!.id
      ) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      if (accept) {
        await db
          .update(friendshipsTable)
          .set({ status: "accepted", respondedAt: new Date() })
          .where(eq(friendshipsTable.id, id));
        res.json({ state: "friends" });
        return;
      }

      await db.delete(friendshipsTable).where(eq(friendshipsTable.id, id));
      res.json({ state: "none" });
    } catch (err) {
      req.log.error({ err }, "Friend response failed");
      res.status(500).json({ error: "Could not respond to that request" });
    }
  },
);

router.delete(
  "/social/friends/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const result = await db
        .delete(friendshipsTable)
        .where(
          and(
            eq(friendshipsTable.id, String(req.params.id)),
            or(
              eq(friendshipsTable.userAId, req.user!.id),
              eq(friendshipsTable.userBId, req.user!.id),
            ),
          ),
        )
        .returning({ id: friendshipsTable.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ removed: true });
    } catch (err) {
      req.log.error({ err }, "Unfriend failed");
      res.status(500).json({ error: "Could not remove that friend" });
    }
  },
);

router.post(
  "/social/friends/:userId/block",
  requireAuth,
  async (req: Request, res: Response) => {
    const targetUserId = String(req.params.userId);
    if (targetUserId === req.user!.id) {
      res.status(400).json({ error: "You cannot block yourself" });
      return;
    }

    try {
      const [target] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, targetUserId));
      if (!target) {
        res.status(404).json({ error: "Not found", code: "not_found" });
        return;
      }
      const pair = normalizePair(req.user!.id, targetUserId);

      // Upsert rather than update: a block must work whether or not any prior
      // relationship existed, and must survive the other party re-requesting.
      await db
        .insert(friendshipsTable)
        .values({
          id: newId(),
          ...pair,
          requestedBy: req.user!.id,
          status: "blocked",
          blockedBy: req.user!.id,
          respondedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [friendshipsTable.userAId, friendshipsTable.userBId],
          set: {
            status: "blocked",
            blockedBy: req.user!.id,
            respondedAt: new Date(),
          },
        });

      res.json({ state: "blocked" });
    } catch (err) {
      req.log.error({ err }, "Block failed");
      res.status(500).json({ error: "Could not block that person" });
    }
  },
);

// ---------------------------------------------------------------------------
// Shared activity
// ---------------------------------------------------------------------------

router.post(
  "/social/activities",
  requireAuth,
  async (req: Request, res: Response) => {
    const { kind, title, caption, payload } = req.body ?? {};

    if (!VALID_KINDS.has(kind)) {
      res
        .status(400)
        .json({ error: "Unknown activity kind", code: "bad_request" });
      return;
    }
    if (typeof title !== "string" || !title.trim()) {
      res
        .status(400)
        .json({ error: "A title is required", code: "bad_request" });
      return;
    }
    const screenedTitle = screenForPublish(title, 90, res);
    if (screenedTitle === undefined) return;
    const screenedCaption = screenForPublish(caption, 280, res);
    if (screenedCaption === undefined) return;

    try {
      await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));

      const row = {
        id: newId(),
        userId: req.user!.id,
        kind,
        title: screenedTitle,
        caption: screenedCaption || null,
        // The payload is a snapshot. Editing the source workout later must not
        // rewrite what friends already saw.
        payload: payload && typeof payload === "object" ? payload : {},
        visibility: "friends",
      };

      await db.insert(sharedActivitiesTable).values(row);
      res.status(201).json({ activity: row });
    } catch (err) {
      req.log.error({ err }, "Share failed");
      res.status(500).json({ error: "Could not share that" });
    }
  },
);

router.get("/social/feed", requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

  try {
    const friendIds = await acceptedFriendIds(req.user!.id);
    // Your own posts appear in your feed too, so an empty graph still shows
    // something and sharing has visible effect immediately.
    const visibleIds = [...friendIds, req.user!.id];

    const activities = await db
      .select()
      .from(sharedActivitiesTable)
      .where(inArray(sharedActivitiesTable.userId, visibleIds))
      .orderBy(desc(sharedActivitiesTable.createdAt))
      .limit(limit);

    if (activities.length === 0) {
      res.json({ feed: [] });
      return;
    }

    const authorIds = [...new Set(activities.map((a) => a.userId))];
    const [profiles, myKudos] = await Promise.all([
      db
        .select({
          userId: socialProfilesTable.userId,
          displayName: socialProfilesTable.displayName,
          avatarUrl: socialProfilesTable.avatarUrl,
        })
        .from(socialProfilesTable)
        .where(inArray(socialProfilesTable.userId, authorIds)),
      db
        .select({ activityId: kudosTable.activityId })
        .from(kudosTable)
        .where(
          and(
            eq(kudosTable.userId, req.user!.id),
            inArray(
              kudosTable.activityId,
              activities.map((a) => a.id),
            ),
          ),
        ),
    ]);

    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const kudosed = new Set(myKudos.map((k) => k.activityId));

    res.json({
      feed: activities.map((activity) => ({
        ...activity,
        author: {
          userId: activity.userId,
          displayName: byId.get(activity.userId)?.displayName ?? "Athlete",
          avatarUrl: byId.get(activity.userId)?.avatarUrl ?? null,
          isSelf: activity.userId === req.user!.id,
        },
        hasKudos: kudosed.has(activity.id),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Feed failed");
    res.status(500).json({ error: "Could not load your feed" });
  }
});

router.delete(
  "/social/activities/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const result = await db
        .delete(sharedActivitiesTable)
        .where(
          and(
            eq(sharedActivitiesTable.id, String(req.params.id)),
            eq(sharedActivitiesTable.userId, req.user!.id),
          ),
        )
        .returning({ id: sharedActivitiesTable.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      req.log.error({ err }, "Delete activity failed");
      res.status(500).json({ error: "Could not delete that post" });
    }
  },
);

/** Toggle kudos. Idempotent per user, enforced by the unique index. */
router.post(
  "/social/activities/:id/kudos",
  requireAuth,
  async (req: Request, res: Response) => {
    const activityId = String(req.params.id);

    try {
      const [activity] = await db
        .select({ userId: sharedActivitiesTable.userId })
        .from(sharedActivitiesTable)
        .where(eq(sharedActivitiesTable.id, activityId));

      if (!activity || !(await canViewUser(req.user!.id, activity.userId))) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [existing] = await db
        .select({ id: kudosTable.id })
        .from(kudosTable)
        .where(
          and(
            eq(kudosTable.activityId, activityId),
            eq(kudosTable.userId, req.user!.id),
          ),
        );

      if (existing) {
        await db.delete(kudosTable).where(eq(kudosTable.id, existing.id));
      } else {
        await db
          .insert(kudosTable)
          .values({ id: newId(), activityId, userId: req.user!.id })
          .onConflictDoNothing();
      }

      // Recount from the rows rather than incrementing: a denormalised counter
      // drifts the moment any path forgets to decrement.
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(kudosTable)
        .where(eq(kudosTable.activityId, activityId));

      await db
        .update(sharedActivitiesTable)
        .set({ kudosCount: count })
        .where(eq(sharedActivitiesTable.id, activityId));

      res.json({ hasKudos: !existing, kudosCount: count });
    } catch (err) {
      req.log.error({ err }, "Kudos failed");
      res.status(500).json({ error: "Could not do that" });
    }
  },
);

router.get(
  "/social/activities/:id/comments",
  requireAuth,
  async (req: Request, res: Response) => {
    const activityId = String(req.params.id);

    try {
      const [activity] = await db
        .select({ userId: sharedActivitiesTable.userId })
        .from(sharedActivitiesTable)
        .where(eq(sharedActivitiesTable.id, activityId));

      if (!activity || !(await canViewUser(req.user!.id, activity.userId))) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const comments = await db
        .select()
        .from(activityCommentsTable)
        .where(
          and(
            eq(activityCommentsTable.activityId, activityId),
            isNull(activityCommentsTable.deletedAt),
          ),
        )
        .orderBy(activityCommentsTable.createdAt);

      const blockedAuthors = new Set(await blockedUserIds(req.user!.id));
      const visibleComments = comments.filter(
        (comment) => !blockedAuthors.has(comment.userId),
      );

      const authorIds = [...new Set(visibleComments.map((c) => c.userId))];
      const profiles = authorIds.length
        ? await db
            .select({
              userId: socialProfilesTable.userId,
              displayName: socialProfilesTable.displayName,
              avatarUrl: socialProfilesTable.avatarUrl,
            })
            .from(socialProfilesTable)
            .where(inArray(socialProfilesTable.userId, authorIds))
        : [];

      const byId = new Map(profiles.map((p) => [p.userId, p]));

      res.json({
        comments: visibleComments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt,
          author: {
            userId: c.userId,
            displayName: byId.get(c.userId)?.displayName ?? "Athlete",
            avatarUrl: byId.get(c.userId)?.avatarUrl ?? null,
            isSelf: c.userId === req.user!.id,
          },
        })),
      });
    } catch (err) {
      req.log.error({ err }, "Comments failed");
      res.status(500).json({ error: "Could not load comments" });
    }
  },
);

router.post(
  "/social/activities/:id/comments",
  requireAuth,
  rateLimit({
    windowMs: 60_000,
    max: 15,
    keyPrefix: "comment",
    message: "You are commenting very quickly. Please slow down.",
  }),
  async (req: Request, res: Response) => {
    const activityId = String(req.params.id);
    const body = clean(req.body?.body, 500);

    if (!body) {
      res
        .status(400)
        .json({ error: "Say something first", code: "bad_request" });
      return;
    }
    const screenedBody = screenForPublish(body, 500, res);
    if (screenedBody === undefined) return;

    try {
      const [activity] = await db
        .select({ userId: sharedActivitiesTable.userId })
        .from(sharedActivitiesTable)
        .where(eq(sharedActivitiesTable.id, activityId));

      if (!activity || !(await canViewUser(req.user!.id, activity.userId))) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));

      const comment = {
        id: newId(),
        activityId,
        userId: req.user!.id,
        body: screenedBody,
      };
      await db.insert(activityCommentsTable).values(comment);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(activityCommentsTable)
        .where(
          and(
            eq(activityCommentsTable.activityId, activityId),
            isNull(activityCommentsTable.deletedAt),
          ),
        );

      await db
        .update(sharedActivitiesTable)
        .set({ commentCount: count })
        .where(eq(sharedActivitiesTable.id, activityId));

      res.status(201).json({ comment, commentCount: count });
    } catch (err) {
      req.log.error({ err }, "Comment failed");
      res.status(500).json({ error: "Could not post that comment" });
    }
  },
);

/**
 * Delete a comment.
 *
 * Permitted for the comment's author OR the owner of the post, so someone can
 * always remove unwanted content from their own activity.
 */
router.delete(
  "/social/comments/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const commentId = String(req.params.id);

    try {
      const [comment] = await db
        .select()
        .from(activityCommentsTable)
        .where(eq(activityCommentsTable.id, commentId));

      if (!comment) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [activity] = await db
        .select({ userId: sharedActivitiesTable.userId })
        .from(sharedActivitiesTable)
        .where(eq(sharedActivitiesTable.id, comment.activityId));

      const canDelete =
        comment.userId === req.user!.id || activity?.userId === req.user!.id;

      if (!canDelete) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Soft delete so counts and any future threading stay coherent.
      await db
        .update(activityCommentsTable)
        .set({ deletedAt: new Date() })
        .where(eq(activityCommentsTable.id, commentId));

      res.json({ deleted: true });
    } catch (err) {
      req.log.error({ err }, "Comment delete failed");
      res.status(500).json({ error: "Could not delete that comment" });
    }
  },
);

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * Friends-only leaderboard, double opt-in.
 *
 * A friend appears only if THEY enabled leaderboardOptIn. Being someone's
 * friend is not consent to have your training volume ranked against theirs.
 */
router.get(
  "/social/leaderboard",
  requireAuth,
  async (req: Request, res: Response) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 86_400_000);

    try {
      const friendIds = await acceptedFriendIds(req.user!.id);
      const candidateIds = [...friendIds, req.user!.id];

      const optedIn = await db
        .select({
          userId: socialProfilesTable.userId,
          displayName: socialProfilesTable.displayName,
          avatarUrl: socialProfilesTable.avatarUrl,
        })
        .from(socialProfilesTable)
        .where(
          and(
            inArray(socialProfilesTable.userId, candidateIds),
            eq(socialProfilesTable.leaderboardOptIn, true),
          ),
        );

      if (optedIn.length === 0) {
        res.json({ leaderboard: [], optedIn: false });
        return;
      }

      // Ranked on shared activity, which is the only training data anyone has
      // consented to expose. Private workouts are never counted.
      const counts = await db
        .select({
          userId: sharedActivitiesTable.userId,
          activities: sql<number>`COUNT(*)::int`,
        })
        .from(sharedActivitiesTable)
        .where(
          and(
            inArray(
              sharedActivitiesTable.userId,
              optedIn.map((p) => p.userId),
            ),
            gte(sharedActivitiesTable.createdAt, since),
          ),
        )
        .groupBy(sharedActivitiesTable.userId);

      const byId = new Map(counts.map((c) => [c.userId, c.activities]));

      const leaderboard = optedIn
        .map((p) => ({
          userId: p.userId,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          activities: byId.get(p.userId) ?? 0,
          isSelf: p.userId === req.user!.id,
        }))
        .sort((a, b) => b.activities - a.activities);

      const me = optedIn.some((p) => p.userId === req.user!.id);
      res.json({ leaderboard, optedIn: me, days });
    } catch (err) {
      req.log.error({ err }, "Leaderboard failed");
      res.status(500).json({ error: "Could not load the leaderboard" });
    }
  },
);

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

router.post(
  "/social/challenges",
  requireAuth,
  async (req: Request, res: Response) => {
    const { name, description, metric, target, days } = req.body ?? {};

    if (!VALID_METRICS.has(metric)) {
      res
        .status(400)
        .json({ error: "Unknown challenge metric", code: "bad_request" });
      return;
    }
    if (typeof name !== "string" || !name.trim()) {
      res
        .status(400)
        .json({ error: "A name is required", code: "bad_request" });
      return;
    }
    const screenedName = screenForPublish(name, 60, res);
    if (screenedName === undefined) return;
    const screenedDescription = screenForPublish(description, 200, res);
    if (screenedDescription === undefined) return;

    const durationDays = Math.min(90, Math.max(1, Number(days) || 7));
    const numericTarget = Math.min(10_000, Math.max(1, Number(target) || 3));

    try {
      await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));

      const challenge = {
        id: newId(),
        createdBy: req.user!.id,
        name: screenedName,
        description: screenedDescription || null,
        metric,
        target: numericTarget,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + durationDays * 86_400_000),
        joinCode: generateJoinCode(),
      };

      await db.insert(challengesTable).values(challenge);

      // The creator joins their own challenge; a challenge with no participants
      // is a confusing empty state nobody intends to create.
      await db.insert(challengeParticipantsTable).values({
        id: newId(),
        challengeId: challenge.id,
        userId: req.user!.id,
        progress: 0,
      });

      res.status(201).json({ challenge });
    } catch (err) {
      req.log.error({ err }, "Create challenge failed");
      res.status(500).json({ error: "Could not create that challenge" });
    }
  },
);

router.post(
  "/social/challenges/join",
  requireAuth,
  async (req: Request, res: Response) => {
    const joinCode = clean(req.body?.joinCode, 12).toUpperCase();

    try {
      const [challenge] = await db
        .select()
        .from(challengesTable)
        .where(eq(challengesTable.joinCode, joinCode));

      if (!challenge) {
        res
          .status(404)
          .json({ error: "No challenge with that code", code: "not_found" });
        return;
      }
      if (challenge.endsAt.getTime() < Date.now()) {
        res.status(410).json({
          error: "That challenge has already finished",
          code: "ended",
        });
        return;
      }

      await ensureSocialProfile(req.user!.id, displayNameFor(req.user!));

      await db
        .insert(challengeParticipantsTable)
        .values({
          id: newId(),
          challengeId: challenge.id,
          userId: req.user!.id,
          progress: 0,
        })
        .onConflictDoNothing();

      res.json({ challenge });
    } catch (err) {
      req.log.error({ err }, "Join challenge failed");
      res.status(500).json({ error: "Could not join that challenge" });
    }
  },
);

router.get(
  "/social/challenges",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const mine = await db
        .select({ challengeId: challengeParticipantsTable.challengeId })
        .from(challengeParticipantsTable)
        .where(eq(challengeParticipantsTable.userId, req.user!.id));

      if (mine.length === 0) {
        res.json({ challenges: [] });
        return;
      }

      const ids = mine.map((m) => m.challengeId);

      const [challenges, participants] = await Promise.all([
        db
          .select()
          .from(challengesTable)
          .where(inArray(challengesTable.id, ids)),
        db
          .select()
          .from(challengeParticipantsTable)
          .where(inArray(challengeParticipantsTable.challengeId, ids)),
      ]);

      const blockedParticipants = new Set(await blockedUserIds(req.user!.id));
      const visibleChallenges = challenges.filter(
        (challenge) => !blockedParticipants.has(challenge.createdBy),
      );
      const visibleChallengeIds = new Set(
        visibleChallenges.map((challenge) => challenge.id),
      );
      const visibleParticipants = participants.filter(
        (participant) =>
          visibleChallengeIds.has(participant.challengeId) &&
          !blockedParticipants.has(participant.userId),
      );
      const participantIds = [
        ...new Set(
          visibleParticipants.map((participant) => participant.userId),
        ),
      ];
      const profiles = await db
        .select({
          userId: socialProfilesTable.userId,
          displayName: socialProfilesTable.displayName,
          avatarUrl: socialProfilesTable.avatarUrl,
        })
        .from(socialProfilesTable)
        .where(inArray(socialProfilesTable.userId, participantIds));

      const nameById = new Map(profiles.map((p) => [p.userId, p]));

      res.json({
        challenges: visibleChallenges
          .map((challenge) => ({
            ...challenge,
            active: challenge.endsAt.getTime() >= Date.now(),
            participants: visibleParticipants
              .filter((p) => p.challengeId === challenge.id)
              .map((p) => ({
                userId: p.userId,
                displayName: nameById.get(p.userId)?.displayName ?? "Athlete",
                avatarUrl: nameById.get(p.userId)?.avatarUrl ?? null,
                progress: p.progress,
                isSelf: p.userId === req.user!.id,
              }))
              .sort((a, b) => b.progress - a.progress),
          }))
          .sort(
            (a, b) =>
              Number(b.active) - Number(a.active) ||
              b.endsAt.getTime() - a.endsAt.getTime(),
          ),
      });
    } catch (err) {
      req.log.error({ err }, "List challenges failed");
      res.status(500).json({ error: "Could not load your challenges" });
    }
  },
);

router.post(
  "/social/challenges/:id/progress",
  requireAuth,
  async (req: Request, res: Response) => {
    const challengeId = String(req.params.id);
    const progress = Math.min(
      100_000,
      Math.max(0, Number(req.body?.progress) || 0),
    );

    try {
      const [challenge] = await db
        .select({ endsAt: challengesTable.endsAt })
        .from(challengesTable)
        .where(eq(challengesTable.id, challengeId));

      if (!challenge) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (challenge.endsAt.getTime() < Date.now()) {
        res
          .status(410)
          .json({ error: "That challenge has finished", code: "ended" });
        return;
      }

      const result = await db
        .update(challengeParticipantsTable)
        .set({ progress, updatedAt: new Date() })
        .where(
          and(
            eq(challengeParticipantsTable.challengeId, challengeId),
            eq(challengeParticipantsTable.userId, req.user!.id),
          ),
        )
        .returning({ id: challengeParticipantsTable.id });

      if (result.length === 0) {
        res.status(404).json({ error: "You have not joined that challenge" });
        return;
      }

      res.json({ progress });
    } catch (err) {
      req.log.error({ err }, "Challenge progress failed");
      res.status(500).json({ error: "Could not update your progress" });
    }
  },
);

export default router;
