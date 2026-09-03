import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(relativePath) {
  return readFile(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8",
  ).catch(() => "");
}

async function communitySafetyModule() {
  try {
    return await import("../../artifacts/api-server/src/lib/communitySafety.ts");
  } catch {
    return null;
  }
}

test("community publishing blocks contact details, links, and explicit threats", async () => {
  const safety = await communitySafetyModule();
  assert.ok(safety, "expected a community safety policy module");

  assert.deepEqual(safety.screenCommunityText("Strong run — new 5 km best!"), {
    allowed: true,
    text: "Strong run — new 5 km best!",
  });
  assert.equal(
    safety.screenCommunityText("Email me at athlete@example.com").code,
    "personal_contact",
  );
  assert.equal(
    safety.screenCommunityText("Message me on +1 (202) 555-0191").code,
    "personal_contact",
  );
  assert.equal(
    safety.screenCommunityText("See https://example.com/my-plan").code,
    "external_link",
  );
  assert.equal(
    safety.screenCommunityText("go kill yourself").code,
    "threatening_language",
  );
  assert.equal(safety.canTransitionReportStatus("queued", "reviewing"), true);
  assert.equal(safety.canTransitionReportStatus("reviewing", "actioned"), true);
  assert.equal(
    safety.canTransitionReportStatus("actioned", "reviewing"),
    false,
  );
  assert.equal(
    safety.canTransitionReportStatus("dismissed", "actioned"),
    false,
  );
});

test("community safety data is durable, constrained, and audit history is append-only", async () => {
  const migration = await source("lib/db/migrations/0008_community_safety.sql");
  const schema = await source("lib/db/src/schema/moderation.ts");

  for (const table of [
    "community_memberships",
    "content_reports",
    "moderation_audit_log",
    "ai_response_receipts",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }

  assert.match(migration, /community_membership_adult_attested/);
  assert.match(migration, /content_report_target_valid/);
  assert.match(migration, /content_report_status_valid/);
  assert.match(migration, /review_due_at/);
  assert.match(migration, /community_moderation_audit_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "moderation_audit_log"/);
  assert.match(
    migration,
    /COMMENT ON COLUMN "content_reports"\."content_snapshot" IS 'SENSITIVE:/,
  );
  assert.match(schema, /ai_response_receipt_expiry_valid/);
  assert.match(schema, /content_report_reason_valid/);
  assert.match(schema, /content_report_resolution_valid/);
});

test("social routes require Community acceptance and expose separate report and block controls", async () => {
  const route = await source("artifacts/api-server/src/routes/social.ts");
  const safetyRoute = await source("artifacts/api-server/src/routes/safety.ts");
  const mobile = [
    await source("artifacts/mobile/app/social.tsx"),
    await source("artifacts/mobile/components/CommunityAccessGate.tsx"),
  ].join("\n");
  const api = await source("artifacts/mobile/utils/api.ts");

  assert.match(route, /router\.get\(\s*"\/social\/access"/);
  assert.match(route, /router\.post\(\s*"\/social\/access\/accept"/);
  assert.match(route, /requireCommunityAccess/);
  assert.match(safetyRoute, /router\.post\(\s*"\/safety\/reports"/);
  assert.match(safetyRoute, /router\.get\(\s*"\/safety\/moderation\/reports"/);
  assert.match(
    safetyRoute,
    /router\.patch\(\s*"\/safety\/moderation\/reports\/:id"/,
  );
  assert.match(mobile, /Community Standards/);
  assert.match(mobile, /minimumAge/);
  assert.match(mobile, /Report post/);
  assert.match(mobile, /Block athlete/);
  assert.match(mobile, /challenge\.createdBy !== userId/);
  assert.match(api, /createdBy: string/);
  assert.match(api, /blockUser:/);
  assert.match(api, /report:/);
});

test("AI coach responses carry a reportable receipt without placing response text in the id", async () => {
  const aiRoute = await source("artifacts/api-server/src/routes/ai/index.ts");
  const safetyStore = await source(
    "artifacts/api-server/src/lib/communitySafetyStore.ts",
  );
  const coach = await source("artifacts/mobile/app/coach.tsx");
  const api = await source("artifacts/mobile/utils/api.ts");

  assert.match(aiRoute, /createAiResponseReceipt/);
  assert.match(aiRoute, /responseId/);
  assert.match(coach, /Report response/);
  assert.match(api, /responseId: string/);
  assert.match(api, /reportAiResponse/);
  assert.match(
    safetyStore,
    /async function cleanupExpiredAiResponseReceipts[\s\S]*?catch\s*\{/,
  );
});

test("Community Standards publish a configured safety contact and are linked from mobile", async () => {
  const legalRoute = await source("artifacts/api-server/src/routes/privacy.ts");
  const productionConfig = await source(
    "artifacts/api-server/src/lib/productionConfig.ts",
  );
  const environment = await source(".env.example");
  const gate = await source(
    "artifacts/mobile/components/CommunityAccessGate.tsx",
  );

  assert.match(legalRoute, /router\.get\("\/legal\/community-standards"/);
  assert.match(legalRoute, /SAFETY_CONTACT_EMAIL/);
  assert.match(productionConfig, /SAFETY_CONTACT_EMAIL/);
  assert.match(productionConfig, /MODERATOR_USER_IDS/);
  assert.match(environment, /SAFETY_CONTACT_EMAIL=/);
  assert.match(environment, /MODERATOR_USER_IDS=/);
  assert.match(gate, /\/api\/legal\/community-standards/);
});

test("privacy export includes consent and submitted report metadata without moderation snapshots", async () => {
  const privacyRoute = await source(
    "artifacts/api-server/src/routes/privacy.ts",
  );

  assert.match(privacyRoute, /communityMembershipsTable/);
  assert.match(privacyRoute, /submittedReports/);
  assert.match(privacyRoute, /communityMembership:/);
  assert.match(privacyRoute, /reports: submittedReports/);
  assert.match(privacyRoute, /limited snapshot of reported content/);
  assert.doesNotMatch(
    privacyRoute,
    /submittedReports[\s\S]{0,200}contentSnapshot/,
  );
});

test("blocked users are filtered from comments and challenge membership on the server", async () => {
  const socialRoute = await source("artifacts/api-server/src/routes/social.ts");
  const socialLib = await source("artifacts/api-server/src/lib/social.ts");

  assert.match(socialLib, /export async function blockedUserIds/);
  assert.match(socialRoute, /visibleComments/);
  assert.match(socialRoute, /visibleParticipants/);
});
