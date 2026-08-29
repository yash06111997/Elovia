import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  ProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  type TaskKind,
} from "../types";

/** Highest-quality model; the only one here that can read images. */
const VISION_MODEL = "claude-sonnet-4-6";
/** Cheaper and faster; good enough for conversational coaching. */
const CHAT_MODEL = "claude-haiku-4-5-20251001";
const STRUCTURED_MODEL = "claude-sonnet-4-6";

function modelFor(task: TaskKind): string {
  if (task === "vision") return VISION_MODEL;
  if (task === "chat") return CHAT_MODEL;
  return STRUCTURED_MODEL;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly supports = ["vision", "structured", "chat"] as const;

  isConfigured(): boolean {
    // The Replit integration proxy injects credentials; if the client
    // constructed at import time, we're good.
    return Boolean(anthropic);
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const model = modelFor(opts.task);
    const startedAt = Date.now();

    // Vision requests carry the image as the first content block, followed by
    // the instruction text — the ordering Claude responds to most reliably.
    const content: any[] = [];
    if (opts.image) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: opts.image.mediaType,
          data: opts.image.base64,
        },
      });
    }

    const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
    content.push({ type: "text", text: lastUser?.content ?? "" });

    const priorTurns = opts.messages
      .slice(0, Math.max(0, opts.messages.length - 1))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const message = await anthropic.messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 2048,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.system ? { system: opts.system } : {}),
          messages: [...priorTurns, { role: "user", content }] as any,
        },
        opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
      );

      const block = message.content[0];
      const text = block?.type === "text" ? block.text : "";

      return {
        text,
        usage: {
          inputTokens: message.usage?.input_tokens ?? 0,
          outputTokens: message.usage?.output_tokens ?? 0,
        },
        provider: this.name,
        model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      throw new ProviderError(this.name, err?.message ?? "Anthropic request failed", {
        // 4xx other than 429 means the request itself is wrong; retrying on a
        // different provider would just fail the same way.
        retryable: status === 429 || status === undefined || status >= 500,
        status,
      });
    }
  }
}
