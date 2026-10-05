/** Serialize store identity changes with purchases/restores, never across accounts. */
export function createStoreIdentity(sdk: { logIn: (id: string) => Promise<unknown>; logOut: () => Promise<unknown> }) {
  let desired: string | null = null;
  let connected: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function connect(id: string | null) {
    if (connected === id) return;
    if (id) await sdk.logIn(id);
    else if (connected) await sdk.logOut();
    connected = id;
  }
  return {
    setDesired(id: string | null) { desired = id; },
    sync() {
      const id = desired;
      return enqueue(async () => {
        if (desired !== id) return false;
        await connect(id);
        return desired === id;
      });
    },
    run<T>(id: string | null, operation: () => Promise<T>): Promise<T> {
      return enqueue(async () => {
        if (!id || desired !== id) throw new Error("Sign in to your account before subscribing or restoring.");
        await connect(id);
        if (desired !== id) throw new Error("Your account changed. Please try again.");
        return operation();
      });
    },
  };
}
