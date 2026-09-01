export type NativeReconciliationRetryOutcome =
  | "reconciled"
  | "stale"
  | "pending";

export interface NativeReconciliationRetryOptions {
  isCurrent(): boolean;
  reconcile(): Promise<boolean>;
  wait(delayMs: number): Promise<void>;
  onFailure?(attempt: number, willRetry: boolean): void;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/** Bounded, account-generation-guarded native reconciliation retry. */
export async function runNativeReconciliationWithRetry(
  options: NativeReconciliationRetryOptions,
): Promise<NativeReconciliationRetryOutcome> {
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!options.isCurrent()) return "stale";
    let reconciled = false;
    try {
      reconciled = await options.reconcile();
    } catch {
      reconciled = false;
    }
    if (!options.isCurrent()) return "stale";
    if (reconciled) return "reconciled";

    const willRetry = attempt < maxAttempts;
    options.onFailure?.(attempt, willRetry);
    if (!willRetry) return "pending";
    await options.wait(retryDelayMs * attempt);
  }

  return "pending";
}
