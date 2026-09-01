import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRevenueCatDelivery,
  RECONCILING_REVENUECAT_EVENTS,
} from "../../artifacts/api-server/src/lib/revenuecatContract.ts";

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
