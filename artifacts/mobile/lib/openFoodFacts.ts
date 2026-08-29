import type { FoodItem } from "@/utils/foodDatabase";

/**
 * Open Food Facts lookup.
 *
 * Free, no API key, no rate limit, and roughly 3 million barcoded products.
 * The trade-off is that it is community-maintained, so records are frequently
 * incomplete or wrong. Everything below therefore validates aggressively and
 * refuses to return a product whose nutrition data does not make physical
 * sense - a bad number here becomes a wrong entry in someone's food diary.
 *
 * The curated local database remains the source for whole foods; this covers
 * packaged goods, which is exactly where the local list is weakest.
 */

const BASE_URL = "https://world.openfoodfacts.org/api/v2";

/**
 * Open Food Facts asks that clients identify themselves. An anonymous flood of
 * requests from one app is what gets an IP blocked from a free service.
 */
const USER_AGENT = "Elovia/1.0 (fitness app; contact via app store listing)";

const FIELDS = [
  "code",
  "product_name",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "nutriments",
  "nutriscore_grade",
  "nova_group",
  "image_front_small_url",
  "categories_tags",
  "ingredients_text",
  "allergens_tags",
].join(",");

export interface PackagedFood extends FoodItem {
  barcode: string;
  brand: string | null;
  imageUrl: string | null;
  nutriScore: string | null;
  /** NOVA processing classification, 1 (unprocessed) to 4 (ultra-processed). */
  novaGroup: number | null;
  ingredientsText: string | null;
  allergens: string[];
  /** True when per-serving data was unavailable and values are per 100g. */
  per100gOnly: boolean;
}

interface OffNutriments {
  ["energy-kcal_100g"]?: number;
  ["energy-kcal_serving"]?: number;
  proteins_100g?: number;
  proteins_serving?: number;
  carbohydrates_100g?: number;
  carbohydrates_serving?: number;
  fat_100g?: number;
  fat_serving?: number;
  ["saturated-fat_100g"]?: number;
  sugars_100g?: number;
  fiber_100g?: number;
  sodium_100g?: number;
  salt_100g?: number;
}

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number;
  nutriments?: OffNutriments;
  nutriscore_grade?: string;
  nova_group?: number;
  image_front_small_url?: string;
  categories_tags?: string[];
  ingredients_text?: string;
  allergens_tags?: string[];
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Sanity-check the macros against their own energy content.
 *
 * Protein and carbs are ~4 kcal/g, fat ~9. If the stated calories disagree
 * with the macros by more than 30%, the record is unreliable - a common
 * failure mode in crowd-sourced data where someone typed calories per pack but
 * macros per 100g.
 */
function macrosAreCoherent(
  calories: number,
  protein: number,
  carbs: number,
  fats: number,
): boolean {
  if (calories <= 0) return false;
  const derived = protein * 4 + carbs * 4 + fats * 9;
  if (derived <= 0) return false;
  return Math.abs(derived - calories) / calories <= 0.3;
}

function toPackagedFood(product: OffProduct): PackagedFood | null {
  const nutriments = product.nutriments ?? {};
  const name = product.product_name?.trim();
  if (!name) return null;

  // Prefer per-serving figures; fall back to per-100g and say so.
  const servingQty = num(product.serving_quantity);
  const perServingKcal = num(nutriments["energy-kcal_serving"]);
  const per100Kcal = num(nutriments["energy-kcal_100g"]);

  const usePerServing = perServingKcal != null && servingQty != null && servingQty > 0;

  const calories = usePerServing ? perServingKcal! : per100Kcal;
  if (calories == null) return null;

  const protein = usePerServing
    ? num(nutriments.proteins_serving) ?? 0
    : num(nutriments.proteins_100g) ?? 0;
  const carbs = usePerServing
    ? num(nutriments.carbohydrates_serving) ?? 0
    : num(nutriments.carbohydrates_100g) ?? 0;
  const fats = usePerServing
    ? num(nutriments.fat_serving) ?? 0
    : num(nutriments.fat_100g) ?? 0;

  if (!macrosAreCoherent(calories, protein, carbs, fats)) return null;

  // A single serving over 2000 kcal is almost always a units error.
  if (calories > 2000) return null;

  const servingGrams = usePerServing ? servingQty! : 100;
  const servingSize = usePerServing
    ? product.serving_size?.trim() || `${Math.round(servingGrams)}g`
    : "100g";

  return {
    id: `off_${product.code ?? name}`,
    name: product.brands?.trim() ? `${name} (${product.brands.split(",")[0].trim()})` : name,
    category: "Packaged",
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fats: Math.round(fats * 10) / 10,
    servingSize,
    servingGrams: Math.round(servingGrams),
    // Dietary tags are left undefined rather than guessed: inferring
    // "vegetarian" from an ingredients string would be unreliable, and a wrong
    // answer here matters to people who care about it.
    dietaryTags: undefined,
    barcode: product.code ?? "",
    brand: product.brands?.split(",")[0]?.trim() ?? null,
    imageUrl: product.image_front_small_url ?? null,
    nutriScore: product.nutriscore_grade?.toUpperCase() ?? null,
    novaGroup: num(product.nova_group),
    ingredientsText: product.ingredients_text?.trim() || null,
    allergens: (product.allergens_tags ?? []).map((t) => t.replace(/^en:/, "")),
    per100gOnly: !usePerServing,
  };
}

export type BarcodeLookupResult =
  | { status: "found"; food: PackagedFood }
  | { status: "not_found" }
  | { status: "unusable"; reason: string }
  | { status: "error"; reason: string };

/** Look up a scanned barcode. */
export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  const clean = barcode.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) {
    return { status: "unusable", reason: "That does not look like a product barcode." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(`${BASE_URL}/product/${clean}?fields=${FIELDS}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) {
      return { status: "error", reason: "Could not reach the food database." };
    }

    const body = (await response.json()) as { status?: number; product?: OffProduct };
    if (body.status === 0 || !body.product) return { status: "not_found" };

    const food = toPackagedFood(body.product);
    if (!food) {
      return {
        status: "unusable",
        reason:
          "This product is in the database but its nutrition data is incomplete or inconsistent. You can add it manually.",
      };
    }

    return { status: "found", food };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "error", reason: "The lookup timed out." };
    }
    return { status: "error", reason: "Could not reach the food database." };
  }
}

/** Search packaged products by name, for when there is no barcode to scan. */
export async function searchPackagedFoods(
  query: string,
  limit = 20,
): Promise<PackagedFood[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const params = new URLSearchParams({
      search_terms: trimmed,
      fields: FIELDS,
      page_size: String(Math.min(50, limit)),
      json: "1",
    });

    const response = await fetch(`${BASE_URL}/search?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return [];

    const body = (await response.json()) as { products?: OffProduct[] };

    return (body.products ?? [])
      .map(toPackagedFood)
      .filter((f): f is PackagedFood => f !== null)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Plain-language explanation of the NOVA processing classification. */
export function novaLabel(group: number | null): string | null {
  switch (group) {
    case 1:
      return "Unprocessed or minimally processed";
    case 2:
      return "Processed culinary ingredient";
    case 3:
      return "Processed food";
    case 4:
      return "Ultra-processed";
    default:
      return null;
  }
}
