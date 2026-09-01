import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  batchSizeFromArguments,
  bootstrapExitCode,
} from "./reconcile-revenuecat-core.mjs";

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
  process.exitCode = bootstrapExitCode(result.remaining);
} finally {
  await unregister();
}
