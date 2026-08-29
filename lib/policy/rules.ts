/**
 * lib/policy/rules.ts — every rule as one exported pure function (T-21).
 *
 * Order and predicates are AGENT.md §5.1/§5.4 verbatim. Each rule returns
 * null to pass or a violation detail; `engine.ts` runs them in order and
 * stops at the first violation so the audit names exactly one cause (NFR-7).
 * No imports from decide/, no network, no Supabase — facts arrive as arguments.
 */
import type {
  AgentRuleId,
  AgentWorldFacts,
  BuyerOrderProposal,
  BuyerRuleId,
  MerchantPolicyLimits,
  ProductFact,
  Proposal,
} from './types';

export type RuleFailure = {
  value: number | string;
  limit: number | string;
  message: string;
  sku?: string;
};

type AgentRule = {
  id: AgentRuleId;
  /** Does this rule apply to the proposal at all? */
  applies: (p: Proposal, facts: AgentWorldFacts) => boolean;
  check: (p: Proposal, policy: MerchantPolicyLimits, facts: AgentWorldFacts) => RuleFailure | null;
};

type BuyerRule = {
  id: BuyerRuleId;
  check: (o: BuyerOrderProposal, policy: MerchantPolicyLimits, facts: BuyerFacts) => RuleFailure | null;
};

export interface BuyerFacts {
  catalog: Record<string, ProductFact>;
}

/** Integer-paise effective price under an active discount percentage. */
export function effectivePriceP(priceP: number, discountPct: number | null): number {
  if (discountPct === null) return priceP;
  return Math.floor((priceP * (100 - discountPct)) / 100);
}

/** AGENT.md §5.3 — projected give-away for one new discount, in paise. */
export function projectedGiveawayP(priceP: number, discountPct: number, recentDailyOrders: number[]): {
  expectedUnits: number;
  projectedP: number;
} {
  const mean = recentDailyOrders.length > 0
    ? recentDailyOrders.reduce((s, n) => s + n, 0) / recentDailyOrders.length
    : 0;
  const expectedUnits = Math.max(1, Math.round(mean));
  const projectedP = Math.floor((priceP * discountPct) / 100) * expectedUnits;
  return { expectedUnits, projectedP };
}

const DISCOUNT_ACTIONS = new Set(['discount', 'discount_and_feature']);
const FEATURE_ACTIONS = new Set(['feature', 'discount_and_feature']);

