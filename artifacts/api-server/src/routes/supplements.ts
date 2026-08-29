import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, supplementsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/aiGate";
import { gateAiRoute } from "../middlewares/aiGate";
import { generate, extractJson, ProviderError } from "../lib/ai/router";
import { recordUsage } from "../lib/aiQuota";
import { buildSupplementAnalysisPrompt } from "./ai/prompts";
import { normalizeSupplementAnalysis } from "./ai/normalize";

const router: IRouter = Router();

const VALID_KINDS = new Set(["supplement", "medication"]);
const VALID_FREQUENCIES = new Set(["daily", "twice_daily", "weekly", "as_needed"]);

function sanitizeTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .filter((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v))
    .slice(0, 6);
}

/** List the caller's substances. */
router.get("/supplements", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(supplementsTable)
      .where(eq(supplementsTable.userId, req.user!.id));

    res.json({ supplements: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list supplements");
    res.status(500).json({ error: "Could not load your supplements" });
  }
});

router.post("/supplements", requireAuth, async (req: Request, res: Response) => {
  const { name, kind, dosage, unit, frequency, times, withFood, notes } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "A name is required", code: "bad_request" });
    return;
  }

  try {
    const row = {
      id: randomUUID(),
      userId: req.user!.id,
      name: name.trim().slice(0, 120),
      kind: VALID_KINDS.has(kind) ? kind : "supplement",
      dosage: typeof dosage === "string" ? dosage.slice(0, 60) : null,
      unit: typeof unit === "string" ? unit.slice(0, 20) : null,
      frequency: VALID_FREQUENCIES.has(frequency) ? frequency : "daily",
      times: sanitizeTimes(times),
      withFood: withFood === true,
      notes: typeof notes === "string" ? notes.slice(0, 500) : null,
      active: true,
    };

    await db.insert(supplementsTable).values(row);
    res.status(201).json({ supplement: row });
  } catch (err) {
    req.log.error({ err }, "Failed to create supplement");
    res.status(500).json({ error: "Could not save that entry" });
  }
});

router.patch("/supplements/:id", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { name, dosage, unit, frequency, times, withFood, notes, active } = req.body ?? {};

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof name === "string" && name.trim()) {
      updates.name = name.trim().slice(0, 120);
      // Renaming means the cached analysis is about a different substance.
      updates.analysis = null;
      updates.analysedAt = null;
    }
    if (typeof dosage === "string") updates.dosage = dosage.slice(0, 60);
    if (typeof unit === "string") updates.unit = unit.slice(0, 20);
    if (VALID_FREQUENCIES.has(frequency)) updates.frequency = frequency;
    if (times !== undefined) updates.times = sanitizeTimes(times);
    if (typeof withFood === "boolean") updates.withFood = withFood;
    if (typeof notes === "string") updates.notes = notes.slice(0, 500);
    if (typeof active === "boolean") updates.active = active;

    const result = await db
      .update(supplementsTable)
      .set(updates)
      // Scoped by userId as well as id: without it, any authenticated user
      // could edit another user's row by guessing a UUID.
      .where(and(eq(supplementsTable.id, id), eq(supplementsTable.userId, req.user!.id)))
      .returning({ id: supplementsTable.id });

    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ updated: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update supplement");
    res.status(500).json({ error: "Could not update that entry" });
  }
});

router.delete("/supplements/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await db
      .delete(supplementsTable)
      .where(
        and(
          eq(supplementsTable.id, String(req.params.id)),
          eq(supplementsTable.userId, req.user!.id),
        ),
      )
      .returning({ id: supplementsTable.id });

    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete supplement");
    res.status(500).json({ error: "Could not delete that entry" });
  }
});

/**
 * Explain a substance in training/nutrition terms.
 *
 * Results are cached on the row: the answer for "creatine monohydrate" does
 * not change between views, and re-billing the user's quota to render the same
 * screen twice would be indefensible.
 */
router.post(
  "/supplements/:id/analyse",
  gateAiRoute("analyse-supplement"),
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { profile, refresh } = req.body ?? {};

    try {
      const [row] = await db
        .select()
        .from(supplementsTable)
        .where(and(eq(supplementsTable.id, id), eq(supplementsTable.userId, req.user!.id)));

      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      if (row.analysis && refresh !== true) {
        res.json({ analysis: row.analysis, cached: true });
        return;
      }

      const { system, prompt } = buildSupplementAnalysisPrompt(
        {
          name: row.name,
          kind: row.kind,
          dosage: row.dosage ?? undefined,
          notes: row.notes ?? undefined,
        },
        profile ?? {},
      );

      const result = await generate(
        {
          task: "structured",
          system,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2048,
          // Low temperature: this is reference information, and creative
          // variation in health content is a liability, not a feature.
          temperature: 0.2,
          timeoutMs: 60_000,
        },
        req.log,
      );

      const analysis = normalizeSupplementAnalysis(
        extractJson(result.text),
        row.name,
        row.kind === "medication",
      );

      await db
        .update(supplementsTable)
        .set({ analysis, analysedAt: new Date() })
        .where(eq(supplementsTable.id, id))
        .catch(() => undefined);

      await recordUsage(req.user!.id, "analyse-supplement", {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostMicros: result.estimatedCostMicros,
        provider: result.provider,
      });

      res.json({ analysis, cached: false });
    } catch (err) {
      if (err instanceof ProviderError) {
        req.log.error({ err: err.message }, "Supplement analysis failed");
        res.status(502).json({
          error: "Could not analyse that right now. Please try again shortly.",
          code: "provider_unavailable",
        });
        return;
      }

      req.log.error({ err }, "Supplement analysis failed");
      res.status(502).json({
        error: "The analysis came back unusable. Please try again.",
        code: "invalid_model_response",
      });
    }
  },
);

export default router;
