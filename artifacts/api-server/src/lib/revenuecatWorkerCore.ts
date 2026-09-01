export const REVENUECAT_REFRESH_MS = 6 * 60 * 60 * 1_000;
const REVENUECAT_RETRY_MIN_MS = 60_000;
const REVENUECAT_RETRY_MAX_MS = 60 * 60 * 1_000;
const ACCOUNT_TRIAL_MS = 15 * 24 * 60 * 60 * 1_000;

export function reconcileRetryDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.trunc(attemptCount));
  return Math.min(
    REVENUECAT_RETRY_MAX_MS,
    REVENUECAT_RETRY_MIN_MS * 2 ** Math.min(attempt - 1, 6),
  );
}

export function sanitizeRevenueCatErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "revenuecat_worker_failure";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_]{3,64}$/.test(code)
    ? code
    : "revenuecat_worker_failure";
}

type CreatedEmptySnapshot = Readonly<{
  entitlements: Readonly<Record<string, unknown>>;
  subscriptions: Readonly<Record<string, unknown>>;
  nonSubscriptions: Readonly<Record<string, unknown>>;
}>;

type CreatedEmptyConfig = Readonly<{
  proEntitlementId: string;
  coachingEntitlementId: string;
  proProducts: readonly Readonly<{ id: string }>[];
  coachingProducts: readonly Readonly<{ id: string }>[];
}>;

function owns(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function canonicalCreatedResponseIsEmpty(
  snapshot: CreatedEmptySnapshot,
  config: CreatedEmptyConfig,
): boolean {
  if (
    owns(snapshot.entitlements, config.proEntitlementId) ||
    owns(snapshot.entitlements, config.coachingEntitlementId)
  ) {
    return false;
  }
  for (const product of [...config.proProducts, ...config.coachingProducts]) {
    if (
      owns(snapshot.subscriptions, product.id) ||
      owns(snapshot.nonSubscriptions, product.id)
    ) {
      return false;
    }
  }
  return true;
}

export function trustedStateNeedsEnqueue(
  state: Readonly<{
    canonicalizationState: string;
    reconcileAfter: Date;
  }> | null,
  now = new Date(),
): boolean {
  return (
    state === null ||
    state.canonicalizationState === "legacy_unverified" ||
    state.reconcileAfter.getTime() <= now.getTime()
  );
}

export type NormalizedReadRow = Readonly<{
  entitlementId: string;
  active: boolean;
  status: string;
  accessEndsAt: Date | null;
  productId: string | null;
  sourceEnvironment?: string | null;
}>;

export type SafeEntitlement = Readonly<{
  tier: "free" | "trial" | "premium" | "coaching";
  hasProAccess: boolean;
  hasCoaching: boolean;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  productId: string | null;
}>;

function accountFallback(
  userCreatedAt: Date | null,
  now: Date,
): SafeEntitlement {
  if (!userCreatedAt) {
    return {
      tier: "free",
      hasProAccess: false,
      hasCoaching: false,
      status: "free",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      productId: null,
    };
  }
  const trialEndsAt = new Date(userCreatedAt.getTime() + ACCOUNT_TRIAL_MS);
  const active = trialEndsAt.getTime() > now.getTime();
  return {
    tier: active ? "trial" : "free",
    hasProAccess: active,
    hasCoaching: false,
    status: active ? "in_trial" : "expired",
    trialEndsAt,
    currentPeriodEndsAt: null,
    productId: null,
  };
}

export function resolveNormalizedEntitlement(
  input: Readonly<{
    now?: Date;
    userCreatedAt: Date | null;
    canonicalizationState: string | null;
    rows: readonly NormalizedReadRow[];
    proEntitlementId: string;
    coachingEntitlementId: string;
    expectedEnvironment?: string;
  }>,
): SafeEntitlement {
  const now = input.now ?? new Date();
  if (input.canonicalizationState !== "canonical") {
    return accountFallback(input.userCreatedAt, now);
  }
  const configuredRows = input.rows.filter(
    (row) =>
      (row.entitlementId === input.proEntitlementId ||
        row.entitlementId === input.coachingEntitlementId) &&
      (input.expectedEnvironment === undefined ||
        row.sourceEnvironment === input.expectedEnvironment),
  );
  const active = configuredRows.filter(
    (row) =>
      row.active &&
      (row.accessEndsAt === null || row.accessEndsAt.getTime() > now.getTime()),
  );
  const selected =
    active.find((row) => row.entitlementId === input.coachingEntitlementId) ??
    active.find((row) => row.entitlementId === input.proEntitlementId);
  if (!selected) return accountFallback(input.userCreatedAt, now);
  const hasCoaching = selected.entitlementId === input.coachingEntitlementId;
  return {
    tier: hasCoaching ? "coaching" : "premium",
    hasProAccess: true,
    hasCoaching,
    status: selected.status,
    trialEndsAt: selected.status === "trial" ? selected.accessEndsAt : null,
    currentPeriodEndsAt: selected.accessEndsAt,
    productId: selected.productId,
  };
}
