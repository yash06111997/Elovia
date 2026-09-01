import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseRevenueCatDelivery,
  RECONCILING_REVENUECAT_EVENTS,
} from "../../artifacts/api-server/src/lib/revenuecatContract.ts";
import {
  loadRevenueCatConfig,
} from "../../artifacts/api-server/src/lib/revenuecatConfig.ts";
import {
  createRevenueCatClient,
  RevenueCatClientError,
  trustAuthenticatedLocalUid,
} from "../../artifacts/api-server/src/lib/revenuecatClient.ts";
import {
  parseCanonicalRevenueCatSnapshot,
  projectRevenueCatSnapshot,
} from "../../artifacts/api-server/src/lib/revenuecatSnapshot.ts";

const valid = {
  api_version: "1.0",
  event: {
    id: "12345678-1234-1234-1234-123456789012",
    type: "RENEWAL",
    event_timestamp_ms: 1_725_000_000_000,
    app_user_id: "firebase-user-a",
    original_app_user_id: "$RCAnonymousID:original-a",
    aliases: [
      "$RCAnonymousID:alias-a",
      "firebase-user-a",
      "$RCAnonymousID:original-a",
      "$RCAnonymousID:alias-a",
      "firebase-user-b",
      "firebase-user-a",
    ],
    entitlement_ids: ["Elovia Pro", "Elovia Coaching"],
    product_id: "elovia_yearly",
    store: "APP_STORE",
    environment: "PRODUCTION",
  },
};

const EXPECTED_RECONCILING_REVENUECAT_EVENTS = Object.freeze([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "EXPIRATION",
  "BILLING_ISSUE",
  "REFUND",
  "REFUND_REVERSED",
  "PRODUCT_CHANGE",
  "TRANSFER",
  "SUBSCRIPTION_PAUSED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "PURCHASE_REDEEMED",
]);

const transfer = {
  api_version: "1.0",
  event: {
    id: "transfer-12345678",
    type: "TRANSFER",
    event_timestamp_ms: 1_725_000_000_001,
    transferred_from: [
      "$RCAnonymousID:transfer-from",
      "shared-identity",
      "$RCAnonymousID:transfer-from",
    ],
    transferred_to: [
      "firebase-transfer-to",
      "shared-identity",
      "firebase-transfer-to",
    ],
  },
};

function purchaseRedeemed(outcome = "alias") {
  return {
    api_version: "1.0",
    event: {
      id: `redeemed-${outcome}-12345678`,
      type: "PURCHASE_REDEEMED",
      event_timestamp_ms: 1_725_000_000_002,
      redeemed_from: [
        "$RCAnonymousID:redeemed-from",
        "shared-redemption",
        "$RCAnonymousID:redeemed-from",
      ],
      redeemed_by: [
        "firebase-redeemer",
        "shared-redemption",
        "firebase-redeemer",
      ],
      redemption_outcome: outcome,
    },
  };
}

function assertDeliveryStringsAreWellFormed(delivery) {
  const strings = [
    delivery.eventId,
    delivery.type,
    delivery.metadata.productId,
    ...delivery.metadata.entitlementIds,
    delivery.metadata.store,
    delivery.metadata.environment,
    ...(delivery.kind === "ordinary"
      ? [delivery.userId, delivery.originalUserId, ...delivery.aliases]
      : delivery.kind === "transfer"
        ? [...delivery.transferredFrom, ...delivery.transferredTo]
        : [...delivery.redeemedFrom, ...delivery.redeemedBy]),
  ].filter((value) => typeof value === "string");
  for (const value of strings) assert.equal(value.isWellFormed(), true, value);
}

test("requires a bounded id, type, source timestamp, and app user id", () => {
  for (const field of ["id", "type", "event_timestamp_ms", "app_user_id"]) {
    const body = structuredClone(valid);
    delete body.event[field];
    assert.equal(parseRevenueCatDelivery(body).ok, false, field);
  }
});

test("unknown events are valid but never state-changing", () => {
  const body = structuredClone(valid);
  body.event.type = "FUTURE_REVENUECAT_EVENT";
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.disposition, "ignored_unknown");
  assert.equal(parsed.value.requiresReconciliation, false);
});

test("every recognized access event reconciles canonical state", () => {
  const runtimeSet = RECONCILING_REVENUECAT_EVENTS;
  assert.equal(RECONCILING_REVENUECAT_EVENTS instanceof Set, true);
  assert.equal(typeof RECONCILING_REVENUECAT_EVENTS.has, "function");
  assert.deepEqual(
    [...RECONCILING_REVENUECAT_EVENTS].sort(),
    [...EXPECTED_RECONCILING_REVENUECAT_EVENTS].sort(),
  );
  for (const type of EXPECTED_RECONCILING_REVENUECAT_EVENTS) {
    assert.equal(RECONCILING_REVENUECAT_EVENTS.has(type), true, type);
    if (type === "TRANSFER" || type === "PURCHASE_REDEEMED") continue;
    const body = structuredClone(valid);
    body.event.type = type;
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.requiresReconciliation, true, type);
    assert.equal(parsed.value.disposition, "pending", type);
  }
  assert.strictEqual(RECONCILING_REVENUECAT_EVENTS, runtimeSet);
});

