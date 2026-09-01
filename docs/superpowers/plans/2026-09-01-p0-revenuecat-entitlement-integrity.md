# RevenueCat Entitlement Integrity Implementation Plan

> **For agentic workers:** Execute one task at a time in strict RED → GREEN → complete verification → commit order. Task 1 is shipped. Task 1A must pass spec and quality review before Task 2 starts. Task commits are implementation checkpoints, not separately safe production deployments.

**Goal:** Make RevenueCat access canonical-snapshot-driven, idempotent per valid processing lease, order-safe, alias/transfer/redemption safe, independently multi-entitlement aware, recoverable after missed webhooks, and unable to create or resurrect an Elovia account.

**Architecture:** A webhook is a bounded trigger and audit record, never entitlement truth or a provisioning authority. Resolve presented RevenueCat identities only to already-trusted local users, claim the delivery, fetch a bounded v1 canonical snapshot by trusted local UID, and project configured products under the account-deletion lock. Canonical `request_date_ms` plus a byte-stable operation ID orders entitlement snapshots. A trusted-user reconciliation schedule makes webhook loss recoverable. The existing `subscriptions` row remains a null-raw-payload compatibility projection; no successful P0 read path grants from its legacy paid fields.

**Tech stack:** Node 22, Express 5, TypeScript, Drizzle ORM, PostgreSQL 14/16, RevenueCat REST API v1, Node test runner.

**Implementation base SHA:** `59dba42c61d4ba8e88479c7bf7c608171967181a` is the accepted Task 1 head after spec and quality PASS. Use this exact SHA in the final implementation diff gate.

---

## Phase 0: Authoritative documentation contract

Implementation must re-read these current official sources before copying fields:

