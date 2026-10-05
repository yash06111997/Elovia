import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testUrl ? test : test.skip;
const suiteName = `elovia_ai_test_${process.pid}_${Date.now()}`;
const requireDb = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const requireScripts = createRequire(
  new URL("../package.json", import.meta.url),
);
let admin,
  pool,
  workspacePool,
  unregister,
  quota,
  server,
  baseUrl,
  NvidiaProvider,
  AnthropicProvider;
if (process.env.CI === "true" && !testUrl)
  throw new Error("CI must provide TEST_DATABASE_URL for AI accounting tests");

if (testUrl) {
  before(async () => {
    assert.match(
      new URL(testUrl).pathname,
      /test/i,
      "Only isolated test databases are allowed",
    );
    const { Pool } = requireDb("pg");
    admin = new Pool({ connectionString: testUrl });
    await admin.query(`CREATE DATABASE "${suiteName}"`);
    const url = new URL(testUrl);
    url.pathname = `/${suiteName}`;
    url.searchParams.delete("options");
    const { runMigrations } = await import("../../lib/db/scripts/migrate.mjs");
    await runMigrations(url.toString());
    process.env.DATABASE_URL = url.toString();
    Object.assign(process.env, {
      AI_PREFER_QUALITY: "0",
      REVENUECAT_WEBHOOK_SECRET: "test-placeholder",
      REVENUECAT_SECRET_API_KEY: "test-placeholder",
      REVENUECAT_SUBJECT_HASH_KEY:
        "test-placeholder-hash-key-at-least-32-bytes",
      REVENUECAT_PRO_ENTITLEMENT_ID: "Elovia Pro",
      REVENUECAT_COACHING_ENTITLEMENT_ID: "Elovia Coaching",
      REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([
        { id: "pro", kind: "auto_renewing" },
      ]),
      REVENUECAT_COACHING_PRODUCTS_JSON: JSON.stringify([
        { id: "coaching", kind: "auto_renewing" },
      ]),
      REVENUECAT_ENVIRONMENT: "sandbox",
      REVENUECAT_NORMALIZED_READS: "per_user",
    });
    pool = new Pool({ connectionString: url.toString() });
    unregister = requireScripts("tsx/esm/api").register();
    workspacePool = (await import("../../lib/db/src/index.ts")).pool;
    quota = await import("../../artifacts/api-server/src/lib/aiQuota.ts");
    ({ NvidiaProvider } =
      await import("../../artifacts/api-server/src/lib/ai/providers/nvidia.ts"));
    ({ AnthropicProvider } =
      await import("../../artifacts/api-server/src/lib/ai/providers/anthropic.ts"));
    const { default: aiRouter } =
      await import("../../artifacts/api-server/src/routes/ai/index.ts");
    const { default: supplementsRouter } =
      await import("../../artifacts/api-server/src/routes/supplements.ts");
    const { default: privacyRouter } =
      await import("../../artifacts/api-server/src/routes/privacy.ts");
    const requireApi = createRequire(
      new URL("../../artifacts/api-server/package.json", import.meta.url),
    );
    const express = requireApi("express");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = req.get("X-Test-User")
        ? { id: req.get("X-Test-User") }
        : undefined;
      req.isAuthenticated = () => Boolean(req.user);
      req.log = { info() {}, warn() {}, error() {} };
      next();
    });
    app.use("/api/ai", aiRouter);
    app.use("/api", supplementsRouter);
    app.use("/api", privacyRouter);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) =>
      server ? server.close(resolve) : resolve(),
    );
    await workspacePool?.end();
    await pool?.end();
    await unregister?.();
    // Pool.end() can resolve before PostgreSQL has processed every socket's
    // shutdown. Forcing a drop in that window produces late 57P01 errors on
    // Linux. Wait for server-side closure; do not kill active connections.
    if (admin) {
      let remaining = 0;
      for (let tries = 0; tries < 100; tries++) {
        const result = await admin.query(
          "SELECT count(*)::int AS remaining FROM pg_stat_activity WHERE datname=$1",
          [suiteName],
        );
        remaining = result.rows[0].remaining;
        if (remaining === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(remaining, 0, "All test database connections must close before dropping it");
      await admin.query(`DROP DATABASE IF EXISTS "${suiteName}"`);
    }
    await admin?.end();
  });
}
async function user() {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}
async function claim(uid, route = "coach-chat") {
  const decision = await quota.claimQuota(uid, "trial", route);
  assert.equal(decision.allowed, true);
  assert.ok(decision.claim, "Accepted requests need a durable claim identity");
  return decision.claim;
}
async function usage(uid) {
  return (
    await pool.query(
      "SELECT * FROM ai_usage WHERE user_id=$1 ORDER BY day,route",
      [uid],
    )
  ).rows;
}
const measured = {
  inputTokens: 100,
  outputTokens: 20,
  estimatedCostMicros: 600,
  provider: "nvidia",
  model: "test-model",
};

