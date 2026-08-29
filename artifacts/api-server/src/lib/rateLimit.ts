import { type Request, type Response, type NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal fixed-window rate limiter, no dependencies.
 *
 * Scope note: this is per-process. The deployment target is Replit autoscale,
 * so with N instances the effective ceiling is N x max. That is acceptable
 * because this is NOT the primary cost control — per-user daily quotas in
 * `aiQuota.ts` are, and those are backed by Postgres and therefore global.
 * This limiter exists to blunt unauthenticated floods and brute-force attempts
 * before they reach token verification.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    // Amortised cleanup so the map cannot grow without bound under churn.
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    // Prefer the authenticated identity; fall back to IP for anonymous traffic.
    const identity = req.user?.id ?? req.ip ?? "unknown";
    const key = `${opts.keyPrefix ?? "rl"}:${identity}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader("X-RateLimit-Window-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Window-Remaining", String(remaining));

    if (bucket.count > opts.max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: opts.message ?? "Too many requests. Please slow down.",
        code: "rate_limited",
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}
