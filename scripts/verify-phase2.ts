/**
 * verify-phase2.ts — Phase 2 gate assertions (G1, TASKS T-24).
 * Run: npx tsx scripts/verify-phase2.ts
 *
 * Pure: no DB, no env, no network. Covers the exact numbers in AGENT.md §5.2
 * plus budget, cooldown, and the §5.4 buyer cases. Exit 3 on any failure.
 */
import { evaluate } from '../lib/policy/engine';
import { evaluateBuyerOrder } from '../lib/policy/buyer';
import type { AgentWorldFacts, MerchantPolicyLimits, Proposal, ProductFact, Verdict } from '../lib/policy/types';

// ── fixtures: the load-bearing seed numbers (RULES.md DET-3) ──────────
const TEA: ProductFact = { sku: 'TEA-001', category: 'fiction', price_p: 49900, cost_p: 30000, inventory: 42, is_featured: false, active_discount_pct: null };
const OIL: ProductFact = { sku: 'OIL-004', category: 'wellness', price_p: 99900, cost_p: 75000, inventory: 30, is_featured: false, active_discount_pct: null };
const GIFT: ProductFact = { sku: 'GIFT-006', category: 'gift', price_p: 849900, cost_p: 600000, inventory: 12, is_featured: false, active_discount_pct: null };
const LOW: ProductFact = { sku: 'LOW-007', category: 'nature', price_p: 89900, cost_p: 45000, inventory: 3, is_featured: false, active_discount_pct: null };

const POLICY: MerchantPolicyLimits = {
  max_discount_pct: 20,
  min_margin_pct: 15,
  max_active_discounts: 3,
  max_actions_per_day: 5,
  daily_discount_budget_p: 500000,
  max_featured_slots: 4,
  cooldown_days: 1,
  blocked_categories: [],
  buyer_max_order_p: 2500000,
  buyer_max_qty_per_sku: 5,
};

function baseFacts(opts?: {
  catalog?: ProductFact[];
  activeDiscountCount?: number;
  lastDiscountDay?: number | null;
  executedToday?: number;
  spentTodayP?: number;
  dailyOrders?: number[];
  featuredCount?: number;
  featuresProposedSku?: boolean;
}): AgentWorldFacts {
  const catalog = Object.fromEntries((opts?.catalog ?? [TEA, OIL, GIFT, LOW]).map((p) => [p.sku, p]));
  const featuredCount = opts?.featuredCount ?? 2;
  const features = opts?.featuresProposedSku ?? false;
  return {
    catalog,
    active_discount_count: opts?.activeDiscountCount ?? 0,
    last_discount_day: opts?.lastDiscountDay ?? null,
    executed_runs_today: opts?.executedToday ?? 0,
    spent_today_p: opts?.spentTodayP ?? 0,
    recent_daily_orders: opts?.dailyOrders ?? [4, 4, 4, 4, 4, 4, 4],
    current_day: 8,
    featuredCountAfter: (product) =>
      features ? featuredCount + (product.is_featured ? 0 : 1) : featuredCount,
  };
}

const BASE_PROPOSAL: Proposal = {
  action: 'discount',
  sku: 'TEA-001',
  discount_pct: 18,
  confidence: 0.82,
  justification: 'test',
};

const results: Array<{ name: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
}
function rejects(name: string, verdict: Verdict, rule: string, value: unknown, limit: unknown): void {
  const ok = !verdict.ok && verdict.rule === rule
    && JSON.stringify(verdict.detail.value) === JSON.stringify(value)
    && JSON.stringify(verdict.detail.limit) === JSON.stringify(limit);
  check(name, ok, !verdict.ok ? `${verdict.rule} {value:${verdict.detail.value}, limit:${verdict.detail.limit}}` : 'unexpectedly approved');
}
function approves(name: string, verdict: Verdict, expect?: (a: Extract<Verdict, { ok: true }>['approvedAction']) => boolean): void {
  const ok = verdict.ok && (expect ? expect(verdict.approvedAction) : true);
  check(name, ok, verdict.ok ? 'approved' : `${verdict.rule}: ${verdict.message}`);
}

