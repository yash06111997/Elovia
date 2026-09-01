export type PendingArrivalListener = (ownerUserId: string) => void;

const listeners = new Set<PendingArrivalListener>();

/** In-process wakeup layered over the durable pending-arrival record. */
export function onPendingArrivalRecorded(
  listener: PendingArrivalListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPendingArrivalRecorded(ownerUserId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(ownerUserId);
    } catch {
      // One observer cannot prevent durable delivery to another observer.
    }
  }
}
