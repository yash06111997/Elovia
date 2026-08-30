import {
  ProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  type TaskKind,
} from "../types";

/**
 * NVIDIA NIM adapter.
 *
 * NIM exposes an OpenAI-compatible chat-completions API, so this is a plain
 * fetch against `integrate.api.nvidia.com` rather than another SDK dependency.
 *
 * Why it's in the routing table at all: open-weight 70B models cost roughly an
 * order of magnitude less per token than a frontier model, and the structured
 * plan-generation task is one where that quality gap is small — the output is
 * constrained by a JSON schema we validate anyway. Vision stays on Claude
 * because these models can't do it and the food-recognition accuracy is what
 * users actually judge.
 */
const NIM_BASE_URL = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
/**
 * NVIDIA retires hosted models on a published end-of-life date, after which the
 * endpoint returns 410 Gone rather than degrading — meta/llama-3.3-70b-instruct
 * died on 2026-08-26 and took every structured route with it. Both defaults are
 * therefore overridable by environment variable, so the next retirement is a
 * config change rather than a deploy.
 *
 * nemotron-3-super was chosen by measurement, not reputation: of the candidates
 * available on this account it was the only one that returned parseable JSON
 * for a plan-shaped schema.
 */
export const STRUCTURED_MODEL =
  process.env.NVIDIA_NIM_STRUCTURED_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
export const CHAT_MODEL =
  process.env.NVIDIA_NIM_CHAT_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";

/** The subset of the OpenAI-compatible response body we actually read. */
interface NimChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function modelFor(task: TaskKind): string {
  return task === "chat" ? CHAT_MODEL : STRUCTURED_MODEL;
}

export class NvidiaProvider implements AiProvider {
  readonly name = "nvidia" as const;
  // Deliberately excludes "vision" — these models cannot accept images, and
  // silently degrading a food photo to a text guess would be worse than
  // failing over to Claude.
  readonly supports = ["structured", "chat"] as const;

  isConfigured(): boolean {
    return Boolean(process.env.NVIDIA_API_KEY);
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new ProviderError(this.name, "NVIDIA_API_KEY is not set", {
        retryable: true,
      });
    }

    const model = modelFor(opts.task);
    const startedAt = Date.now();

    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

    try {
      const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.7,
          // Ask for JSON where the caller wants structure. NIM honours this on
          // most models, but we still parse defensively downstream because
          // support is inconsistent across the catalogue.
          ...(opts.task === "structured"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(
          this.name,
          `NVIDIA NIM returned ${response.status}: ${body.slice(0, 200)}`,
          { retryable: response.status === 429 || response.status >= 500, status: response.status },
        );
      }

      const payload = (await response.json()) as NimChatResponse;
      const text: string = payload?.choices?.[0]?.message?.content ?? "";

      if (!text) {
        throw new ProviderError(this.name, "NVIDIA NIM returned an empty completion");
      }

      return {
        text,
        usage: {
          inputTokens: payload?.usage?.prompt_tokens ?? 0,
          outputTokens: payload?.usage?.completion_tokens ?? 0,
        },
        provider: this.name,
        model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      if (err?.name === "AbortError") {
        throw new ProviderError(this.name, "NVIDIA NIM request timed out");
      }
      throw new ProviderError(this.name, err?.message ?? "NVIDIA NIM request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
