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

export const LOCAL_SYNC_OWNER_KEY = "@elovia_sync_owner";

export function scopedSyncCacheKey(userId: string, storageKey: string): string {
  return `@elovia_sync_cache:${encodeURIComponent(userId)}:${encodeURIComponent(storageKey)}`;
}

/**
 * Serializes account ownership changes and snapshot commits. JavaScript cannot
 * stop Firebase auth from changing while an AsyncStorage call is in flight;
 * this queue guarantees the next owner's transition runs after that write and
 * moves the previous owner's data out of the shared keys before it can upload.
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

  async prepareOwner(
    expectedUserId: string,
    currentUserId: CurrentUserId,
  ): Promise<OwnerPreparationOutcome> {
    return this.exclusive(async () => {
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };

      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (owner === expectedUserId) return { status: "ready", changed: false };

      if (owner === null) {
        if ((await currentUserId()) !== expectedUserId)
          return { status: "stale" };
        await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, expectedUserId);
        return { status: "ready", changed: true };
      }

      const globalEntries = await this.storage.multiGet([...this.syncKeys]);
      const previousCacheKeys = this.syncKeys.map((key) =>
        scopedSyncCacheKey(owner, key),
      );
      const previousCacheSets: [string, string][] = [];
      const previousCacheRemovals: string[] = [];
      for (let index = 0; index < globalEntries.length; index++) {
        const value = globalEntries[index]?.[1] ?? null;
        const cacheKey = previousCacheKeys[index];
        if (value === null) previousCacheRemovals.push(cacheKey);
        else previousCacheSets.push([cacheKey, value]);
      }

      const nextCacheKeys = this.syncKeys.map((key) =>
        scopedSyncCacheKey(expectedUserId, key),
      );
      const nextCacheEntries = await this.storage.multiGet(nextCacheKeys);
      const nextGlobalSets: [string, string][] = [];
      for (let index = 0; index < this.syncKeys.length; index++) {
        const value = nextCacheEntries[index]?.[1] ?? null;
        if (value !== null) nextGlobalSets.push([this.syncKeys[index], value]);
      }

      // No write occurs for a stale expected uid. If auth changes after this
      // check, its owner transition queues behind this critical section.
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };

      if (previousCacheSets.length > 0)
        await this.storage.multiSet(previousCacheSets);
      if (previousCacheRemovals.length > 0) {
        await this.storage.multiRemove(previousCacheRemovals);
      }
      await this.storage.multiRemove([...this.syncKeys]);
      if (nextGlobalSets.length > 0)
        await this.storage.multiSet(nextGlobalSets);
      await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, expectedUserId);
      return { status: "ready", changed: true };
    });
  }

  async readOwned(
    expectedUserId: string,
    currentUserId: CurrentUserId,
    keys: readonly string[],
  ): Promise<
    OwnedStorageOutcome<readonly (readonly [string, string | null])[]>
  > {
    return this.exclusive(async () => {
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      if (
        (await this.storage.getItem(LOCAL_SYNC_OWNER_KEY)) !== expectedUserId
      ) {
        return { status: "stale" };
      }
      return { status: "ready", value: await this.storage.multiGet([...keys]) };
    });
  }

  async commitOwned(
    expectedUserId: string,
    currentUserId: CurrentUserId,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    finalSets: readonly (readonly [string, string])[] = [],
  ): Promise<OwnedStorageOutcome<void>> {
    return this.exclusive(async () => {
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      if (
        (await this.storage.getItem(LOCAL_SYNC_OWNER_KEY)) !== expectedUserId
      ) {
        return { status: "stale" };
      }

      if (sets.length > 0) await this.storage.multiSet(sets);
      if (removals.length > 0) await this.storage.multiRemove([...removals]);
      if (finalSets.length > 0) await this.storage.multiSet(finalSets);

      // A queued transition will move these writes if auth changed while the
      // batch was committing. Report stale so callers never emit for B.
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      return { status: "ready", value: undefined };
    });
  }

  async runOwnedMutation<T>(
    expectedUserId: string,
    currentUserId: CurrentUserId,
    operation: () => Promise<T>,
  ): Promise<OwnedStorageOutcome<T>> {
    return this.exclusive(async () => {
      if ((await currentUserId()) !== expectedUserId)
        return { status: "stale" };
      if (
        (await this.storage.getItem(LOCAL_SYNC_OWNER_KEY)) !== expectedUserId
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
