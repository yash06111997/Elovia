# RevenueCat Entitlement Integrity Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Do not begin Task 2 until Task 1A and its review are complete. Each task follows RED → GREEN → full verification → commit.

**Goal:** Make paid access idempotent, order-safe, multi-entitlement aware, transfer/alias safe, environment safe, and unable to recreate a deleted account.

**Architecture:** A RevenueCat webhook is a bounded trigger, not authoritative subscription state. Parse ordinary and transfer deliveries separately, deduplicate the event, fetch bounded canonical subscriber snapshots, and project configured entitlements in PostgreSQL under the same advisory-lock namespace used by account deletion. Keep the legacy `subscriptions` row as a temporary compatibility projection, but switch reads only after each legacy subscriber has been canonically reconciled.

**Tech stack:** Node 22, Express 5, TypeScript, Drizzle ORM, PostgreSQL 14/16, RevenueCat REST API v1, Node test runner.

**Implementation base SHA:** `59dba42c61d4ba8e88479c7bf7c608171967181a` is the accepted Task 1 head after spec and quality review. Use this exact SHA for the final implementation diff gate.

**Current RevenueCat behavior used by this plan:** Webhooks are delivered at least once; event ID is the idempotency key; ordinary events contain `app_user_id`; transfer events carry `transferred_from[]` and `transferred_to[]` and must not be forced through the ordinary shape; aliases may include `$RCAnonymousID:*`; canonical customer state comes from `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}`; canonical subscription entries expose expiry, grace, cancellation, billing-issue, refund, store, period, and sandbox information.

---

## File map and ownership

- Already shipped in Task 1:
  - `artifacts/api-server/src/lib/revenuecatContract.ts`
  - `scripts/tests/revenuecat-contract.test.mjs`
- Task 1A modifies only those two files to add the transfer discriminated union.
- Create `lib/db/migrations/0004_revenuecat_entitlement_integrity.sql`.
- Create `lib/db/src/schema/revenuecat.ts`.
- Modify `lib/db/src/schema/index.ts`.
- Modify `lib/db/src/schema/subscriptions.ts` to mirror the permanent null-only `last_event` constraint.
- Create `artifacts/api-server/src/lib/revenuecatConfig.ts`.
- Create `artifacts/api-server/src/lib/revenuecatClient.ts`.
- Create `artifacts/api-server/src/lib/revenuecatProcessor.ts`.
- Create `artifacts/api-server/src/lib/revenuecatReconciler.ts`.
- Modify `artifacts/api-server/src/lib/accountDeletion.ts`.
- Modify `artifacts/api-server/src/lib/entitlements.ts`.
- Modify `artifacts/api-server/src/routes/webhooks/revenuecat.ts`.
- Modify `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/app.ts`, and `artifacts/api-server/src/index.ts` to expose injectable router/app seams and mount the webhook before Firebase auth.
- Modify `artifacts/api-server/src/index.ts` and `artifacts/api-server/src/routes/health.ts` for startup/readiness validation.
- Modify `artifacts/api-server/src/routes/privacy.ts` and `artifacts/api-server/src/routes/diagnostics.ts`.
- Modify `.env.example`.
- Create `scripts/reconcile-revenuecat.mjs`.
- Create `scripts/tests/revenuecat-integration.test.mjs`.
- Create `scripts/tests/revenuecat-http.test.mjs`.
- Modify `scripts/tests/user-data-integration.test.mjs` for the new migration and tables even if its harness is not extracted.
- Do not edit migrations `0000`–`0003`.
- Do not change mobile purchase behavior in this plan.

## Non-negotiable invariants

1. Unknown event types never grant, revoke, provision, create aliases, fetch canonical state, or update a compatibility projection.
2. Unknown events are retained as `ignored_unknown` only when at least one already-existing, non-deleted local user is resolved; missing/deleted unknown subjects are acknowledged without persisting an event, alias, subject identifier, or hash.
3. Malformed deliveries return `400`; authenticated duplicates, stale events, missing anonymous-only subjects, and tombstoned subjects return `200` with an explicit non-applied disposition.
4. A recognized event is not marked processed until all normalized and legacy projections that advanced commit atomically.
5. Event ID is the idempotency key. A lease-backed PII-free pending-event claim admits one canonical fetch owner across API replicas; concurrent non-owners wait for the terminal result and never call RevenueCat. Expired/released claims are resumable.
6. Account deletion and RevenueCat mutation use the same per-UID advisory locks. Multi-user transfers acquire sorted unique UID locks. A tombstone always wins.
7. `$RCAnonymousID:*` is never provisioned as an Elovia/Firebase user. Alias rows map a keyed subject hash to an existing or explicitly provisionable non-anonymous local UID.
8. `Elovia Pro` and `Elovia Coaching` coexist as independent rows. Coaching implies Pro feature access but never overwrites the Pro row.
9. Access is derived only from a canonical production/sandbox snapshot matching configured environment and its effective access deadline. Event expiry and unknown events never directly grant access.
10. The event ledger is PII-free. Raw webhook payloads, raw app-user IDs, aliases, subscriber attributes, API responses, and secrets are not persisted or logged.
11. Every local-user-linked subject, alias, customer-state, and entitlement row cascades on account deletion without deleting another user’s shared transfer event or entitlement.
12. Legacy rows are `legacy_unverified`, inactive in normalized storage, and use the Unix epoch source clock. They cannot block a real event or become authoritative without canonical reconciliation.
13. `subscriptions.last_event` is scrubbed in migration `0004` and remains null.
14. Production rejects sandbox/test-store state; sandbox mode rejects production state. Missing or ambiguous configuration fails startup/readiness.
15. PostgreSQL behavioral/concurrency tests execute in CI against both PostgreSQL 14 and 16.

## Canonical data definitions

### Subject hashing and aliases

Use `HMAC-SHA-256(REVENUECAT_SUBJECT_HASH_KEY, rawRevenueCatUserId)` as lowercase hex. The raw RevenueCat ID exists only in request-local memory for lookup and canonical fetch. Persist only the 64-character keyed hash. The HMAC secret is server-only and must not appear in diagnostics beyond a boolean.

### Ordering tuple

Webhook projections use `(event_timestamp_ms, event_id)` lexicographically. SQL compares `(source_event_at, COALESCE(source_event_id, ''))`. Legacy and bootstrap rows use `1970-01-01T00:00:00.000Z` and a null event ID. Bootstrap may replace `legacy_unverified` at that equal minimum tuple exactly once; thereafter a bootstrap row is idempotent. Any real webhook timestamp accepted by the bounded contract is later than the epoch and therefore wins. A distinct recognized event is `stale` only when every targeted configured-entitlement row rejects its ordering tuple. Duplicate means the same event ID and immutable ledger-envelope fields (type, event time, and normalized event environment) already have a terminal row.

