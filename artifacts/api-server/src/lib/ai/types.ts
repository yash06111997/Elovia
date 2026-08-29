/**
 * Provider-agnostic AI types.
 *
 * The point of this layer is that route handlers never name a model. They
 * declare a TASK ("generate structured JSON", "read this image"), and the
 * router picks a provider that can serve it. Swapping providers is then a
 * routing-table edit, not a rewrite of every handler.
 */

export type TaskKind =
  /** Image in, structured data out. Only vision-capable models qualify. */
  | "vision"
  /** Text in, schema-conforming JSON out. The bulk of plan generation. */
  | "structured"
  /** Conversational coaching. Latency matters more than peak quality. */
  | "chat";

export type ProviderName = "anthropic" | "nvidia" | "deterministic";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  task: TaskKind;
  system?: string;
  messages: AiMessage[];
  /** Base64 image payload, vision tasks only. */
  image?: { base64: string; mediaType: string };
  maxTokens?: number;
  temperature?: number;
  /** Abort the upstream call after this many ms. */
  timeoutMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  provider: ProviderName;
  model: string;
  /** Wall-clock time for the upstream call, for routing telemetry. */
  latencyMs: number;
}

export interface AiProvider {
  readonly name: ProviderName;
  /** Which tasks this provider is allowed to serve. */
  readonly supports: readonly TaskKind[];
  /** False when the required API key is absent, so the router can skip it. */
  isConfigured(): boolean;
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}

/** Thrown when a provider fails in a way the router should retry elsewhere. */
export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    provider: ProviderName,
    message: string,
    opts?: { retryable?: boolean; status?: number },
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = opts?.retryable ?? true;
    this.status = opts?.status;
  }
}