// ── §5.2 headline cases (G1) ──────────────────────────────────────────
rejects(
  'TEA-001 @ 30% → MAX_DISCOUNT_PCT {30, 20}',
  evaluate({ ...BASE_PROPOSAL, discount_pct: 30 }, POLICY, baseFacts()),
  'MAX_DISCOUNT_PCT', 30, 20,
);
approves(
  'TEA-001 @ 18% → approved, engine-built action carries 18',
  evaluate(BASE_PROPOSAL, POLICY, baseFacts()),
  (a) => a.kind === 'discount' && a.discount_pct === 18 && a.sku === 'TEA-001',
);
rejects(
  'OIL-004 @ 15% → MIN_MARGIN_PCT (margin 11.7% < 15%)',
  evaluate({ ...BASE_PROPOSAL, sku: 'OIL-004', discount_pct: 15 }, POLICY, baseFacts()),
  'MIN_MARGIN_PCT', 11.7, 15,
);

// ── budget (§5.3): units 4 → projected 8982×4 = 35,928p ───────────────
rejects(
  'spent ₹4,800 + ₹359.28 → DAILY_DISCOUNT_BUDGET',
  evaluate(BASE_PROPOSAL, POLICY, baseFacts({ spentTodayP: 480000 })),
  'DAILY_DISCOUNT_BUDGET', 515928, 500000,
);

// ── cooldown (§5.1 rule 8, cooldown_days = 1) ─────────────────────────
rejects(
  'discounted yesterday → COOLDOWN',
  evaluate(BASE_PROPOSAL, POLICY, baseFacts({ lastDiscountDay: 7 })),
  'COOLDOWN', 1, 1,
);
approves('discounted two days ago → cooldown clear', evaluate(BASE_PROPOSAL, POLICY, baseFacts({ lastDiscountDay: 6 })));

// ── the rest of the 12, each binding once ─────────────────────────────
rejects('unknown sku → SKU_EXISTS', evaluate({ ...BASE_PROPOSAL, sku: 'GHOST-999' }, POLICY, baseFacts()), 'SKU_EXISTS', 'GHOST-999', 'an item in the catalog');
rejects(
  'discount without discount_pct → SCHEMA_FIELDS',
  evaluate({ ...BASE_PROPOSAL, discount_pct: undefined }, POLICY, baseFacts()),
  'SCHEMA_FIELDS', 'missing', 'integer discount_pct',
);
rejects(
  'discount_pct 0 → SCHEMA_FIELDS (range regression)',
  evaluate({ ...BASE_PROPOSAL, discount_pct: 0 }, POLICY, baseFacts()),
  'SCHEMA_FIELDS', 0, '1..90',
);
rejects(
  'discount_pct 91 → SCHEMA_FIELDS (range regression)',
  evaluate({ ...BASE_PROPOSAL, discount_pct: 91 }, POLICY, baseFacts()),
  'SCHEMA_FIELDS', 91, '1..90',
);
rejects(
  'featured_rank 9 → SCHEMA_FIELDS (range regression)',
  evaluate({ ...BASE_PROPOSAL, action: 'feature', discount_pct: undefined, featured_rank: 9 }, POLICY, baseFacts()),
  'SCHEMA_FIELDS', 9, '1..8',
);
rejects('confidence 0.5 → MIN_CONFIDENCE', evaluate({ ...BASE_PROPOSAL, confidence: 0.5 }, POLICY, baseFacts()), 'MIN_CONFIDENCE', 0.5, 0.6);
rejects(
  'blocked category → BLOCKED_CATEGORY',
  evaluate({ ...BASE_PROPOSAL, sku: 'GIFT-006' }, { ...POLICY, blocked_categories: ['gift'] }, baseFacts()),
  'BLOCKED_CATEGORY', 'gift', 'gift',
);
rejects('inventory 3 → STOCK_FLOOR', evaluate({ ...BASE_PROPOSAL, sku: 'LOW-007' }, POLICY, baseFacts()), 'STOCK_FLOOR', 3, 5);
rejects(
  '3 active discounts → MAX_ACTIVE_DISCOUNTS',
  evaluate(BASE_PROPOSAL, POLICY, baseFacts({ activeDiscountCount: 3 })),
  'MAX_ACTIVE_DISCOUNTS', 4, 3,
);
rejects(
  '5 actions today → MAX_ACTIONS_PER_DAY',
  evaluate(BASE_PROPOSAL, POLICY, baseFacts({ executedToday: 5 })),
  'MAX_ACTIONS_PER_DAY', 5, 5,
);
rejects(
  '4 featured, feature a new one → FEATURED_SLOTS',
  evaluate({ ...BASE_PROPOSAL, action: 'feature', sku: 'TEA-001', featured_rank: 2, discount_pct: undefined }, POLICY, baseFacts({ featuredCount: 4, featuresProposedSku: true })),
  'FEATURED_SLOTS', 5, 4,
);
approves(
  'no_action → approved with empty effect, only rules 1–2 checked',
  evaluate({ ...BASE_PROPOSAL, action: 'no_action', sku: undefined, discount_pct: undefined }, POLICY, baseFacts()),
  (a) => a.kind === 'no_action',
);
const noAction = evaluate({ ...BASE_PROPOSAL, action: 'no_action', sku: undefined, discount_pct: undefined }, POLICY, baseFacts());
check(
  'no_action checked list is exactly [SKU_EXISTS, SCHEMA_FIELDS]',
  noAction.ok && noAction.checked.length === 2 && noAction.checked[0] === 'SKU_EXISTS' && noAction.checked[1] === 'SCHEMA_FIELDS',
  noAction.ok ? noAction.checked.join(',') : 'rejected',
);