integrationTest(
  "concurrent claims admit exactly the route limit without leaking rejected increments",
  async () => {
    const uid = await user();
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        quota.claimQuota(uid, "trial", "generate-workout"),
      ),
    );
    assert.equal(decisions.filter((d) => d.allowed).length, 5);
    assert.equal((await usage(uid))[0].request_count, 5);
    assert.ok(decisions.filter((d) => d.allowed).every((d) => d.claim?.id));
  },
);

integrationTest(
  "cross-route concurrent attempts cannot reserve beyond the daily budget",
  async () => {
    const uid = await user();
    const claims = await Promise.all([
      claim(uid),
      claim(uid, "generate-workout"),
    ]);
    const reservations = await Promise.allSettled(
      claims.map((c) => quota.reserveAttempt(c, "nvidia", 200_000)),
    );
    assert.equal(
      reservations.filter((r) => r.status === "fulfilled").length,
      1,
    );
    assert.equal(
      reservations.find((r) => r.status === "rejected").reason.code,
      "cost_ceiling_reached",
    );
    assert.equal(
      (await usage(uid)).reduce((sum, r) => sum + r.estimated_cost_micros, 0),
      200_000,
    );
  },
);

integrationTest(
  "response settlement is idempotent and replaces only its own reservation",
  async () => {
    const uid = await user();
    const c = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 50_000);
    await quota.reserveAttempt(c, "anthropic", 70_000);
    await Promise.all(
      Array.from({ length: 5 }, () => quota.settleAttempt(c, a, measured)),
    );
    const [row] = await usage(uid);
    assert.equal(row.estimated_cost_micros, 70_600);
    assert.equal(row.input_tokens, 100);
    assert.equal(row.output_tokens, 20);
  },
);

integrationTest(
  "finish refunds unused claims once but never refunds dispatched requests",
  async () => {
    const uid = await user();
    const unused = await claim(uid);
    const started = await claim(uid);
    await quota.reserveAttempt(started, "nvidia", 50_000);
    await Promise.all([
      quota.releaseQuota(unused),
      quota.releaseQuota(unused),
      quota.releaseQuota(started),
    ]);
    assert.equal((await usage(uid))[0].request_count, 1);
    assert.equal((await usage(uid))[0].estimated_cost_micros, 50_000);
    await assert.rejects(
      quota.reserveAttempt(started, "anthropic", 1),
      /closed/i,
    );
  },
);

integrationTest(
  "midnight settlement and unused refunds stay in the original UTC bucket",
  async (t) => {
    const uid = await user();
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-09-06T23:59:59Z"),
    });
    const c = await claim(uid);
    const unused = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 50_000);
    t.mock.timers.setTime(new Date("2026-09-07T00:00:01Z").getTime());
    await quota.settleAttempt(c, a, measured);
    await quota.releaseQuota(unused);
    const rows = await usage(uid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, "2026-09-06");
    assert.equal(rows[0].request_count, 1);
    assert.equal(rows[0].estimated_cost_micros, 600);
  },
);

integrationTest(
  "missing or invalid usage never turns an unknown paid call into zero spend",
  async () => {
    const uid = await user();
    const c = await claim(uid);
    for (const inputTokens of [0, -1, NaN, Infinity, 1.5]) {
      const a = await quota.reserveAttempt(c, "nvidia", 1000);
      await quota.settleAttempt(c, a, {
        ...measured,
        inputTokens,
        outputTokens: 0,
      });
    }
    assert.equal((await usage(uid))[0].estimated_cost_micros, 5000);
  },
);