- RevenueCat [Event Types and Fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields): ordinary subscriber identity is `app_user_id`, `original_app_user_id`, and `aliases[]`; `TRANSFER` uses `transferred_from[]`/`transferred_to[]`; current reconciling events include `REFUND_REVERSED` and `TEMPORARY_ENTITLEMENT_GRANT`.
- RevenueCat [Sample Events](https://www.revenuecat.com/docs/integrations/webhooks/sample-events): `PURCHASE_REDEEMED` has `redeemed_from[]`, `redeemed_by[]`, and `redemption_outcome` and can accompany a separate `TRANSFER`.
- RevenueCat [Customers API v1](https://www.revenuecat.com/docs/api-v1/customers): `GET /subscribers/{app_user_id}` is **Get or Create Customer**, returning `200` when found and `201` when created. It has no documented not-found response.
- RevenueCat [Customer Info Model](https://www.revenuecat.com/docs/api-v1/customer-info-model): response ordering comes from `request_date_ms`; subscription entries expose refund/billing/grace/pause/cancellation fields, while non-subscription entries expose purchase ID, purchase date, environment, and store but no refund field.

Allowed API behavior is therefore limited to the documented fields above. Do not invent a read-only v1 subscriber endpoint, a v1 `404`, non-subscription refund history, or an authoritative entitlement field not present in the response.

## File map and ownership

- Already shipped Task 1:
  - `artifacts/api-server/src/lib/revenuecatContract.ts`
  - `scripts/tests/revenuecat-contract.test.mjs`
- Task 1A:
  - Modify `artifacts/api-server/src/lib/revenuecatContract.ts`.
  - Modify `scripts/tests/revenuecat-contract.test.mjs`.
  - Create `artifacts/api-server/src/lib/revenuecatContract.typecheck.ts`.
- Task 2:
  - Create `lib/db/migrations/0004_revenuecat_entitlement_integrity.sql`.
  - Create `lib/db/src/schema/revenuecat.ts`.
  - Modify `lib/db/src/schema/index.ts` and `lib/db/src/schema/subscriptions.ts`.
  - Create `scripts/tests/revenuecat-integration.test.mjs`.
  - Modify `scripts/tests/user-data-integration.test.mjs`.
- Task 3:
  - Create `artifacts/api-server/src/lib/revenuecatConfig.ts`.
  - Create `artifacts/api-server/src/lib/revenuecatClient.ts`.
  - Create `artifacts/api-server/src/lib/revenuecatSnapshot.ts`.
  - Modify `.env.example`, `artifacts/api-server/src/index.ts`, and `artifacts/api-server/src/routes/health.ts`.
  - Modify `scripts/tests/revenuecat-contract.test.mjs`.
- Task 4:
  - Modify `artifacts/api-server/src/lib/accountDeletion.ts`.
  - Create `artifacts/api-server/src/lib/revenuecatProcessor.ts`.
  - Create `artifacts/api-server/src/lib/revenuecatReconciler.ts` with the shared transactional snapshot projector.
  - Modify `scripts/tests/revenuecat-integration.test.mjs`.
- Task 5:
  - Modify `artifacts/api-server/src/lib/revenuecatReconciler.ts` to add bounded provider fetch orchestration.
  - Create `artifacts/api-server/src/lib/revenuecatReconciliationWorker.ts`.
  - Create `scripts/reconcile-revenuecat.mjs`.
  - Modify `artifacts/api-server/src/middlewares/authMiddleware.ts`.
  - Modify `artifacts/api-server/src/lib/entitlements.ts`.
  - Modify `artifacts/api-server/src/routes/entitlement.ts`, `artifacts/api-server/src/routes/health.ts`, and `artifacts/api-server/src/index.ts`.
  - Modify `scripts/tests/revenuecat-contract.test.mjs` and `scripts/tests/revenuecat-integration.test.mjs`.
- Task 6:
  - Modify `artifacts/api-server/src/routes/webhooks/revenuecat.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/api-server/src/app.ts`, and `artifacts/api-server/src/index.ts`.
  - Create `artifacts/api-server/src/lib/revenuecatPresentation.ts`.
  - Modify `artifacts/api-server/src/routes/privacy.ts` and `artifacts/api-server/src/routes/diagnostics.ts`.
  - Create `scripts/tests/revenuecat-http.test.mjs` and `scripts/tests/revenuecat-presentation.test.mjs`.
  - Modify `scripts/tests/revenuecat-integration.test.mjs` for live DB-backed route wiring.
- Task 7 touches the three RevenueCat test files and `.github/workflows/ci.yml` only if the existing test command does not discover them.
- Do not modify migrations `0000`–`0003` or mobile purchase behavior.

## Non-negotiable invariants

1. Only Firebase-authenticated middleware provisions `users`. No webhook, RevenueCat response, alias, transfer, redemption, bootstrap, worker, or on-demand reconciliation creates a local user.
2. A RevenueCat v1 `201` means RevenueCat created an empty customer. It never authorizes local provisioning or creates a new 15-day trial; that trial derives only from an already-existing local `users.created_at`.
3. Unknown events, unsupported identity volume, unsupported redemption shapes, deliveries with no trusted local side, ordinary unmapped subjects, and conflicting owners never grant, revoke, provision, move aliases, or call RevenueCat. A valid newer `TRANSFER` may attach a non-tombstoned unmapped source alias to an already-trusted destination, but never fetches by that alias.
4. Ordinary events resolve the union of `app_user_id`, `original_app_user_id`, and `aliases[]`. More than one trusted local owner fails closed.
5. `$RCAnonymousID:*` is never provisioned or used in a provider GET. It is usable through an existing ordered mapping, or a valid newer `TRANSFER` may create that mapping only to an already-trusted destination.
6. Tombstones are checked before provider I/O and authoritatively under the same account lock used by deletion. Tombstoned transfer sides are removed before any v1 GET.
7. A delivery ID has one fetch owner per unexpired fenced lease. Crash/lease expiry can cause another GET; only the current fence commits. Do not claim globally exactly-once external calls.
8. Entitlement ordering uses canonical `request_date_ms` and an ASCII operation ID under PostgreSQL `COLLATE "C"`. Webhook time orders alias provenance and remains event audit data, never entitlement truth.
9. `Elovia Pro` and `Elovia Coaching` are independent rows. Coaching implies Pro feature access but never overwrites the Pro row.
10. Only configured, unambiguous products in the configured environment can grant. Production rejects sandbox/Test Store; sandbox rejects production.
11. A durable trusted-UID reconciliation schedule converges after provider failure or a missed retry window. It never stores a raw RevenueCat subject or response.
12. `per_user` and `strict` never grant from legacy `subscriptions.entitlement_active` or legacy trial dates. Uncanonicalized users receive only the existing account-created trial/free policy and are enqueued.
13. Legacy normalized data is a fixed inactive `__legacy_unverified__` sentinel at the Unix epoch. Bootstrap uses real canonical observation time, not an artificial epoch.
14. `subscriptions.last_event` is scrubbed and permanently null. `subscriptions.revenuecat_user_id` is scrubbed to local `user_id` (or null) and constrained accordingly.
15. Event rows contain no raw subject or response. HMAC subject hashes are pseudonymous personal data, not anonymous or “PII-free” in a regulatory sense; never log or export them.
16. Account deletion cascades every user-linked subject, alias, state, and entitlement without deleting another user's shared event or entitlement.
17. Canonical responses and identity collections have explicit size/count/string/date/enum bounds compatible with DB columns.
18. PostgreSQL behavior, collation ordering, leases, races, migrations, and deletion are tested on PostgreSQL 14 and 16.

## Canonical definitions

### Identity volume and safe non-applied outcomes

Each raw identity array is limited to 256 entries, every entry must be well-formed Unicode and 1–256 characters after trimming, and the combined deduplicated identity set for any delivery branch is limited to 256. This supports large real alias histories while bounding HMAC work, DB lookups, locks, and provider calls. A syntactically valid authenticated event that exceeds either cap returns `200` with `ignored_identity_volume`, increments a type/count-only alert metric, and persists no event, identifier, hash, alias, or user link. It must not trigger RevenueCat's five delivery retries. A `PURCHASE_REDEEMED` event with a missing/empty retained redeemer set or missing/unknown outcome similarly returns `200` with `unsupported_redemption_shape` and persists nothing. Malformed scalar/event identity remains `400`.

### Subject hashing and privacy

Persist `HMAC-SHA-256(REVENUECAT_SUBJECT_HASH_KEY, rawRevenueCatUserId)` as lowercase hex only in subject/alias tables. Raw IDs exist only in bounded request memory. Hashes remain pseudonymous and user-linked; privacy exports omit them, logs omit them, and deletion cascades their local links.

### Two independent order domains

- Entitlement snapshots compare `(source_snapshot_at, source_operation_id COLLATE "C")`. `source_snapshot_at` is canonical `request_date_ms`. `source_operation_id` is bounded ASCII: `webhook:<event-id>`, `bootstrap:<uuid>`, `auth:<uuid>`, or `worker:<lease-id>`. PostgreSQL and application tests use byte ordering, never locale ordering.
- Alias mappings compare `(source_event_at, source_event_id COLLATE "C")`, because alias provenance comes from the delivery. Equal/older tuples cannot reassign an alias.

The legacy sentinel alone uses epoch plus operation ID `legacy`. Every canonical path—webhook, bootstrap, authenticated on-demand, and worker—uses the same snapshot projector and the real validated `request_date_ms`.

Event dispositions are exhaustive. `pending` means canonical work is still durable/retryable and has no `processed_at`; `applied` means the complete intended snapshot batch and alias/subject changes committed; `stale` means the authoritative batch completed but every incoming canonical tuple was older/equal, so no projection advanced; `ignored_unknown` is a terminal identifier-free unknown-event envelope. There is no `reconciliation_failed`: transient failures stay `pending` with `next_attempt_at`; unsupported/unmapped/conflicting/deleted deliveries that persist nothing are HTTP dispositions only. New pending/terminal rows set `retention_until=received_at + interval '90 days'`; terminal transitions clear both lease columns and set `processed_at`.

### Product configuration

Configure two nonempty JSON allowlists:

```dotenv
REVENUECAT_PRO_PRODUCTS_JSON=[{"id":"elovia_pro_monthly","kind":"auto_renewing"},{"id":"elovia_pro_lifetime","kind":"lifetime"}]
REVENUECAT_COACHING_PRODUCTS_JSON=[{"id":"elovia_coaching_monthly","kind":"auto_renewing"}]
```

Each list contains 1–64 objects. `id` is 1–256 well-formed Unicode characters after trimming with no NUL/control character. `kind` is exactly `auto_renewing | prepaid | promotional | lifetime | non_renewing`; `non_renewing` alone requires integer `accessDays` from 1–3660 and every other kind forbids it. Entitlement IDs are distinct, 1–128 characters, use the same safe-string rule, and cannot equal `__legacy_unverified__`. Reject duplicate product IDs within or across entitlements. `REVENUECAT_ENVIRONMENT` is exactly `production | sandbox`; `REVENUECAT_NORMALIZED_READS` is exactly `per_user | strict`. This makes product-to-entitlement and duration mapping unambiguous.

### Bounded canonical snapshot

Accept only HTTP `200 | 201`, JSON content type, at most 1,048,576 actual decoded bytes, and a schema with:

- `request_date_ms`: positive safe integer, finite JavaScript date, no earlier than request-start minus 5 minutes and no later than response-receipt plus 5 minutes;
- at most 64 entitlement pointers, 256 subscription products, 256 non-subscription product keys, 256 purchases per non-subscription product, and 512 total normalized purchase entries;
- product IDs 1–256; store/period/ownership enums at most 32 characters; ISO date strings at most 64 characters and finite;
- store enum `app_store | mac_app_store | play_store | amazon | stripe | promotional | rc_billing | paddle | roku | test_store`;
- period enum `normal | trial | intro | promotional | prepaid`; ownership enum `purchased | family_shared`;
- purchase/expiry/grace/refund/pause/cancellation dates no earlier than 2000-01-01 and no later than snapshot time plus 10 years.

Allowlist only these candidate fields: subscription `purchase_date`, `original_purchase_date`, `expires_date`, `grace_period_expires_date`, `billing_issues_detected_at`, `unsubscribe_detected_at`, `refunded_at`, `auto_resume_date`, `is_sandbox`, `store`, `ownership_type`, and `period_type`; non-subscription `id`, `purchase_date`, `is_sandbox`, and `store`; entitlement-pointer `product_identifier`, `expires_date`, `grace_period_expires_date`, and `purchase_date`. Ignore subscriber attributes and every other field without traversing or returning them. Invalid UTF-8, JSON, count, field, enum, date, product-pointer, or product-class shape is typed `canonical_response_invalid`, retryable, and writes no projection.

Filter candidates by configured environment before selection. For production, reject `is_sandbox=true` and `test_store`; for sandbox, reject production entries. Discover candidates from configured product allowlists in `subscriptions`/`non_subscriptions`. `subscriber.entitlements[configuredId].product_identifier`, when present, is only a cross-check: a non-allowlisted pointer is `canonical_mapping_mismatch`; an absent pointer does not hide an allowlisted product.

Product class determines the only valid source: `auto_renewing`, `prepaid`, and `promotional` use subscription entries; `lifetime` and `non_renewing` use non-subscription entries. A configured product found only in the wrong collection, a prepaid subscription whose normalized period is not PREPAID, or a promotional subscription whose store/period is not promotional is `canonical_mapping_mismatch`, not a grant.

### Deterministic entitlement derivation

Use snapshot time—not server wall clock—to derive every candidate:

| Candidate | Canonical condition | active | status | access deadline | willRenew |
|---|---|---:|---|---|---:|
| subscription refund | documented subscription `refunded_at` present | false | `refunded` | refund instant | false |
| subscription grace | billing issue and live grace | true | `grace` | later of expiry/grace | auto-renew rule below |
| live paused | live expiry and `auto_resume_date` present | true | `paused` | expiry | false |
| live cancelled | live expiry and `unsubscribe_detected_at` present | true | `cancelled` | expiry | false |
| live billing issue | live expiry and billing issue without later grace | true | `billing_issue` | expiry | auto-renew rule below |
| live trial | live expiry and `period_type=trial` | true | `trial` | expiry | auto-renew rule below |
| live intro | live expiry and `period_type=intro` | true | `intro` | expiry | auto-renew rule below |
| live prepaid | configured `kind=prepaid`, live expiry, canonical `period_type=prepaid` | true | `prepaid` | expiry | false |
| live promotional | configured `kind=promotional`, live expiry/store or period promotional | true | `promotional` | expiry | false |
| live auto-renewing | configured `kind=auto_renewing`, live expiry | true | `active` | expiry | auto-renew rule below |
| lifetime | configured `kind=lifetime` and matching non-subscription purchase exists | true | `active` | null | false |
| fixed non-renewing | configured `kind=non_renewing`; latest purchase date + `accessDays` is future | true | `active` | computed deadline | false |
| no live configured candidate | otherwise | false | `expired` | latest known bounded deadline or null | false |

The auto-renew rule is true only for `auto_renewing`, `trial`, or `intro` subscription candidates with no refund, unsubscribe, or pause metadata; a billing issue alone does not set it false. PREPAID, promotional, lifetime, and non-renewing are always false. `REFUND_REVERSED` and `TEMPORARY_ENTITLEMENT_GRANT` merely trigger a canonical read; canonical fields decide access. v1 non-subscription entries have no refund field: removal/refund is represented only by canonical absence unless RevenueCat later documents an authoritative field and this plan is revised.

Persist periods exactly: subscription `period_ends_at=expires_date`; `grace_ends_at` is the live bounded `grace_period_expires_date` only for `grace`, otherwise null; `access_ends_at` is the grace deadline for grace, `refunded_at` for refunded, and `expires_date` for every other dated subscription status. Lifetime stores all three null. Fixed non-renewing stores its computed purchase-plus-`accessDays` deadline in both `period_ends_at` and `access_ends_at`. A configured but expired candidate retains its selected product/store/deadline with `active=false,status=expired`; true canonical absence stores null product/store/deadlines. Selection and status precedence are the table order followed by the deterministic cross-candidate rule below.

Choose among candidates deterministically: live beats inactive; live lifetime beats dated; otherwise greatest deadline, then configured product ID under byte order. Project an absent configured entitlement explicitly as inactive/expired with null product/store/deadlines and the incoming snapshot tuple. Resolver access is `active && (accessEndsAt === null || accessEndsAt > now)`. Coaching wins display tier and implies Pro access; both DB rows remain independent.

### Legacy compatibility projection

Only reproject `subscriptions` when at least one normalized row advances. Select live Coaching, then live Pro, and set every column:

- keep `user_id`; set `revenuecat_user_id=user_id`;
- set `entitlement_active`, `entitlement_id`, `status`, `product_id`, and `store` from the winner, otherwise inactive/null/`expired`;
- set `tier='lifetime'` only for configured lifetime products and null for every other product kind; do not infer monthly/yearly from product-name substrings;
- set `trial_started_at=null`, `trial_ends_at=accessEndsAt` only for trial, and `current_period_ends_at=accessEndsAt`;
- set `last_event=null`, `last_event_at=source_snapshot_at`, `updated_at=database now`, and preserve `created_at`.

Stale snapshots do not touch this row. No entitlement resolver reads its paid/trial flags after Task 5.

---

## Task 1: Shipped bounded ordinary-event contract

**Status:** Complete in commits `6ddc3d8`, `17d9155`, `f2db3a1`, `06c6956`, and accepted review head `59dba42`.

Preserve its finite-Date rejection, 16×128 entitlement metadata bound, `userId`/`originalUserId` ordinary fields, exported mutable `Set` runtime API, and public metadata assignability to `Record<string, string | number | string[] | null>`.

## Task 1A: Model all official identity-bearing delivery shapes

**Files:** Modify the shipped contract/test and create `revenuecatContract.typecheck.ts`.

- [ ] **Step 1: Add failing official-shape and compatibility tests**

Add ordinary fixtures containing `app_user_id`, `original_app_user_id`, and duplicate anonymous/authenticated `aliases[]`. Add real `TRANSFER` without `app_user_id`. Add real `PURCHASE_REDEEMED` without `app_user_id` for each outcome `alias`, `transfer`, and `redeemer_owns` using `redeemed_from[]`/`redeemed_by[]`.

Assert combined first-seen deduplication, 256 identities accepted, 257 or excessive raw array volume returns `ignored_identity_volume`, and unknown/missing outcome or missing/empty `redeemed_by` returns `unsupported_redemption_shape`. These two valid-but-unsupported codes are transport-level `200` dispositions, not `400` parse errors.

Assert `REFUND_REVERSED`, `TEMPORARY_ENTITLEMENT_GRANT`, and `PURCHASE_REDEEMED` are present in the same exported `Set` instance used today. Existing recognized types remain. In `revenuecatContract.typecheck.ts`, compile these assignments:

```ts
const runtimeSet: Set<string> = RECONCILING_REVENUECAT_EVENTS;
const legacyMetadata: Record<string, string | number | string[] | null> = delivery.metadata;
const ordinaryUserId: string = ordinary.userId;
const ordinaryOriginal: string | null = ordinary.originalUserId;
```

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
```

Expected: official aliases/redemption/event-set cases fail; compatibility file does not compile until additive types exist.

- [ ] **Step 3: Implement an additive discriminated union**

Keep metadata declared as the accepted `Record<...>` and export:

```ts
interface RevenueCatDeliveryBase {
  eventId: string;
  type: string;
  eventAt: Date;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: Record<string, string | number | string[] | null>;
}

export interface OrdinaryRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "ordinary";
  userId: string;
  originalUserId: string | null;
  aliases: string[];
}

export interface TransferRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "transfer";
  type: "TRANSFER";
  transferredFrom: string[];
  transferredTo: string[];
}

export interface PurchaseRedeemedRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "purchase_redeemed";
  type: "PURCHASE_REDEEMED";
  redeemedFrom: string[];
  redeemedBy: string[];
  redemptionOutcome: "alias" | "transfer" | "redeemer_owns";
}