### Event state machine and idempotency claim

`pending` is the only nonterminal ledger disposition. `applied`, `stale`, and `ignored_unknown` are terminal. Terminal rows have `processed_at` and no lease; pending rows have no `processed_at` and may have one bounded processing lease.

For a recognized delivery, after the tombstone precheck and before any RevenueCat call, atomically insert or claim the PII-free event row by event ID in a short transaction. First `INSERT ... ON CONFLICT DO NOTHING` with `pending`, attempt 1, and a lease; if it conflicts, read without changing immutable fields, reject a ledger-envelope mismatch, return a terminal duplicate, or use `UPDATE ... WHERE disposition='pending' AND (processing_lease_id IS NULL OR processing_lease_until <= now()) RETURNING` to claim/reclaim and increment the attempt. The claim sets a random 128-character-bounded `processing_lease_id` and `processing_lease_until = database_now + 30 seconds`. An existing unexpired pending claim is not stolen: the non-owner polls the ledger for at most 5.5 seconds without a transaction or advisory lock, returns `duplicate` if it becomes terminal, or returns typed `processing`/`503 Retry-After: 1` so RevenueCat retries. Transfer fetches use at most eight concurrent calls; the owner conditionally renews its 30-second lease before each batch and before finalization, and aborts without mutation if lease ownership was lost.

The claim owner performs bounded canonical fetches without a database transaction or account lock. On a retryable upstream/normalization failure it clears only its own lease and returns typed `503`, leaving a resumable PII-free pending row. On final success it enters the account lock transaction, rechecks tombstones, verifies the lease owner, writes subjects/state/projections, transitions the event to a terminal disposition, clears the lease, and commits atomically. If every subject is now deleted/missing and policy says no event may be retained, it deletes its pending row instead. No failed terminal disposition exists.

### Environment

Normalize configured environment to `production | sandbox`. For canonical subscription records, `is_sandbox=false` maps to production and `is_sandbox=true` maps to sandbox. Ignore mismatched candidates; if a configured entitlement has only mismatched candidates, project it inactive and log only counts/type, never identifiers. Production must never accept SDK Test Store/sandbox access.

### Deterministic canonical entitlement truth table

For each configured entitlement, join its canonical `product_identifier` to both `subscriber.subscriptions` and `subscriber.non_subscriptions`. A missing join for an entitlement that claims a product is malformed canonical state and is retryable; do not guess.

First derive every matching product candidate independently with the precedence below. Then choose deterministically: an access-granting candidate beats an inactive candidate; among access-granting candidates, lifetime/non-expiring beats dated access, otherwise the greatest effective access deadline wins; among inactive candidates, the latest known deadline wins. Remaining ties use lexical product ID, then lexical store. This prevents a refunded lifetime purchase from masking a live dated purchase.

| Precedence | Canonical condition | active | status | effective `accessEndsAt` | `willRenew` |
|---|---|---:|---|---|---:|
| 1 | `refunded_at` present | false | `refunded` | refund instant | false |
| 2 | non-subscription/lifetime candidate with null entitlement expiry and no refund | true | `active` | null | false |
| 3 | billing issue and matching-environment `grace_period_expires_date > now` | true | `grace` | max(period end, grace end) | false when cancellation or pause metadata exists; true otherwise |
| 4 | paid period still live and billing issue exists without a later live grace | true | `billing_issue` | period end | false when cancellation or pause metadata exists; true otherwise |
| 5 | paid period still live and pause/`auto_resume_date` metadata exists | true | `paused` | period end | true only when a future auto-resume exists |
| 6 | paid period still live and `unsubscribe_detected_at` exists | true | `cancelled` | period end | false |
| 7 | paid period still live and `period_type` is trial | true | `trial` | period end | true unless cancellation metadata exists |
| 8 | paid period still live | true | `active` | period end | true for renewing subscriptions; false for non-subscription purchases |
| 9 | no live period/grace/lifetime candidate | false | `expired` | latest known period/grace end or null | false |

Persist `periodEndsAt`, `graceEndsAt`, and effective `accessEndsAt` separately. Resolver gating uses only `active && (accessEndsAt === null || accessEndsAt > now)`. A cancelled, paused, or billing-issue row can therefore remain active only through its canonical effective deadline.

### Absent configured entitlement

If Pro or Coaching is absent from a valid matching-environment snapshot, project an explicit row with `active=false`, `status='expired'`, null product/store/period/grace/access dates, `willRenew=false`, and the incoming canonical source tuple. This makes revocation explicit and ordered.

### Legacy compatibility projection

Only recompute `subscriptions` when at least one normalized entitlement row advances. Select active Coaching first, then active Pro. Set every compatibility column explicitly:

- `user_id`: unchanged local UID.
- `revenuecat_user_id`: the non-anonymous local UID used for the canonical customer; never an anonymous alias.
- `entitlement_active`: whether a winner exists.
- `entitlement_id`: winner ID, otherwise null.
- `status`: winner status, mapping `trial` to existing `in_trial`; otherwise `expired` when no winner.
- `tier`: deterministic existing product mapping (`lifetime`, `yearly`, `monthly`, else null); Coaching remains identified by entitlement ID rather than overloading this field.
- `product_id`, `store`: winner values, otherwise null.
- `trial_started_at`: null because v1 projection does not preserve a trustworthy start in the current schema.
- `trial_ends_at`: winner access deadline only for trial, otherwise null.
- `current_period_ends_at`: winner effective access deadline, otherwise null.
- `last_event`: always null.
- `last_event_at`: webhook source time for webhook projection; Unix epoch for bootstrap projection.
- `updated_at`: database transaction time; preserve `created_at`.

A stale event does not touch this row.

---

## Task 1: Shipped bounded ordinary-event contract

**Status:** Complete in commits `6ddc3d8`, `17d9155`, `f2db3a1`, `06c6956`, and accepted review head `59dba42` (spec and quality PASS).

The shipped contract already:

- bounds event ID/type/user ID;
- rejects missing or non-safe timestamps;
- rejects timestamps outside the JavaScript `Date` range with `Number.isFinite(eventAt.getTime())`;
- bounds entitlement metadata to 16 strings and 128 characters per string;
- classifies unknown events as non-reconciling.

Task 1A deliberately replaces its single-shape subject model; do not revert the shipped date or per-entitlement bounds.

## Task 1A: Refactor parsing to ordinary/transfer discriminated unions

**Files:**

- Modify `artifacts/api-server/src/lib/revenuecatContract.ts`.
- Modify `scripts/tests/revenuecat-contract.test.mjs`.

- [ ] **Step 1: Add failing real-shape transfer and alias tests**

Use a RevenueCat transfer body without `app_user_id`:

