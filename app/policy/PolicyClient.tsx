'use client';

import { useState } from 'react';

export interface MerchantPolicyData {
  id?: number;
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
  updated_at?: string;
}

const ALL_CATEGORIES = [
  'fiction',
  'travel',
  'wellness',
  'sports',
  'thriller',
  'gift',
  'nature',
  'stationery',
  'poetry',
];

const PRESETS: { name: string; desc: string; values: Partial<MerchantPolicyData> }[] = [
  {
    name: 'Conservative (High Margin)',
    desc: 'Max 10% discount, 25% margin floor, small ₹2k budget.',
    values: {
      max_discount_pct: 10,
      min_margin_pct: 25,
      max_active_discounts: 2,
      max_actions_per_day: 3,
      daily_discount_budget_p: 200000,
      cooldown_days: 2,
    },
  },
  {
    name: 'Balanced (Standard)',
    desc: 'Official benchmark: 20% discount cap, 15% margin, ₹5k budget.',
    values: {
      max_discount_pct: 20,
      min_margin_pct: 15,
      max_active_discounts: 3,
      max_actions_per_day: 5,
      daily_discount_budget_p: 500000,
      cooldown_days: 1,
    },
  },
  {
    name: 'Growth (Flash Promo)',
    desc: 'Aggressive 35% discount ceiling, 10% margin floor, ₹15k budget.',
    values: {
      max_discount_pct: 35,
      min_margin_pct: 10,
      max_active_discounts: 6,
      max_actions_per_day: 8,
      daily_discount_budget_p: 1500000,
      cooldown_days: 0,
    },
  },
];

