import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalCreatedResponseIsEmpty,
  reconcileRetryDelayMs,
  resolveNormalizedEntitlement,
  sanitizeRevenueCatErrorCode,
  trustedStateNeedsEnqueue,
} from "../../artifacts/api-server/src/lib/revenuecatWorkerCore.ts";

const now = new Date("2026-09-02T12:00:00.000Z");

test("trusted customer retries double from one minute and cap at one hour", () => {
  assert.equal(reconcileRetryDelayMs(1), 60_000);
  assert.equal(reconcileRetryDelayMs(2), 120_000);
  assert.equal(reconcileRetryDelayMs(6), 1_920_000);
  assert.equal(reconcileRetryDelayMs(7), 3_600_000);
  assert.equal(reconcileRetryDelayMs(99), 3_600_000);
});

test("trusted customer errors are reduced to bounded non-sensitive codes", () => {
  assert.equal(
    sanitizeRevenueCatErrorCode({ code: "revenuecat_timeout" }),
    "revenuecat_timeout",
  );
  assert.equal(
    sanitizeRevenueCatErrorCode(new Error("secret subscriber id")),
    "revenuecat_worker_failure",
  );
  assert.equal(
    sanitizeRevenueCatErrorCode({ code: "UPPERCASE and spaces" }),
    "revenuecat_worker_failure",
  );
});

test("201 bootstrap empty means no configured entitlement pointer or candidate", () => {
  const base = {
    sourceSnapshotAt: now,
    entitlements: Object.freeze({ unrelated: {} }),
    subscriptions: Object.freeze({ unrelated_product: {} }),
    nonSubscriptions: Object.freeze({ unrelated_lifetime: [{}] }),
  };
  const config = {
    proEntitlementId: "pro",
    coachingEntitlementId: "coaching",
    proProducts: [{ id: "pro_monthly" }, { id: "pro_lifetime" }],
    coachingProducts: [{ id: "coach_monthly" }],
  };
  assert.equal(canonicalCreatedResponseIsEmpty(base, config), true);
  assert.equal(
    canonicalCreatedResponseIsEmpty(
      { ...base, entitlements: { ...base.entitlements, pro: {} } },
      config,
    ),
    false,
  );
  assert.equal(
    canonicalCreatedResponseIsEmpty(
      {
        ...base,
        subscriptions: { ...base.subscriptions, pro_monthly: {} },
      },
      config,
    ),
    false,
  );
  assert.equal(
    canonicalCreatedResponseIsEmpty(
      {
        ...base,
        nonSubscriptions: { ...base.nonSubscriptions, pro_lifetime: [] },
      },
      config,
    ),
    false,
  );
});

test("authenticated requests enqueue only absent, legacy, or due state", () => {
  assert.equal(trustedStateNeedsEnqueue(null, now), true);
  assert.equal(
    trustedStateNeedsEnqueue(
      {
        canonicalizationState: "legacy_unverified",
        reconcileAfter: new Date("2027-01-01"),
      },
      now,
    ),
    true,
  );
  assert.equal(
    trustedStateNeedsEnqueue(
      {
        canonicalizationState: "pending",
        reconcileAfter: new Date("2027-01-01"),
      },
      now,
    ),
    false,
  );
  assert.equal(
    trustedStateNeedsEnqueue(
      {
        canonicalizationState: "canonical",
        reconcileAfter: new Date("2026-09-02T11:59:59Z"),
      },
      now,
    ),
    true,
  );
  assert.equal(
    trustedStateNeedsEnqueue(
      {
        canonicalizationState: "canonical",
        reconcileAfter: new Date("2026-09-02T18:00:00Z"),
      },
      now,
    ),
    false,
  );
});

test("safe normalized reads ignore legacy grants and prefer coaching over pro", () => {
  const base = {
    now,
    userCreatedAt: new Date("2026-01-01T00:00:00Z"),
    canonicalizationState: "canonical",
    proEntitlementId: "pro",
    coachingEntitlementId: "coaching",
  };
  const legacy = {
    entitlementId: "__legacy_unverified__",
    active: true,
    status: "active",
    accessEndsAt: null,
    productId: "legacy-paid",
  };
  assert.deepEqual(resolveNormalizedEntitlement({ ...base, rows: [legacy] }), {
    tier: "free",
    hasProAccess: false,
    hasCoaching: false,
    status: "expired",
    trialEndsAt: new Date("2026-01-16T00:00:00.000Z"),
    currentPeriodEndsAt: null,
    productId: null,
  });
  const pro = {
    entitlementId: "pro",
    active: true,
    status: "grace",
    accessEndsAt: new Date("2026-09-03T00:00:00Z"),
    productId: "pro_monthly",
  };
  const coaching = {
    entitlementId: "coaching",
    active: true,
    status: "active",
    accessEndsAt: null,
    productId: "coach_monthly",
  };
  assert.deepEqual(
    resolveNormalizedEntitlement({ ...base, rows: [pro, coaching] }),
    {
      tier: "coaching",
      hasProAccess: true,
      hasCoaching: true,
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      productId: "coach_monthly",
    },
  );
});