```js
const transfer = {
  api_version: "1.0",
  event: {
    id: "87654321-4321-4321-4321-210987654321",
    type: "TRANSFER",
    event_timestamp_ms: 1_725_000_000_000,
    transferred_from: ["$RCAnonymousID:old-device", "firebase-user-old", "firebase-user-old"],
    transferred_to: ["firebase-user-new", "$RCAnonymousID:new-device"],
    environment: "PRODUCTION",
  },
};

const parsed = parseRevenueCatDelivery(transfer);
assert.equal(parsed.ok, true);
assert.equal(parsed.value.kind, "transfer");
assert.deepEqual(parsed.value.transferredFrom, [
  "$RCAnonymousID:old-device",
  "firebase-user-old",
]);
assert.deepEqual(parsed.value.transferredTo, [
  "firebase-user-new",
  "$RCAnonymousID:new-device",
]);
assert.equal("userId" in parsed.value, false);
```

Also assert:

- transfer succeeds without `app_user_id`;
- ordinary recognized and unknown deliveries still require bounded `app_user_id`;
- each raw transfer array contains 1–32 entries and still contains 1–32 unique strings after deduplication; each entry is trimmed, well-formed Unicode, and 1–256 characters;
- empty sides, non-strings, overlong aliases, too many aliases, invalid dates, and missing event identity fail;
- anonymous aliases are preserved request-locally, not rejected;
- the existing 16×128 entitlement metadata and finite-Date tests continue to pass.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
```

Expected: new transfer tests fail because the shipped parser still requires `app_user_id`.

- [ ] **Step 3: Implement the discriminated union**

Export:

```ts
export interface RevenueCatEventMetadata {
  productId: string | null;
  entitlementIds: string[];
  store: string | null;
  environment: string | null;
}

interface RevenueCatDeliveryBase {
  eventId: string;
  type: string;
  eventAt: Date;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: RevenueCatEventMetadata;
}

export interface OrdinaryRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "ordinary";
  userId: string;
  originalUserId: string | null;
}

export interface TransferRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "transfer";
  type: "TRANSFER";
  transferredFrom: string[];
  transferredTo: string[];
}

export type RevenueCatDelivery =
  | OrdinaryRevenueCatDelivery
  | TransferRevenueCatDelivery;
```

Normalize and deduplicate arrays while preserving first-seen order. `TRANSFER` takes only the transfer branch; every other type takes the ordinary branch. Preserve the accepted ordinary `userId`/`originalUserId` public fields while mapping them from bounded `app_user_id`/`original_app_user_id`. Retain the shipped finite-Date and metadata bounds.

- [ ] **Step 4: Run GREEN and commit**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

Commit:

```text
fix: model revenuecat transfer deliveries
```

## Task 2: Add the forward-only normalized schema, legacy scrub, and proven PostgreSQL harness

**Files:**

- Create `lib/db/migrations/0004_revenuecat_entitlement_integrity.sql`.
- Create `lib/db/src/schema/revenuecat.ts`.
- Modify `lib/db/src/schema/index.ts`.
- Modify `lib/db/src/schema/subscriptions.ts`.
- Create `scripts/tests/revenuecat-integration.test.mjs`.
- Modify `scripts/tests/user-data-integration.test.mjs`.

- [ ] **Step 1: Create the failing integration harness and schema assertions**

Copy the proven ordering from `user-data-integration.test.mjs`: require a database name containing `test`, create a unique schema, run migrations against a URL whose `options` sets that schema, set `process.env.DATABASE_URL`, register `tsx/esm/api`, and only then dynamically import `@workspace/db`-dependent TypeScript modules. Do not statically import DB/API TypeScript at test-module scope.

The new test must throw when `CI=true` and `TEST_DATABASE_URL` is absent; otherwise it may skip locally. Assert exact columns, PKs, checks, indexes, and FKs for all five tables below. For the upgrade fixture, run an exact temporary migration directory containing `0000`–`0003`, seed a hostile legacy row with `entitlement_active=true`, overlong entitlement/product/store values, a future `last_event_at`, and raw `last_event`, then rerun the same runner against the full directory so only `0004` applies. Migration must succeed, create only the fixed inactive `__legacy_unverified__` sentinel at the epoch, and scrub the raw event. A post-migration attempt to write non-null `subscriptions.last_event` must fail specifically on `subscriptions_last_event_must_be_null`. Add a two-user transfer fixture whose entitlements reference one shared event; deleting user A must delete only A-linked subject/alias/state/entitlement rows while user B and the PII-free event remain.

Update every hardcoded migration/table assertion in `user-data-integration.test.mjs`:

- add migration `0004_revenuecat_entitlement_integrity.sql` to blank-install, concurrent-runner, checksum-fixture, and baseline-adoption lists/counts;
- preserve `0003_account_deletion_identity_outbox.sql` immediately before `0004` in every expected sequence; the live runner discovers `.sql` files and sorts them lexically, so `migrate.mjs` itself does not change;
- add all five new tables to `expectedApplicationTables`;
- keep all existing deletion/outbox cases unchanged.

- [ ] **Step 2: Run RED**

Run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: new schema assertions fail because migration `0004` is absent.

- [ ] **Step 3: Create migration `0004`**

Create these exact relations:

```sql
CREATE TABLE "revenuecat_webhook_events" (
  "event_id" varchar(128) PRIMARY KEY,
  "type" varchar(64) NOT NULL,
  "event_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "environment" varchar(16),
  "disposition" varchar(32) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "processing_lease_id" varchar(128),
  "processing_lease_until" timestamptz,
  "processed_at" timestamptz,
  CONSTRAINT "revenuecat_event_identity_valid"
    CHECK (
      "event_id" ~ '^[A-Za-z0-9_-]{8,128}$'
      AND "type" ~ '^[A-Z0-9_]{3,64}$'
      AND "event_at" > '1970-01-01T00:00:00Z'::timestamptz
    ),
  CONSTRAINT "revenuecat_event_environment_valid"
    CHECK ("environment" IS NULL OR "environment" IN ('production','sandbox')),
  CONSTRAINT "revenuecat_event_disposition_valid"
    CHECK ("disposition" IN ('pending','applied','stale','ignored_unknown')),
  CONSTRAINT "revenuecat_event_metadata_object"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "revenuecat_event_attempt_count_valid"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "revenuecat_event_lease_consistent"
    CHECK (
      ("processing_lease_id" IS NULL) = ("processing_lease_until" IS NULL)
      AND ("processing_lease_id" IS NULL OR length("processing_lease_id") BETWEEN 8 AND 128)
    ),
  CONSTRAINT "revenuecat_event_state_consistent"
    CHECK (
      ("disposition" = 'pending' AND "processed_at" IS NULL)
      OR
      ("disposition" <> 'pending' AND "processed_at" IS NOT NULL
        AND "processing_lease_id" IS NULL AND "processing_lease_until" IS NULL)
    )
);