export function PolicyClient({ initialPolicy }: { initialPolicy: MerchantPolicyData }) {
  const [activeTab, setActiveTab] = useState<'rules' | 'settings'>('rules');
  const [policy, setPolicy] = useState<MerchantPolicyData>(initialPolicy);
  const [initialState, setInitialState] = useState<MerchantPolicyData>(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const hasChanges = JSON.stringify(policy) !== JSON.stringify(initialState);

  function updateField<K extends keyof MerchantPolicyData>(key: K, value: MerchantPolicyData[K]) {
    setPolicy((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function toggleCategory(cat: string) {
    setPolicy((prev) => {
      const exists = prev.blocked_categories.includes(cat);
      const nextBlocked = exists
        ? prev.blocked_categories.filter((c) => c !== cat)
        : [...prev.blocked_categories, cat];
      return { ...prev, blocked_categories: nextBlocked };
    });
    setMessage(null);
  }

  function applyPreset(presetValues: Partial<MerchantPolicyData>) {
    setPolicy((prev) => ({ ...prev, ...presetValues }));
    setMessage({
      type: 'success',
      text: 'Preset values loaded into sliders. Click "Save Changes" to apply.',
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update policy');
      }
      setPolicy(data.policy);
      setInitialState(data.policy);
      setMessage({ type: 'success', text: 'Safety policy updated successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'An unexpected error occurred' });
    } finally {
      setSaving(false);
    }
  }

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
    <div>
      {/* Navigation Tabs */}
      <div className="tabs-container">
        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          className={`tab-button ${activeTab === 'rules' ? 'active' : ''}`}
        >
          <span>Active Rules & Invariants</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
        >
          <span>Threshold Settings & Sliders</span>
          {hasChanges && (
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--orange)',
                display: 'inline-block',
              }}
            />
          )}
        </button>
      </div>

      {/* Banner Notifications */}
      {message && (
        <div
          style={{
            padding: '14px 20px',
            borderRadius: '12px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: message.type === 'success' ? 'var(--green-50)' : '#fdecea',
            border: `1px solid ${message.type === 'success' ? 'var(--green-300)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: message.type === 'success' ? 'var(--green-800)' : 'var(--red)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.9rem',
            fontWeight: '500',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span aria-hidden="true">{message.type === 'success' ? '✓' : '!'}</span>
            <span>{message.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              fontWeight: '600',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: RULES & INVARIANTS OVERVIEW */}
      {activeTab === 'rules' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Current rules enforced deterministically by the policy engine before any price or slot change.
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span>Adjust Thresholds</span>
            </button>
          </div>

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
                  <span style={{ fontSize: '1.4rem', fontWeight: '600', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                    {r.value}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>{r.name}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: THRESHOLD CONTROLS & SMOOTH SLIDERS */}
      {activeTab === 'settings' && (
        <div>
          {/* Quick Presets Section */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
              Quick Preset Configurations
            </h3>
            <div className="presets-bar">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyPreset(p.values)}
                  className="preset-chip"
                  title={p.desc}
                >
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders Grid */}
          <div className="settings-grid">
            {/* 1. Maximum Discount Percentage */}
            <div className="slider-card highlighted">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Max Single Discount</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.max_discount_pct}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>%</span>
                </div>
              </div>
              <p className="slider-desc">
                Hard ceiling for any price reduction. Proposals asking for discounts higher than this will be rejected.
              </p>
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={policy.max_discount_pct}
                onChange={(e) => updateField('max_discount_pct', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>1% (Strict)</span>
                <span>25% (Standard)</span>
                <span>50% (Max)</span>
              </div>
            </div>

            {/* 2. Minimum Gross Margin Floor */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Min Margin Floor</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.min_margin_pct}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>%</span>
                </div>
              </div>
              <p className="slider-desc">
                Guarantees discounted sale price never breaches `(price - cost) / price` gross profit floor.
              </p>
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={policy.min_margin_pct}
                onChange={(e) => updateField('min_margin_pct', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>0% (Break-even)</span>
                <span>15% (Recommended)</span>
                <span>40% (High Margin)</span>
              </div>
            </div>

            {/* 3. Daily Discount Budget */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Daily Discount Budget</span>
                </div>
                <div className="slider-value-display">
                  <span>₹{(policy.daily_discount_budget_p / 100).toLocaleString('en-IN')}</span>
                </div>
              </div>
              <p className="slider-desc">
                Maximum total projected give-away budget across all discounted inventory in a single simulated day.
              </p>
              <input
                type="range"
                min="50000"
                max="2500000"
                step="50000"
                value={policy.daily_discount_budget_p}
                onChange={(e) => updateField('daily_discount_budget_p', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>₹500</span>
                <span>₹5,000 (Default)</span>
                <span>₹25,000</span>
              </div>
            </div>

            {/* 4. Active Discounts Limit */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Max Active Discounts</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.max_active_discounts}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>SKUs</span>
                </div>
              </div>
              <p className="slider-desc">
                Maximum number of distinct products allowed to be concurrently on promotional sale storewide.
              </p>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={policy.max_active_discounts}
                onChange={(e) => updateField('max_active_discounts', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>1 SKU</span>
                <span>3 SKUs</span>
                <span>10 SKUs</span>
              </div>
            </div>

            {/* 5. Daily Execution Actions */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Max Actions Per Day</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.max_actions_per_day}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>actions</span>
                </div>
              </div>
              <p className="slider-desc">
                Maximum number of autonomous merchandising interventions executed by the agent per day.
              </p>
              <input
                type="range"
                min="1"
                max="15"
                step="1"
                value={policy.max_actions_per_day}
                onChange={(e) => updateField('max_actions_per_day', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>1 action</span>
                <span>5 actions</span>
                <span>15 actions</span>
              </div>
            </div>

            {/* 6. Cooldown Days */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Discount Cooldown</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.cooldown_days}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>day{policy.cooldown_days !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <p className="slider-desc">
                Number of simulated days required to elapse before the agent may discount the same product again.
              </p>
              <input
                type="range"
                min="0"
                max="7"
                step="1"
                value={policy.cooldown_days}
                onChange={(e) => updateField('cooldown_days', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>0 days (No wait)</span>
                <span>1 day</span>
                <span>7 days</span>
              </div>
            </div>

            {/* 7. Maximum Featured Slots */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>Featured Slots Cap</span>
                </div>
                <div className="slider-value-display">
                  <span>{policy.max_featured_slots}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>slots</span>
                </div>
              </div>
              <p className="slider-desc">
                Maximum number of items featured simultaneously on the store's primary merchandising shelf.
              </p>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={policy.max_featured_slots}
                onChange={(e) => updateField('max_featured_slots', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>1 slot</span>
                <span>4 slots</span>
                <span>8 slots</span>
              </div>
            </div>

            {/* 8. AI Buyer Limits */}
            <div className="slider-card">
              <div className="slider-header">
                <div className="slider-title">
                  <span>AI Buyer Order Cap</span>
                </div>
                <div className="slider-value-display">
                  <span>₹{(policy.buyer_max_order_p / 100).toLocaleString('en-IN')}</span>
                </div>
              </div>
              <p className="slider-desc">
                Maximum gross transaction amount allowed for any single autonomous external AI buyer order.
              </p>
              <input
                type="range"
                min="500000"
                max="10000000"
                step="500000"
                value={policy.buyer_max_order_p}
                onChange={(e) => updateField('buyer_max_order_p', Number(e.target.value))}
                className="smooth-slider"
              />
              <div className="slider-bounds">
                <span>₹5,000</span>
                <span>₹25,000</span>
                <span>₹100,000</span>
              </div>
            </div>

            {/* 9. Protected / Blocked Categories */}
            <div className="slider-card" style={{ gridColumn: '1 / -1' }}>
              <div className="slider-header">
                <div className="slider-title">
                  <span>Protected Product Categories</span>
                </div>
                <span className="badge-status badge-approved" style={{ fontSize: '0.8rem' }}>
                  {policy.blocked_categories.length} Protected
                </span>
              </div>
              <p className="slider-desc">
                Click a category to block or unblock it. The agent will never apply promotional discounts to items in protected categories.
              </p>
              <div className="category-pills-grid">
                {ALL_CATEGORIES.map((cat) => {
                  const isBlocked = policy.blocked_categories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={`cat-pill ${isBlocked ? 'blocked' : ''}`}
                    >
                      <span aria-hidden="true" style={{ marginRight: '6px' }}>{isBlocked ? '✕' : '✓'}</span>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sticky Bottom Save Action Bar */}
          <div
            style={{
              position: 'sticky',
              bottom: '24px',
              marginTop: '32px',
              padding: '16px 24px',
              background: 'var(--glass)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 40,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div>
                <p style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                  {hasChanges ? 'Unsaved Policy Changes' : 'Policy Synchronized'}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {hasChanges ? 'You have unsaved changes. Click save to apply.' : 'Active policy guardrails are up to date and enforced.'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setPolicy(initialState)}
                disabled={!hasChanges || saving}
                className="btn btn-secondary"
                style={{ opacity: hasChanges ? 1 : 0.6 }}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="btn btn-primary"
                style={{
                  minWidth: '140px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  opacity: hasChanges ? 1 : 0.7,
                }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
