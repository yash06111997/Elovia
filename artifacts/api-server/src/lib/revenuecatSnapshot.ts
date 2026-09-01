import type {
  RevenueCatConfig,
  RevenueCatEnvironment,
  RevenueCatProduct,
  RevenueCatProductKind,
} from "./revenuecatConfig.js";

const STORES = Object.freeze([
  "app_store",
  "mac_app_store",
  "play_store",
  "amazon",
  "stripe",
  "promotional",
  "rc_billing",
  "paddle",
  "roku",
  "test_store",
] as const);
const PERIODS = Object.freeze([
  "normal",
  "trial",
  "intro",
  "promotional",
  "prepaid",
] as const);
const OWNERSHIP = Object.freeze(["purchased", "family_shared"] as const);

export type RevenueCatStore = (typeof STORES)[number];
export type RevenueCatPeriod = (typeof PERIODS)[number];
export type RevenueCatOwnership = (typeof OWNERSHIP)[number];
export type RevenueCatEntitlementStatus =
  | "active"
  | "trial"
  | "intro"
  | "prepaid"
  | "promotional"
  | "cancelled"
  | "billing_issue"
  | "grace"
  | "expired"
  | "refunded"
  | "paused";

export class CanonicalRevenueCatError extends Error {
  readonly code: "canonical_response_invalid" | "canonical_mapping_mismatch";
  readonly retryable = true;

  constructor(
    code: "canonical_response_invalid" | "canonical_mapping_mismatch",
  ) {
    super(
      code === "canonical_mapping_mismatch"
        ? "RevenueCat canonical product mapping is invalid"
        : "RevenueCat canonical response is invalid",
    );
    this.name = "CanonicalRevenueCatError";
    this.code = code;
  }
}

type CanonicalSubscription = Readonly<{
  productId: string;
  purchaseDate: Date | null;
  originalPurchaseDate: Date | null;
  expiresDate: Date | null;
  gracePeriodExpiresDate: Date | null;
  billingIssuesDetectedAt: Date | null;
  unsubscribeDetectedAt: Date | null;
  refundedAt: Date | null;
  autoResumeDate: Date | null;
  isSandbox: boolean;
  store: RevenueCatStore | null;
  ownershipType: RevenueCatOwnership | null;
  periodType: RevenueCatPeriod | null;
}>;

type CanonicalPurchase = Readonly<{
  id: string;
  productId: string;
  purchaseDate: Date;
  isSandbox: boolean;
  store: RevenueCatStore;
}>;

type CanonicalEntitlementPointer = Readonly<{
  entitlementId: string;
  productIdentifier: string | null;
  expiresDate: Date | null;
  gracePeriodExpiresDate: Date | null;
  purchaseDate: Date | null;
}>;

export type CanonicalRevenueCatSnapshot = Readonly<{
  sourceSnapshotAt: Date;
  entitlements: Readonly<Record<string, CanonicalEntitlementPointer>>;
  subscriptions: Readonly<Record<string, CanonicalSubscription>>;
  nonSubscriptions: Readonly<Record<string, readonly CanonicalPurchase[]>>;
}>;

export type CanonicalSnapshotBounds = Readonly<{
  requestStartedAt: Date;
  responseReceivedAt: Date;
}>;

export type RevenueCatSourceKind =
  | "webhook_canonical"
  | "bootstrap_canonical"
  | "auth_canonical"
  | "worker_canonical";

export type NormalizedRevenueCatEntitlement = Readonly<{
  entitlementId: string;
  active: boolean;
  status: RevenueCatEntitlementStatus;
  productId: string | null;
  productKind: RevenueCatProductKind | null;
  store: RevenueCatStore | null;
  periodEndsAt: Date | null;
  graceEndsAt: Date | null;
  accessEndsAt: Date | null;
  willRenew: boolean;
  sourceEnvironment: RevenueCatEnvironment;
  sourceKind: RevenueCatSourceKind;
  sourceSnapshotAt: Date;
  sourceOperationId: string;
  sourceTriggerEventId: string | null;
}>;