export type RevenueCatDelivery =
  | OrdinaryRevenueCatDelivery
  | TransferRevenueCatDelivery
  | PurchaseRedeemedRevenueCatDelivery;
```

`TRANSFER` and `PURCHASE_REDEEMED` never enter the ordinary branch or require `app_user_id`. Preserve the accepted ordinary public fields and bounds. Add only the two explicit non-applied parse result codes described above; document them in the exported result union.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS, including runtime/source/compile compatibility.

Commit: `fix: model revenuecat identity delivery shapes`

## Task 2: Add forward-only schema, durable trusted-UID reconciliation, and migration coverage

**Files:** Create migration/schema/integration test; modify schema exports, subscriptions schema, and every hardcoded migration/table assertion in `user-data-integration.test.mjs`.

- [ ] **Step 1: Add failing migration, collation, cascade, and upgrade tests**

Use the proven harness exactly: test-only database name, unique schema in `DATABASE_URL.options`, migrations before setting/importing DB modules, `tsx/esm/api` registration, then dynamic TypeScript imports. Throw under `CI=true` without `TEST_DATABASE_URL`; local execution may skip.

For the upgrade test, copy exact `0000`–`0003` files to a temporary migration directory, run them, insert a hostile legacy subscription with `entitlement_active=true`, overlong identifiers, future `last_event_at`, raw `last_event`, and an anonymous `revenuecat_user_id`, then run the full migration directory. Assert `0004` succeeds, writes only the inactive sentinel, scrubs both sensitive legacy columns, and enforces both checks.

Assert every column/PK/FK/check/index below, `COLLATE "C"`, byte order for mixed `A/a/-/_` operation and event IDs under available locales, five-table discovery, pending state for an existing user without a subscription, two-user shared-event deletion safety, customer-state queue cascade, and event TTL deletion setting only entitlement `source_trigger_event_id` null.

Update blank-install, concurrent-runner, checksum, baseline-adoption, and table-count fixtures. Preserve `0003_account_deletion_identity_outbox.sql` immediately before `0004`; `migrate.mjs` already discovers/sorts `.sql` lexically and does not change. Keep all existing deletion/outbox tests.

- [ ] **Step 2: Run RED**

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: missing `0004`/tables/checks fail.

- [ ] **Step 3: Create exact migration `0004`**

```sql
CREATE TABLE "revenuecat_webhook_events" (
  "event_id" varchar(128) COLLATE "C" PRIMARY KEY,
  "type" varchar(64) NOT NULL,
  "event_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "environment" varchar(16),
  "disposition" varchar(32) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "processing_lease_id" varchar(128),
  "processing_lease_until" timestamptz,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "retention_until" timestamptz NOT NULL,
  CONSTRAINT "revenuecat_event_identity_valid" CHECK (
    "event_id" ~ '^[A-Za-z0-9_-]{8,128}$' AND
    "type" ~ '^[A-Z0-9_]{3,64}$' AND
    "event_at" > '1970-01-01T00:00:00Z'::timestamptz
  ),
  CONSTRAINT "revenuecat_event_environment_valid"
    CHECK ("environment" IS NULL OR "environment" IN ('production','sandbox')),
  CONSTRAINT "revenuecat_event_disposition_valid"
    CHECK ("disposition" IN ('pending','applied','stale','ignored_unknown')),
  CONSTRAINT "revenuecat_event_metadata_object" CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "revenuecat_event_attempt_valid" CHECK ("attempt_count" >= 0),
  CONSTRAINT "revenuecat_event_lease_consistent" CHECK (
    ("processing_lease_id" IS NULL) = ("processing_lease_until" IS NULL) AND
    ("processing_lease_id" IS NULL OR length("processing_lease_id") BETWEEN 8 AND 128)
  ),
  CONSTRAINT "revenuecat_event_state_consistent" CHECK (
    ("disposition" = 'pending' AND "processed_at" IS NULL) OR
    ("disposition" <> 'pending' AND "processed_at" IS NOT NULL AND
      "processing_lease_id" IS NULL AND "processing_lease_until" IS NULL)
  ),
  CONSTRAINT "revenuecat_event_schedule_valid" CHECK (
    "next_attempt_at" >= "received_at" AND
    ("processed_at" IS NULL OR "processed_at" >= "received_at")
  ),
  CONSTRAINT "revenuecat_event_retention_valid" CHECK ("retention_until" > "received_at")
);

