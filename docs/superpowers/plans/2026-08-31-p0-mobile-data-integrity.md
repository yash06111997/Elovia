# P0 Mobile Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent account data loss, make cloud-sync outcomes explicit, back up the state Elovia claims to protect, and reconnect currently unreachable authentication and native-lifecycle workflows.

**Architecture:** The API exposes an optimistic-concurrency snapshot contract based on a server revision. Mobile sync persists that revision and distinguishes an empty cloud record from offline, authorization, server, and conflict failures. A small native lifecycle coordinator wires sign-in recovery, reminder reconciliation, push registration, and pending geofence arrival handling without adding another global state store.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router 6, TypeScript 5.9, AsyncStorage, Firebase Auth, Express 5, Drizzle ORM/PostgreSQL, Zod, Node test runner

---

## File Structure

- Create `artifacts/api-server/src/routes/userDataContract.ts` — request schema, synchronized field list, patch builder, and revision parser.
- Modify `artifacts/api-server/src/routes/userData.ts` — revision-aware GET/POST contract and conflict responses.
- Modify `lib/db/src/schema/userData.ts` — server revision plus missing snapshot fields.
- Create `lib/db/migrations/0001_user_data_sync_integrity.sql` — additive production migration.
- Create `artifacts/mobile/lib/cloudSyncContract.ts` — pure outcome and upload-gate logic shared by sync and tests.
- Modify `artifacts/mobile/lib/cloudSync.ts` — typed restore/backup outcomes, server revision persistence, complete field map.
- Modify `artifacts/mobile/components/AutoSync.tsx` — upload only after a definitive `restored` or `empty` result.
- Modify `artifacts/mobile/app/(tabs)/profile.tsx` — user-facing backup/restore result handling.
- Modify `artifacts/mobile/app/auth.tsx` — real sign-in recovery screen instead of a redirect loop.
- Create `artifacts/mobile/components/NativeLifecycleCoordinator.tsx` — notification/push reconciliation and pending geofence arrival routing.
- Modify `artifacts/mobile/app/_layout.tsx` — mount the coordinator inside authenticated providers.
- Modify `scripts/tests/accessibility.test.mjs` — validate the actual dark-only palette.
- Create `scripts/tests/cloud-sync-contract.test.mjs` — outcome and upload-gate behavior.
- Create `scripts/tests/user-data-contract.test.mjs` — strict input, patch, and revision behavior.
- Modify `scripts/tests/operations-hardening.test.mjs` — prove native lifecycle wiring and complete sync coverage.

### Task 1: Restore a trustworthy test baseline

**Files:**
- Modify: `scripts/tests/accessibility.test.mjs`
- Test: `scripts/tests/accessibility.test.mjs`

- [ ] **Step 1: Confirm the existing regression**

Run:

```powershell
node --test scripts/tests/accessibility.test.mjs
```

Expected: FAIL because `Colors.light` no longer exists.

- [ ] **Step 2: Make the test describe the actual dark-only contract**

Replace the palette loop with:

```js
test("secondary and muted text colors meet WCAG AA on app backgrounds", async () => {
  const { Colors } = await import("../../artifacts/mobile/constants/colors.ts");
  const palettes = Object.values(Colors).filter(
    (value) =>
      value &&
      typeof value === "object" &&
      typeof value.background === "string" &&
      typeof value.card === "string",
  );

  assert.ok(palettes.length > 0, "at least one app palette must be defined");
  for (const palette of palettes) {
    for (const textColor of [palette.textSecondary, palette.textMuted]) {
      assert.ok(contrast(textColor, palette.background) >= 4.5);
      assert.ok(contrast(textColor, palette.card) >= 4.5);
    }
  }
});
```

- [ ] **Step 3: Verify the focused and complete suites**

Run:

```powershell
node --test scripts/tests/accessibility.test.mjs
node --test scripts/tests/*.test.mjs
```

Expected: both commands PASS.

- [ ] **Step 4: Commit the baseline repair**

```powershell
git add scripts/tests/accessibility.test.mjs
git commit -m "test: align accessibility checks with dark theme"
```

### Task 2: Define the server snapshot contract

**Files:**
- Create: `artifacts/api-server/src/routes/userDataContract.ts`
- Create: `scripts/tests/user-data-contract.test.mjs`

- [ ] **Step 1: Write failing contract tests**