/** §5.1 rules 1–12, in evaluation order. */
export const AGENT_RULES: AgentRule[] = [
  {
    id: 'SKU_EXISTS',
    applies: () => true,
    check: (p, _policy, facts) => {
      if (p.action === 'no_action') return null; // nothing to resolve
      if (!p.sku) return { value: 'missing', limit: 'a catalog sku', message: 'no sku supplied' };
      if (!facts.catalog[p.sku]) {
        return { value: p.sku, limit: 'an item in the catalog', message: `sku "${p.sku}" is not in the catalog` };
      }
      return null;
    },
  },
  {
    id: 'SCHEMA_FIELDS',
    applies: () => true,
    check: (p) => {
      if (p.action === 'no_action') return null;
      if (DISCOUNT_ACTIONS.has(p.action)) {
        const d = p.discount_pct;
        if (d === undefined || !Number.isInteger(d)) {
          return { value: String(d ?? 'missing'), limit: 'integer discount_pct', message: 'action needs an integer discount_pct' };
        }
        // Tool-schema bounds (§4.4) re-checked at the last gate before execute
        // (FR-15 defense in depth; also keeps MIN_MARGIN's sale math non-degenerate).
        if (d < 1 || d > 90) {
          return { value: d, limit: '1..90', message: `discount_pct ${d} outside 1..90` };
        }
      }
      if (FEATURE_ACTIONS.has(p.action)) {
        const r = p.featured_rank;
        if (r === undefined || !Number.isInteger(r)) {
          return { value: String(r ?? 'missing'), limit: 'integer featured_rank', message: 'action needs an integer featured_rank' };
        }
        if (r < 1 || r > 8) {
          return { value: r, limit: '1..8', message: `featured_rank ${r} outside 1..8` };
        }
      }
      return null;
    },
  },
  {
    id: 'MIN_CONFIDENCE',
    applies: (p) => p.action !== 'no_action',
    check: (p) =>
      p.confidence >= 0.6 ? null : { value: p.confidence, limit: 0.6, message: `confidence ${p.confidence} is below 0.60` },
  },
  {
    id: 'BLOCKED_CATEGORY',
    applies: (p) => p.action !== 'no_action',
    check: (p, policy, facts) => {
      const product = facts.catalog[p.sku as string];
      if (policy.blocked_categories.includes(product.category)) {
        return {
          value: product.category,
          limit: policy.blocked_categories.join(', ') || '(none)',
          message: `category "${product.category}" is merchant-blocked`,
        };
      }
      return null;
    },
  },
  {
    id: 'STOCK_FLOOR',
    applies: (p) => p.action !== 'no_action',
    check: (p, _policy, facts) => {
      const product = facts.catalog[p.sku as string];
      return product.inventory >= 5
        ? null
        : { value: product.inventory, limit: 5, message: `only ${product.inventory} in stock, floor is 5` };
    },
  },
  {
    id: 'MAX_DISCOUNT_PCT',
    applies: (p) => DISCOUNT_ACTIONS.has(p.action),
    check: (p, policy) =>
      (p.discount_pct as number) <= policy.max_discount_pct
        ? null
        : { value: p.discount_pct as number, limit: policy.max_discount_pct, message: `proposed ${p.discount_pct}% exceeds the ${policy.max_discount_pct}% ceiling` },
  },
  {
    id: 'MIN_MARGIN_PCT',
    applies: (p) => DISCOUNT_ACTIONS.has(p.action),
    check: (p, policy, facts) => {
      // §5.2 — integer paise; pass ⟺ margin_p * 100 >= sale_p * min_margin_pct
      const product = facts.catalog[p.sku as string];
      const saleP = effectivePriceP(product.price_p, p.discount_pct as number);
      const marginP = saleP - product.cost_p;
      const marginPct1dp = Math.round((marginP / saleP) * 1000) / 10;
      return marginP * 100 >= saleP * policy.min_margin_pct
        ? null
        : {
            value: marginPct1dp,
            limit: policy.min_margin_pct,
            message: `discounting to ${saleP}p would leave a ${marginPct1dp}% margin, floor is ${policy.min_margin_pct}%`,
          };
    },
  },
  {
    id: 'COOLDOWN',
    applies: (p) => DISCOUNT_ACTIONS.has(p.action),
    check: (p, policy, facts) => {
      const last = facts.last_discount_day;
      if (last === null) return null;
      const gap = facts.current_day - last;
      return gap > policy.cooldown_days
        ? null
        : { value: gap, limit: policy.cooldown_days, message: `last discount was ${gap}d ago, cooldown is ${policy.cooldown_days}d` };
    },
  },
  {
    id: 'MAX_ACTIVE_DISCOUNTS',
    applies: (p) => DISCOUNT_ACTIONS.has(p.action),
    check: (p, policy, facts) =>
      facts.active_discount_count + 1 <= policy.max_active_discounts
        ? null
        : { value: facts.active_discount_count + 1, limit: policy.max_active_discounts, message: `would be ${facts.active_discount_count + 1} active discounts, cap is ${policy.max_active_discounts}` },
  },
  {
    id: 'MAX_ACTIONS_PER_DAY',
    applies: (p) => p.action !== 'no_action',
    check: (p, policy, facts) =>
      facts.executed_runs_today < policy.max_actions_per_day
        ? null
        : { value: facts.executed_runs_today, limit: policy.max_actions_per_day, message: `${facts.executed_runs_today} actions already today, cap is ${policy.max_actions_per_day}` },
  },
  {
    id: 'DAILY_DISCOUNT_BUDGET',
    applies: (p) => DISCOUNT_ACTIONS.has(p.action),
    check: (p, policy, facts) => {
      const product = facts.catalog[p.sku as string];
      const { expectedUnits, projectedP } = projectedGiveawayP(product.price_p, p.discount_pct as number, facts.recent_daily_orders);
      return facts.spent_today_p + projectedP <= policy.daily_discount_budget_p
        ? null
        : {
            value: facts.spent_today_p + projectedP,
            limit: policy.daily_discount_budget_p,
            message: `projected give-away ₹${((facts.spent_today_p + projectedP) / 100).toFixed(2)} would exceed the ₹${(policy.daily_discount_budget_p / 100).toFixed(0)} daily budget (est. ${expectedUnits} units)`,
          };
    },
  },
  {
    id: 'FEATURED_SLOTS',
    applies: (p) => FEATURE_ACTIONS.has(p.action),
    check: (p, policy, facts) => {
      const product = facts.catalog[p.sku as string];
      const after = facts.featuredCountAfter(product);
      return after <= policy.max_featured_slots
        ? null
        : { value: after, limit: policy.max_featured_slots, message: `${after} featured titles after this, cap is ${policy.max_featured_slots}` };
    },
  },
];