test("ordinary deliveries combine identities with first-seen deduplication", () => {
  const parsed = parseRevenueCatDelivery(structuredClone(valid));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.kind, "ordinary");
  assert.equal(parsed.value.userId, "firebase-user-a");
  assert.equal(parsed.value.originalUserId, "$RCAnonymousID:original-a");
  assert.deepEqual(parsed.value.aliases, [
    "$RCAnonymousID:alias-a",
    "firebase-user-b",
  ]);
  assert.deepEqual(
    [
      parsed.value.userId,
      parsed.value.originalUserId,
      ...parsed.value.aliases,
    ],
    [
      "firebase-user-a",
      "$RCAnonymousID:original-a",
      "$RCAnonymousID:alias-a",
      "firebase-user-b",
    ],
  );
});

test("TRANSFER uses its official sides without requiring app_user_id", () => {
  const parsed = parseRevenueCatDelivery(structuredClone(transfer));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.kind, "transfer");
  assert.equal(parsed.value.type, "TRANSFER");
  assert.equal(parsed.value.requiresReconciliation, true);
  assert.equal(parsed.value.disposition, "pending");
  assert.deepEqual(parsed.value.transferredFrom, [
    "$RCAnonymousID:transfer-from",
    "shared-identity",
  ]);
  assert.deepEqual(parsed.value.transferredTo, [
    "firebase-transfer-to",
    "shared-identity",
  ]);
  assert.equal("userId" in parsed.value, false);
});

test("rejects TRANSFER deliveries with an empty identity side", () => {
  for (const field of ["transferred_from", "transferred_to"]) {
    const body = structuredClone(transfer);
    body.event[field] = [];
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, false, field);
    assert.equal(parsed.code, "malformed_event", field);
  }
});

test("PURCHASE_REDEEMED models every official redemption outcome", () => {
  for (const outcome of ["alias", "transfer", "redeemer_owns"]) {
    const parsed = parseRevenueCatDelivery(purchaseRedeemed(outcome));
    assert.equal(parsed.ok, true, outcome);
    assert.equal(parsed.value.kind, "purchase_redeemed", outcome);
    assert.equal(parsed.value.type, "PURCHASE_REDEEMED", outcome);
    assert.equal(parsed.value.redemptionOutcome, outcome);
    assert.deepEqual(parsed.value.redeemedFrom, [
      "$RCAnonymousID:redeemed-from",
      "shared-redemption",
    ]);
    assert.deepEqual(parsed.value.redeemedBy, [
      "firebase-redeemer",
      "shared-redemption",
    ]);
    assert.equal(parsed.value.requiresReconciliation, true);
    assert.equal("userId" in parsed.value, false);
  }
});

test("PURCHASE_REDEEMED accepts an omitted or null redeemed_from", () => {
  for (const redeemedFrom of [undefined, null]) {
    const body = purchaseRedeemed();
    if (redeemedFrom === undefined) delete body.event.redeemed_from;
    else body.event.redeemed_from = redeemedFrom;
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, true, String(redeemedFrom));
    assert.equal(parsed.value.kind, "purchase_redeemed");
    assert.deepEqual(parsed.value.redeemedFrom, []);
    assert.deepEqual(parsed.value.redeemedBy, [
      "firebase-redeemer",
      "shared-redemption",
    ]);
  }
});

test("accepts 256 combined identities and acknowledges larger identity sets", () => {
  const atLimit = structuredClone(valid);
  atLimit.event.original_app_user_id = atLimit.event.app_user_id;
  atLimit.event.aliases = Array.from(
    { length: 255 },
    (_, index) => `identity-${index}`,
  );
  const accepted = parseRevenueCatDelivery(atLimit);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.aliases.length, 255);

  const aboveCombinedLimit = structuredClone(atLimit);
  aboveCombinedLimit.event.aliases.push("identity-256");
  const combinedRejected = parseRevenueCatDelivery(aboveCombinedLimit);
  assert.equal(combinedRejected.ok, false);
  assert.equal(combinedRejected.code, "ignored_identity_volume");

  const excessiveRawVolume = structuredClone(valid);
  excessiveRawVolume.event.original_app_user_id = excessiveRawVolume.event.app_user_id;
  excessiveRawVolume.event.aliases = Array.from(
    { length: 257 },
    () => "$RCAnonymousID:duplicate",
  );
  const rawRejected = parseRevenueCatDelivery(excessiveRawVolume);
  assert.equal(rawRejected.ok, false);
  assert.equal(rawRejected.code, "ignored_identity_volume");
});

test("bounds identity strings by Unicode code points", () => {
  const astral256 = "😀".repeat(256);
  const astral257 = `${astral256}😀`;

  const ordinary = structuredClone(valid);
  ordinary.event.app_user_id = astral256;
  ordinary.event.original_app_user_id = null;
  ordinary.event.aliases = ["ordinary-alias"];
  const acceptedOrdinary = parseRevenueCatDelivery(ordinary);
  assert.equal(acceptedOrdinary.ok, true);
  assert.equal(acceptedOrdinary.value.userId, astral256);

  ordinary.event.app_user_id = astral257;
  const rejectedOrdinary = parseRevenueCatDelivery(ordinary);
  assert.equal(rejectedOrdinary.ok, false);
  assert.equal(rejectedOrdinary.code, "malformed_event");

  const ordinaryAlias = structuredClone(valid);
  ordinaryAlias.event.original_app_user_id = null;
  ordinaryAlias.event.aliases = [astral256];
  const acceptedAlias = parseRevenueCatDelivery(ordinaryAlias);
  assert.equal(acceptedAlias.ok, true);
  assert.deepEqual(acceptedAlias.value.aliases, [astral256]);

  ordinaryAlias.event.aliases = [astral257];
  const rejectedAlias = parseRevenueCatDelivery(ordinaryAlias);
  assert.equal(rejectedAlias.ok, false);
  assert.equal(rejectedAlias.code, "malformed_event");

  const specialCases = [
    { body: structuredClone(transfer), field: "transferred_from" },
    { body: purchaseRedeemed(), field: "redeemed_by" },
  ];
  for (const { body, field } of specialCases) {
    body.event[field] = [astral256];
    const accepted = parseRevenueCatDelivery(body);
    assert.equal(accepted.ok, true, `${body.event.type} 256`);
    assert.deepEqual(
      accepted.value[
        field === "transferred_from" ? "transferredFrom" : "redeemedBy"
      ],
      [astral256],
    );

    body.event[field] = [astral257];
    const rejected = parseRevenueCatDelivery(body);
    assert.equal(rejected.ok, false, `${body.event.type} 257`);
    assert.equal(rejected.code, "malformed_event", body.event.type);
  }
});