Create tests covering a strict request, explicit null values, omitted fields, and revisions:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserDataPatch,
  parseUserDataWrite,
  revisionMatches,
} from "../../artifacts/api-server/src/routes/userDataContract.ts";

test("sync writes reject unknown fields and require a base revision", () => {
  assert.throws(() => parseUserDataWrite({ appState: {}, unexpected: true }));
  assert.throws(() => parseUserDataWrite({ appState: {} }));
});

test("sync patches preserve omission and permit explicit clearing", () => {
  assert.deepEqual(
    buildUserDataPatch({ baseRevision: 7, appState: null, sessions: [] }),
    { appState: null, sessions: [] },
  );
});

test("revision comparison distinguishes create, update, and conflict", () => {
  assert.equal(revisionMatches(null, null), true);
  assert.equal(revisionMatches(4, 4), true);
  assert.equal(revisionMatches(4, 3), false);
  assert.equal(revisionMatches(4, null), false);
});
```

Run:

```powershell
node --test scripts/tests/user-data-contract.test.mjs
```

Expected: FAIL because the contract module does not exist.

- [ ] **Step 2: Implement the strict contract**

Create:

```ts
import { z } from "zod";

export const USER_DATA_FIELDS = [
  "appState",
  "workoutPlan",
  "customPlans",
  "activePlanType",
  "activeCustomPlanId",
  "activeSession",
  "sessions",
  "personalRecords",
  "mealPlan",
  "foodLog",
  "customMealPlans",
  "activeMealPlanType",
  "activeCustomMealPlanId",
  "healthData",
  "wellnessData",
  "waterGoal",
  "reminderPrefs",
  "places",
] as const;

const fields = Object.fromEntries(
  USER_DATA_FIELDS.map((field) => [field, z.unknown().optional()]),
);

const writeSchema = z
  .object({ baseRevision: z.number().int().nonnegative().nullable(), ...fields })
  .strict()
  .refine(
    (value) => USER_DATA_FIELDS.some((field) => Object.hasOwn(value, field)),
    "At least one synchronized field is required",
  );

export type UserDataWrite = z.infer<typeof writeSchema>;

export function parseUserDataWrite(input: unknown): UserDataWrite {
  return writeSchema.parse(input);
}

export function buildUserDataPatch(input: UserDataWrite): Record<string, unknown> {
  return Object.fromEntries(
    USER_DATA_FIELDS.filter((field) => Object.hasOwn(input, field)).map((field) => [field, input[field]]),
  );
}

export function revisionMatches(current: number | null, base: number | null): boolean {
  return current === base;
}
```

- [ ] **Step 3: Run the contract tests**

Run:

```powershell
node --test scripts/tests/user-data-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit the contract**

```powershell
git add artifacts/api-server/src/routes/userDataContract.ts scripts/tests/user-data-contract.test.mjs
git commit -m "feat: define a strict cloud snapshot contract"
```

### Task 3: Add optimistic concurrency and complete snapshot fields

**Files:**
- Modify: `lib/db/src/schema/userData.ts`
- Create: `lib/db/migrations/0001_user_data_sync_integrity.sql`
- Modify: `artifacts/api-server/src/routes/userData.ts`
- Test: `scripts/tests/user-data-contract.test.mjs`

- [ ] **Step 1: Extend the additive schema**

Import `integer` and add:

```ts
revision: integer("revision").notNull().default(1),
activeSession: jsonb("active_session"),
wellnessData: jsonb("wellness_data"),
waterGoal: jsonb("water_goal"),
reminderPrefs: jsonb("reminder_prefs"),
places: jsonb("places"),
```

- [ ] **Step 2: Add the production migration**

Create:

```sql
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "active_session" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "wellness_data" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "water_goal" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "reminder_prefs" jsonb;
ALTER TABLE "user_data" ADD COLUMN IF NOT EXISTS "places" jsonb;
```

- [ ] **Step 3: Replace destructive POST behavior with a transaction**

Parse with `parseUserDataWrite`, then select the current row inside `db.transaction`. If its revision does not equal `baseRevision`, return a typed conflict. Otherwise insert revision `1`, or conditionally update the current revision and increment it:

