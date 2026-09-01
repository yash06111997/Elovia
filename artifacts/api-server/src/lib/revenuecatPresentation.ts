type PlainRow = Readonly<Record<string, unknown>>;

const ROLE_MASKS = Object.freeze([
  [1, "primary"],
  [2, "original"],
  [4, "alias"],
  [8, "transferred_from"],
  [16, "transferred_to"],
  [32, "redeemed_from"],
  [64, "redeemed_by"],
] as const);

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(value)));
}

function stringOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function phase(required: unknown, appliedAt: unknown) {
  if (required !== true) return "not_required" as const;
  return appliedAt ? ("applied" as const) : ("pending" as const);
}

function decodedRoles(maskValue: unknown): string[] {
  const mask = count(maskValue);
  return ROLE_MASKS.filter(([bit]) => (mask & bit) !== 0).map(
    ([, name]) => name,
  );
}

function safeEventMetadata(value: unknown) {
  const metadata =
    value && typeof value === "object" ? (value as PlainRow) : {};
  const result: {
    schemaVersion?: number;
    identityCount?: number;
    redemptionOutcome?: "alias" | "transfer" | "redeemer_owns";
  } = {};
  if (metadata.schemaVersion === 1) result.schemaVersion = 1;
  if (
    typeof metadata.identityCount === "number" &&
    Number.isInteger(metadata.identityCount) &&
    metadata.identityCount >= 0 &&
    metadata.identityCount <= 256
  ) {
    result.identityCount = metadata.identityCount;
  }
  if (
    metadata.redemptionOutcome === "alias" ||
    metadata.redemptionOutcome === "transfer" ||
    metadata.redemptionOutcome === "redeemer_owns"
  ) {
    result.redemptionOutcome = metadata.redemptionOutcome;
  }
  return result;
}

export type RevenueCatDiagnosticsInput = Readonly<{
  configuration: PlainRow;
  counts: PlainRow;
}>;

/** Build the public-safe RevenueCat diagnostics fragment from fetched values. */
export function buildRevenueCatDiagnostics(input: RevenueCatDiagnosticsInput) {
  const configuration = {
    valid: input.configuration.valid === true,
    webhookSecretPresent: input.configuration.webhookSecretPresent === true,
    apiKeyPresent: input.configuration.apiKeyPresent === true,
    subjectHashKeyPresent: input.configuration.subjectHashKeyPresent === true,
    proProductCount: count(input.configuration.proProductCount),
    coachingProductCount: count(input.configuration.coachingProductCount),
  };
  const customers = {
    noncanonical: count(input.counts.noncanonicalCustomers),
    missingState: count(input.counts.missingCustomerStates),
    hasNoncanonical: false,
  };
  customers.hasNoncanonical =
    customers.noncanonical > 0 || customers.missingState > 0;
  const strictMode = input.configuration.normalizedReads === "strict";

  return {
    configuration,
    events: {
      due: count(input.counts.dueEvents),
      failed: count(input.counts.failedEvents),
      pending: count(input.counts.pendingEvents),
      pendingIdentityPhase: count(input.counts.pendingIdentityPhase),
      pendingEntitlementPhase: count(input.counts.pendingEntitlementPhase),
      pruned: count(input.counts.prunedEvents),
    },
    customers,
    strictMode,
    ready: configuration.valid && (!strictMode || !customers.hasNoncanonical),
  };
}

export type RevenueCatPrivacyInput = Readonly<{
  entitlements: readonly PlainRow[];
  events: readonly PlainRow[];
  reconciliation: PlainRow | null;
}>;

/** Build a strict allowlist of the billing state linked to one local account. */
export function buildRevenueCatPrivacyExport(input: RevenueCatPrivacyInput) {
  const events = new Map<
    string,
    ReturnType<typeof projectEvent> & { _roleMask: number }
  >();
  for (const row of input.events) {
    const eventId = stringOrNull(row.eventId, 128);
    if (!eventId) continue;
    const existing = events.get(eventId);
    if (existing) {
      existing._roleMask |= count(row.roleMask);
      existing.roles = decodedRoles(existing._roleMask);
      continue;
    }
    events.set(eventId, projectEvent(row, eventId));
  }

  return {
    label: "RevenueCat billing entitlement state",
    entitlements: input.entitlements.map((row) => ({
      entitlementId: stringOrNull(row.entitlementId, 128),
      active: row.active === true,
      status: stringOrNull(row.status, 32),
      productId: stringOrNull(row.productId, 256),
      store: stringOrNull(row.store, 32),
      periodEndsAt: dateOrNull(row.periodEndsAt),
      graceEndsAt: dateOrNull(row.graceEndsAt),
      accessEndsAt: dateOrNull(row.accessEndsAt),
      willRenew: row.willRenew === true,
      sourceEnvironment: stringOrNull(row.sourceEnvironment, 16),
      sourceKind: stringOrNull(row.sourceKind, 32),
      sourceSnapshotAt: dateOrNull(row.sourceSnapshotAt),
    })),
    events: [...events.values()].map(({ _roleMask: _, ...event }) => event),
    reconciliation: input.reconciliation
      ? {
          canonicalizationState: stringOrNull(
            input.reconciliation.canonicalizationState,
            32,
          ),
          sourceKind: stringOrNull(input.reconciliation.sourceKind, 32),
          sourceEnvironment: stringOrNull(
            input.reconciliation.sourceEnvironment,
            16,
          ),
          lastSnapshotAt: dateOrNull(input.reconciliation.lastSnapshotAt),
          lastReconciledAt: dateOrNull(input.reconciliation.lastReconciledAt),
          reconcileReason: stringOrNull(
            input.reconciliation.reconcileReason,
            32,
          ),
          reconcileAfter: dateOrNull(input.reconciliation.reconcileAfter),
          reconcileAttemptCount: count(
            input.reconciliation.reconcileAttemptCount,
          ),
          lastErrorCode: stringOrNull(
            input.reconciliation.reconcileLastErrorCode,
            64,
          ),
        }
      : null,
  };
}

function projectEvent(row: PlainRow, eventId: string) {
  const roleMask = count(row.roleMask);
  return {
    eventId,
    type: stringOrNull(row.type, 64),
    eventAt: dateOrNull(row.eventAt),
    receivedAt: dateOrNull(row.receivedAt),
    environment: stringOrNull(row.environment, 16),
    disposition: stringOrNull(row.disposition, 32),
    metadata: safeEventMetadata(row.metadata),
    identityCount: count(row.identityCount),
    retainedIdentityCount: count(row.retainedIdentityCount),
    prunedIdentityCount: count(row.prunedIdentityCount),
    roles: decodedRoles(roleMask),
    phases: {
      identity: phase(row.identityRequired, row.identityAppliedAt),
      entitlement: phase(row.entitlementRequired, row.entitlementAppliedAt),
    },
    processedAt: dateOrNull(row.processedAt),
    _roleMask: roleMask,
  };
}
