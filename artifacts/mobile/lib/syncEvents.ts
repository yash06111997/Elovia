type Listener = () => void;

const restoreListeners: Listener[] = [];

export function onDataRestored(listener: Listener): () => void {
  restoreListeners.push(listener);
  return () => {
    const idx = restoreListeners.indexOf(listener);
    if (idx >= 0) restoreListeners.splice(idx, 1);
  };
}

export function emitDataRestored(): void {
  restoreListeners.forEach((l) => l());
}
