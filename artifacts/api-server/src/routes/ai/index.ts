import { Router, type IRouter, type Request, type Response } from "express";
import { gateAiRoute } from "../../middlewares/aiGate";
import { generate, extractJson, ProviderError } from "../../lib/ai/router";
import { recordUsage, type AiRoute } from "../../lib/aiQuota";
import {
  buildWorkoutPrompt,
  buildMealPlanPrompt,
  buildFoodRecognitionPrompt,
  buildRecipePrompt,
  buildCoachSystemPrompt,
  userText,
} from "./prompts";
import {
  normalizeWorkoutPlan,
  normalizeMealPlan,
  normalizeFoodRecognition,
  normalizeRecipes,
} from "./normalize";

const router: IRouter = Router();

/**
 * Book-keeping shared by every handler: record what the call actually cost so
 * the daily ceiling in aiQuota has real numbers to work with, and surface which
 * provider served the request for debugging quality complaints.
 */
async function accountFor(
  req: Request,
  route: AiRoute,
  result: { usage: { inputTokens: number; outputTokens: number }; estimatedCostMicros: number; provider: string; model: string; latencyMs: number; attempted: { provider: string; error: string }[] },
) {
  await recordUsage(req.user!.id, route, {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostMicros: result.estimatedCostMicros,
    provider: result.provider,
  });

  req.log.info(
    {
      route,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costMicros: result.estimatedCostMicros,
      failedOver: result.attempted.length > 0,
    },
    "AI request served",
  );
}

/** Map an internal failure onto a response the client can act on. */
function respondWithFailure(req: Request, res: Response, err: unknown, what: string) {
  if (err instanceof ProviderError) {
    req.log.error({ err: err.message, provider: err.provider }, `${what} failed`);
    res.status(502).json({
      error: `Could not ${what} right now. Please try again in a moment.`,
      code: "provider_unavailable",
    });
    return;
  }

  // A parse/validation failure means the model replied with something unusable.
  // That is a 502 too, not a 500 — nothing is wrong with our server.
  req.log.error({ err: err instanceof Error ? err.message : String(err) }, `${what} failed`);
  res.status(502).json({
    error: `The AI returned an unusable response. Please try again.`,
    code: "invalid_model_response",
  });
}

// ---------------------------------------------------------------------------
// Food photo recognition  (vision -> Claude only)
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

router.post("/recognize-food", gateAiRoute("recognize-food"), async (req, res) => {
  const { imageBase64 } = req.body ?? {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    res.status(400).json({ error: "imageBase64 is required", code: "bad_request" });
    return;
  }

  // Base64 inflates by ~4/3; reject oversized payloads before paying to send
  // them upstream. The Express body limit is 20mb, which is far too generous
  // for a single meal photo.
  const approxBytes = (imageBase64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) {
    res.status(413).json({
      error: "That image is too large. Please retake it at a lower resolution.",
      code: "image_too_large",
    });
    return;
  }

  const mediaType = imageBase64.startsWith("/9j/")
    ? "image/jpeg"
    : imageBase64.startsWith("R0lGOD")
      ? "image/gif"
      : imageBase64.startsWith("UklGR")
        ? "image/webp"
        : "image/png";

  const { system, prompt } = buildFoodRecognitionPrompt();

  try {
    const result = await generate(
      {
        task: "vision",
        system,
        messages: [{ role: "user", content: prompt }],
        image: { base64: imageBase64, mediaType },
        maxTokens: 2048,
        timeoutMs: 60_000,
      },
      req.log,
    );

    const parsed = normalizeFoodRecognition(extractJson(result.text));
    await accountFor(req, "recognize-food", result);
    res.json(parsed);
  } catch (err) {
    respondWithFailure(req, res, err, "analyze that photo");
  }
});

// ---------------------------------------------------------------------------
// Workout generation  (structured -> NIM first, Claude fallback)
// ---------------------------------------------------------------------------

