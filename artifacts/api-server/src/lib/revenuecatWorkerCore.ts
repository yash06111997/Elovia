export const REVENUECAT_REFRESH_MS = 6 * 60 * 60 * 1_000;
const REVENUECAT_RETRY_MIN_MS = 60_000;
const REVENUECAT_RETRY_MAX_MS = 60 * 60 * 1_000;
const ACCOUNT_TRIAL_MS = 15 * 24 * 60 * 60 * 1_000;
const TRANSFERRED_FROM_ROLE = 8;
const TRANSFERRED_TO_ROLE = 16;
const REDEEMED_BY_ROLE = 64;
const SAFE_REVENUECAT_ERROR_CODES = new Set([
  "revenuecat_request_invalid",
  "revenuecat_configuration_invalid",
  "revenuecat_unavailable",
  "revenuecat_timeout",
  "canonical_response_invalid",
  "canonical_mapping_mismatch",
  "revenuecat_visibility_lag",
  "identity_conflict",
  "identity_set_changed",
  "fence_lost",
]);

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
  return typeof code === "string" && SAFE_REVENUECAT_ERROR_CODES.has(code)
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

export type RawlessRevenueCatSubject = Readonly<{
  subjectHash: string;
  roleMask: number;
  localUserId: string | null;
  localUserExists: boolean;
  aliasOwner: string | null;
  ownershipSource: "authenticated" | "webhook" | null;
}>;

export type RawlessResolvedSubject = Readonly<{
  subjectHash: string;
  owner: string | null;
  directOwner: string | null;
}>;

export type RawlessRecoveryDecision =
  | Readonly<{
      kind: "identity_conflict" | "unreconstructable";
      owners: readonly string[];
      observedOwners: readonly string[];
      subjects: readonly RawlessResolvedSubject[];
      ordinaryOwner: null;
      sourceOwner: null;
      destinationOwner: null;
    }>
  | Readonly<{
      kind: "ready";
      owners: readonly string[];
      observedOwners: readonly string[];
      subjects: readonly RawlessResolvedSubject[];
      ordinaryOwner: string | null;
      sourceOwner: string | null;
      destinationOwner: string | null;
    }>;

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function ordered(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(byteCompare);
}

function uniqueOwner(
  subjects: readonly RawlessResolvedSubject[],
  predicate: (subject: RawlessRevenueCatSubject) => boolean,
  source: readonly RawlessRevenueCatSubject[],
): readonly string[] {
  return ordered(
    subjects.flatMap((subject, index) =>
      predicate(source[index]!) && subject.owner ? [subject.owner] : [],
    ),
  );
}

/**
 * Decide whether a persisted, rawless event has one deterministic owner per
 * semantic side. This function never chooses among competing accounts.
 */
export function classifyRawlessRevenueCatEvent(
  input: Readonly<{
    eventType: string;
    subjects: readonly RawlessRevenueCatSubject[];
  }>,
): RawlessRecoveryDecision {
  const subjects = input.subjects.map((subject) => {
    const directOwner =
      subject.ownershipSource === "authenticated"
        ? subject.aliasOwner
        : subject.ownershipSource === null && subject.localUserExists
          ? subject.localUserId
          : null;
    const owner =
      directOwner ??
      subject.aliasOwner ??
      (subject.localUserExists ? subject.localUserId : null);
    return Object.freeze({
      subjectHash: subject.subjectHash,
      owner,
      directOwner,
    });
  });
  const observedOwners = ordered(
    input.subjects.flatMap((subject) => [
      // A deleted/tombstoned local link is not authority, but it is still an
      // observed account identity. Include it in the ordered lock union so a
      // concurrent deletion/relink cannot be crossed without re-expansion.
      ...(subject.localUserId ? [subject.localUserId] : []),
      ...(subject.aliasOwner ? [subject.aliasOwner] : []),
    ]),
  );
  const conflict = (): RawlessRecoveryDecision => ({
    kind: "identity_conflict",
    owners: [],
    observedOwners,
    subjects,
    ordinaryOwner: null,
    sourceOwner: null,
    destinationOwner: null,
  });
  const missing = (): RawlessRecoveryDecision => ({
    kind: "unreconstructable",
    owners: [],
    observedOwners,
    subjects,
    ordinaryOwner: null,
    sourceOwner: null,
    destinationOwner: null,
  });

  if (input.eventType === "TRANSFER") {
    const sources = uniqueOwner(
      subjects,
      (subject) => Boolean(subject.roleMask & TRANSFERRED_FROM_ROLE),
      input.subjects,
    );
    const destinations = uniqueOwner(
      subjects,
      (subject) => Boolean(subject.roleMask & TRANSFERRED_TO_ROLE),
      input.subjects,
    );
    if (sources.length > 1 || destinations.length > 1) return conflict();
    const sourceOwner = sources[0] ?? null;
    const destinationOwner = destinations[0] ?? null;
    if (!sourceOwner && !destinationOwner) return missing();
    return {
      kind: "ready",
      owners: ordered(
        [sourceOwner, destinationOwner].filter(
          (owner): owner is string => owner !== null,
        ),
      ),
      observedOwners,
      subjects,
      ordinaryOwner: null,
      sourceOwner,
      destinationOwner,
    };
  }

  const ownerSubjects =
    input.eventType === "PURCHASE_REDEEMED"
      ? uniqueOwner(
          subjects,
          (subject) => Boolean(subject.roleMask & REDEEMED_BY_ROLE),
          input.subjects,
        )
      : ordered(
          subjects.flatMap((subject) => (subject.owner ? [subject.owner] : [])),
        );
  if (ownerSubjects.length > 1) return conflict();
  const ordinaryOwner = ownerSubjects[0] ?? null;
  if (!ordinaryOwner) return missing();
  return {
    kind: "ready",
    owners: [ordinaryOwner],
    observedOwners,
    subjects,
    ordinaryOwner,
    sourceOwner: null,
    destinationOwner: null,
  };
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
