# RevenueCat Entitlement Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paid access idempotent, order-safe, multi-entitlement aware, and unable to recreate a deleted account.

**Architecture:** Treat each RevenueCat delivery as a trigger, not as authoritative state. Validate and deduplicate the delivery, fetch the canonical RevenueCat subscriber snapshot, then project every configured entitlement in one PostgreSQL transaction protected by the same per-user advisory lock as account deletion. Keep the existing `subscriptions` row as a compatibility projection while `resolveEntitlement` moves to normalized entitlement rows.

**Tech Stack:** Node 22, Express 5, TypeScript, Drizzle ORM, PostgreSQL 14/16, RevenueCat REST API v1, Node test runner.

**Current-doc evidence:** RevenueCat documents at-least-once webhook delivery and recommends event-ID idempotency. Current sample payloads include `id`, `event_timestamp_ms`, `entitlement_ids`, and separate transfer deliveries. Canonical customer state is available from `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with bearer authentication.

---

## File map

- Create `lib/db/migrations/0004_revenuecat_entitlement_integrity.sql` — expand-only ledger and normalized entitlement tables. Do not edit migrations `0000`–`0003`.
- Create `lib/db/src/schema/revenuecat.ts` — Drizzle models and constrained status/disposition types.
- Modify `lib/db/src/schema/index.ts` — export the new schema.
- Create `artifacts/api-server/src/lib/revenuecatContract.ts` — bounded webhook parser and event classification.
- Create `artifacts/api-server/src/lib/revenuecatClient.ts` — canonical subscriber API adapter and strict response normalization.
- Create `artifacts/api-server/src/lib/revenuecatProcessor.ts` — tombstone-safe, idempotent transaction and compatibility projection.
- Modify `artifacts/api-server/src/lib/accountDeletion.ts` — expose a reusable per-user locked transaction helper without weakening deletion fencing.
- Modify `artifacts/api-server/src/lib/entitlements.ts` — resolve the complete active entitlement set, coaching first, Pro second, trial afterward.
- Modify `artifacts/api-server/src/routes/webhooks/revenuecat.ts` — thin authentication/validation/processing transport.
- Modify `artifacts/api-server/src/routes/privacy.ts` — include the new records in export; deletion remains FK-cascade driven.
- Modify `artifacts/api-server/src/routes/diagnostics.ts` and `.env.example` — report the server API key and configured entitlement IDs without exposing secrets.
- Create `scripts/tests/revenuecat-contract.test.mjs` — pure parser and projection behavior.
- Create `scripts/tests/revenuecat-integration.test.mjs` — real PostgreSQL idempotency, ordering, multi-entitlement, and tombstone races.
- Modify `scripts/tests/user-data-integration.test.mjs` only if shared PostgreSQL setup is extracted; preserve all existing cases.

## Non-negotiable invariants

1. Unknown event types never grant, revoke, provision, or project access. They are stored as `ignored_unknown` only when the subject already exists; unknown events for missing/deleted subjects are acknowledged without retaining a user identifier.
2. Malformed deliveries return `400`; authenticated duplicates, stale events, and tombstoned subjects return `200` with an explicit non-applied disposition.
3. A recognized delivery is not marked processed until canonical state and both normalized/legacy projections commit atomically.
4. The event ID is the idempotency key. Concurrent duplicate deliveries perform one canonical projection.
5. Account deletion and webhook provisioning share the same per-UID advisory lock. A tombstone always wins; a webhook never removes or bypasses it.
6. `Elovia Pro` and `Elovia Coaching` can coexist. Coaching implies Pro access but does not overwrite the Pro row.
7. Access is derived from canonical entitlement expiry/grace data, never from an unknown event or a missing event expiration.
8. Raw webhook payloads and subscriber attributes are not persisted. Store only bounded, allowlisted billing metadata needed for disputes and replay diagnosis.
9. The server API secret never enters mobile code, logs, error bodies, telemetry, or persisted event metadata.

### Task 1: Lock the webhook contract with failing pure tests

**Files:**
- Create: `artifacts/api-server/src/lib/revenuecatContract.ts`
- Create: `scripts/tests/revenuecat-contract.test.mjs`

- [ ] **Step 1: Write the failing parser tests**

```js
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test scripts/tests/revenuecat-contract.test.mjs`

Expected: FAIL because `revenuecatContract.ts` does not exist.

- [ ] **Step 3: Implement the bounded contract**

```ts
export const RECONCILING_REVENUECAT_EVENTS = new Set([
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

export interface RevenueCatDelivery {
  eventId: string;
  type: string;
  eventAt: Date;
  userId: string;
  originalUserId: string | null;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: Record<string, string | number | string[] | null>;
}

export type RevenueCatParseResult =
  | { ok: true; value: RevenueCatDelivery }
  | { ok: false; code: "malformed_event"; message: string };

export function parseRevenueCatDelivery(body: unknown): RevenueCatParseResult {
  const event = body && typeof body === "object"
    ? (body as { event?: Record<string, unknown> }).event
    : undefined;
  if (!event) return { ok: false, code: "malformed_event", message: "Missing event" };
  const id = typeof event.id === "string" ? event.id.trim() : "";
  const type = typeof event.type === "string" ? event.type.trim() : "";
  const userId = typeof event.app_user_id === "string" ? event.app_user_id.trim() : "";
  const timestamp = event.event_timestamp_ms;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !/^[A-Z0-9_]{3,64}$/.test(type))
    return { ok: false, code: "malformed_event", message: "Invalid event identity" };
  if (
    !userId ||
    userId.length > 256 ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  )
    return { ok: false, code: "malformed_event", message: "Invalid event subject or time" };
  const requiresReconciliation = RECONCILING_REVENUECAT_EVENTS.has(type);
  return {
    ok: true,
    value: {
      eventId: id,
      type,
      eventAt: new Date(timestamp as number),
      userId,
      originalUserId:
        typeof event.original_app_user_id === "string"
          ? event.original_app_user_id.slice(0, 256)
          : null,
      disposition: requiresReconciliation ? "pending" : "ignored_unknown",
      requiresReconciliation,
      metadata: {
        productId: typeof event.product_id === "string" ? event.product_id.slice(0, 256) : null,
        entitlementIds: Array.isArray(event.entitlement_ids)
          ? event.entitlement_ids.filter((value): value is string => typeof value === "string").slice(0, 16)
          : [],
        store: typeof event.store === "string" ? event.store.slice(0, 32) : null,
        environment: typeof event.environment === "string" ? event.environment.slice(0, 32) : null,
      },
    },
  };
}
```

- [ ] **Step 4: Run and commit**

Run: `node --test scripts/tests/revenuecat-contract.test.mjs`

Expected: PASS.

Commit: `git commit -m "test: define revenuecat webhook contract"`

### Task 2: Add the expand-only ledger and entitlement schema

**Files:**
- Create: `lib/db/migrations/0004_revenuecat_entitlement_integrity.sql`
- Create: `lib/db/src/schema/revenuecat.ts`
- Modify: `lib/db/src/schema/index.ts`
- Test: `scripts/tests/revenuecat-integration.test.mjs`

- [ ] **Step 1: Write a PostgreSQL migration test**

The test must create an isolated schema through `TEST_DATABASE_URL`, call `runMigrations`, and assert:

```js
assert.deepEqual(
  await columnsFor(client, "revenuecat_webhook_events"),
  ["event_id", "user_id", "type", "event_at", "received_at", "disposition", "metadata", "processed_at"],
);
assert.equal(await primaryKeyFor(client, "subscription_entitlements"), "user_id,entitlement_id");
assert.equal(await hasForeignKey(client, "subscription_entitlements", "users", "CASCADE"), true);
assert.equal(await hasForeignKey(client, "revenuecat_webhook_events", "users", "CASCADE"), true);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run in PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
& 'C:\Program Files\nodejs\node.exe' --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: FAIL because migration `0004` and both tables are absent. If no local database exists, the test may skip locally, but CI PostgreSQL 14/16 must execute it.

- [ ] **Step 3: Create migration `0004`**

```sql
CREATE TABLE "revenuecat_webhook_events" (
  "event_id" varchar(128) PRIMARY KEY,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(64) NOT NULL,
  "event_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "disposition" varchar(32) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "processed_at" timestamptz,
  CONSTRAINT "revenuecat_event_disposition_valid" CHECK (
    "disposition" IN ('pending','applied','stale','ignored_unknown','reconciliation_failed')
  )
);

CREATE TABLE "subscription_entitlements" (
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entitlement_id" varchar(128) NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "status" varchar(32) NOT NULL,
  "product_id" varchar(256),
  "store" varchar(32),
  "expires_at" timestamptz,
  "will_renew" boolean NOT NULL DEFAULT false,
  "source_event_at" timestamptz NOT NULL,
  "source_event_id" varchar(128) NOT NULL REFERENCES "revenuecat_webhook_events"("event_id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "entitlement_id"),
  CONSTRAINT "subscription_entitlement_status_valid" CHECK (
    "status" IN ('active','trial','cancelled','billing_issue','grace','expired','refunded','paused')
  )
);

CREATE INDEX "IDX_revenuecat_events_user_time"
  ON "revenuecat_webhook_events" ("user_id", "event_at" DESC);
CREATE INDEX "IDX_subscription_entitlements_active"
  ON "subscription_entitlements" ("user_id", "active", "expires_at");

INSERT INTO "revenuecat_webhook_events" (
  "event_id",
  "user_id",
  "type",
  "event_at",
  "disposition",
  "metadata",
  "processed_at"
)
SELECT
  'legacy-' || md5("user_id"),
  "user_id",
  'LEGACY_BACKFILL',
  COALESCE("last_event_at", "updated_at", "created_at"),
  'applied',
  '{}'::jsonb,
  now()
FROM "subscriptions"
WHERE "entitlement_id" IS NOT NULL
ON CONFLICT ("event_id") DO NOTHING;

INSERT INTO "subscription_entitlements" (
  "user_id",
  "entitlement_id",
  "active",
  "status",
  "product_id",
  "expires_at",
  "will_renew",
  "source_event_at",
  "source_event_id"
)
SELECT
  "user_id",
  "entitlement_id",
  "entitlement_active",
  CASE
    WHEN "status" IN ('in_trial', 'trial') THEN 'trial'
    WHEN "status" IN ('active', 'cancelled', 'billing_issue', 'expired') THEN "status"
    ELSE 'expired'
  END,
  "product_id",
  "current_period_ends_at",
  "status" NOT IN ('cancelled', 'expired'),
  COALESCE("last_event_at", "updated_at", "created_at"),
  'legacy-' || md5("user_id")
FROM "subscriptions"
WHERE "entitlement_id" IS NOT NULL
ON CONFLICT ("user_id", "entitlement_id") DO NOTHING;
```

- [ ] **Step 4: Mirror the migration in Drizzle**

Define `revenuecatWebhookEventsTable` and `subscriptionEntitlementsTable` in `lib/db/src/schema/revenuecat.ts` with the same names, lengths, defaults, checks, indexes, PK, and cascade relationships. Export inferred select/insert types and re-export the file from `schema/index.ts`.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @workspace/db typecheck && pnpm test`

Expected: typecheck PASS; non-PostgreSQL tests PASS; PostgreSQL tests run in CI.

Commit: `git commit -m "feat: add revenuecat entitlement ledger"`

### Task 3: Build a strict canonical RevenueCat client

**Files:**
- Create: `artifacts/api-server/src/lib/revenuecatClient.ts`
- Modify: `.env.example`
- Test: `scripts/tests/revenuecat-contract.test.mjs`

- [ ] **Step 1: Add failing adapter tests**

Inject `fetch` and assert the adapter:

```js
assert.equal(request.url, "https://api.revenuecat.com/v1/subscribers/firebase-user-a");
assert.equal(request.headers.Authorization, "Bearer server-secret");
assert.deepEqual(snapshot.entitlements.map((item) => item.id).sort(), ["Elovia Coaching", "Elovia Pro"]);
assert.equal(snapshot.entitlements.find((item) => item.id === "Elovia Pro").active, true);
assert.rejects(() => client.fetchSubscriber("../bad"), /Invalid RevenueCat user/);
assert.rejects(() => client.fetchSubscriber("user-a"), /Malformed RevenueCat response/);
```

- [ ] **Step 2: Implement the adapter**

```ts
export interface CanonicalEntitlement {
  id: string;
  active: boolean;
  status: "active" | "trial" | "cancelled" | "billing_issue" | "grace" | "expired" | "refunded" | "paused";
  productId: string | null;
  store: string | null;
  expiresAt: Date | null;
  willRenew: boolean;
}

export interface RevenueCatClient {
  fetchSubscriber(userId: string): Promise<{ entitlements: CanonicalEntitlement[] }>;
}

export function createRevenueCatClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): RevenueCatClient;
```

Inside `fetchSubscriber`, URL-encode the user ID, require a 2xx response, bound the response body, reject malformed containers/dates, and derive `active` from `expires_date`/`grace_period_expires_date` relative to injected `now`. Join entitlement product IDs to `subscriber.subscriptions[product_identifier]` for store, refund, billing issue, unsubscribe, and renewal status. Never log the response body or API key.

- [ ] **Step 3: Configure and commit**

Add to `.env.example`:

```dotenv
REVENUECAT_SECRET_API_KEY=replace-with-a-secret-server-api-key
REVENUECAT_PRO_ENTITLEMENT_ID=Elovia Pro
REVENUECAT_COACHING_ENTITLEMENT_ID=Elovia Coaching
```

Run: `node --test scripts/tests/revenuecat-contract.test.mjs && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

