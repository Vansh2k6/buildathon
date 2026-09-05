/**
 * lib/policy/buyer.ts — the AI-buyer policy surface (T-23, AGENT.md §5.4).
 *
 * Different rules, same Verdict type, same module boundary, same audit path.
 * Our effective prices are authoritative: the total and the approved per-unit
 * prices are computed here, never taken from the buyer (BUYER_PRICE_INTEGRITY).
 */
import { effectivePriceP } from '../money';
import { BUYER_RULES, orderTotalP, DEFAULT_BUYER_POLICY_LIMITS } from './rules';
export { DEFAULT_BUYER_POLICY_LIMITS };
import { approve, type ApprovedAction, type BuyerOrderProposal, type MerchantPolicyLimits, type RuleId, type Verdict } from './types';
import type { BuyerFacts } from './rules';

export function evaluateBuyerOrder(order: BuyerOrderProposal, policy: MerchantPolicyLimits, facts: BuyerFacts): Verdict {
  const checked: RuleId[] = [];

  for (const rule of BUYER_RULES) {
    const failure = rule.check(order, policy, facts);
    if (failure) {
      return {
        ok: false,
        rule: rule.id,
        message: failure.message,
        detail: { value: failure.value, limit: failure.limit, sku: failure.sku },
      };
    }
    checked.push(rule.id);
  }

  const lines = order.lines.map((line) => {
    const product = facts.catalog[line.sku];
    const unitPriceP = effectivePriceP(product.price_p, product.active_discount_pct);
    return { sku: line.sku, qty: line.qty, unit_price_p: unitPriceP };
  });

  const approvedAction: ApprovedAction = approve({
    kind: 'buyer_order',
    buyer_ref: order.buyer_ref,
    lines,
    total_p: orderTotalP(order, facts),
  });

  return { ok: true, approvedAction, checked };
}
