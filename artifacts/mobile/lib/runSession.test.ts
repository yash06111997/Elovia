import {
  createActiveRunState,
  ingestTrackPoints,
  pauseActiveRun,
  runStatsFromState,
} from "./runTrackingEngine";
import {
  createRunSessionFromFinishedDraft,
  normalizeRunSession,
} from "./runSession";

describe("saved run session integrity", () => {
  it("carries the recorded route and every primary statistic across the save boundary", () => {
    const startedAt = new Date("2026-09-03T06:00:00.000Z").getTime();
    let state = createActiveRunState({
      sessionId: "run-save-boundary",
      ownerUserId: "runner-1",
      startedAt,
      trackingMode: "foreground",
      autoPauseEnabled: false,
      weightKg: 70,
    });
    state = ingestTrackPoints(state, [
      {
        latitude: 28.6139,
        longitude: 77.209,
        altitude: 220,
        altitudeAccuracy: 3,
        accuracy: 5,
        speed: 2.8,
        timestamp: startedAt + 1_000,
      },
      {
        latitude: 28.6149,
        longitude: 77.209,
        altitude: 224,
        altitudeAccuracy: 3,
        accuracy: 5,
        speed: 2.8,
        timestamp: startedAt + 41_000,
      },
    ]);
    const endedAt = startedAt + 45_000;
    state = pauseActiveRun(state, endedAt);
    const stats = runStatsFromState(state, endedAt);

    const session = createRunSessionFromFinishedDraft({
      sessionId: state.sessionId,
      startedAt,
      endedAt,
      stats,
    });

    expect(session.id).toBe("run-save-boundary");
    expect(session.route).toHaveLength(2);
    expect(session.distanceKm).toBeGreaterThan(0.1);
    expect(session.durationSec).toBe(45);
    expect(session.avgPaceMinKm).toBeGreaterThan(0);
    expect(session.elevationGainM).toBe(4);
    expect(session.caloriesBurned).toBeGreaterThan(0);
  });

  it("repairs legacy sessions so the summary never crashes on missing route data", () => {
    expect(
      normalizeRunSession({
        id: "legacy-run",
        date: "2026-09-02",
        startTime: "2026-09-02T06:00:00.000Z",
        endTime: "2026-09-02T06:30:00.000Z",
        distanceKm: 5,
        durationMins: 30,
        avgPaceMinKm: 6,
        caloriesBurned: 350,
      }),
    ).toMatchObject({
      id: "legacy-run",
      distanceKm: 5,
      durationSec: 1_800,
      route: [],
      splits: [],
    });
  });
});