Commit: `git commit -m "feat: add canonical revenuecat subscriber client"`

### Task 4: Process events atomically under the deletion fence

**Files:**
- Modify: `artifacts/api-server/src/lib/accountDeletion.ts`
- Create: `artifacts/api-server/src/lib/revenuecatProcessor.ts`
- Test: `scripts/tests/revenuecat-integration.test.mjs`

- [ ] **Step 1: Write failing concurrency tests**

Add real PostgreSQL tests for:

```js
const outcomes = await Promise.all(
  Array.from({ length: 20 }, () => processor.process(delivery)),
);
assert.equal(outcomes.filter((value) => value.disposition === "applied").length, 1);
assert.equal(outcomes.filter((value) => value.disposition === "duplicate").length, 19);
assert.equal(await countRows(client, "revenuecat_webhook_events"), 1);

await tombstoneAndDeleteAccountData("deleted-user", "delete-request-a");
assert.deepEqual(await processor.process({ ...delivery, userId: "deleted-user" }), {
  disposition: "ignored_deleted",
});
assert.equal(await countUser(client, "deleted-user"), 0);
assert.equal(await countEntitlements(client, "deleted-user"), 0);
```

Also race `processor.process` against `tombstoneAndDeleteAccountData` 50 times; every terminal state must have either an active user with entitlement rows or a permanent tombstone with no user/entitlement rows, never both.

