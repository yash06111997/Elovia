import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, subscriptionsTable, aiUsageTable, userDataTable, usersTable } from "@workspace/db";
import { isAnthropicConfigured } from "@workspace/integrations-anthropic-ai";
import { requireAuth } from "../middlewares/aiGate";
import { STRUCTURED_MODEL as NVIDIA_STRUCTURED_MODEL } from "../lib/ai/providers/nvidia";
import { loadRevenueCatConfig } from "../lib/revenuecatConfig";
import { buildRevenueCatDiagnostics } from "../lib/revenuecatPresentation";

const router: IRouter = Router();

type Health = "ok" | "degraded" | "not_configured" | "error";

interface Check {
  name: string;
  status: Health;
  detail: string;
  /** True when the app cannot function correctly without this. */
  required: boolean;
}

/**
 * Integration diagnostics.
 *
 * Reports whether each backend dependency is actually wired up, without ever
 * echoing a secret. Values are only ever reported as present/absent.
 *
 * Requires authentication: the shape of your infrastructure is not something
 * to hand to anonymous callers.
 */
router.get("/diagnostics", requireAuth, async (req: Request, res: Response) => {
  const checks: Check[] = [];
  let revenueCatDiagnostics = buildRevenueCatDiagnostics({
    configuration: {
      valid: false,
      webhookSecretPresent: Boolean(process.env.REVENUECAT_WEBHOOK_SECRET),
      apiKeyPresent: Boolean(process.env.REVENUECAT_SECRET_API_KEY),
      subjectHashKeyPresent: Boolean(
        process.env.REVENUECAT_SUBJECT_HASH_KEY,
      ),
      proProductCount: 0,
      coachingProductCount: 0,
      normalizedReads: process.env.REVENUECAT_NORMALIZED_READS,
    },
    counts: {},
  });

  // --- Google OAuth -------------------------------------------------------
  // Checked because a missing value here fails at Google rather than in our
  // logs: the user sees "Missing required parameter: client_id" from an
  // unfamiliar domain, with nothing on our side recording why.
  {
    const clientId =
      process.env.GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const domain =
      process.env.PUBLIC_DOMAIN ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      req.get("host");

    const missing: string[] = [];
    if (!clientId) missing.push("GOOGLE_WEB_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");

    checks.push({
      name: "google_oauth",
      status: missing.length === 0 ? "ok" : "not_configured",
      detail:
        missing.length === 0
          ? `Configured. Google must list https://${domain}/api/auth/google-callback as an authorised redirect URI.`
          : `Missing ${missing.join(" and ")}; Google sign-in cannot work.`,
      required: true,
    });
  }

  // --- Database -----------------------------------------------------------
  if (!process.env.DATABASE_URL) {
    checks.push({
      name: "postgres",
      status: "not_configured",
      detail: "DATABASE_URL is not set",
      required: true,
    });
  } else {
    try {
      await db.execute(sql`SELECT 1`);

      // Confirm each table the app depends on actually exists. A missing table
      // is the most likely failure right after deploying new schema, and it
      // surfaces as a confusing 503 rather than an obvious error.
      const tableChecks = await Promise.allSettled([
        db.select({ n: sql<number>`1` }).from(usersTable).limit(1),
        db.select({ n: sql<number>`1` }).from(userDataTable).limit(1),
        db.select({ n: sql<number>`1` }).from(subscriptionsTable).limit(1),
        db.select({ n: sql<number>`1` }).from(aiUsageTable).limit(1),
      ]);

      const names = ["users", "user_data", "subscriptions", "ai_usage"];
      const missing = tableChecks
        .map((r, i) => (r.status === "rejected" ? names[i] : null))
        .filter((n): n is string => n !== null);

      checks.push({
        name: "postgres",
        status: missing.length === 0 ? "ok" : "degraded",
        detail:
          missing.length === 0
            ? "Connected; all tables present"
            : `Connected, but missing table(s): ${missing.join(", ")}. Run your Drizzle migration.`,
        required: true,
      });
    } catch (err) {
      req.log.warn(
        { errorType: err instanceof Error ? err.name : "UnknownError" },
        "PostgreSQL diagnostics unavailable",
      );
      checks.push({
        name: "postgres",
        status: "error",
        detail: "Connection or schema validation failed",
        required: true,
      });
    }
  }

  // --- Firebase Admin (token verification) --------------------------------
  const hasFirebaseCreds =
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  checks.push({
    name: "firebase_admin",
    status: hasFirebaseCreds ? "ok" : "degraded",
    detail: hasFirebaseCreds
      ? "Service account credentials present"
      : "No service account set. Token verification will FAIL, so every authenticated route returns 401. Set FIREBASE_SERVICE_ACCOUNT_KEY.",
    required: true,
  });

  // --- Anthropic ----------------------------------------------------------
  const anthropicReady = isAnthropicConfigured();
  checks.push({
    name: "anthropic",
    status: anthropicReady ? "ok" : "not_configured",
    detail: anthropicReady
      ? "API key present (vision + structured fallback)"
      : "No ANTHROPIC_API_KEY set. Food photo scanning will fail, and plan generation has no fallback if NVIDIA is also unset. Get a key at console.anthropic.com.",
    required: true,
  });

  // --- NVIDIA NIM (optional) ----------------------------------------------
  const hasNvidia = Boolean(process.env.NVIDIA_API_KEY);
  checks.push({
    name: "nvidia_nim",
    status: hasNvidia ? "ok" : "not_configured",
    detail: hasNvidia
      // Imported, not re-derived. This line previously carried its own copy of
      // the default and went on reporting a model that had been retired for
      // days after the provider had already moved off it.
      ? `Configured (${NVIDIA_STRUCTURED_MODEL})`
      : "NVIDIA_API_KEY not set. Structured generation routes to Claude instead - functional, just more expensive.",
    required: false,
  });

  // --- RevenueCat normalized billing state --------------------------------
  let revenueCatConfigurationValid = false;
  let revenueCatCountsAvailable = false;
  try {
    const configuration = loadRevenueCatConfig(process.env);
    revenueCatConfigurationValid = true;
    const safeConfiguration = {
      valid: true,
      webhookSecretPresent: true,
      apiKeyPresent: true,
      subjectHashKeyPresent: true,
      proProductCount: configuration.proProducts.length,
      coachingProductCount: configuration.coachingProducts.length,
      normalizedReads: configuration.normalizedReads,
    };
    revenueCatDiagnostics = buildRevenueCatDiagnostics({
      configuration: safeConfiguration,
      counts: {},
    });
    const counts = await db.execute<{
      due_events: number;
      failed_events: number;
      pending_events: number;
      pending_identity_phase: number;
      pending_entitlement_phase: number;
      pruned_events: number;
      noncanonical_customers: number;
      missing_customer_states: number;
    }>(sql`
      SELECT
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "disposition" = 'pending'
           AND "next_attempt_at" <= clock_timestamp()
           AND ("processing_lease_id" IS NULL
                OR "processing_lease_until" <= clock_timestamp())) AS "due_events",
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "disposition" = 'pending' AND "attempt_count" > 0) AS "failed_events",
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "disposition" = 'pending') AS "pending_events",
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "disposition" = 'pending'
           AND "identity_required" = true
           AND "identity_applied_at" IS NULL) AS "pending_identity_phase",
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "disposition" = 'pending'
           AND "entitlement_required" = true
           AND "entitlement_applied_at" IS NULL) AS "pending_entitlement_phase",
        (SELECT count(*)::integer
         FROM "revenuecat_webhook_events"
         WHERE "pruned_identity_count" > 0) AS "pruned_events",
        (SELECT count(*)::integer
         FROM "revenuecat_customer_state"
         WHERE "canonicalization_state" <> 'canonical') AS "noncanonical_customers",
        (SELECT count(*)::integer
         FROM "users" AS live_user
         LEFT JOIN "revenuecat_customer_state" AS state
           ON state."user_id" = live_user."id"
         WHERE state."user_id" IS NULL) AS "missing_customer_states"
    `);
    const row = counts.rows[0];
    revenueCatCountsAvailable = true;
    revenueCatDiagnostics = buildRevenueCatDiagnostics({
      configuration: safeConfiguration,
      counts: {
        dueEvents: row?.due_events,
        failedEvents: row?.failed_events,
        pendingEvents: row?.pending_events,
        pendingIdentityPhase: row?.pending_identity_phase,
        pendingEntitlementPhase: row?.pending_entitlement_phase,
        prunedEvents: row?.pruned_events,
        noncanonicalCustomers: row?.noncanonical_customers,
        missingCustomerStates: row?.missing_customer_states,
      },
    });
  } catch (error) {
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "RevenueCat diagnostics unavailable",
    );
  }

  checks.push({
    name: "revenuecat_webhook",
    status: !revenueCatConfigurationValid
      ? "not_configured"
      : !revenueCatCountsAvailable
        ? "error"
        : revenueCatDiagnostics.ready
          ? "ok"
          : "degraded",
    detail: !revenueCatConfigurationValid
      ? "RevenueCat configuration is invalid or incomplete."
      : !revenueCatCountsAvailable
        ? "RevenueCat state counts are unavailable."
        : revenueCatDiagnostics.ready
          ? "Normalized RevenueCat billing state is ready."
          : "Normalized RevenueCat billing state is still reconciling.",
    required: true,
  });

  const requiredFailing = checks.filter(
    (c) => c.required && (c.status === "error" || c.status === "not_configured"),
  );
  const anyDegraded = checks.some((c) => c.status === "degraded");

  res.status(requiredFailing.length > 0 ? 503 : 200).json({
    status: requiredFailing.length > 0 ? "unhealthy" : anyDegraded ? "degraded" : "healthy",
    checkedAt: new Date().toISOString(),
    checks,
    revenueCat: revenueCatDiagnostics,
    blocking: requiredFailing.map((c) => c.name),
  });
});

export default router;
