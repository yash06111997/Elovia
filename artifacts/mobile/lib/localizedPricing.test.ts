import { monthlyEquivalent, annualSavings } from "./localizedPricing";
test("uses storefront currency and locale, not stripped currency symbols or GPS", () => {
  expect(monthlyEquivalent(1499, "INR", "en-IN")).toBe("₹124.92");
  expect(monthlyEquivalent(29.99, "USD", "en-US")).toBe("$2.50");
  expect(monthlyEquivalent(29.99, "EUR", "de-DE")).toContain("2,50");
  expect(annualSavings(199, 1499, "INR", "INR")).toBe(37);
  expect(annualSavings(199, 29.99, "INR", "USD")).toBe(0);
});
