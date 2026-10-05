import assert from "node:assert/strict";
import test from "node:test";
import { resolveNormalizedEntitlement } from "../../artifacts/api-server/src/lib/revenuecatWorkerCore.ts";

const now = new Date("2026-10-05T00:00:00Z");
const base = { now, userCreatedAt: now, canonicalizationState: "canonical", proEntitlementId: "Elovia Pro", coachingEntitlementId: "Elovia Coaching", expectedEnvironment: "production" };
const row = { entitlementId: "Elovia Pro", active: true, status: "trial", accessEndsAt: new Date("2026-10-19T00:00:00Z"), productId: "elovia_pro_yearly", sourceEnvironment: "production" };

test("new accounts without a verified annual subscription remain free", () => {
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [] }).hasProAccess, false);
  assert.equal(resolveNormalizedEntitlement({ ...base, canonicalizationState: "pending", rows: [row] }).hasProAccess, false);
});
test("verified annual store trials grant trial access; monthly trials never do", () => {
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [row] }).tier, "trial");
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, productId: "elovia_pro_yearly:yearly" }] }).hasProAccess, true);
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, productId: "elovia_pro_monthly" }] }).hasProAccess, false);
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, accessEndsAt: now }] }).hasProAccess, false);
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, accessEndsAt: null }] }).hasProAccess, false);
});
test("paid monthly access and coaching remain available without account-age trials", () => {
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, productId: "elovia_pro_monthly", status: "active" }] }).tier, "premium");
  assert.equal(resolveNormalizedEntitlement({ ...base, rows: [{ ...row, entitlementId: "Elovia Coaching", productId: "elovia_coaching_monthly", status: "active" }] }).hasCoaching, true);
});
