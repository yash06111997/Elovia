import {
  createActiveRunState,
  estimateCalories,
  formatDuration,
  formatPace,
  ingestTrackPoints,
  isAcceptableGpsPoint,
  parseActiveRunState,
  pauseActiveRun,
  resumeActiveRun,
  runStatsFromState,
  simplifyRunRoute,
  type TrackPoint,
} from "./runTrackingEngine";

const point = (accuracy: number | null): TrackPoint => ({
  latitude: 28.6139,
  longitude: 77.209,
  altitude: 220,
  accuracy,
  altitudeAccuracy: 8,
  speed: 2.8,
  timestamp: 1_000,
});

describe("run tracking calculations", () => {
  it("keeps usable real-world GPS fixes instead of leaving the route empty", () => {
    expect(isAcceptableGpsPoint(point(35))).toBe(true);
    expect(isAcceptableGpsPoint(point(80))).toBe(false);
    expect(isAcceptableGpsPoint(point(null))).toBe(true);
    expect(isAcceptableGpsPoint({ ...point(10), latitude: 91 })).toBe(false);
    expect(isAcceptableGpsPoint({ ...point(10), longitude: -181 })).toBe(false);
    expect(isAcceptableGpsPoint({ ...point(10), accuracy: -1 })).toBe(false);
  });

  it("formats live duration and pace without invalid clock values", () => {
    expect(formatDuration(3_661)).toBe("1:01:01");
    expect(formatPace(5.999)).toBe("6:00");
    expect(formatPace(null)).toBe("--:--");
  });

  it("produces a positive pace-sensitive calorie estimate", () => {
    expect(estimateCalories(5, 1_800, 70)).toBeGreaterThan(0);
  });

  it("persists distance and excludes a manual pause from moving time", () => {
    const startedAt = 1_000_000;
    let state = createActiveRunState({
      sessionId: "run-1",
      ownerUserId: "user-1",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 70,
    });
    state = ingestTrackPoints(state, [
      { ...point(5), timestamp: startedAt + 1_000 },
      {
        ...point(5),
        longitude: 77.2096,
        timestamp: startedAt + 11_000,
      },
    ]);
    state = pauseActiveRun(state, startedAt + 12_000);
    state = resumeActiveRun(state, startedAt + 62_000);
    const stats = runStatsFromState(state, startedAt + 72_000);

    expect(stats.distanceKm).toBeGreaterThan(0.05);
    expect(stats.durationSec).toBe(22);
  });

  it("ignores duplicate timestamps and implausible teleports", () => {
    const startedAt = 2_000_000;
    const initial = createActiveRunState({
      sessionId: "run-2",
      ownerUserId: null,
      startedAt,
      trackingMode: "foreground",
      autoPauseEnabled: false,
      weightKg: 70,
    });
    const state = ingestTrackPoints(initial, [
      { ...point(5), timestamp: startedAt + 1_000 },
      { ...point(5), longitude: 78, timestamp: startedAt + 1_000 },
      { ...point(5), longitude: 79, timestamp: startedAt + 2_000 },
    ]);

    expect(state.distanceM).toBe(0);
    expect(state.points).toHaveLength(1);
  });

  it("stops the durable clock during automatic pauses and resumes on movement", () => {
    const startedAt = 3_000_000;
    let state = createActiveRunState({
      sessionId: "run-3",
      ownerUserId: "user-3",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: true,
      weightKg: 70,
    });
    state = ingestTrackPoints(state, [
      { ...point(5), speed: 0, timestamp: startedAt + 1_000 },
      { ...point(5), speed: 0, timestamp: startedAt + 14_000 },
    ]);
    const pausedDuration = runStatsFromState(
      state,
      startedAt + 30_000,
    ).durationSec;
    state = ingestTrackPoints(state, [
      {
        ...point(5),
        longitude: 77.2092,
        speed: 2,
        timestamp: startedAt + 31_000,
      },
    ]);

    expect(state.autoPaused).toBe(false);
    expect(pausedDuration).toBe(1);
    expect(runStatsFromState(state, startedAt + 36_000).durationSec).toBe(
      pausedDuration + 5,
    );
  });

  it("creates every crossed kilometre split with stable sequential indexes", () => {
    const startedAt = Date.now() - 300_000;
    const initial = createActiveRunState({
      sessionId: "run-splits",
      ownerUserId: "user-splits",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 70,
    });
    const state = ingestTrackPoints(initial, [
      { ...point(5), timestamp: startedAt + 1_000 },
      {
        ...point(5),
        longitude: 77.232,
        timestamp: startedAt + 201_000,
      },
    ]);

    expect(state.splits.map((split) => split.index)).toEqual([1, 2]);
    expect(state.splits.every((split) => split.distanceKm === 1)).toBe(true);
  });

  it("keeps route endpoints while bounding synchronized history geometry", () => {
    const points = Array.from({ length: 2_500 }, (_, index) => ({
      ...point(5),
      latitude: 28.6139 + index / 100_000,
      timestamp: index + 1,
    }));
    const route = simplifyRunRoute(points, 1_000);
    expect(route).toHaveLength(1_000);
    expect(route[0]).toEqual({
      latitude: points[0].latitude,
      longitude: points[0].longitude,
    });
    expect(route.at(-1)).toEqual({
      latitude: points.at(-1)?.latitude,
      longitude: points.at(-1)?.longitude,
    });
  });

  it("rejects corrupt durable drafts", () => {
    expect(parseActiveRunState("not-json")).toBeNull();
    expect(
      parseActiveRunState(
        JSON.stringify({ version: 1, revision: 1, sessionId: "incomplete" }),
      ),
    ).toBeNull();
    const valid = createActiveRunState({
      sessionId: "run-owner-validation",
      ownerUserId: "user-1",
      startedAt: Date.now(),
      trackingMode: "background",
      autoPauseEnabled: true,
      weightKg: 70,
    });
    expect(
      parseActiveRunState(JSON.stringify({ ...valid, ownerUserId: "" })),
    ).toBeNull();
  });

  it("does not revive a stale GPS anchor after a persisted pause", () => {
    const startedAt = 4_000_000;
    let state = createActiveRunState({
      sessionId: "run-4",
      ownerUserId: "user-4",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 70,
    });
    state = ingestTrackPoints(state, [
      { ...point(5), timestamp: startedAt + 1_000 },
    ]);
    state = pauseActiveRun(state, startedAt + 2_000);

    const restored = parseActiveRunState(JSON.stringify(state));
    expect(restored?.points).toHaveLength(1);
    expect(restored?.lastPoint).toBeNull();
  });
});
