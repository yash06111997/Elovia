export interface SyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(
    keys: string[],
  ): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(entries: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
}

export type CurrentUserId = () => Promise<string | null>;

export type OwnerPreparationOutcome =
  | { status: "ready"; changed: boolean }
  | { status: "stale" };

export type OwnedStorageOutcome<T> =
  | { status: "ready"; value: T }
  | { status: "stale" };

type StoredEntry = readonly [key: string, value: string | null];

interface OwnerTransitionJournal {
  version: 1;
  priorOwner: string;
  targetOwner: string;
  originalGlobals: StoredEntry[];
  originalPriorCache: StoredEntry[];
  originalTargetCache: StoredEntry[];
}

export const LOCAL_SYNC_OWNER_KEY = "@elovia_sync_owner";
export const LOCAL_SYNC_JOURNAL_KEY = "@elovia_sync_owner_transition";
export const LOCAL_SYNC_QUARANTINE_OWNER = "@elovia_sync_owner:quarantine";
export const LOCAL_SYNC_GUEST_OWNER = "@elovia_sync_owner:guest";

export function scopedSyncCacheKey(userId: string, storageKey: string): string {
  return `@elovia_sync_cache:${encodeURIComponent(userId)}:${encodeURIComponent(storageKey)}`;
}

function isStoredEntries(input: unknown): input is StoredEntry[] {
  return (
    Array.isArray(input) &&
    input.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        (typeof entry[1] === "string" || entry[1] === null),
    )
  );
}

function parseJournal(raw: string): OwnerTransitionJournal {
  const input: unknown = JSON.parse(raw);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (input as { version?: unknown }).version !== 1 ||
    typeof (input as { priorOwner?: unknown }).priorOwner !== "string" ||
    typeof (input as { targetOwner?: unknown }).targetOwner !== "string" ||
    !isStoredEntries(
      (input as { originalGlobals?: unknown }).originalGlobals,
    ) ||
    !isStoredEntries(
      (input as { originalPriorCache?: unknown }).originalPriorCache,
    ) ||
    !isStoredEntries(
      (input as { originalTargetCache?: unknown }).originalTargetCache,
    )
  ) {
    throw new Error("Local sync owner transition journal is invalid.");
  }
  return input as OwnerTransitionJournal;
}

/**
 * Serializes account ownership changes and snapshot commits. Owner transitions
 * are journaled and quarantined so a process crash or storage failure cannot
 * expose partly moved shared data to either account.
 */