test("applies identity-volume bounds to transfer and redemption branches", () => {
  for (const body of [structuredClone(transfer), purchaseRedeemed()]) {
    const event = body.event;
    const firstKey =
      event.type === "TRANSFER" ? "transferred_from" : "redeemed_from";
    const secondKey =
      event.type === "TRANSFER" ? "transferred_to" : "redeemed_by";
    event[firstKey] = Array.from(
      { length: 128 },
      (_, index) => `from-${index}`,
    );
    event[secondKey] = Array.from(
      { length: 128 },
      (_, index) => `to-${index}`,
    );
    assert.equal(parseRevenueCatDelivery(body).ok, true, event.type);

    event[secondKey].push("identity-257");
    const rejected = parseRevenueCatDelivery(body);
    assert.equal(rejected.ok, false, event.type);
    assert.equal(rejected.code, "ignored_identity_volume", event.type);

    event[firstKey] = Array.from({ length: 257 }, () => "duplicate");
    event[secondKey] = ["destination"];
    const rawRejected = parseRevenueCatDelivery(body);
    assert.equal(rawRejected.ok, false, event.type);
    assert.equal(rawRejected.code, "ignored_identity_volume", event.type);
  }
});

test("acknowledges unsupported PURCHASE_REDEEMED shapes", () => {
  for (const mutate of [
    (event) => delete event.redemption_outcome,
    (event) => (event.redemption_outcome = "future_outcome"),
    (event) => delete event.redeemed_by,
    (event) => (event.redeemed_by = []),
  ]) {
    const body = purchaseRedeemed();
    mutate(body.event);
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "unsupported_redemption_shape");
  }
});

test("bounds entitlement metadata strings, filters non-strings, and limits count", () => {
  const body = structuredClone(valid);
  const entitlementIds = [
    "x".repeat(129),
    ...Array.from({ length: 16 }, (_, index) => `entitlement-${index + 2}`),
  ];
  body.event.entitlement_ids = [
    entitlementIds[0],
    42,
    ...entitlementIds.slice(1),
  ];
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, true);
  const expected = entitlementIds
    .slice(0, 16)
    .map((value) => value.slice(0, 128));
  assert.deepEqual(parsed.value.metadata.entitlementIds, expected);
  assert.equal(parsed.value.metadata.entitlementIds.length, 16);
  assert.equal(
    parsed.value.metadata.entitlementIds.every((value) => value.length <= 128),
    true,
  );
});

test("rejects source timestamps outside the JavaScript Date range", () => {
  const body = structuredClone(valid);
  body.event.event_timestamp_ms = Number.MAX_SAFE_INTEGER;
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "malformed_event");
});

test("truncates optional strings without splitting surrogate pairs", () => {
  const body = structuredClone(valid);
  body.event.original_app_user_id = `${"o".repeat(255)}😀`;
  body.event.product_id = `${"p".repeat(255)}😀`;
  body.event.entitlement_ids = [`${"e".repeat(127)}😀`];
  body.event.store = `${"s".repeat(31)}😀`;
  body.event.environment = `${"n".repeat(31)}😀`;
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.originalUserId, "o".repeat(255));
  assert.equal(parsed.value.metadata.productId, "p".repeat(255));
  assert.deepEqual(parsed.value.metadata.entitlementIds, ["e".repeat(127)]);
  assert.equal(parsed.value.metadata.store, "s".repeat(31));
  assert.equal(parsed.value.metadata.environment, "n".repeat(31));
  assertDeliveryStringsAreWellFormed(parsed.value);
});

test("rejects malformed Unicode in the required app user id", () => {
  for (const userId of ["firebase-user-\uD800", "firebase-user-\uDC00"]) {
    const body = structuredClone(valid);
    body.event.app_user_id = userId;
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, false, userId);
    assert.equal(parsed.code, "malformed_event", userId);
  }
});

test("drops malformed Unicode from optional string fields", () => {
  const body = structuredClone(valid);
  body.event.original_app_user_id = "original-user-\uD800";
  body.event.product_id = "product-\uDC00";
  body.event.entitlement_ids = [
    "Elovia Pro",
    "entitlement-\uD800",
    "entitlement-\uDC00",
  ];
  body.event.store = "store-\uD800";
  body.event.environment = "environment-\uDC00";
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.originalUserId, null);
  assert.deepEqual(parsed.value.metadata, {
    productId: null,
    entitlementIds: ["Elovia Pro"],
    store: null,
    environment: null,
  });
  assertDeliveryStringsAreWellFormed(parsed.value);
});