const MIN_CANONICAL_DATE = Date.parse("2000-01-01T00:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1_000;
const DAY = 86_400_000;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function invalid(): never {
  throw new CanonicalRevenueCatError("canonical_response_invalid");
}

function mismatch(): never {
  throw new CanonicalRevenueCatError("canonical_mapping_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function boundedString(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    [...value].length > max ||
    !isWellFormed(value)
  ) {
    invalid();
  }
  return value;
}

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !values.includes(value as T)
  ) {
    invalid();
  }
  return value as T;
}

function upperDateBound(snapshotMs: number): number {
  const date = new Date(snapshotMs);
  date.setUTCFullYear(date.getUTCFullYear() + 10);
  return date.getTime();
}

function optionalCanonicalDate(
  value: unknown,
  snapshotMs: number,
): Date | null {
  if (value === undefined || value === null) return null;
  const source = boundedString(value, 64);
  if (!ISO_DATE.test(source)) invalid();
  const milliseconds = Date.parse(source);
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < MIN_CANONICAL_DATE ||
    milliseconds > upperDateBound(snapshotMs)
  ) {
    invalid();
  }
  return new Date(milliseconds);
}

function requiredObjectCollection(
  value: unknown,
  maxEntries: number,
): Record<string, unknown> {
  if (!isRecord(value)) invalid();
  const entries = Object.entries(value);
  if (entries.length > maxEntries) invalid();
  return value;
}

function normalizePointer(
  entitlementId: string,
  value: unknown,
  snapshotMs: number,
): CanonicalEntitlementPointer {
  if (!isRecord(value)) invalid();
  const rawProduct = value["product_identifier"];
  const productIdentifier =
    rawProduct === undefined || rawProduct === null
      ? null
      : boundedString(rawProduct, 256);
  return Object.freeze({
    entitlementId,
    productIdentifier,
    expiresDate: optionalCanonicalDate(value["expires_date"], snapshotMs),
    gracePeriodExpiresDate: optionalCanonicalDate(
      value["grace_period_expires_date"],
      snapshotMs,
    ),
    purchaseDate: optionalCanonicalDate(value["purchase_date"], snapshotMs),
  });
}

function normalizeSubscription(
  productId: string,
  value: unknown,
  snapshotMs: number,
): CanonicalSubscription {
  if (!isRecord(value) || typeof value["is_sandbox"] !== "boolean") invalid();
  return Object.freeze({
    productId,
    purchaseDate: optionalCanonicalDate(value["purchase_date"], snapshotMs),
    originalPurchaseDate: optionalCanonicalDate(
      value["original_purchase_date"],
      snapshotMs,
    ),
    expiresDate: optionalCanonicalDate(value["expires_date"], snapshotMs),
    gracePeriodExpiresDate: optionalCanonicalDate(
      value["grace_period_expires_date"],
      snapshotMs,
    ),
    billingIssuesDetectedAt: optionalCanonicalDate(
      value["billing_issues_detected_at"],
      snapshotMs,
    ),
    unsubscribeDetectedAt: optionalCanonicalDate(
      value["unsubscribe_detected_at"],
      snapshotMs,
    ),
    refundedAt: optionalCanonicalDate(value["refunded_at"], snapshotMs),
    autoResumeDate: optionalCanonicalDate(value["auto_resume_date"], snapshotMs),
    isSandbox: value["is_sandbox"],
    store: optionalEnum(value["store"], STORES),
    ownershipType: optionalEnum(value["ownership_type"], OWNERSHIP),
    periodType: optionalEnum(value["period_type"], PERIODS),
  });
}

function normalizePurchase(
  productId: string,
  value: unknown,
  snapshotMs: number,
): CanonicalPurchase {
  if (!isRecord(value) || typeof value["is_sandbox"] !== "boolean") invalid();
  const id = boundedString(value["id"], 256);
  const purchaseDate = optionalCanonicalDate(value["purchase_date"], snapshotMs);
  const store = optionalEnum(value["store"], STORES);
  if (purchaseDate === null || store === null) invalid();
  return Object.freeze({
    id,
    productId,
    purchaseDate,
    isSandbox: value["is_sandbox"],
    store,
  });
}

