import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic client.
 *
 * Works with either a standard Anthropic API key or a proxy that injects one.
 *
 * This used to require AI_INTEGRATIONS_ANTHROPIC_BASE_URL and throw at module
 * scope when it was missing. That base URL is a Replit AI-integration proxy, so
 * the server could not start anywhere else - and because the throw happened
 * during import, it took down every route, including the diagnostics endpoint
 * whose whole job is explaining what is misconfigured.
 *
 * Resolution order for the key:
 *   1. ANTHROPIC_API_KEY               - a normal key from console.anthropic.com
 *   2. AI_INTEGRATIONS_ANTHROPIC_API_KEY - a proxy-provisioned key
 *
 * The base URL is optional. Set ANTHROPIC_BASE_URL (or the AI_INTEGRATIONS_
 * variant) only when routing through a proxy; otherwise the SDK's default
 * endpoint is used.
 *
 * ANTHROPIC_WORKSPACE_ID is optional but REQUIRED for identity-linked keys.
 * Those are scoped to a person rather than a workspace, so the API cannot infer
 * which workspace to bill and rejects every request with:
 *
 *   "anthropic-workspace-id is required when authenticating with an
 *    identity-linked API key"
 *
 * A plain workspace key needs no such header, which is why this stays optional.
 */

function resolveApiKey(): string | undefined {
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
    undefined
  );
}

/**
 * Workspace to bill requests to. Only meaningful for identity-linked keys;
 * harmless to send with a workspace key that already implies one.
 */
function resolveWorkspaceId(): string | undefined {
  return process.env.ANTHROPIC_WORKSPACE_ID || undefined;
}

function resolveBaseUrl(): string | undefined {
  return (
    process.env.ANTHROPIC_BASE_URL ||
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
    undefined
  );
}

/** True when a key is present. Lets callers report the state honestly. */
export function isAnthropicConfigured(): boolean {
  return Boolean(resolveApiKey());
}

let client: Anthropic | null = null;
let attempted = false;

/**
 * The client, or null when no key is configured.
 *
 * Deliberately lazy so importing this module can never prevent the server from
 * starting. A missing key should disable AI features, not the whole process.
 */
export function getAnthropic(): Anthropic | null {
  if (attempted) return client;
  attempted = true;

  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  const baseURL = resolveBaseUrl();
  const workspaceId = resolveWorkspaceId();

  try {
    client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(workspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
        : {}),
    });
  } catch {
    client = null;
  }

  return client;
}

/**
 * Back-compat proxy for existing `anthropic.messages.create(...)` call sites.
 *
 * Resolves the real client on first property access and throws a clear,
 * actionable error at CALL time rather than import time.
 */
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const real = getAnthropic();
    if (!real) {
      throw new Error(
        "Anthropic is not configured. Set ANTHROPIC_API_KEY (get one at console.anthropic.com).",
      );
    }
    return Reflect.get(real as object, prop, receiver);
  },
});
