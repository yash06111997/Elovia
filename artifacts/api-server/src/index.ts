import app from "./app";
import { startAccountDeletionFinalizer } from "./lib/accountDeletionFinalizer";
import { logger } from "./lib/logger";
import { loadRevenueCatConfig } from "./lib/revenuecatConfig";
import { startRevenueCatWorkers } from "./lib/revenuecatWorker";

// Validate every RevenueCat invariant before listen so an unsafe runtime never
// advertises readiness or accepts traffic.
const revenueCatConfig = loadRevenueCatConfig(process.env);
void revenueCatConfig;

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
