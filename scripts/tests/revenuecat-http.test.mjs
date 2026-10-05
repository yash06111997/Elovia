import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);
const requireFromApiPackage = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);

let createRevenueCatWebhookRouter;
let createApp;
let unregisterTsx;
const previousDatabaseUrl = process.env.DATABASE_URL;

before(async () => {
  delete process.env.DATABASE_URL;
  const { register } = requireFromScriptsPackage("tsx/esm/api");
  unregisterTsx = register();
  ({ createRevenueCatWebhookRouter } =
    await import("../../artifacts/api-server/src/routes/webhooks/revenuecat.ts"));
  ({ createApp } = await import("../../artifacts/api-server/src/app.ts"));
});

after(async () => {
  await unregisterTsx?.();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

test("webhook construction fails closed when its shared secret is missing", () => {
  assert.throws(
    () =>
      createRevenueCatWebhookRouter({
        webhookSecret: "",
        processor: async () => ({ status: 200, disposition: "applied" }),
      }),
    /RevenueCat webhook secret/i,
  );
});

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, () => resolve(listening));
    listening.once("error", reject);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function validBody(overrides = {}) {
  return {
    event: {
      id: "event_http_1234",
      type: "INITIAL_PURCHASE",
      event_timestamp_ms: Date.parse("2026-09-02T00:00:00.000Z"),
      app_user_id: "local-user",
      environment: "SANDBOX",
      ...overrides,
    },
  };
}

function testApp({ processor, authMiddlewareImpl } = {}) {
  const express = requireFromApiPackage("express");
  return createApp({
    revenueCatRouter: createRevenueCatWebhookRouter({
      webhookSecret: "exact webhook secret",
      processor:
        processor ?? (async () => ({ status: 200, disposition: "applied" })),
    }),
    authenticatedRouter: express.Router(),
    authMiddlewareImpl:
      authMiddlewareImpl ?? ((_request, _response, next) => next()),
  });
}

test("missing and incorrect webhook authorization stop before Firebase", async () => {
  const express = requireFromApiPackage("express");
  let processorCalls = 0;
  let firebaseCalls = 0;
  const app = createApp({
    revenueCatRouter: createRevenueCatWebhookRouter({
      webhookSecret: "exact webhook secret",
      processor: async () => {
        processorCalls += 1;
        return { status: 200, disposition: "applied", applied: true };
      },
    }),
    authenticatedRouter: express.Router(),
    authMiddlewareImpl(_request, _response, next) {
      firebaseCalls += 1;
      next();
    },
  });
  const server = await listen(app);
  try {
    for (const authorization of [undefined, "wrong secret"]) {
      const response = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ event: {} }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: "invalid_authorization",
      });
    }
    assert.equal(processorCalls, 0);
    assert.equal(firebaseCalls, 0);
  } finally {
    await server.close();
  }
});

test("an authenticated webhook over 256 KiB is rejected before parsing or processing", async () => {
  let processorCalls = 0;
  let firebaseCalls = 0;
  const server = await listen(
    testApp({
      processor: async () => {
        processorCalls += 1;
        return { status: 200, disposition: "applied", applied: true };
      },
      authMiddlewareImpl(_request, _response, next) {
        firebaseCalls += 1;
        next();
      },
    }),
  );
  try {
    const response = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
      method: "POST",
      headers: {
        authorization: "exact webhook secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: { padding: "x".repeat(256 * 1024) } }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large" });
    assert.equal(processorCalls, 0);
    assert.equal(firebaseCalls, 0);
  } finally {
    await server.close();
  }
});

