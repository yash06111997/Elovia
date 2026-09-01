import AsyncStorage from "@react-native-async-storage/async-storage";

export const ACCOUNT_DELETION_MARKER_KEY =
  "@elovia/device/account-deletion-finalizing-v1";

export type AccountDeletionMarkerPhase =
  | "prepared"
  | "request_started"
  | "remote_confirmed"
  | "unknown";

export interface AccountDeletionMarker {
  version: 1;
  status: "deletion_finalizing";
  ownerUserId: string | null;
  requestId: string | null;
  phase: AccountDeletionMarkerPhase;
  createdAt: string;
  updatedAt: string;
}

export interface AccountDeletionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

let cachedMarker: AccountDeletionMarker | null = null;
const listeners = new Set<() => void>();

function publishMarker(marker: AccountDeletionMarker | null): void {
  const changed = (cachedMarker === null) !== (marker === null);
  cachedMarker = marker;
  if (changed) {
    for (const listener of listeners) listener();
  }
}

export function isAccountDeletionFinalizing(): boolean {
  return cachedMarker !== null;
}

export function subscribeAccountDeletionFinalizing(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function validString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseAccountDeletionMarker(
  raw: string | null,
  now = new Date(),
): AccountDeletionMarker | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountDeletionMarker>;
    if (
      parsed.version === 1 &&
      parsed.status === "deletion_finalizing" &&
      (parsed.ownerUserId === null || validString(parsed.ownerUserId)) &&
      (parsed.requestId === null || validString(parsed.requestId)) &&
      ["prepared", "request_started", "remote_confirmed", "unknown"].includes(
        parsed.phase ?? "",
      ) &&
      validString(parsed.createdAt) &&
      validString(parsed.updatedAt)
    ) {
      return parsed as AccountDeletionMarker;
    }
  } catch {
    // Presence of a corrupt deletion marker is treated as finalizing. Failing
    // open here could restart authenticated sync after a committed deletion.
  }
  const timestamp = now.toISOString();
  return {
    version: 1,
    status: "deletion_finalizing",
    ownerUserId: null,
    requestId: null,
    phase: "unknown",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class AccountDeletionRecoveryStore {
  private readonly storage: AccountDeletionStorage;
  private readonly now: () => Date;

  constructor(
    storage: AccountDeletionStorage = AsyncStorage,
    now: () => Date = () => new Date(),
  ) {
    this.storage = storage;
    this.now = now;
  }

  async read(): Promise<AccountDeletionMarker | null> {
    const marker = parseAccountDeletionMarker(
      await this.storage.getItem(ACCOUNT_DELETION_MARKER_KEY),
      this.now(),
    );
    publishMarker(marker);
    return marker;
  }

  async begin(ownerUserId: string, requestId: string): Promise<void> {
    const timestamp = this.now().toISOString();
    const marker: AccountDeletionMarker = {
      version: 1,
      status: "deletion_finalizing",
      ownerUserId,
      requestId,
      phase: "prepared",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.storage.setItem(
      ACCOUNT_DELETION_MARKER_KEY,
      JSON.stringify(marker),
    );
    publishMarker(marker);
  }

  async advance(
    ownerUserId: string,
    requestId: string,
    phase: Extract<
      AccountDeletionMarkerPhase,
      "request_started" | "remote_confirmed"
    >,
  ): Promise<void> {
    const marker = await this.read();
    if (
      !marker ||
      marker.ownerUserId !== ownerUserId ||
      marker.requestId !== requestId
    ) {
      throw new Error("Account deletion marker ownership changed.");
    }
    const next = {
      ...marker,
      phase,
      updatedAt: this.now().toISOString(),
    };
    await this.storage.setItem(
      ACCOUNT_DELETION_MARKER_KEY,
      JSON.stringify(next),
    );
    publishMarker(next);
  }

  /** Abort only before the network commit boundary has been crossed. */
  async abortPrepared(
    ownerUserId: string,
    requestId: string,
  ): Promise<boolean> {
    const marker = await this.read();
    if (
      !marker ||
      marker.ownerUserId !== ownerUserId ||
      marker.requestId !== requestId ||
      marker.phase !== "prepared"
    ) {
      return false;
    }
    await this.storage.removeItem(ACCOUNT_DELETION_MARKER_KEY);
    publishMarker(null);
    return true;
  }

  /** Abort after an authoritative server response says deletion never began. */
  async abortBeforeRemoteCommit(
    ownerUserId: string,
    requestId: string,
  ): Promise<boolean> {
    const marker = await this.read();
    if (
      !marker ||
      marker.ownerUserId !== ownerUserId ||
      marker.requestId !== requestId ||
      !["prepared", "request_started"].includes(marker.phase)
    ) {
      return false;
    }
    await this.storage.removeItem(ACCOUNT_DELETION_MARKER_KEY);
    publishMarker(null);
    return true;
  }

  /** Clear all device data, but remove the recovery marker last. */
  async completeLocalFinalization(): Promise<void> {
    const keys = await this.storage.getAllKeys();
    const dataKeys = keys.filter((key) => key !== ACCOUNT_DELETION_MARKER_KEY);
    if (dataKeys.length > 0) await this.storage.multiRemove(dataKeys);
    await this.storage.removeItem(ACCOUNT_DELETION_MARKER_KEY);
    publishMarker(null);
  }
}

export type AccountDeletionRecoveryOutcome =
  | { status: "none" }
  | { status: "finalized" }
  | { status: "pending"; error: unknown };

export async function recoverAccountDeletionFinalization(options: {
  store: AccountDeletionRecoveryStore;
  currentUserId: string | null;
  signOut(): Promise<void>;
}): Promise<AccountDeletionRecoveryOutcome> {
  const marker = await options.store.read();
  if (!marker) return { status: "none" };
  try {
    if (options.currentUserId !== null) await options.signOut();
    await options.store.completeLocalFinalization();
    return { status: "finalized" };
  } catch (error) {
    return { status: "pending", error };
  }
}