- [ ] **Step 2: Expose one locked account mutation primitive**

Add an exported helper in `accountDeletion.ts` that opens a transaction, takes `lockAccount`, checks `account_deletions`, and invokes a callback only for active subjects:

```ts
export async function runLockedAccountMutation<T>(
  userId: string,
  mutation: (transaction: DbTransaction) => Promise<T>,
): Promise<{ status: "active"; value: T } | { status: "deleted" }>;
```

Refactor `provisionAuthenticatedUserIfActive` and `tombstoneAndDeleteAccountData` to keep their existing behavior on this primitive. Do not export an unlocked user-provisioning shortcut.

- [ ] **Step 3: Implement the processor**

```ts
export interface RevenueCatProcessOutcome {
  disposition: "applied" | "duplicate" | "stale" | "ignored_unknown" | "ignored_deleted";
}

export function createRevenueCatProcessor(options: {
  client: RevenueCatClient;
  now?: () => Date;
}): { process(delivery: RevenueCatDelivery): Promise<RevenueCatProcessOutcome> };
```

Algorithm:

1. For an unknown event, never call RevenueCat and never provision a user. If the subject already exists and is not tombstoned, insert the event as `ignored_unknown` under `runLockedAccountMutation`; if the subject is missing or deleted, acknowledge without retaining its identifier.
2. For a recognized event, fetch the canonical snapshot before opening the transaction. If the fetch fails, throw so the route returns 503 and RevenueCat retries; do not insert the event.
3. Enter `runLockedAccountMutation`, provision the user with `ON CONFLICT DO NOTHING`, and insert `event_id` as `pending`. If the event already exists, return `duplicate` without applying the snapshot.
4. For each configured entitlement, compare `(source_event_at, source_event_id)` lexicographically. Upsert only when the incoming tuple is newer; keep independent entitlement clocks.
5. Mark configured entitlements absent from the canonical snapshot inactive using the incoming source tuple.
6. Recompute the legacy `subscriptions` row from the normalized set in the same transaction: Coaching wins tier selection, otherwise Pro, otherwise inactive. Update `entitlementId` on conflict.
7. Mark the event `applied` and `processed_at=now()` before commit.