/** §5.4 buyer rules, in evaluation order. Same Verdict, same boundary. */
export const BUYER_RULES: BuyerRule[] = [
  {
    id: 'BUYER_SKU_UNKNOWN',
    check: (o, _policy, facts) => {
      for (const line of o.lines) {
        if (!facts.catalog[line.sku]) {
          return { value: line.sku, limit: 'an item in the catalog', message: `sku "${line.sku}" is not in the catalog`, sku: line.sku };
        }
      }
      return null;
    },
  },
  {
    id: 'BUYER_MAX_QTY',
    check: (o, policy, _facts) => {
      for (const line of o.lines) {
        if (line.qty > policy.buyer_max_qty_per_sku) {
          return {
            value: line.qty,
            limit: policy.buyer_max_qty_per_sku,
            message: `qty ${line.qty} of ${line.sku} exceeds the ${policy.buyer_max_qty_per_sku}-per-sku cap`,
            sku: line.sku,
          };
        }
      }
      return null;
    },
  },
  {
    id: 'BUYER_STOCK',
    check: (o, _policy, facts) => {
      for (const line of o.lines) {
        const product = facts.catalog[line.sku];
        if (line.qty > product.inventory) {
          return { value: line.qty, limit: product.inventory, message: `only ${product.inventory} of ${line.sku} in stock`, sku: line.sku };
        }
      }
      return null;
    },
  },
  {
    id: 'BUYER_MAX_ORDER',
    check: (o, policy, facts) => {
      const total = orderTotalP(o, facts);
      return total <= policy.buyer_max_order_p
        ? null
        : {
            value: total,
            limit: policy.buyer_max_order_p,
            message: `order total ₹${(total / 100).toFixed(2)} exceeds the ₹${(policy.buyer_max_order_p / 100).toFixed(0)} cap`,
          };
    },
  },
  {
    id: 'BUYER_PRICE_INTEGRITY',
    check: (o, _policy, facts) => {
      for (const line of o.lines) {
        if (line.asserted_price_p === undefined) continue;
        const product = facts.catalog[line.sku];
        const ours = effectivePriceP(product.price_p, product.active_discount_pct);
        if (line.asserted_price_p !== ours) {
          return {
            value: line.asserted_price_p,
            limit: ours,
            message: `buyer asserted ${line.asserted_price_p}p for ${line.sku}; our price is ${ours}p`,
            sku: line.sku,
          };
        }
      }
      return null;
    },
  },
];

/** Order total in paise at OUR effective prices — the buyer's arithmetic is never trusted. */
export function orderTotalP(o: BuyerOrderProposal, facts: BuyerFacts): number {
  return o.lines.reduce((sum, line) => {
    const product = facts.catalog[line.sku];
    return product ? sum + effectivePriceP(product.price_p, product.active_discount_pct) * line.qty : sum;
  }, 0);
}
