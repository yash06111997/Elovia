# Elovia Product Transformation Design

**Date:** 2026-08-31  
**Status:** Approved by product owner through delegated decision authority  
**Scope:** Existing Expo/React Native mobile application, API, database, release system, and product operations

## 1. Decision

Elovia will become a **unified, explainable performance system** rather than a loose collection of fitness utilities or a chatbot wrapped around trackers.

The product will preserve:

- all seven onboarding steps;
- the complete training, nutrition, health, recovery, social, coaching, running, supplements, achievements, places, and scanning feature set;
- free manual tracking and curated programmes;
- native iOS and Android delivery;
- local-first behavior where it protects the core tracking experience.

The product will not be reduced to a single “do this today” action. The home experience may offer a performance brief, but users retain direct access to the complete product and remain in control of their plans and data.

## 2. Selected Approach and Alternatives

### Selected: unified performance system

Training, food, recovery, health signals, and coaching become connected inputs to an adaptation layer. Recommendations explain what changed, why it changed, which evidence was used, and how the user can accept, edit, or ignore the change.

This approach combines the reliability work of a foundation-first stabilization with a differentiated product model. It avoids the risk of a radical AI-first rewrite that would obscure manual tracking and make an already broad product harder to trust.

### Rejected as the primary direction

- **Stabilization only:** lower risk, but leaves Elovia looking and behaving like several competent trackers placed next to each other.
- **Chatbot-first reinvention:** visually novel, but makes AI a navigation layer, weakens direct manipulation, increases cost and privacy risk, and makes failures harder to recover from.

## 3. Product Definition

### Primary users

People who train several times per week and currently combine a workout logger, nutrition tracker, wearable/health app, notes, and occasional coaching. They value progress, speed, reliability, and evidence more than motivational decoration.

### Secondary users

- beginners who need safe structure and exercise guidance;
- runners and hybrid athletes who combine strength and endurance;
- nutrition-focused users who need fast logging and adaptive targets;
- users who rely on wearable health and recovery signals;
- people using social accountability or human coaching.

### Jobs to be done

1. Build or choose a credible training and nutrition plan.
2. Log workouts and food quickly without losing data.
3. Understand whether performance, recovery, and adherence are improving.
4. Adapt the plan when time, equipment, fatigue, injury constraints, or progress change.
5. Keep device health, GPS, hydration, supplements, social accountability, and coaching in the same durable record.
6. Export, restore, or delete personal data without depending on support.

### Value proposition

> Elovia helps committed everyday athletes coordinate training, nutrition, recovery, and accountability by turning their own data into editable, explainable adaptations while keeping professional-grade manual tracking available offline.

## 4. Core Workflows

1. Seven-step profile and consent onboarding → plan preview → free or paid choice.
2. Choose, build, or generate a programme → schedule or adjust sessions.
3. Start a workout → log sets quickly → finish → capture effort/recovery feedback → apply an adaptation.
4. Search, scan, photograph, repeat, or manually add food → review daily and weekly nutrition.
5. Review strength, body, nutrition, running, and recovery trends with explanations.
6. Record GPS activity and synchronize Apple Health/Health Connect data predictably.
7. Manage hydration, supplements, reminders, achievements, saved places, community, and challenges.
8. Ask the AI coach a bounded question or work with a human coach using the same source data.
9. Purchase, restore, upgrade, or cancel without ambiguous entitlement state.
10. Back up, restore, export, and delete the complete user record.

## 5. Information Architecture

The mobile app keeps five primary destinations:

1. **Home** — a concise performance overview, recent progress, and important cross-domain signals. It is not the only way into the product.
2. **Train** — programmes, workout logging, exercise library, history, and running.
3. **Nutrition** — food diary, meal plans, search, barcode, photo recognition, and hydration.
4. **Progress** — strength, training load, nutrition adherence, body metrics, recovery, achievements, and explainable trends.
5. **More** — community, coaching, supplements, places, device connections, notifications, privacy, subscription, profile, and account settings.

Secondary features remain visible through contextual shortcuts from relevant primary tabs. “More” is an organized capability hub, not a dumping ground. Account identity and safety controls remain easy to find.

Navigation uses Expo Router stacks, native tab behavior where stable, native back semantics, and sheets for short focused edits. The app does not emulate desktop navigation.

## 6. Differentiating Product Layer

### Explainable Adaptation Engine

