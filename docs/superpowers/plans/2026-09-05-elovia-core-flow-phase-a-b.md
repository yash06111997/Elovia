# Elovia Core-Flow Phase A-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first visibly transformed, test-backed Elovia vertical slice: a coherent interaction system, a Today-first Home experience, an honest recoverable paywall, and fail-closed native API configuration.

**Architecture:** Preserve the existing Expo Router five-tab shell and domain contexts. Introduce small pure view-model selectors and focused shared primitives so routes compose behavior rather than duplicate it. Change only the boundaries required by Home and paywall; defer broad context and route rewrites to later phases.

**Tech Stack:** Node 22, pnpm 10.33.0, Expo 54.0.37, React Native 0.81.5, Expo Router 6.0.24, TypeScript 5.9, Jest 29/jest-expo, Testing Library React Native, Reanimated 4, RevenueCat 9.15, agent-device 0.2.17, Maestro 2.9.0.

## Global Constraints

- Target `C:\Users\HP\.config\superpowers\worktrees\Health-Hub\elovia-ios-config` on `feat/elovia-ios-config`; it is already an isolated worktree.
- Preserve existing seven-step onboarding, five primary tabs, free manual tracking, local-first logging, native integrations, and all existing features.
- Do not modify or stage the pre-existing dirty `.agents/**` files, `pnpm-workspace.yaml`, or root `app.json`.
- Use test-driven development for every behavior change: RED, GREEN, focused verification, broad verification.
- Commit each changed file separately with a descriptive file-specific message.
- Do not add NativeWind, replace lists with FlashList, or add animation/performance changes without measurement.
- All interactive controls expose names, roles, states, useful hints, a 48 dp Android touch intent, dynamic-text tolerance, and reduced-motion behavior.
- No client secret, credential, token, connection string, or privileged API key may be committed or printed; use `[REDACTED]` in reports.
- A successful Android/iOS export proves compilation only. UI claims require agent-device evidence from the changed build.
- iOS runtime and Apple-login claims require a physical iOS device, device farm, or macOS runner; Windows cannot provide them.

---

## File Structure

- Modify `artifacts/mobile/package.json` — run the real mobile test suite without masking zero tests.
- Modify `artifacts/mobile/tests/paywall-screen.test.tsx` — deterministic recovery/free-path coverage.
- Modify `artifacts/mobile/tests/progress-screen.test.tsx` — deterministic render timing while preserving existing assertions.
- Create `artifacts/mobile/lib/todayBrief.ts` — pure Home view-model selector.
- Create `artifacts/mobile/lib/todayBrief.test.ts` — selector behavior and edge-case tests.
- Create `artifacts/mobile/components/ui/Button.tsx` — primary/secondary/quiet action primitive.
- Create `artifacts/mobile/components/ui/StatusBanner.tsx` — compact semantic status/error primitive.
- Create `artifacts/mobile/components/ui/MetricRow.tsx` — dense accessible metric primitive.
- Create `artifacts/mobile/components/ui/primitives.test.tsx` — behavior/accessibility tests.
- Modify `artifacts/mobile/components/ui/index.ts` — export new primitives.
- Create `artifacts/mobile/tests/home-screen.test.tsx` — Today Brief order, labels, and navigation tests.
- Modify `artifacts/mobile/app/(tabs)/index.tsx` — visible Today-first Home transformation.
- Modify `artifacts/mobile/app/paywall.tsx` — honest error recovery and visible Free/Restore actions.
- Create `artifacts/mobile/utils/api.test.ts` — URL normalization and native fail-closed tests.
- Modify `artifacts/mobile/utils/api.ts` — validated configuration with explicit development-only loopback.
- Modify `e2e/maestro/onboarding-preview.yaml` — assert preview, paywall recovery/free route, and transformed Home.
- Create `e2e/maestro/home-core-actions.yaml` — repeatable Home → Train/Nutrition/Run checks.
- Create `docs/superpowers/evidence/2026-09-05-core-flow-phase-a-b.md` — verified commands, screenshots, device hierarchy, limitations, and before/after metrics.

### Task 1: Make the mobile suite truthful and deterministic

**Files:**
- Modify: `artifacts/mobile/package.json`
- Modify: `artifacts/mobile/tests/paywall-screen.test.tsx`
- Modify: `artifacts/mobile/tests/progress-screen.test.tsx`

**Interfaces:**
- Consumes: current Jest configuration in `artifacts/mobile/package.json`.
- Produces: `pnpm --filter @workspace/mobile test --runInBand` that discovers all tracked suites, fails on zero tests, and completes without default-timeout flakes.

