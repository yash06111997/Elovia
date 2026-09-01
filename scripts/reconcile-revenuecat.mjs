import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

function batchSizeFromArguments(arguments_) {
  const option = arguments_.find((argument) =>
    argument.startsWith("--batch-size="),
  );
  if (!option) return 100;
  const value = Number(option.slice("--batch-size=".length));
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("--batch-size must be an integer between 1 and 1000");
  }
  return value;
}

const require = createRequire(new URL("./package.json", import.meta.url));
const { register } = require("tsx/esm/api");
const unregister = register();
try {
  const { bootstrapRevenueCatCustomers, revenueCatRuntimeFromEnvironment } =
    await import("../artifacts/api-server/src/lib/revenuecatWorker.ts");
  const result = await bootstrapRevenueCatCustomers({
    ...revenueCatRuntimeFromEnvironment(),
    runId: randomUUID(),
    batchSize: batchSizeFromArguments(process.argv.slice(2)),
  });
  process.stdout.write(
    `${JSON.stringify({ attempted: result.attempted, unreconciled: result.remaining })}\n`,
  );
  if (result.remaining !== 0) process.exitCode = 1;
} finally {
  await unregister();
}