test("malformed JSON and malformed event contracts are typed 400 responses", async () => {
  const parsed = [];
  const server = await listen(
    testApp({
      processor: async (result) => {
        parsed.push(result);
        return result.ok
          ? { status: 200, disposition: "applied", applied: true }
          : { status: 400, disposition: "malformed_event" };
      },
    }),
  );
  try {
    const malformedJson = await fetch(
      `${server.origin}/api/webhooks/revenuecat`,
      {
        method: "POST",
        headers: {
          authorization: "exact webhook secret",
          "content-type": "application/json",
        },
        body: "{not-json",
      },
    );
    assert.equal(malformedJson.status, 400);
    assert.deepEqual(await malformedJson.json(), { error: "malformed_json" });

    const malformedSchema = await fetch(
      `${server.origin}/api/webhooks/revenuecat`,
      {
        method: "POST",
        headers: {
          authorization: "exact webhook secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event: {} }),
      },
    );
    assert.equal(malformedSchema.status, 400);
    assert.deepEqual(await malformedSchema.json(), {
      received: false,
      applied: false,
      disposition: "malformed_event",
    });
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0], {
      ok: false,
      code: "malformed_event",
      message: "Invalid event identity",
    });
  } finally {
    await server.close();
  }
});

test("only a newly applied result is applied while its terminal duplicate is not", async () => {
  const dispositions = [
    "stale",
    "ignored_unknown",
    "ignored_unmapped",
    "ignored_identity_conflict",
    "ignored_environment",
    "ignored_identity_volume",
    "unsupported_redemption_shape",
    "ignored_deleted",
  ];
  let nextOutcome = {
    status: 200,
    disposition: "applied",
    applied: true,
  };
  let firebaseCalls = 0;
  const server = await listen(
    testApp({
      processor: async () => nextOutcome,
      authMiddlewareImpl(_request, _response, next) {
        firebaseCalls += 1;
        next();
      },
    }),
  );
  try {
    for (const outcome of [
      { status: 200, disposition: "applied", applied: true },
      { status: 200, disposition: "applied", applied: false },
      ...dispositions.map((disposition) => ({ status: 200, disposition })),
    ]) {
      nextOutcome = outcome;
      const response = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
        method: "POST",
        headers: {
          authorization: "exact webhook secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody()),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        received: true,
        applied: outcome.applied === true,
        disposition: outcome.disposition,
      });
    }
    assert.equal(firebaseCalls, 0);
  } finally {
    await server.close();
  }
});

test("collisions are 400 and retryable failures are 503 with bounded Retry-After", async () => {
  let outcome = { status: 400, disposition: "event_collision" };
  const server = await listen(testApp({ processor: async () => outcome }));
  try {
    const send = () =>
      fetch(`${server.origin}/api/webhooks/revenuecat`, {
        method: "POST",
        headers: {
          authorization: "exact webhook secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody()),
      });
    const collision = await send();
    assert.equal(collision.status, 400);
    assert.deepEqual(await collision.json(), {
      received: false,
      applied: false,
      disposition: "event_collision",
    });

    for (const [disposition, requested, expected] of [
      ["processing", undefined, "1"],
      ["transfer_visibility_lag", 1, "1"],
      ["provider_unavailable", 90, "60"],
      ["identity_set_changed", 3.9, "3"],
    ]) {
      outcome = {
        status: 503,
        disposition,
        retryAfterSeconds: requested,
      };
      const response = await send();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), expected);
      assert.deepEqual(await response.json(), {
        received: false,
        applied: false,
        disposition,
      });
    }
  } finally {
    await server.close();
  }
});

