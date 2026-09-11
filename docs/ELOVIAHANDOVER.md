# Elovia — Technical Handover for Independent Review

**Purpose:** a self-contained account of an Expo/React Native fitness app and its backend,
written so a reviewer with no prior context can verify the claims made about it.
All credentials are redacted.

**Date:** 2026-08-30

**Suggested reviewer task:** challenge the architecture decisions, identify anything unsafe
or unfinished, and say what a careful engineer would do before taking real payments.

---

## 1. What the product is

**Elovia** — a mobile fitness app (iOS + Android) providing:

- Workout logging, curated training programmes, custom plan builder
- Diet logging, barcode scanning (Open Food Facts), AI food-photo recognition
- Hydration tracking; supplement and medicine tracking with interaction notes
- GPS run tracking (Strava-like), geofenced gym auto-start
- Gamification: XP, 25 achievements, streaks, weekly challenges
- Social: friend codes, activity feed, kudos, comments, challenges
- Three-tier commercial model:
  - **Free** — deterministic features only, zero AI
  - **Pro** ($4.99/mo, yearly, lifetime) — AI features; entitlement `Elovia Pro`
  - **Coaching** ($149/mo) — 1-on-1 human coaching; entitlement `Elovia Coaching`

The codebase originated from a Replit AI agent. The Replit account was later lost, forcing
a full migration to independent hosting.

---

## 2. Stack

| Layer | Technology |
|---|---|
| Mobile | Expo SDK 54, React Native 0.81.5, New Architecture enabled, expo-router |
| Monorepo | pnpm workspaces: `artifacts/mobile`, `artifacts/api-server`, `lib/db`, `lib/api-zod`, `lib/api-client-react`, `lib/integrations-anthropic-ai` |
| Server | Express (TypeScript), bundled by esbuild into a single `.mjs` |
| Database | PostgreSQL via Drizzle ORM |
| Auth | Firebase Auth (client) + Firebase Admin (server-side token verification) |
| Payments | RevenueCat, webhook-driven and server-authoritative |
| AI | Anthropic (vision) + NVIDIA NIM (structured/chat), task-routed with fallback |
| Hosting | Railway (EU West): app service + Postgres with attached volume |
| Builds | EAS Build, project `@yash06111997/elovia-claude` |

- Bundle ID (both platforms): `com.elovia.app`
- Backend: `https://elovia-production.up.railway.app`
- Repo: `github.com/yash06111997/Elovia`, branch `feat/comprehensive-fitness-platform`
- Scope: **49 commits, 88 files, +16,618 / −611 lines** relative to `main`

---

## 3. Architectural decisions worth scrutinising

### 3.1 Entitlements are server-derived, never client-asserted

`artifacts/api-server/src/lib/entitlements.ts` resolves access from two sources only:

1. The `subscriptions` table, written **exclusively** by the RevenueCat webhook
2. `users.createdAt` — the free trial is derived from account age

Rationale: the original code stored trial start in client-side `AsyncStorage`, which a user
resets by reinstalling, farming unlimited trials. Deriving it from the account row makes the
trial genuinely once-per-account. An active entitlement is still checked against
`currentPeriodEndsAt`, because webhooks can be delayed or dropped.

### 3.2 AI access gated at middleware with three distinct outcomes

`artifacts/api-server/src/middlewares/aiGate.ts` returns:

- **401** — not signed in
- **402** — signed in, no entitlement, so the client opens the paywall
- **429** — entitled but out of daily quota, so the client shows a reset time and **not** an upsell

Rationale: collapsing 402 and 429 into one "upgrade" prompt nags paying subscribers to buy
what they already own. The client honours the distinction in `utils/aiErrors.ts`.

### 3.3 Quota is claimed before the upstream call, guarded by a unique index

`lib/db/src/schema/aiUsage.ts` carries `uniqueIndex("UQ_ai_usage_user_day_route")`.

Rationale: without it, two concurrent requests each insert their own row, both read a count
of zero, and the quota never bites. Application-level checking loses this race.

Per-tier daily limits and a micro-USD cost ceiling are both enforced (`lib/aiQuota.ts`):

| Tier | Food scans/day | Daily cost ceiling |
|---|---|---|
| Free | 0 | — |
| Trial | 10 | $0.30 |
| Premium | 50 | $2.00 |
| Coaching | 150 | — |

**Tension worth review:** a $4.99/month premium subscriber has a $2.00/day cost ceiling.
Realistic usage is around $1–2/month, but the ceiling permits a loss-making outlier.

### 3.4 AI provider routing

`lib/ai/router.ts`:

```
vision      -> ["anthropic"]              // NVIDIA endpoint cannot accept images
structured  -> ["nvidia", "anthropic"]    // NVIDIA cheaper; Claude is the fallback
chat        -> ["nvidia", "anthropic"]
```

