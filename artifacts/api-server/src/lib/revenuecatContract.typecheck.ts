import {
  RECONCILING_REVENUECAT_EVENTS,
  type OrdinaryRevenueCatDelivery,
  type RevenueCatDelivery,
} from "./revenuecatContract.js";

declare const delivery: RevenueCatDelivery;
declare const ordinary: OrdinaryRevenueCatDelivery;

const runtimeSet: Set<string> = RECONCILING_REVENUECAT_EVENTS;
const legacyMetadata: Record<string, string | number | string[] | null> =
  delivery.metadata;
const ordinaryUserId: string = ordinary.userId;
const ordinaryOriginal: string | null = ordinary.originalUserId;

void runtimeSet;
void legacyMetadata;
void ordinaryUserId;
void ordinaryOriginal;
