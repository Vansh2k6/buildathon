/**
 * lib/policy/types.ts — the policy engine's vocabulary (T-20).
 *
 * Pure types only: no imports from decide/, no network client, no Supabase
 * (AGENT.md §1.1). `ApprovedAction` carries an unexported unique-symbol brand,
 * so raw model output has no type-level path to execute (FR-15 / BND-1):
 * the brand cannot be named outside this directory, so a compliant literal
 * cannot be constructed outside `lib/policy/`.
 */

/** The 12 agent-action rule ids, in evaluation order (AGENT.md §5.1). */
export type AgentRuleId =
  | 'SKU_EXISTS'
  | 'SCHEMA_FIELDS'
  | 'MIN_CONFIDENCE'
  | 'BLOCKED_CATEGORY'
  | 'STOCK_FLOOR'
  | 'MAX_DISCOUNT_PCT'
  | 'MIN_MARGIN_PCT'
  | 'COOLDOWN'
  | 'MAX_ACTIVE_DISCOUNTS'
  | 'MAX_ACTIONS_PER_DAY'
  | 'DAILY_DISCOUNT_BUDGET'
  | 'FEATURED_SLOTS';

/** The 5 AI-buyer rule ids, in evaluation order (AGENT.md §5.4). */
export type BuyerRuleId =
  | 'BUYER_SKU_UNKNOWN'
  | 'BUYER_MAX_QTY'
  | 'BUYER_STOCK'
  | 'BUYER_MAX_ORDER'
  | 'BUYER_PRICE_INTEGRITY';

export type RuleId = AgentRuleId | BuyerRuleId;

/** What the model is allowed to propose (tool contract, AGENT.md §4.4). */
export type ProposalAction = 'discount' | 'feature' | 'discount_and_feature' | 'no_action';

export interface Proposal {
  action: ProposalAction;
  /** Required unless action is no_action. */
  sku?: string;
  /** Required for discount / discount_and_feature. Integer 1..90. */
  discount_pct?: number;
  /** Required for feature / discount_and_feature. Integer 1..8; 1 = leftmost slot. */
  featured_rank?: number;
  /** 0..1 */
  confidence: number;
  justification: string;
  trend_match?: { headline: string; why_it_matches: string };
}

/** The merchant_policy row's tunable limits (db/001_schema.sql). */
export interface MerchantPolicyLimits {
  max_discount_pct: number;
  min_margin_pct: number;
  max_active_discounts: number;
  max_actions_per_day: number;
  daily_discount_budget_p: number;
  max_featured_slots: number;
  cooldown_days: number;
  blocked_categories: string[];
  buyer_max_order_p: number;
  buyer_max_qty_per_sku: number;
}

/** The slice of catalog/world state a rule may look at. Supplied by the caller; policy never queries. */
export interface ProductFact {
  sku: string;
  category: string;
  price_p: number;
  cost_p: number;
  inventory: number;
  is_featured: boolean;
  /** Active discount percentage, or null. Effective price derives from this. */
  active_discount_pct: number | null;
}

export interface AgentWorldFacts {
  /** Catalog by sku — the only way a proposal's sku resolves. */
  catalog: Record<string, ProductFact>;
  /** Store-wide count of currently active discounts. */
  active_discount_count: number;
  /** Day index of the most recent discount created for the proposed sku, or null. */
  last_discount_day: number | null;
  /** Agent actions executed so far today. */
  executed_runs_today: number;
  /** Projected give-away already committed today, in paise. */
  spent_today_p: number;
  /** Orders per day for days d-6..d (7 values, oldest first) — budget estimator input. */
  recent_daily_orders: number[];
  /** Current simulated day index. */
  current_day: number;
  /** Featured count after this action (engine supplies the closure: +1 when the action features a non-featured product). */
  featuredCountAfter(product: ProductFact): number;
}

export interface BuyerLine {
  sku: string;
  qty: number;
  /** Price the buyer asserts per unit, in paise. Optional; ours is authoritative. */
  asserted_price_p?: number;
}

export interface BuyerOrderProposal {
  buyer_ref: string;
  lines: BuyerLine[];
}

declare const APPROVED: unique symbol;

/** The only object execute() accepts. Constructible solely via approve() here. */
export type ApprovedAction =
  | { readonly kind: 'no_action'; readonly [APPROVED]: true }
  | {
      readonly kind: 'discount';
      readonly sku: string;
      readonly discount_pct: number;
      readonly [APPROVED]: true;
    }
  | {
      readonly kind: 'feature';
      readonly sku: string;
      readonly featured_rank: number;
      readonly [APPROVED]: true;
    }
  | {
      readonly kind: 'discount_and_feature';
      readonly sku: string;
      readonly discount_pct: number;
      readonly featured_rank: number;
      readonly [APPROVED]: true;
    }
  | {
      readonly kind: 'buyer_order';
      readonly buyer_ref: string;
      readonly lines: ReadonlyArray<{ readonly sku: string; readonly qty: number; readonly unit_price_p: number }>;
      readonly total_p: number;
      readonly [APPROVED]: true;
    };

/** Build an ApprovedAction. Inside lib/policy/ only — the brand is unexportable. */
export function approve(
  action: Omit<Extract<ApprovedAction, { kind: 'no_action' }>, typeof APPROVED> |
    Omit<Extract<ApprovedAction, { kind: 'discount' }>, typeof APPROVED> |
    Omit<Extract<ApprovedAction, { kind: 'feature' }>, typeof APPROVED> |
    Omit<Extract<ApprovedAction, { kind: 'discount_and_feature' }>, typeof APPROVED> |
    Omit<Extract<ApprovedAction, { kind: 'buyer_order' }>, typeof APPROVED>,
): ApprovedAction {
  return action as ApprovedAction;
}

export type Verdict =
  | { ok: true; approvedAction: ApprovedAction; checked: RuleId[] }
  | {
      ok: false;
      rule: RuleId;
      message: string;
      detail: { value: number | string; limit: number | string; sku?: string };
    };
