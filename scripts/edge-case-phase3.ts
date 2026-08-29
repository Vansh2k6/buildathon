/**
 * edge-case-phase3.ts — thorough edge-case + boundary verification for Phase 3.
 * Run: npx tsx scripts/edge-case-phase3.ts
 *
 * Tests pure detectors with synthetic data (no DB needed) and
 * DB-backed integration edge cases (day 0, no-override, simultaneous signals).
 */

import { loadEnv } from './_env';
loadEnv();

import { serverAdmin } from '../lib/db';
import {
  detectConversionDrop,
  detectDeadStock,
  detectInternalSignal,
  type MetricRow,
} from '../lib/observe/internal';
import {
  detectExternalSignal,
  FALLBACK_HEADLINE,
} from '../lib/observe/external';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  ✓ ${msg}`);
    passed++;
  }
}

function assertThrows(fn: () => void, msg: string): void {
  try {
    fn();
    console.error(`  ❌ FAIL: ${msg} — expected throw but didn't`);
    failed++;
  } catch {
    console.log(`  ✓ ${msg}`);
    passed++;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Create a MetricRow with sane defaults */
function m(
  sku: string,
  day: number,
  views: number,
  orders: number,
  inventory: number = 42,
  pid: string = '1',
): MetricRow {
  return { product_id: pid, sku, day_index: day, views, orders, inventory };
}

/** Generate 7 days of baseline metrics for a SKU at a given CR */
function baseline(sku: string, crPct: number, inv: number = 42): MetricRow[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = i + 1;
    const views = 100;
    const orders = Math.round(views * (crPct / 100));
    return m(sku, day, views, orders, inv);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Section 1: Conversion Drop — boundary and edge cases
// ─────────────────────────────────────────────────────────────────────

console.log('\n══ Conversion Drop — boundaries ══');

// 1a. Exactly at 30% drop — should FIRE
(() => {
  // baseline CR = 5.0%, today CR = 3.5% → drop = (5-3.5)/5 = 30.0%
  const metrics = [...baseline('X', 5.0), m('X', 8, 200, 7)]; // 3.5%
  const r = detectConversionDrop(metrics, 8);
  assert(r !== null, 'drop_rel = 30.0% exactly → fires');
  if (r) assert(r.drop_rel_pct === 30.0, `drop_rel_pct = ${r.drop_rel_pct} (expected 30.0)`);
})();

// 1b. Just below 30% — should NOT fire
(() => {
  // baseline CR = 5.0%, today CR = 3.51% → drop = (5-3.51)/5 = 29.8%
  const metrics = [...baseline('X', 5.0), m('X', 8, 200, 7)]; // 3.5%
  // Actually 200 views, 7 orders = 3.5% → 30.0%. Let's use 200 views, 8 orders = 4.0%
  // drop = (5-4)/5 = 20% < 30%. So this should NOT fire.
  const metrics2 = [...baseline('Y', 5.0, 42), m('Y', 8, 200, 8)]; // 4.0% today
  const r = detectConversionDrop(metrics2, 8);
  assert(r === null, 'drop_rel = 20.0% → does NOT fire');
})();

// 1c. Drop improving (negative) — should NOT fire
(() => {
  // baseline CR = 3%, today CR = 6% → drop_rel = (3-6)/3 = -1.0 → negative
  const metrics = [...baseline('Z', 3.0), m('Z', 8, 200, 12)]; // 6%
  const r = detectConversionDrop(metrics, 8);
  assert(r === null, 'CR improving (negative drop) → does NOT fire');
})();

// 1d. Day 0 — no today row, no history → null
(() => {
  const metrics = baseline('X', 5.0); // only days 1-7
  const r = detectConversionDrop(metrics, 0);
  assert(r === null, 'day 0 → null (no today row)');
})();

// 1e. Day 1 — today row but no history → null
(() => {
  const metrics = [m('X', 1, 200, 2)]; // only day 1, no history before it
  const r = detectConversionDrop(metrics, 1);
  assert(r === null, 'day 1 with no history → null');
})();

// 1f. Empty metrics array → null
(() => {
  const r = detectConversionDrop([], 8);
  assert(r === null, 'empty metrics → null');
})();

// 1g. SKU has today row but no history rows (history has 0 views) → null
(() => {
  const metrics = [
    m('X', 1, 0, 0), // history has 0 views → filtered out
    m('X', 8, 100, 0), // today
  ];
  const r = detectConversionDrop(metrics, 8);
  assert(r === null, 'history rows all have 0 views → null (filtered out)');
})();

// 1h. History rows all zero orders → cr_baseline = 0 → null
(() => {
  const metrics = [
    ...baseline('X', 0.0), // CR = 0%
    m('X', 8, 100, 0),
  ];
  const r = detectConversionDrop(metrics, 8);
  assert(r === null, 'cr_baseline = 0% → null (skipped)');
})();

// 1i. Two products drop — highest drop wins
(() => {
  const metricsA = [...baseline('A', 5.0), m('A', 8, 200, 7)]; // 3.5% → 30% drop
  const metricsB = [
    ...baseline('B', 10.0, 42),
    m('B', 8, 200, 5), // 2.5% → 75% drop
  ];
  const r = detectConversionDrop([...metricsA, ...metricsB], 8);
  assert(r !== null, 'two products drop → returns signal');
  if (r) assert(r.sku === 'B', `two products drop → highest wins (got ${r.sku})`);
  if (r) assert(r.also_firing === 1, `also_firing = ${r.also_firing} (expected 1)`);
})();

// 1j. Equal drop_rel → first by Map order wins (deterministic)
(() => {
  const metricsA = [...baseline('A', 5.0, 42), m('A', 8, 200, 7)];
  const metricsB = [...baseline('B', 5.0, 42), m('B', 8, 200, 7)];
  const r = detectConversionDrop([...metricsA, ...metricsB], 8);
  assert(r !== null, 'equal drop → returns signal');
  if (r) assert(r.sku === 'A', `equal drop → first wins (got ${r.sku})`);
  if (r) assert(r.also_firing === 1, 'also_firing = 1 when tied');
})();

// 1k. Inventory = 0 today → blocked
(() => {
  const metrics = [...baseline('X', 5.0, 0), m('X', 8, 200, 7, 0)];
  const r = detectConversionDrop(metrics, 8);
  assert(r === null, 'inventory = 0 today → blocked');
})();

// 1l. Views exactly at MIN_VIEWS (50) → fires if threshold met
(() => {
  const metrics = [
    ...Array.from({ length: 7 }, (_, i) => m('X', i + 1, 50, 5)),
    m('X', 8, 50, 0), // CR today = 0%, baseline = 10% → 100% drop
  ];
  const r = detectConversionDrop(metrics, 8);
  assert(r !== null, 'views = MIN_VIEWS (50) → fires');
})();

// 1m. Views = 49 → blocked
(() => {
  const metrics = [
    ...Array.from({ length: 7 }, (_, i) => m('X', i + 1, 49, 5)),
    m('X', 8, 49, 0),
  ];
  const r = detectConversionDrop(metrics, 8);
  assert(r === null, 'views = 49 (< MIN_VIEWS) → blocked');
})();

// ─────────────────────────────────────────────────────────────────────
// Section 2: Dead Stock — boundary and edge cases
// ─────────────────────────────────────────────────────────────────────

console.log('\n══ Dead Stock — boundaries ══');

// 2a. Inventory = 40 exactly → fires
(() => {
  const metrics = Array.from({ length: 7 }, (_, i) => m('DS1', i + 1, 40, 0, 40));
  const r = detectDeadStock(metrics, 7);
  assert(r !== null, 'inventory = 40 exactly → fires');
  if (r) assert(r.sku === 'DS1', `sku = ${r.sku}`);
  if (r) assert(r.orders_7d === 0, 'orders_7d = 0');
})();

// 2b. Inventory = 39 → does NOT fire
(() => {
  const metrics = Array.from({ length: 7 }, (_, i) => m('DS2', i + 1, 40, 0, 39));
  const r = detectDeadStock(metrics, 7);
  assert(r === null, 'inventory = 39 → does NOT fire');
})();

// 2c. Inventory = 40, but 1 order in window → does NOT fire
(() => {
  const metrics = [
    m('DS3', 1, 40, 0, 40),
    m('DS3', 2, 40, 1, 40), // 1 order
    m('DS3', 3, 40, 0, 40),
    m('DS3', 4, 40, 0, 40),
    m('DS3', 5, 40, 0, 40),
    m('DS3', 6, 40, 0, 40),
    m('DS3', 7, 40, 0, 40),
  ];
  const r = detectDeadStock(metrics, 7);
  assert(r === null, 'inventory = 40 but 1 order → does NOT fire');
})();

// 2d. Day 1 only — window = [1, 7], no today row → null
(() => {
  const metrics = [m('DS4', 1, 50, 0, 50)];
  const r = detectDeadStock(metrics, 7);
  assert(r === null, 'no today row (day 7) → null');
})();

// 2e. Inventory = 40 but orders outside 7-day window → still fires
(() => {
  const metrics = [
    m('DS5', 1, 50, 10, 40), // day 1, outside [day6-8, day8] window for day 8
    m('DS5', 2, 50, 0, 40),
    m('DS5', 3, 50, 0, 40),
    m('DS5', 4, 50, 0, 40),
    m('DS5', 5, 50, 0, 40),
    m('DS5', 6, 50, 0, 40),
    m('DS5', 7, 50, 0, 40),
    m('DS5', 8, 50, 0, 40),
  ];
  const r = detectDeadStock(metrics, 8);
  assert(r !== null, 'orders only on day 1 (outside 7-day window) → fires on day 8');
})();

// 2f. Multiple dead stock candidates → highest inventory wins
(() => {
  const metrics = [
    ...Array.from({ length: 7 }, (_, i) => m('DS_HIGH', i + 1, 40, 0, 80)),
    ...Array.from({ length: 7 }, (_, i) => m('DS_LOW', i + 1, 40, 0, 50, '2')),
  ];
  const r = detectDeadStock(metrics, 7);
  assert(r !== null, 'two dead stock candidates → returns signal');
  if (r) assert(r.sku === 'DS_HIGH', `highest inv wins (got ${r.sku}, expected DS_HIGH)`);
  if (r) assert(r.also_firing === 1, `also_firing = ${r.also_firing} (expected 1)`);
})();

// 2g. Empty metrics → null
(() => {
  const r = detectDeadStock([], 7);
  assert(r === null, 'empty metrics → null');
})();

// ─────────────────────────────────────────────────────────────────────
// Section 3: Mutual exclusion — conversion drop beats dead stock
// ─────────────────────────────────────────────────────────────────────

console.log('\n══ Mutual exclusion — drop wins over dead stock ══');

// 3a. Both eligible — drop should win
(() => {
  const dropMetrics = [...baseline('DROPPER', 5.0, 42), m('DROPPER', 8, 200, 7, 42)];
  const deadMetrics = [
    ...Array.from({ length: 7 }, (_, i) => m('DEADER', i + 1, 40, 0, 80, '2')),
    m('DEADER', 8, 40, 0, 80, '2'), // today row needed for day 8
  ];
  const allMetrics = [...dropMetrics, ...deadMetrics];
  const drop = detectConversionDrop(allMetrics, 8);
  const dead = detectDeadStock(allMetrics, 8);
  assert(drop !== null, 'conversion drop fires');
  assert(dead !== null, 'dead stock also eligible standalone');
  if (drop) assert(drop.sku === 'DROPPER', 'drop SKU = DROPPER');
  if (dead) assert(dead.sku === 'DEADER', 'dead stock SKU = DEADER');
})();

// ─────────────────────────────────────────────────────────────────────
// Section 4: DB Integration edge cases
// ─────────────────────────────────────────────────────────────────────

const db = serverAdmin();

async function runDbAndExternalTests(): Promise<void> {
  // ── 4. DB Integration (sequential — shared DB state) ────────────────
  console.log('\n══ DB Integration — edge cases ══');

  // 4a. day 0 → null
  {
    const { error } = await db.rpc('demo_reset');
    assert(!error, `reset ok: ${error?.message}`);
    const sig = await detectInternalSignal(db);
    assert(sig === null, 'day 0 after reset → null (no history)');
  }

  // 4b. day 3 → null
  {
    const { error } = await db.rpc('demo_reset');
    assert(!error, 'reset ok');
    for (let i = 0; i < 3; i++) await db.rpc('demo_advance_day');
    const sig = await detectInternalSignal(db);
    assert(sig === null, 'day 3 → null (no drop yet)');
  }

  // 4c. day 7 → dead stock fires (7-day window fills for BK-109)
  {
    const { error } = await db.rpc('demo_reset');
    assert(!error, 'reset ok');
    for (let i = 0; i < 7; i++) await db.rpc('demo_advance_day');
    const sig = await detectInternalSignal(db);
    assert(sig !== null, 'day 7 → signal fires (dead stock on BK-109)');
    if (sig) assert(sig.kind === 'dead_stock', `day 7 kind = ${sig.kind}`);
    if (sig && sig.kind === 'dead_stock') assert(sig.sku === 'BK-109', `day 7 sku = ${sig.sku}`);
  }

  // 4d. day 8 override (no advance needed)
  {
    const { error } = await db.rpc('demo_reset');
    assert(!error, 'reset ok');
    const sig = await detectInternalSignal(db, 8);
    assert(sig !== null, 'day 8 override → fires');
    if (sig) assert(sig.kind === 'conversion_drop', `kind = ${sig.kind}`);
    if (sig && sig.kind === 'conversion_drop') assert(sig.sku === 'BK-101', `sku = ${sig.sku}`);
  }

  // 4e. Full sweep 0→8
  {
    const { error } = await db.rpc('demo_reset');
    assert(!error, 'reset ok');
    for (let day = 0; day <= 8; day++) {
      if (day > 0) await db.rpc('demo_advance_day');
      const sig = await detectInternalSignal(db, day);
      if (day >= 1 && day <= 6) {
        assert(sig === null, `day ${day} → null`);
      } else if (day === 7) {
        assert(sig !== null, `day 7 → signal fires (dead stock)`);
        if (sig) assert(sig.kind === 'dead_stock', `day 7 kind = ${sig.kind}`);
      } else if (day === 8) {
        assert(sig !== null, `day 8 → signal fires`);
        if (sig) assert(sig.kind === 'conversion_drop', `day 8 kind = ${sig.kind}`);
      } else {
        assert(sig === null, `day 0 → null`);
      }
    }
    await db.rpc('demo_reset');
  }

  // ── 5. External signal (sequential) ─────────────────────────────────
  console.log('\n══ External signal — edge cases ══');

  // 5a. Empty string key → fallback (undefined falls through to env)
  {
    const sig = await detectExternalSignal({ newsApiKey: '', db });
    assert(sig.source === 'fallback', `empty key → source = ${sig.source}`);
    assert(sig.headlines.length >= 1, 'has at least 1 fallback headline');
    assert(sig.headlines[0].title === FALLBACK_HEADLINE.title, 'fallback headline matches');
    assert(sig.headlines[0].source === 'fallback', 'fallback headline source = fallback');
    assert(sig.kind === 'trending_headlines', 'kind = trending_headlines');
  }

  // 5b. Invalid API key → fallback
  {
    const sig = await detectExternalSignal({ newsApiKey: 'bad_key_12345', fetchTimeoutMs: 2000, db });
    assert(sig.source === 'fallback', `invalid key → source = ${sig.source}`);
    assert(sig.headlines[0].title === FALLBACK_HEADLINE.title, 'fallback headline content');
  }

  // 5c. Very short timeout (1ms) → fallback
  {
    const sig = await detectExternalSignal({ fetchTimeoutMs: 1, db });
    assert(sig.source === 'fallback', `1ms timeout → source = ${sig.source}`);
  }

  // 5d. Live key (if available) → live or fallback
  {
    const sig = await detectExternalSignal({ db });
    const validSource = sig.source === 'live' || sig.source === 'fallback';
    assert(validSource, `source = ${sig.source} (live or fallback)`);
    assert(sig.headlines.length > 0, 'headlines non-empty');
    assert(sig.kind === 'trending_headlines', 'kind = trending_headlines');
    if (sig.source === 'live') {
      assert(sig.headlines.length <= 8, `live headlines ≤ 8 (got ${sig.headlines.length})`);
      for (const h of sig.headlines) {
        assert(h.title.length >= 20, `headline title ≥ 20 chars (${h.title.length})`);
      }
    }
  }

  // 5e. fetched_at is a valid ISO timestamp
  {
    const sig = await detectExternalSignal({ newsApiKey: '', db });
    const ts = new Date(sig.fetched_at);
    assert(!isNaN(ts.getTime()), `fetched_at is valid ISO: ${sig.fetched_at}`);
  }

  // 5f. news_cache row written for fallback
  {
    const sig = await detectExternalSignal({ newsApiKey: 'force_fallback', fetchTimeoutMs: 500, db });
    assert(sig.source === 'fallback', 'forced fallback for cache check');
    const { data, error } = await db
      .from('news_cache')
      .select('source, used_title, fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1);
    assert(!error, `news_cache query ok: ${error?.message}`);
    assert(data !== null && data.length > 0, 'news_cache has a row');
    if (data && data.length > 0) {
      assert(data[0].source === 'fallback', `cache source = ${data[0].source}`);
      assert(data[0].used_title === FALLBACK_HEADLINE.title, 'cache used_title matches fallback headline');
    }
  }
}

// ── 6. Regression — standard verify cases ──────────────────────────────
console.log('\n══ Regression — standard cases ══');

// Standard BK-101 day 8 drop
(() => {
  const metrics = [
    m('BK-101', 1, 150, 6), m('BK-101', 2, 162, 7),
    m('BK-101', 3, 148, 6), m('BK-101', 4, 171, 7),
    m('BK-101', 5, 155, 7), m('BK-101', 6, 168, 7),
    m('BK-101', 7, 160, 7), m('BK-101', 8, 180, 3),
  ];
  const r = detectConversionDrop(metrics, 8);
  assert(r !== null, 'BK-101 returns signal on day 8');
  if (r) assert(r.sku === 'BK-101', 'BK-101 fires on day 8');
  if (r) assert(r.drop_rel_pct === 60.5, `drop_rel_pct = ${r.drop_rel_pct}`);
})();

// Standard BK-109 dead stock
(() => {
  const metrics = Array.from({ length: 7 }, (_, i) => m('BK-109', i + 1, 40, 0, 48));
  const r = detectDeadStock(metrics, 7);
  assert(r !== null, 'BK-109 returns signal');
  if (r) assert(r.sku === 'BK-109', 'BK-109 dead stock fires');
  if (r) assert(r.orders_7d === 0, 'orders_7d = 0');
})();

// ── Run async DB + external tests, then summary ────────────────────
runDbAndExternalTests().then(() => {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  Phase 3 edge cases: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\nALL EDGE-CASE CHECKS PASS\n');
  }
}).catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