// §8 worked example, policy pass 2 — full fact set, 18% lands
const workedExample = evaluate(BASE_PROPOSAL, POLICY, baseFacts({ featuredCount: 2 }));
approves('§8 policy(2): 18% on TEA-001 approved end-to-end', workedExample);

// ── §5.4 buyer rules ──────────────────────────────────────────────────
const buyerFacts = { catalog: baseFacts().catalog };
rejects(
  'buyer: unknown sku → BUYER_SKU_UNKNOWN',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'GHOST-999', qty: 1 }] }, POLICY, buyerFacts),
  'BUYER_SKU_UNKNOWN', 'GHOST-999', 'an item in the catalog',
);
rejects(
  'buyer: qty 6 → BUYER_MAX_QTY',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'TEA-001', qty: 6 }] }, POLICY, buyerFacts),
  'BUYER_MAX_QTY', 6, 5,
);
rejects(
  'buyer: qty over stock → BUYER_STOCK',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'LOW-007', qty: 4 }] }, POLICY, buyerFacts),
  'BUYER_STOCK', 4, 3,
);
rejects(
  'buyer: 5 × ₹8,499 → BUYER_MAX_ORDER',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'GIFT-006', qty: 5 }] }, POLICY, buyerFacts),
  'BUYER_MAX_ORDER', 4249500, 2500000,
);
rejects(
  'buyer: asserted ₹400 vs our ₹499 → BUYER_PRICE_INTEGRITY',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'TEA-001', qty: 1, asserted_price_p: 40000 }] }, POLICY, buyerFacts),
  'BUYER_PRICE_INTEGRITY', 40000, 49900,
);
approves(
  'buyer: clean order approved with OUR unit prices',
  evaluateBuyerOrder({ buyer_ref: 'agent-1', lines: [{ sku: 'TEA-001', qty: 2 }] }, POLICY, buyerFacts),
  (a) => a.kind === 'buyer_order' && a.total_p === 99800 && a.lines[0].unit_price_p === 49900,
);
const discountedCatalog = { ...baseFacts().catalog, TEA_001_DISC: { ...TEA, active_discount_pct: 18 } };
approves(
  'buyer: asserted price matching our discounted price passes integrity',
  evaluateBuyerOrder(
    { buyer_ref: 'agent-1', lines: [{ sku: 'TEA_001_DISC', qty: 1, asserted_price_p: 40918 }] },
    POLICY,
    { catalog: discountedCatalog },
  ),
  (a) => a.kind === 'buyer_order' && a.lines[0].unit_price_p === 40918,
);

// ── the brand: ApprovedAction must not leak past policy/ ──────────────
// (compile-time proof lives in the type; runtime sanity that the engine built it)
const v = evaluate(BASE_PROPOSAL, POLICY, baseFacts());
check('engine returns a fresh ApprovedAction object (not the proposal)', v.ok && (v.approvedAction as unknown) !== (BASE_PROPOSAL as unknown));

// ── report ────────────────────────────────────────────────────────────
console.log('\n══ Phase 2 verification (policy engine) ══');
let allPass = true;
for (const r of results) {
  console.log(` ${r.pass ? '✓' : '✗'} ${r.name}${r.detail && !r.pass ? `  — ${r.detail}` : ''}`);
  allPass &&= r.pass;
}
console.log(allPass ? '\nALL CHECKS PASS — gate G1 satisfied' : '\nFAILURES PRESENT');
process.exit(allPass ? 0 : 3);