- [ ] **Step 4: Run and commit**

Run in PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
& 'C:\Program Files\nodejs\node.exe' --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: all duplicate, ordering, and deletion-race cases PASS on PostgreSQL 14 and 16.

Commit: `git commit -m "fix: serialize revenuecat state with account deletion"`

### Task 5: Resolve all active entitlements server-side

**Files:**
- Modify: `artifacts/api-server/src/lib/entitlements.ts`
- Test: `scripts/tests/revenuecat-contract.test.mjs`
- Test: `scripts/tests/revenuecat-integration.test.mjs`

- [ ] **Step 1: Add failing resolution tests**

Test these exact states with an injected `now`:

- Pro active alone → `premium`.
- Coaching active alone → `coaching`, `hasProAccess=true`.
- Pro and Coaching active together → `coaching` while retaining both DB rows.
- Cancelled but unexpired Pro → `premium`, `status=cancelled`.
- Billing issue inside grace → `premium`, `status=grace`.
- Expired/refunded rows → no paid access.
- No active store entitlement and account age under 15 days → `trial`.
- No active entitlement and expired account trial → `free`.

- [ ] **Step 2: Implement normalized resolution**

Export both constants from server configuration and query all rows for the user. Filter by `active && (!expiresAt || expiresAt > now)`. Choose Coaching before Pro, select the winning product/expiry for display, and fall back to the legacy `subscriptions` row only when zero normalized rows exist during rollout. Preserve the account-created trial logic exactly.