- [ ] **Step 1: Record the current red baseline**

Run:

```bash
pnpm --filter @workspace/mobile test --runInBand
```

Expected: 16 suites and 60 tests are discovered; the current baseline may fail because the paywall and first Progress render exceed Jest's 5-second test timeout. Never insert a literal `--` before `--runInBand`; doing so previously produced a false `No tests found` result.

- [ ] **Step 2: Prove the timeout diagnosis**

Run:

```bash
pnpm --filter @workspace/mobile exec jest tests/paywall-screen.test.tsx tests/progress-screen.test.tsx --runInBand --testTimeout=30000
```

Expected: both suites pass, establishing harness/render latency rather than an assertion failure.

- [ ] **Step 3: Remove the false-green flag**

Change the script to:

```json
"test": "jest"
```

Run `pnpm --filter @workspace/mobile exec jest --listTests` and assert that the output contains at least `tests/paywall-screen.test.tsx`, `tests/progress-screen.test.tsx`, and `tests/home-screen.test.tsx` once Task 5 creates it.

- [ ] **Step 4: Make existing tests deterministic without inflating the global timeout**

In the two test files, mock animation/haptic dependencies at the test boundary and use fake timers only where the component deliberately polls. Do not add arbitrary sleeps. Paywall tests must mock `trackEvent` as already done and wrap timer advancement in `act`; Progress tests must restore timers in `afterEach` rather than sharing fake-timer state across the suite.

- [ ] **Step 5: Verify each file before committing it**

Run after each edit:

```bash
pnpm --filter @workspace/mobile exec jest tests/paywall-screen.test.tsx --runInBand
pnpm --filter @workspace/mobile exec jest tests/progress-screen.test.tsx --runInBand
pnpm --filter @workspace/mobile test --runInBand
```

Expected: 16 existing suites pass before later tasks add more.

- [ ] **Step 6: Commit one file at a time**

```bash
git add artifacts/mobile/package.json && git commit -m "test(mobile): require discovered Jest tests"
git add artifacts/mobile/tests/paywall-screen.test.tsx && git commit -m "test(paywall): make recovery checks deterministic"
git add artifacts/mobile/tests/progress-screen.test.tsx && git commit -m "test(progress): isolate render timing"
```

### Task 2: Define the Today Brief selector

**Files:**
- Create: `artifacts/mobile/lib/todayBrief.test.ts`
- Create: `artifacts/mobile/lib/todayBrief.ts`

**Interfaces:**
- Produces:

```ts
export type TodayBriefInput = {
  now: Date;
  name?: string | null;
  workout?: { id: string; name: string; exerciseCount: number; muscleGroups: string[] } | null;
  caloriesConsumed: number;
  calorieTarget: number;
  proteinConsumed: number;
  proteinTarget: number;
  weeklyWorkoutPercent: number;
  completedWorkouts: number;
  dataUpdatedAt?: string | null;
};

export type TodayBrief = {
  greeting: string;
  title: string;
  freshness: "fresh" | "stale" | "unknown";
  workout: TodayBriefInput["workout"];
  nutrition: { caloriesRemaining: number; proteinRemaining: number; calorieProgress: number };
  week: { workoutPercent: number; completedWorkouts: number };
};

export function buildTodayBrief(input: TodayBriefInput): TodayBrief;
```

- [ ] **Step 1: Write failing tests**

Cover: local-time greeting; athlete fallback name; no workout; negative remainders clamp to zero; progress clamps to `0..1`; an update within 15 minutes is fresh, older is stale, absent is unknown.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/mobile exec jest lib/todayBrief.test.ts --runInBand
```

Expected: FAIL because `todayBrief.ts` does not exist.

- [ ] **Step 3: Implement the pure selector**

Use finite-number guards and `Math.max`/`Math.min`; do not import React, contexts, storage, or navigation.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/mobile exec jest lib/todayBrief.test.ts --runInBand
```

Expected: all selector tests pass.

- [ ] **Step 5: Commit each file**

```bash
git add artifacts/mobile/lib/todayBrief.test.ts && git commit -m "test(home): specify Today Brief view model"
git add artifacts/mobile/lib/todayBrief.ts && git commit -m "feat(home): build Today Brief view model"
```

### Task 3: Add accessible shared action and status primitives

**Files:**
- Create: `artifacts/mobile/components/ui/primitives.test.tsx`
- Create: `artifacts/mobile/components/ui/Button.tsx`
- Create: `artifacts/mobile/components/ui/StatusBanner.tsx`
- Create: `artifacts/mobile/components/ui/MetricRow.tsx`
- Modify: `artifacts/mobile/components/ui/index.ts`

