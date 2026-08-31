import assert from "node:assert/strict";
import test from "node:test";

function luminance(hex, label) {
  assert.equal(
    typeof hex,
    "string",
    `${label} must be an opaque #RRGGBB color; received ${JSON.stringify(hex)}`,
  );
  assert.match(
    hex,
    /^#[0-9a-f]{6}$/i,
    `${label} must be an opaque #RRGGBB color; received ${JSON.stringify(hex)}`,
  );
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second, firstLabel, secondLabel) {
  const [bright, dark] = [
    luminance(first, firstLabel),
    luminance(second, secondLabel),
  ].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

test("secondary and muted text colors meet WCAG AA on app backgrounds", async () => {
  const { Colors } = await import("../../artifacts/mobile/constants/colors.ts");
  const palettes = Object.entries(Colors).filter(
    ([, value]) =>
      value &&
      typeof value === "object" &&
      typeof value.background === "string" &&
      typeof value.card === "string",
  );

  assert.ok(palettes.length > 0, "at least one app palette must be defined");
  for (const [paletteName, palette] of palettes) {
    const textTokens = [
      ["textSecondary", palette.textSecondary],
      ["textMuted", palette.textMuted],
    ];
    const surfaces = [
      ["background", palette.background],
      ["card", palette.card],
    ];

    for (const [tokenName, textColor] of textTokens) {
      for (const [surfaceName, surfaceColor] of surfaces) {
        const ratio = contrast(
          textColor,
          surfaceColor,
          `${paletteName}.${tokenName}`,
          `${paletteName}.${surfaceName}`,
        );
        assert.ok(
          ratio >= 4.5,
          `${paletteName}.${tokenName} on ${surfaceName} has contrast ${ratio.toFixed(2)}; required threshold is 4.5`,
        );
      }
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
