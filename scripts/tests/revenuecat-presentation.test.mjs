import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const requireFromScriptsPackage = createRequire(
  new URL("../package.json", import.meta.url),
);

let buildRevenueCatDiagnostics;
let buildRevenueCatPrivacyExport;
let unregisterTsx;

before(async () => {
  const { register } = requireFromScriptsPackage("tsx/esm/api");
  unregisterTsx = register();
  ({ buildRevenueCatDiagnostics, buildRevenueCatPrivacyExport } =
    await import("../../artifacts/api-server/src/lib/revenuecatPresentation.ts"));
});

after(async () => {
  await unregisterTsx?.();
});

test("diagnostics disclose only configuration presence, bounded counts, and readiness state", () => {
  assert.deepEqual(
    buildRevenueCatDiagnostics({
      configuration: {
        valid: true,
        webhookSecretPresent: true,
        apiKeyPresent: true,
        subjectHashKeyPresent: true,
        proProductCount: 2,
        coachingProductCount: 1,
        normalizedReads: "strict",
        webhookSecret: "never-emit-secret",
        apiKey: "never-emit-api-key",
        subjectHashKey: "never-emit-hmac-key",
      },
      counts: {
        dueEvents: 3,
        failedEvents: 4,
        pendingEvents: 5,
        pendingIdentityPhase: 6,
        pendingEntitlementPhase: 7,
        prunedEvents: 8,
        noncanonicalCustomers: 9,
        missingCustomerStates: 10,
      },
    }),
    {
      configuration: {
        valid: true,
        webhookSecretPresent: true,
        apiKeyPresent: true,
        subjectHashKeyPresent: true,
        proProductCount: 2,
        coachingProductCount: 1,
      },
      events: {
        due: 3,
        failed: 4,
        pending: 5,
        pendingIdentityPhase: 6,
        pendingEntitlementPhase: 7,
        pruned: 8,
      },
      customers: {
        noncanonical: 9,
        missingState: 10,
        hasNoncanonical: true,
      },
      strictMode: true,
      ready: false,
    },
  );

  assert.equal(
    buildRevenueCatDiagnostics({
      configuration: {
        valid: false,
        normalizedReads: "per_user",
      },
      counts: {},
    }).ready,
    false,
  );
  assert.equal(
    buildRevenueCatDiagnostics({
      configuration: { valid: true, normalizedReads: "per_user" },
      counts: { noncanonicalCustomers: 10, missingCustomerStates: 2 },
    }).ready,
    true,
  );
});

test("privacy projection exposes normalized billing state without pseudonymous identifiers", () => {
  const projected = buildRevenueCatPrivacyExport({
    entitlements: [
      {
        userId: "local-user",
        entitlementId: "elovia_pro",
        active: true,
        status: "active",
        productId: "pro_monthly",
        store: "app_store",
        periodEndsAt: new Date("2026-10-01T00:00:00.000Z"),
        graceEndsAt: null,
        accessEndsAt: new Date("2026-10-01T00:00:00.000Z"),
        willRenew: true,
        sourceEnvironment: "production",
        sourceKind: "webhook_canonical",
        sourceSnapshotAt: new Date("2026-09-02T00:00:00.000Z"),
        sourceOperationId: "webhook:event_private_123",
        sourceTriggerEventId: "event_private_123",
        rawPayload: "raw-provider-payload",
      },
    ],
    events: [
      {
        eventId: "event_private_123",
        type: "TRANSFER",
        eventAt: new Date("2026-09-02T00:00:00.000Z"),
        receivedAt: new Date("2026-09-02T00:00:01.000Z"),
        environment: "production",
        disposition: "pending",
        metadata: {
          schemaVersion: 1,
          identityCount: 2,
          redemptionOutcome: "transfer",
          rawPayload: "discard-this",
          aliasHash: "a".repeat(64),
        },
        identityCount: 2,
        retainedIdentityCount: 1,
        prunedIdentityCount: 1,
        identityRequired: true,
        identityAppliedAt: new Date("2026-09-02T00:00:02.000Z"),
        entitlementRequired: true,
        entitlementAppliedAt: null,
        processedAt: null,
        roleMask: 1 | 8 | 16,
        subjectHash: "b".repeat(64),
        localUserId: "local-user",
        lastEvent: { private: true },
        revenuecatUserId: "legacy-raw-revenuecat-id",
      },
    ],
    reconciliation: {
      userId: "local-user",
      canonicalizationState: "pending",
      sourceKind: "none",
      sourceEnvironment: null,
      lastSnapshotAt: null,
      lastOperationId: "provider-operation-private",
      lastReconciledAt: null,
      reconcileReason: "webhook_failure",
      reconcileAfter: new Date("2026-09-02T00:01:00.000Z"),
      reconcileAttemptCount: 2,
      reconcileLeaseId: "private-lease",
      reconcileLeaseUntil: new Date("2026-09-02T00:02:00.000Z"),
      reconcileLastErrorCode: "revenuecat_timeout",
    },
    aliases: [{ aliasHash: "c".repeat(64) }],
    secret: "private-secret",
    providerResponse: { subscriber: "private" },
  });

  assert.deepEqual(projected, {
    label: "RevenueCat billing entitlement state",
    entitlements: [
      {
        entitlementId: "elovia_pro",
        active: true,
        status: "active",
        productId: "pro_monthly",
        store: "app_store",
        periodEndsAt: "2026-10-01T00:00:00.000Z",
        graceEndsAt: null,
        accessEndsAt: "2026-10-01T00:00:00.000Z",
        willRenew: true,
        sourceEnvironment: "production",
        sourceKind: "webhook_canonical",
        sourceSnapshotAt: "2026-09-02T00:00:00.000Z",
      },
    ],
    events: [
      {
        eventId: "event_private_123",
        type: "TRANSFER",
        eventAt: "2026-09-02T00:00:00.000Z",
        receivedAt: "2026-09-02T00:00:01.000Z",
        environment: "production",
        disposition: "pending",
        metadata: {
          schemaVersion: 1,
          identityCount: 2,
          redemptionOutcome: "transfer",
        },
        identityCount: 2,
        retainedIdentityCount: 1,
        prunedIdentityCount: 1,
        roles: ["primary", "transferred_from", "transferred_to"],
        phases: { identity: "applied", entitlement: "pending" },
        processedAt: null,
      },
    ],
    reconciliation: {
      canonicalizationState: "pending",
      sourceKind: "none",
      sourceEnvironment: null,
      lastSnapshotAt: null,
      lastReconciledAt: null,
      reconcileReason: "webhook_failure",
      reconcileAfter: "2026-09-02T00:01:00.000Z",
      reconcileAttemptCount: 2,
      lastErrorCode: "revenuecat_timeout",
    },
  });

  const serialized = JSON.stringify(projected);
  for (const forbidden of [
    "subjectHash",
    "aliasHash",
    "aliases",
    "revenuecatUserId",
    "rawPayload",
    "lastEvent",
    "providerResponse",
    "sourceOperationId",
    "sourceTriggerEventId",
    "reconcileLeaseId",
    "private-secret",
    "legacy-raw-revenuecat-id",
    "aaaaaaaa",
    "bbbbbbbb",
    "cccccccc",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
