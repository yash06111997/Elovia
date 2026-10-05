# Elovia delivery and release status — 5 October 2026

## Implemented in source

- 1,832 exercise entries after merging 166 curated entries with two imported sources; preserved curated exercise IDs. Combined muscle/equipment search and sorting, and equipment-constrained browsing.
- 69 entries have reusable source videos with a roughly ten-second playback loop: 46 retained wger entries plus 23 entries matched to 18 free commercial-use YMove clips. 873 entries have source images. Every exercise has a video/photo/written-guide fallback, but **not every exercise has a video**. No videos were purchased or fabricated.
- Live trophy/confetti personal records for weight, reps, set volume, exercise sets/reps/volume and workout sets/reps/volume. Warmups and incomplete/invalid sets do not establish records. Ties do not replay celebrations. Reduced-motion and screen-reader feedback are included.
- Per-muscle history charts, session comparisons, and individual exercise sets/reps/volume; primary-muscle attribution prevents inflating totals by counting each set for several muscles.
- Onboarding expanded from seven to thirteen pages. New training, schedule, priorities, consistency, food-routine and recovery preferences are stored and shown in the plan preview. Existing features were not removed.
- Annual-only 14-day introductory-offer policy, monthly paid base-plan purchase handling, restore/access synchronization and native RevenueCat Paywall integration with a local fallback. Account-age-based free access was removed. Native paywall activation is separately gated by offering metadata.
- Review-driven background/relaunch-safe workout timing, restored draft sets, clearer historical PR labels, compound-first equipment-aware local plans, completed-workout CSV export, and direct store subscription-management links.
- Localized storefront prices and currency-aware annual monthly-equivalent display. Price selection belongs to Apple/Google storefronts, not GPS/IP or currency-symbol parsing.

## Verification

- Mobile TypeScript: passed.
- Consolidated mobile Jest: 86 tests, 26 suites passed, including store-identity race/restore tests. Account-switch server responses and prior-account subscription display are regression-tested.
- Consolidated root regression tests: 294 passed, 103 database-backed tests skipped locally. Annual-only canonical/normalized trial regressions passed, including cancelled monthly trials, invalid duration, refunds and grace. GitHub CI must verify the consolidated commit against its PostgreSQL matrix.
- Consolidated mobile TypeScript, workspace library type generation, API TypeScript and API production build: passed. API checking must follow workspace library type generation to avoid stale declarations.
- Consolidated iOS and Android Metro/Hermes exports: passed separately with two bundler workers. These are JavaScript exports, **not signed IPA/APK builds or real-device testing**. A web-inclusive export failed at the native maps dependency; web release is outside this mobile-only product's scope.
- A fresh signed Android preview APK from feature commit `b03b810` subsequently finished on EAS. Build `8cd28021-9fe6-4d1b-a480-e8ffd6a910a4`; the artifact URL returned HTTP 200 (139,775,880 bytes). This is an internal test APK, not a production Play AAB or an App Store build.
- Production recovery commit `d673ee3` passed GitHub CI against PostgreSQL 14, 16 and 18, including database-backed checks. The migration compatibility regression preserves rejection of nullable/unvalidated or unrelated missing constraints; no data reset or safety-check bypass was used.
- Maestro flow updated for thirteen onboarding pages; not run on a device.
- Real-device GPS/background recording, video codecs, purchases/restores, screen-reader and reduced-motion behaviour still need device testing.

## Dashboard work and blockers

- Apple: created `Elovia Pro` subscription group and `elovia_pro_yearly` (one year). Saved US $29.99/year and India ₹1,499/year; other territories use Apple's generated equivalent tiers. Saved and verified a free two-week introductory offer starting 5 October 2026 with no end date across 175 territories. Created monthly product `elovia_pro_monthly` (Apple ID `6819204530`, one month), saved current-territory availability, US $4.99/month and India ₹199/month. The saved India row and **Introductory Offers (0)** were verified in the monthly pricing table. Saved English (US) monthly name/description. These remain drafts, not approved/purchasable; review screenshots, group localization and verified purchases remain unfinished.
- RevenueCat: created an Elovia Pro native paywall draft on the existing default offering with dynamic prices, monthly no-trial copy, restore and continue-free controls. It remains **unpublished**; conditional trial rendering and real-device behaviour must be verified before turning on `elovia_native_paywall`.
- Google: a payments profile now exists, but BillDesk cross-border verification is pending. Owner identity/device/phone verification and store publication requirements are not completed by source-code work. No financial-account opening, contract acceptance or KYC submission was performed.
- Backend: the last tested Railway deployment reports **Database migrations are current**, then stops at **RevenueCat configuration is invalid**. With owner approval, the existing RevenueCat V1 server key and a new privacy-hashing secret were securely staged in Railway along with six entitlement/product/environment/read-mode variables. **Eight changes remain staged, not applied.** Coaching has no store products and is explicitly disabled through an empty product mapping; Pro still requires a nonempty allowlist. Production also needs an owner-supplied monitored `SAFETY_CONTACT_EMAIL` and authorized moderator Firebase UID(s). Do not invent these or bypass the startup checks. The backend is **not restored yet**, so legal pages, webhook delivery and end-to-end paid access are not verified.
- Production hardening history has been integrated into the feature source, preserving incoming account storage, OAuth, migrations, moderation and billing reconciliation. The existing Android APK predates the consolidation. A fresh signed build and device testing are still required before release.

