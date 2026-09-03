import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  ACTIVE_RUN_STORAGE_KEY,
  RUN_CONTROL_STORAGE_KEY,
  RUN_LOCATION_BATCH_PREFIX,
  clearPersistedRun,
  createAndPersistActiveRun,
  enqueueBackgroundRunLocations,
  ingestActiveRunLocations,
  pausePersistedRun,
  readActiveRunForOwner,
  resumePersistedRun,
  stopAndPauseBackgroundRun,
} from "./runTrackingStore";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("expo-location", () => ({
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

describe("durable run tracking store", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("checkpoints GPS batches and protects the draft with its owner and run id", async () => {
    const startedAt = Date.now() - 20_000;
    const created = await createAndPersistActiveRun({
      sessionId: "durable-run",
      ownerUserId: "owner-a",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 75,
    });

    await ingestActiveRunLocations([
      {
        timestamp: startedAt + 1_000,
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          altitude: 220,
          accuracy: 5,
          altitudeAccuracy: 8,
          speed: 5,
        },
      },
      {
        timestamp: startedAt + 11_000,
        coords: {
          latitude: 28.6139,
          longitude: 77.2096,
          altitude: 221,
          accuracy: 5,
          altitudeAccuracy: 8,
          speed: 5,
        },
      },
    ]);

    const stored = await readActiveRunForOwner("owner-a");
    expect(stored?.revision).toBeGreaterThan(created.revision);
    expect(stored?.points).toHaveLength(2);
    expect(stored?.distanceM).toBeGreaterThan(50);
    expect(await readActiveRunForOwner("owner-b")).toBeNull();
    expect(
      await pausePersistedRun("owner-b", "durable-run", startedAt + 12_000),
    ).toBeNull();
  });

  it("persists pause/resume transitions and clears only the matching draft", async () => {
    const startedAt = Date.now() - 5_000;
    await createAndPersistActiveRun({
      sessionId: "recoverable-run",
      ownerUserId: null,
      startedAt,
      trackingMode: "foreground",
      autoPauseEnabled: true,
      weightKg: 70,
    });

    const paused = await pausePersistedRun(
      null,
      "recoverable-run",
      startedAt + 2_000,
    );
    expect(paused?.status).toBe("paused");
    expect(paused?.timerStartedAt).toBeNull();

    const resumed = await resumePersistedRun(
      null,
      "recoverable-run",
      "foreground",
      startedAt + 4_000,
    );
    expect(resumed?.status).toBe("recording");
    expect(resumed?.timerStartedAt).toBe(startedAt + 4_000);

    expect(await clearPersistedRun("someone-else", "recoverable-run")).toBe(
      false,
    );
    expect(await clearPersistedRun(null, "recoverable-run")).toBe(true);
    expect(await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(RUN_CONTROL_STORAGE_KEY)).toBeNull();
  });

  it("reduces headless batches without allowing them to overwrite lifecycle state", async () => {
    const startedAt = Date.now() - 20_000;
    await createAndPersistActiveRun({
      sessionId: "headless-run",
      ownerUserId: "owner-a",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 75,
    });

    await enqueueBackgroundRunLocations([
      {
        timestamp: startedAt + 1_000,
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          altitude: 220,
          accuracy: 5,
          altitudeAccuracy: 8,
          speed: 5,
        },
      },
      {
        timestamp: startedAt + 11_000,
        coords: {
          latitude: 28.6139,
          longitude: 77.2096,
          altitude: 221,
          accuracy: 5,
          altitudeAccuracy: 8,
          speed: 5,
        },
      },
    ]);

    const rawBeforeDrain = JSON.parse(
      (await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY)) ?? "null",
    );
    expect(rawBeforeDrain.points).toHaveLength(0);
    expect(
      (await AsyncStorage.getAllKeys()).some((key) =>
        key.startsWith(RUN_LOCATION_BATCH_PREFIX),
      ),
    ).toBe(true);

    const drained = await readActiveRunForOwner("owner-a");
    expect(drained?.points).toHaveLength(2);
    expect(drained?.distanceM).toBeGreaterThan(50);
    expect(
      (await AsyncStorage.getAllKeys()).some((key) =>
        key.startsWith(RUN_LOCATION_BATCH_PREFIX),
      ),
    ).toBe(false);
  });

  it("does not lose a callback appended while the foreground drains older batches", async () => {
    const startedAt = Date.now() - 20_000;
    await createAndPersistActiveRun({
      sessionId: "concurrent-drain-run",
      ownerUserId: "owner-a",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 75,
    });
    await enqueueBackgroundRunLocations([
      {
        timestamp: startedAt + 1_000,
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 5,
          speed: 4,
        },
      },
    ]);

    const originalMultiGet = (
      AsyncStorage.multiGet as jest.MockedFunction<typeof AsyncStorage.multiGet>
    ).getMockImplementation();
    expect(originalMultiGet).toBeDefined();
    let releaseDrain!: () => void;
    let signalDrainRead!: () => void;
    let intercepted = false;
    const drainRead = new Promise<void>((resolve) => {
      signalDrainRead = resolve;
    });
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const multiGetSpy = jest
      .spyOn(AsyncStorage, "multiGet")
      .mockImplementation(async (keys) => {
        const snapshot = await originalMultiGet!(keys);
        if (
          !intercepted &&
          keys.some((key) => key.startsWith(RUN_LOCATION_BATCH_PREFIX))
        ) {
          intercepted = true;
          signalDrainRead();
          await drainGate;
        }
        return snapshot;
      });

    try {
      const firstDrain = readActiveRunForOwner("owner-a");
      await drainRead;
      await enqueueBackgroundRunLocations([
        {
          timestamp: startedAt + 11_000,
          coords: {
            latitude: 28.6139,
            longitude: 77.2096,
            accuracy: 5,
            speed: 4,
          },
        },
      ]);
      releaseDrain();

      expect((await firstDrain)?.points).toHaveLength(1);
      const afterConcurrentAppend = await readActiveRunForOwner("owner-a");
      expect(afterConcurrentAppend?.points).toHaveLength(2);
      expect(afterConcurrentAppend?.distanceM).toBeGreaterThan(50);
    } finally {
      multiGetSpy.mockImplementation(originalMultiGet!);
      releaseDrain();
    }
  });

  it("waits for an entered callback and keeps its pre-cutoff point while finalizing", async () => {
    const startedAt = Date.now() - 20_000;
    const endedAt = startedAt + 10_000;
    await createAndPersistActiveRun({
      sessionId: "finalizing-run",
      ownerUserId: "owner-a",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 75,
    });

    const originalGetItem = (
      AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>
    ).getMockImplementation();
    expect(originalGetItem).toBeDefined();
    let releaseCallbackRead!: () => void;
    let signalCallbackRead!: () => void;
    let intercepted = false;
    const callbackRead = new Promise<void>((resolve) => {
      signalCallbackRead = resolve;
    });
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallbackRead = resolve;
    });
    const getItemSpy = jest
      .spyOn(AsyncStorage, "getItem")
      .mockImplementation(async (key) => {
        if (!intercepted && key === ACTIVE_RUN_STORAGE_KEY) {
          intercepted = true;
          signalCallbackRead();
          await callbackGate;
        }
        return originalGetItem!(key);
      });

    try {
      const enqueue = enqueueBackgroundRunLocations([
        {
          timestamp: startedAt + 5_000,
          coords: {
            latitude: 28.6139,
            longitude: 77.209,
            accuracy: 5,
            speed: 4,
          },
        },
      ]);
      await callbackRead;
      const finalization = stopAndPauseBackgroundRun(
        "owner-a",
        "finalizing-run",
        endedAt,
      );

      let phase: string | undefined;
      for (let attempt = 0; attempt < 20 && phase !== "finalizing"; attempt++) {
        const raw = await originalGetItem!(RUN_CONTROL_STORAGE_KEY);
        phase = raw ? JSON.parse(raw).phase : undefined;
        if (phase !== "finalizing") {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
      }
      expect(phase).toBe("finalizing");
      releaseCallbackRead();
      await enqueue;

      const paused = await finalization;
      expect(paused?.status).toBe("paused");
      expect(paused?.points).toHaveLength(1);
      expect(paused?.points[0].timestamp).toBe(startedAt + 5_000);
    } finally {
      getItemSpy.mockImplementation(originalGetItem!);
      releaseCallbackRead();
    }
  });

  it("rejects a second start while a recoverable draft exists", async () => {
    const options = {
      sessionId: "first-run",
      ownerUserId: "owner-a",
      startedAt: Date.now(),
      trackingMode: "background" as const,
      autoPauseEnabled: true,
      weightKg: 70,
    };
    await createAndPersistActiveRun(options);
    await expect(
      createAndPersistActiveRun({ ...options, sessionId: "second-run" }),
    ).rejects.toThrow("already in progress");
  });

  it("self-removes a headless batch that finishes after the run was cleared", async () => {
    const startedAt = Date.now() - 10_000;
    await createAndPersistActiveRun({
      sessionId: "interleaved-run",
      ownerUserId: "owner-a",
      startedAt,
      trackingMode: "background",
      autoPauseEnabled: false,
      weightKg: 70,
    });

    let releaseBatchWrite!: () => void;
    let signalBatchWrite!: () => void;
    const batchWriteStarted = new Promise<void>((resolve) => {
      signalBatchWrite = resolve;
    });
    const batchWriteGate = new Promise<void>((resolve) => {
      releaseBatchWrite = resolve;
    });
    const setItemSpy = jest
      .spyOn(AsyncStorage, "setItem")
      .mockImplementation(async (key, value) => {
        if (key.startsWith(RUN_LOCATION_BATCH_PREFIX)) {
          signalBatchWrite();
          await batchWriteGate;
        }
        await AsyncStorage.multiSet([[key, value]]);
      });

    try {
      const enqueue = enqueueBackgroundRunLocations([
        {
          timestamp: startedAt + 1_000,
          coords: {
            latitude: 28.6139,
            longitude: 77.209,
            altitude: 220,
            accuracy: 5,
            altitudeAccuracy: 8,
            speed: 3,
          },
        },
      ]);
      await batchWriteStarted;
      expect(await clearPersistedRun("owner-a", "interleaved-run")).toBe(true);
      releaseBatchWrite();
      await enqueue;

      expect(await AsyncStorage.getItem(ACTIVE_RUN_STORAGE_KEY)).toBeNull();
      expect(
        (await AsyncStorage.getAllKeys()).some((key) =>
          key.startsWith(RUN_LOCATION_BATCH_PREFIX),
        ),
      ).toBe(false);
    } finally {
      setItemSpy.mockRestore();
      releaseBatchWrite();
    }
  });
});