const CONFIG_ENV = Object.freeze({
  REVENUECAT_WEBHOOK_SECRET: "webhook-secret",
  REVENUECAT_SECRET_API_KEY: "secret-api-key",
  REVENUECAT_SUBJECT_HASH_KEY: "h".repeat(32),
  REVENUECAT_PRO_ENTITLEMENT_ID: "Elovia Pro",
  REVENUECAT_COACHING_ENTITLEMENT_ID: "Elovia Coaching",
  REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([
    { id: "pro_auto", kind: "auto_renewing" },
    { id: "pro_prepaid", kind: "prepaid" },
    { id: "pro_promo", kind: "promotional" },
    { id: "pro_lifetime", kind: "lifetime" },
    { id: "pro_fixed", kind: "non_renewing", accessDays: 30 },
  ]),
  REVENUECAT_COACHING_PRODUCTS_JSON: JSON.stringify([
    { id: "coaching_auto", kind: "auto_renewing" },
  ]),
  REVENUECAT_ENVIRONMENT: "production",
  REVENUECAT_NORMALIZED_READS: "per_user",
});

const SNAPSHOT_MS = Date.parse("2026-09-01T12:00:00.000Z");
const DAY = 86_400_000;

function config(overrides = {}) {
  return loadRevenueCatConfig({ ...CONFIG_ENV, ...overrides });
}

function rawSnapshot(overrides = {}) {
  return {
    request_date_ms: SNAPSHOT_MS,
    subscriber: {
      entitlements: {},
      subscriptions: {},
      non_subscriptions: {},
      ...overrides,
    },
  };
}

function subscription(overrides = {}) {
  return {
    purchase_date: new Date(SNAPSHOT_MS - 30 * DAY).toISOString(),
    original_purchase_date: new Date(SNAPSHOT_MS - 60 * DAY).toISOString(),
    expires_date: new Date(SNAPSHOT_MS + 30 * DAY).toISOString(),
    is_sandbox: false,
    store: "app_store",
    ownership_type: "purchased",
    period_type: "normal",
    ...overrides,
  };
}

function parseSnapshot(raw, options = {}) {
  return parseCanonicalRevenueCatSnapshot(raw, {
    requestStartedAt: new Date(SNAPSHOT_MS - 1_000),
    responseReceivedAt: new Date(SNAPSHOT_MS + 1_000),
    ...options,
  });
}

function projected(raw, configOverrides = {}, operationId = "worker:lease-12345678") {
  const snapshot = parseSnapshot(raw);
  return projectRevenueCatSnapshot({
    snapshot,
    config: config(configOverrides),
    operationId,
  });
}

test("RevenueCat configuration is immutable and preserves exact valid values", () => {
  const loaded = config();
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.proProducts), true);
  assert.equal(Object.isFrozen(loaded.proProducts[0]), true);
  assert.equal(loaded.webhookSecret, CONFIG_ENV.REVENUECAT_WEBHOOK_SECRET);
  assert.equal(loaded.apiKey, CONFIG_ENV.REVENUECAT_SECRET_API_KEY);
  assert.equal(loaded.environment, "production");
  assert.equal(loaded.normalizedReads, "per_user");
  assert.throws(() => loaded.proProducts.push({ id: "x", kind: "lifetime" }));
});

test("RevenueCat configuration rejects missing, blank, and byte-bounded secrets", () => {
  for (const key of [
    "REVENUECAT_WEBHOOK_SECRET",
    "REVENUECAT_SECRET_API_KEY",
    "REVENUECAT_SUBJECT_HASH_KEY",
    "REVENUECAT_PRO_ENTITLEMENT_ID",
    "REVENUECAT_COACHING_ENTITLEMENT_ID",
    "REVENUECAT_PRO_PRODUCTS_JSON",
    "REVENUECAT_COACHING_PRODUCTS_JSON",
    "REVENUECAT_ENVIRONMENT",
    "REVENUECAT_NORMALIZED_READS",
  ]) {
    assert.throws(() => config({ [key]: undefined }), /RevenueCat configuration/i, key);
    assert.throws(() => config({ [key]: "   " }), /RevenueCat configuration/i, key);
  }
  for (const key of ["REVENUECAT_WEBHOOK_SECRET", "REVENUECAT_SECRET_API_KEY"]) {
    assert.throws(() => config({ [key]: "😀".repeat(257) }), /RevenueCat configuration/i, key);
  }
  assert.throws(
    () => config({ REVENUECAT_SUBJECT_HASH_KEY: "😀".repeat(7) }),
    /RevenueCat configuration/i,
  );
  assert.throws(
    () => config({ REVENUECAT_SUBJECT_HASH_KEY: "😀".repeat(257) }),
    /RevenueCat configuration/i,
  );
});

test("RevenueCat configuration rejects unsafe entitlements and product documents", () => {
  const mutations = [
    { REVENUECAT_PRO_ENTITLEMENT_ID: "same", REVENUECAT_COACHING_ENTITLEMENT_ID: "same" },
    { REVENUECAT_PRO_ENTITLEMENT_ID: "__legacy_unverified__" },
    { REVENUECAT_PRO_ENTITLEMENT_ID: "x".repeat(129) },
    { REVENUECAT_PRO_ENTITLEMENT_ID: "bad\u0000id" },
    { REVENUECAT_PRO_ENTITLEMENT_ID: "bad\uD800id" },
    { REVENUECAT_PRO_PRODUCTS_JSON: "{" },
    { REVENUECAT_PRO_PRODUCTS_JSON: "{}" },
    { REVENUECAT_PRO_PRODUCTS_JSON: "[]" },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify(Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, kind: "lifetime" }))) },
    { REVENUECAT_PRO_PRODUCTS_JSON: ` ${JSON.stringify([{ id: "x", kind: "lifetime", pad: "x".repeat(17_000) }])}` },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "dup", kind: "lifetime" }, { id: "dup", kind: "lifetime" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "coaching_auto", kind: "lifetime" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "bad\u0001", kind: "lifetime" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x".repeat(257), kind: "lifetime" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "bad\uD800", kind: "lifetime" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "future" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "non_renewing" }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "non_renewing", accessDays: 0 }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "non_renewing", accessDays: 3661 }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "non_renewing", accessDays: 1.5 }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "lifetime", accessDays: 30 }]) },
    { REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([{ id: "x", kind: "lifetime", extra: true }]) },
    { REVENUECAT_ENVIRONMENT: "staging" },
    { REVENUECAT_NORMALIZED_READS: "legacy" },
  ];
  for (const mutation of mutations) {
    assert.throws(() => config(mutation), /RevenueCat configuration/i, JSON.stringify(mutation).slice(0, 120));
  }
});