CREATE TABLE "revenuecat_event_subjects" (
  "event_id" varchar(128) NOT NULL
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE CASCADE,
  "subject_hash" char(64) NOT NULL,
  "role" varchar(32) NOT NULL,
  "local_user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("event_id", "subject_hash", "role"),
  CONSTRAINT "revenuecat_subject_hash_valid"
    CHECK ("subject_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_subject_role_valid"
    CHECK ("role" IN ('primary','original','transferred_from','transferred_to'))
);

CREATE TABLE "revenuecat_customer_aliases" (
  "alias_hash" char(64) PRIMARY KEY,
  "local_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "alias_kind" varchar(32) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_alias_hash_valid"
    CHECK ("alias_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_alias_kind_valid"
    CHECK ("alias_kind" IN ('authenticated','anonymous','original','transferred'))
);

CREATE TABLE "revenuecat_customer_state" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "canonicalization_state" varchar(32) NOT NULL DEFAULT 'legacy_unverified',
  "source_kind" varchar(32) NOT NULL DEFAULT 'legacy_unverified',
  "canonicalized_at" timestamptz,
  "source_environment" varchar(16),
  "last_snapshot_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_customer_canonicalization_valid"
    CHECK ("canonicalization_state" IN ('legacy_unverified','canonical')),
  CONSTRAINT "revenuecat_customer_source_kind_valid"
    CHECK ("source_kind" IN ('legacy_unverified','webhook_canonical','bootstrap_canonical')),
  CONSTRAINT "revenuecat_customer_environment_valid"
    CHECK ("source_environment" IS NULL OR "source_environment" IN ('production','sandbox')),
  CONSTRAINT "revenuecat_customer_canonicalized_consistent"
    CHECK (
      ("canonicalization_state" = 'legacy_unverified'
        AND "source_kind" = 'legacy_unverified'
        AND "canonicalized_at" IS NULL
        AND "source_environment" IS NULL
        AND "last_snapshot_at" IS NULL)
      OR
      ("canonicalization_state" = 'canonical'
        AND "source_kind" IN ('webhook_canonical','bootstrap_canonical')
        AND "canonicalized_at" IS NOT NULL
        AND "source_environment" IS NOT NULL
        AND "last_snapshot_at" IS NOT NULL)
    )
);

CREATE TABLE "subscription_entitlements" (
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "entitlement_id" varchar(128) NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "status" varchar(32) NOT NULL,
  "product_id" varchar(256),
  "store" varchar(32),
  "period_ends_at" timestamptz,
  "grace_ends_at" timestamptz,
  "access_ends_at" timestamptz,
  "will_renew" boolean NOT NULL DEFAULT false,
  "source_environment" varchar(16),
  "source_kind" varchar(32) NOT NULL,
  "source_event_at" timestamptz NOT NULL,
  "source_event_id" varchar(128)
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE RESTRICT,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "entitlement_id"),
  CONSTRAINT "subscription_entitlement_id_valid"
    CHECK (length(btrim("entitlement_id")) BETWEEN 1 AND 128),
  CONSTRAINT "subscription_entitlement_status_valid"
    CHECK ("status" IN ('active','trial','cancelled','billing_issue','grace','expired','refunded','paused')),
  CONSTRAINT "subscription_entitlement_environment_valid"
    CHECK ("source_environment" IS NULL OR "source_environment" IN ('production','sandbox')),
  CONSTRAINT "subscription_entitlement_source_kind_valid"
    CHECK ("source_kind" IN ('legacy_unverified','webhook_canonical','bootstrap_canonical')),
  CONSTRAINT "subscription_entitlement_source_consistent"
    CHECK (
      ("source_kind" = 'legacy_unverified'
        AND "source_environment" IS NULL AND "source_event_id" IS NULL
        AND "source_event_at" = '1970-01-01T00:00:00Z'::timestamptz)
      OR
      ("source_kind" = 'bootstrap_canonical'
        AND "source_environment" IS NOT NULL AND "source_event_id" IS NULL
        AND "source_event_at" = '1970-01-01T00:00:00Z'::timestamptz)
      OR
      ("source_kind" = 'webhook_canonical'
        AND "source_environment" IS NOT NULL AND "source_event_id" IS NOT NULL
        AND "source_event_at" > '1970-01-01T00:00:00Z'::timestamptz)
    ),
  CONSTRAINT "subscription_entitlement_inactive_status_valid"
    CHECK ("status" NOT IN ('expired','refunded') OR "active" = false),
  CONSTRAINT "subscription_entitlement_access_window_valid"
    CHECK (
      "status" = 'refunded'
      OR "access_ends_at" IS NULL
      OR "period_ends_at" IS NULL
      OR "access_ends_at" >= "period_ends_at"
    )
);
```

Create these indexes:

- `IDX_revenuecat_events_type_time(type,event_at DESC)`;
- `IDX_revenuecat_events_pending_lease(disposition,processing_lease_until)`;
- `IDX_revenuecat_event_subjects_local(local_user_id,event_id)`;
- `IDX_revenuecat_aliases_local(local_user_id)`;
- `IDX_revenuecat_customer_state_pending(canonicalization_state,user_id)`;
- `IDX_subscription_entitlements_active(user_id,active,access_ends_at)`;
- `IDX_subscription_entitlements_source(user_id,source_event_at,source_event_id)`.

The event row contains no user/alias field. `metadata` is constructed field-by-field from the bounded contract allowlist (period type plus counts/booleans needed for operations), never by spreading `event` or storing product, transaction, or subject identifiers. Subject/alias tables contain only keyed hashes. Because the event is not owned by one user, deleting either side of a transfer cascades that user's entitlement before any event relationship matters. `source_event_id` is `RESTRICT` so the ordering ID cannot silently disappear; it never references a user and therefore cannot block user deletion. For webhook projections, processor tests require `subscription_entitlements.source_event_at` to equal the referenced ledger `event_at`; bootstrap/legacy use the checked epoch. `canonicalized_at`, `last_snapshot_at`, and `updated_at` use database transaction time and never participate in event ordering.

Backfill exactly:

```sql
INSERT INTO "revenuecat_customer_state" (
  "user_id", "canonicalization_state", "source_kind"
)
SELECT "user_id", 'legacy_unverified', 'legacy_unverified'
FROM "subscriptions"
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "subscription_entitlements" (
  "user_id", "entitlement_id", "active", "status", "product_id", "store",
  "period_ends_at", "grace_ends_at", "access_ends_at", "will_renew",
  "source_environment", "source_kind", "source_event_at", "source_event_id"
)
SELECT
  "user_id", '__legacy_unverified__', false, 'expired', NULL, NULL,
  NULL, NULL, NULL, false,
  NULL, 'legacy_unverified', '1970-01-01T00:00:00Z'::timestamptz, NULL
