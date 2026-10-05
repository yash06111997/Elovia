# Elovia Core-Flow Transformation Design

**Date:** 2026-09-05  
**Status:** Approved product direction; implementation specification  
**Audience:** Hybrid strength-and-nutrition users who want one adaptive plan  
**Scope:** Existing Expo/React Native product in `artifacts/mobile`, supported API boundaries, tests, and Android verification

## 1. Decision

Elovia will ship its next transformation around one promise:

> Coordinate strength training and nutrition in one fast daily workflow, then turn completed sessions, adherence, and recovery signals into explainable changes the user can accept, edit, defer, or undo.

This is a delta transformation of the existing application, not a rewrite. The present five-tab information architecture, broad feature set, local-first logging, free manual tracking, native integrations, and completed integrity/security work remain intact.

The first implementation increment will make visible changes to the shared design system, onboarding-to-plan handoff, Home, Train, Nutrition, Progress, and paywall. It will also add the automated mobile coverage and configuration safeguards needed to change those surfaces without regressing working behavior.

## 2. Evidence Behind the Direction

The current Android build already supports seven-step onboarding, generated plan preview, a five-tab shell, workout planning, food and macro tracking, progress, running, and subscription flows. Live inspection confirmed that the product is functional but still reads as a collection of competent feature screens rather than one coordinated daily system.

The Android baseline also exposed specific product-quality gaps:

- Home leads with four generic shortcuts and separate metric cards rather than a clear training-plus-nutrition plan for today.
- The paywall can show `Plans unavailable` when store offerings fail, leaving the user without a strong recovery path.
- Some accessibility hierarchy output exposes icon-font glyphs instead of meaningful semantics.
- The main experience uses repeated bordered cards, similar visual weight across unrelated modules, and insufficient hierarchy between the next action, supporting metrics, and secondary features.
- The onboarding form remains operable with the keyboard open, but the screen compresses heavily and depends on users scrolling to recover context.
- Maestro flows exist and pass syntax validation, but local instrumentation did not attach; agent-device was therefore the verified Android interaction baseline.

Competitors demonstrate strong point solutions in recovery, adaptive strength, or nutrition, but no verified incumbent clearly owns the full loop of strength plus nutrition plus recovery evidence, a plain-language reason for a proposed change, reversible editing, and a durable change history.[1][2][3][4]

The sampled Google Play evidence also shows that low-friction logging is an acquisition and retention advantage, while extra taps, unstable redesigns, aggressive paywalls, and opaque recommendations are recurring sources of dissatisfaction.[5][6]

## 3. Transformation Approaches Considered

### Selected: coordinated core-flow transformation

Redesign the visible daily journey and the shared interaction layer together, while hardening only the architecture directly needed by those workflows.

**Why selected:** It produces material UI/UX improvement quickly without placing polish on top of unstable state or attempting an unsafe whole-product rewrite.

### Rejected: visual reskin only

Retheme current screens and leave workflow/state boundaries unchanged.

**Trade-off:** Fast screenshots, but little improvement to task completion, trust, accessibility, testability, or differentiation. It would preserve the same card-heavy hierarchy and fragmented product story.

### Deferred: architecture-first rebuild

Refactor all route monoliths, contexts, repositories, and API contracts before changing visible UI.

**Trade-off:** Strong long-term foundation but delays visible user value, expands regression risk, and violates the requirement to preserve the working MVP. Architecture will instead be improved incrementally where a transformed workflow touches it.

## 4. Product Principles

1. **Today before totals.** Home answers what to do next before showing cumulative metrics.
2. **Logging speed is a feature.** Common workout and meal actions remain one or two taps from the relevant tab.
3. **AI proposes; the athlete decides.** No silent plan mutation.
4. **One plan, multiple signals.** Training and nutrition share goals, schedule, adherence, and change history without collapsing into one undifferentiated screen.
5. **Explain every adaptation.** Show evidence, confidence, expected effect, and user controls.
6. **Preserve manual control and offline use.** Generated recommendations never gate reliable logging.
7. **Progress is causal, not decorative.** Progress surfaces connect behaviors and outcomes instead of presenting disconnected charts.
8. **Subscription state is honest.** Store failures, free access, trials, purchases, and restoration have explicit states and recovery actions.

