import cors from "cors";
import express, {
  type Express,
  type IRouter,
  type RequestHandler,
} from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.js";
import { apiErrorHandler } from "./middlewares/apiErrorHandler.js";

export type CreateAppOptions = Readonly<{
  revenueCatRouter: IRouter;
  authenticatedRouter: IRouter;
  authMiddlewareImpl: RequestHandler;
}>;

/**
 * Create the HTTP application without importing database-backed routes.
 * Production dependency assembly belongs in index.ts; tests can inject only
 * the boundary under test without a DATABASE_URL or Firebase runtime.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();

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
  app.use(cors({ credentials: true, origin: true }));

  // RevenueCat has its own authentication and a much smaller body budget.
  app.use("/api", options.revenueCatRouter);

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true, limit: "20mb" }));
  app.use(options.authMiddlewareImpl);
  app.use("/api", options.authenticatedRouter);
  app.use(apiErrorHandler);

  return app;
}