Elovia’s differentiator is not generic AI plan generation. It is a shared adaptation model that considers:

- completed sets, load, reps, RPE, pain/strain feedback, and missed sessions;
- recent training volume and personal-record trends;
- calorie and macro adherence;
- hydration and supplement adherence;
- sleep, heart-rate, HRV, steps, and run load when permission is granted;
- schedule, equipment, and user preferences.

The engine produces small, reversible recommendations such as load progression, exercise substitution, volume reduction, meal-target adjustment, or recovery emphasis. Each recommendation contains:

- the proposed change;
- the evidence used;
- confidence and safety bounds;
- a plain-language rationale;
- accept, edit, defer, and dismiss actions;
- an audit record of the previous and resulting plan.

Deterministic rules handle calculations and safety constraints. AI may summarize evidence, interpret free text, or generate candidates, but it cannot silently overwrite a plan or issue medical advice.

### Workflow accelerators

- Repeat recent meals and workouts without re-entry.
- Context-aware defaults for meal type, set values, rest timer, equipment, and location.
- Editable scan/AI results before they enter durable logs.
- Notification deep links into the exact reminder, session, booking, or challenge.
- Shareable progress summaries and coach-ready data exports without screenshots or spreadsheets.

## 7. Data Ownership and Frontend Architecture

### Canonical state

Each domain has one owner:

- identity and account: authentication layer;
- entitlement: server-authoritative subscription layer with a durable last-known state;
- training: workout repository/store;
- nutrition: nutrition repository/store;
- health and runs: health repository/store;
- wellness and reminders: wellness repository/store;
- server resources: React Query-backed API modules.

Dashboard and progress screens consume derived selectors; they do not maintain parallel copies of water, steps, streaks, or workout counts. Persistence is versioned, validated, and awaited where data loss would be visible.

### Boundaries

- Route files compose screens and navigation only.
- Feature modules own domain UI, hooks, schemas, and API functions.
- Shared primitives own interaction and visual rules.
- Repositories isolate AsyncStorage/native health/server synchronization.
- Pure selectors and calculations remain independently testable.

Large route files are decomposed incrementally around feature boundaries. There is no whole-app rewrite or styling-framework migration.

### Server state

React Query becomes the single server-state mechanism for AI, social, coaching, supplement analysis, entitlement, and cloud synchronization. Query keys, retry policy, offline behavior, cancellation, and invalidation are centralized. The handwritten API client remains the transport until the generated client contract is reconciled; the product will not retain two drifting public contracts.

## 8. Synchronization and Offline Model

Cloud restore returns a typed outcome: `restored`, `empty`, `offline`, `unauthorized`, `conflict`, or `error`. Only `empty` permits an automatic initial upload.

User data snapshots include a schema version, server revision, device mutation time, and stable entity identifiers. Updates use optimistic concurrency. A stale client cannot null fields it omitted or overwrite a newer snapshot silently.

Core workout and food logging remains available offline. Pending mutations are visible, retried with bounded backoff, and reconciled after reconnect. Active sessions, wellness, reminders, places, and other advertised backup data are included or explicitly labeled device-only.

## 9. Backend Design

### API consistency

- Zod schemas validate body, path, and query input at the route boundary.
- Errors use a common envelope with a stable code, user-safe message, request ID, and retryability.
- Collection endpoints define pagination, filtering, sorting, and bounded response sizes where data can grow.
- Mutations that can be retried accept idempotency keys.
- Request size limits are route-specific and applied before expensive authentication or parsing where possible.

### Critical integrity fixes

- RevenueCat webhooks store provider event IDs, enforce idempotency and ordering, and refuse ambiguous active states.
- AI usage is recorded whenever provider work is consumed, including malformed-output failures.
- Coaching bookings validate offered slots, ownership, lead time, horizon, overlap, and time zone.
- Push tokens are scoped to an authenticated user/device pair.
- Account deletion uses a recoverable state machine or compensating operation across Postgres and Firebase identity.
- Google sign-in uses verified app/universal links and a request-bound exchange rather than trusting an unverified custom-scheme token return.

### Operational maturity

Notification scheduling, push receipts, and other retryable asynchronous work move to an explicit job abstraction. The first implementation may use a Postgres-backed jobs table and worker rather than adding Redis prematurely.

