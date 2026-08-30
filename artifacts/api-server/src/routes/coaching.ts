import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import {
  db,
  coachProfilesTable,
  coachAvailabilityTable,
  coachingSessionsTable,
  socialProfilesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/aiGate";
import { rateLimit } from "../lib/rateLimit";
import { resolveEntitlement } from "../lib/entitlements";
import { generateSlots, cancellationWindow, buildIcs } from "../lib/scheduling";
import { signLinkToken, verifyLinkToken } from "../lib/signedLinks";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

const INTRO_DURATION_MINS = 15;

/** Postgres unique-violation. Used to turn a race into a clean 409. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * The coach clients book with.
 *
 * Single-coach for now: the first accepting coach wins. When there are several,
 * this becomes an explicit assignment on the client's record rather than a
 * lookup, but that is a product decision that does not exist yet.
 */
async function resolveCoach() {
  const [coach] = await db
    .select()
    .from(coachProfilesTable)
    .where(eq(coachProfilesTable.acceptingClients, true))
    .limit(1);

  return coach ?? null;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Bookable slots, as absolute instants.
 *
 * Intentionally returns ISO instants and never a wall-clock string: the client
 * renders them in the device's own timezone. Sending "09:00" would be correct
 * only for whoever happened to share the coach's zone.
 */
router.get("/coaching/slots", requireAuth, async (req: Request, res: Response) => {
  try {
    const coach = await resolveCoach();
    if (!coach) {
      res.json({ slots: [], acceptingClients: false, reason: "No coach is available right now." });
      return;
    }

    const [rules, booked] = await Promise.all([
      db
        .select()
        .from(coachAvailabilityTable)
        .where(
          and(
            eq(coachAvailabilityTable.coachUserId, coach.userId),
            eq(coachAvailabilityTable.active, true),
          ),
        ),
      db
        .select({ startsAt: coachingSessionsTable.startsAt })
        .from(coachingSessionsTable)
        .where(
          and(
            eq(coachingSessionsTable.coachUserId, coach.userId),
            eq(coachingSessionsTable.status, "booked"),
            gte(coachingSessionsTable.startsAt, new Date()),
          ),
        ),
    ]);

    const slots = generateSlots({
      rules: rules.map((r) => ({
        weekday: r.weekday,
        startMinute: r.startMinute,
        durationMins: r.durationMins,
        timezone: r.timezone,
      })),
      bookedInstants: booked.map((b) => b.startsAt),
      horizonDays: coach.bookingHorizonDays,
    });

    res.json({
      slots,
      acceptingClients: true,
      coachName: coach.displayName,
      cancellationNoticeHours: coach.cancellationNoticeHours,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list slots");
    res.status(500).json({ error: "Could not load available times" });
  }
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

router.post(
  "/coaching/sessions",
  requireAuth,
  rateLimit({ windowMs: 3_600_000, max: 10, keyPrefix: "booking", message: "Too many booking attempts. Please wait." }),
  async (req: Request, res: Response) => {
    const { startsAt, kind, note } = req.body ?? {};

    const when = new Date(startsAt);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "A valid start time is required", code: "bad_request" });
      return;
    }
    if (when.getTime() < Date.now()) {
      res.status(400).json({ error: "That time has already passed", code: "in_past" });
      return;
    }

    const sessionKind = kind === "intro" ? "intro" : "coaching";

    try {
      const coach = await resolveCoach();
      if (!coach) {
        res.status(503).json({ error: "No coach is available right now", code: "no_coach" });
        return;
      }

      // Intro calls are free and open to anyone; paid sessions require the
      // coaching entitlement. Checking here rather than in the gate keeps the
      // free intro genuinely free.
      if (sessionKind === "coaching") {
        const entitlement = await resolveEntitlement(req.user!.id);
        if (!entitlement.hasCoaching) {
          res.status(402).json({
            error: "Coaching sessions need an active coaching plan. Book a free intro call first.",
            code: "coaching_required",
          });
          return;
        }
      } else {
        // One intro per person. Without this the free call becomes free
        // coaching for anyone willing to rebook.
        const [existingIntro] = await db
          .select({ id: coachingSessionsTable.id })
          .from(coachingSessionsTable)
          .where(
            and(
              eq(coachingSessionsTable.clientUserId, req.user!.id),
              eq(coachingSessionsTable.kind, "intro"),
              ne(coachingSessionsTable.status, "cancelled_by_client"),
            ),
          );

        if (existingIntro) {
          res.status(409).json({
            error: "You have already had an intro call.",
            code: "intro_used",
          });
          return;
        }
      }

      const session = {
        id: randomUUID(),
        coachUserId: coach.userId,
        clientUserId: req.user!.id,
        startsAt: when,
        durationMins: sessionKind === "intro" ? INTRO_DURATION_MINS : 45,
        status: "booked",
        kind: sessionKind,
        meetingUrl: coach.defaultMeetingUrl,
        clientNote: typeof note === "string" ? note.slice(0, 500) : null,
      };

      try {
        await db.insert(coachingSessionsTable).values(session);
      } catch (err) {
        // The unique index on (coach, startsAt) is what actually prevents
        // double-booking. Two clients tapping the same slot at once both pass
        // any application-level check; only the database can arbitrate.
        if (isUniqueViolation(err)) {
          res.status(409).json({
            error: "Someone just took that time. Please pick another.",
            code: "slot_taken",
          });
          return;
        }
        throw err;
      }

      // Best-effort: a failed notification must not fail the booking.
      void sendPushToUser(coach.userId, {
        title: "New session booked",
        body: `${sessionKind === "intro" ? "Intro call" : "Session"} on ${when.toUTCString()}`,
        data: { kind: "coaching_booked", sessionId: session.id },
      });

      res.status(201).json({ session });
    } catch (err) {
      req.log.error({ err }, "Booking failed");
      res.status(500).json({ error: "Could not book that session" });
    }
  },
);

/** The caller's own sessions, upcoming first. */
router.get("/coaching/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(coachingSessionsTable)
      .where(eq(coachingSessionsTable.clientUserId, req.user!.id))
      .orderBy(asc(coachingSessionsTable.startsAt));

    const coachIds = [...new Set(rows.map((r) => r.coachUserId))];
    const coaches = coachIds.length
      ? await db
          .select({
            userId: coachProfilesTable.userId,
            displayName: coachProfilesTable.displayName,
            cancellationNoticeHours: coachProfilesTable.cancellationNoticeHours,
          })
          .from(coachProfilesTable)
          .where(inArray(coachProfilesTable.userId, coachIds))
      : [];

    const byId = new Map(coaches.map((c) => [c.userId, c]));
    const now = Date.now();

    res.json({
      sessions: rows.map((row) => {
        const coach = byId.get(row.coachUserId);
        const window = cancellationWindow(
          row.startsAt,
          coach?.cancellationNoticeHours ?? 24,
        );

        return {
          id: row.id,
          startsAt: row.startsAt.toISOString(),
          durationMins: row.durationMins,
          status: row.status,
          kind: row.kind,
          meetingUrl: row.meetingUrl,
          clientNote: row.clientNote,
          coachNote: row.coachNote,
          coachName: coach?.displayName ?? "Your coach",
          isPast: row.startsAt.getTime() < now,
          canCancel: row.status === "booked" && window.allowed,
          cancelBlockedReason: window.allowed ? null : window.reason ?? null,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list sessions");
    res.status(500).json({ error: "Could not load your sessions" });
  }
});

router.post("/coaching/sessions/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const [session] = await db
      .select()
      .from(coachingSessionsTable)
      .where(
        and(
          eq(coachingSessionsTable.id, id),
          eq(coachingSessionsTable.clientUserId, req.user!.id),
        ),
      );

    if (!session || session.status !== "booked") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [coach] = await db
      .select({ cancellationNoticeHours: coachProfilesTable.cancellationNoticeHours })
      .from(coachProfilesTable)
      .where(eq(coachProfilesTable.userId, session.coachUserId));

    const window = cancellationWindow(session.startsAt, coach?.cancellationNoticeHours ?? 24);
    if (!window.allowed) {
      res.status(409).json({ error: window.reason, code: "too_late" });
      return;
    }

    await db
      .update(coachingSessionsTable)
      .set({
        status: "cancelled_by_client",
        cancelledAt: new Date(),
        cancelledReason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 300) : null,
      })
      .where(eq(coachingSessionsTable.id, id));

    void sendPushToUser(session.coachUserId, {
      title: "Session cancelled",
      body: `A session on ${session.startsAt.toUTCString()} was cancelled.`,
      data: { kind: "coaching_cancelled", sessionId: id },
    });

    res.json({ cancelled: true });
  } catch (err) {
    req.log.error({ err }, "Cancellation failed");
    res.status(500).json({ error: "Could not cancel that session" });
  }
});

const CALENDAR_PURPOSE = "calendar.ics";

/** Absolute origin of this server, honouring the proxy Railway puts in front. */
function publicOrigin(req: Request): string {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwarded || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

/**
 * Mint a short-lived link to a session's calendar file.
 *
 * The .ics itself cannot be bearer-authenticated: the OS opens that URL in its
 * own browser to hand the file to the calendar app, and none of the app's
 * headers travel with it. So the app asks for a signed URL first, while it
 * still has the token, and only that URL is opened.
 */
router.get("/coaching/sessions/:id/calendar-link", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);

  try {
    const [session] = await db
      .select({ id: coachingSessionsTable.id })
      .from(coachingSessionsTable)
      .where(
        and(
          eq(coachingSessionsTable.id, id),
          eq(coachingSessionsTable.clientUserId, req.user!.id),
        ),
      );

    if (!session) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const token = signLinkToken(id, CALENDAR_PURPOSE);
    res.json({ url: `${publicOrigin(req)}/api/coaching/sessions/${id}/calendar.ics?t=${token}` });
  } catch (err) {
    req.log.error({ err }, "Calendar link failed");
    res.status(500).json({ error: "Could not build the calendar link" });
  }
});

/**
 * Calendar file for a booked session.
 *
 * This is what replaces the calendar sync a third-party scheduler would give
 * you. Authorised by the signed token above rather than by a bearer header,
 * because the request arrives from the OS rather than from the app.
 */
router.get("/coaching/sessions/:id/calendar.ics", async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (!verifyLinkToken(String(req.query.t ?? ""), id, CALENDAR_PURPOSE)) {
    res.status(403).type("text/plain").send("This calendar link has expired. Open it from the app again.");
    return;
  }

  try {
    const [session] = await db
      .select()
      .from(coachingSessionsTable)
      .where(eq(coachingSessionsTable.id, id));

    if (!session) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const ics = buildIcs({
      uid: session.id,
      startsAt: session.startsAt,
      durationMins: session.durationMins,
      title: session.kind === "intro" ? "Elovia intro call" : "Elovia coaching session",
      description: session.clientNote ?? undefined,
      url: session.meetingUrl ?? undefined,
    });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="elovia-session.ics"');
    res.send(ics);
  } catch (err) {
    req.log.error({ err }, "Calendar export failed");
    res.status(500).json({ error: "Could not build the calendar file" });
  }
});

export default router;