export function parseCanonicalRevenueCatSnapshot(
  value: unknown,
  bounds: CanonicalSnapshotBounds,
): CanonicalRevenueCatSnapshot {
  if (!isRecord(value)) invalid();
  const requestDateMs = value["request_date_ms"];
  const requestStartedAtMs = bounds.requestStartedAt.getTime();
  const responseReceivedAtMs = bounds.responseReceivedAt.getTime();
  if (
    typeof requestDateMs !== "number" ||
    !Number.isSafeInteger(requestDateMs) ||
    requestDateMs <= 0 ||
    !Number.isFinite(new Date(requestDateMs).getTime()) ||
    !Number.isFinite(requestStartedAtMs) ||
    !Number.isFinite(responseReceivedAtMs) ||
    requestDateMs < requestStartedAtMs - FIVE_MINUTES ||
    requestDateMs > responseReceivedAtMs + FIVE_MINUTES
  ) {
    invalid();
  }

  const subscriber = value["subscriber"];
  if (!isRecord(subscriber)) invalid();
  const rawEntitlements = requiredObjectCollection(
    subscriber["entitlements"],
    64,
  );
  const rawSubscriptions = requiredObjectCollection(
    subscriber["subscriptions"],
    256,
  );
  const rawNonSubscriptions = requiredObjectCollection(
    subscriber["non_subscriptions"],
    256,
  );

  const entitlements = Object.create(null) as Record<
    string,
    CanonicalEntitlementPointer
  >;
  for (const [entitlementId, pointer] of Object.entries(rawEntitlements)) {
    boundedString(entitlementId, 128);
    entitlements[entitlementId] = normalizePointer(
      entitlementId,
      pointer,
      requestDateMs,
    );
  }

  const subscriptions = Object.create(null) as Record<
    string,
    CanonicalSubscription
  >;
  for (const [productId, candidate] of Object.entries(rawSubscriptions)) {
    boundedString(productId, 256);
    subscriptions[productId] = normalizeSubscription(
      productId,
      candidate,
      requestDateMs,
    );
  }

  let totalPurchases = 0;
  const nonSubscriptions = Object.create(null) as Record<
    string,
    readonly CanonicalPurchase[]
  >;
  for (const [productId, rawPurchases] of Object.entries(rawNonSubscriptions)) {
    boundedString(productId, 256);
    if (!Array.isArray(rawPurchases) || rawPurchases.length > 256) invalid();
    totalPurchases += rawPurchases.length;
    if (totalPurchases > 512) invalid();
    nonSubscriptions[productId] = Object.freeze(
      rawPurchases.map((purchase) =>
        normalizePurchase(productId, purchase, requestDateMs),
      ),
    );
  }

  return Object.freeze({
    sourceSnapshotAt: new Date(requestDateMs),
    entitlements: Object.freeze(entitlements),
    subscriptions: Object.freeze(subscriptions),
    nonSubscriptions: Object.freeze(nonSubscriptions),
  });
}

type Candidate = {
  active: boolean;
  status: RevenueCatEntitlementStatus;
  productId: string;
  productKind: RevenueCatProductKind;
  store: RevenueCatStore | null;
  periodEndsAt: Date | null;
  graceEndsAt: Date | null;
  accessEndsAt: Date | null;
  willRenew: boolean;
  lifetime: boolean;
};

function appliesToEnvironment(
  isSandbox: boolean,
  store: RevenueCatStore | null,
  environment: RevenueCatEnvironment,
): boolean {
  const sandbox = isSandbox || store === "test_store";
  return environment === "sandbox" ? sandbox : !sandbox;
}