router.post("/generate-workout", gateAiRoute("generate-workout"), async (req, res) => {
  const { profile, planType, preferences } = req.body ?? {};

  if (!profile || typeof profile !== "object") {
    res.status(400).json({ error: "profile is required", code: "bad_request" });
    return;
  }

  const resolvedPlanType: "daily" | "scheduled" = planType === "daily" ? "daily" : "scheduled";
  const { system, prompt } = buildWorkoutPrompt(profile, resolvedPlanType, preferences);

  try {
    const result = await generate(
      {
        task: "structured",
        system,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
        temperature: 0.7,
        timeoutMs: 90_000,
      },
      req.log,
    );

    const parsed = normalizeWorkoutPlan(extractJson(result.text), profile.goal);
    await accountFor(req, "generate-workout", result);
    res.json(parsed);
  } catch (err) {
    respondWithFailure(req, res, err, "generate that workout plan");
  }
});

// ---------------------------------------------------------------------------
// Meal plan generation  (structured -> NIM first, Claude fallback)
// ---------------------------------------------------------------------------

router.post("/generate-meal-plan", gateAiRoute("generate-meal-plan"), async (req, res) => {
  const { profile, dietPrefs } = req.body ?? {};

  if (!profile || typeof profile !== "object") {
    res.status(400).json({ error: "profile is required", code: "bad_request" });
    return;
  }

  const { system, prompt, dietType } = buildMealPlanPrompt(profile, dietPrefs);

  try {
    const result = await generate(
      {
        task: "structured",
        system,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
        temperature: 0.8,
        timeoutMs: 90_000,
      },
      req.log,
    );

    const parsed = normalizeMealPlan(extractJson(result.text), dietType);
    await accountFor(req, "generate-meal-plan", result);
    res.json(parsed);
  } catch (err) {
    respondWithFailure(req, res, err, "generate that meal plan");
  }
});

// ---------------------------------------------------------------------------
// Recipe generation  (structured -> NIM first, Claude fallback)
// ---------------------------------------------------------------------------

router.post("/generate-recipe", gateAiRoute("generate-recipe"), async (req, res) => {
  const { profile, options } = req.body ?? {};

  if (!profile || typeof profile !== "object") {
    res.status(400).json({ error: "profile is required", code: "bad_request" });
    return;
  }

  const { system, prompt } = buildRecipePrompt(profile, options ?? {});

  try {
    const result = await generate(
      {
        task: "structured",
        system,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4096,
        temperature: 0.9,
        timeoutMs: 90_000,
      },
      req.log,
    );

    const recipes = normalizeRecipes(extractJson(result.text));
    await accountFor(req, "generate-recipe", result);
    res.json({ recipes });
  } catch (err) {
    respondWithFailure(req, res, err, "generate those recipes");
  }
});

// ---------------------------------------------------------------------------
// Coaching chat  (chat -> NIM first, Claude fallback)
// ---------------------------------------------------------------------------

const MAX_HISTORY_TURNS = 12;

router.post("/coach-chat", gateAiRoute("coach-chat"), async (req, res) => {
  const { profile, context, messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages is required", code: "bad_request" });
    return;
  }

  // Trim to the most recent turns. Unbounded history is the usual way a chat
  // endpoint quietly becomes the most expensive route in the app.
  const trimmed = messages
    .slice(-MAX_HISTORY_TURNS)
    .filter((m: any) => m?.role === "user" || m?.role === "assistant")
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: userText(m.content, 2000),
    }))
    .filter((m: { content: string }) => m.content.length > 0);

  if (trimmed.length === 0 || trimmed[trimmed.length - 1].role !== "user") {
    res.status(400).json({ error: "Last message must be from the user", code: "bad_request" });
    return;
  }

  try {
    const result = await generate(
      {
        task: "chat",
        system: buildCoachSystemPrompt(profile ?? {}, context ?? {}),
        messages: trimmed,
        maxTokens: 1024,
        temperature: 0.7,
        timeoutMs: 45_000,
      },
      req.log,
    );

    await accountFor(req, "coach-chat", result);
    res.json({
      reply: result.text.trim(),
      provider: result.provider,
    });
  } catch (err) {
    respondWithFailure(req, res, err, "reach your coach");
  }
});

export default router;
