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
  "REFUND_REVERSED",
  "PRODUCT_CHANGE",
  "TRANSFER",
  "SUBSCRIPTION_PAUSED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "PURCHASE_REDEEMED",
]);

interface RevenueCatDeliveryBase {
  eventId: string;
  type: string;
  eventAt: Date;
  disposition: "pending" | "ignored_unknown";
  requiresReconciliation: boolean;
  metadata: Record<string, string | number | string[] | null>;
}

export interface OrdinaryRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "ordinary";
  userId: string;
  originalUserId: string | null;
  aliases: string[];
}

export interface TransferRevenueCatDelivery extends RevenueCatDeliveryBase {
  kind: "transfer";
  type: "TRANSFER";
  transferredFrom: string[];
  transferredTo: string[];
}

export interface PurchaseRedeemedRevenueCatDelivery
  extends RevenueCatDeliveryBase {
  kind: "purchase_redeemed";
  type: "PURCHASE_REDEEMED";
  redeemedFrom: string[];
  redeemedBy: string[];
  redemptionOutcome: "alias" | "transfer" | "redeemer_owns";
}

export type RevenueCatDelivery =
  | OrdinaryRevenueCatDelivery
  | TransferRevenueCatDelivery
  | PurchaseRedeemedRevenueCatDelivery;

export type RevenueCatParseResult =
  | { ok: true; value: RevenueCatDelivery }
  | { ok: false; code: "malformed_event"; message: string }
  /** Valid delivery acknowledged without applying it because identity work is over its safe bound. */
  | { ok: false; code: "ignored_identity_volume"; message: string }
  /** Valid delivery acknowledged without applying an unsupported redemption shape. */
  | { ok: false; code: "unsupported_redemption_shape"; message: string };

const MAX_IDENTITIES = 256;

type IdentityArrayResult =
  | { ok: true; values: string[] }
  | {
      ok: false;
      code: "malformed_event" | "ignored_identity_volume";
      message: string;
    };

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

function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
}

function parseIdentityArray(value: unknown): IdentityArrayResult {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid identity array",
    };
  }
  if (value.length > MAX_IDENTITIES) {
    return {
      ok: false,
      code: "ignored_identity_volume",
      message: "Identity array exceeds safe volume",
    };
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const rawIdentity of value) {
    if (typeof rawIdentity !== "string" || !isWellFormedString(rawIdentity)) {
      return {
        ok: false,
        code: "malformed_event",
        message: "Invalid identity array entry",
      };
    }
    const identity = rawIdentity.trim();
    if (!identity || codePointLength(identity) > MAX_IDENTITIES) {
      return {
        ok: false,
        code: "malformed_event",
        message: "Invalid identity array entry",
      };
    }
    if (!seen.has(identity)) {
      seen.add(identity);
      values.push(identity);
    }
  }
  return { ok: true, values };
}

function exceedsCombinedIdentityVolume(...groups: string[][]): boolean {
  const identities = new Set<string>();
  for (const group of groups) {
    for (const identity of group) {
      identities.add(identity);
      if (identities.size > MAX_IDENTITIES) return true;
    }
  }
  return false;
}

function identityVolumeResult(): RevenueCatParseResult {
  return {
    ok: false,
    code: "ignored_identity_volume",
    message: "Combined identities exceed safe volume",
  };
}

