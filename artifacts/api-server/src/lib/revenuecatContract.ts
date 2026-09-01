export const RECONCILING_REVENUECAT_EVENTS = new Set([
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
]);

export interface RevenueCatDelivery {
  eventId: string;
  type: string;
  eventAt: Date;
  userId: string;
  originalUserId: string | null;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: Record<string, string | number | string[] | null>;
}

export type RevenueCatParseResult =
  | { ok: true; value: RevenueCatDelivery }
  | { ok: false; code: "malformed_event"; message: string };

export function parseRevenueCatDelivery(body: unknown): RevenueCatParseResult {
  const event =
    body && typeof body === "object"
      ? (body as { event?: Record<string, unknown> }).event
      : undefined;
  if (!event) return { ok: false, code: "malformed_event", message: "Missing event" };
  const id = typeof event.id === "string" ? event.id.trim() : "";
  const type = typeof event.type === "string" ? event.type.trim() : "";
  const userId = typeof event.app_user_id === "string" ? event.app_user_id.trim() : "";
  const timestamp = event.event_timestamp_ms;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !/^[A-Z0-9_]{3,64}$/.test(type))
    return { ok: false, code: "malformed_event", message: "Invalid event identity" };
  if (
    !userId ||
    userId.length > 256 ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  )
    return { ok: false, code: "malformed_event", message: "Invalid event subject or time" };
  const eventAt = new Date(timestamp);
  if (!Number.isFinite(eventAt.getTime()))
    return { ok: false, code: "malformed_event", message: "Invalid event subject or time" };
  const requiresReconciliation = RECONCILING_REVENUECAT_EVENTS.has(type);
  return {
    ok: true,
    value: {
      eventId: id,
      type,
      eventAt,
      userId,
      originalUserId:
        typeof event.original_app_user_id === "string"
          ? event.original_app_user_id.slice(0, 256)
          : null,
      disposition: requiresReconciliation ? "pending" : "ignored_unknown",
      requiresReconciliation,
      metadata: {
        productId: typeof event.product_id === "string" ? event.product_id.slice(0, 256) : null,
        entitlementIds: Array.isArray(event.entitlement_ids)
          ? event.entitlement_ids
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.slice(0, 128))
              .slice(0, 16)
          : [],
        store: typeof event.store === "string" ? event.store.slice(0, 32) : null,
        environment:
          typeof event.environment === "string" ? event.environment.slice(0, 32) : null,
      },
    },
  };
}
