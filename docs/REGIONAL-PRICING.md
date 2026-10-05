# Elovia regional subscription pricing

Selected on 2026-10-05 at the owner's request. App-store country is authoritative. Do not use IP/GPS/nationality to guess a price or grant an entitlement. RevenueCat packages return the actual localized store price; the store purchase sheet is the final charge authority.

## Market evidence

Public App Store IAP listings can include multiple and legacy products; they do not prove which offer every customer receives.

| Storefront | Public comparison | Elovia launch target monthly / annual |
| --- | --- | --- |
| US | [Hevy](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350): $2.99/$3.99 monthly, $23.99 annual; [Fitbod](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543): $12.99/$15.99 monthly, $79.99/$95.99 annual | $4.99 / $29.99 USD |
| India | [Hevy](https://apps.apple.com/in/app/hevy-gym-tracker-workout-log/id1458862350): ₹249/₹349 monthly, ₹1,999 annual; [Fitbod](https://apps.apple.com/in/app/fitbod-workout-gym-planner/id1041517543): ₹360/₹399 monthly, ₹1,999/₹2,000 annual | ₹199 / ₹1,499 INR |
| Australia | [Hevy](https://apps.apple.com/au/app/hevy-workout-tracker-gym-log/id1458862350): A$4.99/A$6.49 monthly, A$38.99 annual | A$7.99 / A$49.99 AUD |
| Canada | Store-equivalent tier, not independently competitor-benchmarked | C$6.99 / C$39.99 CAD |
| UK | Store-equivalent tier, not independently competitor-benchmarked | £4.99 / £29.99 GBP |
| Eurozone | Store-equivalent tier including store tax/rounding, not independently competitor-benchmarked | €4.99 / €34.99 EUR |

India is a deliberate purchasing-power adjustment, not a USD exchange-rate conversion. These are founder launch decisions inferred from the sample, not economically optimal prices proven by research. Australia is positioned above a plain logger and below expensive AI-only subscriptions. Do not raise any existing subscriber's renewal price as part of this setup.

## Configuration boundaries

- Apple and Google set chargeable prices and free-trial offers. RevenueCat Test Store prices alone do not set production storefront prices.
- Apple base annual target $29.99; override India's auto-calculated ₹2,999 to ₹1,499. Monthly base target $4.99; override India to ₹199. Other unreviewed countries use the store-generated local tier initially, not a claim of individually optimized purchasing-power pricing.
- No monthly introductory trial. Annual free trial: two weeks, new eligible subscribers only. Subsequent annual charge displayed in full; automatic renewal and cancellation described clearly.
- Lifetime product IDs are preserved. New native paywall prioritizes monthly/annual. No unlicensed unlimited media or human coaching included in Pro pricing. Human coaching is a separate product and is not repriced here.
- A Google payments profile has now been initiated, but BillDesk cross-border verification remains pending. Identity verification, owner-only device verification and phone verification also remain release gates. Chargeable Google products/prices have not yet been configured and tested.
- The first Apple subscription group must be submitted with a new app version. Creating draft products/prices is not App Store approval or a verified purchase flow.

## Pricing implementation

Mobile uses `product.priceString` for chargeable totals and `Intl.NumberFormat` with the product's ISO currency for monthly equivalents. Savings are calculated only for matching storefront currencies. No fallback USD amount is presented as a real local offer when packages fail to load.

Before rollout: verify storefronts in Apple sandbox and Google license testing, buy/restore/cancel, annual eligibility versus returning subscribers, webhook access synchronization, taxes, and all configured regional tiers. Review conversion, refund/support rate and service costs after real usage; do not infer purchasing power from a single country's average income.
