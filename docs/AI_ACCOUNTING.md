# Durable AI usage accounting

This backend checkpoint addresses the transformation plan's AI-spend integrity requirement. It does not complete the broader mobile/product transformation.

## Request lifecycle

1. Authenticate and resolve the server-side entitlement.
2. Atomically claim a daily request slot and save its original UTC day and tier budget.
3. Before **each** provider attempt, reserve estimated cost under the same account transaction lock used by account deletion. Concurrent routes share the daily aggregate.
4. Commit that reservation before network IO. Database errors stop generation; they are not provider-fallback errors.
5. Account for returned token usage before parsing/validating the response. Rejected output still incurred provider usage. Each fallback reserves and settles separately.
6. Close the claim on response completion or disconnect. Only a claim with no provider attempt refunds its request slot. Settlement and closure are idempotent and use the original day, including across midnight.

The Anthropic SDK's hidden retries are disabled for this path. The router owns fallback, so each dispatched attempt is covered by a reservation.

## Failure and budget semantics

- A timeout, missing/invalid usage, process crash, or failed settlement retains the reservation in `ai_usage.estimated_cost_micros` for its original day. These are conservative estimates, not customer charges.
- Reliable returned usage replaces only that attempt's reservation. A duplicate settlement cannot debit or refund twice.
- An insufficient estimated budget returns HTTP 429 with `cost_ceiling_reached` and a UTC reset timestamp. Accounting failures return HTTP 503 with `quota_unavailable` and do not dispatch another provider.
- Once the client disconnects, the current paid response can still settle, but a later fallback cannot start.
- Saved supplement analyses remain readable by their owner without AI quota. Explicit refresh still requires entitlement and budget.
- Reservations use UTF-8 prompt bytes, framing/image headroom, maximum output tokens, and conservative configured rates. Provider prices/tokenization can differ: this is **not a guaranteed invoice cap**. Actual estimates above a reservation are still recorded; subsequent attempts are blocked as appropriate. Pricing and image headroom need review when changing models.
- Unknown reservations are not automatically refunded. They stop affecting admission after their UTC day ends. A failed unused-claim closure can conservatively retain a request slot for that day.

## Storage and rollout

`0009_ai_accounting.sql` adds `ai_requests` and `ai_attempts`. It preserves existing usage aggregates and does not fabricate a backfill for previously unrecorded provider calls. Apply migrations before starting the new API; old API processes must be drained before assuming every instance enforces the new reservation protocol.

The ledger stores operational identifiers, provider/model metadata, token counts, and estimated cost only—no prompts, images, replies, or health text. Provider failures are logged as bounded categories, not raw echoed response bodies. Account deletion cascades through both tables. `/api/privacy/export` includes only the caller's requests and attempts.

## Verification coverage

The test-first implementation adds 25 tests covering provider fallback ordering, SDK retry configuration, incomplete usage, concurrent route limits and cost reservations, idempotency, midnight rollover, settlement rollback, all six HTTP AI endpoints, cached analysis ownership, quota exhaustion, disconnects, and privacy export/deletion.

Run the root test suite with `TEST_DATABASE_URL` pointing to an isolated PostgreSQL test database (its name must contain `test`). Integration suites create and remove their own separate databases. CI requires this variable and exercises PostgreSQL 14 and 16; a run that skips database tests is not sufficient accounting verification.

Local checks use Node 22 and PostgreSQL 16. Also run `pnpm run typecheck:libs`, `pnpm --filter @workspace/api-server typecheck`, and `pnpm --filter @workspace/api-server build`.

### Verified checkpoint — 2026-09-06

- Full root suite: **383 passed, zero failed, zero skipped**, Node 22.18.0 and isolated PostgreSQL 16.14 with UTF-8 encoding. This includes the 25 new AI tests and the existing migration, billing and account-deletion tests.
- Library type build, API type check, API bundle build, and scoped `git diff --check` passed.
- Mobile UI changes and native installation/build verification are outside this backend checkpoint. GitHub CI remains a separate release check, including its PostgreSQL 14 matrix and mobile tests.

The installed code-review checklist was used as the security-review fallback because the skill router did not find a relevant installed Security Guidance skill.

| Review dimension | Scoped assessment | Evidence / limitation |
| --- | --- | --- |
| Security | No blocking finding in this diff | Parameterized queries, owner-scoped claims/cache/export, deletion cascade, and sanitized provider-failure telemetry; adversarial ownership tests pass. |
| Correctness | Verified for the enumerated failure cases | Real PostgreSQL concurrency, rollback, midnight and idempotency tests plus HTTP disconnect/failure tests. Estimated pricing is explicitly not invoice-grade. |
| Performance | No provider IO under database locks | Per-account locks and user/day indexes bound contention to one account; production latency/load has not been benchmarked. |
| Maintainability | Centralized lifecycle with regression coverage | All six paid endpoints use the request wrapper. Long-term ledger retention and large-history privacy-export performance remain operational follow-up work. |

Workflow references: Superpowers test-driven development and ECC cost-aware pipeline principles; current [Drizzle transaction documentation](https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/pg/transactions.mdx) and [Anthropic request options](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/internal/request-options.ts) were consulted through Context7. The isolated local PostgreSQL runtime uses [embedded-postgres binaries](https://github.com/leinelissen/embedded-postgres); it is not an application dependency.
