import cors from "cors";
import express, {
  type Express,
  type IRouter,
  type RequestHandler,
} from "express";
import pinoHttp from "pino-http";
import { createCorsOptions } from "./lib/httpPolicy.js";
import { logger } from "./lib/logger.js";
import { apiErrorHandler } from "./middlewares/apiErrorHandler.js";

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type CreateAppOptions = Readonly<{
  revenueCatRouter: IRouter;
  authenticatedRouter: IRouter;
  authMiddlewareImpl: RequestHandler;
  environment?: Environment;
}>;

/**
 * Create the HTTP application without importing database-backed routes.
 * Production dependency assembly belongs in index.ts; tests can inject only
 * the boundary under test without a DATABASE_URL or Firebase runtime.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const environment = options.environment ?? process.env;

  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(request) {
          return {
            id: request.id,
            method: request.method,
            url: request.url?.split("?")[0],
          };
        },
        res(response) {
          return { statusCode: response.statusCode };
        },
      },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(cors(createCorsOptions(environment)));

  // RevenueCat has its own authentication and a much smaller body budget.
  app.use("/api", options.revenueCatRouter);

  // Meal photos inflate by about 4/3 when base64 encoded, and cloud snapshots
  // can legitimately be larger than ordinary API commands. Keep those two
  // known routes bounded separately instead of giving every unauthenticated
  // request the former 20 MiB parsing budget.
  app.use("/api/ai/recognize-food", express.json({ limit: "9mb" }));
  app.use("/api/user-data", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    express.urlencoded({
      extended: false,
      limit: "64kb",
      parameterLimit: 100,
    }),
  );
  app.use(options.authMiddlewareImpl);
  app.use("/api", options.authenticatedRouter);
  app.use(apiErrorHandler);

  return app;
}
