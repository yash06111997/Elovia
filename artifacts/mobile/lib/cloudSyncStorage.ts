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

export interface StaleCurrentUser {
  readonly status: "stale";
}

export const STALE_CURRENT_USER: StaleCurrentUser = Object.freeze({
  status: "stale",
});

export type CurrentUserId = () => Promise<string | null | StaleCurrentUser>;

export interface GenerationGuardedUserToken {
  readonly uid: string | null;
  readonly generation: number;
}

export interface GenerationGuardedUserScope {
  readonly ready: boolean;
  readonly uid: string | null;
  readonly generation: number;
}

/** Guard both sides of an async auth lookup so same-uid ABA cannot validate. */
export function createGenerationGuardedCurrentUserResolver(
  token: GenerationGuardedUserToken,
  getScope: () => GenerationGuardedUserScope,
  getFirebaseUid: () => Promise<string | null>,
): CurrentUserId {
  const scopeMatches = () => {
    const scope = getScope();
    return (
      scope.ready &&
      scope.generation === token.generation &&
      scope.uid === token.uid
    );
  };

  return async () => {
    if (!scopeMatches()) return STALE_CURRENT_USER;
    try {
      const uid = await getFirebaseUid();
      return scopeMatches() ? uid : STALE_CURRENT_USER;
    } catch {
      return STALE_CURRENT_USER;
    }
  };
}

export type OwnerPreparationOutcome =
  | { status: "ready"; changed: boolean }
  | { status: "stale" };

export type OwnedStorageOutcome<T> =
  | { status: "ready"; value: T }
  | { status: "stale" };

type StoredEntry = readonly [key: string, value: string | null];

interface OwnerTransitionJournal {
  version: 1 | 2;
  kind?: "transition";
  priorOwner: string;
  targetOwner: string;
  originalGlobals: StoredEntry[];
  originalPriorCache: StoredEntry[];
  originalTargetCache: StoredEntry[];
}

interface OwnedMutationJournal {
  version: 2 | 3;
  kind: "mutation";
  stableOwner: string | null;
  sessionGeneration: string;
  originals: StoredEntry[];
  sets: StoredEntry[];
  removals: string[];
  finalSets: StoredEntry[];
  recoveryFinalSets?: StoredEntry[];
}

type SyncStorageJournal = OwnerTransitionJournal | OwnedMutationJournal;

export const LOCAL_SYNC_OWNER_KEY = "@elovia_sync_owner";
export const LOCAL_SYNC_JOURNAL_KEY = "@elovia_sync_owner_transition";
export const LOCAL_SYNC_LEGACY_OWNER_KEY = "@elovia_sync_legacy_owner";
export const LOCAL_SYNC_QUARANTINE_OWNER = "system:quarantine";
export const LOCAL_SYNC_GUEST_OWNER = "system:guest";
export const LEGACY_LOCAL_SYNC_QUARANTINE_OWNER =
  "@elovia_sync_owner:quarantine";
export const LEGACY_LOCAL_SYNC_GUEST_OWNER = "@elovia_sync_owner:guest";

export function storedSyncUserOwner(userId: string): string {
  return `user:${encodeURIComponent(userId)}`;
}

export function scopedSyncCacheKey(
  storedOwner: string,
  storageKey: string,
): string {
  if (
    storedOwner !== LOCAL_SYNC_GUEST_OWNER &&
    !isStoredUserOwner(storedOwner)
  ) {
    throw new Error("Sync cache keys require an encoded stored owner.");
  }
  return `@elovia_sync_cache:${encodeURIComponent(storedOwner)}:${encodeURIComponent(storageKey)}`;
}

export type SyncGenerationKind = "change" | "clean";

export interface SyncGenerationState {
  changeGeneration: number;
  cleanGeneration: number;
  dirty: boolean;
}

export interface OwnedSyncSnapshot extends SyncGenerationState {
  entries: readonly (readonly [string, string | null])[];
}

