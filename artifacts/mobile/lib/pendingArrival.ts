export interface PendingArrival {
  eventId: string;
  ownerUserId: string;
  placeId: string;
  placeName: string;
  autoStartWorkout: boolean;
  at: string;
}

interface PendingArrivalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const PENDING_ARRIVAL_KEY = "@elovia_geofence_pending";
const MAX_ARRIVAL_AGE_MS = 30 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

export function parsePendingArrival(
  value: unknown,
  nowMs = Date.now(),
): PendingArrival | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const atMs = typeof input.at === "string" ? Date.parse(input.at) : NaN;
  if (
    !boundedString(input.eventId, 256) ||
    !boundedString(input.ownerUserId, 256) ||
    !boundedString(input.placeId, 256) ||
    !boundedString(input.placeName, 160) ||
    input.autoStartWorkout !== true ||
    !Number.isFinite(atMs) ||
    nowMs - atMs > MAX_ARRIVAL_AGE_MS ||
    atMs - nowMs > MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    return null;
  }
  return {
    eventId: input.eventId,
    ownerUserId: input.ownerUserId,
    placeId: input.placeId,
    placeName: input.placeName,
    autoStartWorkout: true,
    at: input.at as string,
  };
}

export function serializePendingArrivalRouteContext(
  arrival: PendingArrival,
): string {
  return JSON.stringify({
    placeId: arrival.placeId,
    placeName: arrival.placeName,
    autoStartWorkout: true,
    at: arrival.at,
  });
}

/**
 * A tiny durable lease around the single device-only arrival record.
 *
 * Reads claim an event in memory, so Strict Mode/remounts cannot route it
 * twice. Completion removes only the exact raw event that was delivered; a
 * newer background arrival written meanwhile is retained. A crash drops the
 * in-memory lease while leaving storage intact, so the next launch retries.
 */
export class PendingArrivalStore {
  private queue: Promise<void> = Promise.resolve();
  private claimedEventId: string | null = null;
  private readonly storage: PendingArrivalStorage;
  private readonly now: () => number;

  constructor(storage: PendingArrivalStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async record(arrival: PendingArrival): Promise<boolean> {
    const parsed = parsePendingArrival(arrival, this.now());
    if (!parsed) return false;
    return this.serialized(async () => {
      try {
        await this.storage.setItem(PENDING_ARRIVAL_KEY, JSON.stringify(parsed));
        return true;
      } catch {
        return false;
      }
    });
  }

  async readForUser(userId: string): Promise<PendingArrival | null> {
    if (!boundedString(userId, 256)) return null;
    return this.serialized(async () => {
      try {
        const raw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        if (!raw) return null;
        let decoded: unknown;
        try {
          decoded = JSON.parse(raw);
        } catch {
          await this.storage.removeItem(PENDING_ARRIVAL_KEY);
          return null;
        }
        const arrival = parsePendingArrival(decoded, this.now());
        if (!arrival) {
          await this.storage.removeItem(PENDING_ARRIVAL_KEY);
          return null;
        }
        if (
          arrival.ownerUserId !== userId ||
          this.claimedEventId === arrival.eventId
        ) {
          return null;
        }
        this.claimedEventId = arrival.eventId;
        return arrival;
      } catch {
        return null;
      }
    });
  }

  async complete(arrival: PendingArrival | null): Promise<boolean> {
    if (!arrival) return false;
    return this.serialized(async () => {
      try {
        const raw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        const current = raw
          ? parsePendingArrival(JSON.parse(raw), this.now())
          : null;
        if (current?.eventId !== arrival.eventId) {
          return false;
        }
        await this.storage.removeItem(PENDING_ARRIVAL_KEY);
        return true;
      } catch {
        return false;
      } finally {
        if (this.claimedEventId === arrival.eventId) {
          this.claimedEventId = null;
        }
      }
    });
  }

  async release(arrival: PendingArrival | null): Promise<void> {
    if (!arrival) return;
    await this.serialized(async () => {
      if (this.claimedEventId === arrival.eventId) {
        this.claimedEventId = null;
      }
    });
  }
}