function later(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function subscriptionCandidate(
  product: RevenueCatProduct,
  subscription: CanonicalSubscription,
  snapshotMs: number,
): Candidate {
  const expiry = subscription.expiresDate;
  const liveExpiry = expiry !== null && expiry.getTime() > snapshotMs;
  const liveGrace =
    subscription.gracePeriodExpiresDate !== null &&
    subscription.gracePeriodExpiresDate.getTime() > snapshotMs;
  const canAutoRenew =
    product.kind === "auto_renewing" &&
    subscription.refundedAt === null &&
    subscription.unsubscribeDetectedAt === null &&
    subscription.autoResumeDate === null;

  let active = false;
  let status: RevenueCatEntitlementStatus = "expired";
  let accessEndsAt = expiry;
  let graceEndsAt: Date | null = null;
  let willRenew = false;

  if (subscription.refundedAt !== null) {
    status = "refunded";
    accessEndsAt = subscription.refundedAt;
  } else if (subscription.billingIssuesDetectedAt !== null && liveGrace) {
    active = true;
    status = "grace";
    graceEndsAt = subscription.gracePeriodExpiresDate;
    accessEndsAt = later(expiry, graceEndsAt);
    willRenew = canAutoRenew;
  } else if (liveExpiry && subscription.autoResumeDate !== null) {
    active = true;
    status = "paused";
  } else if (liveExpiry && subscription.unsubscribeDetectedAt !== null) {
    active = true;
    status = "cancelled";
  } else if (liveExpiry && subscription.billingIssuesDetectedAt !== null) {
    active = true;
    status = "billing_issue";
    willRenew = canAutoRenew;
  } else if (liveExpiry && subscription.periodType === "trial") {
    active = true;
    status = "trial";
    willRenew = canAutoRenew;
  } else if (liveExpiry && subscription.periodType === "intro") {
    active = true;
    status = "intro";
    willRenew = canAutoRenew;
  } else if (liveExpiry && product.kind === "prepaid") {
    active = true;
    status = "prepaid";
  } else if (liveExpiry && product.kind === "promotional") {
    active = true;
    status = "promotional";
  } else if (liveExpiry) {
    active = true;
    status = "active";
    willRenew = canAutoRenew;
  }

  return {
    active,
    status,
    productId: product.id,
    productKind: product.kind,
    store: subscription.store,
    periodEndsAt: expiry,
    graceEndsAt,
    accessEndsAt,
    willRenew,
    lifetime: false,
  };
}

function purchaseCandidate(
  product: RevenueCatProduct,
  purchases: readonly CanonicalPurchase[],
  snapshotMs: number,
): Candidate | null {
  if (purchases.length === 0) return null;
  const latest = [...purchases].sort(
    (left, right) =>
      right.purchaseDate.getTime() - left.purchaseDate.getTime() ||
      Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
  )[0];
  if (!latest) return null;

  if (product.kind === "lifetime") {
    return {
      active: true,
      status: "active",
      productId: product.id,
      productKind: product.kind,
      store: latest.store,
      periodEndsAt: null,
      graceEndsAt: null,
      accessEndsAt: null,
      willRenew: false,
      lifetime: true,
    };
  }

  if (product.kind !== "non_renewing" || product.accessDays === undefined) {
    mismatch();
  }
  const deadline = new Date(
    latest.purchaseDate.getTime() + product.accessDays * DAY,
  );
  const active = deadline.getTime() > snapshotMs;
  return {
    active,
    status: active ? "active" : "expired",
    productId: product.id,
    productKind: product.kind,
    store: latest.store,
    periodEndsAt: deadline,
    graceEndsAt: null,
    accessEndsAt: deadline,
    willRenew: false,
    lifetime: false,
  };
}

function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function chooseCandidate(candidates: readonly Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    if (left.active && left.lifetime !== right.lifetime) {
      return left.lifetime ? -1 : 1;
    }
    const leftDeadline = left.accessEndsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightDeadline = right.accessEndsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftDeadline !== rightDeadline) return rightDeadline - leftDeadline;
    return byteCompare(left.productId, right.productId);
  })[0] ?? null;
}

function operationSource(operationId: string): {
  sourceKind: RevenueCatSourceKind;
  sourceTriggerEventId: string | null;
} {
  const patterns: readonly [RegExp, RevenueCatSourceKind][] = [
    [/^webhook:[A-Za-z0-9_-]{8,128}$/, "webhook_canonical"],
    [
      /^bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "bootstrap_canonical",
    ],
    [
      /^auth:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "auth_canonical",
    ],
    [/^worker:[A-Za-z0-9_-]{8,128}$/, "worker_canonical"],
  ];
  for (const [pattern, sourceKind] of patterns) {
    if (pattern.test(operationId)) {
      return {
        sourceKind,
        sourceTriggerEventId:
          sourceKind === "webhook_canonical" ? operationId.slice(8) : null,
      };
    }
  }
  mismatch();
}