FROM "subscriptions"
ON CONFLICT ("user_id", "entitlement_id") DO NOTHING;

UPDATE "subscriptions" SET "last_event" = NULL WHERE "last_event" IS NOT NULL;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_last_event_must_be_null"
  CHECK ("last_event" IS NULL);
```

The fixed sentinel avoids migration failures or accidental trust from unbounded legacy entitlement/product/store/date values; bootstrap deletes it in the same transaction that writes the two configured canonical rows. The null-only constraint is defense in depth against any raw-payload rewrite, but does not make the old handler deletion-safe; rollout therefore forbids old/new replica overlap. Do not create synthetic legacy event rows, do not copy `entitlement_active`, and do not use `last_event_at` as a source clock.

- [ ] **Step 4: Mirror the schema in Drizzle**

Define all five tables, checks, indexes, PKs, and FK actions exactly in `lib/db/src/schema/revenuecat.ts`; export select/insert types and re-export from `schema/index.ts`. Mirror `subscriptions_last_event_must_be_null` in `schema/subscriptions.ts` so the Drizzle schema reflects the database-enforced invariant.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
pnpm run typecheck:libs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
```

Expected: schema/typecheck PASS; PostgreSQL tests execute when configured; every existing deletion/outbox test remains green.

Commit:

```text
feat: add revenuecat normalized entitlement schema
```

## Task 3: Add fail-closed configuration and a bounded canonical client

**Files:**

- Create `artifacts/api-server/src/lib/revenuecatConfig.ts`.
- Create `artifacts/api-server/src/lib/revenuecatClient.ts`.
- Modify `artifacts/api-server/src/index.ts`.
- Modify `artifacts/api-server/src/routes/health.ts`.
- Modify `.env.example`.
- Modify `scripts/tests/revenuecat-contract.test.mjs`.

- [ ] **Step 1: Add failing config, byte-limit, timeout, environment, and truth-table tests**

Assert configuration rejects missing/blank secrets; a webhook header or API key over 1,024 UTF-8 bytes; an HMAC key outside 32–1,024 UTF-8 bytes; entitlement IDs outside 1–128 characters, equal after trimming, or equal to reserved `__legacy_unverified__`; an unknown environment/read mode; and startup in any runtime without every required value.

Inject `fetch` and a clock into the canonical client. Test:

