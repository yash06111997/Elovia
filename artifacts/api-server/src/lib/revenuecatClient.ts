// The repository's contract tests execute TypeScript directly in Node, while
// production is bundled by esbuild. The explicit extension is required by the
// former and resolved by the latter.
// @ts-expect-error TypeScript requires allowImportingTsExtensions for this path.
import { CanonicalRevenueCatError, parseCanonicalRevenueCatSnapshot } from "./revenuecatSnapshot.ts";
import type { CanonicalRevenueCatSnapshot } from "./revenuecatSnapshot";

declare const trustedLocalUidBrand: unique symbol;
export type TrustedLocalUid = string & {
  readonly [trustedLocalUidBrand]: "authenticated-local-uid";
};

export type RevenueCatClientErrorCode =
  | "revenuecat_request_invalid"
  | "revenuecat_configuration_invalid"
  | "revenuecat_unavailable"
  | "revenuecat_timeout"
  | "canonical_response_invalid";

export class RevenueCatClientError extends Error {
  readonly code: RevenueCatClientErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    code: RevenueCatClientErrorCode,
    retryable: boolean,
    status: number | null = null,
  ) {
    const messages: Record<RevenueCatClientErrorCode, string> = {
      revenuecat_request_invalid: "RevenueCat rejected the canonical request",
      revenuecat_configuration_invalid:
        "RevenueCat rejected the server configuration",
      revenuecat_unavailable: "RevenueCat canonical service is unavailable",
      revenuecat_timeout: "RevenueCat canonical request timed out",
      canonical_response_invalid: "RevenueCat canonical response is invalid",
    };
    super(messages[code]);
    this.name = "RevenueCatClientError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

type FetchImplementation = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

export type RevenueCatClientOptions = Readonly<{
  apiKey: string;
  fetchImpl?: FetchImplementation;
  clock?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

export type RevenueCatLookup = Readonly<{
  lookup: "existing" | "created";
  snapshot: CanonicalRevenueCatSnapshot;
}>;

export type RevenueCatClient = Readonly<{
  getSubscriber(uid: TrustedLocalUid): Promise<RevenueCatLookup>;
}>;

const MAX_CANONICAL_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 5_000;

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validUid(value: string): boolean {
  const trimmed = value.trim();
  return (
    value === trimmed &&
    [...value].length >= 1 &&
    [...value].length <= 256 &&
    isWellFormed(value) &&
    !/[\p{Cc}]/u.test(value)
  );
}

/** Establish this brand only from a UID already verified by Firebase auth. */
export function trustAuthenticatedLocalUid(uid: string): TrustedLocalUid {
  if (!validUid(uid)) {
    throw new RevenueCatClientError("revenuecat_request_invalid", false);
  }
  return uid as TrustedLocalUid;
}

async function boundedResponseBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > maximum) {
      throw new RevenueCatClientError("canonical_response_invalid", true);
    }
  }

  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new RevenueCatClientError("canonical_response_invalid", true);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RevenueCatClientError) throw error;
    throw new RevenueCatClientError("canonical_response_invalid", true);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RevenueCatClientError("canonical_response_invalid", true);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RevenueCatClientError("canonical_response_invalid", true);
  }
}

function statusError(status: number): RevenueCatClientError {
  if (status === 400) {
    return new RevenueCatClientError(
      "revenuecat_request_invalid",
      false,
      status,
    );
  }
  if (status === 401) {
    return new RevenueCatClientError(
      "revenuecat_configuration_invalid",
      false,
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new RevenueCatClientError("revenuecat_unavailable", true, status);
  }
  return new RevenueCatClientError("canonical_response_invalid", true, status);
}

export function createRevenueCatClient(
  options: RevenueCatClientOptions,
): RevenueCatClient {
  if (
    typeof options.apiKey !== "string" ||
    options.apiKey.trim().length === 0 ||
    Buffer.byteLength(options.apiKey, "utf8") > 1_024 ||
    !isWellFormed(options.apiKey)
  ) {
    throw new RevenueCatClientError("revenuecat_configuration_invalid", false);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? MAX_CANONICAL_RESPONSE_BYTES;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > MAX_CANONICAL_RESPONSE_BYTES
  ) {
    throw new RevenueCatClientError("revenuecat_configuration_invalid", false);
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const clock = options.clock ?? (() => new Date());

  return Object.freeze({
    async getSubscriber(uid: TrustedLocalUid): Promise<RevenueCatLookup> {
      if (typeof uid !== "string" || !validUid(uid)) {
        throw new RevenueCatClientError("revenuecat_request_invalid", false);
      }
      const requestStartedAt = clock();
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchImpl(
          `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              Accept: "application/json",
            },
            signal: controller.signal,
          },
        );

        const responseReceivedAt = clock();
        if (response.status !== 200 && response.status !== 201) {
          throw statusError(response.status);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
          throw new RevenueCatClientError("canonical_response_invalid", true);
        }
        const bytes = await boundedResponseBytes(response, maxResponseBytes);
        const decoded = decodeJson(bytes);
        let snapshot: CanonicalRevenueCatSnapshot;
        try {
          snapshot = parseCanonicalRevenueCatSnapshot(decoded, {
            requestStartedAt,
            responseReceivedAt,
          });
        } catch (error) {
          if (error instanceof CanonicalRevenueCatError) {
            throw new RevenueCatClientError("canonical_response_invalid", true);
          }
          throw new RevenueCatClientError("canonical_response_invalid", true);
        }
        return Object.freeze({
          lookup: response.status === 200 ? "existing" : "created",
          snapshot,
        });
      } catch (error) {
        if (timedOut || controller.signal.aborted) {
          throw new RevenueCatClientError("revenuecat_timeout", true);
        }
        if (error instanceof RevenueCatClientError) throw error;
        throw new RevenueCatClientError("revenuecat_unavailable", true);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
