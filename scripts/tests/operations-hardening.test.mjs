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

test("telemetry is allowlisted, privacy-safe, rate-limited, and connected to crash reporting", async () => {
  const api = await source("artifacts/api-server/src/routes/telemetry.ts");
  const client = await source("artifacts/mobile/lib/telemetry.ts");
  const root = await source("artifacts/mobile/app/_layout.tsx");

  assert.match(api, /ALLOWED_EVENTS/);
  assert.match(api, /rateLimit/);
  assert.match(api, /res\.sendStatus\(204\)/);
  assert.doesNotMatch(api, /req\.body\.message/);
  assert.match(client, /reportClientError/);
  assert.doesNotMatch(client, /error\.message/);
  assert.match(root, /onError=\{reportClientError\}/);
});

test("release safeguards include CI, database readiness, and Railway readiness checks", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  const health = await source("artifacts/api-server/src/routes/health.ts");
  const railway = await source("railway.json");

  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm typecheck/);
  assert.match(workflow, /--filter @workspace\/mobile typecheck/);
  assert.match(workflow, /--filter @workspace\/api-server typecheck/);
  assert.match(workflow, /@workspace\/api-server run build/);
  assert.match(health, /router\.get\("\/readyz"/);
  assert.match(health, /select 1/);
  assert.equal(JSON.parse(railway).deploy.healthcheckPath, "/api/readyz");
});

test("Maestro covers the seven-step onboarding preview and workout feedback", async () => {
  const onboarding = await source("e2e/maestro/onboarding-preview.yaml");
  const workout = await source("e2e/maestro/workout-feedback.yaml");
  const readme = await source("e2e/README.md");

  assert.match(onboarding, /appId: com\.elovia\.app/);
  assert.match(onboarding, /Create my plan/);
  assert.match(onboarding, /Your plan is ready/);
  assert.match(workout, /Post-workout check-in/);
  assert.match(workout, /Save workout feedback/);
  assert.match(readme, /maestro test/);
});

test("Metro adds the workspace without discarding Expo default watch folders", async () => {
  const metro = await source("artifacts/mobile/metro.config.js");
  assert.match(metro, /\.\.\.\(config\.watchFolders \|\| \[\]\)/);
  assert.doesNotMatch(metro, /config\.watchFolders = \[workspaceRoot\]/);
});

test("known vulnerable runtime and build dependencies are pinned to patched releases", async () => {
  const workspace = await source("pnpm-workspace.yaml");

  assert.match(workspace, /drizzle-orm: \^0\.45\.2/);
  assert.match(workspace, /protobufjs@>=7 <7\.6\.5/);
  assert.match(workspace, /shell-quote@>=1\.1\.0 <1\.9\.0/);
  assert.match(workspace, /websocket-driver@>=0\.7\.0 <0\.7\.5/);
  assert.match(workspace, /path-to-regexp@>=8\.0\.0 <8\.4\.0/);
});