Structured logging retains request IDs and redaction. Product telemetry remains allowlisted and excludes health content. Release monitoring gains a concrete crash/error provider or a documented self-hosted equivalent.

## 10. UI and Design System

### Personality

Precise, calm, athletic, and evidence-led. Elovia should feel like a trusted training instrument, not a casino, social feed clone, or neon AI demo.

### Visual rules

- Dark-first native mobile interface.
- Near-black canvas, two restrained surface levels, and hairline separators.
- Cyan is the primary action/focus color; green denotes successful completion; amber denotes attention; red denotes destructive/error states; violet is reserved for AI-assisted content.
- Gradients and glows are exceptional, never default card decoration.
- Typography uses Inter with a compact, consistent scale and tabular numerals for metrics.
- Data-dense lists replace oversized nested cards in repetitive workflows.
- Radii are limited to a small semantic set; pills are reserved for statuses and compact filters.
- Icons come from one family and never replace labels for ambiguous actions.
- Motion communicates continuity, state, and confirmation; reduced-motion settings are respected.

### Shared interaction primitives

Button, IconButton, TextField, SearchField, SegmentedControl, SelectRow, Checkbox, SwitchRow, ListRow, MetricRow, SectionHeader, ScreenHeader, Sheet, Dialog, Snackbar, EmptyState, ErrorState, OfflineState, Skeleton, Avatar, Badge, and semantic Card.

Primitives own minimum touch size, accessibility role/state, disabled/loading behavior, pressed feedback, focus, text scaling, and theme usage. Components are introduced where repeated behavior exists, not to wrap every `View`.

## 11. Product States and Error Handling

Every server-backed or permission-backed feature defines:

- loading and refreshing;
- empty and first-use;
- populated;
- partial/stale;
- offline and reconnecting;
- permission denied and permanently denied;
- signed out;
- validation failure;
- retryable and terminal API failure;
- success and undo where appropriate.

Paywall offerings failures show a retryable error, not an infinite loading label. AI authentication failures open a real sign-in flow. Destructive actions explain scope and recovery. Errors preserve entered data.

## 12. Accessibility and Platform Quality

- All controls expose names, roles, states, and useful hints.
- Touch targets meet 44 pt iOS and 48 dp Android intent.
- Text supports platform scaling without clipped metrics or broken sheets.
- Focus order follows the visual workflow; errors are announced.
- Contrast is verified against the actual dark palette.
- VoiceOver and TalkBack cover onboarding, workout logging, food logging, paywall, and account controls.
- iOS and Android use appropriate back, sheet, picker, permission, keyboard, haptic, and safe-area behavior.
- Portrait phone is the supported form factor for this release; layouts are verified on small, standard, and large phones.

## 13. Performance Design

Performance follows measure → change → re-measure.

Initial baselines cover JS bundle size, cold start, route transition responsiveness, workout history, social feed, food search, health refresh frequency, and render counts for active workout logging.

Long histories and feeds move to FlashList only when profiling demonstrates a list bottleneck. Full health snapshots are not triggered by every pedometer event. Expensive totals are memoized or derived incrementally. Contexts are split or selector-driven when profiling proves broad rerenders. Reanimated is used only for UI-thread-safe transitions that improve feedback.

## 14. Notifications, Analytics, and Privacy

Notification categories are reminders, transactional account/purchase, social activity, coaching activity, and safety/attention. Users control each non-transactional category. Scheduled reminders survive day changes, and notification taps deep-link to the relevant state.

Product analytics measure onboarding steps, preview reach, activation, workout and nutrition logging, feature adoption, trial/paywall conversion, retention, sync failures, AI failures, and performance. Event properties are allowlisted and do not contain free-text health or coaching content.

Onboarding no longer silently accepts minors into the same social/product contract. Age handling, guardian requirements, social visibility, and legal text are reconciled before store release.

## 15. Priority Model

### P0 — essential

- Fix red tests and establish reproducible Node 22 tooling.
- Prevent destructive or ambiguous cloud synchronization.
- Remove duplicated health/wellness sources of truth.
- Fix webhook ordering/idempotency and AI usage accounting.
- Repair authentication recovery and harden OAuth return handling.
- Validate coaching inventory and expose a real paid-coaching conversion path.
- Wire or remove advertised reminders, push registration, and pending geofence actions.
- Reconcile bundle IDs, endpoints, entitlement IDs, store configuration, and signed builds.
- Add backend behavior tests and core mobile/component tests.