integrationTest(
  "failed settlement rolls back the ledger and retains the reserved budget",
  async () => {
    const uid = await user();
    const c = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 50_000);
    await pool.query(
      `CREATE FUNCTION reject_ai_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test settlement failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER reject_ai_settlement BEFORE UPDATE ON ai_usage FOR EACH ROW EXECUTE FUNCTION reject_ai_settlement()`,
    );
    try {
      await assert.rejects(quota.settleAttempt(c, a, measured));
      assert.equal((await usage(uid))[0].estimated_cost_micros, 50_000);
      assert.equal(
        (
          await pool.query("SELECT settled_at FROM ai_attempts WHERE id=$1", [
            a,
          ])
        ).rows[0].settled_at,
        null,
      );
    } finally {
      await pool.query("DROP TRIGGER reject_ai_settlement ON ai_usage");
      await pool.query("DROP FUNCTION reject_ai_settlement()");
    }
    await quota.settleAttempt(c, a, measured);
    assert.equal((await usage(uid))[0].estimated_cost_micros, 600);
  },
);

integrationTest(
  "account deletion cascades the ledger and late responses cannot recreate spend rows",
  async () => {
    const uid = await user();
    const c = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 50_000);
    await pool.query("DELETE FROM users WHERE id=$1", [uid]);
    await assert.rejects(quota.settleAttempt(c, a, measured));
    assert.equal(
      (await pool.query("SELECT id FROM ai_attempts WHERE id=$1", [a]))
        .rowCount,
      0,
    );
    assert.equal((await usage(uid)).length, 0);
  },
);

