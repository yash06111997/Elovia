export const REVENUECAT_PRODUCT_KINDS = Object.freeze([
  "auto_renewing",
  "prepaid",
  "promotional",
  "lifetime",
  "non_renewing",
] as const);

export type RevenueCatProductKind =
  (typeof REVENUECAT_PRODUCT_KINDS)[number];

export type RevenueCatProduct = Readonly<{
  id: string;
  kind: RevenueCatProductKind;
  accessDays?: number;
}>;

export type RevenueCatEnvironment = "production" | "sandbox";
export type RevenueCatNormalizedReads = "per_user" | "strict";

export type RevenueCatConfig = Readonly<{
  webhookSecret: string;
  apiKey: string;
  subjectHashKey: string;
  proEntitlementId: string;
  coachingEntitlementId: string;
  proProducts: readonly RevenueCatProduct[];
  coachingProducts: readonly RevenueCatProduct[];
  environment: RevenueCatEnvironment;
  normalizedReads: RevenueCatNormalizedReads;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

const CONFIGURATION_ERROR = "RevenueCat configuration is invalid";
const MAX_SECRET_BYTES = 1_024;
const MAX_PRODUCT_JSON_BYTES = 16 * 1_024;
const SAFE_CONTROL = /[\p{Cc}]/u;

function invalid(): never {
  throw new Error(CONFIGURATION_ERROR);
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function requiredExactSecret(
  env: Environment,
  name: string,
  minBytes = 1,
): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) invalid();
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    bytes < minBytes ||
    bytes > MAX_SECRET_BYTES ||
    !isWellFormed(value)
  ) {
    invalid();
  }
  return value;
}

function requiredSafeString(
  env: Environment,
  name: string,
  maxCodePoints: number,
): string {
  const raw = env[name];
  if (typeof raw !== "string" || !isWellFormed(raw)) invalid();
  const value = raw.trim();
  if (
    value.length === 0 ||
    codePointLength(value) > maxCodePoints ||
    SAFE_CONTROL.test(value)
  ) {
    invalid();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProducts(env: Environment, name: string): readonly RevenueCatProduct[] {
  const raw = env[name];
  if (
    typeof raw !== "string" ||
    raw.trim().length === 0 ||
    !isWellFormed(raw) ||
    Buffer.byteLength(raw, "utf8") > MAX_PRODUCT_JSON_BYTES
  ) {
    invalid();
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (!Array.isArray(decoded) || decoded.length < 1 || decoded.length > 64) {
    invalid();
  }

  const seen = new Set<string>();
  const products: RevenueCatProduct[] = [];
  for (const candidate of decoded) {
    if (!isRecord(candidate)) invalid();
    const keys = Object.keys(candidate).sort();
    const id = candidate["id"];
    const kind = candidate["kind"];
    if (typeof id !== "string" || !isWellFormed(id)) invalid();
    const normalizedId = id.trim();
    if (
      normalizedId.length === 0 ||
      codePointLength(normalizedId) > 256 ||
      SAFE_CONTROL.test(normalizedId) ||
      seen.has(normalizedId) ||
      typeof kind !== "string" ||
      !REVENUECAT_PRODUCT_KINDS.includes(kind as RevenueCatProductKind)
    ) {
      invalid();
    }
    seen.add(normalizedId);

    if (kind === "non_renewing") {
      if (
        keys.length !== 3 ||
        keys[0] !== "accessDays" ||
        keys[1] !== "id" ||
        keys[2] !== "kind" ||
        !Number.isInteger(candidate["accessDays"]) ||
        (candidate["accessDays"] as number) < 1 ||
        (candidate["accessDays"] as number) > 3_660
      ) {
        invalid();
      }
      products.push(
        Object.freeze({
          id: normalizedId,
          kind,
          accessDays: candidate["accessDays"] as number,
        }),
      );
    } else {
      if (keys.length !== 2 || keys[0] !== "id" || keys[1] !== "kind") {
        invalid();
      }
      products.push(
        Object.freeze({
          id: normalizedId,
          kind: kind as Exclude<RevenueCatProductKind, "non_renewing">,
        }),
      );
    }
  }

  return Object.freeze(products);
}

export function loadRevenueCatConfig(env: Environment): RevenueCatConfig {
  const webhookSecret = requiredExactSecret(env, "REVENUECAT_WEBHOOK_SECRET");
  const apiKey = requiredExactSecret(env, "REVENUECAT_SECRET_API_KEY");
  const subjectHashKey = requiredExactSecret(
    env,
    "REVENUECAT_SUBJECT_HASH_KEY",
    32,
  );
  const proEntitlementId = requiredSafeString(
    env,
    "REVENUECAT_PRO_ENTITLEMENT_ID",
    128,
  );
  const coachingEntitlementId = requiredSafeString(
    env,
    "REVENUECAT_COACHING_ENTITLEMENT_ID",
    128,
  );
  if (
    proEntitlementId === coachingEntitlementId ||
    proEntitlementId === "__legacy_unverified__" ||
    coachingEntitlementId === "__legacy_unverified__"
  ) {
    invalid();
  }

  const proProducts = parseProducts(env, "REVENUECAT_PRO_PRODUCTS_JSON");
  const coachingProducts = parseProducts(
    env,
    "REVENUECAT_COACHING_PRODUCTS_JSON",
  );
  const allIds = new Set<string>();
  for (const product of [...proProducts, ...coachingProducts]) {
    if (allIds.has(product.id)) invalid();
    allIds.add(product.id);
  }

  const environment = env["REVENUECAT_ENVIRONMENT"];
  if (environment !== "production" && environment !== "sandbox") invalid();
  const normalizedReads = env["REVENUECAT_NORMALIZED_READS"];
  if (normalizedReads !== "per_user" && normalizedReads !== "strict") invalid();

  return Object.freeze({
    webhookSecret,
    apiKey,
    subjectHashKey,
    proEntitlementId,
    coachingEntitlementId,
    proProducts,
    coachingProducts,
    environment,
    normalizedReads,
  });
}
