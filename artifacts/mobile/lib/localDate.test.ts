describe("local calendar dates", () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
    jest.resetModules();
  });

  it("uses the user's local day at a UTC date boundary", () => {
    process.env.TZ = "Asia/Kolkata";
    let calendar: typeof import("./localDate") | undefined;

    expect(() => {
      calendar = require("./localDate");
    }).not.toThrow();
    expect(calendar?.toLocalDateKey(new Date("2026-09-03T18:45:00.000Z"))).toBe(
      "2026-09-04",
    );
  });

  it("builds consecutive local date keys across daylight-saving changes", () => {
    process.env.TZ = "America/New_York";
    const calendar = require("./localDate") as typeof import("./localDate");

    expect(
      calendar.localDateKeysEndingAt(new Date(2026, 2, 9, 0, 30), 7),
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
    process.env.TZ = "America/Los_Angeles";
    const calendar = require("./localDate") as typeof import("./localDate");

    expect(calendar.localWeekDateKeys(new Date(2026, 8, 3, 23, 30))).toEqual([
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
    process.env.TZ = "America/New_York";
    const calendar = require("./localDate") as typeof import("./localDate");

    const parsed = calendar.dateFromLocalDateKey("2026-09-03");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(3);
    expect(parsed?.getHours()).toBe(12);
    expect(calendar.dateFromLocalDateKey("2026-02-31")).toBeNull();
  });

  it("measures calendar-day gaps independently of daylight-saving hours", () => {
    process.env.TZ = "America/New_York";
    const calendar = require("./localDate") as typeof import("./localDate");

    expect(calendar.calendarDayDifference).toEqual(expect.any(Function));
    expect(calendar.calendarDayDifference("2026-03-08", "2026-03-09")).toBe(1);
    expect(calendar.calendarDayDifference("2026-11-01", "2026-11-02")).toBe(1);
  });

  it("moves health query ranges by local calendar days across DST", () => {
    process.env.TZ = "America/New_York";
    const healthDates =
      require("./health/types") as typeof import("./health/types");
    const daysAgo = healthDates.daysAgo as (days: number, now?: Date) => Date;

    expect(
      healthDates.toLocalDateKey(daysAgo(1, new Date(2026, 2, 9, 0, 30))),
    ).toBe("2026-03-08");
  });

  it("ends a local day at the next calendar midnight across DST", () => {
    process.env.TZ = "America/New_York";
    const healthDates =
      require("./health/types") as typeof import("./health/types");
    const start = new Date(2026, 2, 8, 0, 0, 0, 0);

    expect(healthDates.endOfDay).toEqual(expect.any(Function));
    const end = healthDates.endOfDay(start);
    expect(healthDates.toLocalDateKey(end)).toBe("2026-03-08");
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });
});