test("RevenueCat env template and startup/readiness fail closed without exposing values", async () => {
  const [envTemplate, indexSource, healthSource] = await Promise.all([
    readFile(new URL("../../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../../artifacts/api-server/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../artifacts/api-server/src/routes/health.ts", import.meta.url), "utf8"),
  ]);
  for (const line of [
    "REVENUECAT_WEBHOOK_SECRET=replace-with-the-exact-configured-authorization-header",
    "REVENUECAT_SECRET_API_KEY=replace-with-a-secret-server-api-key",
    "REVENUECAT_SUBJECT_HASH_KEY=replace-with-at-least-32-random-bytes",
    "REVENUECAT_PRO_ENTITLEMENT_ID=Elovia Pro",
    "REVENUECAT_COACHING_ENTITLEMENT_ID=Elovia Coaching",
    'REVENUECAT_PRO_PRODUCTS_JSON=[{"id":"elovia_pro_monthly","kind":"auto_renewing"}]',
    'REVENUECAT_COACHING_PRODUCTS_JSON=[{"id":"elovia_coaching_monthly","kind":"auto_renewing"}]',
    "REVENUECAT_ENVIRONMENT=production",
    "REVENUECAT_NORMALIZED_READS=per_user",
  ]) assert.match(envTemplate, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(indexSource, /loadRevenueCatConfig\(process\.env\)/);
  assert.match(indexSource, /before listen|revenueCatConfig/u);
  assert.match(healthSource, /loadRevenueCatConfig\(process\.env\)/);
  assert.doesNotMatch(healthSource, /apiKey|webhookSecret|subjectHashKey/);
});

test("RevenueCat client URL-encodes a trusted UID and distinguishes 200 from Get-or-Create 201", async () => {
  for (const [status, lookup] of [[200, "existing"], [201, "created"]]) {
    let call;
    const client = createRevenueCatClient({
      apiKey: "secret-key",
      clock: () => new Date(SNAPSHOT_MS),
      fetchImpl: async (url, init) => {
        call = { url, init };
        return new Response(JSON.stringify(rawSnapshot()), {
          status,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
    });
    const result = await client.getSubscriber(trustAuthenticatedLocalUid("firebase/user + one"));
    assert.equal(result.lookup, lookup);
    assert.equal(result.snapshot.sourceSnapshotAt.getTime(), SNAPSHOT_MS);
    assert.equal("provisionLocalUser" in result, false);
    assert.equal("trial" in result, false);
    assert.equal(call.url, "https://api.revenuecat.com/v1/subscribers/firebase%2Fuser%20%2B%20one");
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.headers.Authorization, "Bearer secret-key");
    assert.equal(call.init.headers.Accept, "application/json");
  }
});

test("RevenueCat client returns typed sanitized status, network, and timeout failures", async () => {
  const cases = [
    [400, "revenuecat_request_invalid", false],
    [401, "revenuecat_configuration_invalid", false],
    [418, "canonical_response_invalid", true],
    [429, "revenuecat_unavailable", true],
    [500, "revenuecat_unavailable", true],
  ];
  for (const [status, code, retryable] of cases) {
    const client = createRevenueCatClient({
      apiKey: "secret-key",
      clock: () => new Date(SNAPSHOT_MS),
      fetchImpl: async () => new Response("private-provider-body", { status }),
    });
    await assert.rejects(
      client.getSubscriber(trustAuthenticatedLocalUid("private-user")),
      (error) => {
        assert.equal(error instanceof RevenueCatClientError, true);
        assert.equal(error.code, code);
        assert.equal(error.retryable, retryable);
        assert.doesNotMatch(error.message, /private|subscriber_not_found/i);
        return true;
      },
    );
  }

  const networkClient = createRevenueCatClient({
    apiKey: "secret-key",
    clock: () => new Date(SNAPSHOT_MS),
    fetchImpl: async () => { throw new Error("private network detail"); },
  });
  await assert.rejects(
    networkClient.getSubscriber(trustAuthenticatedLocalUid("private-user")),
    (error) => error.code === "revenuecat_unavailable" && error.retryable && !error.message.includes("private"),
  );

  const timeoutClient = createRevenueCatClient({
    apiKey: "secret-key",
    timeoutMs: 10,
    clock: () => new Date(SNAPSHOT_MS),
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });
  await assert.rejects(
    timeoutClient.getSubscriber(trustAuthenticatedLocalUid("private-user")),
    (error) => error.code === "revenuecat_timeout" && error.retryable,
  );

  const bodyTimeoutClient = createRevenueCatClient({
    apiKey: "secret-key",
    timeoutMs: 10,
    clock: () => new Date(SNAPSHOT_MS),
    fetchImpl: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    bodyTimeoutClient.getSubscriber(trustAuthenticatedLocalUid("private-user")),
    (error) => error.code === "revenuecat_timeout" && error.retryable,
  );
});

test("RevenueCat client bounds declared and streamed bytes before parsing", async () => {
  const tooLarge = 1_048_577;
  const declared = createRevenueCatClient({
    apiKey: "secret-key",
    clock: () => new Date(SNAPSHOT_MS),
    fetchImpl: async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(tooLarge) },
    }),
  });
  await assert.rejects(declared.getSubscriber(trustAuthenticatedLocalUid("uid")), (error) => error.code === "canonical_response_invalid");

  const chunk = new Uint8Array(600_000);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const streamed = createRevenueCatClient({
    apiKey: "secret-key",
    clock: () => new Date(SNAPSHOT_MS),
    fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(streamed.getSubscriber(trustAuthenticatedLocalUid("uid")), (error) => error.code === "canonical_response_invalid");
});

test("RevenueCat client rejects content type, UTF-8, JSON, and schema without response.json", async () => {
  const bodies = [
    ["text/plain", new TextEncoder().encode("{}")],
    ["application/json", Uint8Array.from([0xc3, 0x28])],
    ["application/json", new TextEncoder().encode("{")],
    ["application/json", new TextEncoder().encode(JSON.stringify({ request_date_ms: SNAPSHOT_MS }))],
  ];
  for (const [contentType, bytes] of bodies) {
    const client = createRevenueCatClient({
      apiKey: "secret-key",
      clock: () => new Date(SNAPSHOT_MS),
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": contentType } }),
    });
    await assert.rejects(client.getSubscriber(trustAuthenticatedLocalUid("uid")), (error) => error.code === "canonical_response_invalid");
  }
  const source = await readFile(new URL("../../artifacts/api-server/src/lib/revenuecatClient.ts", import.meta.url), "utf8").catch(() => "");
  assert.doesNotMatch(source, /\.json\s*\(/);
  assert.doesNotMatch(source, /attributes/);
  assert.doesNotMatch(source, /subscriber_not_found/);
  assert.match(
    source,
    /return new RevenueCatClientError\("canonical_response_invalid", true, status\)/,
  );
  assert.match(source, /getSubscriber\(uid: TrustedLocalUid\)/);
  assert.match(source, /unique symbol/);
  assert.doesNotMatch(source, /getSubscriber\(uid: string\)/);
});

test("canonical snapshot rejects skew, count, string, enum, date, and product-class shapes", () => {
  const invalids = [];
  invalids.push({ ...rawSnapshot(), request_date_ms: 0 });
  invalids.push({ ...rawSnapshot(), request_date_ms: SNAPSHOT_MS - 6 * 60_000 });
  invalids.push({ ...rawSnapshot(), request_date_ms: SNAPSHOT_MS + 6 * 60_000 });
  invalids.push(rawSnapshot({ entitlements: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`e${i}`, {}])) }));
  invalids.push(rawSnapshot({ subscriptions: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`p${i}`, subscription()])) }));
  invalids.push(rawSnapshot({ non_subscriptions: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`p${i}`, []])) }));
  invalids.push(rawSnapshot({ non_subscriptions: { p: Array.from({ length: 257 }, () => ({ id: "purchase", purchase_date: new Date(SNAPSHOT_MS).toISOString(), is_sandbox: false, store: "app_store" })) } }));
  invalids.push(rawSnapshot({ subscriptions: { ["x".repeat(257)]: subscription() } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ store: "future_store" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ period_type: "future_period" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ ownership_type: "future_owner" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ expires_date: "not-a-date" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ expires_date: "2026-09-02" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ expires_date: "1999-12-31T00:00:00.000Z" }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ expires_date: new Date(SNAPSHOT_MS + 11 * 365 * DAY).toISOString() }) } }));
  invalids.push(rawSnapshot({ subscriptions: { p: subscription({ is_sandbox: "false" }) } }));
  invalids.push(rawSnapshot({ non_subscriptions: {
    first: Array.from({ length: 256 }, (_, i) => ({ id: `first-${i}`, purchase_date: new Date(SNAPSHOT_MS).toISOString(), is_sandbox: false, store: "app_store" })),
    second: Array.from({ length: 256 }, (_, i) => ({ id: `second-${i}`, purchase_date: new Date(SNAPSHOT_MS).toISOString(), is_sandbox: false, store: "app_store" })),
    third: [{ id: "overflow", purchase_date: new Date(SNAPSHOT_MS).toISOString(), is_sandbox: false, store: "app_store" }],
  } }));
  for (const raw of invalids) {
    assert.throws(() => parseSnapshot(raw), (error) => error.code === "canonical_response_invalid");
  }
});