### P1 — high-value now

- Establish the design system and redesign the shell plus five core tabs.
- Make workout and food logging faster and denser.
- Complete backup/restore coverage and visible sync state.
- Add clear loading, empty, offline, permission, and error states.
- Implement notification settings and deep links.
- Add social block/report controls and minimum moderation support.
- Add actionable telemetry and release error monitoring.

### P2 — differentiation

- Explainable cross-domain adaptation recommendations.
- Coach-ready progress sharing/export.
- Cross-signal progress insights and weekly review.
- Context-aware repeat logging and plan substitutions.
- Reversible adaptation/version history.

### P3 — experiments

- Voice logging after privacy, accuracy, and editing UX are validated.
- Widgets and app shortcuts after core flows are stable.
- On-device form/rep assistance only after safety and battery validation.

### Rejected

- A generic chatbot as the main interface.
- Silent AI plan changes.
- Public-by-default social activity.
- Decorative animation across every screen.
- A full NativeWind migration.
- Redis, microservices, semantic search, or a queue platform without measured need.
- Medical diagnosis, supplement dosage, or interaction claims.

## 16. KEEP / FIX / MATCH / BEAT / INVENT / REMOVE / DEFER

### Keep

Seven-step onboarding, plan preview, curated programmes, free manual logging, local-first tracking, RevenueCat server authority, privacy export/deletion, native health integrations, deterministic fallbacks, and the broad product scope.

### Fix

State duplication, cloud sync semantics, inactive notification/geofence code, auth recovery, coaching conversion, accessibility gaps, giant route files, stale documentation, incomplete API contract, tests, and store identity drift.

### Match

Fast repeat logging, reliable watch/health sync, polished exercise guidance, dense history, transparent subscription handling, robust search, and dependable offline recovery.

### Beat

Competitors’ opaque AI recommendations, fragmented workout/nutrition subscriptions, aggressive paywall interruptions, card-heavy logging redesigns, and screenshot/spreadsheet coach handoffs.

### Invent

Explainable cross-domain adaptations, evidence cards with reversible changes, a unified weekly performance review, and coach-ready data sharing from the same source of truth.

### Remove

Duplicate state, dead routes, unreachable features, misleading “backup complete” claims, redundant upgrade banners, unused theme branches, and ornamental hierarchy that slows core logging.

### Defer

Tablet-specific layouts, landscape, advanced semantic search, smartwatch companion applications, and regulated-health capabilities.

## 17. Implementation Sequence

1. Baseline, failing-test repair, environment reproducibility, and requirement ledger.
2. Data integrity, authentication, entitlement, quota, booking, and sync P0 fixes.
3. Canonical domain state and API/query architecture.
4. Design tokens and shared native interaction primitives.
5. App shell, navigation, and organized More hub.
6. Training and nutrition workflow redesign.
7. Home, progress, health, and recovery redesign.
8. Social, coaching, reminders, places, supplements, and account completion.
9. Explainable adaptation and weekly performance review.
10. Accessibility, platform behavior, and responsive phone polish.
11. Performance profiling and measured optimization.
12. Security review, backend tests, mobile tests, Maestro flows, and device QA.
13. Store assets/configuration, signed Android/iOS builds, documentation, transformation report, commit, and push.

Each phase must leave the repository buildable and must use focused commits. Existing user changes under `.agents` and `.gitignore` remain untouched unless explicitly required.

## 18. Verification Contract

Completion requires evidence, not source inspection alone:

- root tests, mobile and API typechecks, API build, Expo Doctor, dependency/security audit;
- API integration tests for authorization, validation, sync conflicts, webhook idempotency, quotas, booking races, and deletion;
- component tests for critical states and forms;
- Maestro coverage for onboarding, authentication, workout, food/search/scan, purchase/restore, settings/privacy, and account paths where the environment permits;
- agent-device interaction, screenshots, hierarchy, logs, and keyboard checks on Android and iOS targets;
- measured performance before and after material optimizations;
- successful current-commit EAS Android and iOS builds;
- a requirement-by-requirement final transformation report with current research sources, rejected features, and roadmap.

Windows cannot run an iOS Simulator. iOS runtime claims therefore require an attached physical iOS device, remote macOS runner/device farm, or documented EAS/TestFlight device evidence. A successful IPA build alone proves compilation, not runtime quality.
