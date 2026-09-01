export type GeofenceReconciliationOutcome =
  | "reconciled"
  | "permission-denied"
  | "stale";

export async function runGeofenceReconciliation(options: {
  isCurrent(): Promise<boolean>;
  stop(): Promise<void>;
  permissionGranted(): Promise<boolean>;
  start(): Promise<void>;
  hasEnabledPlaces: boolean;
}): Promise<GeofenceReconciliationOutcome> {
  if (!(await options.isCurrent())) return "stale";
  await options.stop();
  if (!(await options.isCurrent())) return "stale";
  if (!options.hasEnabledPlaces) return "reconciled";
  if (!(await options.permissionGranted())) return "permission-denied";
  if (!(await options.isCurrent())) return "stale";
  await options.start();
  if (await options.isCurrent()) return "reconciled";

  // Native start calls cannot be aborted; remove a stale account's regions
  // before releasing the serialized queue to the next owner.
  try {
    await options.stop();
  } catch {
    // The next owner reconciliation begins with another stop.
  }
  return "stale";
}