```ts
const input = parseUserDataWrite(req.body);
const patch = buildUserDataPatch(input);

const result = await db.transaction(async (tx) => {
  const [current] = await tx
    .select({ revision: userDataTable.revision })
    .from(userDataTable)
    .where(eq(userDataTable.userId, req.user!.id));

  const currentRevision = current?.revision ?? null;
  if (!revisionMatches(currentRevision, input.baseRevision)) {
    return { kind: "conflict" as const, currentRevision };
  }

  if (!current) {
    const [created] = await tx
      .insert(userDataTable)
      .values({ userId: req.user!.id, ...patch, revision: 1 })
      .returning({ revision: userDataTable.revision });
    return { kind: "saved" as const, revision: created.revision };
  }

  const [updated] = await tx
    .update(userDataTable)
    .set({ ...patch, revision: current.revision + 1, updatedAt: new Date() })
    .where(
      and(
        eq(userDataTable.userId, req.user!.id),
        eq(userDataTable.revision, current.revision),
      ),
    )
    .returning({ revision: userDataTable.revision });

  return updated
    ? { kind: "saved" as const, revision: updated.revision }
    : { kind: "conflict" as const, currentRevision: current.revision };
});
```

Return `409 { error: { code: "SYNC_CONFLICT", message, retryable: false }, currentRevision }` on conflict. Return `200 { success: true, revision }` on save. Return `400` with a stable `VALIDATION_ERROR` envelope for Zod errors.

- [ ] **Step 4: Return revision from GET**

Return `{ data: null, revision: null }` for no row. For existing rows return every synchronized field plus top-level `revision` and ISO `updatedAt`.

- [ ] **Step 5: Add a source-level regression assertion**

Extend `user-data-contract.test.mjs` to read `userData.ts` and assert:

```js
assert.match(source, /status\(409\)/);
assert.match(source, /SYNC_CONFLICT/);
assert.match(source, /eq\(userDataTable\.revision, current\.revision\)/);
assert.doesNotMatch(source, /appState:\s*appState\s*\?\?\s*null/);
```

- [ ] **Step 6: Verify database and API types**

Run:

```powershell
& '.\lib\db\node_modules\.bin\tsc.cmd' --noEmit -p lib/db/tsconfig.json
& '.\artifacts\api-server\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/api-server/tsconfig.json
node --test scripts/tests/user-data-contract.test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit the server integrity change**

```powershell
git add lib/db/src/schema/userData.ts lib/db/migrations/0001_user_data_sync_integrity.sql artifacts/api-server/src/routes/userData.ts scripts/tests/user-data-contract.test.mjs
git commit -m "fix: protect cloud snapshots with optimistic concurrency"
```

### Task 4: Make mobile sync outcomes explicit

**Files:**
- Create: `artifacts/mobile/lib/cloudSyncContract.ts`
- Create: `scripts/tests/cloud-sync-contract.test.mjs`
- Modify: `artifacts/mobile/lib/cloudSync.ts`
- Modify: `artifacts/mobile/components/AutoSync.tsx`
- Modify: `artifacts/mobile/app/(tabs)/profile.tsx`

- [ ] **Step 1: Write the failing outcome tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  canUploadAfterRestore,
  classifyRestoreResponse,
} from "../../artifacts/mobile/lib/cloudSyncContract.ts";

test("only definitive restore states permit upload", () => {
  assert.equal(canUploadAfterRestore({ status: "restored", revision: 4 }), true);
  assert.equal(canUploadAfterRestore({ status: "empty" }), true);
  assert.equal(canUploadAfterRestore({ status: "offline" }), false);
  assert.equal(canUploadAfterRestore({ status: "server" }), false);
  assert.equal(canUploadAfterRestore({ status: "unauthorized" }), false);
});

test("HTTP restore responses are not collapsed into empty", () => {
  assert.deepEqual(classifyRestoreResponse(200, false, null), { status: "empty" });
  assert.deepEqual(classifyRestoreResponse(401, false, null), { status: "unauthorized" });
  assert.deepEqual(classifyRestoreResponse(503, false, null), { status: "server" });
  assert.deepEqual(classifyRestoreResponse(200, true, 9), { status: "restored", revision: 9 });
});
```

Run: `node --test scripts/tests/cloud-sync-contract.test.mjs`  
Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure contract**

