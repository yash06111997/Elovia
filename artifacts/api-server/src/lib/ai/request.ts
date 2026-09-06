import type { Request, Response } from "express";
import { generate, type GenerateOptions } from "./router";
import { estimateReservationMicros } from "./pricing";
import {
  AiAccountingError,
  AiBudgetError,
  reserveAttempt,
  settleAttempt,
} from "../aiQuota";

/** The only entry point for user-facing provider calls. */
export async function generateForRequest(req: Request, opts: GenerateOptions) {
  const claim = req.quota?.claim;
  if (!claim || claim.userId !== req.user?.id) throw new AiAccountingError();
  async function account<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (err instanceof AiBudgetError) throw err;
      // Database errors may embed parameters; never log them or trigger fallback.
      req.log.error(
        { route: req.aiRoute },
        "AI accounting unavailable; stopping provider calls",
      );
      throw new AiAccountingError();
    }
  }
  return generate(opts, req.log, {
    async reserve(provider, options) {
      if (req.res?.destroyed || req.res?.writableEnded)
        throw new AiAccountingError();
      return account(() =>
        reserveAttempt(claim, provider, estimateReservationMicros(options)),
      );
    },
    async settle(attemptId, result) {
      await account(() =>
        settleAttempt(claim, attemptId, {
          ...result.usage,
          estimatedCostMicros: result.estimatedCostMicros,
          provider: result.provider,
          model: result.model,
        }),
      );
    },
  });
}

export function respondWithAccountingFailure(
  res: Response,
  err: unknown,
): boolean {
  if (res.destroyed || res.headersSent) return true;
  if (err instanceof AiBudgetError) {
    res
      .status(429)
      .json({ error: err.message, code: err.code, resetsAt: err.resetsAt });
    return true;
  }
  if (err instanceof AiAccountingError) {
    res
      .status(503)
      .json({
        error: "Could not verify AI usage. Please try again later.",
        code: err.code,
      });
    return true;
  }
  return false;
}
