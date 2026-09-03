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

const calendarFiles = [
  "context/AppContext.tsx",
  "context/NutritionContext.tsx",
  "context/WellnessContext.tsx",
  "context/WorkoutContext.tsx",
  "app/(tabs)/diet.tsx",
  "app/(tabs)/workouts.tsx",
  "app/privacy-data.tsx",
  "app/scan.tsx",
];

test("user-facing mobile calendar days are never derived from UTC ISO dates", () => {
  for (const relativePath of calendarFiles) {
    const source = fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /toISOString\(\)\.(?:split\(["']T["']\)\[0\]|slice\(0,\s*10\))/,
      `${relativePath} still derives a local calendar day from UTC`,
    );
  }
});

test("local calendar bucketing never subtracts fixed 24-hour durations", () => {
  const source = fs.readFileSync(
    path.join(mobileRoot, "context", "WellnessContext.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Date\.now\(\)\s*-\s*[^\n]*86_?400_?000/,
    "WellnessContext must shift calendar dates instead of elapsed milliseconds",
  );
});

test("workout calendar code compares date keys without parsing them as UTC instants", () => {
  for (const relativePath of [
    "context/WorkoutContext.tsx",
    "app/(tabs)/index.tsx",
    "app/(tabs)/workouts.tsx",
  ]) {
    const source = fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /new Date\((?:s\.date|[ab]\.date|dateStr)\)/,
      `${relativePath} parses YYYY-MM-DD as UTC and can display the previous day`,
    );
  }
});
