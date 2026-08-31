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
  return {
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