test("canonical snapshot ignores unlisted fields without traversing subscriber attributes", () => {
  const attributes = {};
  Object.defineProperty(attributes, "private", { get() { throw new Error("attributes traversed"); } });
  const snapshot = parseSnapshot(rawSnapshot({
    attributes,
    extra: { private: "ignored" },
    subscriptions: { pro_auto: { ...subscription(), extra: "ignored" } },
  }));
  assert.equal(snapshot.subscriptions.pro_auto.productId, "pro_auto");
  assert.equal("extra" in snapshot.subscriptions.pro_auto, false);
  assert.equal("attributes" in snapshot, false);
});

test("snapshot projection enforces pointers, environment, source class, and period contracts", () => {
  const pointerMismatch = rawSnapshot({
    entitlements: { "Elovia Pro": { product_identifier: "not_allowed" } },
    subscriptions: { pro_auto: subscription() },
  });
  assert.throws(() => projected(pointerMismatch), (error) => error.code === "canonical_mapping_mismatch");

  const wrongClass = rawSnapshot({ subscriptions: { pro_lifetime: subscription() } });
  assert.throws(() => projected(wrongClass), (error) => error.code === "canonical_mapping_mismatch");
  assert.throws(
    () => projected(rawSnapshot({ subscriptions: { pro_prepaid: subscription({ period_type: "normal" }) } })),
    (error) => error.code === "canonical_mapping_mismatch",
  );
  assert.throws(
    () => projected(rawSnapshot({ subscriptions: { pro_promo: subscription({ period_type: "normal", store: "app_store" }) } })),
    (error) => error.code === "canonical_mapping_mismatch",
  );

  const filtered = projected(rawSnapshot({ subscriptions: {
    pro_auto: subscription({ is_sandbox: true, store: "test_store" }),
  } }));
  assert.equal(filtered[0].active, false);
  assert.equal(filtered[0].productId, null);
});