function projectEntitlement(
  snapshot: CanonicalRevenueCatSnapshot,
  config: RevenueCatConfig,
  entitlementId: string,
  products: readonly RevenueCatProduct[],
  operationId: string,
): NormalizedRevenueCatEntitlement {
  const { sourceKind, sourceTriggerEventId } = operationSource(operationId);
  const configuredIds = new Set(products.map((product) => product.id));
  const pointer = ownValue(snapshot.entitlements, entitlementId);
  if (
    pointer?.productIdentifier !== null &&
    pointer?.productIdentifier !== undefined &&
    !configuredIds.has(pointer.productIdentifier)
  ) {
    mismatch();
  }

  const snapshotMs = snapshot.sourceSnapshotAt.getTime();
  const candidates: Candidate[] = [];
  for (const product of products) {
    const subscription = ownValue(snapshot.subscriptions, product.id);
    const purchases = ownValue(snapshot.nonSubscriptions, product.id);
    const subscriptionKind =
      product.kind === "auto_renewing" ||
      product.kind === "prepaid" ||
      product.kind === "promotional";

    const relevantSubscription =
      subscription !== undefined &&
      appliesToEnvironment(
        subscription.isSandbox,
        subscription.store,
        config.environment,
      )
        ? subscription
        : undefined;
    const relevantPurchases =
      purchases?.filter((purchase) =>
        appliesToEnvironment(
          purchase.isSandbox,
          purchase.store,
          config.environment,
        ),
      ) ?? [];

    if (!subscriptionKind && relevantSubscription !== undefined) mismatch();
    if (subscriptionKind && relevantPurchases.length > 0) mismatch();

    if (relevantSubscription !== undefined) {
      if (
        product.kind === "prepaid" &&
        relevantSubscription.periodType !== "prepaid"
      ) {
        mismatch();
      }
      if (
        product.kind === "promotional" &&
        relevantSubscription.periodType !== "promotional" &&
        relevantSubscription.store !== "promotional"
      ) {
        mismatch();
      }
      candidates.push(
        subscriptionCandidate(product, relevantSubscription, snapshotMs),
      );
    }

    if (!subscriptionKind && relevantPurchases.length > 0) {
      const candidate = purchaseCandidate(
        product,
        relevantPurchases,
        snapshotMs,
      );
      if (candidate !== null) candidates.push(candidate);
    }
  }

  const selected = chooseCandidate(candidates);
  const dates = {
    periodEndsAt:
      selected?.periodEndsAt === null || selected === null
        ? null
        : new Date(selected.periodEndsAt),
    graceEndsAt:
      selected?.graceEndsAt === null || selected === null
        ? null
        : new Date(selected.graceEndsAt),
    accessEndsAt:
      selected?.accessEndsAt === null || selected === null
        ? null
        : new Date(selected.accessEndsAt),
  };

  return Object.freeze({
    entitlementId,
    active: selected?.active ?? false,
    status: selected?.status ?? "expired",
    productId: selected?.productId ?? null,
    productKind: selected?.productKind ?? null,
    store: selected?.store ?? null,
    ...dates,
    willRenew: selected?.willRenew ?? false,
    sourceEnvironment: config.environment,
    sourceKind,
    sourceSnapshotAt: new Date(snapshot.sourceSnapshotAt),
    sourceOperationId: operationId,
    sourceTriggerEventId,
  });
}

export function projectRevenueCatSnapshot(input: Readonly<{
  snapshot: CanonicalRevenueCatSnapshot;
  config: RevenueCatConfig;
  operationId: string;
}>): readonly [NormalizedRevenueCatEntitlement, NormalizedRevenueCatEntitlement] {
  const pro = projectEntitlement(
    input.snapshot,
    input.config,
    input.config.proEntitlementId,
    input.config.proProducts,
    input.operationId,
  );
  const coaching = projectEntitlement(
    input.snapshot,
    input.config,
    input.config.coachingEntitlementId,
    input.config.coachingProducts,
    input.operationId,
  );
  return Object.freeze([pro, coaching]);
}
