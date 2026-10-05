import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);
const requireFromApiPackage = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);

let createApp;
let express;
let unregisterTsx;

before(async () => {
  const { register } = requireFromScriptsPackage("tsx/esm/api");
  unregisterTsx = register();
  ({ createApp } = await import("../../artifacts/api-server/src/app.ts"));
  express = requireFromApiPackage("express");
});

after(async () => {
  await unregisterTsx?.();
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

function testApp(environment = {}) {
  const api = express.Router();
  api.get("/probe", (_req, res) => res.json({ ok: true }));
  api.post("/ordinary", (req, res) =>
    res.json({ bytes: req.body?.payload?.length ?? 0 }),
  );
  api.post("/ai/recognize-food", (req, res) =>
    res.json({ bytes: req.body?.payload?.length ?? 0 }),
  );
  api.post("/user-data", (req, res) =>
    res.json({ bytes: req.body?.payload?.length ?? 0 }),
  );

  return createApp({
    revenueCatRouter: express.Router(),
    authenticatedRouter: api,
    authMiddlewareImpl(_req, _res, next) {
      next();
    },
    environment,
  });
}

test("production CORS allows trusted browser origins without enabling credentialed wildcard access", async () => {
  const server = await listen(
    testApp({
      NODE_ENV: "production",
      PUBLIC_DOMAIN: "elovia-production.up.railway.app",
      CORS_ALLOWED_ORIGINS: "https://operations.elovia.example",
    }),
  );

  try {
    const untrusted = await fetch(`${server.origin}/api/probe`, {
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(untrusted.status, 200);
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
    assert.equal(
      untrusted.headers.get("access-control-allow-credentials"),
      null,
    );

    for (const trustedOrigin of [
      "https://elovia-production.up.railway.app",
      "https://operations.elovia.example",
    ]) {
      const trusted = await fetch(`${server.origin}/api/probe`, {
        headers: { Origin: trustedOrigin },
      });
      assert.equal(trusted.status, 200);
      assert.equal(
        trusted.headers.get("access-control-allow-origin"),
        trustedOrigin,
      );
      assert.equal(
        trusted.headers.get("access-control-allow-credentials"),
        null,
      );
    }

    const nativeRequest = await fetch(`${server.origin}/api/probe`);
    assert.equal(nativeRequest.status, 200);
    assert.deepEqual(await nativeRequest.json(), { ok: true });
    assert.equal(
      nativeRequest.headers.get("access-control-allow-origin"),
      null,
    );
  } finally {
    await server.close();
  }
});

test("the API suppresses framework disclosure and adds baseline response protections", async () => {
  const server = await listen(testApp({ NODE_ENV: "production" }));
  try {
    const response = await fetch(`${server.origin}/api/probe`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  } finally {
    await server.close();
  }
});

test("ordinary JSON is tightly bounded while photo analysis and cloud sync retain larger budgets", async () => {
  const server = await listen(testApp({ NODE_ENV: "production" }));
  const payload = JSON.stringify({ payload: "x".repeat(1_100_000) });

  try {
    const ordinary = await fetch(`${server.origin}/api/ordinary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assert.equal(ordinary.status, 413);
    assert.equal((await ordinary.json()).error.code, "PAYLOAD_TOO_LARGE");

    for (const path of ["ai/recognize-food", "user-data"]) {
      const response = await fetch(`${server.origin}/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { bytes: 1_100_000 });
    }
  } finally {
    await server.close();
  }
});
