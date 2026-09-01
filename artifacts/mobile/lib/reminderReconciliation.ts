export type ReminderReconciliationOutcome =
  | "reconciled"
  | "permission-denied"
  | "stale"
  | "failed";

export interface ReminderReconciliationOperation<Snapshot> {
  isCurrent(): Promise<boolean>;
  listOwned(): Promise<readonly Snapshot[]>;
  identifier(snapshot: Snapshot): string;
  canRestore(snapshot: Snapshot): boolean;
  cancel(identifier: string): Promise<void>;
  permissionGranted(): Promise<boolean>;
  schedule(index: number): Promise<string>;
  restore(snapshot: Snapshot): Promise<string>;
  scheduleCount: number;
}

const MAX_NATIVE_ATTEMPTS = 2;

/**
 * Transactionally rebuild one account's reminder set.
 *
 * Native calls cannot be aborted. Every phase is generation-guarded, transient
 * failures receive one bounded retry, and a failed rebuild restores the exact
 * validated native requests captured before cancellation. Other apps'
 * notifications never enter listOwned and are therefore never touched.
 */
export async function runReminderReconciliation<Snapshot>(
  operation: ReminderReconciliationOperation<Snapshot>,
): Promise<ReminderReconciliationOutcome> {
  if (!(await operation.isCurrent())) return "stale";
  const previous = [...(await operation.listOwned())];
  if (!(await operation.isCurrent())) return "stale";
  // Never tear down a native request that cannot be recreated exactly enough
  // to recover from a later cancellation/scheduling failure.
  if (!previous.every(operation.canRestore)) return "failed";
  const previousIds = new Set(previous.map(operation.identifier));

  const cancelWithRetry = async (
    identifier: string,
  ): Promise<"cancelled" | "failed" | "stale"> => {
    for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
      if (!(await operation.isCurrent())) return "stale";
      try {
        await operation.cancel(identifier);
        return (await operation.isCurrent()) ? "cancelled" : "stale";
      } catch {
        if (attempt + 1 === MAX_NATIVE_ATTEMPTS) return "failed";
      }
    }
    return "failed";
  };

  const cancelKnownCreated = async (identifiers: readonly string[]) => {
    for (const identifier of identifiers) {
      for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
        try {
          await operation.cancel(identifier);
          break;
        } catch {
          // A later current reconciliation also removes every owned reminder.
        }
      }
    }
  };

  const restorePrevious = async (): Promise<boolean> => {
    if (!(await operation.isCurrent())) return false;
    let current: readonly Snapshot[];
    try {
      current = await operation.listOwned();
    } catch {
      return false;
    }
    if (!(await operation.isCurrent())) return false;

    // Remove anything created by a failed desired-set attempt.
    for (const snapshot of current) {
      const identifier = operation.identifier(snapshot);
      if (!previousIds.has(identifier)) {
        if ((await cancelWithRetry(identifier)) !== "cancelled") return false;
      }
    }

    let remainingSnapshots: readonly Snapshot[];
    try {
      remainingSnapshots = await operation.listOwned();
    } catch {
      return false;
    }
    const remaining = new Set(remainingSnapshots.map(operation.identifier));
    for (const snapshot of previous) {
      if (remaining.has(operation.identifier(snapshot))) continue;
      let restored = false;
      for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
        if (!(await operation.isCurrent())) return false;
        try {
          await operation.restore(snapshot);
          restored = true;
          break;
        } catch {
          restored = false;
        }
      }
      if (!restored || !(await operation.isCurrent())) return false;
    }
    return true;
  };

  for (const snapshot of previous) {
    const cancelled = await cancelWithRetry(operation.identifier(snapshot));
    if (cancelled === "stale") return "stale";
    if (cancelled === "failed") {
      await restorePrevious();
      return "failed";
    }
  }

  if (operation.scheduleCount === 0) return "reconciled";
  if (!(await operation.isCurrent())) return "stale";
  if (!(await operation.permissionGranted())) return "permission-denied";
  if (!(await operation.isCurrent())) return "stale";

  for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
    const created: string[] = [];
    let failed = false;
    for (let index = 0; index < operation.scheduleCount; index += 1) {
      if (!(await operation.isCurrent())) {
        await cancelKnownCreated(created);
        return "stale";
      }
      try {
        created.push(await operation.schedule(index));
      } catch {
        failed = true;
        break;
      }
      if (!(await operation.isCurrent())) {
        await cancelKnownCreated(created);
        return "stale";
      }
    }
    if (!failed) return "reconciled";

    await cancelKnownCreated(created);
    if (attempt + 1 === MAX_NATIVE_ATTEMPTS) {
      await restorePrevious();
      return "failed";
    }
  }

  await restorePrevious();
  return "failed";
}
