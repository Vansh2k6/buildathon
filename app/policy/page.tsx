import { serverAdmin } from '@/lib/db';
import { DEFAULT_POLICY_LIMITS } from '@/lib/policy/rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getMerchantPolicy() {
  const db = serverAdmin();
  const { data } = await db.from('merchant_policy').select('*').eq('id', 1).single();
  return data ?? DEFAULT_POLICY_LIMITS;
}

export default async function PolicyPage() {
  const policy = await getMerchantPolicy();

  const rulesList = [
    {
      id: 'MAX_DISCOUNT_PCT',
      name: 'Maximum Single Discount',
      value: `${policy.max_discount_pct}%`,
      description: 'The strict ceiling for any individual product price reduction. Proposed discounts exceeding this limit are blocked.',
      highlight: true,
    },
    {
      id: 'MIN_MARGIN_PCT',
      name: 'Minimum Gross Margin Floor',
      value: `${policy.min_margin_pct}%`,
      description: 'Ensures sale price never falls below product cost plus minimum profit margin.',
    },
    {
      id: 'MAX_ACTIVE_DISCOUNTS',
      name: 'Storewide Active Discounts Cap',
      value: `${policy.max_active_discounts} SKUs`,
      description: 'Limits how many products can be on sale simultaneously to preserve brand perception.',
    },
    {
      id: 'DAILY_DISCOUNT_BUDGET',
      name: 'Daily Discount Revenue Ceiling',
      value: `₹${(policy.daily_discount_budget_p / 100).toLocaleString('en-IN')}`,
      description: 'Maximum total projected give-away across all discounts on a single day.',
    },
    {
      id: 'MAX_ACTIONS_PER_DAY',
      name: 'Daily Execution Action Cap',
      value: `${policy.max_actions_per_day} actions`,
      description: 'Maximum number of merchandising changes executed by the agent per simulated day.',
    },
    {
      id: 'COOLDOWN',
      name: 'Product Discount Cooldown',
      value: `${policy.cooldown_days} day${policy.cooldown_days !== 1 ? 's' : ''}`,
      description: 'Days required between consecutive discount actions on the same product.',
    },
    {
      id: 'FEATURED_SLOTS',
      name: 'Maximum Featured Slots',
      value: `${policy.max_featured_slots} slots`,
      description: 'Maximum number of products that can be featured simultaneously on the storefront.',
    },
    {
      id: 'STOCK_FLOOR',
      name: 'Inventory Threshold Floor',
      value: '5 units',
      description: 'Products with inventory below this floor cannot be discounted. Code invariant (not tunable).',
    },
    {
      id: 'BLOCKED_CATEGORY',
      name: 'Excluded Categories',
      value: policy.blocked_categories?.length ? policy.blocked_categories.join(', ') : 'None',
      description: 'Product categories explicitly prohibited from promotional discounting. Empty means no category is blocked.',
    },
    {
      id: 'MIN_CONFIDENCE',
      name: 'Agent Proposal Confidence Floor',
      value: '0.60',
      description: 'Minimum AI model confidence required for policy engine evaluation. Code invariant (not tunable).',
    },
    {
      id: 'BUYER_MAX_QTY',
      name: 'Buyer Max Quantity Per SKU',
      value: `${policy.buyer_max_qty_per_sku} units`,
      description: 'Maximum quantity an AI buyer can order of a single SKU in one transaction.',
    },
    {
      id: 'BUYER_MAX_ORDER',
      name: 'Buyer Max Order Total',
      value: `₹${(policy.buyer_max_order_p / 100).toLocaleString('en-IN')}`,
      description: 'Maximum total value (at our effective prices) for a single AI-buyer order.',
    },
  ];

  return (
    <main className="container">
      <h1 className="page-title">Merchant Safety Policy Engine</h1>
      <p className="page-sub">
        The merchant-owned rule row in Supabase (`merchant_policy`). Code enforces these bounds deterministically.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '24px' }}>
        {rulesList.map((r) => (
          <div
            key={r.id}
            className="glass-card"
            style={{
              borderColor: r.highlight ? 'var(--border-hover)' : undefined,
              boxShadow: r.highlight ? 'var(--accent-glow) 0 0 20px' : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <span className="badge-status badge-approved">
                {r.id}
              </span>
              <span style={{ fontSize: '1.4rem', fontWeight: '700', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {r.value}
              </span>
            </div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>{r.name}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{r.description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