CREATE TABLE "revenuecat_event_subjects" (
  "event_id" varchar(128) COLLATE "C" NOT NULL
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE CASCADE,
  "subject_hash" char(64) NOT NULL,
  "role" varchar(32) NOT NULL,
  "local_user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("event_id","subject_hash","role"),
  CONSTRAINT "revenuecat_subject_hash_valid" CHECK ("subject_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_subject_role_valid" CHECK (
    "role" IN ('primary','original','alias','transferred_from','transferred_to','redeemed_from','redeemed_by')
  )
);

CREATE TABLE "revenuecat_customer_aliases" (
  "alias_hash" char(64) PRIMARY KEY,
  "local_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "alias_kind" varchar(32) NOT NULL,
  "source_event_at" timestamptz NOT NULL,
  "source_event_id" varchar(128) COLLATE "C" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_alias_hash_valid" CHECK ("alias_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "revenuecat_alias_kind_valid" CHECK (
    "alias_kind" IN ('authenticated','anonymous','original','ordinary','transferred')
  ),
  CONSTRAINT "revenuecat_alias_source_valid" CHECK (
    "source_event_at" > '1970-01-01T00:00:00Z'::timestamptz AND
    "source_event_id" ~ '^[A-Za-z0-9_-]{8,128}$'
  )
);

CREATE TABLE "revenuecat_customer_state" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "canonicalization_state" varchar(32) NOT NULL,
  "source_kind" varchar(32) NOT NULL,
  "source_environment" varchar(16),
  "last_snapshot_at" timestamptz,
  "last_operation_id" varchar(192) COLLATE "C",
  "last_reconciled_at" timestamptz,
  "reconcile_reason" varchar(32) NOT NULL,
  "reconcile_after" timestamptz NOT NULL,
  "reconcile_attempt_count" integer NOT NULL DEFAULT 0,
  "reconcile_lease_id" varchar(128),
  "reconcile_lease_until" timestamptz,
  "reconcile_last_error_code" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "revenuecat_customer_state_valid" CHECK (
    "canonicalization_state" IN ('legacy_unverified','pending','canonical')
  ),
  CONSTRAINT "revenuecat_customer_source_kind_valid" CHECK (
    "source_kind" IN ('none','legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')
  ),
  CONSTRAINT "revenuecat_customer_environment_valid" CHECK (
    "source_environment" IS NULL OR "source_environment" IN ('production','sandbox')
  ),
  CONSTRAINT "revenuecat_customer_reason_valid" CHECK (
    "reconcile_reason" IN ('legacy_bootstrap','webhook_failure','authenticated','on_demand','scheduled')
  ),
  CONSTRAINT "revenuecat_customer_attempt_valid" CHECK ("reconcile_attempt_count" >= 0),
  CONSTRAINT "revenuecat_customer_schedule_valid" CHECK (
    "reconcile_after" > '1970-01-01T00:00:00Z'::timestamptz AND
    ("last_snapshot_at" IS NULL OR "last_snapshot_at" > '1970-01-01T00:00:00Z'::timestamptz) AND
    ("last_reconciled_at" IS NULL OR "last_reconciled_at" > '1970-01-01T00:00:00Z'::timestamptz)
  ),
  CONSTRAINT "revenuecat_customer_lease_consistent" CHECK (
    ("reconcile_lease_id" IS NULL) = ("reconcile_lease_until" IS NULL) AND
    ("reconcile_lease_id" IS NULL OR length("reconcile_lease_id") BETWEEN 8 AND 128)
  ),
  CONSTRAINT "revenuecat_customer_error_code_valid" CHECK (
    "reconcile_last_error_code" IS NULL OR
      "reconcile_last_error_code" ~ '^[a-z0-9_]{3,64}$'
  ),
  CONSTRAINT "revenuecat_customer_operation_valid" CHECK (
    "last_operation_id" IS NULL OR
    "last_operation_id" ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'
  ),
  CONSTRAINT "revenuecat_customer_operation_source_consistent" CHECK (
    "last_operation_id" IS NULL OR
    ("source_kind" = 'webhook_canonical' AND "last_operation_id" LIKE 'webhook:%') OR
    ("source_kind" = 'bootstrap_canonical' AND "last_operation_id" LIKE 'bootstrap:%') OR
    ("source_kind" = 'auth_canonical' AND "last_operation_id" LIKE 'auth:%') OR
    ("source_kind" = 'worker_canonical' AND "last_operation_id" LIKE 'worker:%')
  ),
  CONSTRAINT "revenuecat_customer_canonical_consistent" CHECK (
    ("canonicalization_state" = 'legacy_unverified' AND "source_kind" = 'legacy_unverified' AND
      "source_environment" IS NULL AND "last_snapshot_at" IS NULL AND "last_operation_id" IS NULL) OR
    ("canonicalization_state" = 'pending' AND "source_kind" = 'none' AND
      "source_environment" IS NULL AND "last_snapshot_at" IS NULL AND "last_operation_id" IS NULL) OR
    ("canonicalization_state" = 'canonical' AND
      "source_kind" IN ('webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical') AND
      "source_environment" IS NOT NULL AND "last_snapshot_at" IS NOT NULL AND
      "last_operation_id" IS NOT NULL AND "last_reconciled_at" IS NOT NULL)
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
  "source_snapshot_at" timestamptz NOT NULL,
  "source_operation_id" varchar(192) COLLATE "C" NOT NULL,
  "source_trigger_event_id" varchar(128) COLLATE "C"
    REFERENCES "revenuecat_webhook_events"("event_id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id","entitlement_id"),
  CONSTRAINT "subscription_entitlement_id_valid"
    CHECK (length(btrim("entitlement_id")) BETWEEN 1 AND 128),
  CONSTRAINT "subscription_entitlement_status_valid" CHECK (
    "status" IN ('active','trial','intro','prepaid','promotional','cancelled','billing_issue','grace','expired','refunded','paused')
  ),
  CONSTRAINT "subscription_entitlement_store_valid" CHECK (
    "store" IS NULL OR "store" IN ('app_store','mac_app_store','play_store','amazon','stripe','promotional','rc_billing','paddle','roku','test_store')
  ),
  CONSTRAINT "subscription_entitlement_environment_valid" CHECK (
    "source_environment" IS NULL OR "source_environment" IN ('production','sandbox')
  ),
  CONSTRAINT "subscription_entitlement_source_kind_valid" CHECK (
    "source_kind" IN ('legacy_unverified','webhook_canonical','bootstrap_canonical','auth_canonical','worker_canonical')
  ),
  CONSTRAINT "subscription_entitlement_operation_valid" CHECK (
    "source_operation_id" = 'legacy' OR
    "source_operation_id" ~ '^(webhook:[A-Za-z0-9_-]{8,128}|bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|worker:[A-Za-z0-9_-]{8,128})$'
  ),
  CONSTRAINT "subscription_entitlement_operation_source_consistent" CHECK (
    ("source_kind" = 'legacy_unverified' AND "source_operation_id" = 'legacy') OR
    ("source_kind" = 'webhook_canonical' AND "source_operation_id" LIKE 'webhook:%') OR
    ("source_kind" = 'bootstrap_canonical' AND "source_operation_id" LIKE 'bootstrap:%') OR
    ("source_kind" = 'auth_canonical' AND "source_operation_id" LIKE 'auth:%') OR
    ("source_kind" = 'worker_canonical' AND "source_operation_id" LIKE 'worker:%')
  ),
  CONSTRAINT "subscription_entitlement_source_consistent" CHECK (
    ("source_kind" = 'legacy_unverified' AND "source_environment" IS NULL AND
      "entitlement_id" = '__legacy_unverified__' AND "active" = false AND
      "status" = 'expired' AND "product_id" IS NULL AND "store" IS NULL AND
      "period_ends_at" IS NULL AND "grace_ends_at" IS NULL AND
      "access_ends_at" IS NULL AND "will_renew" = false AND
      "source_snapshot_at" = '1970-01-01T00:00:00Z'::timestamptz AND
      "source_operation_id" = 'legacy' AND "source_trigger_event_id" IS NULL) OR
    ("source_kind" <> 'legacy_unverified' AND "source_environment" IS NOT NULL AND
      "source_snapshot_at" > '1970-01-01T00:00:00Z'::timestamptz AND
      ("source_kind" = 'webhook_canonical' OR "source_trigger_event_id" IS NULL))
  ),
  CONSTRAINT "subscription_entitlement_active_status_valid"
    CHECK ("active" = ("status" NOT IN ('expired','refunded'))),
  CONSTRAINT "subscription_entitlement_renewal_valid" CHECK (
    "will_renew" = false OR
    ("active" = true AND "status" IN ('active','trial','intro','billing_issue','grace'))
  ),
  CONSTRAINT "subscription_entitlement_access_window_valid" CHECK (
    "status" = 'refunded' OR "access_ends_at" IS NULL OR
    "period_ends_at" IS NULL OR "access_ends_at" >= "period_ends_at"
  )
);
```

Create exact indexes:

- `IDX_revenuecat_events_type_time(type,event_at DESC)`;
- `IDX_revenuecat_events_pending_due(disposition,next_attempt_at,processing_lease_until)`;
- `IDX_revenuecat_events_retention(retention_until,disposition)`;
- `IDX_revenuecat_event_subjects_local(local_user_id,event_id)`;
- `IDX_revenuecat_aliases_local(local_user_id)` and `IDX_revenuecat_aliases_source(source_event_at,source_event_id)`;
- `IDX_revenuecat_customer_reconcile_due(reconcile_after,reconcile_lease_until,user_id)`;
- `IDX_subscription_entitlements_active(user_id,active,access_ends_at)`;
- `IDX_subscription_entitlements_source(user_id,source_snapshot_at,source_operation_id)`.

Backfill exactly one customer-state row per existing trusted user. Users with a legacy subscription are `legacy_unverified`; users without one are `pending`. Backfill one hostile sentinel only for each legacy subscription:

```sql
INSERT INTO "revenuecat_customer_state" (
  "user_id","canonicalization_state","source_kind","reconcile_reason","reconcile_after"
)
SELECT u."id",
       CASE WHEN s."user_id" IS NULL THEN 'pending' ELSE 'legacy_unverified' END,
       CASE WHEN s."user_id" IS NULL THEN 'none' ELSE 'legacy_unverified' END,
       'legacy_bootstrap',now()
FROM "users" u
LEFT JOIN "subscriptions" s ON s."user_id" = u."id"
ON CONFLICT ("user_id") DO NOTHING;

INSERT INTO "subscription_entitlements" (
  "user_id","entitlement_id","active","status","will_renew",
  "source_kind","source_snapshot_at","source_operation_id"
)
SELECT "user_id",'__legacy_unverified__',false,'expired',false,
       'legacy_unverified','1970-01-01T00:00:00Z'::timestamptz,'legacy'
FROM "subscriptions" ON CONFLICT ("user_id","entitlement_id") DO NOTHING;

UPDATE "subscriptions"
SET "last_event" = NULL, "revenuecat_user_id" = "user_id"
WHERE "last_event" IS NOT NULL OR "revenuecat_user_id" IS DISTINCT FROM "user_id";

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_last_event_must_be_null" CHECK ("last_event" IS NULL),
  ADD CONSTRAINT "subscriptions_revenuecat_user_is_local" CHECK (
    "revenuecat_user_id" IS NULL OR "revenuecat_user_id" = "user_id"
  );
```

Do not copy any legacy access/product/store/date/event value into normalized state and do not create a synthetic event.

- [ ] **Step 4: Mirror exact Drizzle schema and run GREEN**

Mirror all relations, collations, checks, indexes, and FK actions. Mirror both new `subscriptions` checks. Export insert/select types.

```powershell
pnpm run typecheck:libs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
```

Expected: PASS, including all pre-existing deletion/outbox cases.

Commit: `feat: add durable revenuecat entitlement schema`

## Task 3: Add validated product configuration and bounded Get-or-Create client

**Files:** Create config/client/snapshot modules; modify env, startup/readiness, and contract tests.

- [ ] **Step 1: Add failing configuration/client/normalization tests**

Configuration rejects missing/blank values, secrets over 1,024 UTF-8 bytes, HMAC outside 32–1,024 bytes, equal/reserved/overlong entitlement IDs, invalid JSON, empty or >64 product lists, >16 KiB JSON, duplicate products within/across entitlements, invalid kind/accessDays, unknown environment, and any read mode except `per_user | strict`.

Client tests inject fetch/clock and prove:

- it is callable only with a trusted local UID type and URL-encodes it;
- `200` returns `{lookup:'existing', snapshot}` and `201` returns `{lookup:'created', snapshot}`;
- no test or code path expects `404`/`subscriber_not_found`;
- `201` carries no local-provision/trial authority;
- 400/401 are typed configuration/request failures; 429/5xx/network/timeout are retryable and sanitized;
- declared or streamed decoded bytes over 1,048,576 abort; timeout is 5 seconds; bounded text precedes `JSON.parse`; content type/UTF-8/JSON/schema are validated;
- every count/string/date/enum/skew bound above; no `response.json()` or subscriber attribute traversal;
- `request_date_ms` becomes `sourceSnapshotAt` for 200 and 201;
- configured-product discovery, pointer cross-check, environment filtering, multiple products, and every truth-table row including PREPAID/promotional/non-renewing/lifetime/refund reversal/temporary-grant canonical outcomes.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
```

Expected: missing config/client/snapshot modules fail.

- [ ] **Step 3: Implement fail-closed configuration**

Add exact environment template:

```dotenv
REVENUECAT_WEBHOOK_SECRET=replace-with-the-exact-configured-authorization-header
REVENUECAT_SECRET_API_KEY=replace-with-a-secret-server-api-key
REVENUECAT_SUBJECT_HASH_KEY=replace-with-at-least-32-random-bytes
REVENUECAT_PRO_ENTITLEMENT_ID=Elovia Pro
REVENUECAT_COACHING_ENTITLEMENT_ID=Elovia Coaching
REVENUECAT_PRO_PRODUCTS_JSON=[{"id":"elovia_pro_monthly","kind":"auto_renewing"}]
REVENUECAT_COACHING_PRODUCTS_JSON=[{"id":"elovia_coaching_monthly","kind":"auto_renewing"}]
REVENUECAT_ENVIRONMENT=production
REVENUECAT_NORMALIZED_READS=per_user
```

`loadRevenueCatConfig(env)` returns an immutable object. `index.ts` validates before listen in every runtime; invalid configuration means the process never becomes ready. Diagnostics later expose booleans/counts only.

- [ ] **Step 4: Implement bounded client and pure projector**

`createRevenueCatClient({apiKey,fetchImpl,clock,timeoutMs=5000,maxResponseBytes=1048576})` calls `GET https://api.revenuecat.com/v1/subscribers/{encodeURIComponent(trustedUid)}` with `Authorization: Bearer <secret API key>` and `Accept: application/json`, and returns the explicit 200/201 lookup status plus a bounded allowlisted snapshot. It never accepts a raw webhook subject. `revenuecatSnapshot.ts` performs all product/environment/status derivation and emits two rows with a supplied operation ID. It never accepts webhook expiry as truth.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

Commit: `feat: add bounded revenuecat snapshot client`

## Task 4: Implement neutral locks, ordered aliases, and webhook processor

**Files:** Modify account deletion; create processor and the shared transactional reconciler; extend real PostgreSQL tests.

- [ ] **Step 1: Add failing neutral-lock regression tests**

Prove `withAccountLock(uid, callback)` and `withAccountLocks(uids, callback)` invoke callbacks for existing/missing/deleted accounts, use the current advisory seed, reject empty IDs, dedupe exact strings, and sort by UTF-8 bytes. Refactor deletion/provisioning without changing repeated tombstone/request results or identity-outbox lease/retry/finalization tests. The provisioning API remains the authenticated path; processor code must have no insert into `users`.

- [ ] **Step 2: Add failing processor/idempotency/identity tests**

With fake client and real PostgreSQL, cover:

- 20 concurrent duplicates: one valid lease owner calls GET/commits, others do not call while that lease is valid; an expired lease after simulated crash may call again, but the old fence cannot commit;
- terminal duplicate, event-ID envelope collision, pending retry/reclaim, stale canonical snapshot, and equal snapshot time with mixed-case/hyphen/underscore operation IDs under `COLLATE "C"`;
- ordinary identity union maps one existing owner; zero owners returns `ignored_unmapped`; two owners returns `ignored_identity_conflict`; neither persists identifiers/hashes nor calls GET;
- webhook never inserts `users`; an existing user with 200 can reconcile; 201 after a recognized webhook is retryable/non-applied, preserves state, and enqueues that trusted UID;
- provider/normalization/finalization failure enqueues trusted UID and releases only the current event fence;
- a syntactically valid unknown event bypasses identity resolution, stores at most its identifier-free envelope as terminal `ignored_unknown`, and never stores subjects or calls GET;
- unsupported volume/redemption shape is acknowledged without event/hash/GET and increments only a count/type metric;
- Pro/Coaching independence, absence revocation, configuration/environment fail-closed, exact compatibility projection, stale compatibility no-op.

Transfer/alias tests:

- existing source→destination and anonymous mapped source→destination; a retained source with no trusted destination can only reconcile canonical revocation and cannot move aliases/grant; a trusted destination with no retained source can receive only non-tombstoned alias hashes and its canonical snapshot; tombstoned sides are excluded before any GET and both deleted means no persistence;
- alias upsert advances only on `(source_event_at, source_event_id COLLATE "C")`;
- after sorted locks, every hash/direct UID is re-resolved; a new owner outside the lock set rolls back, unions the expanded set, and retries from sorted order without acquiring an extra lock in-place;
- maximum three expanded-set retries in one request, then return typed `503 identity_set_changed` and emit a count-only alert. If the event was already claimed, leave it pending and enqueue trusted UIDs for worker backoff; if instability happened before claim, persist nothing and let the authenticated webhook retry;
- reverse transfer chain and concurrent transfer-vs-transfer; older alias movement cannot undo newer;
- a UID on both sides is locked once and destination canonical truth is applied once, never source-deactivated afterward;
- event-subject `local_user_id` links are updated in the alias-assignment transaction and follow the final owner; a presented identity equal to a live local UID is self-owned and cannot be overridden by an alias row;
- 50 transfer-vs-deletion races: tombstone leaves no linked rows and no provider GET begins for a prechecked deleted side.
- deletion after a permitted GET but before final lock discards the response; an ordinary event with no surviving link is deleted/acknowledged `ignored_deleted`, while transfer retries with only surviving sides. Neither path remains a permanent `503`.

Purchase-redemption tests:

- `alias` and `redeemer_owns` reconcile only one unambiguous already-existing retained `redeemed_by` owner;
- `transfer` never moves aliases or deactivates a source (the separate `TRANSFER` owns that), but may canonical-reconcile one unambiguous existing redeemer;
- no redemption outcome provisions, trusts an unmapped ID, or fetches `redeemed_from`.

- [ ] **Step 3: Run RED**

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: processor/lock/alias tests fail.

- [ ] **Step 4: Implement neutral locks and fenced event claim**

`withAccountLocks` uses one transaction and sorted `pg_advisory_xact_lock(hashtextextended(uid, ACCOUNT_DELETION_LOCK_SEED))`; sorting is explicit UTF-8 byte order, never locale order. Never rewrite UIDs or acquire later-discovered locks out of order.

For a mapped recognized event, under the initial sorted account locks recheck tombstones/owners, insert-or-claim the direct-identifier-free event with a 30-second lease, add user-linked subject hashes, and enqueue each trusted UID before releasing locks. Persisted metadata is constructed—not copied—from the exact allowlist `{schemaVersion: 1, identityCount: number, redemptionOutcome?: 'alias'|'transfer'|'redeemer_owns'}`; it contains no raw ID, product, payload, or provider response. `INSERT ... ON CONFLICT DO NOTHING`; conflict validates immutable type/event time/environment, allowlisted metadata, and the complete hash/role set. Reclaim uses one conditional `UPDATE ... WHERE disposition='pending' AND next_attempt_at<=now() AND (lease IS NULL OR lease_until<=now()) RETURNING`, increments attempts, and creates a new fence. Nonowners poll at most 5.5 seconds, then return `503 processing` with `Retry-After: 1` if still pending.

Only the fence owner fetches. Before final writes it reacquires the sorted account locks, re-resolves every direct identity/alias hash, rechecks tombstones, and verifies `processing_lease_id`. A newly discovered owner outside the acquired set aborts the transaction and retries from the expanded, byte-sorted union; it never takes an extra lock in-place. Final entitlement/alias/subject/compatibility writes and terminal transition are atomic. Never hold a DB transaction/account lock across network I/O. A provider/normalization failure clears its own lease, advances `next_attempt_at` with the bounded backoff defined in Task 5, and leaves both the PII-minimized pending event and trusted-UID queue durable. A crash may cause a second GET after expiry; canonical ordering and fencing prevent stale commit.

- [ ] **Step 5: Implement ordinary, transfer, redemption, and unknown semantics**

Ordinary events assign only newer aliases to the one trusted owner. A raw presented identity equal to an existing local UID resolves directly to itself; alias-table ownership is consulted only when no live direct user exists, so an alias row cannot steal an authenticated UID. Transfer excludes prechecked tombstones before fetch, locks all retained source/destination UIDs, and fetches one canonical snapshot per unique UID. A retained source is deactivated only when its canonical configured products are absent/inactive; a still-live source or a `201` is `transfer_visibility_lag`, remains pending, and commits no entitlement batch. Once all snapshots are authoritative, apply newer alias provenance, all source projections, and every destination projection atomically; a UID present on both sides is projected only as destination. On re-resolution expansion, rollback and restart with the union sorted set. Redemptions follow the no-duplicate-transfer rules above. Unknown/unsupported/unmapped paths do no canonical work.

If the authoritative final tombstone check removes the last linked user, discard the fetched response, delete the now-unreconstructable pending envelope, and return terminal HTTP `ignored_deleted`. If a transfer retains another live side, rollback and restart with only the surviving side set; never keep returning `503` for a deleted subject.

Alias movement uses one conditional upsert: update `local_user_id`, `alias_kind`, `source_event_at`, and `source_event_id` only where `(existing.source_event_at, existing.source_event_id COLLATE "C") < (incoming.event_at, incoming.event_id COLLATE "C")`. In that same transaction, update every matching `revenuecat_event_subjects.local_user_id` to the final owner. Equal/older events may add a missing event-subject link to the already-established owner but cannot move the alias.

Create `applyTrustedSnapshot(...)` in `revenuecatReconciler.ts` now so the webhook processor and later worker/on-demand paths share the exact conditional normalized upsert, compatibility reprojection, customer-state update, fence verification, and snapshot ordering code. Task 5 adds provider-fetch orchestration around this transactional primitive instead of reimplementing it.

Provider GET arguments are always trusted local UIDs, never a raw anonymous/unmapped webhook subject. No processor import or SQL may insert `users`.

- [ ] **Step 6: Run GREEN and commit**

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs scripts/tests/user-data-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
pnpm typecheck
```

Expected: PASS, including existing deletion/outbox coverage.

Commit: `fix: serialize trusted revenuecat projections`

## Task 5: Add trusted-UID worker, auth/on-demand recovery, bootstrap, and safe reads

**Files:** Extend the shared reconciler; create worker/CLI; modify auth middleware, resolver, entitlement route, health, index, and tests.

- [ ] **Step 1: Add failing durable-reconciliation tests**

Test the exact customer-state queue:

- migration covers every existing user, and auth provisioning creates `pending` state/due work for every future user in the same account-lock transaction through an optional/additive provisioning callback; tombstoned/deletion-fallback auth never enqueues;
- authenticated requests enqueue only missing/legacy/due state, avoiding a request-rate polling storm;
- `GET /entitlement` attempts one bounded on-demand reconciliation only for a trusted uncanonicalized/due user, then resolves safely even if provider fails;
- webhook failure already mapped to a trusted UID remains recoverable after all webhook retries stop;
- `FOR UPDATE SKIP LOCKED` claims both due trusted-UID rows and reconstructable pending events once across replicas; lease/fence, attempts, exponential retry (1 minute doubling to 1 hour), and sanitized error code work;
- success schedules the next canonical refresh at 6 hours, clears lease/error/attempts, and writes real `request_date_ms` plus the operation ID;
- 201 behavior: bootstrap for an existing trusted user applies canonical empty only when the bounded response has no configured pointer/candidate; webhook/auth/on-demand/scheduled work treats its first 201 as visibility-lag retry and does not revoke/grant; a later 200 applies;
- worker/on-demand/bootstrap never provision a user and deletion between fetch/final lock wins;
- bootstrap pages `revenuecat_customer_state.user_id` joined to a still-existing `users.id`, never legacy `subscriptions.revenuecat_user_id`, cursor batches deterministically, removes any sentinel, and accepts 200 or bootstrap-only 201 empty;
- webhook-vs-bootstrap and worker-vs-webhook races leave the greatest canonical snapshot tuple; alias ordering remains independent;
- the event worker reconstructs ordinary/transfer/redemption work only from event roles, hashes, and still-linked trusted local UIDs—never raw subjects—and preserves atomic source/destination transfer projection after RevenueCat's delivery retry window;
- terminal event cleanup at 90 days; pending events alert at 24 hours and remain retryable for 30 days. After 30 days, a no-live-lease event whose linked users have independently canonicalized after `received_at` becomes terminal `stale`; an event with no surviving trusted link is deleted with an unreconstructable alert by type/count only. Otherwise it keeps retrying and pages operations. At 90 days, enqueue every surviving linked trusted UID, emit a critical type/count-only alert, and delete the event; trusted-UID reconciliation remains the bounded recovery path.

Resolver tests:

- `REVENUECAT_NORMALIZED_READS=per_user`: canonical rows only when canonical; otherwise account-created trial/free only and enqueue—never legacy paid/store trial;
- `strict`: same grant logic and no legacy reads; readiness fails while any customer state is absent or not `canonical`;
- legacy false-grant fixture immediately resolves only account trial/free before bootstrap and remains nonpaid after canonical empty;
- Pro, Coaching, combined, grace, cancelled, paused, trial, intro, prepaid, promotional, lifetime, non-renewing, expired/refunded, environment mismatch, and account trial/free.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: queue/worker/bootstrap/resolver cases fail.

- [ ] **Step 3: Implement one shared trusted-user reconciler**

Extend Task 4's `revenuecatReconciler.ts` with `reconcileTrustedUser({userId, reason, operationId, allowCreatedEmpty})`. It requires an existing local user, performs tombstone precheck, fetches outside locks, and projects through `applyTrustedSnapshot` under `withAccountLock`. It verifies the worker/event fence when supplied and rechecks tombstone/user. It never provisions.

For `lookup='created'`, only `reason=legacy_bootstrap` with an existing user, final tombstone check, and zero configured candidate/pointer may project canonical empty; a nonempty 201 is `canonical_response_invalid`. Webhook/auth/on-demand/scheduled first-created responses remain non-applied, schedule retry after 60 seconds, and cannot create trial state. Later documented `200` is authoritative.

Operation IDs are generated before GET and restricted ASCII: `webhook:<event-id>`, `bootstrap:<run-uuid>`, `auth:<request-uuid>` for authenticated/on-demand work, or `worker:<lease-id>`. Conditional normalized upserts use an explicit byte-collated comparison, never the connection locale:

```sql
WHERE subscription_entitlements.source_snapshot_at < CAST($incoming_snapshot_at AS timestamptz)
   OR (
     subscription_entitlements.source_snapshot_at = CAST($incoming_snapshot_at AS timestamptz)
     AND subscription_entitlements.source_operation_id COLLATE "C"
         < CAST($incoming_operation_id AS text) COLLATE "C"
   )
```

If neither configured row advances, the operation is stale and compatibility stays byte-for-byte unchanged. If either advances, rebuild compatibility from the post-upsert normalized rows. Customer-state source tuple advances only when the incoming tuple is greater by the same comparison; `last_reconciled_at`, queue scheduling, and the current fence can still finalize without regressing that tuple.

- [ ] **Step 4: Implement worker, auth, on-demand, and cleanup**

The worker claims due `revenuecat_customer_state` rows in batches with `FOR UPDATE SKIP LOCKED`, a random lease, and a 60-second lease deadline. It fetches only `user_id`, finalizes only with its current lease, schedules 6-hour success or bounded exponential retry, and emits type/error-code/count metrics only. It separately claims `revenuecat_webhook_events` where `disposition='pending'`, `next_attempt_at<=now()`, and no valid lease. Using surviving `revenuecat_event_subjects.local_user_id` grouped by role plus stored hashes, it retries the Task 4 canonical batch/alias assignment without reconstructing raw IDs; the same fence and sorted-lock rules apply. An unreconstructable event never calls RevenueCat. `index.ts` starts/stops both loops beside the existing account-deletion finalizer.

Keep `provisionAuthenticatedUserIfActive` public return compatibility. Add an optional transaction callback so `authMiddleware` can create/due reconciliation state atomically after trusted Firebase provisioning. Deletion-fallback auth never invokes it. `GET /entitlement` invokes bounded on-demand reconciliation for due/uncanonicalized trusted users; failure is fail-closed to account trial/free, not a 500 paid grant and not a legacy read.

Cleanup deletes terminal event rows after 90 days. It alerts on pending age at 24 hours; at 30 days and with no live lease it follows the exact canonicalized-linked-user or no-surviving-link terminal/delete rule from Step 1; at 90 days it enqueues surviving linked UIDs, emits the critical alert, and hard-deletes. `source_trigger_event_id ON DELETE SET NULL` preserves canonical ordering. Alert counts identify pending events that lost all user-linked subjects after deletion; no subject/hash is printed.

- [ ] **Step 5: Implement bootstrap and remove legacy paid fallback**

CLI pages all noncanonical (`legacy_unverified` or `pending`) existing users by `user_id`, prints counts only, exits nonzero for remaining retryable users, and uses `allowCreatedEmpty=true`. Successful transaction deletes `__legacy_unverified__` when present, writes both configured rows with real snapshot time, and sets canonical state. `per_user` has no legacy paid fallback; `strict` is enabled only after `unreconciled=0`, where the count also detects trusted users with no state row. There is no successful `legacy` read mode or rollback to legacy grants.

```powershell
node scripts/reconcile-revenuecat.mjs --batch-size=100
```

Expected before strict: exit 0, `unreconciled=0`.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node --test scripts/tests/revenuecat-contract.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
pnpm typecheck
```

Expected: PASS.

Commit: `fix: converge trusted revenuecat customers`

## Task 6: Add injectable pre-auth transport and separated presentation tests

**Files:** Modify route/app/index/privacy/diagnostics; create presentation module and two DB-free tests; extend DB integration wiring tests.

- [ ] **Step 1: Add failing DB-free transport tests**

Register TypeScript before dynamic imports. Build only `createRevenueCatWebhookRouter` with injected secret/fake processor and `createApp` with injected empty authenticated router/no-op Firebase middleware. Do not import aggregate DB routes or require `DATABASE_URL`.

Assert secret missing fails construction; bad/missing auth 401; valid-auth body >256 KiB 413 before parse/processor; malformed JSON/schema 400; Firebase verification never runs; applied 200; duplicate/stale/ignored_unknown/ignored_unmapped/ignored_identity_conflict/ignored_identity_volume/unsupported_redemption_shape/ignored_deleted are exact non-applied 200; event collision 400; pending/visibility/provider/identity-set-changed failures are typed 503 with bounded `Retry-After`. Logs contain request ID and bounded event ID/type/disposition only.

- [ ] **Step 2: Add pure presentation tests and DB-backed wiring tests**

`revenuecat-presentation.test.mjs` tests pure allowlist builders with plain rows: diagnostics booleans/counts only; privacy output normalized entitlements, bounded event metadata, event roles, and reconciliation status without hashes, aliases, legacy RevenueCat ID, raw event, payload, API response, or secrets.

The ordered PostgreSQL integration harness—not the DB-free app factory—dynamically imports and mounts real privacy/diagnostics routes after migrations and DB env setup. Assert live query/wiring, local-user cascade, shared event behavior, pseudonymous hash omission, and readiness counts.

- [ ] **Step 3: Run RED**

```powershell
node --test scripts/tests/revenuecat-http.test.mjs scripts/tests/revenuecat-presentation.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
```

Expected: missing factories/builders and old route wiring fail.

- [ ] **Step 4: Implement transport/app seams**

Export `createRevenueCatWebhookRouter({processor,webhookSecret})`. Bound the supplied Authorization header to 1,024 bytes, SHA-256 hash supplied/expected separately, then `timingSafeEqual` equal-length digests. Compare the exact full configured header value.

Make `app.ts` DB-free: `createApp({revenueCatRouter,authenticatedRouter,authMiddlewareImpl})`. Mount `/api` webhook router immediately after request logging/CORS, before global 20 MiB parsers and Firebase auth. Inside webhook router order shared-secret auth, route-specific `express.json({limit:'256kb',strict:true,type:'application/json'})`, contract parsing, processor. Then mount global parsers/auth/authenticated router. `index.ts` assembles production dependencies. Remove webhook from aggregate router.

- [ ] **Step 5: Implement safe surfaces/readiness**

Pure builders accept already-fetched rows. Route services own DB queries. Diagnostics expose config-present booleans, configured product counts, due/failed/pending counts, and strict/noncanonical booleans—never values/hashes. Privacy export explicitly labels RevenueCat data as billing entitlement state and omits pseudonymous hashes. Readiness fails on invalid config or strict mode with any missing/noncanonical customer state.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node --test scripts/tests/revenuecat-http.test.mjs scripts/tests/revenuecat-presentation.test.mjs
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/elovia_test'
node --test scripts/tests/revenuecat-integration.test.mjs
Remove-Item Env:TEST_DATABASE_URL
pnpm test
pnpm typecheck
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

Commit: `fix: expose bounded revenuecat transport`

## Task 7: Complete PG14/16 behavioral and release gate

- [ ] **Step 1: Complete the real delivery/snapshot matrix**

Include ordinary `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `REFUND`, `REFUND_REVERSED`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXTENDED`, `TEMPORARY_ENTITLEMENT_GRANT`, non-renewing/lifetime, future unknown, real `TRANSFER`, and all three `PURCHASE_REDEEMED` outcomes. Every recognized event uses canonical state, never webhook expiry.

Matrix requirements:

- aliases in ordinary identity; 256 accepted/257 acknowledged fail-closed;
- 200 existing vs 201 created semantics and zero webhook provisioning;
- purchase-before-first-server-call recovered after trusted auth; anonymous→authenticated recovered by ordinary alias webhook/on-demand schedule;
- canonical request-time reverse order/equal-time C-collation operation tie; webhook event time cannot overwrite newer canonical snapshot;
- configured product ambiguity, product classes, pointer cross-check, multi-product tie, environment/Test Store;
- PREPAID/promotional/non-renewing/lifetime/refund/absence/willRenew exactness;
- valid-lease concurrency, crash/expired-lease duplicate GET allowance, old-fence rejection;
- reverse/concurrent transfer chains, lock-set expansion, both-side UID destination win, subject-link reassignment, transfer/deletion races;
- durable missed-webhook convergence, worker lease/backoff, on-demand/bootstrap, 201 visibility lag;
- no legacy paid fallback, false-grant fixture, bootstrap cutover, strict readiness;
- hostile migration, raw payload/RevenueCat ID scrub, pseudonymous privacy cascade, TTL cleanup;
- DB-free transport/presentation plus DB-backed privacy/diagnostics wiring.

- [ ] **Step 2: Confirm CI database enforcement**

`revenuecat-integration.test.mjs` must throw when `CI=true` without `TEST_DATABASE_URL`. The current workflow already runs `pnpm test` and typechecks against PostgreSQL 14 and 16; do not add a redundant matrix or allow a CI skip. Locale/collation assertions run in both jobs.

- [ ] **Step 3: Run the complete release gate**

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

Expected: zero failures and real PostgreSQL tests execute.

Commit Task 7 test/workflow changes as `test: close revenuecat integrity matrix` before requesting the fresh reviews.

- [ ] **Step 4: Fresh spec and quality review**

Review against the four official documents in Phase 0 and every invariant. Correct every Critical/Important issue through the owning task, repeat the full gate, and commit review corrections as `fix: close revenuecat review findings`.

---

## External configuration and operational dependencies

Implementation is not blocked by credentials. Deployment requires the secret v1 API key, exact webhook Authorization value, new HMAC key, exact distinct entitlement IDs, reviewed Pro/Coaching product JSON allowlists/classification/durations, and production/sandbox selection. Product owners must confirm every live product ID and non-renewing access duration from the RevenueCat dashboard; code must not infer them from names. Store secrets only in the deployment secret manager.

RevenueCat's dashboard must point to `/api/webhooks/revenuecat`. Production bootstrap requires the production secret key and a maintenance window. Operations must alert on identity-volume/conflict counts, due reconciliation age/attempts, provider/config errors, and unreconstructable pending-event cleanup without identifiers.

## Rollout sequence

Task commits are not independent deployments. No old webhook replica may serve after `0004`: the legacy handler can create `users` before its raw-event write fails.

1. Finish Tasks 1A–7 and pass fresh reviews; deploy/replay all official shapes in sandbox staging.
2. Validate production secrets, environment, entitlement IDs, and product-class JSON; set reads to `per_user`.
3. Enter maintenance, remove traffic, stop every old replica, and run `0004`.
4. Run canonical bootstrap from the new artifact while traffic is stopped until `unreconciled=0`; no legacy paid fallback is available.
5. Start only the new Task 2–6 artifact, restore traffic, and verify webhook retries, trusted-auth enqueue/on-demand recovery, worker leases, and both entitlements.
6. Set reads to `strict`, redeploy, and verify readiness plus Pro/Coaching/account-created-trial smoke tests.
7. Observe reconciliation age/attempts, event pending/TTL cleanup, identity conflicts/volume, and provider errors through the retry window.

Rollback may switch from `strict` to `per_user`, which still grants only normalized canonical access or account-created trial/free. Never restore legacy paid grants, raw payload writes, webhook provisioning, wrong-environment products, old replicas, or modify migrations `0000`–`0004`.

## Final self-review checklist

- Task 1A preserves the exported Set, metadata Record compatibility, ordinary fields, date/metadata bounds, and adds ordinary aliases/transfer/redemption shapes.
- REFUND_REVERSED, TEMPORARY_ENTITLEMENT_GRANT, and PURCHASE_REDEEMED reconcile canonically.
- Identity volume is 256 with acknowledged non-applied over-limit behavior and no persistence/retry storm.
- No 404/subscriber-not-found assumption remains; 200/201 Get-or-Create semantics are explicit.
- Webhooks and provider responses never provision local users or create trials.
- Auth provisioning plus on-demand/durable scheduled reconciliation recovers missed purchase/merge webhooks.
- Entitlements order only by validated canonical request time plus C-collated operation ID.
- Aliases retain C-collated event provenance and update only when newer under expandable sorted lock sets.
- Transfer chains/races, both-side destination truth, and event-subject relinking are specified/tested.
- One owner exists per valid event lease; fencing, crash semantics, trusted-UID recovery, TTL cleanup, and alerts are exact.
- No successful read/rollback path trusts legacy paid/trial state; bootstrap completes before strict.
- Product allowlists/classification, environment, bounds, truth table, and non-subscription limitations match documented v1 fields.
- Legacy sentinel stays inactive/epoch; `last_event` and legacy RevenueCat ID are scrubbed/constrained.
- HMAC hashes are treated as pseudonymous and never logged/exported.
- Neutral deletion locks, tombstone dominance, independent Pro/Coaching, and account-created 15-day trial remain intact.
- DB-free transport/presentation tests are separated from ordered DB-backed route tests.
- Pre-auth 256 KiB body limit, constant-time header check, 1 MiB streamed response limit, 5-second timeout, and sanitized errors remain.
- Migration assertions and existing deletion/outbox tests remain; PG14/16 exercise C-collation/races.
- Final diff gate uses explicit base `59dba42c61d4ba8e88479c7bf7c608171967181a`, never `HEAD~N`.
