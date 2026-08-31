import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseAuth } from "./firebase";
import {
  createGenerationGuardedCurrentUserResolver,
  SyncStorageCoordinator,
  type CurrentUserId,
} from "./cloudSyncStorage";

export const SYNC_KEYS = [
  "@elovia_state",
  "@elovia_plan",
  "@elovia_active_session",
  "@elovia_custom_plans",
  "@elovia_active_plan_type",
  "@elovia_active_custom_plan_id",
  "@elovia_sessions",
  "@elovia_prs",
  "@elovia_meal_plan",
  "@elovia_food_log",
  "@elovia_custom_meal_plans",
  "@elovia_active_meal_plan_type",
  "@elovia_active_custom_meal_plan_id",
  "@elovia_health_data",
  "@elovia_wellness",
  "@elovia_water_goal",
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

interface AuthScope {
  ready: boolean;
  uid: string | null;
  generation: number;
}

export interface AccountStorageOwnerToken {
  readonly uid: string | null;
  readonly generation: number;
}

export interface AccountStorageSession {
  readonly ownerToken: AccountStorageOwnerToken;
  getItem(key: SyncKey): Promise<string | null>;
  setItem(key: SyncKey, value: string): Promise<void>;
  removeItem(key: SyncKey): Promise<void>;
  multiGet(
    keys: readonly SyncKey[],
  ): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(entries: readonly (readonly [SyncKey, string])[]): Promise<void>;
}

export type AccountStorageResetOutcome =
  | { status: "reset" }
  | { status: "stale" | "server" };

export class StaleAccountStorageSessionError extends Error {
  constructor() {
    super("The account storage session is no longer active.");
    this.name = "StaleAccountStorageSessionError";
  }
}

const syncKeySet = new Set<string>(SYNC_KEYS);
let authScope: AuthScope = { ready: false, uid: null, generation: 0 };

// Cloud sync and every account-scoped context intentionally share this one
// coordinator, mutex, journal, quarantine state, and complete key set.
export const syncStorageCoordinator = new SyncStorageCoordinator(
  AsyncStorage,
  SYNC_KEYS,
);

export function setAccountStorageAuthScope(
  uid: string | null,
  isLoading: boolean,
): void {
  const ready = !isLoading;
  if (authScope.ready === ready && authScope.uid === uid) return;
  authScope = {
    ready,
    uid,
    generation: authScope.generation + 1,
  };
}

export function getAccountStorageScopeKey(): string {
  if (!authScope.ready) return `auth-loading:${authScope.generation}`;
  return `${authScope.uid ?? "guest"}:${authScope.generation}`;
}

async function getFirebaseUid(): Promise<string | null> {
  const auth = await getFirebaseAuth();
  return auth?.currentUser?.uid ?? null;
}

function currentOwnerForToken(
  token: AccountStorageOwnerToken,
): ReturnType<typeof createGenerationGuardedCurrentUserResolver> {
  return createGenerationGuardedCurrentUserResolver(
    token,
    () => authScope,
    getFirebaseUid,
  );
}

function assertSyncKeys(keys: readonly string[]): asserts keys is SyncKey[] {
  if (keys.some((key) => !syncKeySet.has(key))) {
    throw new Error("Account storage only accepts synchronized Elovia keys.");
  }
}

async function prepareSession(
  token: AccountStorageOwnerToken,
  currentOwner: CurrentUserId,
): Promise<void> {
  const prepared = await syncStorageCoordinator.prepareOwner(
    token.uid,
    currentOwner,
  );
  if (prepared.status === "stale") {
    throw new StaleAccountStorageSessionError();
  }
}

export function captureAccountStorageSession(): AccountStorageSession {
  if (!authScope.ready) {
    throw new StaleAccountStorageSessionError();
  }

  const ownerToken: AccountStorageOwnerToken = Object.freeze({
    uid: authScope.uid,
    generation: authScope.generation,
  });
  const currentOwner = currentOwnerForToken(ownerToken);

  const ensureReady = () => prepareSession(ownerToken, currentOwner);
  const ensureCommitted = async (
    sets: readonly (readonly [SyncKey, string])[],
    removals: readonly SyncKey[],
  ): Promise<void> => {
    await ensureReady();
    const result = await syncStorageCoordinator.commitLocalChangeOwned(
      ownerToken.uid,
      currentOwner,
      sets,
      removals,
      `account-generation-${ownerToken.generation}`,
    );
    if (result.status === "stale") {
      throw new StaleAccountStorageSessionError();
    }
  };
  const read = async (
    keys: readonly SyncKey[],
  ): Promise<readonly (readonly [string, string | null])[]> => {
    assertSyncKeys(keys);
    await ensureReady();
    const result = await syncStorageCoordinator.readOwned(
      ownerToken.uid,
      currentOwner,
      keys,
    );
    if (result.status === "stale") {
      throw new StaleAccountStorageSessionError();
    }
    return result.value;
  };

  return {
    ownerToken,
    async getItem(key) {
      const values = await read([key]);
      return values[0]?.[1] ?? null;
    },
    async setItem(key, value) {
      assertSyncKeys([key]);
      await ensureCommitted([[key, value]], []);
    },
    async removeItem(key) {
      await ensureCommitted([], [key]);
    },
    async multiGet(keys) {
      return read(keys);
    },
    async multiSet(entries) {
      assertSyncKeys(entries.map(([key]) => key));
      await ensureCommitted(entries, []);
    },
  };
}

/** Reset only the currently mounted account/guest namespace. */
export async function resetCurrentAccountStorage(): Promise<AccountStorageResetOutcome> {
  if (!authScope.ready) return { status: "stale" };
  const ownerToken: AccountStorageOwnerToken = Object.freeze({
    uid: authScope.uid,
    generation: authScope.generation,
  });
  const currentOwner = currentOwnerForToken(ownerToken);

  try {
    await prepareSession(ownerToken, currentOwner);
    const reset = await syncStorageCoordinator.resetOwned(
      ownerToken.uid,
      currentOwner,
      [],
      `account-generation-${ownerToken.generation}`,
    );
    return reset.status === "stale" ? { status: "stale" } : { status: "reset" };
  } catch (error) {
    return error instanceof StaleAccountStorageSessionError
      ? { status: "stale" }
      : { status: "server" };
  }
}