- URL uses `encodeURIComponent` and rejects traversal/overlong IDs;
- bearer secret is present only in the outbound Authorization header;
- non-2xx responses become typed errors; `404` becomes `subscriber_not_found`;
- `429`/5xx/network/timeout errors are retryable without logging body/key;
- malformed JSON, invalid UTF-8, or a response that fails the bounded canonical schema becomes typed `canonical_response_invalid`, is retryable, and cannot project state;
- declared `Content-Length > 1_048_576` is rejected before reading;
- chunked responses are read through a stream counter and aborted as soon as accumulated bytes exceed 1,048,576;
- the client uses a 5-second abort timeout and `JSON.parse` only after the bounded UTF-8 text is complete—never unbounded `response.json()`;
- mixed production/sandbox candidates retain only configured environment;
- every row in the truth table above, including lifetime, non-subscription, refund, grace, cancellation, pause, billing issue, trial, expired, and multiple-product tie-breaking;
- configured entitlements absent from the snapshot produce explicit inactive/expired rows.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
```

Expected: new config/client tests fail because the modules do not exist.

- [ ] **Step 3: Implement validated configuration**

Add:

```dotenv
REVENUECAT_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
REVENUECAT_SECRET_API_KEY=replace-with-a-secret-server-api-key
REVENUECAT_SUBJECT_HASH_KEY=replace-with-at-least-32-random-bytes
REVENUECAT_PRO_ENTITLEMENT_ID=Elovia Pro
REVENUECAT_COACHING_ENTITLEMENT_ID=Elovia Coaching
REVENUECAT_ENVIRONMENT=production
REVENUECAT_NORMALIZED_READS=per_user
```

`loadRevenueCatConfig(env)` returns an immutable validated object. `src/index.ts` loads it before `listen`; invalid configuration aborts startup in development, test, staging, and production, so the platform can never mark that process ready. `/readyz` also receives the validated config status and defensively reports not ready if it is invalid. `REVENUECAT_NORMALIZED_READS` accepts exactly `legacy | per_user | strict`; rollout begins in `per_user` and ends in `strict` after Task 5 bootstrap.

- [ ] **Step 4: Implement the bounded client**

Export `createRevenueCatClient({apiKey,environment,fetchImpl,now,timeoutMs=5000,maxResponseBytes=1048576})`. Normalize only allowlisted fields required by the truth table. Do not return subscriber attributes or raw JSON. Include the raw app-user ID only as a request argument; it must not enter errors/logs.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

Commit:

```text
feat: add bounded revenuecat canonical client
```

## Task 4: Implement neutral account locks and the complete processor

**Files:**

- Modify `artifacts/api-server/src/lib/accountDeletion.ts`.
- Create `artifacts/api-server/src/lib/revenuecatProcessor.ts`.
- Modify `scripts/tests/revenuecat-integration.test.mjs`.

- [ ] **Step 1: Add failing lock-regression tests**

Add tests that prove:

- `withAccountLock(uid, callback)` takes the existing advisory key and invokes the callback whether the user is active, missing, or tombstoned;
- `withAccountLocks([uids], callback)` deduplicates and locks sorted UIDs in one transaction;
- repeated deletion still returns the original tombstone/request;
- identity-outbox lease/retry/finalization tests remain unchanged;
- provisioning still checks the tombstone under the same lock;
- a missing user is distinguishable from a tombstoned user.

Do not define an “active-only” primitive that deletion must use.

- [ ] **Step 2: Add failing processor behavior/concurrency tests**

Use fake canonical clients and real PostgreSQL. Cover:

- 20 concurrent identical ordinary deliveries: one applied, 19 duplicate, one event row;
- the 20-delivery case performs exactly one canonical call; an unexpired non-owner claim waits, while an expired/released claim is resumable;
- a transfer owner renews its lease between bounded fetch batches, and a simulated lost lease prevents all projection writes;
- a terminal duplicate performs no additional canonical call, and a same-ID/different-envelope collision returns `400` without mutation;
- newer then older distinct events: older stored `stale`, no normalized or legacy mutation;
- equal timestamp uses lexical event ID tie-break;
- Pro and Coaching coexist and independent rows advance;
- absent entitlement is projected inactive/expired;
- unknown event for existing user is ledgered `ignored_unknown` without client call or state mutation;
- unknown event for missing/deleted user leaves zero ledger/subject/alias rows;
- tombstone found before network causes no client call and returns `ignored_deleted`;
- deletion after precheck but before final transaction wins the authoritative recheck;
- canonical `subscriber_not_found` followed by a tombstone recheck returns `ignored_deleted`; the same error for a non-deleted ordinary customer remains typed/retryable;
- `$RCAnonymousID:*` ordinary event without an existing alias is `ignored_missing` and never creates `users`;
- legacy false-grant row remains inactive in normalized storage;
- compatibility projection sets every column exactly and keeps `last_event` null;
- when no normalized row advances, legacy projection is byte-for-byte unchanged.

Transfer fixtures must use the Task 1A real shape and cover:

- existing source → existing destination;
- anonymous source alias → existing destination;
- missing non-anonymous destination provisioned only after canonical success and final tombstone check;
- anonymous destination never provisioned;
- deleted source with active destination, active source with deleted destination, and both deleted;
- canonical source not-found means empty/inactive source state only for `transferred_from` processing;
- source aliases move only to one unambiguous retained destination; direct local-UID aliases stay pinned to their own UID, and conflicting destination ownership fails closed without projection;
- 50 transfer-vs-deletion races with the invariant: each local UID ends either active with its own rows or tombstoned with none, and no transaction deadlocks;
- one shared transfer event can update two users and deleting either user leaves the other user/event valid.

- [ ] **Step 3: Run RED**

Run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: new lock/processor cases fail.

- [ ] **Step 4: Implement neutral lock primitives**

Export the transaction type derived from the live Drizzle `db.transaction` callback and:

```ts
withAccountLock<T>(userId: string, callback: (tx: DbTransaction) => Promise<T>): Promise<T>
withAccountLocks<T>(userIds: readonly string[], callback: (tx: DbTransaction) => Promise<T>): Promise<T>
```

`withAccountLocks` rejects empty UIDs, deduplicates the exact strings without rewriting them, and sorts them by ascending UTF-8 byte order (`Buffer.compare`) before acquiring the same `hashtextextended(uid, ACCOUNT_DELETION_LOCK_SEED)` transaction locks. Refactor provisioning and deletion on the neutral primitive without changing their public results. Build separate internal helpers for `existing | missing | deleted` lookup and recognized provisioning. Never export an unlocked provisioning path.

- [ ] **Step 5: Implement ordinary/unknown processing**

Processing sequence:

1. Hash request-local subjects with the configured HMAC key.
2. Terminal event read fast path: validate the immutable envelope and return duplicate without network.
3. Unknown: resolve only an existing alias/local UID; enter the neutral account lock; recheck user/tombstone; insert a terminal PII-free `ignored_unknown` event plus local subject hash only for an existing user; otherwise return without persistence.
4. Recognized anonymous ordinary delivery: resolve an existing alias first; if none, return `ignored_missing` without persistence, claim, or fetch. Never provision the alias.
5. Recognized delivery: perform an unlocked tombstone precheck, then acquire the event claim described above. A non-owner waits/returns without calling RevenueCat. Only the owner proceeds.
6. The owner fetches canonical state outside any transaction/account lock, enters the account lock, verifies its event lease, and rechecks the tombstone. Provision a missing non-anonymous local UID only after canonical success and this final check. If deleted, delete the owned pending claim and return `ignored_deleted`.
7. Conditionally upsert both configured entitlement rows using `(source_event_at, COALESCE(source_event_id,''))` SQL comparison. Write absent rows explicitly.
8. If at least one row advances, mark customer state canonical with `source_kind='webhook_canonical'`, recompute every compatibility column, and atomically finalize the event as applied. If none advances, finalize it stale and do not touch compatibility state.
9. Commit before returning.

On retryable external/normalization failure, release only the owner lease and leave the PII-free event pending for a later delivery; no subject, alias, customer, entitlement, or compatibility row is written. If an insert/update fails, the final transaction rolls back all projections and leaves the earlier claim safely reclaimable after its bounded lease.

- [ ] **Step 6: Implement transfer processing**

For a transfer:

1. Hash every source/destination alias and resolve existing mappings/local users.
2. Treat direct, non-anonymous destination IDs as provisionable candidates; anonymous IDs never are.
3. Precheck tombstones for every known/provisionable local UID. If no eligible local/provisionable side remains, acknowledge without a claim or hashes.
4. Acquire the event claim. Only its owner fetches unique source and destination canonical snapshots outside a DB transaction, in batches of at most eight with conditional lease renewal before each batch. A typed `subscriber_not_found` source is an empty source snapshot only for `transferred_from`; destination not-found is retryable unless a second tombstone check proves deletion.
5. Acquire all resolved/provisionable non-deleted local UID account locks in sorted order in one transaction, verify the event lease, and recheck every tombstone.
6. Skip deleted sides, provision only successful non-anonymous destinations, and attach bounded subject hashes/roles to the single PII-free event. Set `local_user_id` when an alias resolves to a retained user; it is null only for an otherwise relevant unresolved alias.
7. Resolve destination ownership before mutation. An identifier equal to an existing/provisioned non-anonymous local UID is permanently pinned to that UID. All remaining destination aliases must collapse to one retained destination UID; multiple destination UIDs or an alias pinned to a different authenticated UID is typed `alias_conflict`, releases the event lease, and writes no projection. On success, move anonymous/nonlocal source aliases and all nonlocal destination aliases to that destination; never move an authenticated local-UID alias or map anything to a deleted destination.
8. Atomically deactivate/reconcile every retained source, reconcile the retained destination, update aliases/customer states, recompute only compatibility rows whose normalized state advanced, and finalize the event applied/stale.
9. If the authoritative recheck leaves no local side, delete the owned pending event and its cascaded subjects, then acknowledge `ignored_deleted`/`ignored_missing` without hashes.

Never hold a database transaction or account advisory lock across a RevenueCat network request. Event claims are durable rows, not locks held during I/O.

- [ ] **Step 7: Run GREEN and commit**

Run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
pnpm typecheck
```

Expected: PASS, including every pre-existing account-deletion/outbox test.

Commit:

```text
fix: serialize revenuecat projections and transfers
```

## Task 5: Canonically bootstrap legacy users and switch entitlement authority safely

**Files:**

- Create `artifacts/api-server/src/lib/revenuecatReconciler.ts`.
- Create `scripts/reconcile-revenuecat.mjs`.
- Modify `artifacts/api-server/src/lib/entitlements.ts`.
- Modify `artifacts/api-server/src/routes/health.ts`.
- Modify `scripts/tests/revenuecat-contract.test.mjs`.
- Modify `scripts/tests/revenuecat-integration.test.mjs`.

- [ ] **Step 1: Add failing bootstrap and resolution tests**

Test with injected clocks/config/client:

