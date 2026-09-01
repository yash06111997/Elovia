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
    original_app_user_id: "firebase-user-a",
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
  "PRODUCT_CHANGE",
  "TRANSFER",
  "SUBSCRIPTION_PAUSED",
]);

function assertDeliveryStringsAreWellFormed(delivery) {
  const strings = [
    delivery.eventId,
    delivery.type,
    delivery.userId,
    delivery.originalUserId,
    delivery.metadata.productId,
    ...delivery.metadata.entitlementIds,
    delivery.metadata.store,
    delivery.metadata.environment,
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
  assert.deepEqual(
    [...RECONCILING_REVENUECAT_EVENTS].sort(),
    [...EXPECTED_RECONCILING_REVENUECAT_EVENTS].sort(),
  );
  for (const type of EXPECTED_RECONCILING_REVENUECAT_EVENTS) {
    const body = structuredClone(valid);
    body.event.type = type;
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.requiresReconciliation, true, type);
    assert.equal(parsed.value.disposition, "pending", type);
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