**Interfaces:**
- Produces:

```ts
export type ButtonVariant = "primary" | "secondary" | "quiet";
export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  testID?: string;
}

export interface StatusBannerProps {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface MetricRowProps {
  label: string;
  value: string;
  progress?: number;
  tone?: "primary" | "success" | "warning";
  accessibilityLabel?: string;
}
```

- [ ] **Step 1: Write failing component tests**

Assert: Button exposes role/name/hint; disabled and loading states block duplicate presses; StatusBanner error uses `alert`; action is keyboard/screen-reader reachable; MetricRow clamps progress and exposes one useful combined label; all action roots have `minHeight: 48`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/mobile exec jest components/ui/primitives.test.tsx --runInBand
```

Expected: FAIL because the files/exports do not exist.

- [ ] **Step 3: Implement the primitives**

Use `PressableScale`, semantic colors from `Colors`/`Semantic`, `Space`, `Radius`, `Type`, `tabularNumbers`, and `MIN_TOUCH`. Icons are decorative with `importantForAccessibility="no"`; the parent owns the accessible label. Use one restrained haptic only for enabled user actions.

- [ ] **Step 4: Run GREEN and typecheck**

```bash
pnpm --filter @workspace/mobile exec jest components/ui/primitives.test.tsx --runInBand
pnpm --filter @workspace/mobile run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit each file separately**

```bash
git add artifacts/mobile/components/ui/primitives.test.tsx && git commit -m "test(ui): specify shared interaction primitives"
git add artifacts/mobile/components/ui/Button.tsx && git commit -m "feat(ui): add accessible action button"
git add artifacts/mobile/components/ui/StatusBanner.tsx && git commit -m "feat(ui): add semantic status banner"
git add artifacts/mobile/components/ui/MetricRow.tsx && git commit -m "feat(ui): add dense metric row"
git add artifacts/mobile/components/ui/index.ts && git commit -m "refactor(ui): export core primitives"
```

### Task 4: Specify the transformed Home behavior

**Files:**
- Create: `artifacts/mobile/tests/home-screen.test.tsx`

**Interfaces:**
- Consumes: `buildTodayBrief`, context hooks, Expo Router, and shared primitives.
- Produces: executable acceptance tests for the first visible product slice.

- [ ] **Step 1: Create realistic context mocks**

Provide a named user, a scheduled workout, today's nutrition totals, macro targets, weekly completion, one completed session, water, steps, subscription state, and health freshness. Mock Router and haptics.

- [ ] **Step 2: Write failing assertions**

Assert in order:

1. `Today` and freshness state are visible before subscription messaging.
2. `Start workout` is the first primary action and routes to `/(tabs)/workouts`.
3. Calories and protein remaining are shown in compact metrics.
4. `Log meal` routes to `/(tabs)/diet` in at most one press.
5. Run and Water remain reachable.
6. Free users see a compact `View Premium` action, not a large first-viewport sales card.
7. With no scheduled workout, Home shows `Choose a workout` and keeps Nutrition usable.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @workspace/mobile exec jest tests/home-screen.test.tsx --runInBand
```

Expected: FAIL because the current Home copy/hierarchy lacks Today Brief semantics.

- [ ] **Step 4: Commit the test**

```bash
git add artifacts/mobile/tests/home-screen.test.tsx && git commit -m "test(home): specify Today-first core actions"
```

### Task 5: Transform Home into the Today Brief

**Files:**
- Modify: `artifacts/mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `buildTodayBrief`, `Button`, `StatusBanner`, `MetricRow`, existing domain contexts, and existing routes.
- Produces: visible Home experience with one primary action and compact cross-domain status.

- [ ] **Step 1: Build the view model once per render**

Map current context values into `buildTodayBrief`. Keep date handling local through existing `toLocalDateKey`/`localWeekDateKeys`. Do not introduce storage or network effects in the route.

- [ ] **Step 2: Replace the first viewport hierarchy**

Render in this order:

1. compact `Today` header with greeting/name and freshness status;
2. one raised workout panel with schedule metadata and `Start workout` or `Choose a workout`;
3. nutrition block with calories remaining, protein remaining, `Log meal`, and a compact route to Nutrition;
4. compact secondary actions for Run and Water;
5. weekly status and existing supporting metrics below;
6. compact subscription action after useful daily content.

Remove the 2x2 generic Quick Actions grid and redundant first-viewport metric cards. Preserve every route and water behavior.

- [ ] **Step 3: Use semantic styling**