## 5. Core Experience

### 5.1 Onboarding and plan handoff

Keep the seven approved steps, but improve hierarchy, keyboard behavior, validation, and the transition from collected preferences to the generated plan.

The plan preview must show:

- training schedule and primary goal;
- daily calorie and macro targets;
- the inputs that influenced the plan;
- assumptions or missing signals;
- an edit-before-accepting path;
- a concise `Why this plan` explanation;
- a choice to continue on Free or view Premium without obscuring the free path.

The generated plan cannot imply medical certainty. Injury, recovery, and health data are constraints or signals, not diagnoses.

### 5.2 Home: Today Brief

Home becomes a coordinated daily brief with this order:

1. **Today status:** date, greeting, and whether the app has fresh or stale data.
2. **Next best action:** today’s planned workout or recovery recommendation, with a primary `Start workout` action.
3. **Nutrition target:** calories/protein remaining and the next likely logging action, with `Log meal` and `Repeat recent` paths.
4. **Readiness/adaptation card:** only when enough evidence exists; otherwise show a clear data-needed state.
5. **Compact quick actions:** Run, Water, Scan food, and other high-frequency secondary actions.
6. **This week:** compact adherence and progress summary.

Remove redundant metric cards and repeated upgrade banners from the first viewport. Premium prompts are contextual rather than the dominant Home message.

### 5.3 Train

Train remains the canonical place for plans, sessions, history, and running.

The transformed landing screen provides:

- current plan and schedule status;
- today’s workout with a dominant `Start` control;
- compact exercise rows with sets, rep range, rest, and equipment;
- explicit plan actions: edit, substitute, regenerate, switch, or build manually;
- history as a stable secondary view;
- a visible adaptation/change-history entry point.

During active logging, controls prioritize set completion, previous values, timer, substitution, and safe exit/recovery. The workflow must preserve an in-progress session across backgrounding or process death.

Post-workout feedback produces a small proposal such as progression, substitution, or volume reduction. Each proposal contains evidence and can be edited, deferred, dismissed, or undone.

### 5.4 Nutrition

Nutrition prioritizes diary speed rather than dashboard decoration:

- today’s calories and protein appear first;
- meals use dense rows with add, repeat, barcode/photo, search, and manual entry;
- recent and frequent foods are first-class;
- every scanned or AI-derived item is editable before saving;
- daily targets show their relationship to the active plan;
- weekly adherence appears after the diary, not before it.

No recommendation silently changes calorie or macro targets. A target change uses the same explainable proposal pattern as training adaptations.

### 5.5 Progress

Progress becomes a connected weekly review:

- training completion and load;
- strength progression;
- calorie and protein adherence;
- body metrics when present;
- recovery and running signals when permission exists;
- a short explanation of what likely drove the week;
- data-quality labels for missing or stale inputs;
- links to underlying sessions and logs.

Claims must distinguish correlation from causation. The review proposes at most a few high-confidence actions rather than a feed of generic AI insights.

### 5.6 Paywall and entitlement recovery

The paywall retains clear Free functionality and does not trap onboarding.

Required states:

- offerings loading;
- offerings available;
- offerings unavailable with `Try again`;
- signed-out purchase requirement with a real authentication path;
- purchase pending/success/failure;
- restore pending/success/not-found/failure;
- current entitlement and renewal status;
- visible `Continue with Free` action when allowed.

Store-offering failure must not be represented as a connectivity certainty. Copy says prices could not be loaded and provides retry, restore, and free-continuation paths as appropriate.

## 6. Visual and Interaction System

Elovia remains dark-first, calm, precise, and athletic. The transformation uses the existing cyan brand accent but removes the visual impression that every block is equally important.