- [ ] **Step 3: Run and commit**

Run in PowerShell:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test scripts/tests/revenuecat-contract.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
& 'C:\Program Files\nodejs\node.exe' --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: PASS.

Commit: `git commit -m "fix: resolve multiple revenuecat entitlements"`

### Task 6: Replace the route with a thin fail-closed transport

**Files:**
- Modify: `artifacts/api-server/src/routes/webhooks/revenuecat.ts`
- Modify: `artifacts/api-server/src/routes/diagnostics.ts`
- Modify: `artifacts/api-server/src/routes/privacy.ts`
- Test: `scripts/tests/revenuecat-contract.test.mjs`

- [ ] **Step 1: Add HTTP behavior tests**

Using an app factory with injected processor/client, assert:

```js
assert.equal((await postWebhook({ auth: "bad", body: valid })).status, 401);
assert.equal((await postWebhook({ auth: secret, body: {} })).status, 400);
assert.deepEqual(await json(postWebhook({ auth: secret, body: duplicate })), {
  received: true,
  applied: false,
  disposition: "duplicate",
});
assert.equal((await postWebhook({ auth: secret, body: valid, clientFailure: true })).status, 503);
```

Verify logs contain event type/disposition and a request/event ID only—not user IDs, API keys, subscriber attributes, or raw bodies.

