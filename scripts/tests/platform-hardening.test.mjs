import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

async function source(relativePath) {
  try {
    return await readFile(new URL(relativePath, repositoryRoot), "utf8");
  } catch {
    return "";
  }
}

test("mobile premium access comes from the authenticated server entitlement", async () => {
  const subscriptionContext = await source(
    "artifacts/mobile/context/SubscriptionContext.tsx",
  );

  assert.match(subscriptionContext, /fetchEntitlement/);
  assert.match(subscriptionContext, /refreshEntitlement/);
  assert.doesNotMatch(subscriptionContext, /AsyncStorage/);
  assert.doesNotMatch(subscriptionContext, /clearTrial/);
  assert.doesNotMatch(subscriptionContext, /isTrialActiveLocal/);
});

test("the paywall never creates or clears a client-side trial", async () => {
  const paywall = await source("artifacts/mobile/app/paywall.tsx");

  assert.match(paywall, /await startTrial\(\)/);
  assert.doesNotMatch(paywall, /clearTrial/);
  assert.doesNotMatch(paywall, /trialUsed/);
  assert.match(paywall, /waitForServerAccess/);
  assert.match(paywall, /Sign in to Start Trial or Subscribe/);
});

test("authentication does not duplicate Firebase credentials in app-owned storage", async () => {
  const auth = await source("artifacts/mobile/lib/auth.tsx");
  assert.doesNotMatch(auth, /AUTH_TOKEN_KEY/);
  assert.doesNotMatch(auth, /storedToken/);
  assert.doesNotMatch(auth, /AsyncStorage/);
  assert.match(auth, /onAuthStateChanged/);
});

test("OAuth uses cryptographic state, trusted popup origins, and escaped errors", async () => {
  const mobileAuth = await source("artifacts/mobile/lib/auth.tsx");
  const serverAuth = await source("artifacts/api-server/src/routes/auth.ts");

  assert.match(mobileAuth, /Crypto\.randomUUID\(\)/);
  assert.doesNotMatch(mobileAuth, /Math\.random\(\)/);
  assert.match(mobileAuth, /event\.origin !== expectedOrigin/);
  assert.match(serverAuth, /function escapeHtml/);
  assert.doesNotMatch(serverAuth, /postMessage\([\s\S]*?}, '\*'\)/);
  assert.match(serverAuth, /returnUrl\.includes\("#"\) \? "&" : "#"/);
});

test("authenticated users can export and permanently delete their account data", async () => {
  const privacyRoutes = await source(
    "artifacts/api-server/src/routes/privacy.ts",
  );
  const serverAuth = await source("artifacts/api-server/src/lib/auth.ts");
  const deletionState = await source(
    "artifacts/api-server/src/lib/accountDeletion.ts",
  );

  assert.match(
    privacyRoutes,
    /router\.get\(\s*"\/privacy\/export",\s*requireAuth/,
  );
  assert.match(privacyRoutes, /router\.delete\(\s*"\/account",\s*requireAuth/);
  assert.match(privacyRoutes, /tombstoneAndDeleteAccountData/);
  assert.match(privacyRoutes, /deleteFirebaseUser/);
  assert.match(deletionState, /accountDeletionTombstonesTable/);
  assert.match(deletionState, /pg_advisory_xact_lock/);
  assert.match(deletionState, /transaction\.delete\(usersTable\)/);
  assert.match(privacyRoutes, /Content-Disposition/);
  assert.match(privacyRoutes, /Cache-Control", "no-store"/);
  assert.match(serverAuth, /auth\/user-not-found/);
});

test("the mobile app exposes privacy, terms, export, and deletion controls", async () => {
  const privacyScreen = await source("artifacts/mobile/app/privacy-data.tsx");
  const rootLayout = await source("artifacts/mobile/app/_layout.tsx");
  const profile = await source("artifacts/mobile/app/(tabs)/profile.tsx");

  assert.match(rootLayout, /name="privacy-data"/);
  assert.match(profile, /Privacy & Data/);
  assert.match(privacyScreen, /Export My Data/);
  assert.match(privacyScreen, /Delete My Account/);
  assert.match(privacyScreen, /Privacy Notice/);
  assert.match(privacyScreen, /Terms of Use/);
  assert.match(privacyScreen, /Sharing\.shareAsync/);
  assert.match(privacyScreen, /FileSystem\.writeAsStringAsync/);
});