- bootstrap selects only users with legacy `subscriptions` rows whose customer state is not canonical;
- it processes deterministic `user_id` cursor batches and resumes safely;
- bootstrap uses `source_kind='bootstrap_canonical'` and Unix epoch ordering, so the next real webhook always wins;
- a legacy row with `entitlement_active=true` created by an unknown-event shape receives either a canonical empty snapshot or typed `subscriber_not_found` and resolves free/trial, never premium;
- deleted users are skipped without client calls after tombstone precheck and cannot be recreated;
- retryable canonical errors leave the user uncanonicalized and cause nonzero command exit;
- repeated bootstrap is idempotent;
- a real webhook racing bootstrap always owns the final row: bootstrap rechecks `legacy_unverified` under the account lock and cannot overwrite a webhook-canonical state;
- `per_user` reads normalized state only for canonicalized users and temporarily falls back to legacy only for uncanonicalized users with an existing legacy subscription row;
- `strict` never reads legacy subscription access;
- Pro alone → premium;
- Coaching alone or Pro+Coaching → coaching with Pro access;
- cancelled/billing issue/paused within effective deadline remain entitled with exact status;
- grace uses `accessEndsAt`, not expired `periodEndsAt`;
- refunded/expired/mismatched-environment rows grant nothing;
- no paid state falls back to the exact existing 15-day account trial, then free;
- readiness in strict mode fails while any legacy subscription user remains uncanonicalized.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: bootstrap/resolver cases fail.

- [ ] **Step 3: Implement the reconciler and CLI**

`revenuecatReconciler.ts` exposes a batch operation with injected client/clock/DB. It fetches by the local `subscriptions.user_id`, never the untrusted legacy `revenuecat_user_id`, and uses the Task 4 tombstone precheck/final lock recheck, canonical truth table, normalized projection, customer-state update, and complete compatibility projection. Unlike a fresh webhook whose 404 may reflect read-after-write lag, bootstrap has no triggering delivery: after the second tombstone check, typed `subscriber_not_found` for an existing local user is authoritative empty state in the configured environment. Bootstrap rows use the epoch/null-event tuple and never create a webhook-event row or hash a UID into an event ID. A bootstrap update is permitted only from `legacy_unverified`; its transaction deletes `__legacy_unverified__`, writes both configured entitlement rows, and sets customer state to canonical with `source_kind='bootstrap_canonical'`. After that transition, the same user is not selected again.

`scripts/reconcile-revenuecat.mjs` follows the proven test bootstrap: validate configuration, set/import modules in the correct order, page by `user_id`, print counts only, and set a nonzero exit code if any user remains retryable/unreconciled. It never prints UIDs, aliases, response bodies, or keys.

Run the production bootstrap before enabling strict reads:

```powershell
node scripts/reconcile-revenuecat.mjs --batch-size=100
```

Expected: exit 0 and `unreconciled=0`. Then set `REVENUECAT_NORMALIZED_READS=strict` and redeploy. `/readyz` queries for uncanonicalized legacy subscribers and fails closed if any remain.

- [ ] **Step 4: Implement normalized entitlement resolution**

Query both configured entitlement rows and customer state. Gate using only matching configured environment and `active && (!accessEndsAt || accessEndsAt > now)`. Coaching wins display selection, then Pro. Preserve exact account-created trial logic. `legacy` mode exists only for emergency rollback; `per_user` is rollout mode; `strict` is the completed P0 state and never grants from `subscriptions`.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
pnpm typecheck
```

Expected: PASS.

Commit:

```text
fix: bootstrap canonical revenuecat entitlements
```

## Task 6: Replace the route with an injectable, pre-auth, bounded transport

**Files:**

- Modify `artifacts/api-server/src/routes/webhooks/revenuecat.ts`.
- Modify `artifacts/api-server/src/routes/index.ts`.
- Modify `artifacts/api-server/src/app.ts`.
- Modify `artifacts/api-server/src/index.ts`.
- Modify `artifacts/api-server/src/routes/privacy.ts`.
- Modify `artifacts/api-server/src/routes/diagnostics.ts`.
- Create `scripts/tests/revenuecat-http.test.mjs`.

- [ ] **Step 1: Add failing HTTP boundary tests**

Register TypeScript loading before dynamic imports. Build the app/router with an injected webhook secret, fake processor, no-op Firebase middleware, and empty authenticated router; the HTTP test must not require `DATABASE_URL` or import production DB routes. Assert:

- bad/missing Authorization → 401;
- missing configured secret at construction/startup → fail closed;
- malformed JSON/schema → 400;
- a validly authenticated body above 256 KiB → 413 before parsing or processor invocation;
- webhook does not invoke Firebase token verification even when the shared secret uses a `Bearer ` prefix;
- valid applied → 200 `{received:true,applied:true,disposition:'applied'}`;
- duplicate/stale/ignored_unknown/ignored_missing/ignored_deleted → 200 with `applied:false` and exact disposition;
- same-ID/different-ledger-envelope → 400 `event_id_collision`; an unexpired pending claim that does not finish within the bounded wait → 503 `processing` with `Retry-After: 1`;
- canonical retryable/not-found-for-active/network failure → typed 503 plus bounded `Retry-After`;
- logs contain request ID, event ID/type/disposition only—no UID, subject hash, alias, secret, subscriber attribute, or raw body;
- diagnostics expose booleans only for webhook secret, API key, HMAC key, configured distinct IDs, environment, and strict-read state;
- privacy export returns normalized entitlement and allowlisted event metadata/subject roles, never subject hashes, aliases, raw legacy event JSON, or secrets.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test scripts/tests/revenuecat-http.test.mjs
```

Expected: tests fail because the current route is stateful and mounted after global parsing/auth.

- [ ] **Step 3: Create the injectable route seam**

Export:

```ts
createRevenueCatWebhookRouter({
  processor,
  webhookSecret,
}: {
  processor: RevenueCatProcessor;
  webhookSecret: string;
}): IRouter
```

Compare the complete Authorization header to the configured RevenueCat header value. Bound the supplied header to 1,024 bytes, hash supplied and expected values separately with SHA-256, and use `timingSafeEqual` on the equal-length digests; never branch on the original secret length. The production default is assembled from validated configuration, but tests inject both dependencies without mutating process-global environment.

Make `app.ts` DB-free and export `createApp({ revenueCatRouter, authenticatedRouter, authMiddlewareImpl })`, with all three dependencies required. Mount `app.use('/api', revenueCatRouter)` immediately after request logging/CORS and before the existing global JSON/urlencoded parsers and injected Firebase auth, preserving `/api/webhooks/revenuecat`; then mount the injected authenticated router at `/api`. `index.ts` imports the production aggregate router/auth middleware, creates the validated processor/router, calls `createApp`, and listens. Inside the webhook router, order middleware as constant-time shared-secret authentication, then `express.json({limit:'256kb',strict:true,type:'application/json'})`, then schema parsing/processor invocation. Remove the webhook from the later aggregate router so it cannot be mounted twice. Other routes retain their current parser/auth behavior.

