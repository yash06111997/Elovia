import type { CloudSyncSessionToken } from "./cloudSyncSession";

export type GuardedCloudSyncResult<T> =
  | { status: "applied"; value: T }
  | { status: "stale" };

/**
 * The production network response boundary. A response is never parsed or
 * applied unless its exact opaque auth session is still current after the
 * request settles, which closes same-uid ABA races.
 */
export function createCloudSyncNetworkOrchestrator(
  isCurrent: (token: CloudSyncSessionToken) => boolean | Promise<boolean>,
) {
  const operationTails = new WeakMap<CloudSyncSessionToken, Promise<void>>();

  return {
    async runExclusive<Value>(
      token: CloudSyncSessionToken,
      operation: () => Promise<Value>,
    ): Promise<GuardedCloudSyncResult<Value>> {
      const previous = operationTails.get(token) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      operationTails.set(token, current);

      await previous;
      try {
        if (!(await isCurrent(token))) return { status: "stale" };
        const value = await operation();
        if (!(await isCurrent(token))) return { status: "stale" };
        return { status: "applied", value };
      } finally {
        release();
        if (operationTails.get(token) === current) operationTails.delete(token);
      }
    },

    async execute<ResponseValue, AppliedValue>(
      token: CloudSyncSessionToken,
      request: () => Promise<ResponseValue>,
      apply: (response: ResponseValue) => Promise<AppliedValue>,
    ): Promise<GuardedCloudSyncResult<AppliedValue>> {
      if (!(await isCurrent(token))) return { status: "stale" };
      const response = await request();
      if (!(await isCurrent(token))) return { status: "stale" };
      return { status: "applied", value: await apply(response) };
    },
  };
}
