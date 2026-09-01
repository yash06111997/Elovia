import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  activityCommentsTable,
  aiUsageTable,
  challengeParticipantsTable,
  challengesTable,
  coachingSessionsTable,
  coachProfilesTable,
  friendshipsTable,
  kudosTable,
  pushTokensTable,
  sharedActivitiesTable,
  socialProfilesTable,
  subscriptionsTable,
  supplementsTable,
  userDataTable,
  usersTable,
  db,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/aiGate";
import { deleteFirebaseUser } from "../lib/auth";
import { resolveEntitlement } from "../lib/entitlements";
import {
  finalizeAccountDeletion,
  tombstoneAndDeleteAccountData,
} from "../lib/accountDeletion";
import { runAccountDeletionWorkflow } from "../lib/accountDeletionWorkflow";

const router: IRouter = Router();

const page = (title: string, body: string, script = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Elovia</title><style>
body{margin:0;background:#090b10;color:#f6f7fb;font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:48px 22px 80px}
h1,h2{line-height:1.2}h1{color:#b8ff3d}a{color:#b8ff3d}section{margin:30px 0}button{background:#b8ff3d;color:#111;border:0;border-radius:10px;padding:13px 18px;font-weight:700;cursor:pointer}
.danger{background:#ff5d72;color:white}.muted{color:#aeb4c2}.status{margin-top:16px;white-space:pre-wrap}</style></head>
<body><main><h1>${title}</h1>${body}<p class="muted">Last updated: 30 August 2026</p></main>${script}</body></html>`;

router.get("/legal/privacy", (_req: Request, res: Response) => {
  res.type("html").send(
    page(
      "Privacy Notice",
      `
    <p>Elovia uses the information you provide to personalise fitness, nutrition, recovery and coaching features.</p>
    <section><h2>Data we process</h2><p>Account details; profile and goal information; workouts, meals, measurements, habits and health-source data you choose to connect; supplement and medication entries; location during a run or for places you create; subscription status; AI requests and usage counts; coaching bookings; and content you deliberately share with friends.</p></section>
    <section><h2>How it is used</h2><p>We use this data to operate and secure the app, sync your account, generate requested recommendations, enforce plan limits, deliver reminders, support coaching and show opted-in social activity. Elovia is a fitness tool, not a medical device, and its guidance does not replace a qualified clinician.</p></section>
    <section><h2>Services and sharing</h2><p>Data is processed by infrastructure and feature providers needed to run Elovia, including Firebase for identity, RevenueCat and the app stores for purchases, hosting and database providers, notification delivery, maps or device health services you enable, and AI providers for requests you initiate. We do not sell health data. Social data is shared only when you choose to share it.</p></section>
    <section><h2>Your controls</h2><p>You can disconnect health access in device settings, turn off social discovery, export your data, and permanently delete your Elovia account from Profile → Privacy &amp; Data. You can also use the <a href="./account-deletion">external deletion page</a>.</p></section>
    <section><h2>Retention and contact</h2><p>Account data is retained while your account is active and removed when you delete it, except for limited records we must retain for security, fraud prevention, accounting or legal obligations. Store transaction records are controlled by Apple or Google. For privacy questions, use the support contact shown on Elovia's app-store listing.</p></section>
  `,
    ),
  );
});

router.get("/legal/terms", (_req: Request, res: Response) => {
  res.type("html").send(
    page(
      "Terms of Use",
      `
    <p>By using Elovia, you agree to use it lawfully and to provide accurate information where it affects recommendations.</p>
    <section><h2>Fitness and health guidance</h2><p>Elovia provides general educational fitness and nutrition guidance, not diagnosis or medical treatment. Stop an activity if you feel pain, dizziness or other concerning symptoms, and consult a qualified professional when appropriate.</p></section>
    <section><h2>Accounts and subscriptions</h2><p>You are responsible for your account and device access. Paid plans are billed and managed by the applicable app store under the price, renewal and cancellation terms shown before purchase. Deleting an account does not automatically cancel an app-store subscription; manage that subscription in your store settings.</p></section>
    <section><h2>Acceptable use</h2><p>Do not misuse the service, attempt to bypass access controls, scrape other users, upload unlawful content, or use social and coaching features to harass others.</p></section>
    <section><h2>Availability</h2><p>Features may change and integrations can be unavailable. To the extent permitted by law, Elovia is provided without a promise that every recommendation or service will always be accurate or uninterrupted.</p></section>
  `,
    ),
  );
});

router.get("/legal/account-deletion", (_req: Request, res: Response) => {
  res.type("html").send(
    page(
      "Delete Your Elovia Account",
      `
    <p>This permanently removes your Elovia account and associated app data. It does not cancel an Apple App Store or Google Play subscription.</p>
    <ol><li>Sign in with the Google account used for Elovia.</li><li>Review the warning.</li><li>Choose “Permanently delete”.</li></ol>
    <button id="sign-in">Sign in to continue</button>
    <button id="delete" class="danger" hidden>Permanently delete</button>
    <div id="status" class="status muted"></div>
  `,
      `<script>
  (() => {
    const status = document.getElementById('status');
    const signIn = document.getElementById('sign-in');
    const remove = document.getElementById('delete');
    let token = '';
    signIn.onclick = () => {
      const state = crypto.randomUUID();
      const popup = open('/api/auth/google-mobile?mode=popup&state=' + encodeURIComponent(state), 'elovia-delete', 'width=500,height=650');
      status.textContent = popup ? 'Complete sign-in in the new window.' : 'Allow pop-ups and try again.';
      const listener = (event) => {
        if (event.origin !== location.origin || event.data?.type !== 'elovia-auth' || event.data?.state !== state) return;
        removeEventListener('message', listener); token = event.data.idToken || '';
        if (!token) { status.textContent = event.data.error || 'Sign-in failed.'; return; }
        signIn.hidden = true; remove.hidden = false; status.textContent = 'Signed in. Deletion cannot be undone.';
      };
      addEventListener('message', listener);
    };
    remove.onclick = async () => {
      if (!confirm('Permanently delete your Elovia account and app data?')) return;
      remove.disabled = true; status.textContent = 'Deleting…';
      const response = await fetch('/api/account', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      const result = await response.json().catch(() => ({}));
      status.textContent = result.deleted
        ? 'Your Elovia account and app data have been deleted.'
        : result.finalizing
          ? 'Your app data was removed and identity deletion is finalizing. It is safe to close this window.'
          : 'Deletion did not start. Please try again or use the support contact on Elovia’s app-store listing.';
      if (!response.ok && !result.finalizing) remove.disabled = false;
    };
  })();
  </script>`,
    ),
  );
});

router.get(
  "/privacy/export",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const userId = req.user!.id;
      const [
        account,
        appData,
        subscriptions,
        aiUsage,
        pushDevices,
        supplements,
        socialProfile,
        friendships,
        sharedActivities,
        kudos,
        comments,
        challengeMemberships,
        createdChallenges,
        coachingSessions,
        coachProfile,
        entitlement,
      ] = await Promise.all([
        db.select().from(usersTable).where(eq(usersTable.id, userId)),
        db.select().from(userDataTable).where(eq(userDataTable.userId, userId)),
        db
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.userId, userId)),
        db.select().from(aiUsageTable).where(eq(aiUsageTable.userId, userId)),
        db
          .select()
          .from(pushTokensTable)
          .where(eq(pushTokensTable.userId, userId)),
        db
          .select()
          .from(supplementsTable)
          .where(eq(supplementsTable.userId, userId)),
        db
          .select()
          .from(socialProfilesTable)
          .where(eq(socialProfilesTable.userId, userId)),
        db
          .select()
          .from(friendshipsTable)
          .where(
            or(
              eq(friendshipsTable.userAId, userId),
              eq(friendshipsTable.userBId, userId),
            ),
          ),
        db
          .select()
          .from(sharedActivitiesTable)
          .where(eq(sharedActivitiesTable.userId, userId)),
        db.select().from(kudosTable).where(eq(kudosTable.userId, userId)),
        db
          .select()
          .from(activityCommentsTable)
          .where(eq(activityCommentsTable.userId, userId)),
        db
          .select()
          .from(challengeParticipantsTable)
          .where(eq(challengeParticipantsTable.userId, userId)),
        db
          .select()
          .from(challengesTable)
          .where(eq(challengesTable.createdBy, userId)),
        db
          .select()
          .from(coachingSessionsTable)
          .where(
            or(
              eq(coachingSessionsTable.clientUserId, userId),
              eq(coachingSessionsTable.coachUserId, userId),
            ),
          ),
        db
          .select()
          .from(coachProfilesTable)
          .where(eq(coachProfilesTable.userId, userId)),
        resolveEntitlement(userId),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        account: account[0] ?? null,
        appData: appData[0] ?? null,
        entitlement,
        subscriptions,
        aiUsage,
        pushDevices,
        supplements,
        social: {
          profile: socialProfile[0] ?? null,
          friendships,
          sharedActivities,
          kudos,
          comments,
        },
        challenges: {
          memberships: challengeMemberships,
          created: createdChallenges,
        },
        coaching: {
          profile: coachProfile[0] ?? null,
          sessions: coachingSessions,
        },
      };

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="elovia-data-${userId}.json"`,
      );
      res.type("application/json").send(JSON.stringify(exportData, null, 2));
    } catch (error) {
      req.log.error({ error }, "Privacy export failed");
      res.status(500).json({ error: "Could not export account data" });
    }
  },
);

router.delete("/account", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const suppliedRequestId = req.get("X-Elovia-Deletion-Request-ID")?.trim();
  const requestId =
    suppliedRequestId && /^[A-Za-z0-9_-]{8,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
  try {
    res.setHeader("Cache-Control", "no-store");
    const outcome = await runAccountDeletionWorkflow({
      async tombstoneAndDeleteData() {
        await tombstoneAndDeleteAccountData(userId, requestId);
      },
      deleteIdentity: () => deleteFirebaseUser(userId),
      markFinalized: () => finalizeAccountDeletion(userId),
    });
    if (outcome.status === "finalized") {
      res.status(200).json({ deleted: true, finalizing: false });
      return;
    }

    req.log.error(
      {
        errorType:
          outcome.error instanceof Error ? outcome.error.name : "UnknownError",
      },
      "Account identity deletion remains pending",
    );
    res.status(202).json({
      deleted: false,
      finalizing: true,
      code: "account_deletion_finalizing",
    });
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Account deletion transaction failed",
    );
    res.status(500).json({
      error: "Account deletion did not start",
      code: "account_deletion_failed",
    });
  }
});

export default router;
