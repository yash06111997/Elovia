export type ReminderReconciliationOutcome =
  | "reconciled"
  | "permission-denied"
  | "stale";

export interface ReminderReconciliationOperation {
  isCurrent(): Promise<boolean>;
  listOwnedIdentifiers(): Promise<readonly string[]>;
  cancel(identifier: string): Promise<void>;
  permissionGranted(): Promise<boolean>;
  schedule(index: number): Promise<string>;
  scheduleCount: number;
}

/**
 * Run one account's native reminder changes as a guarded transaction.
 *
 * Expo notification calls cannot be aborted once they enter native code. The
 * current account is therefore checked around every await, and any reminder
 * created by a run that becomes stale is removed with its returned identifier.
 * Callers serialize runs so a newer account cannot be cancelled by an older
 * run's compensation.
 */
export async function runReminderReconciliation(
  operation: ReminderReconciliationOperation,
): Promise<ReminderReconciliationOutcome> {
  const created: string[] = [];

  const cancelCreated = async () => {
    for (const identifier of created) {
      try {
        await operation.cancel(identifier);
      } catch {
        // Best effort compensation; a later current run also removes owned IDs.
      }
    }
  };

  if (!(await operation.isCurrent())) return "stale";
  const ownedIdentifiers = await operation.listOwnedIdentifiers();
  if (!(await operation.isCurrent())) return "stale";

  for (const identifier of ownedIdentifiers) {
    if (!(await operation.isCurrent())) return "stale";
    await operation.cancel(identifier);
    if (!(await operation.isCurrent())) return "stale";
  }

  if (operation.scheduleCount === 0) return "reconciled";
  if (!(await operation.isCurrent())) return "stale";
  if (!(await operation.permissionGranted())) return "permission-denied";
  if (!(await operation.isCurrent())) return "stale";

  try {
    for (let index = 0; index < operation.scheduleCount; index += 1) {
      if (!(await operation.isCurrent())) {
        await cancelCreated();
        return "stale";
      }
      const identifier = await operation.schedule(index);
      created.push(identifier);
      if (!(await operation.isCurrent())) {
        await cancelCreated();
        return "stale";
      }
    }
  } catch (error) {
    await cancelCreated();
    throw error;
  }

  return "reconciled";
}
