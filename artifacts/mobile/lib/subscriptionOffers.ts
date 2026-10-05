import type { PurchasesPackage } from "react-native-purchases";
import { PRODUCT_IDS } from "@/constants/subscription";

export function freeTrialDays(pkg: PurchasesPackage, platform: string) {
  if (platform === "android") {
    const phase = pkg.product.defaultOption?.freePhase;
    if (!phase) return 0;
    const days = phase.billingPeriod.unit === "DAY" ? phase.billingPeriod.value : phase.billingPeriod.unit === "WEEK" ? phase.billingPeriod.value * 7 : 0;
    return days * (phase.billingCycleCount || 1);
  }
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return 0;
  return (intro.periodUnit === "DAY" ? intro.periodNumberOfUnits : intro.periodUnit === "WEEK" ? intro.periodNumberOfUnits * 7 : 0) * intro.cycles;
}
export function purchasePolicyError(pkg: PurchasesPackage, platform: string): string | null {
  const id = pkg.product.identifier.split(":")[0];
  if (!Object.values(PRODUCT_IDS).some(product => product === id)) return "This product is not an Elovia Pro subscription. Please refresh the plans.";
  if (id === PRODUCT_IDS.monthly && platform !== "android" && pkg.product.introPrice?.price === 0) return "The monthly plan is temporarily unavailable while its store offer is corrected. Monthly subscriptions do not include a free trial.";
  const days = freeTrialDays(pkg, platform);
  const hasFreeOffer = platform === "android" ? !!pkg.product.defaultOption?.freePhase : pkg.product.introPrice?.price === 0;
  if (id === PRODUCT_IDS.yearly && hasFreeOffer && days !== 14) return "The yearly trial is temporarily unavailable while its store offer is corrected to 14 days.";
  if (platform === "android" && id === PRODUCT_IDS.monthly && !pkg.product.subscriptionOptions?.some(option => option.isBasePlan && !option.freePhase)) return "The monthly plan is unavailable. Please try again later.";
  return null;
}
