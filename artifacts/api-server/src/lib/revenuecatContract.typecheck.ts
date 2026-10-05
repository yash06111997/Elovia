import {
  RECONCILING_REVENUECAT_EVENTS,
  type OrdinaryRevenueCatDelivery,
  type RevenueCatDelivery,
} from "./revenuecatContract.js";
import type {
  RevenueCatClient,
  TrustedLocalUid,
} from "./revenuecatClient.js";

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

declare const revenueCatClient: RevenueCatClient;
declare const trustedLocalUid: TrustedLocalUid;
declare const rawLocalUid: string;

void revenueCatClient.getSubscriber(trustedLocalUid);
// @ts-expect-error Raw strings have not crossed the authenticated local-user boundary.
void revenueCatClient.getSubscriber(rawLocalUid);