Use tokens from `constants/design.ts`; prefer whitespace/hairlines to wrapping every group in a bordered card. Use cyan only for the primary action/focus, green for completion, amber for attention, and violet only for AI-assisted content. Use tabular numerals for metrics.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @workspace/mobile exec jest tests/home-screen.test.tsx --runInBand
pnpm --filter @workspace/mobile run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add 'artifacts/mobile/app/(tabs)/index.tsx' && git commit -m "feat(home): prioritize today's training and nutrition"
```

### Task 6: Make paywall recovery and Free access explicit

**Files:**
- Modify: `artifacts/mobile/tests/paywall-screen.test.tsx`
- Modify: `artifacts/mobile/app/paywall.tsx`

**Interfaces:**
- Consumes: `Button`, `StatusBanner`, RevenueCat loading/error/refetch/restore state, `postOnboarding` parameter.
- Produces: distinct loading, unavailable, retry, restore, sign-in, purchase, and free-continuation states.

- [ ] **Step 1: Extend failing tests**

Add assertions that offerings failure shows `Try again`, `Restore purchases`, and (when post-onboarding) `Continue with Free` in the same reachable state; the message says prices could not load without asserting the user's connection is at fault; loading does not render unavailable; retry calls `refetchOfferings` once; free continuation replaces to `/(tabs)`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/mobile exec jest tests/paywall-screen.test.tsx --runInBand
```

Expected: at least the revised copy/accessibility-order assertion fails.

- [ ] **Step 3: Implement the recovery state**

Use `StatusBanner` and shared `Button` controls. Keep Free and Restore visible before long comparison/FAQ content when offerings fail. Give plan selectors radio semantics and selected state. Keep legal/subscription disclosures and existing purchase confirmation.

- [ ] **Step 4: Run GREEN and typecheck**

```bash
pnpm --filter @workspace/mobile exec jest tests/paywall-screen.test.tsx --runInBand
pnpm --filter @workspace/mobile run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit each file**

```bash
git add artifacts/mobile/tests/paywall-screen.test.tsx && git commit -m "test(paywall): require recoverable store states"
git add artifacts/mobile/app/paywall.tsx && git commit -m "fix(paywall): preserve free and restore paths"
```

### Task 7: Fail closed on native release API configuration

**Files:**
- Create: `artifacts/mobile/utils/api.test.ts`
- Modify: `artifacts/mobile/utils/api.ts`

**Interfaces:**
- Produces:

```ts
export function normalizeApiBaseUrl(domain: string): string;
export function resolveApiBaseUrl(input: {
  domain?: string;
  platform: "ios" | "android" | "web";
  dev: boolean;
}): string;
```

- [ ] **Step 1: Write failing tests**

Cover: bare host becomes HTTPS; existing HTTPS is retained; trailing slash removed; HTTP allowed only for `localhost`, `127.0.0.1`, or Android emulator `10.0.2.2` in development; web without a domain returns same-origin empty string; native development without a domain uses an explicit development loopback; native non-development without a domain throws `Native API domain is not configured`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/mobile exec jest utils/api.test.ts --runInBand
```

Expected: FAIL because the functions do not exist and release currently falls back to localhost.

- [ ] **Step 3: Implement and integrate**

Resolve the production value from `EXPO_PUBLIC_DOMAIN`, strip whitespace/protocol duplication, reject insecure remote HTTP, and call `resolveApiBaseUrl` from `getBaseUrl`. Use `__DEV__` for the development flag. Do not log the domain or credentials.

- [ ] **Step 4: Run GREEN and typecheck**

