export interface AccountDeletionIdentityWorkClaim {
  userId: string;
  requestId: string;
  leaseId: string;
  attemptCount: number;
}

const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export function accountDeletionRetryDelayMs(attemptCount: number): number {
  const boundedAttempt = Math.max(1, Math.min(attemptCount, 12));
  return Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** (boundedAttempt - 1));
}

export interface AccountDeletionFinalizerDependencies {
  claim(): Promise<AccountDeletionIdentityWorkClaim[]>;
  deleteIdentity(userId: string): Promise<void>;
  finalize(claim: AccountDeletionIdentityWorkClaim): Promise<boolean>;
  reschedule(
    claim: AccountDeletionIdentityWorkClaim,
    nextAttemptAt: Date,
  ): Promise<boolean>;
  now(): Date;
  reportFailure(error: unknown): void;
}

/** Process one leased batch. Failed identity work is durably rescheduled. */
export async function runAccountDeletionFinalizationBatch(
  dependencies: AccountDeletionFinalizerDependencies,
): Promise<{ claimed: number; finalized: number; rescheduled: number }> {
  const claims = await dependencies.claim();
  let finalized = 0;
  let rescheduled = 0;

  for (const claim of claims) {
    try {
      await dependencies.deleteIdentity(claim.userId);
      if (await dependencies.finalize(claim)) finalized += 1;
    } catch (error) {
      dependencies.reportFailure(error);
      const nextAttemptAt = new Date(
        dependencies.now().getTime() +
          accountDeletionRetryDelayMs(claim.attemptCount),
      );
      if (await dependencies.reschedule(claim, nextAttemptAt)) {
        rescheduled += 1;
      }
    }
  }

  return { claimed: claims.length, finalized, rescheduled };
}