The transport only authenticates, parses, invokes the processor, and maps outcomes. It never imports `usersTable`, `subscriptionsTable`, or canonical client internals.

- [ ] **Step 4: Complete privacy, diagnostics, and readiness surfaces**

Export allowlisted event metadata and normalized entitlements. Subject roles may be reported without hashes. Local-user cascade remains the deletion mechanism; add an integration assertion that account deletion removes all local-linked aliases/subjects/state/entitlements. Diagnostics emit booleans only. Readiness remains false for invalid configuration or strict-mode unreconciled legacy users.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node --test scripts/tests/revenuecat-http.test.mjs
pnpm test
pnpm typecheck
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

Commit:

```text
fix: make revenuecat webhook transport fail closed
```

## Task 7: PostgreSQL 14/16 replay and release gate

**Files:**

- `scripts/tests/revenuecat-contract.test.mjs`.
- `scripts/tests/revenuecat-integration.test.mjs`.
- `scripts/tests/revenuecat-http.test.mjs`.
- `.github/workflows/ci.yml` only if the required-DB guard proves the existing `pnpm test` step does not execute the new integration file; the current PG14/16 matrix otherwise remains unchanged.

- [ ] **Step 1: Complete the final real delivery matrix**

Fixtures must cover ordinary `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `REFUND`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `SUBSCRIPTION_PAUSED`, non-renewing/lifetime, one future unknown, and real-shape `TRANSFER`. For each recognized type, fake canonical state—not webhook expiry—drives the result.

The matrix must include:

- reverse delivery order and equal-timestamp event-ID tie-breaking;
- two independent entitlements and explicit absence/revocation;
- 20 concurrent duplicate deliveries;
- mixed environment and test-store rejection;
- missing/deleted/anonymous subjects;
- canonical 404 distinctions;
- transfer aliases, sorted multi-user locks, one-side deletion, and transfer/deletion races;
- legacy false grant, epoch clock, canonical bootstrap, strict read cutover;
- raw-payload scrub and privacy cascade;
- compatibility projection exactness and stale no-op;
- HTTP body/auth/logging/error contracts.

- [ ] **Step 2: Confirm CI database enforcement**

The integration file must contain:

```js
if (process.env.CI === "true" && !process.env.TEST_DATABASE_URL) {
  throw new Error("CI must provide TEST_DATABASE_URL for RevenueCat integration tests");
}
```

The existing workflow already runs `pnpm test` against PostgreSQL 14 and 16. Do not add a redundant matrix or permit CI skip.

- [ ] **Step 3: Run the full local/release gate**

Run:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
pnpm test
pnpm typecheck
pnpm --filter @workspace/mobile typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server run build
Remove-Item Env:TEST_DATABASE_URL
$baseSha = '59dba42c61d4ba8e88479c7bf7c608171967181a'
git diff --check "$baseSha..HEAD"
```

Expected: zero failures; integration tests execute rather than skip while `TEST_DATABASE_URL` is present.

- [ ] **Step 4: Fresh spec and quality reviews**

Use a fresh spec reviewer and a fresh quality reviewer. Correct every Critical/Important issue through the owning task and repeat the complete gate. Commit review-only corrections separately:

```text
fix: close revenuecat review findings
```

---

## External configuration required for rollout

No implementation decision is blocked on credentials. Deployment does require operators to provide four secret/non-secret facts that code cannot infer: a RevenueCat secret REST API v1 key with subscriber-read access, the exact full Authorization header value configured for the webhook, a new random HMAC key of at least 32 bytes, and the exact distinct Pro/Coaching entitlement IDs plus `production | sandbox`. Store secrets in the deployment secret manager, not repository files or CI output. The operator must also configure the deployed `/api/webhooks/revenuecat` HTTPS URL in RevenueCat only after Task 6 is live. Bootstrap and staging replay use injected/fake clients in tests; a real production bootstrap requires the production API key and an approved maintenance/rollout window, but no mobile release or mobile secret is required.

---

## Rollout sequence

Task commits are review checkpoints, not independently safe production deployments. In particular, no old webhook replica may serve after `0004`: although the null-only constraint rejects its raw subscription write, the legacy handler provisions `users` before that failure and does not share the deletion lock.

1. Finish and review Tasks 1A–7; replay representative sandbox fixtures against a staging deployment with staging credentials/environment.
2. Preload all validated production configuration and keep `REVENUECAT_NORMALIZED_READS=per_user`.
3. Enter a short webhook/API maintenance window, remove traffic, and stop every old replica. Run migration `0004`, then start only the Task 2–6 server artifact and restore traffic. RevenueCat retries the bounded downtime; do not use a rolling overlap with the old handler.
4. Confirm the new pre-auth processor is handling live retries, both configured entitlements are projected independently, and readiness is green in `per_user` mode.
5. Run canonical bootstrap until `unreconciled=0`.
6. Set `REVENUECAT_NORMALIZED_READS=strict`, redeploy, and verify readiness plus Pro/Coaching/account-trial smoke tests.
7. Keep the event lease/error-rate and unreconciled-count signals under observation through the RevenueCat retry window.

Rollback may switch reads temporarily to `per_user` or `legacy`, but must not drop tables, restore raw payload writes, weaken tombstones, accept the wrong environment, or edit migrations `0000`–`0004`.

## Final self-review checklist

- Task 1A models ordinary and real-shape transfer deliveries separately and preserves shipped date/metadata bounds.
- No migration before `0004` is modified.
- The event ledger is PII-free and supports multi-user transfer events safely.
- Local subject/alias/state/entitlement data cascades without cross-user event ownership.
- Legacy active state is never promoted; its source clock is epoch and raw payload is scrubbed.
- Canonical bootstrap completes before strict normalized reads.
- Neutral single/multi-account locks preserve deletion retry/outbox semantics.
- Tombstones are checked before network and authoritatively under lock.
- Anonymous IDs are never provisioned.
- Transfers reconcile all retained sides atomically under sorted locks.
- Grace, refund, pause, cancel, trial, lifetime, environment, and multiple products follow one deterministic truth table.
- Absent and stale transitions are explicit.
- Compatibility projection sets every column and never writes `last_event`.
- Required config fails startup/readiness and diagnostics expose booleans only.
- Canonical responses have a real streaming byte limit and timeout.
- Webhook parsing happens before Firebase auth with a 256 KiB route limit.
- Existing migration assertions and account-deletion tests are updated/preserved.
- CI executes real PostgreSQL tests on 14 and 16.
- Final diff gate uses the explicit Task 1 base SHA, never `HEAD~N`.
- Unknown events cannot provision or grant, raw payload/PII/secrets are absent, deletion wins, and Pro+Coaching coexist.
