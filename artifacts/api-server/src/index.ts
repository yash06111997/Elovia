import app from "./app";
import { startAccountDeletionFinalizer } from "./lib/accountDeletionFinalizer";
import { logger } from "./lib/logger";
import { loadRevenueCatConfig } from "./lib/revenuecatConfig";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startAccountDeletionFinalizer();
});
