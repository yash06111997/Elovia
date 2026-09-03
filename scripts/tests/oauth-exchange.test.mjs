import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

import {
  appendOAuthExchangeResult,
  createOpaqueOAuthToken,
  decryptOAuthProviderToken,
  encryptOAuthProviderToken,
  hashOAuthToken,
  isValidOAuthClientState,
  isValidPkceChallenge,
  isValidPkceVerifier,
  pkceChallengeForVerifier,
  secureStringEqual,
} from "../../artifacts/api-server/src/lib/oauthExchangeCrypto.ts";
import {
  assertProductionRuntimeConfigured,
  isAllowedMobileReturnUrl,
  loadGoogleOAuthConfig,
} from "../../artifacts/api-server/src/lib/productionConfig.ts";

const encryptionSecret = "test-google-client-secret-with-enough-entropy";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const schemaName = `elovia_oauth_test_${process.pid}_${Date.now()}`;
const requireFromDatabasePackage = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);

let adminPool;
let scopedPool;
let workspacePool;
let unregisterTsx;
let oauthTransactions;

if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error(
    "CI must provide TEST_DATABASE_URL for OAuth integration tests",
  );
}

function quotedIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function scopedDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
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
    await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schemaName)}`);
    const databaseUrl = scopedDatabaseUrl(testDatabaseUrl);
    const { runMigrations } = await import("../../lib/db/scripts/migrate.mjs");
    await runMigrations(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    const { register } = requireFromScriptsPackage("tsx/esm/api");
    unregisterTsx = register();
    const databaseModule = await import("../../lib/db/src/index.ts");
    workspacePool = databaseModule.pool;
    oauthTransactions =
      await import("../../artifacts/api-server/src/lib/mobileOAuthTransactions.ts");
    scopedPool = new Pool({ connectionString: databaseUrl });
  });

  after(async () => {
    await workspacePool?.end();
    await unregisterTsx?.();
    await scopedPool?.end();
    await adminPool?.query(
      `DROP SCHEMA ${quotedIdentifier(schemaName)} CASCADE`,
    );
    await adminPool?.end();
  });
}

test("PKCE verifier validation and challenge derivation follow the S256 contract", () => {
  const verifier =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~";
  const challenge = pkceChallengeForVerifier(verifier);

  assert.equal(isValidPkceVerifier(verifier), true);
  assert.equal(isValidPkceChallenge(challenge), true);
  assert.equal(challenge.length, 43);
  assert.equal(
    secureStringEqual(challenge, pkceChallengeForVerifier(verifier)),
    true,
  );
  assert.equal(
    secureStringEqual(challenge, pkceChallengeForVerifier(`${verifier}x`)),
    false,
  );

  assert.equal(isValidPkceVerifier("too-short"), false);
  assert.equal(isValidPkceVerifier(`${verifier}!`), false);
  assert.equal(isValidPkceChallenge(`${challenge}=`), false);
});

test("opaque OAuth codes are high entropy and only their hashes need persistence", () => {
  const first = createOpaqueOAuthToken();
  const second = createOpaqueOAuthToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.match(hashOAuthToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashOAuthToken(first), hashOAuthToken(second));
});

test("provider tokens are authenticated-encrypted and reject tampering or a wrong key", () => {
  const providerToken = "google-id-token-that-must-never-enter-a-deep-link";
  const encrypted = encryptOAuthProviderToken(providerToken, encryptionSecret);

  assert.match(
    encrypted,
    /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  );
  assert.equal(encrypted.includes(providerToken), false);
  assert.equal(
    decryptOAuthProviderToken(encrypted, encryptionSecret),
    providerToken,
  );
  assert.throws(
    () => decryptOAuthProviderToken(encrypted, `${encryptionSecret}-wrong`),
    /decrypt/i,
  );

  const parts = encrypted.split(".");
  parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => decryptOAuthProviderToken(parts.join("."), encryptionSecret),
    /decrypt/i,
  );
});

test("the app callback carries only an opaque code and the request state", () => {
  const callback = appendOAuthExchangeResult("elovia://auth", {
    code: createOpaqueOAuthToken(),
    state: "client-state-1234567890",
  });

  assert.match(callback, /^elovia:\/\/auth#code=/);
  assert.match(callback, /&state=client-state-1234567890$/);
  assert.equal(callback.includes("idToken"), false);
  assert.equal(callback.includes("google-id-token"), false);
});

test("client OAuth state is bounded and restricted to URL-safe characters", () => {
  assert.equal(
    isValidOAuthClientState("12345678-1234-1234-1234-123456789abc"),
    true,
  );
  assert.equal(isValidOAuthClientState("short"), false);
  assert.equal(isValidOAuthClientState("x".repeat(129)), false);
  assert.equal(isValidOAuthClientState("valid-length-but-has a-space"), false);
});

test("native OAuth return URLs are exact and Expo callbacks remain development-only", () => {
  assert.equal(isAllowedMobileReturnUrl("elovia://auth", "elovia", true), true);
  assert.equal(
    isAllowedMobileReturnUrl("elovia:///auth", "elovia", true),
    true,
  );
  assert.equal(
    isAllowedMobileReturnUrl("elovia://auth.evil.example", "elovia", true),
    false,
  );
  assert.equal(
    isAllowedMobileReturnUrl(
      "elovia://auth?continue=https://evil.example",
      "elovia",
      true,
    ),
    false,
  );
  assert.equal(
    isAllowedMobileReturnUrl("elovia://auth#existing-fragment", "elovia", true),
    false,
  );
  assert.equal(
    isAllowedMobileReturnUrl("https://evil.example/auth", "elovia", true),
    false,
  );
  assert.equal(
    isAllowedMobileReturnUrl("exp://127.0.0.1:8081/--/auth", "elovia", true),
    false,
  );
  assert.equal(
    isAllowedMobileReturnUrl("exp://127.0.0.1:8081/--/auth", "elovia", false),
    true,
  );
});

test("production readiness fails closed when auth or required AI configuration is absent", () => {
  const completeEnvironment = {
    NODE_ENV: "production",
    GOOGLE_WEB_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: encryptionSecret,
    RAILWAY_PUBLIC_DOMAIN: "elovia.example.com",
    FIREBASE_PROJECT_ID: "elovia-project",
    FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({
      project_id: "elovia-project",
      client_email: "firebase@example.com",
      private_key: "private-key-material",
    }),
    ANTHROPIC_API_KEY: "anthropic-key",
  };

  assert.deepEqual(loadGoogleOAuthConfig(completeEnvironment), {
    clientId: "google-client-id",
    clientSecret: encryptionSecret,
    serverDomain: "elovia.example.com",
    appScheme: "elovia",
  });
  assert.doesNotThrow(() =>
    assertProductionRuntimeConfigured(completeEnvironment),
  );
  assert.throws(
    () =>
      assertProductionRuntimeConfigured({
        ...completeEnvironment,
        ANTHROPIC_API_KEY: "",
      }),
    /ANTHROPIC_API_KEY/,
  );
  assert.throws(
    () =>
      assertProductionRuntimeConfigured({
        ...completeEnvironment,
        FIREBASE_SERVICE_ACCOUNT_KEY: "not-json",
      }),
    /valid FIREBASE_SERVICE_ACCOUNT_KEY/,
  );
  assert.throws(
    () =>
      loadGoogleOAuthConfig(
        {
          ...completeEnvironment,
          RAILWAY_PUBLIC_DOMAIN: "",
        },
        "attacker-controlled.example",
      ),
    /PUBLIC_DOMAIN/,
    "production must not build an OAuth callback from the Host header",
  );
  assert.throws(
    () =>
      loadGoogleOAuthConfig({
        ...completeEnvironment,
        GOOGLE_CLIENT_SECRET: "too-short",
      }),
    /GOOGLE_CLIENT_SECRET/,
  );
});

integrationTest(
  "durable mobile OAuth exchange survives process boundaries, rejects the wrong proof, and consumes once",
  async () => {
    const clientState = "12345678-1234-1234-1234-123456789abc";
    const codeVerifier =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~";
    const providerToken = "provider-token-durable-test";
    const providerState = await oauthTransactions.createMobileOAuthAttempt({
      clientState,
      mode: "redirect",
      returnUrl: "elovia://auth",
      codeChallenge: pkceChallengeForVerifier(codeVerifier),
    });

    const persisted = await scopedPool.query(
      `SELECT provider_state_hash,client_state FROM mobile_oauth_attempts`,
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].client_state, clientState);
    assert.notEqual(persisted.rows[0].provider_state_hash, providerState);

    const claimed =
      await oauthTransactions.claimMobileOAuthAttempt(providerState);
    assert.deepEqual(claimed, {
      id: claimed.id,
      clientState,
      mode: "redirect",
      returnUrl: "elovia://auth",
      codeChallenge: pkceChallengeForVerifier(codeVerifier),
    });
    assert.equal(
      await oauthTransactions.claimMobileOAuthAttempt(providerState),
      null,
      "a second server replica cannot claim the provider callback",
    );

    const exchangeCode = await oauthTransactions.finalizeMobileOAuthExchange({
      attempt: claimed,
      providerToken,
      encryptionSecret,
    });
    assert.ok(exchangeCode);
    const exchangeRow = await scopedPool.query(
      `SELECT exchange_code_hash,encrypted_provider_token FROM mobile_oauth_attempts WHERE id=$1`,
      [claimed.id],
    );
    assert.notEqual(exchangeRow.rows[0].exchange_code_hash, exchangeCode);
    assert.equal(
      exchangeRow.rows[0].encrypted_provider_token.includes(providerToken),
      false,
    );

    assert.deepEqual(
      await oauthTransactions.consumeMobileOAuthExchange({
        exchangeCode,
        clientState,
        codeVerifier: `${codeVerifier}x`,
        encryptionSecret,
      }),
      { status: "invalid" },
    );
    assert.deepEqual(
      await oauthTransactions.consumeMobileOAuthExchange({
        exchangeCode,
        clientState: "wrong-client-state-123456789",
        codeVerifier,
        encryptionSecret,
      }),
      { status: "invalid" },
    );
    assert.deepEqual(
      await oauthTransactions.consumeMobileOAuthExchange({
        exchangeCode,
        clientState,
        codeVerifier,
        encryptionSecret,
      }),
      { status: "redeemed", providerToken },
    );
    assert.deepEqual(
      await oauthTransactions.consumeMobileOAuthExchange({
        exchangeCode,
        clientState,
        codeVerifier,
        encryptionSecret,
      }),
      { status: "invalid" },
    );
    const consumed = await scopedPool.query(
      `SELECT consumed_at,encrypted_provider_token FROM mobile_oauth_attempts WHERE id=$1`,
      [claimed.id],
    );
    assert.ok(consumed.rows[0].consumed_at);
    assert.equal(consumed.rows[0].encrypted_provider_token, null);
  },
);

integrationTest(
  "concurrent redemption has one winner and expired exchange codes fail closed",
  async () => {
    const codeVerifier =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const createExchange = async (clientState, providerToken) => {
      const providerState = await oauthTransactions.createMobileOAuthAttempt({
        clientState,
        mode: "redirect",
        returnUrl: "elovia://auth",
        codeChallenge: pkceChallengeForVerifier(codeVerifier),
      });
      const attempt =
        await oauthTransactions.claimMobileOAuthAttempt(providerState);
      assert.ok(attempt);
      const exchangeCode = await oauthTransactions.finalizeMobileOAuthExchange({
        attempt,
        providerToken,
        encryptionSecret,
      });
      assert.ok(exchangeCode);
      return { attempt, exchangeCode };
    };

    const liveState = "concurrent-client-state-123456789";
    const live = await createExchange(liveState, "one-winner-token");
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        oauthTransactions.consumeMobileOAuthExchange({
          exchangeCode: live.exchangeCode,
          clientState: liveState,
          codeVerifier,
          encryptionSecret,
        }),
      ),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "redeemed").length,
      1,
    );

    const expiredState = "expired-client-state-1234567890";
    const expired = await createExchange(expiredState, "expired-token");
    await scopedPool.query(
      `UPDATE mobile_oauth_attempts
       SET created_at=clock_timestamp()-interval '5 minutes',
           exchange_expires_at=clock_timestamp()-interval '1 second'
       WHERE id=$1`,
      [expired.attempt.id],
    );
    assert.deepEqual(
      await oauthTransactions.consumeMobileOAuthExchange({
        exchangeCode: expired.exchangeCode,
        clientState: expiredState,
        codeVerifier,
        encryptionSecret,
      }),
      { status: "invalid" },
    );
  },
);
