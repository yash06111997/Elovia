import { AnthropicProvider } from "./providers/anthropic";
import { NvidiaProvider } from "./providers/nvidia";
import { estimateCostMicros } from "./pricing";
import {
  ProviderError,
  type AiProvider,
  type GenerateOptions,
  type GenerateResult,
  type ProviderName,
  type TaskKind,
} from "./types";

const anthropicProvider = new AnthropicProvider();
const nvidiaProvider = new NvidiaProvider();

const REGISTRY: Record<Exclude<ProviderName, "deterministic">, AiProvider> = {
  anthropic: anthropicProvider,
  nvidia: nvidiaProvider,
};

/**
 * Task -> ordered provider preference.
 *
 * The order encodes the actual argument for multi-provider:
 *
 *   vision      Claude only. NIM's open-weight models cannot read images, and
 *               food-photo accuracy is the feature users judge most harshly.
 *
 *   structured  NIM first. Workout and meal plans come back as schema-validated
 *               JSON, so the frontier-model quality premium buys little, while
 *               the token cost is ~10x lower. Claude is the fallback, which
 *               means a NIM outage degrades cost, not availability.
 *
 *   chat        NIM first for latency and cost; Claude behind it.
 *
 * Set AI_PREFER_QUALITY=1 to invert the cheap-first ordering — useful for
 * comparing output quality against the cost saving with real traffic.
 */
const ROUTING: Record<TaskKind, ProviderName[]> = {
  vision: ["anthropic"],
  structured: ["nvidia", "anthropic"],
  chat: ["nvidia", "anthropic"],
};

function preferQuality(): boolean {
  return process.env.AI_PREFER_QUALITY === "1";
}

function chainFor(task: TaskKind): AiProvider[] {
  let names = ROUTING[task] ?? ["anthropic"];
  if (preferQuality()) {
    names = [...names].sort((a, b) => (a === "anthropic" ? -1 : b === "anthropic" ? 1 : 0));
  }

  return names
    .map((n) => REGISTRY[n as Exclude<ProviderName, "deterministic">])
    .filter((p): p is AiProvider => Boolean(p))
    .filter((p) => p.supports.includes(task))
    // Skipping unconfigured providers is what makes NVIDIA optional: with no
    // NVIDIA_API_KEY set, structured traffic silently routes to Claude and the
    // app works exactly as before.
    .filter((p) => p.isConfigured());
}

export interface RoutedResult extends GenerateResult {
  estimatedCostMicros: number;
  /** Providers that failed before this one succeeded, for telemetry. */
  attempted: { provider: ProviderName; error: string }[];
}

/**
 * Run a task through the preferred provider chain, falling back on retryable
 * failures. Non-retryable errors (a malformed request, a 400) abort immediately
 * rather than replaying the same bad request against every provider in turn.
 */
export async function generate(
  opts: GenerateOptions,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<RoutedResult> {
  const chain = chainFor(opts.task);

  if (chain.length === 0) {
    throw new ProviderError(
      "anthropic",
      `No configured AI provider can serve task "${opts.task}"`,
      { retryable: false },
    );
  }

  const attempted: { provider: ProviderName; error: string }[] = [];
  let lastError: unknown;

  for (const provider of chain) {
    try {
      const result = await provider.generate(opts);

      // Validate before accepting. A provider that answers with unparseable
      // output has failed just as surely as one that timed out, and should
      // hand over to the next in the chain rather than end the request.
      opts.validate?.(result.text);

      return {
        ...result,
        estimatedCostMicros: estimateCostMicros(result.model, result.usage, result.provider),
        attempted,
      };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      attempted.push({ provider: provider.name, error: message });

      log?.warn(
        { provider: provider.name, task: opts.task, err: message },
        "AI provider failed, trying next in chain",
      );

      if (err instanceof ProviderError && !err.retryable) throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("anthropic", "All AI providers failed");
}

/**
 * Pull a JSON object out of a model response.
 *
 * Models wrap JSON in prose or fenced code blocks unpredictably, and this is
 * the single most common cause of a "the AI broke" bug report. Strips fences
 * first, then falls back to the outermost brace-balanced span rather than a
 * greedy regex, which mis-handles nested objects.
 */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // fall through to brace scanning
  }

  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in model response");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as T;
      }
    }
  }

  throw new Error("Unbalanced JSON in model response");
}

export { ProviderError } from "./types";
export type { TaskKind, GenerateOptions } from "./types";