test("snapshot projection filters environment before wrong-collection mapping checks", () => {
  const purchase = (isSandbox, store) => ({
    id: `${store}-purchase`,
    purchase_date: new Date(SNAPSHOT_MS - DAY).toISOString(),
    is_sandbox: isSandbox,
    store,
  });
  const irrelevantWrongCollections = [
    [
      {},
      rawSnapshot({
        subscriptions: {
          pro_lifetime: subscription({ is_sandbox: true, store: "test_store" }),
        },
        non_subscriptions: {
          pro_auto: [purchase(true, "test_store")],
        },
      }),
    ],
    [
      { REVENUECAT_ENVIRONMENT: "sandbox" },
      rawSnapshot({
        subscriptions: {
          pro_lifetime: subscription({ is_sandbox: false, store: "app_store" }),
        },
        non_subscriptions: {
          pro_auto: [purchase(false, "app_store")],
        },
      }),
    ],
  ];
  for (const [configOverrides, raw] of irrelevantWrongCollections) {
    const [row] = projected(raw, configOverrides);
    assert.deepEqual(
      [row.active, row.status, row.productId],
      [false, "expired", null],
    );
  }

  const relevantWrongCollections = [
    rawSnapshot({
      subscriptions: { pro_lifetime: subscription() },
      non_subscriptions: { pro_auto: [purchase(false, "app_store")] },
    }),
    rawSnapshot({
      subscriptions: {
        pro_lifetime: subscription({ is_sandbox: true, store: "test_store" }),
      },
      non_subscriptions: { pro_auto: [purchase(true, "test_store")] },
    }),
  ];
  assert.throws(
    () => projected(relevantWrongCollections[0]),
    (error) => error.code === "canonical_mapping_mismatch",
  );
  assert.throws(
    () => projected(relevantWrongCollections[1], { REVENUECAT_ENVIRONMENT: "sandbox" }),
    (error) => error.code === "canonical_mapping_mismatch",
  );
});

test("snapshot projection treats prototype-like entitlement and product IDs as own keys only", () => {
  const scenarios = [
    ["__proto__", "constructor", "toString", "__proto__"],
    ["toString", "__proto__", "constructor", "toString"],
  ];
  for (const [proEntitlement, coachingEntitlement, proProduct, coachingProduct] of scenarios) {
    const specialConfig = {
      REVENUECAT_PRO_ENTITLEMENT_ID: proEntitlement,
      REVENUECAT_COACHING_ENTITLEMENT_ID: coachingEntitlement,
      REVENUECAT_PRO_PRODUCTS_JSON: JSON.stringify([
        { id: proProduct, kind: "auto_renewing" },
      ]),
      REVENUECAT_COACHING_PRODUCTS_JSON: JSON.stringify([
        { id: coachingProduct, kind: "auto_renewing" },
      ]),
    };

    const absent = projected(rawSnapshot(), specialConfig);
    assert.deepEqual(
      absent.map((row) => [row.entitlementId, row.active, row.productId]),
      [
        [proEntitlement, false, null],
        [coachingEntitlement, false, null],
      ],
    );

    const parsedPresent = parseSnapshot(rawSnapshot({
      entitlements: Object.fromEntries([
        [proEntitlement, { product_identifier: proProduct }],
        [coachingEntitlement, { product_identifier: coachingProduct }],
      ]),
      subscriptions: Object.fromEntries([
        [proProduct, subscription()],
        [coachingProduct, subscription()],
      ]),
    }));
    assert.equal(Object.getPrototypeOf(parsedPresent.entitlements), null);
    assert.equal(Object.getPrototypeOf(parsedPresent.subscriptions), null);
    assert.equal(Object.getPrototypeOf(parsedPresent.nonSubscriptions), null);
    assert.equal(Object.isFrozen(parsedPresent.subscriptions), true);

    const present = projectRevenueCatSnapshot({
      snapshot: parsedPresent,
      config: config(specialConfig),
      operationId: "worker:lease-12345678",
    });
    assert.deepEqual(
      present.map((row) => [row.entitlementId, row.active, row.productId]),
      [
        [proEntitlement, true, proProduct],
        [coachingEntitlement, true, coachingProduct],
      ],
    );
    assert.equal(Object.getPrototypeOf(present[0]), Object.prototype);
  }
});

