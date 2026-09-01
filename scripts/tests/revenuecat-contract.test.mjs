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
  for (const type of RECONCILING_REVENUECAT_EVENTS) {
    const body = structuredClone(valid);
    body.event.type = type;
    const parsed = parseRevenueCatDelivery(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.requiresReconciliation, true, type);
  }
});

test("bounds entitlement metadata strings, filters non-strings, and limits count", () => {
  const body = structuredClone(valid);
  const entitlementIds = [
    "x".repeat(129),
    ...Array.from({ length: 16 }, (_, index) => `entitlement-${index + 2}`),
  ];
  body.event.entitlement_ids = [entitlementIds[0], 42, ...entitlementIds.slice(1)];
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, true);
  const expected = entitlementIds.slice(0, 16).map((value) => value.slice(0, 128));
  assert.deepEqual(parsed.value.metadata.entitlementIds, expected);
  assert.equal(parsed.value.metadata.entitlementIds.length, 16);
  assert.equal(parsed.value.metadata.entitlementIds.every((value) => value.length <= 128), true);
});

test("rejects source timestamps outside the JavaScript Date range", () => {
  const body = structuredClone(valid);
  body.event.event_timestamp_ms = Number.MAX_SAFE_INTEGER;
  const parsed = parseRevenueCatDelivery(body);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "malformed_event");
});
