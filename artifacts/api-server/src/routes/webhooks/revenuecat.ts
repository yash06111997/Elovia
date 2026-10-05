import { createHash, timingSafeEqual } from "node:crypto";
import express, {
  Router,
  type ErrorRequestHandler,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  parseRevenueCatDelivery,
  type RevenueCatParseResult,
} from "../../lib/revenuecatContract.js";
import type { RevenueCatProcessorResult } from "../../lib/revenuecatProcessor.js";

const MAX_AUTHORIZATION_BYTES = 1_024;
const RETRY_AFTER_MAX_SECONDS = 60;

export type RevenueCatWebhookProcessor = (
  parsed: RevenueCatParseResult,
) => Promise<RevenueCatProcessorResult>;

export type CreateRevenueCatWebhookRouterOptions = Readonly<{
  processor: RevenueCatWebhookProcessor;
  webhookSecret: string;
}>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(provided: unknown, expectedDigest: Buffer): boolean {
  const value = typeof provided === "string" ? provided : "";
  if (Buffer.byteLength(value, "utf8") > MAX_AUTHORIZATION_BYTES) return false;
  return timingSafeEqual(digest(value), expectedDigest);
}

function boundedLabel(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function retryAfter(result: RevenueCatProcessorResult): string | undefined {
  if (result.status !== 503) return undefined;
  const requested =
    typeof result.retryAfterSeconds === "number" &&
    Number.isFinite(result.retryAfterSeconds)
      ? Math.floor(result.retryAfterSeconds)
      : 1;
  return String(Math.max(1, Math.min(RETRY_AFTER_MAX_SECONDS, requested)));
}

const webhookJsonErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const parserError = error as { status?: number; type?: string };
  if (parserError.status === 413 || parserError.type === "entity.too.large") {
    response.status(413).json({ error: "payload_too_large" });
    return;
  }
  if (
    parserError.status === 400 ||
    parserError.type === "entity.parse.failed"
  ) {
    response.status(400).json({ error: "malformed_json" });
    return;
  }
  next(error);
};

/** Build the pre-authenticated, tightly bounded RevenueCat transport. */
export function createRevenueCatWebhookRouter(
  options: CreateRevenueCatWebhookRouterOptions,
): IRouter {
  if (
    typeof options.webhookSecret !== "string" ||
    options.webhookSecret.length === 0 ||
    Buffer.byteLength(options.webhookSecret, "utf8") > MAX_AUTHORIZATION_BYTES
  ) {
    throw new Error("RevenueCat webhook secret is required.");
  }
  const expectedDigest = digest(options.webhookSecret);
  const router: IRouter = Router();

  router.post(
    "/webhooks/revenuecat",
    (request: Request, response: Response, next: NextFunction) => {
      if (!authorized(request.headers.authorization, expectedDigest)) {
        request.log?.warn(
          { requestId: request.id },
          "Rejected RevenueCat webhook authorization",
        );
        response.status(401).json({ error: "invalid_authorization" });
        return;
      }
      next();
    },
    express.json({ limit: "256kb", strict: true, type: "application/json" }),
    async (request: Request, response: Response, next: NextFunction) => {
      const parsed = parseRevenueCatDelivery(request.body);
      const event =
        request.body && typeof request.body === "object"
          ? (request.body as { event?: Record<string, unknown> }).event
          : undefined;
      try {
        const outcome = await options.processor(parsed);
        const retry = retryAfter(outcome);
        if (retry) response.setHeader("Retry-After", retry);
        request.log?.info(
          {
            requestId: request.id,
            eventId: boundedLabel(event?.id, 128),
            eventType: boundedLabel(event?.type, 64),
            disposition: outcome.disposition,
          },
          "Handled RevenueCat webhook",
        );
        response.status(outcome.status).json({
          received: outcome.status === 200,
          applied: outcome.applied === true,
          disposition: outcome.disposition,
        });
      } catch {
        const disposition = "provider_unavailable" as const;
        request.log?.error(
          {
            requestId: request.id,
            eventId: boundedLabel(event?.id, 128),
            eventType: boundedLabel(event?.type, 64),
            disposition,
          },
          "RevenueCat webhook processor failed",
        );
        response.setHeader("Retry-After", "1");
        response.status(503).json({
          received: false,
          applied: false,
          disposition,
        });
      }
    },
    webhookJsonErrorHandler,
  );

  return router;
}
