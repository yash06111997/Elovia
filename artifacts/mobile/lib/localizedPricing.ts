export function monthlyEquivalent(price: number, currencyCode: string, locale?: string): string {
  if (!Number.isFinite(price) || price < 0) return "";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(price / 12); }
  catch { return `${(price / 12).toFixed(2)} ${currencyCode}`; }
}
export function annualSavings(monthly: number, yearly: number, monthlyCurrency: string, yearlyCurrency: string): number {
  if (monthlyCurrency !== yearlyCurrency || monthly <= 0 || yearly <= 0) return 0;
  return Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100));
}
