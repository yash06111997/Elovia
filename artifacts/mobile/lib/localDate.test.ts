import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Jest virtualizes process.env; changing TZ in a test does not reliably change
 * Date's timezone on Linux. Start real Node processes with TZ set before boot.
 * They execute the production TypeScript helpers through the existing tsx tool.
 */
function inTimezone(timezone: string, expression: string): any {
  const scriptsPackage = resolve(__dirname, "../../../scripts/package.json");
  const calendarPath = resolve(__dirname, "localDate.ts");
  const healthPath = resolve(__dirname, "health/types.ts");
  const script = [
    "import { createRequire } from 'node:module';",
    "const require = createRequire(" + JSON.stringify(scriptsPackage) + ");",
    "const { require: loadTs } = require('tsx/cjs/api');",
    "const calendar = loadTs(" +
      JSON.stringify(calendarPath) +
      ", " +
      JSON.stringify(scriptsPackage) +
      ");",
    "const health = loadTs(" +
      JSON.stringify(healthPath) +
      ", " +
      JSON.stringify(scriptsPackage) +
      ");",
    "console.log(JSON.stringify((" + expression + ")));",
  ].join("\n");
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...process.env, TZ: timezone },
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }),
  );
}

describe("local calendar dates", () => {
  it.each([
    ["Asia/Kolkata", "2026-09-03T18:45:00.000Z", "2026-09-04"],
    ["America/Los_Angeles", "2026-09-04T01:30:00.000Z", "2026-09-03"],
  ])(
    "uses the user's local day at a UTC boundary in %s",
    (timezone, instant, expected) => {
      expect(
        inTimezone(
          timezone,
          "calendar.toLocalDateKey(new Date(" + JSON.stringify(instant) + "))",
        ),
      ).toBe(expected);
    },
  );

  it("builds consecutive local date keys across daylight-saving changes", () => {
    expect(
      inTimezone(
        "America/New_York",
        "calendar.localDateKeysEndingAt(new Date(2026, 2, 9, 0, 30), 7)",
      ),
    ).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });

  it("builds one Monday-based calendar week containing the supplied date", () => {
    expect(
      inTimezone(
        "America/Los_Angeles",
        "calendar.localWeekDateKeys(new Date(2026, 8, 3, 23, 30))",
      ),
    ).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("parses a date key as local noon and rejects impossible dates", () => {
    expect(
      inTimezone(
        "America/New_York",
        "(() => { const d = calendar.dateFromLocalDateKey('2026-09-03'); return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), invalid: calendar.dateFromLocalDateKey('2026-02-31') }; })()",
      ),
    ).toEqual({ year: 2026, month: 8, day: 3, hour: 12, invalid: null });
  });

  it("measures calendar-day gaps independently of daylight-saving hours", () => {
    expect(
      inTimezone(
        "America/New_York",
        "[calendar.calendarDayDifference('2026-03-08', '2026-03-09'), calendar.calendarDayDifference('2026-11-01', '2026-11-02')]",
      ),
    ).toEqual([1, 1]);
  });

  it("moves health query ranges by local calendar days across DST", () => {
    expect(
      inTimezone(
        "America/New_York",
        "(() => { const now = new Date(2026, 2, 9, 0, 30); const previous = health.daysAgo(1, now); return { day: health.toLocalDateKey(previous), elapsedHours: (now - previous) / 3600000 }; })()",
      ),
      // Query ranges begin at local midnight, 23.5 real hours before 00:30 here.
    ).toEqual({ day: "2026-03-08", elapsedHours: 23.5 });
  });

  it.each([
    [2, 8, 23],
    [10, 1, 25],
  ])(
    "ends a local day at the next midnight on month %i day %i (%i hours)",
    (month, day, hours) => {
      expect(
        inTimezone(
          "America/New_York",
          "(() => { const start = new Date(2026, " +
            month +
            ", " +
            day +
            "); const end = health.endOfDay(start); return { sameDay: health.toLocalDateKey(end) === health.toLocalDateKey(start), hour: end.getHours(), minute: end.getMinutes(), second: end.getSeconds(), millisecond: end.getMilliseconds(), elapsed: end - start }; })()",
        ),
      ).toEqual({
        sameDay: true,
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
        elapsed: hours * 3600000 - 1,
      });
    },
  );
});
