type Listener = () => unknown | Promise<unknown>;

export type DataRestoreReloadOutcome =
  | { status: "reloaded" }
  | { status: "failed"; failures: number };

const restoreListeners: Listener[] = [];

export function onDataRestored(listener: Listener): () => void {
  restoreListeners.push(listener);
  return () => {
    const idx = restoreListeners.indexOf(listener);
    if (idx >= 0) restoreListeners.splice(idx, 1);
  };
}

export async function emitDataRestored(): Promise<DataRestoreReloadOutcome> {
  const settled = await Promise.allSettled(
    [...restoreListeners].map((listener) => Promise.resolve().then(listener)),
  );
  const failures = settled.filter(
    (result) => result.status === "rejected",
  ).length;
  return failures > 0 ? { status: "failed", failures } : { status: "reloaded" };
}
