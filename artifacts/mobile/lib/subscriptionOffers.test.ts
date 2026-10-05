import { freeTrialDays, purchasePolicyError } from "./subscriptionOffers";
import type { PurchasesPackage } from "react-native-purchases";

function pkg(id: string, extra: Record<string, unknown> = {}): PurchasesPackage {
  return { identifier: "$rc_annual", product: { identifier: id, introPrice: null, defaultOption: null, subscriptionOptions: [], ...extra } } as unknown as PurchasesPackage;
}
test("yearly trial requires exactly fourteen days, not fifteen", () => {
  const yearly = pkg("elovia_pro_yearly", { introPrice: { price: 0, periodUnit: "WEEK", periodNumberOfUnits: 2, cycles: 1 } });
  expect(freeTrialDays(yearly, "ios")).toBe(14);
  expect(purchasePolicyError(yearly, "ios")).toBeNull();
  const wrong = pkg("elovia_pro_yearly", { introPrice: { price: 0, periodUnit: "DAY", periodNumberOfUnits: 15, cycles: 1 } });
  expect(purchasePolicyError(wrong, "ios")).toMatch(/14 days/);
});
test("monthly iOS trials and unrecognised products cannot be bought", () => {
  expect(purchasePolicyError(pkg("elovia_pro_monthly", { introPrice: { price: 0 } }), "ios")).toMatch(/no.*free trial/);
  expect(purchasePolicyError(pkg("another_app_yearly"), "ios")).toMatch(/not an Elovia/);
});
test("Android monthly uses a paid base plan and validates annual free-phase length", () => {
  expect(purchasePolicyError(pkg("elovia_pro_monthly:monthly", { subscriptionOptions: [{ isBasePlan: true, freePhase: null }] }), "android")).toBeNull();
  expect(purchasePolicyError(pkg("elovia_pro_monthly:monthly"), "android")).toMatch(/unavailable/);
  const annual = pkg("elovia_pro_yearly:yearly", { defaultOption: { freePhase: { billingPeriod: { unit: "WEEK", value: 2 }, billingCycleCount: 1 } } });
  expect(freeTrialDays(annual, "android")).toBe(14);
});