test("authorization accepts exactly 1,024 bytes and rejects 1,025 for ASCII and multibyte secrets", async () => {
  const express = requireFromApiPackage("express");
  let calls = 0;
  const processor = async () => {
    calls += 1;
    return { status: 200, disposition: "applied", applied: true };
  };
  const makeBoundaryApp = (webhookSecret) =>
    createApp({
      revenueCatRouter: createRevenueCatWebhookRouter({
        webhookSecret,
        processor,
      }),
      authenticatedRouter: express.Router(),
      authMiddlewareImpl(_request, _response, next) {
        next();
      },
    });
  const asciiSecret = "a".repeat(1_024);
  const multibyteSecret = "é".repeat(512);
  assert.equal(Buffer.byteLength(asciiSecret, "utf8"), 1_024);
  assert.equal(Buffer.byteLength(multibyteSecret, "utf8"), 1_024);
  for (const secret of [asciiSecret, multibyteSecret]) {
    const server = await listen(makeBoundaryApp(secret));
    try {
      const accepted = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
        method: "POST",
        headers: { authorization: secret, "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).applied, true);

      const overLimit = `${secret}x`;
      assert.equal(Buffer.byteLength(overLimit, "utf8"), 1_025);
      const rejected = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
        method: "POST",
        headers: {
          authorization: overLimit,
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody()),
      });
      assert.equal(rejected.status, 401);

      const sameLengthMismatch =
        secret === asciiSecret
          ? `${secret.slice(0, -1)}b`
          : `${secret.slice(0, -1)}ê`;
      assert.equal(Buffer.byteLength(sameLengthMismatch, "utf8"), 1_024);
      const mismatched = await fetch(
        `${server.origin}/api/webhooks/revenuecat`,
        {
          method: "POST",
          headers: {
            authorization: sameLengthMismatch,
            "content-type": "application/json",
          },
          body: JSON.stringify(validBody()),
        },
      );
      assert.equal(mismatched.status, 401);
    } finally {
      await server.close();
    }
  }

  const ordinaryServer = await listen(
    testApp({
      processor: async () => {
        calls += 1;
        return { status: 200, disposition: "applied", applied: true };
      },
    }),
  );
  try {
    const response = await fetch(
      `${ordinaryServer.origin}/api/webhooks/revenuecat`,
      {
        method: "POST",
        headers: {
          authorization: "Exact webhook secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody()),
      },
    );
    assert.equal(response.status, 401);
    assert.equal(calls, 2);
  } finally {
    await ordinaryServer.close();
  }
});

test("webhook logs use only bounded request, event, type, and disposition labels", async () => {
  const express = requireFromApiPackage("express");
  const records = [];
  const app = express();
  app.use((request, _response, next) => {
    request.id = "request-log-123";
    request.log = {
      info(fields, message) {
        records.push({ level: "info", fields, message });
      },
      warn(fields, message) {
        records.push({ level: "warn", fields, message });
      },
    };
    next();
  });
  app.use(
    "/api",
    createRevenueCatWebhookRouter({
      webhookSecret: "private-webhook-secret",
      processor: async () => ({
        status: 200,
        disposition: "ignored_unmapped",
      }),
    }),
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
      method: "POST",
      headers: {
        authorization: "private-webhook-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        validBody({ app_user_id: "raw-provider-user-must-not-log" }),
      ),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(records, [
      {
        level: "info",
        fields: {
          requestId: "request-log-123",
          eventId: "event_http_1234",
          eventType: "INITIAL_PURCHASE",
          disposition: "ignored_unmapped",
        },
        message: "Handled RevenueCat webhook",
      },
    ]);
    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes("raw-provider-user-must-not-log"), false);
    assert.equal(serialized.includes("private-webhook-secret"), false);
  } finally {
    await server.close();
  }
});

test("unexpected processor failures are sanitized retryable responses", async () => {
  const express = requireFromApiPackage("express");
  const records = [];
  const app = express();
  app.use((request, _response, next) => {
    request.id = "request-failure-123";
    request.log = {
      error(fields, message) {
        records.push({ fields, message });
      },
    };
    next();
  });
  app.use(
    "/api",
    createRevenueCatWebhookRouter({
      webhookSecret: "private-webhook-secret",
      processor: async () => {
        throw new Error("private provider response must not escape");
      },
    }),
  );
  const server = await listen(app);
  try {
    const response = await fetch(`${server.origin}/api/webhooks/revenuecat`, {
      method: "POST",
      headers: {
        authorization: "private-webhook-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(validBody()),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.deepEqual(await response.json(), {
      received: false,
      applied: false,
      disposition: "provider_unavailable",
    });
    assert.deepEqual(records, [
      {
        fields: {
          requestId: "request-failure-123",
          eventId: "event_http_1234",
          eventType: "INITIAL_PURCHASE",
          disposition: "provider_unavailable",
        },
        message: "RevenueCat webhook processor failed",
      },
    ]);
    assert.equal(
      JSON.stringify(records).includes("private provider response"),
      false,
    );
  } finally {
    await server.close();
  }
});
