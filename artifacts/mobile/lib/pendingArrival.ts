export interface PendingArrival {
  eventId: string;
  ownerUserId: string;
  placeId: string;
  placeName: string;
  autoStartWorkout: boolean;
  at: string;
}

export interface PendingArrivalClaim {
  arrival: PendingArrival;
  leaseId: string;
  retryAfterMs: number;
}

export type PendingArrivalReadResult =
  | { status: "empty" }
  | { status: "leased"; retryAfterMs: number }
  | ({ status: "claimed" } & PendingArrivalClaim);

interface PendingArrivalLease {
  leaseId: string;
  ownerUserId: string;
  leasedAt: number;
}

interface StoredPendingArrival {
  version: 1;
  arrival: PendingArrival;
  lease: PendingArrivalLease | null;
}

interface PendingArrivalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const PENDING_ARRIVAL_KEY = "@elovia_geofence_pending";
export const PENDING_ARRIVAL_LEASE_MS = 10_000;
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

export interface PendingArrivalRouteContext {
  placeId: string;
  placeName: string;
  autoStartWorkout: true;
  at: string;
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

export function parsePendingArrivalRouteContext(
  raw: unknown,
  nowMs = Date.now(),
): PendingArrivalRouteContext | null {
  if (!boundedString(raw, 1_000)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const input = value as Record<string, unknown>;
    const atMs = typeof input.at === "string" ? Date.parse(input.at) : NaN;
    if (
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
      placeId: input.placeId,
      placeName: input.placeName,
      autoStartWorkout: true,
      at: input.at as string,
    };
  } catch {
    return null;
  }
}

function parseLease(value: unknown): PendingArrivalLease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    !boundedString(input.leaseId, 256) ||
    !boundedString(input.ownerUserId, 256) ||
    typeof input.leasedAt !== "number" ||
    !Number.isFinite(input.leasedAt)
  ) {
    return null;
  }
  return {
    leaseId: input.leaseId,
    ownerUserId: input.ownerUserId,
    leasedAt: input.leasedAt,
  };
}

function parseStoredPendingArrival(
  raw: string,
  nowMs: number,
): StoredPendingArrival | null {
  try {
    const decoded: unknown = JSON.parse(raw);
    const legacy = parsePendingArrival(decoded, nowMs);
    if (legacy) return { version: 1, arrival: legacy, lease: null };
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return null;
    }
    const input = decoded as Record<string, unknown>;
    if (input.version !== 1) return null;
    const arrival = parsePendingArrival(input.arrival, nowMs);
    if (!arrival) return null;
    if (input.lease === null) return { version: 1, arrival, lease: null };
    const lease = parseLease(input.lease);
    return lease ? { version: 1, arrival, lease } : null;
  } catch {
    return null;
  }
}

function defaultLeaseId(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

/** Durable, account-bound delivery lease for a single device-only arrival. */
export class PendingArrivalStore {
  private queue: Promise<void> = Promise.resolve();
  private readonly storage: PendingArrivalStorage;
  private readonly now: () => number;
  private readonly createLeaseId: () => string;

  constructor(
    storage: PendingArrivalStorage,
    now: () => number = Date.now,
    createLeaseId: () => string = defaultLeaseId,
  ) {
    this.storage = storage;
    this.now = now;
    this.createLeaseId = createLeaseId;
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

  private async removeIfUnchanged(raw: string): Promise<boolean> {
    if ((await this.storage.getItem(PENDING_ARRIVAL_KEY)) !== raw) return false;
    await this.storage.removeItem(PENDING_ARRIVAL_KEY);
    return true;
  }

  async record(arrival: PendingArrival): Promise<boolean> {
    const parsed = parsePendingArrival(arrival, this.now());
    if (!parsed) return false;
    return this.serialized(async () => {
      try {
        const stored: StoredPendingArrival = {
          version: 1,
          arrival: parsed,
          lease: null,
        };
        await this.storage.setItem(PENDING_ARRIVAL_KEY, JSON.stringify(stored));
        return true;
      } catch {
        return false;
      }
    });
  }

  async readForUser(userId: string): Promise<PendingArrivalReadResult> {
    if (!boundedString(userId, 256)) return { status: "empty" };
    return this.serialized(async () => {
      try {
        const raw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        if (!raw) return { status: "empty" };
        const nowMs = this.now();
        const stored = parseStoredPendingArrival(raw, nowMs);
        if (!stored) {
          await this.removeIfUnchanged(raw);
          return { status: "empty" };
        }
        if (stored.arrival.ownerUserId !== userId) return { status: "empty" };

        const leaseAge = stored.lease
          ? nowMs - stored.lease.leasedAt
          : Infinity;
        if (
          stored.lease?.ownerUserId === userId &&
          leaseAge >= 0 &&
          leaseAge < PENDING_ARRIVAL_LEASE_MS
        ) {
          return {
            status: "leased",
            retryAfterMs: PENDING_ARRIVAL_LEASE_MS - leaseAge,
          };
        }

        const lease: PendingArrivalLease = {
          leaseId: this.createLeaseId(),
          ownerUserId: userId,
          leasedAt: nowMs,
        };
        const claimed: StoredPendingArrival = { ...stored, lease };
        await this.storage.setItem(
          PENDING_ARRIVAL_KEY,
          JSON.stringify(claimed),
        );
        const confirmedRaw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        const confirmed = confirmedRaw
          ? parseStoredPendingArrival(confirmedRaw, nowMs)
          : null;
        if (confirmed?.lease?.leaseId !== lease.leaseId) {
          return { status: "leased", retryAfterMs: PENDING_ARRIVAL_LEASE_MS };
        }
        return {
          status: "claimed",
          arrival: stored.arrival,
          leaseId: lease.leaseId,
          retryAfterMs: PENDING_ARRIVAL_LEASE_MS,
        };
      } catch {
        return { status: "empty" };
      }
    });
  }

  async acknowledge(
    userId: string,
    leaseId: string,
  ): Promise<PendingArrival | null> {
    if (!boundedString(userId, 256) || !boundedString(leaseId, 256))
      return null;
    return this.serialized(async () => {
      try {
        const raw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        if (!raw) return null;
        const stored = parseStoredPendingArrival(raw, this.now());
        if (
          !stored ||
          stored.arrival.ownerUserId !== userId ||
          stored.lease?.ownerUserId !== userId ||
          stored.lease.leaseId !== leaseId
        ) {
          return null;
        }
        return (await this.removeIfUnchanged(raw)) ? stored.arrival : null;
      } catch {
        return null;
      }
    });
  }

  async release(userId: string, leaseId: string): Promise<boolean> {
    if (!boundedString(userId, 256) || !boundedString(leaseId, 256)) {
      return false;
    }
    return this.serialized(async () => {
      try {
        const raw = await this.storage.getItem(PENDING_ARRIVAL_KEY);
        if (!raw) return false;
        const stored = parseStoredPendingArrival(raw, this.now());
        if (
          !stored ||
          stored.arrival.ownerUserId !== userId ||
          stored.lease?.ownerUserId !== userId ||
          stored.lease.leaseId !== leaseId
        ) {
          return false;
        }
        await this.storage.setItem(
          PENDING_ARRIVAL_KEY,
          JSON.stringify({ ...stored, lease: null }),
        );
        return true;
      } catch {
        return false;
      }
    });
  }
}
