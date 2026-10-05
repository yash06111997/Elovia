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

function identifierCounts(identifiers: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const identifier of identifiers) {
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
  }
  return counts;
}

function sameIdentifierMultiset(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftCounts = identifierCounts(left);
  const rightCounts = identifierCounts(right);
  if (leftCounts.size !== rightCounts.size) return false;
  for (const [identifier, count] of leftCounts) {
    if (rightCounts.get(identifier) !== count) return false;
  }
  return true;
}

/**
 * Transactionally rebuild one account's reminder set.
 *
 * Native cancellation APIs only report that a request was accepted. Every
 * destructive phase is therefore verified by listing the owned native set.
 * A retry begins only from a confirmed empty set, and success is returned only
 * when the exact identifier multiset created by this run is observable.
 */
export async function runReminderReconciliation<Snapshot>(
  operation: ReminderReconciliationOperation<Snapshot>,
): Promise<ReminderReconciliationOutcome> {
  const listOwned = async (): Promise<readonly Snapshot[] | null> => {
    try {
      return await operation.listOwned();
    } catch {
      return null;
    }
  };

  const listOwnedIdentifiers = async (): Promise<readonly string[] | null> => {
    const snapshots = await listOwned();
    return snapshots?.map(operation.identifier) ?? null;
  };

  const cancelIdentifier = async (identifier: string): Promise<boolean> => {
    for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
      try {
        await operation.cancel(identifier);
        return true;
      } catch {
        // Retry once. Verification below is still authoritative because a
        // rejected native call may nevertheless have completed.
      }
    }
    return false;
  };

  const cleanupToEmpty = async (): Promise<boolean> => {
    for (let pass = 0; pass < MAX_NATIVE_ATTEMPTS; pass += 1) {
      const current = await listOwned();
      if (current === null) return false;
      if (current.length === 0) return true;
      for (const snapshot of current) {
        await cancelIdentifier(operation.identifier(snapshot));
      }
      const remaining = await listOwnedIdentifiers();
      if (remaining?.length === 0) return true;
    }
    return false;
  };

  if (!(await operation.isCurrent())) return "stale";
  const previous = await listOwned();
  if (previous === null) return "failed";
  if (!(await operation.isCurrent())) return "stale";
  if (!previous.every(operation.canRestore)) return "failed";
  const previousIds = previous.map(operation.identifier);
  const previousCounts = identifierCounts(previousIds);

  const restorePrevious = async (): Promise<boolean> => {
    if (!(await operation.isCurrent())) return false;
    // Keep still-present previous requests, remove only extras from a failed
    // desired attempt, and then recreate the missing previous requests.
    for (let pass = 0; pass < MAX_NATIVE_ATTEMPTS; pass += 1) {
      const current = await listOwned();
      if (current === null) return false;
      const seen = new Map<string, number>();
      const extras: string[] = [];
      for (const snapshot of current) {
        const identifier = operation.identifier(snapshot);
        const count = (seen.get(identifier) ?? 0) + 1;
        seen.set(identifier, count);
        if (count > (previousCounts.get(identifier) ?? 0)) {
          extras.push(identifier);
        }
      }
      if (extras.length === 0) break;
      for (const identifier of extras) await cancelIdentifier(identifier);
    }

    const retained = await listOwnedIdentifiers();
    if (retained === null) return false;
    const retainedCounts = identifierCounts(retained);
    for (const [identifier, count] of retainedCounts) {
      if (count > (previousCounts.get(identifier) ?? 0)) return false;
    }

    const consumed = new Map<string, number>();
    for (const snapshot of previous) {
      const identifier = operation.identifier(snapshot);
      const retainedCount = retainedCounts.get(identifier) ?? 0;
      const alreadyConsumed = consumed.get(identifier) ?? 0;
      if (alreadyConsumed < retainedCount) {
        consumed.set(identifier, alreadyConsumed + 1);
        continue;
      }
      let restored = false;
      for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
        if (!(await operation.isCurrent())) return false;
        try {
          await operation.restore(snapshot);
          if (!(await operation.isCurrent())) {
            await cleanupToEmpty();
            return false;
          }
          restored = true;
          break;
        } catch {
          restored = false;
        }
      }
      if (!restored) return false;
    }
    const restoredIds = await listOwnedIdentifiers();
    if (!(await operation.isCurrent())) {
      await cleanupToEmpty();
      return false;
    }
    return (
      restoredIds !== null && sameIdentifierMultiset(restoredIds, previousIds)
    );
  };

  // Permission observation happens before destructive work. A denied optional
  // permission preserves the known previous schedule without prompting.
  if (operation.scheduleCount > 0) {
    if (!(await operation.permissionGranted())) return "permission-denied";
    if (!(await operation.isCurrent())) return "stale";
  }

  if (!(await cleanupToEmpty())) {
    await restorePrevious();
    return (await operation.isCurrent()) ? "failed" : "stale";
  }
  if (!(await operation.isCurrent())) return "stale";
  if (operation.scheduleCount === 0) return "reconciled";

  for (let attempt = 0; attempt < MAX_NATIVE_ATTEMPTS; attempt += 1) {
    const created: string[] = [];
    let schedulingFailed = false;
    for (let index = 0; index < operation.scheduleCount; index += 1) {
      if (!(await operation.isCurrent())) {
        await cleanupToEmpty();
        return "stale";
      }
      try {
        created.push(await operation.schedule(index));
      } catch {
        schedulingFailed = true;
        break;
      }
    }

    const observedIds = await listOwnedIdentifiers();
    const exactDesiredSet =
      !schedulingFailed &&
      observedIds !== null &&
      sameIdentifierMultiset(observedIds, created) &&
      created.length === operation.scheduleCount;
    if (exactDesiredSet) {
      if (await operation.isCurrent()) return "reconciled";
      await cleanupToEmpty();
      return "stale";
    }

    // A failed or unverifiable attempt must be completely removed before a
    // retry. Never report success or add another desired set over leftovers.
    if (!(await cleanupToEmpty())) {
      await restorePrevious();
      return (await operation.isCurrent()) ? "failed" : "stale";
    }
    if (!(await operation.isCurrent())) return "stale";
    if (attempt + 1 === MAX_NATIVE_ATTEMPTS) {
      await restorePrevious();
      return (await operation.isCurrent()) ? "failed" : "stale";
    }
  }

  await restorePrevious();
  return (await operation.isCurrent()) ? "failed" : "stale";
}
