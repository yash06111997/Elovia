import { randomUUID } from "node:crypto";

import {
  claimPendingAccountDeletionIdentities,
  finalizeClaimedAccountDeletionIdentity,
  rescheduleClaimedAccountDeletionIdentity,
} from "./accountDeletion";
import { runAccountDeletionFinalizationBatch } from "./accountDeletionFinalizerCore";
import { deleteFirebaseUser } from "./auth";
import { logger } from "./logger";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_BATCH_SIZE = 10;

export function startAccountDeletionFinalizer(options?: {
  intervalMs?: number;
  leaseSeconds?: number;
  batchSize?: number;
}): () => void {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const leaseSeconds = options?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };

  const run = async () => {
    if (stopped || running) return;
    running = true;
    const leaseId = randomUUID();
    try {
      await runAccountDeletionFinalizationBatch({
        claim: () =>
          claimPendingAccountDeletionIdentities({
            leaseId,
            limit: batchSize,
            leaseSeconds,
          }),
        deleteIdentity: deleteFirebaseUser,
        finalize: finalizeClaimedAccountDeletionIdentity,
        reschedule: rescheduleClaimedAccountDeletionIdentity,
        now: () => new Date(),
        reportFailure(error) {
          logger.warn(
            {
              errorType: error instanceof Error ? error.name : "UnknownError",
            },
            "Account identity deletion will retry",
          );
        },
      });
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : "UnknownError" },
        "Account identity finalizer batch failed",
      );
    } finally {
      running = false;
      schedule();
    }
  };

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
