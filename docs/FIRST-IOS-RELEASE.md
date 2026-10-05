# Elovia: first iOS release and RevenueCat setup

Live-console inspection: 5 October 2026. This is a release checklist, not a claim that the app or subscriptions are published.

## Correct app identity

| Setting | Value |
| --- | --- |
| App Store Connect app | Elovia, Apple ID `6761459117` |
| iOS bundle identifier | `app.replit.elovia` |
| Android package (unchanged) | `com.elovia.app` |
| EAS project | `33537f25-269e-4984-8e51-61732be32a64` |
| RevenueCat project | Elovia, `265e34c7` |
| RevenueCat iOS app | `app79ce9a5ade` |
| Subscription group | Elovia Pro, `22441484` |
| Entitlement identifier | `Elovia Pro` (including the space) |
| Offering | `default` |

The existing Apple app and RevenueCat both use `app.replit.elovia`. The source previously used a different iOS bundle. It is now aligned with the existing Apple record; do not create a second Apple app or rename its products to work around the mismatch. Signing must use this exact iOS bundle. Android remains separate.

## 1. Choose a support inbox and moderator account — owner

You do not need a custom domain. Create a support Gmail inbox, or explicitly approve an existing inbox you regularly check for public support/privacy/safety enquiries. Do not list an address that you cannot receive mail at. Apple also needs a support **webpage URL**, not just an email address.

Sign into Elovia using the account you want to operate moderation. Provide its login email and explicitly authorize moderator access. In the correct Firebase project, Authentication → Users → that account exposes its UID. `MODERATOR_USER_IDS` requires the Firebase UID, **not the email address**. Do not grant this role to a review/test account.

These choices are currently missing; they were not invented or published for you.

## 2. Restore the backend — developer after step 1

Railway production has eight staged billing changes that still need applying. Add the approved `SAFETY_CONTACT_EMAIL` and authorized Firebase UID(s) in `MODERATOR_USER_IDS`, apply the staged changes, and verify the deployment's startup logs and `/api/healthz`. Do not reset the database, bypass production checks, or expose server keys in the mobile app.

The configured domain is `https://elovia-production.up.railway.app`. Its availability must be rechecked before using it in a listing. Existing source routes are:

- Privacy: `/api/legal/privacy`
- Terms: `/api/legal/terms`
- Account-deletion page: `/api/legal/account-deletion`
- Community standards/safety contact: `/api/legal/community-standards`
- RevenueCat webhook: `/api/webhooks/revenuecat`

Publish an actual support page with the chosen contact and verify all public legal/support links return readable pages without login. The privacy notice must accurately reflect final data flows. Do not submit a dead domain or a private console link as your Support URL.

RevenueCat's Apple-notification endpoint and Elovia's RevenueCat webhook are **different** integrations. Apple sends store events to RevenueCat; RevenueCat sends authenticated billing events to Elovia. Complete the latter only with a working backend and a securely configured matching webhook authorization value. Test receipt reconciliation, cancellation, expiry and refunds before release.

## 3. Complete Apple's business requirements — owner

Open App Store Connect → **Business**. Review the Paid Apps Agreement and complete the requested tax and banking details yourself. Check it becomes Active. This is required for in-app purchases, even though downloading Elovia can be free. Do not paste bank details, tax IDs, passwords or OTPs into chat.

Review the current EU trader/non-trader status against your actual business circumstances; the account currently says non-trader. Complete any applicable contact verification yourself. Do not make an inaccurate declaration to clear a warning. Review Apple's content-rights, encryption and regulated-medical-device declarations before submitting.

