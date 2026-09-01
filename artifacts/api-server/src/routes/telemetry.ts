import { Router, type IRouter, type Request, type Response } from "express";
import { rateLimit } from "../lib/rateLimit";

const router: IRouter = Router();

const ALLOWED_EVENTS = new Set([
  "onboarding_completed",
  "plan_preview_viewed",
  "paywall_viewed",
  "workout_feedback_submitted",
  "client_error",
  "cloud_sync_failed",
  "account_exported",
  "account_deletion_finalizing",
  "account_deleted",
]);

const ALLOWED_PROPERTY_KEYS = new Set([
  "direction",
  "errorType",
  "painBand",
  "source",
  "status",
  "stepCount",
]);

function safeProperties(
  input: unknown,
): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const safe: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 80);
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    if (typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

router.post(
  "/telemetry",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "telemetry" }),
  (req: Request, res: Response) => {
    const event = typeof req.body?.event === "string" ? req.body.event : "";
    if (!ALLOWED_EVENTS.has(event)) {
      res.status(400).json({ error: "Unknown telemetry event" });
      return;
    }

    const platform = ["ios", "android"].includes(req.body?.platform)
      ? req.body.platform
      : "unknown";
    req.log.info(
      {
        telemetry: {
          event,
          platform,
          appVersion:
            typeof req.body?.appVersion === "string"
              ? req.body.appVersion.slice(0, 30)
              : "unknown",
          properties: safeProperties(req.body?.properties),
        },
      },
      "Mobile telemetry event",
    );
    res.sendStatus(204);
  },
);

export default router;