function deliveryMetadata(
  event: Record<string, unknown>,
): Record<string, string | number | string[] | null> {
  return {
    productId: boundedString(event.product_id, 256),
    entitlementIds: Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids
          .map((value) => boundedString(value, 128))
          .filter((value): value is string => value !== null)
          .slice(0, 16)
      : [],
    store: boundedString(event.store, 32),
    environment: boundedString(event.environment, 32),
  };
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
  const timestamp = event.event_timestamp_ms;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !/^[A-Z0-9_]{3,64}$/.test(type))
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid event identity",
    };
  if (
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
  const requiresReconciliation = RECONCILING_REVENUECAT_EVENTS.has(type);
  const base = {
    eventId: id,
    eventAt,
    disposition: requiresReconciliation
      ? ("pending" as const)
      : ("ignored_unknown" as const),
    requiresReconciliation,
    metadata: deliveryMetadata(event),
  };

  if (type === "TRANSFER") {
    const transferredFrom = parseIdentityArray(event.transferred_from);
    if (!transferredFrom.ok) return transferredFrom;
    const transferredTo = parseIdentityArray(event.transferred_to);
    if (!transferredTo.ok) return transferredTo;
    if (
      transferredFrom.values.length === 0 ||
      transferredTo.values.length === 0
    ) {
      return {
        ok: false,
        code: "malformed_event",
        message: "Transfer identity sides must not be empty",
      };
    }
    if (
      exceedsCombinedIdentityVolume(
        transferredFrom.values,
        transferredTo.values,
      )
    ) {
      return identityVolumeResult();
    }
    return {
      ok: true,
      value: {
        ...base,
        kind: "transfer",
        type: "TRANSFER",
        transferredFrom: transferredFrom.values,
        transferredTo: transferredTo.values,
      },
    };
  }

  if (type === "PURCHASE_REDEEMED") {
    const outcome = event.redemption_outcome;
    if (
      outcome !== "alias" &&
      outcome !== "transfer" &&
      outcome !== "redeemer_owns"
    ) {
      return {
        ok: false,
        code: "unsupported_redemption_shape",
        message: "Unsupported redemption outcome",
      };
    }
    if (!Array.isArray(event.redeemed_by) || event.redeemed_by.length === 0) {
      return {
        ok: false,
        code: "unsupported_redemption_shape",
        message: "Missing redemption recipient",
      };
    }
    const redeemedFrom: IdentityArrayResult =
      event.redeemed_from == null
        ? { ok: true, values: [] }
        : parseIdentityArray(event.redeemed_from);
    if (!redeemedFrom.ok) return redeemedFrom;
    const redeemedBy = parseIdentityArray(event.redeemed_by);
    if (!redeemedBy.ok) return redeemedBy;
    if (redeemedBy.values.length === 0) {
      return {
        ok: false,
        code: "unsupported_redemption_shape",
        message: "Missing redemption recipient",
      };
    }
    if (exceedsCombinedIdentityVolume(redeemedFrom.values, redeemedBy.values)) {
      return identityVolumeResult();
    }
    return {
      ok: true,
      value: {
        ...base,
        kind: "purchase_redeemed",
        type: "PURCHASE_REDEEMED",
        redeemedFrom: redeemedFrom.values,
        redeemedBy: redeemedBy.values,
        redemptionOutcome: outcome,
      },
    };
  }

  const userId =
    typeof event.app_user_id === "string" ? event.app_user_id.trim() : "";
  if (
    !userId ||
    !isWellFormedString(userId) ||
    codePointLength(userId) > MAX_IDENTITIES
  ) {
    return {
      ok: false,
      code: "malformed_event",
      message: "Invalid event subject or time",
    };
  }

  const originalUserId = boundedString(event.original_app_user_id, 256);
  const aliasesResult =
    event.aliases === undefined
      ? ({ ok: true, values: [] } as const)
      : parseIdentityArray(event.aliases);
  if (!aliasesResult.ok) return aliasesResult;

  const combinedIdentities = new Set<string>([userId]);
  if (originalUserId) combinedIdentities.add(originalUserId);
  const aliases: string[] = [];
  for (const alias of aliasesResult.values) {
    if (!combinedIdentities.has(alias)) {
      combinedIdentities.add(alias);
      aliases.push(alias);
    }
  }
  if (combinedIdentities.size > MAX_IDENTITIES) return identityVolumeResult();

  return {
    ok: true,
    value: {
      ...base,
      kind: "ordinary",
      type,
      userId,
      originalUserId,
      aliases,
    },
  };
}