## No-paid-provider video decision

The owner declined paid providers. No MuscleWiki or other paid account will be purchased. YMove's free pack explicitly permits commercial in-app use with no payment or account: <https://ymove.app/free-exercise-videos>. Eighteen exact-movement clips were integrated through public free streaming endpoints, with attribution and a reproducible metadata importer. No videos are redistributed as a standalone media library. Full coverage still requires free rights-cleared clips for each remaining movement or reviewed original recordings.

Repos claiming hundreds of free videos without verifiable ownership, paid evaluation-only media and unreviewed SVG animations were not accepted as licensed, correct production demos. Details: `EXERCISE-CATALOGUE.md`.
- Old EAS Android artifact downloads returned HTTP 404. Use the fresh artifact below instead; BillDesk acceptance of a pre-release APK is not guaranteed.
- Store screenshots, accurate privacy/data-safety disclosures, live support/privacy/terms pages, a tested signed build and review metadata are release prerequisites. No app-store submission or publication is claimed.

## Consolidated build attempts

- Source consolidation pushed as `dd9e52b`, with a database-only annual-trial fixture correction in `8f59ee6`. Do not equate a pushed commit or a running CI job with a passed release gate. A stale integration assertion still expected an expired account-age trial; it now expects free access with no trial date. The prior slow CI run was requested to cancel. CI concurrency cancels superseded runs on the same branch.
- CI for `319ff00` passed on PostgreSQL 14, 16 and 18: <https://github.com/yash06111997/Elovia/actions/runs/37313275352>. The actual earlier stall was AI accounting fixtures still relying on automatic account-age trials. They now seed canonical annual store trials, and a new regression verifies unsubscribed new accounts receive 402 without provider calls. This pass predates the free-video addition; the latest source must pass CI separately before promotion.
- Fresh Android preview build `211cb3fb-99a4-4626-8747-3afef64606d7` was submitted successfully from `dd9e52b`, using the existing keystore. Last checked **IN_QUEUE**, no installation artifact yet: <https://expo.dev/accounts/yash06111997/projects/elovia-claude/builds/211cb3fb-99a4-4626-8747-3afef64606d7>. This build does not contain the subsequent free-video addition; do not label it the latest source.
- iOS production build setup was attempted with existing credentials frozen. EAS reported **Credentials are not set up; run again in interactive mode**. A distribution certificate was found but a usable provisioning setup was not. No signed iOS build was queued and no IPA/TestFlight release is claimed. Owner must complete the interactive Apple signing/2FA flow; do not retrieve passwords from browser storage or create replacement signing credentials silently.

## Merchant onboarding

Fresh Android test build: <https://expo.dev/accounts/yash06111997/projects/elovia-claude/builds/8cd28021-9fe6-4d1b-a480-e8ffd6a910a4>.
Verified APK: <https://expo.dev/artifacts/eas/dT4p0DZRn-4FcRKImHxOzREu-HUZqscPqjEgbh5JH9g.apk>.
Production CI: <https://github.com/yash06111997/Elovia/actions/runs/37279734088>.

Google's primary guidance says BillDesk KYC is separate from Google's account verification and is required before new Indian merchants sell to users outside India: <https://support.google.com/paymentscenter/answer/7421525?hl=en-IN>.

Use app name **Elovia** and a real accessible Android APK or published listing as requested by BillDesk. Do not substitute an iOS installation link, private console URL, unavailable Railway backend, or invented public Play listing. BillDesk decides whether a pre-release APK is sufficient. If it insists on a live listing, the owner should ask BillDesk how to complete verification for an unpublished app while preparing a free release. Identity, bank, tax and legally binding steps remain owner-controlled.

See `REGIONAL-PRICING.md`, `EXERCISE-CATALOGUE.md` and `FITNESS-REVIEW-RESEARCH-2026-10-05.md` for source provenance and remaining limitations.
