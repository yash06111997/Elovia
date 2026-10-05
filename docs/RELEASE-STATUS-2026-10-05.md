# Elovia delivery and release status — 5 October 2026

## Implemented in source

- 1,832 exercise entries after merging 166 curated entries with two imported sources; preserved curated exercise IDs. Combined muscle/equipment search and sorting, and equipment-constrained browsing.
- 46 entries have reusable source videos with a roughly ten-second playback loop. 873 entries have source images. Every exercise has a video/photo/written-guide fallback, but **not every exercise has a video**. Full video coverage needs licensed clips; none were purchased or fabricated.
- Live trophy/confetti personal records for weight, reps, set volume, exercise sets/reps/volume and workout sets/reps/volume. Warmups and incomplete/invalid sets do not establish records. Ties do not replay celebrations. Reduced-motion and screen-reader feedback are included.
- Per-muscle history charts, session comparisons, and individual exercise sets/reps/volume; primary-muscle attribution prevents inflating totals by counting each set for several muscles.
- Onboarding expanded from seven to thirteen pages. New training, schedule, priorities, consistency, food-routine and recovery preferences are stored and shown in the plan preview. Existing features were not removed.
- Annual-only 14-day introductory-offer policy, monthly paid base-plan purchase handling, restore/access synchronization and native RevenueCat Paywall integration with a local fallback. Account-age-based free access was removed. Native paywall activation is separately gated by offering metadata.
- Review-driven background/relaunch-safe workout timing, restored draft sets, clearer historical PR labels, compound-first equipment-aware local plans, completed-workout CSV export, and direct store subscription-management links.
- Localized storefront prices and currency-aware annual monthly-equivalent display. Price selection belongs to Apple/Google storefronts, not GPS/IP or currency-symbol parsing.

## Verification

- Mobile TypeScript: passed.
- Mobile Jest: 21 tests, 9 suites passed.
- Root regression tests: 27 passed.
- API TypeScript and production build: passed during implementation.
- iOS and Android Metro/Hermes exports: passed. These are JavaScript exports, **not signed IPA/APK builds or real-device testing**.
- A fresh signed Android preview APK from feature commit `b03b810` subsequently finished on EAS. Build `8cd28021-9fe6-4d1b-a480-e8ffd6a910a4`; the artifact URL returned HTTP 200 (139,775,880 bytes). This is an internal test APK, not a production Play AAB or an App Store build.
- Production recovery commit `d673ee3` passed GitHub CI against PostgreSQL 14, 16 and 18, including database-backed checks. The migration compatibility regression preserves rejection of nullable/unvalidated or unrelated missing constraints; no data reset or safety-check bypass was used.
- Maestro flow updated for thirteen onboarding pages; not run on a device.
- Real-device GPS/background recording, video codecs, purchases/restores, screen-reader and reduced-motion behaviour still need device testing.

## Dashboard work and blockers

- Apple: created `Elovia Pro` subscription group and `elovia_pro_yearly` (one year). Saved US $29.99/year and India ₹1,499/year; other territories use Apple's generated equivalent tiers. Annual upfront availability selected for all current territories. Saved and verified a free two-week introductory offer starting 5 October 2026 with no end date across 175 territories. This is a draft, not approved or purchasable. Monthly product and verified purchase testing remain unfinished.
- RevenueCat: created an Elovia Pro native paywall draft on the existing default offering with dynamic prices, monthly no-trial copy, restore and continue-free controls. It remains **unpublished**; conditional trial rendering and real-device behaviour must be verified before turning on `elovia_native_paywall`.
- Google: a payments profile now exists, but BillDesk cross-border verification is pending. Owner identity/device/phone verification and store publication requirements are not completed by source-code work. No financial-account opening, contract acceptance or KYC submission was performed.
- Backend: configured API-only monorepo build/start commands on the existing Railway production service. Fixed legacy baseline adoption for PostgreSQL 18 metadata on production branch `feat/elovia-p0-integrity`, preserving its prior hardening. The tested recovery deployment now reports **Database migrations are current**, then stops at **RevenueCat configuration is invalid**. Railway has only `REVENUECAT_WEBHOOK_SECRET`; its server API key, privacy-hashing secret, entitlement/product mappings and environment/read mode variables are absent. Secure credential transfer requires owner approval. The public health URL still returns HTTP 404; the backend is **not restored yet**. Do not bypass the configuration guard or publish a backend-dependent app until repaired.
- The new feature branch and production hardening branch have diverged. Consolidate both without losing either set of changes, then rebuild and test before store release. The new Android APK contains the feature branch, not the consolidated production hardening branch.
- Old EAS Android artifact downloads returned HTTP 404. Use the fresh artifact below instead; BillDesk acceptance of a pre-release APK is not guaranteed.
- Store screenshots, accurate privacy/data-safety disclosures, live support/privacy/terms pages, a tested signed build and review metadata are release prerequisites. No app-store submission or publication is claimed.

## Merchant onboarding

Fresh Android test build: <https://expo.dev/accounts/yash06111997/projects/elovia-claude/builds/8cd28021-9fe6-4d1b-a480-e8ffd6a910a4>.
Verified APK: <https://expo.dev/artifacts/eas/dT4p0DZRn-4FcRKImHxOzREu-HUZqscPqjEgbh5JH9g.apk>.
Production CI: <https://github.com/yash06111997/Elovia/actions/runs/37279734088>.

Google's primary guidance says BillDesk KYC is separate from Google's account verification and is required before new Indian merchants sell to users outside India: <https://support.google.com/paymentscenter/answer/7421525?hl=en-IN>.

Use app name **Elovia** and a real accessible Android APK or published listing as requested by BillDesk. Do not substitute an iOS installation link, private console URL, unavailable Railway backend, or invented public Play listing. BillDesk decides whether a pre-release APK is sufficient. If it insists on a live listing, the owner should ask BillDesk how to complete verification for an unpublished app while preparing a free release. Identity, bank, tax and legally binding steps remain owner-controlled.

See `REGIONAL-PRICING.md`, `EXERCISE-CATALOGUE.md` and `FITNESS-REVIEW-RESEARCH-2026-10-05.md` for source provenance and remaining limitations.
