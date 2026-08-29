/**
 * lib/money.ts — Single source of truth for money and price calculations (MON-4).
 * All money values are integer paise (_p suffix).
 */

/** Integer-paise effective price under an active discount percentage. */
export function effectivePriceP(priceP: number, discountPct: number | null | undefined): number {
  if (!discountPct || discountPct <= 0) return priceP;
  return Math.floor((priceP * (100 - discountPct)) / 100);
}

/** Format paise into human-readable INR string (e.g. 49900 -> ₹499). */
export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
