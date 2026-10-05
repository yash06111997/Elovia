import type { PushOwnership } from "./pushOwnership";

export const PUSH_CLEANUP_JOURNAL_KEY = "@elovia_push_cleanup_journal";
const MAX_CLEANUP_INTENTS = 64;

export interface PushCleanupIntent extends PushOwnership {
  createdAt: number;
}

export const ELOVIA_PUSH_PAYLOAD_VERSION = 1;
export const ELOVIA_PUSH_OWNER_KEY = "eloviaPushOwnerUserId";
export const ELOVIA_REMINDER_ACCOUNT_KEY = "eloviaReminderAccountUserId";
export const ELOVIA_GEOFENCE_PAYLOAD_VERSION = 1;
export const ELOVIA_GEOFENCE_OWNER_KEY = "eloviaGeofenceOwner";

export function shouldPresentEloviaNotification(
  data: Record<string, unknown>,
  currentUserId: string | null,
  cleanupIntents: readonly PushCleanupIntent[] | null,
  presentationBlocked = false,
  currentNotificationOwnerMarker: string | null = null,
): boolean {
  if (data.eloviaOwner === "elovia-reminder-v1") {
    return (
      data[ELOVIA_REMINDER_ACCOUNT_KEY] === (currentUserId ?? "system:guest")
    );
  }

  if (data.eloviaGeofence === ELOVIA_GEOFENCE_PAYLOAD_VERSION) {
    return (
      currentNotificationOwnerMarker !== null &&
      data[ELOVIA_GEOFENCE_OWNER_KEY] === currentNotificationOwnerMarker
    );
  }

  if (data.eloviaPush === ELOVIA_PUSH_PAYLOAD_VERSION) {
    if (!currentUserId || presentationBlocked) return false;
    if (data[ELOVIA_PUSH_OWNER_KEY] !== currentUserId) return false;
    if (cleanupIntents === null) return false;
    return !cleanupIntents.some((intent) => intent.userId === currentUserId);
  }

  // Fail closed for unowned payloads. All Elovia local and server push
  // notifications carry one of the versioned ownership markers above.
  return false;
}

export async function runPushCleanupForUser(options: {
  userId: string;
  intents: readonly PushCleanupIntent[] | null;
  isCurrent(): Promise<boolean>;
  unregister(intent: PushCleanupIntent): Promise<boolean>;
  remove(intent: PushCleanupIntent): Promise<boolean>;
}): Promise<boolean> {
  if (options.intents === null) return false;
  let complete = true;
  for (const intent of options.intents) {
    if (intent.userId !== options.userId) continue;
    if (!(await options.isCurrent())) return false;
    try {
      if (await options.unregister(intent)) {
        if (!(await options.remove(intent))) complete = false;
      } else {
        complete = false;
      }
    } catch {
      complete = false;
    }
  }
  return complete;
}

interface PushCleanupJournal {
  version: 1;
  intents: PushCleanupIntent[];
}

interface PushCleanupStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function parseIntent(value: unknown): PushCleanupIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.userId !== "string" ||
    input.userId.trim().length === 0 ||
    input.userId.length > 256 ||
    typeof input.token !== "string" ||
    input.token.length >= 200 ||
    (!input.token.startsWith("ExponentPushToken[") &&
      !input.token.startsWith("ExpoPushToken[")) ||
    !input.token.endsWith("]") ||
    typeof input.createdAt !== "number" ||
    !Number.isFinite(input.createdAt) ||
    input.createdAt < 0
  ) {
    return null;
  }
  return {
    userId: input.userId,
    token: input.token,
    createdAt: input.createdAt,
  };
}

/** Null means corrupt/unknown and callers should fail closed. */
export function parsePushCleanupJournal(
  raw: string | null,
): PushCleanupIntent[] | null {
  if (raw === null) return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return null;
    }
    const input = decoded as Record<string, unknown>;
    if (
      input.version !== 1 ||
      !Array.isArray(input.intents) ||
      input.intents.length > MAX_CLEANUP_INTENTS
    ) {
      return null;
    }
    const intents = input.intents.map(parseIntent);
    return intents.every(
      (intent): intent is PushCleanupIntent => intent !== null,
    )
      ? intents
      : null;
  } catch {
    return null;
  }
}

/** Durable cleanup intent; credentials are deliberately never stored. */
export class PushCleanupStore {
  private queue: Promise<void> = Promise.resolve();
  private readonly storage: PushCleanupStorage;

  constructor(storage: PushCleanupStorage) {
    this.storage = storage;
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

  async read(): Promise<PushCleanupIntent[] | null> {
    try {
      return parsePushCleanupJournal(
        await this.storage.getItem(PUSH_CLEANUP_JOURNAL_KEY),
      );
    } catch {
      return null;
    }
  }

  async record(ownership: PushOwnership, nowMs = Date.now()): Promise<boolean> {
    return this.serialized(async () => {
      try {
        const current = await this.read();
        if (current === null) return false;
        const intents = current.filter(
          (intent) =>
            intent.userId !== ownership.userId ||
            intent.token !== ownership.token,
        );
        if (intents.length >= MAX_CLEANUP_INTENTS) return false;
        intents.push({ ...ownership, createdAt: nowMs });
        const journal: PushCleanupJournal = {
          version: 1,
          intents,
        };
        await this.storage.setItem(
          PUSH_CLEANUP_JOURNAL_KEY,
          JSON.stringify(journal),
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  async remove(ownership: PushOwnership): Promise<boolean> {
    return this.serialized(async () => {
      try {
        const current = await this.read();
        if (current === null) return false;
        const intents = current.filter(
          (intent) =>
            intent.userId !== ownership.userId ||
            intent.token !== ownership.token,
        );
        const journal: PushCleanupJournal = { version: 1, intents };
        await this.storage.setItem(
          PUSH_CLEANUP_JOURNAL_KEY,
          JSON.stringify(journal),
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  async removeToken(token: string): Promise<boolean> {
    return this.serialized(async () => {
      try {
        const current = await this.read();
        if (current === null) return false;
        const journal: PushCleanupJournal = {
          version: 1,
          intents: current.filter((intent) => intent.token !== token),
        };
        await this.storage.setItem(
          PUSH_CLEANUP_JOURNAL_KEY,
          JSON.stringify(journal),
        );
        return true;
      } catch {
        return false;
      }
    });
  }
}