```bash
pnpm --filter @workspace/mobile exec jest utils/api.test.ts --runInBand
pnpm --filter @workspace/mobile run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit each file**

```bash
git add artifacts/mobile/utils/api.test.ts && git commit -m "test(api): specify native endpoint safety"
git add artifacts/mobile/utils/api.ts && git commit -m "fix(api): fail closed without a native release domain"
```

### Task 8: Expand repeatable Android journeys

**Files:**
- Modify: `e2e/maestro/onboarding-preview.yaml`
- Create: `e2e/maestro/home-core-actions.yaml`

**Interfaces:**
- Consumes: accessible labels created in Tasks 5-6.
- Produces: syntax-valid journeys runnable through Maestro or `agent-device replay --maestro`.

- [ ] **Step 1: Update onboarding flow**

After plan preview, assert the paywall's Free route remains visible, tap `Continue with Free`, then assert `Today` and `Start workout` or `Choose a workout`.

- [ ] **Step 2: Add Home core-actions flow**

Use `appId: com.elovia.app`; launch without clearing state; assert `Today`; open Train via the workout action and return; open Nutrition via `Log meal` and return; open Run and assert `Start recording run`; return to Home.

- [ ] **Step 3: Validate syntax**

```bash
maestro check-syntax e2e/maestro/onboarding-preview.yaml
maestro check-syntax e2e/maestro/home-core-actions.yaml
```

Expected: both `OK`.

- [ ] **Step 4: Commit each file**

```bash
git add e2e/maestro/onboarding-preview.yaml && git commit -m "test(e2e): verify onboarding reaches Today Brief"
git add e2e/maestro/home-core-actions.yaml && git commit -m "test(e2e): cover Home core actions"
```

### Task 9: Build, install, and inspect the changed Android product

**Files:**
- Create: `docs/superpowers/evidence/2026-09-05-core-flow-phase-a-b.md`

**Interfaces:**
- Consumes: current source commit and baseline screenshots in `C:\Users\HP\AppData\Local\Temp\elovia-baseline-*.png`.
- Produces: reproducible runtime evidence, not a claim based on source inspection.

- [ ] **Step 1: Run the static delivery gate**

```bash
pnpm --filter @workspace/mobile test --runInBand
pnpm test
pnpm typecheck
pnpm --filter @workspace/api-server run build
cd artifacts/mobile && npx expo-doctor && npx expo export --platform android --output-dir "$LOCALAPPDATA/Temp/elovia-core-flow-android" && npx expo export --platform ios --output-dir "$LOCALAPPDATA/Temp/elovia-core-flow-ios"
```

Expected: all commands exit 0; record exact test counts and bundle sizes.

- [ ] **Step 2: Produce a current-commit Android installable build**

Use the project's configured preview/development build route. Do not reinstall the old `e1d93df` APK and call it current. Record the EAS build ID/URL or local APK path and commit SHA.

- [ ] **Step 3: Run the device QA loop**

On `medium_phone`, use agent-device to verify:

- onboarding and keyboard focus/dismissal;
- plan preview and Free path;
- Home first viewport and accessible hierarchy;
- Home → Train, Home → Nutrition, Home → Run;
- paywall offerings failure/retry/free/restore controls;
- Android back behavior and runtime logs.

Capture matching screenshots to `%LOCALAPPDATA%\Temp\elovia-core-flow-after-*.png`.

- [ ] **Step 4: Attempt both E2E engines honestly**

Run:

```bash
maestro test e2e/maestro/onboarding-preview.yaml
maestro test e2e/maestro/home-core-actions.yaml
agent-device replay e2e/maestro/onboarding-preview.yaml --maestro --platform android
agent-device replay e2e/maestro/home-core-actions.yaml --maestro --platform android
```

Record syntax, instrumentation attachment, and actual assertion execution as separate facts. A failed instrumentation attachment is not a passing flow.

- [ ] **Step 5: Record before/after metrics**

Include: cold-start `TotalTime`; process PSS/RSS after idle; APK/AAB size; first-viewport user-value order; taps from Home to start workout and log meal; accessible node labels; screenshots; remaining iOS limitation. Do not claim performance improvement unless the same method improves against baseline.

- [ ] **Step 6: Commit the evidence file**

```bash
git add docs/superpowers/evidence/2026-09-05-core-flow-phase-a-b.md && git commit -m "docs: record core-flow Android verification"
```

### Task 10: Review and phase handoff

**Files:**
- Modify only files whose defects are proven by review.

**Interfaces:**
- Produces: reviewed, buildable phase ready for the next Train/Nutrition/Progress implementation plan.

- [ ] **Step 1: Review each task range**

Generate a review package from each task's recorded base to head. Require both spec-compliance and code-quality approval; fix Critical/Important findings and re-review.

- [ ] **Step 2: Run the final branch review**

Review security, accessibility, correctness, maintainability, and the committed evidence. Explicitly inspect authentication/authorization boundaries, external URLs, deep links, user-controlled text, telemetry, and client configuration. Never include secret values in review output.

- [ ] **Step 3: Verify status boundaries**

```bash
git diff --check origin/feat/elovia-p0-integrity..HEAD
git status --short --branch
```

Expected: no whitespace errors in committed work; only the documented pre-existing dirty files remain unstaged.

- [ ] **Step 4: Write the next bounded plan**

Create the next implementation plan for transformed Train active logging, Nutrition repeat logging, Progress weekly review, and explainable adaptation. Do not mix iOS signing, backend job durability, and store assets into that UI slice; each receives a later independently shippable plan.