Model names are environment-overridable. `extractJson()` performs brace-balanced scanning
rather than a greedy regex.

### 3.5 In-app coaching booking instead of an external scheduler

Originally a link to Cal.com; replaced with first-party booking.

**Time model, the crux of the design:**

- Availability is **recurring wall-clock**: `weekday` + `startMinute` + IANA timezone.
  It cannot be stored as UTC, because "every Tuesday 9am for the coach" is a different UTC
  instant either side of a daylight-saving change.
- Bookings are **absolute instants** (`timestamptz`).
- The client renders instants in the device's own timezone. Nothing in the database is ever
  in the client's zone.

`lib/scheduling.ts` resolves wall-clock to instant with a two-pass offset computation using
`Intl.DateTimeFormat`, with no date library. **Verified by test** against Europe/London
(GMT/BST), Asia/Kolkata (+5:30), America/New_York (DST) and Pacific/Chatham (+12:45, where
the offset rolls the date over): 5/5 passed.

**Double-booking is prevented by `uniqueIndex("UQ_session_coach_start")`, not by application
code.** Two clients tapping the same slot both pass any application check; only the database
can arbitrate. Postgres error `23505` becomes HTTP 409 `slot_taken`, which the UI treats as
"pick another time" rather than a failure.

### 3.6 Calendar export uses short-lived signed URLs

An `.ics` file is opened by the operating system, which sends none of the app's headers, so
a bearer token cannot ride along. `lib/signedLinks.ts` issues HMAC tokens scoped to one
subject and one purpose, expiring in 10 minutes, compared in constant time.

**Verified by test: 9/9** — valid token accepted; wrong subject, wrong purpose, tampered
signature, tampered expiry, expired token, garbage and empty all rejected; URL-safe charset
confirmed.

### 3.7 Coaching is deliberately outside in-app purchase

Apple guideline **3.1.3(d)** exempts one-to-one person-to-person services from IAP, so the
$149 coaching tier can be billed outside the store, retaining roughly 30%.

---

## 4. Pre-existing defects found and fixed

These were latent in the inherited codebase, not introduced by this work.

1. **`p-retry` v7 `AbortError`** moved to a named export upstream, breaking the entire
   `tsc --build`. The repo had never typechecked.
2. **Dietary filter never worked** — `foodPreference` was passed as the *category* argument
   of `searchFoods(query, category)`. A correct `filterByDiet()` existed and was never called.
3. **Six mobile type errors** — the app had never passed its own typecheck.
4. **Data-loss bug in cloud sync** — a destructive `set(userRef, data)` with the guard cleared
   in `finally`, so a failed sync could wipe remote data.
5. **Trial farming** via `AsyncStorage` (see 3.1).
6. **Instant crash on iPhone** — `getDatabase(app)` at module scope threw
   "Can't determine Firebase Database URL" during module evaluation, before React mounted,
   so the app closed with no error screen. Made lazy.

---

## 5. Migration and deployment problems encountered

Recorded because the sequence is itself evidence about the system's failure modes.

| # | Symptom | Actual cause | Fix |
|---|---|---|---|
| 1 | Android build failed | `compileSdkVersion 35` too low | Raised to 36 |
| 2 | Android build failed | `require(variable)` — TypeScript accepts it, Metro's static analysis rejects it | Literal `require()` only |
| 3 | iPhone app closed instantly | Missing `EXPO_PUBLIC_*` plus module-scope Firebase throw | Both fixed |
| 4 | Deploy crash-looped | `DATABASE_URL` unset | Postgres provisioned |
| 5 | Variables appeared not to save | Railway **stages** changes and requires an explicit Deploy; separately, three of four rows silently never saved | Re-added and verified by count |
| 6 | `${{Postgres.DATABASE_URL}}` resolved to empty | Reference did not resolve despite a correct service name | Pasted the literal value |
| 7 | `drizzle-kit push` failed | Bundled esbuild missing its Windows binary — `node_modules` had been installed on Replit's Linux machines | Placed the correct platform binary |
| 8 | `drizzle-kit`: "No schema files found" for a file that plainly exists | Checkout path contains `Health-Hub (1)`; **parentheses are glob metacharacters** | Made the schema path relative |
| 9 | All Anthropic calls returned 502 | The key was **identity-linked**, requiring an `anthropic-workspace-id` header | New workspace-scoped key; header support added as insurance |
| 10 | All NVIDIA calls returned 502 | `meta/llama-3.3-70b-instruct` **reached end-of-life on 2026-08-26**, returning 410 Gone | Replaced with `nvidia/nemotron-3-super-120b-a12b`, selected by benchmarking candidates for parseable JSON output |
| 11 | The model fix had no effect | **Railway is not auto-deploying on git push** — the GitHub branch link reads "Repo not found", so the server was running first-deploy code | Worked around via env-var override; the connection still needs repairing |