### Visual hierarchy

- Near-black canvas with one base surface and one raised surface.
- Hairline grouping and whitespace before bordered containers.
- Cyan for the primary action/focus; green for completed/success; amber for attention; red for destructive/error; violet only for explicitly AI-assisted content.
- One strong primary action per screen state.
- Metrics use tabular numerals and compact labels.
- Dense lists replace nested cards for workouts, meals, history, and repeated data.
- Pills are limited to status, filters, and compact metadata.
- Gradients and glows are exceptional, not default decoration.

### Shared primitives

Create or standardize `Screen`, `ScreenHeader`, `SectionHeader`, `Button`, `IconButton`, `ListRow`, `MetricRow`, `StatusBanner`, `TextField`, `SearchField`, `ProgressBar`, `Sheet`, `Dialog`, `Snackbar`, `Skeleton`, `EmptyState`, `ErrorState`, `OfflineState`, and `AdaptationCard`.

Every interactive primitive owns:

- minimum 48 dp touch intent;
- accessibility role, label, state, and hint;
- pressed, focused, disabled, and loading behavior;
- dynamic text support;
- reduced-motion behavior;
- optional, restrained haptics;
- semantic color and typography tokens.

Ionicons remain the cross-platform app icon family. Raw icon-font text must not become the accessible name of a control.

## 7. Architecture Boundaries

This phase does not rewrite all contexts. It establishes boundaries around the transformed workflows:

- Route files compose navigation and feature sections.
- Pure selectors build `TodayBrief`, training summary, nutrition summary, and weekly review view models.
- Server-backed resources use React Query modules with shared query keys and error handling.
- Local drafts and active sessions remain in focused local stores/repositories.
- Screens do not own storage parsing, sync policy, or cross-domain calculations.
- Existing giant routes are decomposed only where touched by this phase.

Production builds must require a valid API base URL. Native release code cannot silently fall back to `localhost`.

The existing iOS native-tab path remains behind capability detection during this phase. A regression test must cover the classic tab fallback, and the unstable API must be tracked as an explicit upgrade risk rather than expanded.

## 8. Backend and Data Requirements

Visible core-flow work depends on these supporting guarantees:

- authenticated objects are always scoped to their owner or an explicit coach/admin relationship;
- request schemas reject unknown keys and enforce string, array, and payload bounds;
- retriable mutations use idempotency keys where duplicates would be harmful;
- RevenueCat events remain ordered and idempotent;
- sync exposes typed restored, empty, offline, unauthorized, conflict, and error outcomes;
- deletion covers first-party data, linked identity/provider cleanup, retries, and auditable completion;
- telemetry is allowlisted, redacted, bounded, consent-aware, and linked to deletion;
- asynchronous notification and receipt work has durable retry, duplicate suppression, and failure visibility.

No credential values may appear in reports, tests, fixtures, logs, or documentation. Any discovered credential is represented as `[REDACTED]` and triaged outside committed output.

## 9. Accessibility and Platform Behavior

Acceptance requires:

- TalkBack names, roles, states, and logical focus order on onboarding, Home, Train, Nutrition, Progress, and paywall;
- 48 dp Android and 44 pt iOS touch intent through shared primitives;
- text scaling without clipped metrics, actions, or sheets;
- keyboard-safe onboarding and nutrition forms;
- announced validation and asynchronous error states;
- contrast checks against the real dark palette;
- reduced-motion behavior and no motion-dependent meaning;
- Android back handling that preserves drafts and active sessions;
- iOS runtime claims withheld until tested on a physical device, device farm, or macOS runner.

## 10. Testing and Verification

All behavioral changes follow test-driven development: add a failing test, confirm the expected failure, implement the smallest change, then run focused and broader checks.

The implementation plan must include:

- component tests for shared primitives and transformed screen states;
- selector tests for Today Brief and weekly review calculations;
- paywall state and recovery tests;
- release API configuration tests;
- ownership, validation, idempotency, sync-conflict, deletion, and telemetry integration tests;
- Maestro flows for onboarding-to-free, workout completion and adaptation, meal logging, paywall retry/restore, and privacy/account paths;
- agent-device screenshots, hierarchy, logs, keyboard checks, and interaction walkthroughs on Android;
- before/after evidence for first viewport hierarchy and core task taps;
- mobile/API typechecks, root tests, API build, Expo Doctor, Android/iOS export, and dependency audit.

The mobile Jest script must no longer hide an empty suite with `--passWithNoTests`. Existing discovered tests must execute under the package command.

## 11. Delivery Phases

### Phase A — safety net and shared language

- Fix the mobile test command and add shell/navigation/config smoke coverage.
- Add design-token and primitive tests.
- Capture approved Android baselines and define screenshot checkpoints.

### Phase B — visible core transformation

- Standardize tokens and shared primitives.
- Transform onboarding handoff and plan preview.
- Transform Home into Today Brief.
- Transform Train and active logging hierarchy.
- Transform Nutrition diary and repeat logging.
- Transform Progress into a weekly review.
- Repair paywall failure and recovery states.

### Phase C — explainable adaptation

- Introduce one proposal contract for training and nutrition changes.
- Add evidence, confidence, actions, and version history.
- Surface proposals on Home, Train, Nutrition, and Progress without silent mutations.

### Phase D — production hardening

- Verify ownership and validation endpoint by endpoint.
- Add durable retry/idempotency/deletion/telemetry guarantees.
- Finish accessibility, performance measurement, Maestro execution, current-commit EAS builds, and release evidence.

Each phase remains buildable, testable, and independently reviewable. Each changed file receives its own descriptive commit per repository policy.

## 12. Success Criteria

The core-flow transformation is accepted when:

1. A new user can complete onboarding, understand the generated training and nutrition plan, edit it, and continue free without ambiguity.
2. A returning user can start today’s workout or log a meal from Home in no more than two deliberate taps.
3. Active workout and nutrition logging remain reliable offline and preserve entered data through errors/backgrounding.
4. Every adaptation shows the proposed change, evidence, confidence, and accept/edit/defer/dismiss/undo controls.
5. Home, Train, Nutrition, Progress, onboarding, and paywall use the shared interaction and visual system and pass the defined accessibility checks.
6. Store-offering failure provides a working retry and free-continuation path.
7. The mobile test command discovers and runs tests without `--passWithNoTests`.
8. Android agent-device evidence and Maestro flows validate the transformed journeys; iOS runtime status is reported honestly.
9. No critical security finding remains open; high/moderate dependency findings are triaged by runtime reachability and compatibility rather than blindly overridden.
10. Final reporting contains measured before/after evidence and identifies any unverified production dependency plainly.

## 13. Explicit Non-Goals

- Greenfield rewrite.
- Generic chatbot as the primary UI.
- Silent AI plan changes.
- Full NativeWind or component-library migration.
- FlashList or Reanimated adoption without measured need.
- Tablet/landscape optimization in this release.
- Smartwatch companion application.
- Medical diagnosis, treatment, or supplement dosage claims.
- Rebuilding social/coaching before the core hybrid journey is coherent.

## Sources

[1] https://help.bevel.health/en/articles/11583937 — Bevel Strength Builder  
[2] https://www.whoop.com/us/en/thelocker/introducing-strength-trainer-a-new-way-to-quantify-the-impact-of-your-strength-training/ — WHOOP Strength Trainer  
[3] https://help.macrofactorapp.com/en/articles/305-understanding-and-using-smart-progressions — MacroFactor Smart Progressions  
[4] https://help.fitbod.me/hc/en-us/articles/38318585683991-Customizing-Today-s-Workout — Fitbod Customizing Today’s Workout  
[5] https://play.google.com/store/apps/details?id=com.myfitnesspal.android — MyFitnessPal Google Play Reviews  
[6] https://play.google.com/store/apps/details?id=com.hevy — Hevy Google Play Reviews