async function http(uid, path, body = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": uid },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
function providers(t, text, onCall = () => {}) {
  for (const [provider, Adapter] of [
    ["nvidia", NvidiaProvider],
    ["anthropic", AnthropicProvider],
  ]) {
    t.mock.method(Adapter.prototype, "isConfigured", () => true);
    t.mock.method(Adapter.prototype, "generate", async () => {
      await onCall(provider);
      return {
        provider,
        model: "claude-sonnet-4-6",
        text,
        usage: { inputTokens: 100, outputTokens: 20 },
        latencyMs: 1,
      };
    });
  }
}
async function waitForClosed(uid) {
  // Bounded observation of the actual asynchronous HTTP finish handler.
  for (let tries = 0; tries < 100; tries++) {
    const rows = (
      await pool.query("SELECT status FROM ai_requests WHERE user_id=$1", [uid])
    ).rows;
    if (rows.length && rows.every((row) => row.status === "closed")) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("HTTP request claims did not close");
}

integrationTest(
  "every AI endpoint accounts invalid paid output before returning its HTTP error",
  async (t) => {
    providers(t, "invalid JSON");
    for (const [route, body] of [
      ["recognize-food", { imageBase64: "abc" }],
      ["generate-workout", { profile: {} }],
      ["generate-meal-plan", { profile: {} }],
      ["generate-recipe", { profile: {} }],
      ["analyse-supplement", {}],
    ]) {
      const uid = await user();
      let path = `/api/ai/${route}`;
      if (route === "analyse-supplement") {
        const id = randomUUID();
        await pool.query(
          "INSERT INTO supplements (id,user_id,name,kind) VALUES ($1,$2,'Creatine','supplement')",
          [id, uid],
        );
        path = `/api/supplements/${id}/analyse`;
      }
      const res = await http(uid, path, body);
      assert.equal(res.status, 502, `${route}: ${JSON.stringify(res.body)}`);
      await waitForClosed(uid);
      const [row] = await usage(uid);
      assert.equal(row.request_count, 1, route);
      // Workout's schema validator invokes both providers; other parsers run downstream.
      assert.equal(
        row.estimated_cost_micros,
        route === "generate-workout" ? 1200 : 600,
        route,
      );
    }
    const uid = await user();
    const res = await http(uid, "/api/ai/coach-chat", {
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(res.status, 200);
    await waitForClosed(uid);
    assert.equal((await usage(uid))[0].estimated_cost_micros, 600);
  },
);

integrationTest(
  "validation errors refund quota without dispatching AI",
  async (t) => {
    let calls = 0;
    providers(t, "unused", () => calls++);
    const uid = await user();
    assert.equal((await http(uid, "/api/ai/generate-workout", {})).status, 400);
    await waitForClosed(uid);
    assert.equal((await usage(uid))[0].request_count, 0);
    assert.equal(calls, 0);
  },
);

integrationTest(
  "HTTP cost exhaustion returns 429 before provider IO",
  async (t) => {
    let calls = 0;
    providers(t, "unused", () => calls++);
    const uid = await user();
    const c = await claim(uid);
    await quota.reserveAttempt(c, "nvidia", 299_999);
    await quota.releaseQuota(c);
    const res = await http(uid, "/api/ai/coach-chat", {
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "cost_ceiling_reached");
    assert.equal(calls, 0);
  },
);

integrationTest(
  "cached supplement analysis is available without spending quota even at the daily limit",
  async (t) => {
    let calls = 0;
    providers(t, "unused", () => calls++);
    const uid = await user();
    const id = randomUUID();
    await pool.query(
      "INSERT INTO supplements (id,user_id,name,kind,analysis) VALUES ($1,$2,'Creatine','supplement',$3)",
      [id, uid, JSON.stringify({ summary: "Saved analysis" })],
    );
    const c = await claim(uid, "analyse-supplement");
    await quota.reserveAttempt(c, "nvidia", 300_000);
    await quota.releaseQuota(c);
    const res = await http(uid, `/api/supplements/${id}/analyse`);
    assert.equal(res.status, 200);
    assert.equal(res.body.cached, true);
    assert.equal(calls, 0);
    assert.equal((await usage(uid))[0].request_count, 1);
    assert.equal(
      (await http(await user(), `/api/supplements/${id}/analyse`)).status,
      404,
    );
    assert.equal(
      (await http(uid, `/api/supplements/${id}/analyse`, { refresh: true }))
        .status,
      429,
    );
  },
);

integrationTest(
  "privacy export includes only the caller's AI ledger",
  async () => {
    const uid = await user();
    const other = await user();
    const c = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 1000);
    await quota.settleAttempt(c, a, measured);
    const otherClaim = await claim(other);
    await quota.reserveAttempt(otherClaim, "nvidia", 1000);
    const res = await fetch(`${baseUrl}/api/privacy/export`, {
      headers: { "X-Test-User": uid },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.aiRequests));
    assert.ok(Array.isArray(body.aiAttempts));
    assert.deepEqual(
      body.aiRequests.map((r) => r.id),
      [c.id],
    );
    assert.deepEqual(
      body.aiAttempts.map((r) => r.id),
      [a],
    );
  },
);

integrationTest(
  "an HTTP accounting-write failure returns 503, retains spend and never calls fallback",
  async (t) => {
    const uid = await user();
    let calls = 0;
    providers(t, "invalid", async () => {
      calls++;
      await pool.query(
        `CREATE FUNCTION reject_http_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER reject_http_settlement BEFORE UPDATE ON ai_usage FOR EACH ROW EXECUTE FUNCTION reject_http_settlement()`,
      );
    });
    try {
      const res = await http(uid, "/api/ai/generate-workout", { profile: {} });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, "quota_unavailable");
      assert.equal(calls, 1);
      await waitForClosed(uid);
      const [row] = await usage(uid);
      assert.equal(row.request_count, 1);
      assert.ok(row.estimated_cost_micros > 600);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS reject_http_settlement ON ai_usage",
      );
      await pool.query("DROP FUNCTION IF EXISTS reject_http_settlement()");
    }
  },
);

integrationTest(
  "disconnect keeps paid usage but prevents a later fallback call",
  async (t) => {
    const uid = await user();
    let calls = 0,
      started,
      release;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release());
    providers(t, "invalid", async () => {
      calls++;
      started();
      await pending;
    });
    const controller = new AbortController();
    const response = fetch(`${baseUrl}/api/ai/generate-workout`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Test-User": uid },
      body: JSON.stringify({ profile: {} }),
    }).catch((err) => err);
    await began;
    controller.abort();
    await response;
    await waitForClosed(uid);
    release();
    for (
      let tries = 0;
      tries < 100 && (await usage(uid))[0].estimated_cost_micros !== 600;
      tries++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(calls, 1);
    const [row] = await usage(uid);
    assert.equal(row.request_count, 1);
    assert.equal(row.estimated_cost_micros, 600);
  },
);

integrationTest(
  "a different account cannot settle or release another account's claim",
  async () => {
    const uid = await user();
    const other = await user();
    const c = await claim(uid);
    const a = await quota.reserveAttempt(c, "nvidia", 1000);
    const otherClaim = await claim(other);
    await assert.rejects(quota.settleAttempt(otherClaim, a, measured));
    await assert.rejects(quota.releaseQuota({ id: c.id, userId: other }));
    assert.equal((await usage(uid))[0].estimated_cost_micros, 1000);
  },
);