Google Play/BillDesk cross-border verification is a separate Android requirement; do not treat it as an Apple checkout prerequisite. [Apple's purchase configuration requirements](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/).

## 4. Check subscriptions and RevenueCat — developer

| Plan | Apple product ID | Apple product record | RC package | Trial | Previously saved US / India pricing |
| --- | --- | --- | --- | --- | --- |
| Monthly | `elovia_pro_monthly` | `6819204530` | `$rc_monthly` | None | $4.99 / ₹199 per month |
| Yearly | `elovia_pro_yearly` | `6819165714` | `$rc_annual` | Two weeks, store-eligible users only | $29.99 / ₹1,499 per year |

Pricing is selected by the user's storefront, not GPS or IP. Other territories currently use Apple's generated tiers; a complete purchasing-power study for every country is not claimed. Verify current price rows and the annual introductory offer before release.

The group English (US) name is Elovia Pro. Monthly and yearly should offer the **same service level**, because the benefits are the same. The last group inspection showed yearly Level 1 and monthly Level 2; the attempted UI reorder did not save. Before submission, fix this in Subscriptions → Elovia Pro → Edit/Edit Level and verify both appear under the same level. [Apple's subscription levels guidance](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information).

RevenueCat → Apps → Elovia iOS already has **Valid credentials** for both its In-App Purchase key and App Store Connect API key. Do not generate replacement keys unnecessarily. Apple production and sandbox notification URLs were applied through this existing integration and then verified in Apple's App Information screen. No notification delivery is proven until a test transaction occurs.

RevenueCat → Product catalog:

1. Products: confirm both iOS products exist for Elovia iOS and are attached to entitlement `Elovia Pro`.
2. Entitlements: verify exact identifier `Elovia Pro`, not a display-name-only match.
3. Offerings → `default`: iOS `$rc_monthly` is mapped to `elovia_pro_monthly` and `$rc_annual` to `elovia_pro_yearly`; both mappings were inspected live.
4. The catalogue also contains a legacy lifetime package. No new lifetime Apple product was created in this workflow; do not advertise it in this two-plan launch paywall.

[RevenueCat entitlements](https://www.revenuecat.com/docs/getting-started/entitlements), [offerings](https://www.revenuecat.com/docs/offerings/overview), [Apple purchase keys](https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration).

## 5. Complete signing and build a real iOS binary — owner + developer

Being signed into Apple in Chrome does not authenticate Apple's separate EAS CLI signing flow. A previous non-interactive build attempt found incomplete provisioning; it did **not** create a signed IPA. The bundle alignment also means old credentials for `com.elovia.app` cannot sign this Apple record.

In PowerShell, run:

```powershell
Set-Location -LiteralPath 'C:\Users\HP\Downloads\Health-Hub (1)\Health-Hub\artifacts\mobile'
npx --yes eas-cli whoami
npx --yes eas-cli credentials --platform ios
```

Select the production profile, sign into the correct Apple team when asked, and complete two-factor authentication yourself in the terminal. Confirm the identifier is `app.replit.elovia`. Use a valid existing distribution certificate when available; create the missing provisioning profile through the interactive signing flow. Do not revoke certificates used by other apps.

Then:

```powershell
npx --yes eas-cli build --platform ios --profile production
```

Wait for EAS to report **Finished** and an IPA artifact. An exported JavaScript bundle, queued job, APK or QR image is not an iOS build.

Upload the successful production iOS build:

```powershell
npx --yes eas-cli submit --platform ios --profile production
```

Select the just-finished iOS build. `eas.json` now pins submission to Apple app ID `6761459117`. Complete any Apple authentication required by submission yourself. Uploading through EAS Submit sends a build to App Store Connect/TestFlight; it does **not** publish the app. [Expo signing](https://docs.expo.dev/app-signing/managed-credentials/), [iOS submission](https://docs.expo.dev/submit/ios/).

## 6. Install with TestFlight and test purchases — owner + developer

App Store Connect → Elovia → TestFlight → wait for build processing. Complete accurate export-compliance answers if asked. Add an internal tester permitted by your Apple team; external testing may require Beta App Review. Open the TestFlight invitation on the iPhone, install Apple's TestFlight app and then Elovia. TestFlight/sandbox purchases do not charge real money, but confirm you are testing the TestFlight build, not a production App Store installation.

Verify on a real iPhone:

- Apple sign-in, onboarding and backend connection.
- Workout recording, live PR feedback, charts, macros, demos and background GPS.
- Local storefront prices load; monthly shows no trial; only an eligible annual user sees the 14-day offer.
- A sandbox purchase unlocks `Elovia Pro` in RevenueCat **and** the Elovia server.
- Restore Purchases after reinstall works; switching Elovia accounts never exposes another account's access or data.
- Ineligible annual users see a paid annual purchase, not a false free-trial promise.
- Cancellation, expiry, refunds, offline handling and account deletion behave correctly.

Capture genuine iPhone screenshots of the tested app and paywall. Do not use mockups that misrepresent functionality.

## 7. Finish and activate the RevenueCat-hosted paywall — developer

The Elovia Pro native paywall draft is attached to `default`, but remains **unpublished**. The integrated local paywall is the fallback. For the remote draft:

1. Show monthly and annual packages with dynamic store-provided prices and periods.
2. Render free-trial language only for an eligible annual package. Monthly and ineligible annual purchases need non-trial text/CTA.
3. Include Restore Purchases, Continue Free, reachable privacy/terms links and accurate renewal/cancellation disclosure.
4. Preview on the actual signed app and repeat purchase/restore tests.
5. Only after passing, publish the draft and set `default` offering metadata `elovia_native_paywall` to boolean `true` (not a string). The app deliberately will not activate the remote draft before this flag.

Do not use a hard-coded price or promise every user gets a trial. Native remote activation and proven end-to-end payments remain unfinished.

## 8. Finish App Store metadata — owner + developer

App Information: Elovia; subtitle “Workouts, nutrition & progress”; primary category Health & Fitness. These were saved live.

Version 1.0: a grounded description, promotional text and keywords were saved and verified after leaving and reopening the page. Manual release was also verified as selected. The annual benefit description and trial/no-trial review notes were saved separately. Still complete:

- Live Support URL and Privacy Policy URL; include terms/privacy links in app/paywall and store description where required.
- Actual copyright owner/entity, not an invented company.
- Genuine screenshots in Apple's accepted iPhone sizes. The inspected form currently asks for 1242×2688 or 1284×2778 portrait screenshots (or their landscape equivalents); confirm the current Media Manager requirements when uploading.
- App Privacy disclosures covering actual account, health/fitness, location, user content, purchases, diagnostics and third-party AI/SDK data flows. Do not choose “Data Not Collected” for this app.
- Age-rating questionnaire, including wellness content and real Community/user-generated-content capabilities. Review any minimum-age restrictions against the implemented app.
- A working, non-personal review account; owner enters its credentials directly into Apple's review form. It must let Apple test the submitted functionality without contacting you or completing an OTP challenge.
- App Review contact name, monitored email and reachable phone number, entered by the owner.
- Review notes explaining where to find the paywall and how annual trial eligibility differs from monthly.
- A real paywall screenshot for **each** subscription's Review Information, not just the store listing screenshots.
- Select the processed, tested build under Version 1.0 → Build.

The app and both subscriptions currently say **Prepare for Submission**; no Apple approval is claimed.

## 9. Submit app, group and subscriptions together — owner final review

For this first subscription release, add the app version, Elovia Pro subscription group and both monthly/yearly subscriptions to the **same** App Review submission. Apple's current UI uses **Add for Review** and a submission list. Check all items are present, clear required-field warnings, then review the final submission yourself. Do not submit subscriptions alone or publish a free version first merely to create the paywall.

After Apple's approval, manually release Version 1.0. Test the live listing and a production purchase with clear awareness it is a real charge. Track support, crashes and billing reconciliation after launch. Apple controls processing/review time; no fixed approval deadline is promised.

[Apple's first-subscription submission instructions](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase).

## Immediate information needed

1. Which monitored inbox may be published as support/privacy/safety?
2. Which existing Elovia account may be granted moderator access? Explicit authorization is needed before granting that role.
3. Complete Apple signing/2FA interactively and owner-controlled banking/tax/legal declarations when prompted.

Never send passwords, OTPs, private keys, bank details or tax IDs in chat.