export interface RestoreCommitOptions {
  /** Manual-only conflict resolution after an explicit destructive confirmation. */
  allowOverwriteDirty?: boolean;
}

function storedOwnerForUserId(userId: string | null): string {
  return userId === null ? LOCAL_SYNC_GUEST_OWNER : storedSyncUserOwner(userId);
}

export function scopedSyncGenerationKey(
  storedOwner: string,
  kind: SyncGenerationKind,
): string {
  if (
    storedOwner !== LOCAL_SYNC_GUEST_OWNER &&
    !isStoredUserOwner(storedOwner)
  ) {
    throw new Error("Sync generation keys require an encoded stored owner.");
  }
  return `@elovia_sync_generation:${encodeURIComponent(storedOwner)}:${kind}`;
}

function generationKeysForUser(userId: string | null): {
  changeKey: string;
  cleanKey: string;
} {
  const owner = storedOwnerForUserId(userId);
  return {
    changeKey: scopedSyncGenerationKey(owner, "change"),
    cleanKey: scopedSyncGenerationKey(owner, "clean"),
  };
}

function parseGeneration(value: string | null): number {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) {
    throw new Error("Sync generation metadata is invalid.");
  }
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("Sync generation metadata is invalid.");
  }
  return generation;
}

function parseGenerationState(
  changeValue: string | null,
  cleanValue: string | null,
): SyncGenerationState {
  const changeGeneration = parseGeneration(changeValue);
  const cleanGeneration = parseGeneration(cleanValue);
  if (cleanGeneration > changeGeneration) {
    throw new Error("Sync generation metadata is invalid.");
  }
  return {
    changeGeneration,
    cleanGeneration,
    dirty: changeGeneration > cleanGeneration,
  };
}

function currentUserMatches(
  current: string | null | StaleCurrentUser,
  expectedUserId: string | null,
): boolean {
  return current !== STALE_CURRENT_USER && current === expectedUserId;
}

function isStoredUserOwner(owner: string): boolean {
  if (!owner.startsWith("user:")) return false;
  try {
    const decoded = decodeURIComponent(owner.slice("user:".length));
    return storedSyncUserOwner(decoded) === owner;
  } catch {
    return false;
  }
}

function isStableBackgroundOwner(owner: string | null): boolean {
  return (
    owner === null ||
    owner === LOCAL_SYNC_GUEST_OWNER ||
    isStoredUserOwner(owner)
  );
}

/**
 * Read one synchronized value from an OS background task without consulting
 * React or Firebase auth state. The owner and transition journal are sampled
 * on both sides of the value read so a concurrent account transition fails
 * closed instead of exposing another account's data.
 *
 * This helper is deliberately read-only: it never recovers journals, changes
 * ownership, touches caches, or advances sync generations.
 */