```ts
export type RestoreOutcome =
  | { status: "restored"; revision: number }
  | { status: "empty" }
  | { status: "offline" }
  | { status: "unauthorized" }
  | { status: "server" };

export type BackupOutcome =
  | { status: "saved"; revision: number }
  | { status: "empty" | "offline" | "unauthorized" | "server" }
  | { status: "conflict"; currentRevision: number };

export function classifyRestoreResponse(
  httpStatus: number,
  hasData: boolean,
  revision: number | null,
): RestoreOutcome {
  if (httpStatus === 401) return { status: "unauthorized" };
  if (httpStatus < 200 || httpStatus >= 300) return { status: "server" };
  if (!hasData) return { status: "empty" };
  if (revision == null) return { status: "server" };
  return { status: "restored", revision };
}

export function canUploadAfterRestore(outcome: RestoreOutcome): boolean {
  return outcome.status === "restored" || outcome.status === "empty";
}
```

- [ ] **Step 3: Persist and send the server revision**

In `cloudSync.ts`, add `@elovia_sync_revision`. Read it before backup and send `baseRevision`. On a successful response, persist the returned revision. A `409` becomes `conflict`, never `server` or `empty`.

Restore returns `RestoreOutcome`; it writes synchronized pairs and the revision only after parsing a valid payload. Network exceptions return `offline`. Authentication absence returns `unauthorized`.

- [ ] **Step 4: Gate AutoSync on the typed outcome**

Replace boolean branching with:

```ts
const outcome = await restoreFromCloud();
if (outcome.status === "restored") {
  emitDataRestored();
  restoreSettledRef.current = true;
  return;
}
if (outcome.status !== "empty") return;

const migrated = await migrateLegacyFirebaseData(user.id);
if (session !== sessionIdRef.current) return;
if (migrated) emitDataRestored();
restoreSettledRef.current = true;
```

Log a privacy-safe telemetry event when backup returns `conflict`, `offline`, or `server`; do not retry conflicts automatically.

- [ ] **Step 5: Give manual backup/restore honest feedback**

Update Profile alerts so empty, offline, unauthorized, conflict, and server outcomes have distinct messages and no failure is labeled “No backup found.”

- [ ] **Step 6: Verify focused tests and mobile types**

```powershell
node --test scripts/tests/cloud-sync-contract.test.mjs
& '.\artifacts\mobile\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/mobile/tsconfig.json
```

Expected: PASS.

- [ ] **Step 7: Commit typed mobile synchronization**

```powershell
git add artifacts/mobile/lib/cloudSyncContract.ts artifacts/mobile/lib/cloudSync.ts artifacts/mobile/components/AutoSync.tsx 'artifacts/mobile/app/(tabs)/profile.tsx' scripts/tests/cloud-sync-contract.test.mjs
git commit -m "fix: distinguish cloud restore failures from empty accounts"
```

### Task 5: Back up the complete advertised device state

**Files:**
- Modify: `artifacts/mobile/lib/cloudSync.ts`
- Modify: `artifacts/api-server/src/routes/userData.ts`
- Modify: `scripts/tests/operations-hardening.test.mjs`

- [ ] **Step 1: Write the failing coverage assertion**

Add:

```js
test("cloud snapshots include in-progress and advertised recovery data", () => {
  const requiredKeys = [
    "@elovia_active_session",
    "@elovia_wellness",
    "@elovia_water_goal",
    "@elovia_reminder_prefs",
    "@elovia_places",
  ];
  for (const key of requiredKeys) assert.match(cloudSyncSource, new RegExp(key));
});
```

Run: `node --test scripts/tests/operations-hardening.test.mjs`  
Expected: FAIL for the missing keys.

- [ ] **Step 2: Extend the field map**

Map:

```ts
"@elovia_active_session": "activeSession",
"@elovia_wellness": "wellnessData",
"@elovia_water_goal": "waterGoal",
"@elovia_reminder_prefs": "reminderPrefs",
"@elovia_places": "places",
```

All five are JSON fields; preserve explicit empty arrays/objects and explicit nulls where the user clears data.

- [ ] **Step 3: Return and accept the fields on the server**

Use `USER_DATA_FIELDS` to build the GET response so the read and write contracts cannot drift. Do not hand-copy another field list.

- [ ] **Step 4: Verify the suite**

