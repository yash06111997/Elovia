import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const mobileRoot = path.join(repoRoot, "artifacts", "mobile");

function read(relativePath) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
}

test("iOS release configuration enables native Sign in with Apple", () => {
  const manifest = JSON.parse(read("package.json"));
  const appConfig = JSON.parse(read("app.json")).expo;
  const pluginNames = appConfig.plugins.map((plugin) =>
    Array.isArray(plugin) ? plugin[0] : plugin,
  );

  assert.equal(
    typeof manifest.dependencies?.["expo-apple-authentication"],
    "string",
  );
  assert.equal(appConfig.ios.usesAppleSignIn, true);
  assert.ok(pluginNames.includes("expo-apple-authentication"));
});

test("Apple identity tokens are redeemed through Firebase with a bound raw nonce", () => {
  const source = `${read("lib/auth.tsx")}\n${read("lib/appleSignIn.ts")}`;

  assert.match(source, /new OAuthProvider\(["']apple\.com["']\)/);
  assert.match(source, /AppleAuthentication\.signInAsync\(/);
  assert.match(source, /identityToken/);
  assert.match(source, /nonce:\s*hashedNonce/);
  assert.match(source, /rawNonce/);
  assert.match(source, /loginWithApple/);
});

test("every mobile sign-in entry preserves an Apple provider choice on iOS", () => {
  assert.match(read("app/auth.tsx"), /AppleSignInButton/);
  assert.match(read("app/onboarding/index.tsx"), /AppleSignInButton/);

  for (const relativePath of ["app/paywall.tsx", "app/profile-details.tsx"]) {
    const source = read(relativePath);
    assert.match(
      source,
      /router\.(?:push|navigate)\(["']\/auth["']\)/,
      `${relativePath} must open the provider-choice screen instead of starting Google directly`,
    );
  }
});