test("snapshot projector implements subscription truth-table precedence", () => {
  const future = new Date(SNAPSHOT_MS + 30 * DAY).toISOString();
  const grace = new Date(SNAPSHOT_MS + 35 * DAY).toISOString();
  const refund = new Date(SNAPSHOT_MS - DAY).toISOString();
  const rows = [
    [subscription({ refunded_at: refund }), false, "refunded", refund, false],
    [subscription({ billing_issues_detected_at: new Date(SNAPSHOT_MS - DAY).toISOString(), grace_period_expires_date: grace }), true, "grace", grace, true],
    [subscription({ auto_resume_date: new Date(SNAPSHOT_MS + DAY).toISOString() }), true, "paused", future, false],
    [subscription({ unsubscribe_detected_at: new Date(SNAPSHOT_MS - DAY).toISOString() }), true, "cancelled", future, false],
    [subscription({ billing_issues_detected_at: new Date(SNAPSHOT_MS - DAY).toISOString() }), true, "billing_issue", future, true],
    [subscription({ period_type: "trial" }), true, "trial", future, true],
    [subscription({ period_type: "intro" }), true, "intro", future, true],
    [subscription(), true, "active", future, true],
  ];
  for (const [candidate, active, status, accessEnd, willRenew] of rows) {
    const [row] = projected(rawSnapshot({ subscriptions: { pro_auto: candidate } }));
    assert.equal(row.active, active, status);
    assert.equal(row.status, status);
    assert.equal(row.accessEndsAt?.toISOString(), accessEnd, status);
    assert.equal(row.willRenew, willRenew, status);
    assert.equal(row.graceEndsAt?.toISOString() ?? null, status === "grace" ? grace : null, status);
  }
});

test("snapshot projector handles prepaid, promotional, lifetime, non-renewing, expired, and absence", () => {
  const future = new Date(SNAPSHOT_MS + 30 * DAY).toISOString();
  const prepaid = projected(rawSnapshot({ subscriptions: { pro_prepaid: subscription({ period_type: "prepaid" }) } }))[0];
  assert.deepEqual([prepaid.active, prepaid.status, prepaid.willRenew], [true, "prepaid", false]);

  const promotional = projected(rawSnapshot({ subscriptions: { pro_promo: subscription({ period_type: "promotional", store: "promotional" }) } }))[0];
  assert.deepEqual([promotional.active, promotional.status, promotional.willRenew], [true, "promotional", false]);

  const purchase = { id: "purchase-1", purchase_date: new Date(SNAPSHOT_MS - DAY).toISOString(), is_sandbox: false, store: "app_store" };
  const lifetime = projected(rawSnapshot({ non_subscriptions: { pro_lifetime: [purchase] } }))[0];
  assert.deepEqual([lifetime.active, lifetime.status, lifetime.accessEndsAt, lifetime.periodEndsAt], [true, "active", null, null]);

  const fixed = projected(rawSnapshot({ non_subscriptions: { pro_fixed: [purchase] } }))[0];
  assert.equal(fixed.active, true);
  assert.equal(fixed.accessEndsAt?.toISOString(), new Date(SNAPSHOT_MS - DAY + 30 * DAY).toISOString());
  assert.equal(fixed.periodEndsAt?.toISOString(), fixed.accessEndsAt?.toISOString());

  const expired = projected(rawSnapshot({ subscriptions: { pro_auto: subscription({ expires_date: new Date(SNAPSHOT_MS - DAY).toISOString() }) } }))[0];
  assert.deepEqual([expired.active, expired.status, expired.productId], [false, "expired", "pro_auto"]);

  const absent = projected(rawSnapshot())[0];
  assert.deepEqual([absent.active, absent.status, absent.productId, absent.store, absent.accessEndsAt], [false, "expired", null, null, null]);
  assert.equal(future, new Date(SNAPSHOT_MS + 30 * DAY).toISOString());
});

test("snapshot projector deterministically selects candidates and emits exactly two independent rows", () => {
  const raw = rawSnapshot({
    subscriptions: {
      pro_auto: subscription({ expires_date: new Date(SNAPSHOT_MS + 10 * DAY).toISOString() }),
      coaching_auto: subscription({ expires_date: new Date(SNAPSHOT_MS + 20 * DAY).toISOString() }),
    },
    non_subscriptions: {
      pro_lifetime: [{ id: "life", purchase_date: new Date(SNAPSHOT_MS - DAY).toISOString(), is_sandbox: false, store: "app_store" }],
    },
  });
  const rows = projected(raw, {}, "auth:12345678-1234-1234-1234-123456789012");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.entitlementId), ["Elovia Pro", "Elovia Coaching"]);
  assert.equal(rows[0].productId, "pro_lifetime");
  assert.equal(rows[1].productId, "coaching_auto");
  assert.notStrictEqual(rows[0], rows[1]);
  assert.equal(rows[0].sourceSnapshotAt.getTime(), SNAPSHOT_MS);
  assert.equal(rows[0].sourceOperationId, "auth:12345678-1234-1234-1234-123456789012");
  assert.equal(rows[0].sourceKind, "auth_canonical");
});

test("refund-reversed and temporary-grant triggers never override canonical outcomes", () => {
  for (const trigger of ["REFUND_REVERSED", "TEMPORARY_ENTITLEMENT_GRANT"]) {
    const active = projected(rawSnapshot({ subscriptions: { pro_auto: subscription() } }), {}, `webhook:${trigger.toLowerCase().replaceAll("_", "-")}-12345678`)[0];
    const absent = projected(rawSnapshot(), {}, `webhook:${trigger.toLowerCase().replaceAll("_", "-")}-12345678`)[0];
    assert.equal(active.active, true, trigger);
    assert.equal(absent.active, false, trigger);
  }
});
