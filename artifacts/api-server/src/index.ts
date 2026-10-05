import { createApp } from "./app";
import { startAccountDeletionFinalizer } from "./lib/accountDeletionFinalizer";
import { createRevenueCatClient } from "./lib/revenuecatClient";
import { logger } from "./lib/logger";
import { loadRevenueCatConfig } from "./lib/revenuecatConfig";
import { processRevenueCatParseResult } from "./lib/revenuecatProcessor";
import { startRevenueCatWorkers } from "./lib/revenuecatWorker";
import { authMiddleware } from "./middlewares/authMiddleware";
import authenticatedRouter from "./routes";
import { createRevenueCatWebhookRouter } from "./routes/webhooks/revenuecat";

// Validate every RevenueCat invariant before listen so an unsafe runtime never
// advertises readiness or accepts traffic.
const revenueCatConfig = loadRevenueCatConfig(process.env);
const revenueCatClient = createRevenueCatClient({
  apiKey: revenueCatConfig.apiKey,
});
const revenueCatRouter = createRevenueCatWebhookRouter({
  webhookSecret: revenueCatConfig.webhookSecret,
  processor: (parsed) =>
    processRevenueCatParseResult({
      parsed,
      config: revenueCatConfig,
      client: revenueCatClient,
      metric(metric) {
        logger.info(metric, "RevenueCat webhook metric");
      },
    }),
});
const app = createApp({
  revenueCatRouter,
  authenticatedRouter,
  authMiddlewareImpl: authMiddleware,
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let stopAccountDeletionFinalizer: (() => void) | null = null;
let stopRevenueCatWorkers: (() => void) | null = null;
const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  stopAccountDeletionFinalizer = startAccountDeletionFinalizer();
  stopRevenueCatWorkers = startRevenueCatWorkers();
});

function shutdown(): void {
  stopRevenueCatWorkers?.();
  stopAccountDeletionFinalizer?.();
  server.close((error) => {
    if (error) logger.error({ errorType: error.name }, "Server shutdown failed");
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
