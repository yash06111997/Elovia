# Railway recovery — 5 October 2026

Production service: Elovia in hospitable-intuition. Existing source branch:
`feat/elovia-p0-integrity` (not the new feature branch).

1. Railpack originally failed preparation because the monorepo root has no start
   script. Set the service's custom build command to
   `pnpm --filter @workspace/api-server build` and start command to
   `pnpm --filter @workspace/api-server start`. This passed the build but revealed
   a pre-existing startup migration failure. The service was already offline.
2. Startup then failed with `Existing schema cannot adopt 0000_baseline.sql;
   missing constraint user_data.user_data_revision_not_null`. Baseline adoption
   already permits an absent revision column, which migration 0001 subsequently
   creates. PostgreSQL 18 also exposes its NOT NULL specification as a named
   `pg_constraint` row. The guard did not permit that corresponding missing row.
3. Added this one constraint name to the existing missing-only optional set.
   Existing column metadata, including nullability, still must match; an existing
   unvalidated/mismatched constraint still fails. All unrelated constraints and
   checksum/version/advisory-lock/transaction checks remain enforced. No schema
   reset, row deletion, migration bypass or production healthcheck bypass.
4. Five deterministic regression tests exercise the real semantic comparator:
   the two compatible cases failed before the fix and passed after it; nullable,
   unvalidated and missing unrelated constraint cases remain rejected. Added
   PostgreSQL 18 to the existing CI database integration matrix (14/16/18).

Primary PostgreSQL release reference:
<https://www.postgresql.org/docs/18/release-18.html>.

The unit regression is not proof of a successful production migration or API
readiness. Verify CI and the actual deployment; further startup configuration
requirements may surface after migrations. Keep the new mobile feature commit
`b03b810` on `feat/comprehensive-fitness-platform`; consolidate both branches
without losing the existing production hardening before a store release.