export async function readStableSynchronizedValue(
  storage: SyncStorageAdapter,
  key: string,
): Promise<string | null> {
  const readMetadata = async (): Promise<{
    owner: string | null;
    journal: string | null;
  }> => {
    const values = new Map(
      await storage.multiGet([LOCAL_SYNC_OWNER_KEY, LOCAL_SYNC_JOURNAL_KEY]),
    );
    return {
      owner: values.get(LOCAL_SYNC_OWNER_KEY) ?? null,
      journal: values.get(LOCAL_SYNC_JOURNAL_KEY) ?? null,
    };
  };

  try {
    const before = await readMetadata();
    if (before.journal !== null || !isStableBackgroundOwner(before.owner)) {
      return null;
    }

    const value = await storage.getItem(key);
    const after = await readMetadata();
    if (
      after.journal !== null ||
      after.owner !== before.owner ||
      !isStableBackgroundOwner(after.owner)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function storedOwnerMatches(
  owner: string | null,
  expectedUserId: string | null,
): boolean {
  return expectedUserId === null
    ? owner === null || owner === LOCAL_SYNC_GUEST_OWNER
    : owner === storedSyncUserOwner(expectedUserId);
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

function isStringArray(input: unknown): input is string[] {
  return (
    Array.isArray(input) && input.every((value) => typeof value === "string")
  );
}

function parseJournal(raw: string): SyncStorageJournal {
  const input: unknown = JSON.parse(raw);
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    [2, 3].includes((input as { version?: number }).version ?? -1) &&
    (input as { kind?: unknown }).kind === "mutation" &&
    (typeof (input as { stableOwner?: unknown }).stableOwner === "string" ||
      (input as { stableOwner?: unknown }).stableOwner === null) &&
    typeof (input as { sessionGeneration?: unknown }).sessionGeneration ===
      "string" &&
    isStoredEntries((input as { originals?: unknown }).originals) &&
    isStoredEntries((input as { sets?: unknown }).sets) &&
    isStringArray((input as { removals?: unknown }).removals) &&
    isStoredEntries((input as { finalSets?: unknown }).finalSets) &&
    ((input as { version?: unknown }).version === 2 ||
      isStoredEntries(
        (input as { recoveryFinalSets?: unknown }).recoveryFinalSets,
      ))
  ) {
    return input as OwnedMutationJournal;
  }

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![1, 2].includes((input as { version?: number }).version ?? -1) ||
    ((input as { version?: unknown }).version === 2 &&
      (input as { kind?: unknown }).kind !== "transition") ||
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
      // A quarantined legacy raw marker is resolved only by prepareOwner once
      // the exact authenticated uid returns. Reads and commits still fail
      // their owner checks while quarantine remains.
      return;
    }

    let journal: SyncStorageJournal;
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
      if (journal.kind === "mutation") {
        await this.writeExactEntries(journal.originals);
        if (journal.recoveryFinalSets?.length) {
          await this.writeExactEntries(journal.recoveryFinalSets);
        }
        if (journal.stableOwner === null) {
          await this.storage.removeItem(LOCAL_SYNC_OWNER_KEY);
        } else {
          await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, journal.stableOwner);
        }
      } else {
        await this.writeExactEntries(journal.originalPriorCache);
        await this.writeExactEntries(journal.originalTargetCache);
        await this.writeExactEntries(journal.originalGlobals);
        await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, journal.priorOwner);
      }
      await this.storage.removeItem(LOCAL_SYNC_JOURNAL_KEY);
    } catch (error) {
      await this.quarantineBestEffort();
      throw error;
    }
  }

  private async normalizeStoredOwner(
    owner: string | null,
    expectedUserId: string | null,
  ): Promise<{ owner: string | null; changed: boolean }> {
    if (owner === null) return { owner, changed: false };
    if (owner === LOCAL_SYNC_QUARANTINE_OWNER) {
      const legacyOwner = await this.storage.getItem(
        LOCAL_SYNC_LEGACY_OWNER_KEY,
      );
      if (
        expectedUserId !== null &&
        (legacyOwner === storedSyncUserOwner(expectedUserId) ||
          (legacyOwner === null && owner === expectedUserId))
      ) {
        const encodedOwner = storedSyncUserOwner(expectedUserId);
        await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, encodedOwner);
        await this.storage.removeItem(LOCAL_SYNC_LEGACY_OWNER_KEY);
        return { owner: encodedOwner, changed: true };
      }
      throw new Error("Local sync storage remains quarantined.");
    }

    // Legacy releases stored a raw Firebase uid. It is safe to migrate only
    // when the authenticated uid is an exact match; every other raw marker is
    // ambiguous and therefore quarantined without exposing shared data.
    if (expectedUserId !== null && owner === expectedUserId) {
      const encodedOwner = storedSyncUserOwner(expectedUserId);
      await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, encodedOwner);
      return { owner: encodedOwner, changed: true };
    }
    if (owner === LOCAL_SYNC_GUEST_OWNER || isStoredUserOwner(owner)) {
      return { owner, changed: false };
    }
    if (expectedUserId === null && owner === LEGACY_LOCAL_SYNC_GUEST_OWNER) {
      await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, LOCAL_SYNC_GUEST_OWNER);
      return { owner: LOCAL_SYNC_GUEST_OWNER, changed: true };
    }

    try {
      await this.storage.setItem(
        LOCAL_SYNC_LEGACY_OWNER_KEY,
        storedSyncUserOwner(owner),
      );
      await this.storage.setItem(
        LOCAL_SYNC_OWNER_KEY,
        LOCAL_SYNC_QUARANTINE_OWNER,
      );
    } catch (error) {
      await this.quarantineBestEffort();
      throw error;
    }
    throw new Error("Legacy local sync ownership cannot be verified.");
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
      version: 2,
      kind: "transition",
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
      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };

      const normalized = await this.normalizeStoredOwner(
        await this.storage.getItem(LOCAL_SYNC_OWNER_KEY),
        expectedUserId,
      );
      const owner = normalized.owner;
      if (storedOwnerMatches(owner, expectedUserId)) {
        return { status: "ready", changed: normalized.changed };
      }

      if (owner === null) {
        if (!currentUserMatches(await currentUserId(), expectedUserId))
          return { status: "stale" };
        // Unowned guest data stays unowned so the first authenticated account
        // can claim it in place without an unnecessary cache round trip.
        if (expectedUserId === null) return { status: "ready", changed: false };

        // A guest-created snapshot becomes the first account's local snapshot.
        // Mark it dirty before assigning the owner so it cannot be overwritten
        // by that account's first automatic cloud restore. If a crash happens
        // after this journaled metadata commit but before the owner write, a
        // retry observes the already-dirty generation and does not increment it
        // again.
        const globalValues = await this.storage.multiGet([...this.syncKeys]);
        const hasGuestData = globalValues.some(([, value]) => value !== null);
        const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
        const generationValues = new Map(
          await this.storage.multiGet([changeKey, cleanKey]),
        );
        const generations = parseGenerationState(
          generationValues.get(changeKey) ?? null,
          generationValues.get(cleanKey) ?? null,
        );
        if (hasGuestData && !generations.dirty) {
          if (generations.changeGeneration === Number.MAX_SAFE_INTEGER) {
            throw new Error(
              "Sync change generation cannot be advanced safely.",
            );
          }
          const claimed = await this.commitOwnedLocked(
            owner,
            expectedUserId,
            currentUserId,
            [],
            [],
            [[changeKey, String(generations.changeGeneration + 1)]],
            "owner-claim",
            [],
          );
          if (claimed.status === "stale") return claimed;
        }
        await this.storage.setItem(
          LOCAL_SYNC_OWNER_KEY,
          storedSyncUserOwner(expectedUserId),
        );
        if (!currentUserMatches(await currentUserId(), expectedUserId))
          return { status: "stale" };
        return { status: "ready", changed: true };
      }

      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };

      await this.transitionOwner(
        owner,
        expectedUserId === null
          ? LOCAL_SYNC_GUEST_OWNER
          : storedSyncUserOwner(expectedUserId),
      );
      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };
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
      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }
      const value = await this.storage.multiGet([...keys]);
      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };
      return { status: "ready", value };
    });
  }

  async readSyncSnapshotOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    keys: readonly string[],
  ): Promise<OwnedStorageOutcome<OwnedSyncSnapshot>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }

      const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
      const values = await this.storage.multiGet([
        ...keys,
        changeKey,
        cleanKey,
      ]);
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const valueByKey = new Map(values);
      const generations = parseGenerationState(
        valueByKey.get(changeKey) ?? null,
        valueByKey.get(cleanKey) ?? null,
      );
      return {
        status: "ready",
        value: {
          entries: keys.map((key) => [key, valueByKey.get(key) ?? null]),
          ...generations,
        },
      };
    });
  }

  private async commitOwnedLocked(
    owner: string | null,
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    finalSets: readonly (readonly [string, string])[],
    sessionGeneration: string,
    recoveryFinalSets: readonly (readonly [string, string])[],
  ): Promise<OwnedStorageOutcome<void>> {
    const touchedKeys = [
      ...new Set([
        ...sets.map(([key]) => key),
        ...removals,
        ...finalSets.map(([key]) => key),
        ...recoveryFinalSets.map(([key]) => key),
      ]),
    ];
    const originals = await this.storage.multiGet(touchedKeys);

    if (touchedKeys.length === 0) {
      return { status: "ready", value: undefined };
    }

    const journal: OwnedMutationJournal = {
      version: recoveryFinalSets.length > 0 ? 3 : 2,
      kind: "mutation",
      stableOwner: owner,
      sessionGeneration,
      originals: originals.map(([key, value]) => [key, value]),
      sets: sets.map(([key, value]) => [key, value]),
      removals: [...removals],
      finalSets: finalSets.map(([key, value]) => [key, value]),
      ...(recoveryFinalSets.length > 0
        ? {
            recoveryFinalSets: recoveryFinalSets.map(([key, value]) => [
              key,
              value,
            ]),
          }
        : {}),
    };

    await this.storage.setItem(LOCAL_SYNC_JOURNAL_KEY, JSON.stringify(journal));
    await this.storage.setItem(
      LOCAL_SYNC_OWNER_KEY,
      LOCAL_SYNC_QUARANTINE_OWNER,
    );

    if (sets.length > 0) await this.storage.multiSet(sets);
    if (removals.length > 0) await this.storage.multiRemove([...removals]);
    if (finalSets.length > 0) await this.storage.multiSet(finalSets);

    if (!currentUserMatches(await currentUserId(), expectedUserId)) {
      try {
        await this.writeExactEntries(originals);
        if (recoveryFinalSets.length > 0) {
          await this.writeExactEntries(recoveryFinalSets);
        }
        if (owner === null) await this.storage.removeItem(LOCAL_SYNC_OWNER_KEY);
        else await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, owner);
        await this.storage.removeItem(LOCAL_SYNC_JOURNAL_KEY);
      } catch (error) {
        await this.quarantineBestEffort();
        throw error;
      }
      return { status: "stale" };
    }
    if (owner === null) await this.storage.removeItem(LOCAL_SYNC_OWNER_KEY);
    else await this.storage.setItem(LOCAL_SYNC_OWNER_KEY, owner);
    await this.storage.removeItem(LOCAL_SYNC_JOURNAL_KEY);
    return { status: "ready", value: undefined };
  }

  async commitOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    finalSets: readonly (readonly [string, string])[] = [],
    sessionGeneration = "unspecified",
    recoveryFinalSets: readonly (readonly [string, string])[] = [],
  ): Promise<OwnedStorageOutcome<void>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId))
        return { status: "stale" };
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }
      return this.commitOwnedLocked(
        owner,
        expectedUserId,
        currentUserId,
        sets,
        removals,
        finalSets,
        sessionGeneration,
        recoveryFinalSets,
      );
    });
  }

  async commitLocalChangeOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    sessionGeneration = "unspecified",
  ): Promise<OwnedStorageOutcome<void>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }
      if (sets.length === 0 && removals.length === 0) {
        return { status: "ready", value: undefined };
      }

      const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
      const generationValues = new Map(
        await this.storage.multiGet([changeKey, cleanKey]),
      );
      const generations = parseGenerationState(
        generationValues.get(changeKey) ?? null,
        generationValues.get(cleanKey) ?? null,
      );
      if (generations.changeGeneration === Number.MAX_SAFE_INTEGER) {
        throw new Error("Sync change generation cannot be advanced safely.");
      }
      return this.commitOwnedLocked(
        owner,
        expectedUserId,
        currentUserId,
        sets,
        removals,
        [[changeKey, String(generations.changeGeneration + 1)]],
        sessionGeneration,
        [],
      );
    });
  }

  async commitBackupSavedOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    capturedChangeGeneration: number,
    savedSets: readonly (readonly [string, string])[],
    sessionGeneration = "unspecified",
  ): Promise<OwnedStorageOutcome<{ markedClean: boolean }>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }

      const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
      const generationValues = new Map(
        await this.storage.multiGet([changeKey, cleanKey]),
      );
      const generations = parseGenerationState(
        generationValues.get(changeKey) ?? null,
        generationValues.get(cleanKey) ?? null,
      );
      const markedClean =
        generations.changeGeneration === capturedChangeGeneration;
      const finalSets = markedClean
        ? [...savedSets, [cleanKey, String(capturedChangeGeneration)] as const]
        : [...savedSets];
      const committed = await this.commitOwnedLocked(
        owner,
        expectedUserId,
        currentUserId,
        [],
        [],
        finalSets,
        sessionGeneration,
        [],
      );
      return committed.status === "stale"
        ? committed
        : { status: "ready", value: { markedClean } };
    });
  }

  async commitRestoreOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    capturedChangeGeneration: number,
    sets: readonly (readonly [string, string])[],
    removals: readonly string[],
    finalSets: readonly (readonly [string, string])[],
    sessionGeneration = "unspecified",
    options: RestoreCommitOptions = {},
  ): Promise<OwnedStorageOutcome<{ committed: boolean }>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }

      const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
      const generationValues = new Map(
        await this.storage.multiGet([changeKey, cleanKey]),
      );
      const generations = parseGenerationState(
        generationValues.get(changeKey) ?? null,
        generationValues.get(cleanKey) ?? null,
      );
      if (
        (!options.allowOverwriteDirty && generations.dirty) ||
        generations.changeGeneration !== capturedChangeGeneration
      ) {
        return { status: "ready", value: { committed: false } };
      }
      const committed = await this.commitOwnedLocked(
        owner,
        expectedUserId,
        currentUserId,
        sets,
        removals,
        [
          ...finalSets,
          [cleanKey, String(generations.changeGeneration)] as const,
        ],
        sessionGeneration,
        [],
      );
      return committed.status === "stale"
        ? committed
        : { status: "ready", value: { committed: true } };
    });
  }

  async resetOwned(
    expectedUserId: string | null,
    currentUserId: CurrentUserId,
    additionalKeys: readonly string[] = [],
    sessionGeneration = "unspecified",
    finalSets: readonly (readonly [string, string])[] = [],
    recoveryFinalSets: readonly (readonly [string, string])[] = [],
  ): Promise<OwnedStorageOutcome<void>> {
    return this.exclusive(async () => {
      await this.recoverIfNeeded();
      if (!currentUserMatches(await currentUserId(), expectedUserId)) {
        return { status: "stale" };
      }
      const owner = await this.storage.getItem(LOCAL_SYNC_OWNER_KEY);
      if (!storedOwnerMatches(owner, expectedUserId)) {
        return { status: "stale" };
      }

      const storedOwner = storedOwnerForUserId(expectedUserId);
      const cacheKeys = this.syncKeys.map((key) =>
        scopedSyncCacheKey(storedOwner, key),
      );
      const { changeKey, cleanKey } = generationKeysForUser(expectedUserId);
      let effectiveRecoveryFinalSets = [...recoveryFinalSets];
      if (recoveryFinalSets.length > 0) {
        const generationValues = new Map(
          await this.storage.multiGet([changeKey, cleanKey]),
        );
        const generations = parseGenerationState(
          generationValues.get(changeKey) ?? null,
          generationValues.get(cleanKey) ?? null,
        );
        effectiveRecoveryFinalSets = [
          ...effectiveRecoveryFinalSets,
          [cleanKey, String(generations.changeGeneration)],
        ];
      }
      return this.commitOwnedLocked(
        owner,
        expectedUserId,
        currentUserId,
        [],
        [
          ...this.syncKeys,
          ...cacheKeys,
          ...additionalKeys,
          changeKey,
          cleanKey,
        ],
        finalSets,
        sessionGeneration,
        effectiveRecoveryFinalSets,
      );
    });
  }
}
