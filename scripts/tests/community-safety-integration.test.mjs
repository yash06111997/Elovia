import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const suiteDatabaseName = `elovia_community_test_${process.pid}_${Date.now()}`;
const requireFromDatabasePackage = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);
const requireFromApiPackage = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);

let adminPool;
let scopedPool;
let workspacePool;
let unregisterTsx;
let server;
let baseUrl;
let communitySafetyStore;
let previousModeratorIds;

if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error(
    "CI must provide TEST_DATABASE_URL for Community safety integration tests",
  );
}

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlFor(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.delete("options");
  return url.toString();
}

async function request(path, { userId, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { "X-Elovia-Test-User": userId } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function acceptCommunity(userId) {
  return request("/api/social/access/accept", {
    userId,
    method: "POST",
    body: {
      adultConfirmed: true,
      acceptedTerms: true,
      termsVersion: "2026-09-03",
    },
  });
}

if (testDatabaseUrl) {
  before(async () => {
    const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
    assert.match(
      databaseName,
      /test/i,
      "TEST_DATABASE_URL must target a database whose name contains 'test'",
    );

    const { Pool } = requireFromDatabasePackage("pg");
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    await adminPool.query(
      `CREATE DATABASE ${quotedIdentifier(suiteDatabaseName)}`,
    );
    const databaseUrl = databaseUrlFor(testDatabaseUrl, suiteDatabaseName);
    const { runMigrations } = await import("../../lib/db/scripts/migrate.mjs");
    await runMigrations(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    previousModeratorIds = process.env.MODERATOR_USER_IDS;
    process.env.MODERATOR_USER_IDS = "moderator";

    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    workspacePool = databaseModule.pool;
    communitySafetyStore =
      await import("../../artifacts/api-server/src/lib/communitySafetyStore.ts");
    const { default: socialRouter } =
      await import("../../artifacts/api-server/src/routes/social.ts");
    const { default: safetyRouter } =
      await import("../../artifacts/api-server/src/routes/safety.ts");

    scopedPool = new Pool({ connectionString: databaseUrl });
    await scopedPool.query(
      `INSERT INTO users (id,email,first_name,last_name)
       VALUES
         ('reporter','reporter@example.test','Report','Runner'),
         ('subject','subject@example.test','Subject','Runner'),
         ('outsider','outsider@example.test','Outside','Runner'),
         ('moderator','moderator@example.test','Safety','Reviewer')`,
    );

    const expressModule = requireFromApiPackage("express");
    const express = expressModule.default ?? expressModule;
    const app = express();
    app.use(express.json({ limit: "100kb" }));
    app.use((req, _res, next) => {
      const userId = req.get("X-Elovia-Test-User");
      req.user = userId
        ? {
            id: userId,
            email: `${userId}@example.test`,
            firstName: userId,
            lastName: "Tester",
            profileImageUrl: null,
          }
        : undefined;
      req.isAuthenticated = function isAuthenticated() {
        return Boolean(this.user);
      };
      req.log = {
        error() {},
        warn() {},
        info() {},
        debug() {},
      };
      next();
    });
    app.use("/api", socialRouter);
    app.use("/api", safetyRouter);

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await workspacePool?.end();
    await unregisterTsx?.();
    await scopedPool?.end();
    await adminPool?.query(
      `DROP DATABASE ${quotedIdentifier(suiteDatabaseName)}`,
    );
    await adminPool?.end();
    if (previousModeratorIds === undefined) {
      delete process.env.MODERATOR_USER_IDS;
    } else {
      process.env.MODERATOR_USER_IDS = previousModeratorIds;
    }
  });
}

integrationTest(
  "Community consent, reporting, moderation, AI receipts, and blocks are enforced end to end",
  async () => {
    assert.equal(
      (await request("/api/social/me", { userId: "reporter" })).status,
      403,
      "social data must remain closed before Community acceptance",
    );

    const access = await request("/api/social/access", { userId: "reporter" });
    assert.equal(access.status, 200);
    assert.deepEqual(access.body, {
      accepted: false,
      adultOnly: true,
      minimumAge: 18,
      termsVersion: "2026-09-03",
    });
    assert.equal(
      (
        await request("/api/social/access/accept", {
          userId: "reporter",
          method: "POST",
          body: {
            adultConfirmed: false,
            acceptedTerms: true,
            termsVersion: "2026-09-03",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/social/access/accept", {
          userId: "reporter",
          method: "POST",
          body: {
            adultConfirmed: true,
            acceptedTerms: true,
            termsVersion: "old-version",
          },
        })
      ).status,
      409,
    );

    for (const userId of ["reporter", "subject", "outsider"]) {
      assert.equal((await acceptCommunity(userId)).status, 201);
    }
    assert.equal(
      (await request("/api/social/me", { userId: "reporter" })).status,
      200,
    );

    await scopedPool.query(
      `INSERT INTO social_profiles
         (user_id,display_name,friend_code,discoverable,leaderboard_opt_in)
       VALUES
         ('subject','Subject Runner','ELV-SUBJECT',true,false),
         ('outsider','Outside Runner','ELV-OUTSIDE',true,false)
       ON CONFLICT (user_id) DO NOTHING;
       INSERT INTO friendships
         (id,user_a_id,user_b_id,requested_by,status,responded_at)
       VALUES ('friendship-1','reporter','subject','reporter','accepted',now());
       INSERT INTO shared_activities
         (id,user_id,kind,title,caption,payload,visibility)
       VALUES
         ('subject-run','subject','run','Morning 5K','Steady work','{"distanceKm":5}'::jsonb,'friends'),
         ('reporter-run','reporter','run','Easy run',NULL,'{"distanceKm":3}'::jsonb,'friends');
       INSERT INTO activity_comments (id,activity_id,user_id,body)
       VALUES ('subject-comment','reporter-run','subject','Nice session');
       INSERT INTO challenges
         (id,created_by,name,description,metric,target,starts_at,ends_at,join_code)
       VALUES
         ('challenge-1','reporter','Four sessions',NULL,'workouts',4,now(),now()+interval '7 days','ELV-CHALLENGE');
       INSERT INTO challenge_participants (id,challenge_id,user_id,progress)
       VALUES
         ('participant-reporter','challenge-1','reporter',2),
         ('participant-subject','challenge-1','subject',3);`,
    );

    const unsafePost = await request("/api/social/activities", {
      userId: "reporter",
      method: "POST",
      body: {
        kind: "run",
        title: "Email me at private@example.com",
        payload: {},
      },
    });
    assert.equal(unsafePost.status, 422);
    assert.equal(unsafePost.body.code, "content_not_allowed");

    const feedBeforeBlock = await request("/api/social/feed", {
      userId: "reporter",
    });
    assert.equal(feedBeforeBlock.status, 200);
    assert.ok(
      feedBeforeBlock.body.feed.some(
        (activity) => activity.author.userId === "subject",
      ),
    );

    const report = await request("/api/safety/reports", {
      userId: "reporter",
      method: "POST",
      body: {
        targetType: "activity",
        targetId: "subject-run",
        reason: "harassment",
        details: "Please review this post",
      },
    });
    assert.equal(report.status, 201);
    assert.equal(report.body.duplicate, false);
    assert.equal(Object.hasOwn(report.body.report, "contentSnapshot"), false);

    const duplicate = await request("/api/safety/reports", {
      userId: "reporter",
      method: "POST",
      body: {
        targetType: "activity",
        targetId: "subject-run",
        reason: "spam",
      },
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.report.id, report.body.report.id);

    assert.equal(
      (
        await request("/api/safety/reports", {
          userId: "outsider",
          method: "POST",
          body: {
            targetType: "activity",
            targetId: "subject-run",
            reason: "spam",
          },
        })
      ).status,
      404,
      "users cannot report Community content they are not allowed to view",
    );

    const receiptId = await communitySafetyStore.createAiResponseReceipt(
      "reporter",
      "coach-chat",
      "Take a recovery day and reduce the load.",
    );
    const aiReport = await request("/api/safety/reports", {
      userId: "reporter",
      method: "POST",
      body: {
        targetType: "ai_response",
        targetId: receiptId,
        content: "Take a recovery day and reduce the load.",
        reason: "dangerous_advice",
      },
    });
    assert.equal(aiReport.status, 201);
    assert.equal(aiReport.body.report.priority, "urgent");
    assert.equal(
      (
        await request("/api/safety/reports", {
          userId: "reporter",
          method: "POST",
          body: {
            targetType: "ai_response",
            targetId: receiptId,
            content: "Altered response text",
            reason: "dangerous_advice",
          },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request("/api/safety/reports", {
          userId: "subject",
          method: "POST",
          body: {
            targetType: "ai_response",
            targetId: receiptId,
            content: "Take a recovery day and reduce the load.",
            reason: "dangerous_advice",
          },
        })
      ).status,
      404,
    );

    assert.equal(
      (
        await request("/api/safety/moderation/reports", {
          userId: "reporter",
        })
      ).status,
      403,
    );
    const queue = await request("/api/safety/moderation/reports", {
      userId: "moderator",
    });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.reports.length, 2);
    assert.equal(queue.body.reports[0].audit.length, 1);

    const actioned = await request(
      `/api/safety/moderation/reports/${report.body.report.id}`,
      {
        userId: "moderator",
        method: "PATCH",
        body: { status: "actioned", note: "Reviewed and actioned" },
      },
    );
    assert.equal(actioned.status, 200);
    assert.ok(actioned.body.report.resolvedAt);
    const reportRows = await scopedPool.query(
      `SELECT status,resolved_at FROM content_reports WHERE id=$1`,
      [report.body.report.id],
    );
    assert.equal(reportRows.rows[0].status, "actioned");
    assert.ok(reportRows.rows[0].resolved_at);
    assert.equal(
      (
        await request(
          `/api/safety/moderation/reports/${report.body.report.id}`,
          {
            userId: "moderator",
            method: "PATCH",
            body: { status: "reviewing" },
          },
        )
      ).status,
      409,
      "terminal moderation decisions cannot be reopened by a stale request",
    );
    const auditRows = await scopedPool.query(
      `SELECT id FROM moderation_audit_log WHERE report_id=$1 ORDER BY created_at`,
      [report.body.report.id],
    );
    assert.equal(auditRows.rowCount, 2);
    await assert.rejects(
      scopedPool.query(
        `UPDATE moderation_audit_log SET action='tampered' WHERE id=$1`,
        [auditRows.rows[0].id],
      ),
      /append-only/,
    );

    const commentsBeforeBlock = await request(
      "/api/social/activities/reporter-run/comments",
      { userId: "reporter" },
    );
    assert.equal(commentsBeforeBlock.status, 200);
    assert.equal(commentsBeforeBlock.body.comments.length, 1);
    const challengesBeforeBlock = await request("/api/social/challenges", {
      userId: "reporter",
    });
    assert.equal(
      challengesBeforeBlock.body.challenges[0].participants.length,
      2,
    );

    const blocked = await request("/api/social/friends/subject/block", {
      userId: "reporter",
      method: "POST",
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.state, "blocked");
    const feedAfterBlock = await request("/api/social/feed", {
      userId: "reporter",
    });
    assert.equal(
      feedAfterBlock.body.feed.some(
        (activity) => activity.author.userId === "subject",
      ),
      false,
    );
    const commentsAfterBlock = await request(
      "/api/social/activities/reporter-run/comments",
      { userId: "reporter" },
    );
    assert.equal(commentsAfterBlock.status, 200);
    assert.deepEqual(commentsAfterBlock.body.comments, []);
    const challengesAfterBlock = await request("/api/social/challenges", {
      userId: "reporter",
    });
    assert.deepEqual(
      challengesAfterBlock.body.challenges[0].participants.map(
        (participant) => participant.userId,
      ),
      ["reporter"],
    );

    const receiptColumns = await scopedPool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ai_response_receipts'`,
    );
    const receiptColumnNames = receiptColumns.rows.map(
      (row) => row.column_name,
    );
    assert.ok(receiptColumnNames.includes("content_hash"));
    assert.equal(receiptColumnNames.includes("content"), false);
    assert.equal(receiptColumnNames.includes("response"), false);
  },
);
