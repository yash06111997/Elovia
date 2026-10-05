# Fitness-app feedback translated into Elovia work

Reviewed 2026-10-05. This is a targeted qualitative sample, not an exhaustive review scrape, statistical ranking, or proof that all users experience a problem. Store reviews may be older than the current app version. Self-promotional Reddit comments and third-party review-count analyses are not treated as verified product evidence.

## Sources and implementation crosswalk

| Source / reported friction | Elovia response in this change | Coverage boundary |
| --- | --- | --- |
| [Fitbod Reddit discussion and comments](https://www.reddit.com/r/fitbod/comments/1jpeeko/i_stopped_trusting_fitbod_with_my_fitness_journey/): exercise selection, order, weight suggestions and inability to move existing history | Broader searchable catalogue; actual equipment requirements; compound-first local plan ordering; unrated source exercises kept out of automatic plans; CSV export of completed device workouts | CSV import and cross-exercise load prediction not implemented. No claims of medical suitability or coach-level AI. |
| [Fitbod Google Play reviews](https://play.google.com/store/apps/details?hl=en-US&id=com.fitbod.fitbod): unsuitable replacements, equipment/weight limits and difficult-to-find workout detail | Muscle/equipment sorting; expanded equipment choices; visible exercise demos/instructions; previous-session sets plus per-muscle detail | Maximum owned weights and injury-specific substitutions remain future work; injury text alone cannot certify an exercise safe. |
| [Fitbod US App Store reviews](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543): PR discovery, restricted navigation during workouts | Live non-blocking trophy/confetti; progress PR list; draft set restoration and a persisted wall-clock timer across screen changes | Apple Watch app not added. Native navigation still needs device QA. |
| [MyFitnessPal Google Play reviews](https://play.google.com/store/apps/details?hl=en&id=com.myfitnesspal.android): recipe saves, diary responsiveness and support | Existing macro/run regression tests retained; local catalogue and workout export do not need a server; no falsely acknowledged trial/access | Did not claim a new recipe engine or nutrition database accuracy audit. |
| [MyFitnessPal subscription report](https://www.reddit.com/r/Myfitnesspal/comments/1vyhkfw/customer_service_sucks_think_im_done_with_this/): paid access unexpectedly absent | Firebase identity bound before RevenueCat purchase; explicit purchase/restore errors; server access confirmation; direct store subscription management link | Real sandbox buy/restore/cancel and webhook delivery still require store-ready accounts. |
| [Strava discussion and comments](https://www.reddit.com/r/Strava/comments/1uck6xw/the_app_has_gone_from_extremely_consistent_to/): partial/lost background activity; other commenters report no issue | Existing run history/map fallback and run regression checks preserved. Workout timer changed from counting callbacks to persisted wall-clock time; legacy drafts supported | No claim of fixing every device's GPS, Watch syncing, or all OS background constraints. Needs an outdoor real-device recording test. |
| [Hevy Apple App Store reviews](https://apps.apple.com/be/app/hevy-gym-tracker-workout-log/id1458862350?platform=iphone&see-all=reviews): discoverable previous performance and logs | Previous working-set detail, separate weight/rep bests, muscle session charts, unlimited future workout history retention | Deleted Reddit post about Hevy slow sync found in search was excluded as current corroborated evidence. |

## Reliability and billing decisions

- Workout logging, PR celebrations, CSV export and the new muscle charts are not presented as paid-only when their implementation is free.
- Completing and undoing planned sets both persist; reopening the logger waits for draft loading before creating a session.
- Warm-up and invalid sets do not inflate working-set charts or new PRs. Weight and rep maxima are displayed separately, not as an invented paired set.
- Annual trial is exactly 14 days, subject to store eligibility. Monthly gets no free trial. No premium grant based on account age or local client data.
- Restore and cancel are different actions. Manage Subscription opens the store's subscription settings, including during a trial.
- Regional prices use store country/currency, not GPS, nationality or a hardcoded currency symbol. See REGIONAL-PRICING.md.
- No feature removal or simplified daily-action navigation; onboarding increased from 7 to 13 pages.

## Follow-on gates, not claimed complete

Full exercise-video coverage requires licensed/owned content. Watch apps, maximum equipment loads, provider-specific CSV imports, robust bidirectional conflict resolution, injury-specific exercise selection and a nutrition source-quality audit are substantial separate features. Implementing them blindly from isolated complaints would introduce safety, licensing or data-loss risks. A new native build and real-device QA are required for the added video module.