test("uncanonicalized reads grant only the once-per-account trial", () => {
  const outcome = resolveNormalizedEntitlement({
    now,
    userCreatedAt: new Date("2026-09-01T00:00:00Z"),
    canonicalizationState: "pending",
    rows: [
      {
        entitlementId: "pro",
        active: true,
        status: "active",
        accessEndsAt: null,
        productId: "legacy-false-grant",
      },
    ],
    proEntitlementId: "pro",
    coachingEntitlementId: "coaching",
  });
  assert.deepEqual(outcome, {
    tier: "trial",
    hasProAccess: true,
    hasCoaching: false,
    status: "in_trial",
    trialEndsAt: new Date("2026-09-16T00:00:00.000Z"),
    currentPeriodEndsAt: null,
    productId: null,
  });
});

test("normalized reads cover every active and terminal RevenueCat status", () => {
  const base = {
    now,
    userCreatedAt: new Date("2026-01-01T00:00:00Z"),
    canonicalizationState: "canonical",
    proEntitlementId: "pro",
    coachingEntitlementId: "coaching",
    expectedEnvironment: "production",
  };
  for (const status of [
    "active",
    "grace",
    "cancelled",
    "paused",
    "trial",
    "intro",
    "prepaid",
    "promotional",
  ]) {
    const accessEndsAt = new Date("2026-10-01T00:00:00Z");
    const outcome = resolveNormalizedEntitlement({
      ...base,
      rows: [
        {
          entitlementId: "pro",
          active: true,
          status,
          accessEndsAt,
          productId:
            status === "active" ? "lifetime_or_nonrenewing" : `pro_${status}`,
          sourceEnvironment: "production",
        },
      ],
    });
    assert.equal(outcome.tier, "premium", status);
    assert.equal(outcome.status, status, status);
    assert.equal(outcome.hasProAccess, true, status);
  }
  for (const status of ["expired", "refunded"]) {
    assert.equal(
      resolveNormalizedEntitlement({
        ...base,
        rows: [
          {
            entitlementId: "pro",
            active: false,
            status,
            accessEndsAt: new Date("2026-01-02T00:00:00Z"),
            productId: `pro_${status}`,
            sourceEnvironment: "production",
          },
        ],
      }).tier,
      "free",
      status,
    );
  }
  assert.equal(
    resolveNormalizedEntitlement({
      ...base,
      rows: [
        {
          entitlementId: "pro",
          active: true,
          status: "active",
          accessEndsAt: null,
          productId: "sandbox_false_grant",
          sourceEnvironment: "sandbox",
        },
      ],
    }).tier,
    "free",
  );
});

test("Task 5 production wiring uses durable fenced workers and no legacy reads", async () => {
  const [
    worker,
    reconciler,
    auth,
    entitlement,
    route,
    health,
    index,
    bootstrap,
  ] = await Promise.all([
    readFile(
      new URL(
        "../../artifacts/api-server/src/lib/revenuecatWorker.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/lib/revenuecatReconciler.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/lib/accountDeletion.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/lib/entitlements.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/routes/entitlement.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../artifacts/api-server/src/routes/health.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../artifacts/api-server/src/index.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../reconcile-revenuecat.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /processing_lease_id/);
  assert.match(worker, /reconcile_lease_id/);
  assert.match(worker, /interval '6 hours'/);
  assert.match(worker, /RETURNING event\."event_id", event\."attempt_count"/);
  assert.match(worker, /reconcileRetryDelayMs\(claim\.attemptCount\)/);
  assert.match(worker, /GREATEST\("next_attempt_at", "retention_until"\)/);
  assert.doesNotMatch(
    worker,
    /if \(subjects\.rows\.length === 0\) \{\s*await db\.execute\(sql`\s*DELETE FROM/s,
  );
  assert.match(worker, /"type" <> 'TRANSFER'/);
  assert.match(reconciler, /reconcileTrustedUser/);
  assert.match(reconciler, /allowCreatedEmpty/);
  assert.match(worker, /ownership_source.*authenticated/s);
  assert.match(worker, /revenuecat_event_subjects/);
  assert.match(auth, /AuthProvisioningCallback/);
  assert.match(auth, /AccountLockExpansion/);
  assert.doesNotMatch(entitlement, /subscriptionsTable/);
  assert.match(entitlement, /subscriptionEntitlementsTable/);
  assert.match(route, /reconcileTrustedUserOnDemand/);
  assert.match(health, /canonicalization_state" <> 'canonical'/);
  assert.match(index, /startRevenueCatWorkers/);
  assert.match(bootstrap, /bootstrapRevenueCatCustomers/);
  assert.doesNotMatch(bootstrap, /revenuecat_user_id/);
});