```powershell
node --test scripts/tests/operations-hardening.test.mjs scripts/tests/cloud-sync-contract.test.mjs scripts/tests/user-data-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit complete snapshot coverage**

```powershell
git add artifacts/mobile/lib/cloudSync.ts artifacts/api-server/src/routes/userData.ts scripts/tests/operations-hardening.test.mjs
git commit -m "fix: include complete recoverable state in cloud snapshots"
```

### Task 6: Repair authentication recovery and native lifecycle wiring

**Files:**
- Modify: `artifacts/mobile/app/auth.tsx`
- Create: `artifacts/mobile/components/NativeLifecycleCoordinator.tsx`
- Modify: `artifacts/mobile/app/_layout.tsx`
- Modify: `artifacts/mobile/lib/push.ts`
- Modify: `artifacts/mobile/lib/notifications.ts`
- Test: `scripts/tests/operations-hardening.test.mjs`

- [ ] **Step 1: Write failing source-level journey assertions**

Assert that `/auth` calls the auth provider’s sign-in method and that the coordinator calls `registerForPushNotifications`, `reconcileReminderSchedule`, and `readPendingArrival`.

- [ ] **Step 2: Replace `/auth` redirect with a recovery screen**

The screen shows the Elovia identity, a plain explanation, “Continue with Google,” retry/loading/error states, and “Back” navigation. On successful authentication, `router.replace("/(tabs)")`. It never starts authentication at module scope.

- [ ] **Step 3: Scope the cached push token to the user**

Store `{ userId, token }` rather than a global token string. On identity change, unregister the previous user/token pair before registering the current user. Change the API unregister call to require the authenticated user and make the server update predicate include both token and user ID.

- [ ] **Step 4: Add reminder reconciliation**

Export `reconcileReminderSchedule()` from `notifications.ts`. It reads persisted preferences, cancels only Elovia-owned scheduled identifiers, and recreates enabled reminders. `suppressTodayStreakReminder()` records today as a suppression date and then reconciles; it does not permanently remove future streak reminders.

- [ ] **Step 5: Mount the native lifecycle coordinator**

On authenticated app readiness, it:

1. reconciles reminders;
2. registers the push token;
3. consumes a pending geofence arrival once;
4. routes to Train with serialized place context only after the router is ready;
5. logs privacy-safe failures without blocking startup.

It does not request optional permissions at launch; it only reconciles features the user already enabled.

- [ ] **Step 6: Verify focused and full checks**

```powershell
node --test scripts/tests/operations-hardening.test.mjs
& '.\artifacts\mobile\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/mobile/tsconfig.json
& '.\artifacts\api-server\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/api-server/tsconfig.json
node --test scripts/tests/*.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit native workflow recovery**

```powershell
git add artifacts/mobile/app/auth.tsx artifacts/mobile/components/NativeLifecycleCoordinator.tsx artifacts/mobile/app/_layout.tsx artifacts/mobile/lib/push.ts artifacts/mobile/lib/notifications.ts artifacts/api-server/src/lib/push.ts artifacts/api-server/src/routes/push.ts scripts/tests/operations-hardening.test.mjs
git commit -m "fix: connect authentication and native lifecycle workflows"
```

### Task 7: Run the delivery gate

**Files:**
- Modify only if a verification failure proves a defect in this plan’s scope.

- [ ] **Step 1: Run tests with the repository-supported Node 22 runtime**

Run the root test command in Node 22. If the host cannot activate Node 22, use direct local binaries for typecheck/build and record the environment mismatch without changing the repository’s engine requirement.

- [ ] **Step 2: Run static verification**

```powershell
node --test scripts/tests/*.test.mjs
& '.\artifacts\mobile\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/mobile/tsconfig.json
& '.\artifacts\api-server\node_modules\.bin\tsc.cmd' --noEmit -p artifacts/api-server/tsconfig.json
& '.\artifacts\api-server\node_modules\.bin\esbuild.cmd' artifacts/api-server/src/index.ts --platform=node --packages=external --bundle --format=esm --outfile=artifacts/api-server/dist/index.js
```

Expected: tests PASS, both typechecks PASS, API bundle succeeds.

- [ ] **Step 3: Export native bundles**

```powershell
Set-Location artifacts/mobile
npx expo export --platform android --output-dir dist/android-check
npx expo export --platform ios --output-dir dist/ios-check
```

Expected: both exports complete without Metro errors.

- [ ] **Step 4: Review the scoped diff**

```powershell
git diff --check HEAD~6..HEAD
git status --short
```

Expected: no whitespace errors; pre-existing `.agents` and `.gitignore` changes remain unstaged and unmodified.

- [ ] **Step 5: Record phase evidence**

Update the transformation ledger with commands, results, known device limitations, and the next backend-integrity phase. Commit only the ledger if changed.
