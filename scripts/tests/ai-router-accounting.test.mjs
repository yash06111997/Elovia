import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, test, mock } from "node:test";

const require = createRequire(new URL("../package.json", import.meta.url));
const unregister = require("tsx/esm/api").register();
const { generate, ProviderError } =
  await import("../../artifacts/api-server/src/lib/ai/router.ts");
const { NvidiaProvider } =
  await import("../../artifacts/api-server/src/lib/ai/providers/nvidia.ts");
const { AnthropicProvider } =
  await import("../../artifacts/api-server/src/lib/ai/providers/anthropic.ts");
const originalPreference = process.env.AI_PREFER_QUALITY;
delete process.env.AI_PREFER_QUALITY;
after(() => {
  mock.restoreAll();
  unregister();
  if (originalPreference === undefined) delete process.env.AI_PREFER_QUALITY;
  else process.env.AI_PREFER_QUALITY = originalPreference;
});
beforeEach(() => {
  mock.restoreAll();
  // Only replace the external provider boundary; exercise the real router.
  mock.method(NvidiaProvider.prototype, "isConfigured", () => true);
  mock.method(AnthropicProvider.prototype, "isConfigured", () => true);
});
const options = {
  task: "structured",
  messages: [{ role: "user", content: "Plan" }],
};
function result(provider, text = "{}") {
  return {
    provider,
    text,
    model: "claude-sonnet-4-6",
    usage: { inputTokens: 100, outputTokens: 20 },
    latencyMs: 1,
  };
}

test("each response is accounted before validation, including rejected fallback output", async () => {
  const events = [];
  mock.method(NvidiaProvider.prototype, "generate", async () => {
    events.push("call:nvidia");
    return result("nvidia", "invalid");
  });
  mock.method(AnthropicProvider.prototype, "generate", async () => {
    events.push("call:anthropic");
    return result("anthropic");
  });
  const answer = await generate(
    {
      ...options,
      validate(text) {
        events.push(`validate:${text}`);
        JSON.parse(text);
      },
    },
    undefined,
    {
      async reserve(provider) {
        events.push(`reserve:${provider}`);
        return provider;
      },
      async settle(id, response) {
        events.push(`settle:${id}`);
        assert.equal(response.estimatedCostMicros, 600);
      },
    },
  );
  assert.equal(answer.provider, "anthropic");
  assert.deepEqual(events, [
    "reserve:nvidia",
    "call:nvidia",
    "settle:nvidia",
    "validate:invalid",
    "reserve:anthropic",
    "call:anthropic",
    "settle:anthropic",
    "validate:{}",
  ]);
});

test("reservation failure dispatches no provider call", async () => {
  let calls = 0;
  mock.method(NvidiaProvider.prototype, "generate", async () => {
    calls++;
    return result("nvidia");
  });
  mock.method(AnthropicProvider.prototype, "generate", async () => {
    calls++;
    return result("anthropic");
  });
  const failure = new Error("budget unavailable");
  await assert.rejects(
    generate(options, undefined, {
      async reserve() {
        throw failure;
      },
      async settle() {
        assert.fail("no response to settle");
      },
    }),
    (err) => err === failure,
  );
  assert.equal(calls, 0);
});

test("accounting failure stops fallback and validation after a paid response", async () => {
  let fallbackCalls = 0;
  let validated = false;
  mock.method(NvidiaProvider.prototype, "generate", async () =>
    result("nvidia"),
  );
  mock.method(AnthropicProvider.prototype, "generate", async () => {
    fallbackCalls++;
    return result("anthropic");
  });
  const failure = new Error("database unavailable");
  await assert.rejects(
    generate(
      {
        ...options,
        validate() {
          validated = true;
        },
      },
      undefined,
      {
        async reserve() {
          return "attempt";
        },
        async settle() {
          throw failure;
        },
      },
    ),
    (err) => err === failure,
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(validated, false);
});

test("unknown timeout cost remains reserved and fallback gets its own reservation", async () => {
  const pending = new Set();
  mock.method(NvidiaProvider.prototype, "generate", async () => {
    throw new ProviderError("nvidia", "timeout");
  });
  mock.method(AnthropicProvider.prototype, "generate", async () =>
    result("anthropic"),
  );
  await generate(options, undefined, {
    async reserve(provider) {
      pending.add(provider);
      return provider;
    },
    async settle(id) {
      pending.delete(id);
    },
  });
  assert.deepEqual([...pending], ["nvidia"]);
});

test("provider errors do not copy response content into failover telemetry", async () => {
  const logs = [];
  mock.method(NvidiaProvider.prototype, "generate", async () => {
    throw new ProviderError("nvidia", "private health text", { status: 500 });
  });
  mock.method(AnthropicProvider.prototype, "generate", async () =>
    result("anthropic"),
  );
  const answer = await generate(
    options,
    { warn: (...args) => logs.push(args) },
    {
      async reserve(provider) {
        return provider;
      },
      async settle() {},
    },
  );
  assert.ok(
    !JSON.stringify([logs, answer.attempted]).includes("private health text"),
  );
});