export class SyncStorageCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly storage: SyncStorageAdapter;
  private readonly syncKeys: readonly string[];

  constructor(storage: SyncStorageAdapter, syncKeys: readonly string[]) {
    this.storage = storage;
    this.syncKeys = syncKeys;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async writeExactEntries(
    entries: readonly StoredEntry[],
  ): Promise<void> {
    const sets: [string, string][] = [];
    const removals: string[] = [];
    for (const [key, value] of entries) {
      if (value === null) removals.push(key);
      else sets.push([key, value]);
    }
    if (sets.length > 0) await this.storage.multiSet(sets);
    if (removals.length > 0) await this.storage.multiRemove(removals);
  }

  private async quarantineBestEffort(): Promise<void> {
    try {
      await this.storage.setItem(
        LOCAL_SYNC_OWNER_KEY,
        LOCAL_SYNC_QUARANTINE_OWNER,
      );
    } catch {
      // The surviving journal still makes every coordinator operation fail
      // closed and retry recovery on its next entry.
    }
  }

  private async recoverIfNeeded(): Promise<void> {
    const rawJournal = await this.storage.getItem(LOCAL_SYNC_JOURNAL_KEY);
    const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);

    if (rawJournal === null) {
      if (owner === LOCAL_SYNC_QUARANTINE_OWNER) {
        throw new Error(
          "Local sync storage is quarantined without a recovery journal.",
        );
      }
      return;
    }

    let journal: OwnerTransitionJournal;
    try {
      journal = parseJournal(rawJournal);
    } catch (error) {
      await this.quarantineBestEffort();
      throw error;
    }

    try {
      await this.storage.setItem(
        LOCAL_SYNC_OWNER_KEY,
        LOCAL_SYNC_QUARANTINE_OWNER,
      );
      await this.writeExactEntries(journal.originalPriorCache);
      await this.writeExactEntries(journal.originalTargetCache);
      await this.writeExactEntries(journal.originalGlobals);
      await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, journal.priorOwner);
      await this.storage.removeItem(LOCAL_SYNC_JOURNAL_KEY);
    } catch (error) {
      await this.quarantineBestEffort();
      throw error;
    }
  }

  private async transitionOwner(
    priorOwner: string,
    targetOwner: string,
  ): Promise<void> {
    const priorCacheKeys = this.syncKeys.map((key) =>
      scopedSyncCacheKey(priorOwner, key),
    );
    const targetCacheKeys = this.syncKeys.map((key) =>
      scopedSyncCacheKey(targetOwner, key),
    );
    const [originalGlobals, originalPriorCache, originalTargetCache] =
      await Promise.all([
        this.storage.multiGet([...this.syncKeys]),
        this.storage.multiGet(priorCacheKeys),
        this.storage.multiGet(targetCacheKeys),
      ]);

    const journal: OwnerTransitionJournal = {
      version: 1,
      priorOwner,
      targetOwner,
      originalGlobals: originalGlobals.map(([key, value]) => [key, value]),
      originalPriorCache: originalPriorCache.map(([key, value]) => [
        key,
        value,
      ]),
      originalTargetCache: originalTargetCache.map(([key, value]) => [
        key,
        value,
      ]),
    };

    // Journal and quarantine precede every mutation of shared/cache values.
    await this.storage.setItem(LOCAL_SYNC_JOURNAL_KEY, JSON.stringify(journal));
    await this.storage.setItem(
      LOCAL_SYNC_OWNER_KEY,
      LOCAL_SYNC_QUARANTINE_OWNER,
    );

    // Save the source globals into its cache, then install the target cache.
    await this.writeExactEntries(
      originalGlobals.map(([key, value], index) => [
        priorCacheKeys[index],
        value,
      ]),
    );
    await this.storage.multiRemove([...this.syncKeys]);
    const targetGlobalSets: [string, string][] = [];
    for (let index = 0; index < this.syncKeys.length; index++) {
      const value = originalTargetCache[index]?.[1] ?? null;
      if (value !== null) targetGlobalSets.push([this.syncKeys[index], value]);
    }
    if (targetGlobalSets.length > 0)
      await this.storage.multiSet(targetGlobalSets);

    // Owner target is committed only after globals are complete; journal is
    // removed last, making this the sole stable-success state.
    await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, targetOwner);
    await this.storage.removeItem(LOCAL_SYNC_JOURNAL_KEY);
  }

  async prepareOwner(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
  ): Promise<OwnerPreparationOutcome> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };

      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (
        owner === expectedUserId ||
        (expectedUserId === null && owner === LOCAL_SYNC_GUEST_OWNER)
      ) {
        return { status: "ready", changed: false };
      }

      if (owner === null) {
        if ((await currentUserId()) !== expectedUserId)
          return { status: "stale" };
        // Unowned guest data stays unowned so the first authenticated account
        // can claim it in place without an unnecessary cache round trip.
        if (expectedUserId === null)
          return { status: "ready", changed: false };
        await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, expectedUserId);
        return { status: "ready", changed: true };
      }

      if (owner === LOCAL_SYNC_QUARANTINE_OWNER) {
        throw new Error("Local sync storage remains quarantined.");
      }
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };

      await this.transitionOwner(
        owner,
        expectedUserId ?? LOCAL_SYNC_GUEST_OWNER,
      );
      return { status: "ready", changed: true };
    });
  }

  async readOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    keys: readonly string[],
  ): Promise<
    OwnedStorageOutcome<readonly (readonly [string, string | null])[]>
  > {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (
        owner !== expectedUserId &&
        !(expectedUserId === null && owner === LOCAL_SYNC_GUEST_OWNER)
      ) {
        return { status: "stale" };
      }
      return { status: "ready", value: await this.storage.multiGet([...keys]) };
    });
  }

  async commitOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    finalSets: readonly (readonly [string, string])[] = [],
  ): Promise<OwnedStorageOutcome<void>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (
        owner !== expectedUserId &&
        !(expectedUserId === null && owner === LOCAL_SYNC_GUEST_OWNER)
      ) {
        return { status: "stale" };
      }

      if (sets.length > 0) await this.storage.multiSet(sets);
      if (removals.length > 0) await this.storage.multiRemove([...removals]);
      if (finalSets.length > 0) await this.storage.multiSet(finalSets);

      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      return { status: "ready", value: undefined };
    });
  }

  async runOwnedMutation<T>(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    operation: () => Promise<T>,
  ): Promise<OwnedStorageOutcome<T>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (
        owner !== expectedUserId &&
        !(expectedUserId === null && owner === LOCAL_SYNC_GUEST_OWNER)
      ) {
        return { status: "stale" };
      }

      const value = await operation();
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      return { status: "ready", value };
    });
  }
}
