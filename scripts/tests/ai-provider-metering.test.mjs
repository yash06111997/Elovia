import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, test, mock } from "node:test";

const requireScripts = createRequire(
  new URL("../package.json", import.meta.url),
);
const unregister = requireScripts("tsx/esm/api").register();
const saved = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
};
process.env.ANTHROPIC_API_KEY = "test-placeholder-not-a-real-key";
process.env.NVIDIA_API_KEY = "test-placeholder-not-a-real-key";
const { anthropic } =
  await import("../../lib/integrations-anthropic-ai/src/index.ts");
const { AnthropicProvider } =
  await import("../../artifacts/api-server/src/lib/ai/providers/anthropic.ts");
const { NvidiaProvider } =
  await import("../../artifacts/api-server/src/lib/ai/providers/nvidia.ts");
const pricing =
  await import("../../artifacts/api-server/src/lib/ai/pricing.ts");
afterEach(() => mock.restoreAll());
after(() => {
  unregister();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const options = {
  task: "chat",
  messages: [{ role: "user", content: "Hello" }],
  maxTokens: 1024,
};

test("Anthropic SDK cannot retry behind a single cost reservation", async () => {
  let requestOptions;
  mock.method(anthropic.messages, "create", async (_body, opts) => {
    requestOptions = opts;
    return {
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
  await new AnthropicProvider().generate(options);
  assert.equal(requestOptions?.maxRetries, 0);
});

test("Nvidia empty completions still return usage for accounting before validation", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
  const response = await new NvidiaProvider().generate(options);
  assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(response.text, "");
});

test("partial provider usage stays unknown instead of being fabricated as zero", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { content: "Hello" } }],
      usage: { prompt_tokens: 10 },
    }),
  );
  const response = await new NvidiaProvider().generate(options);
  assert.equal(Number.isFinite(response.usage.outputTokens), false);
  mock.method(anthropic.messages, "create", async () => ({
    content: [{ type: "text", text: "Hello" }],
    usage: { input_tokens: 10 },
  }));
  const other = await new AnthropicProvider().generate(options);
  assert.equal(Number.isFinite(other.usage.outputTokens), false);
});

test("reservations budget UTF-8 prompt bytes, maximum output and vision overhead", () => {
  assert.equal(typeof pricing.estimateReservationMicros, "function");
  const plain = pricing.estimateReservationMicros(options);
  const unicode = pricing.estimateReservationMicros({
    ...options,
    messages: [{ role: "user", content: "🙂🙂🙂🙂🙂" }],
  });
  const image = pricing.estimateReservationMicros({
    ...options,
    task: "vision",
    image: { base64: "abc", mediaType: "image/png" },
  });
  assert.ok(Number.isSafeInteger(plain) && plain >= 1024 * 15);
  assert.ok(unicode > plain);
  assert.ok(image > plain);
  assert.throws(() =>
    pricing.estimateReservationMicros({ ...options, maxTokens: Infinity }),
  );
});