**A hypothesis that was wrong and abandoned after testing:** the Anthropic model ID
`claude-sonnet-4-6` was suspected invalid. Testing three model IDs, including one known to
be good, showed all three failing identically — ruling out anything model-specific and
pointing at authentication instead.

---

## 6. Current verified state

End-to-end test run against the live server, authenticating as a real Firebase user:

```
PASS  firebase sign-up
PASS  diagnostics        postgres=ok firebase_admin=ok anthropic=ok
                         nvidia_nim=ok revenuecat_webhook=degraded
PASS  entitlement        tier=trial
PASS  database write     HTTP 200
PASS  database read
PASS  coaching slots     accepting=false slots=0   (correct: no coach seeded yet)
PASS  NVIDIA generate-workout    50073ms, 3583 bytes
PASS  Anthropic recognize-food    8576ms
      -> {"foods":[{"name":"Apple (red, whole)","estimatedGrams":182,
          "calories":95,"protein":0.5,"carbs":25,"fats":0.3, ...}]}
PASS  quota accounting   food=1 workout=1

9/9 passed
```

The food-recognition test used a synthetic 640x480 JPEG drawn programmatically (a red
ellipse with a brown stem and green leaf). The model identified it as a red apple and
returned plausible macros, which exercises the full path: base64 upload, prompt
construction, provider call, JSON extraction and normalisation.

Database: **17 tables, 9 uniqueness guards**, confirmed by direct query.

Builds: Android **FINISHED** with an installable APK. iOS **IN_PROGRESS**.

### Known issues and outstanding work

- **Workout generation takes 50 seconds.** Benchmarked at 9s with a small prompt; the live
  route requests 4,096 tokens with a much larger system prompt. Poor UX, untuned.
- **Railway does not auto-deploy on push.** The server runs first-deploy code plus env-var
  overrides. Three commits are undeployed.
- No coach row is seeded, so booking correctly reports "not accepting clients".
- RevenueCat: webhook secret is set, the dashboard is not yet wired, and no store records
  exist (the bundle ID changed, so both stores need new app records).
- `replit.md` is stale.
- `railway.json` is inert: Railway deprecated config-as-code for services created after
  2026-08-28, and this service was created on 2026-08-30. Railpack auto-detection is
  building it successfully instead.
- Roughly five test accounts (`elovia-smoketest-*@example.com`) remain in Firebase Auth.

---

## 7. Security posture

**Deliberate separation of credential classes:**

- *Client identifiers* — Firebase web config, RevenueCat `appl_`/`goog_` SDK keys — live in
  `eas.json` and ship inside the binary. This is correct; they are designed to be public.
- *True secrets* — `FIREBASE_SERVICE_ACCOUNT_KEY`, `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`,
  `REVENUECAT_WEBHOOK_SECRET`, `LINK_SIGNING_SECRET` — exist only in Railway's environment.
  Never in git, never in `eas.json`.
- `.env` was added to `.gitignore`; it had not been ignored, which was a live hazard.
  Verified: no `.env` appears anywhere in repository history.

**Webhook hardening:** the RevenueCat handler compares signatures in constant time; returns
**503** when the secret is unset versus **401** for a bad signature, so a broken deploy is
distinguishable from an attack; and treats CANCELLATION as "will not renew" rather than
immediate revocation.

**Two credential-exposure incidents occurred during this work:**

1. A Firebase service-account private key was pasted into the working session. The key was
   revoked in Google Cloud IAM and a replacement was issued.
2. A Postgres connection string including its password was pasted into the session. The
   mitigation applied was removing the public TCP proxy, making the credential unreachable
   from the internet (the app connects over `postgres.railway.internal`).
   **A reviewer may reasonably argue the password should also have been rotated outright.
   That was not done.**

---

## 8. Questions a reviewer might usefully attack

1. Is deriving the trial from `users.createdAt` sufficient, given a user can create multiple
   accounts with different email addresses?
2. Is a $2.00/day cost ceiling defensible against $4.99/month revenue?
3. Is 50-second workout generation acceptable, or does structured generation belong on a
   faster provider despite the cost?
4. The DST-ambiguous hour (when clocks go back) resolves to the *first* of the two possible
   instants. Is choosing silently defensible, or should the coach be asked?
5. Is a 10-minute signed calendar URL the right window?
6. Is removing the TCP proxy adequate mitigation for an exposed database password, or is
   rotation mandatory?
7. Railway silently dropped configuration three separate times. Should configuration
   verification be automated rather than checked by eye?
8. `railway.json` is inert and therefore misleading. Should it be deleted rather than left
   in the repository?
9. The vision route is single-provider with no fallback. Is that an acceptable availability
   risk for the feature users judge the app on?
10. Are the pre-existing defects in section 4 evidence that the remaining inherited code
    warrants a systematic audit rather than incidental fixes?