- [ ] **Step 2: Make the route transport-only**

Keep constant-time webhook-secret comparison. Parse with `parseRevenueCatDelivery`, invoke the processor, map `applied` to `{received:true,applied:true}`, and map duplicate/stale/ignored outcomes to HTTP 200 with `applied:false`. Map canonical API/network failure to typed 503 with `Retry-After`; never turn it into 200. Remove direct imports of `usersTable` and `subscriptionsTable` from the route.

- [ ] **Step 3: Complete privacy and diagnostics**

Add normalized entitlement and event-ledger records to authenticated export. Because both tables FK-cascade from `users`, the existing deletion transaction removes them automatically. Diagnostics should report booleans for webhook secret, server API key, and configured Pro/Coaching IDs; do not echo values.

- [ ] **Step 4: Run and commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @workspace/api-server run build`

Expected: PASS, with PostgreSQL-only cases skipped only when `TEST_DATABASE_URL` is absent.

Commit: `git commit -m "fix: make revenuecat webhook fail closed"`

### Task 7: PostgreSQL 14/16 and replay delivery gate

**Files:**
- Modify: `.github/workflows/ci.yml` only if the new test is not already covered by `pnpm test`.
- Test: `scripts/tests/revenuecat-integration.test.mjs`

- [ ] **Step 1: Complete the real event matrix**

Fixtures must cover `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `REFUND`, `BILLING_ISSUE` with grace, `PRODUCT_CHANGE`, `TRANSFER`, `SUBSCRIPTION_PAUSED`, and one future unknown type. Add reverse delivery order, equal-timestamp event-ID tie-breaking, two independent entitlements, and 20 concurrent duplicate deliveries.

- [ ] **Step 2: Run the full delivery gate**

Run:

```powershell
& 'C:\Program Files\nodejs\corepack.cmd' pnpm test
& 'C:\Program Files\nodejs\corepack.cmd' pnpm typecheck
& 'C:\Program Files\nodejs\corepack.cmd' pnpm --filter @workspace/api-server run build
git diff --check HEAD~7..HEAD
```

Expected: zero failures. CI must execute the integration file against PostgreSQL 14 and 16; local skip is acceptable only when neither `TEST_DATABASE_URL` nor a database container exists.

- [ ] **Step 3: Review and commit any gate-only corrections**

Use a fresh spec reviewer, then a fresh quality reviewer. Fix every Critical/Important finding through the same task implementer and re-review until PASS.

Commit any review correction separately with a scoped message such as `fix: close revenuecat review findings`.

## Self-review checklist

- Every RevenueCat-integrity requirement is assigned to a task.
- No migration before `0004` is modified.
- Unknown events cannot grant access.
- Duplicate and stale events return success without reapplying.
- Canonical reconciliation is required for recognized events.
- Multiple entitlements are preserved and resolved together.
- Account-deletion locking prevents webhook resurrection.
- Raw payload/PII and secrets are not stored or logged.
- Real PostgreSQL concurrency tests run in CI, not only regex/source assertions.
- No mobile subscription UI behavior is changed in this plan; coaching conversion belongs to its own later plan.
