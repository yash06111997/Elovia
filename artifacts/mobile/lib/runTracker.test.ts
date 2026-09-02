import {
  estimateCalories,
  formatDuration,
  formatPace,
  isAcceptableGpsPoint,
  type TrackPoint,
} from "./runTracker";

const point = (accuracy: number | null): TrackPoint => ({
  latitude: 28.6139,
  longitude: 77.209,
  altitude: 220,
  accuracy,
  speed: 2.8,
  timestamp: 1_000,
});

describe("run tracking calculations", () => {
  it("keeps usable real-world GPS fixes instead of leaving the route empty", () => {
    expect(isAcceptableGpsPoint(point(35))).toBe(true);
    expect(isAcceptableGpsPoint(point(80))).toBe(false);
    expect(isAcceptableGpsPoint(point(null))).toBe(true);
  });

  it("formats live duration and pace without invalid clock values", () => {
    expect(formatDuration(3_661)).toBe("1:01:01");
    expect(formatPace(5.999)).toBe("6:00");
    expect(formatPace(null)).toBe("--:--");
  });

  it("produces a positive pace-sensitive calorie estimate", () => {
    expect(estimateCalories(5, 1_800, 70)).toBeGreaterThan(0);
  });
});
