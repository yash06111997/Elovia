import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../../", import.meta.url);
const onboardingSource = await readFile(
  new URL("artifacts/mobile/app/onboarding/index.tsx", repositoryRoot),
  "utf8",
);
const workspaceConfig = await readFile(
  new URL("pnpm-workspace.yaml", repositoryRoot),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("package.json", repositoryRoot), "utf8"),
);
const mockupViteConfig = await readFile(
  new URL("artifacts/mockup-sandbox/vite.config.ts", repositoryRoot),
  "utf8",
);

function assertSource(pattern, message) {
  assert.ok(pattern.test(onboardingSource), message);
}

test("onboarding resets the form scroll position whenever the step changes", () => {
  assertSource(/ref=\{scrollRef\}/, "ScrollView should use the resettable ref");
  assertSource(
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?scrollRef\.current\?\.scrollTo\(\{\s*y:\s*0,\s*animated:\s*false\s*\}\)[\s\S]*?\},\s*\[step\]\)/,
    "Step changes should reset the form to the top",
  );
});

test("onboarding exposes semantic names, roles, and states for its controls", () => {
  assertSource(
    /accessibilityRole="progressbar"/,
    "Progress needs a progressbar role",
  );
  assertSource(
    /aria-valuenow=\{step \+ 1\}/,
    "Progress needs its current numeric value",
  );
  assertSource(/accessibilityRole="button"/, "Actions need button roles");
  assertSource(
    /accessibilityRole="radio"/,
    "Single-choice options need radio roles",
  );
  assertSource(
    /accessibilityRole="checkbox"/,
    "Multi-choice options need checkbox roles",
  );
  assertSource(
    /accessibilityState=\{\{\s*checked:/,
    "Checkboxes need checked state",
  );
  assert.equal(
    (onboardingSource.match(/accessibilityState=\{\{\s*checked:/g) ?? [])
      .length >= 5,
    true,
    "Every radio and checkbox group needs checked state",
  );
  assert.equal(
    (onboardingSource.match(/aria-checked=\{/g) ?? []).length >= 5,
    true,
    "Web radio and checkbox controls need explicit checked state",
  );
  assert.doesNotMatch(
    onboardingSource,
    /accessibilityState=\{\{\s*selected:/,
    "Radio controls must expose checked state instead of the unsupported selected state",
  );
  assertSource(
    /accessibilityLabel=\{`Decrease \$\{label\}`\}/,
    "Stepper decrement buttons need names",
  );
  assertSource(
    /accessibilityLabel=\{`Increase \$\{label\}`\}/,
    "Stepper increment buttons need names",
  );
});

test("workspace installs the native Windows x64 packages required for local development", () => {
  for (const packageName of [
    "esbuild>@esbuild/win32-x64",
    "lightningcss>lightningcss-win32-x64-msvc",
    "@tailwindcss/oxide>@tailwindcss/oxide-win32-x64-msvc",
    "rollup>@rollup/rollup-win32-x64-msvc",
    "@expo/ngrok-bin>@expo/ngrok-bin-win32-x64",
  ]) {
    const escapedPackageName = packageName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    assert.equal(
      new RegExp(
        `^[ \\t]*["']?${escapedPackageName}["']?:[ \\t]*["']-["'][ \\t]*$`,
        "m",
      ).test(workspaceConfig),
      false,
      `${packageName} must not be disabled`,
    );
  }
});

test("the pnpm preinstall guard runs without a Unix shell", () => {
  assert.equal(packageJson.scripts.preinstall, "node ./scripts/preinstall.mjs");

  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../preinstall.mjs", import.meta.url))],
    {
      env: { ...process.env, npm_config_user_agent: "pnpm/10.33.0" },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
});

test("the mockup can build outside Replit without server-only environment variables", () => {
  assert.ok(
    /process\.env\.PORT \?\? "5173"/.test(mockupViteConfig),
    "Vite should use a local default port",
  );
  assert.ok(
    /process\.env\.BASE_PATH \?\? "\/"/.test(mockupViteConfig),
    "Vite should use a root base path by default",
  );
});
