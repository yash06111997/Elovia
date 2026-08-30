import assert from "node:assert/strict";
import test from "node:test";

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const [bright, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (bright + 0.05) / (dark + 0.05);
}

test("secondary and muted text colors meet WCAG AA on app backgrounds", async () => {
  const { Colors } = await import("../../artifacts/mobile/constants/colors.ts");
  for (const palette of [Colors.dark, Colors.light]) {
    for (const textColor of [palette.textSecondary, palette.textMuted]) {
      assert.ok(contrast(textColor, palette.background) >= 4.5);
      assert.ok(contrast(textColor, palette.card) >= 4.5);
    }
  }
});

test("new feedback controls expose 44-point touch targets", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../artifacts/mobile/app/log-workout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /ratingButton:\s*\{[\s\S]*?width: 44,[\s\S]*?height: 44/,
  );
  assert.match(source, /keepTrainingBtn:\s*\{[\s\S]*?minHeight: 44/);
});

test("Android release requests only permissions needed for core mobile features", async () => {
  const { readFile } = await import("node:fs/promises");
  const appConfig = JSON.parse(
    await readFile(
      new URL("../../artifacts/mobile/app.json", import.meta.url),
      "utf8",
    ),
  );
  const permissions = appConfig.expo.android.permissions;
  assert.ok(!permissions.includes("READ_EXTERNAL_STORAGE"));
  assert.ok(!permissions.includes("SCHEDULE_EXACT_ALARM"));
});
