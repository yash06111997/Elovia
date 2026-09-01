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

  /**
   * Convert an ambiguous/request-started marker only after the server has
   * authoritatively confirmed its permanent tombstone.
   */
  async confirmRemoteBoundary(
    ownerUserId: string,
    requestId: string | null,
  ): Promise<void> {
    const marker = await this.read();
    if (
      !marker ||
      !["request_started", "unknown"].includes(marker.phase) ||
      (marker.ownerUserId !== null && marker.ownerUserId !== ownerUserId) ||
      (marker.requestId !== null && marker.requestId !== requestId)
    ) {
      throw new Error("Account deletion marker ownership changed.");
    }
    const next: AccountDeletionMarker = {
      ...marker,
      ownerUserId,
      requestId: marker.requestId ?? requestId,
      phase: "remote_confirmed",
      updatedAt: this.now().toISOString(),
    };
    await this.storage.setItem(
      ACCOUNT_DELETION_MARKER_KEY,
      JSON.stringify(next),
    );
    publishMarker(next);
  }

  /** A corrupt/legacy marker may be released only after a server no-tombstone response. */
  async abortUnconfirmedUnknown(): Promise<boolean> {
    const marker = await this.read();
    if (!marker || marker.phase !== "unknown") return false;
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
  | { status: "aborted" }
  | { status: "finalized" }
  | { status: "pending"; error: unknown };

export type AccountDeletionRemoteConfirmation =
  | { status: "confirmed" }
  | { status: "not_started" };

export async function prepareAccountDeletionRequest(
  store: AccountDeletionRecoveryStore,
  ownerUserId: string,
  requestId: string,
): Promise<"request_started" | "prepared_pending"> {
  await store.begin(ownerUserId, requestId);
  try {
    await store.advance(ownerUserId, requestId, "request_started");
    return "request_started";
  } catch (error) {
    const aborted = await store
      .abortPrepared(ownerUserId, requestId)
      .catch(() => false);
    if (aborted) throw error;
    return "prepared_pending";
  }
}

export function isProvablyPreDeletionBoundaryError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return ["authentication_unavailable", "unauthenticated"].includes(
    typeof code === "string" ? code : "",
  );
}

export async function recoverAccountDeletionFinalization(options: {
  store: AccountDeletionRecoveryStore;
  currentUserId: string | null;
  confirmRemote(
    marker: AccountDeletionMarker,
  ): Promise<AccountDeletionRemoteConfirmation>;
  signOut(): Promise<void>;
}): Promise<AccountDeletionRecoveryOutcome> {
  const marker = await options.store.read();
  if (!marker) return { status: "none" };

  // `prepared` is written before crossing the HTTP boundary. A process death
  // here proves the destructive request was never sent, so resuming the
  // authenticated account is both safe and preferable to a false deletion.
  if (marker.phase === "prepared") {
    try {
      const aborted = await options.store.abortPrepared(
        marker.ownerUserId ?? "",
        marker.requestId ?? "",
      );
      if (aborted) return { status: "aborted" };
      return {
        status: "pending",
        error: new Error("Prepared deletion marker could not be released."),
      };
    } catch (error) {
      return { status: "pending", error };
    }
  }

  if (
    options.currentUserId !== null &&
    marker.ownerUserId !== null &&
    marker.ownerUserId !== options.currentUserId
  ) {
    return {
      status: "pending",
      error: new Error(
        "Account deletion recovery cannot clear a different signed-in account.",
      ),
    };
  }

  try {
    if (marker.phase === "request_started" || marker.phase === "unknown") {
      const confirmation = await options.confirmRemote(marker);
      if (confirmation.status === "not_started") {
        if (marker.phase !== "unknown") {
          throw new Error(
            "Account deletion request is not yet durably confirmed.",
          );
        }
        const aborted = await options.store.abortUnconfirmedUnknown();
        if (!aborted) {
          throw new Error("Unconfirmed deletion marker could not be released.");
        }
        return { status: "aborted" };
      }
      const confirmedOwner = marker.ownerUserId ?? options.currentUserId;
      if (!confirmedOwner) {
        throw new Error("Account deletion marker has no recoverable owner.");
      }
      await options.store.confirmRemoteBoundary(
        confirmedOwner,
        marker.requestId,
      );
    }

    if (options.currentUserId !== null) await options.signOut();
    await options.store.completeLocalFinalization();
    return { status: "finalized" };
  } catch (error) {
    return { status: "pending", error };
  }
}
