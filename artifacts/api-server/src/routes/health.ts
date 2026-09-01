import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { loadRevenueCatConfig } from "../lib/revenuecatConfig";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (req, res) => {
  try {
    const config = loadRevenueCatConfig(process.env);
    await db.execute(sql`select 1`);
    if (config.normalizedReads === "strict") {
      const unreconciled = await db.execute<{ count: number }>(sql`
        SELECT count(*)::integer AS "count"
        FROM "users" AS live_user
        LEFT JOIN "revenuecat_customer_state" AS state
          ON state."user_id" = live_user."id"
        WHERE state."user_id" IS NULL
           OR state."canonicalization_state" <> 'canonical'
      `);
      if ((unreconciled.rows[0]?.count ?? 0) !== 0) {
        throw new Error("RevenueCat strict reads are not ready.");
      }
    }
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    req.log.error({ error }, "Readiness check failed");
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
