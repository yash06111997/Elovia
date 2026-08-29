import type { ProviderName, TokenUsage } from "./types";

/**
 * Cost table, in micro-USD (1e-6 USD) per MILLION tokens.
 *
 * Kept as plain data so it can be corrected without touching call sites. These
 * are list prices and will drift; the accounting they feed is used for
 * per-user daily ceilings, where being approximately right is sufficient. It is
 * NOT billing-grade and shouldn't be shown to users as an exact charge.
 */
interface ModelCost {
  inputPerMillion: number;
  outputPerMillion: number;
}

const COSTS: Record<string, ModelCost> = {
  // Anthropic
  "claude-sonnet-4-6": { inputPerMillion: 3_000_000, outputPerMillion: 15_000_000 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 1_000_000, outputPerMillion: 5_000_000 },

  // NVIDIA NIM — open-weight models, roughly an order of magnitude cheaper.
  // This is the whole economic argument for routing structured generation here.
  "meta/llama-3.3-70b-instruct": { inputPerMillion: 120_000, outputPerMillion: 300_000 },
  "nvidia/llama-3.1-nemotron-70b-instruct": {
    inputPerMillion: 120_000,
    outputPerMillion: 300_000,
  },
};

/** Conservative default for an unknown model, so cost is never under-counted. */
const DEFAULT_COST: ModelCost = {
  inputPerMillion: 3_000_000,
  outputPerMillion: 15_000_000,
};

export function estimateCostMicros(
  model: string,
  usage: TokenUsage,
  provider: ProviderName,
): number {
  if (provider === "deterministic") return 0;

  const cost = COSTS[model] ?? DEFAULT_COST;
  const input = (usage.inputTokens * cost.inputPerMillion) / 1_000_000;
  const output = (usage.outputTokens * cost.outputPerMillion) / 1_000_000;
  return Math.ceil(input + output);
}

export function formatMicrosAsUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}
