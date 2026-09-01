export const RECONCILING_REVENUECAT_EVENTS = Object.freeze([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "CANCELLATION",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "EXPIRATION",
  "BILLING_ISSUE",
  "REFUND",
  "PRODUCT_CHANGE",
  "TRANSFER",
  "SUBSCRIPTION_PAUSED",
] as const);

const reconcilingRevenueCatEventSet = new Set<string>(
  RECONCILING_REVENUECAT_EVENTS,
);

export interface RevenueCatMetadata {
  readonly productId: string | null;
  readonly entitlementIds: readonly string[];
  readonly store: string | null;
  readonly environment: string | null;
}

export interface RevenueCatDelivery {
  eventId: string;
  type: string;
  eventAt: Date;
  userId: string;
  originalUserId: string | null;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: RevenueCatMetadata;
}

export type RevenueCatParseResult =
  | { ok: true; value: RevenueCatDelivery }
  | { ok: false; code: "malformed_event"; message: string };

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || !isWellFormedString(value)) return null;
  const bounded = value.slice(0, maxLength);
  const finalCodeUnit = bounded.charCodeAt(bounded.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff
    ? bounded.slice(0, -1)
    : bounded;
}

export function parseRevenueCatDelivery(body: unknown): RevenueCatParseResult {
  const event =
    body && typeof body === "object"
      ? (body as { event?: Record<string, unknown> }).event
      : undefined;
  if (!event)
    return { ok: false, code: "malformed_event", message: "Missing event" };
  const id = typeof event.id === "string" ? event.id.trim() : "";
  const type = typeof event.type === "string" ? event.type.trim() : "";
  const userId =
    typeof event.app_user_id === "string" ? event.app_user_id.trim() : "";
  const timestamp = event.event_timestamp_ms;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !/^[A-Z0-9_]{3,64}$/.test(type))
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid event identity",
    };
  if (
    !userId ||
    userId.length > 256 ||
    !isWellFormedString(userId) ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  )
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid event subject or time",
    };
  const eventAt = new Date(timestamp);
  if (!Number.isFinite(eventAt.getTime()))
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid event subject or time",
    };
  const requiresReconciliation = reconcilingRevenueCatEventSet.has(type);
  return {
    ok: true,
    value: {
      eventId: id,
      type,
      eventAt,
      userId,
      originalUserId: boundedString(event.original_app_user_id, 256),
      disposition: requiresReconciliation ? "pending" : "ignored_unknown",
      requiresReconciliation,
      metadata: {
        productId: boundedString(event.product_id, 256),
        entitlementIds: Array.isArray(event.entitlement_ids)
          ? event.entitlement_ids
              .map((value) => boundedString(value, 128))
              .filter((value): value is string => value !== null)
              .slice(0, 16)
          : [],
        store: boundedString(event.store, 32),
        environment: boundedString(event.environment, 32),
      },
    },
  };
}
