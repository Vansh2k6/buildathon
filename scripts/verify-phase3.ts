/**
 * verify-phase3.ts — Phase 3 gate assertions (Observe detectors).
 * Run: npx tsx scripts/verify-phase3.ts
 *
 * Covers:
 *  1. T-30: detectConversionDrop fires on day 8 for BK-101, returns null on days 1–7.
 *  2. T-31: detectDeadStock fires on BK-109 when conversion drop returns null.
 *  3. DB Integration: reset -> advance to day 8 -> detectInternalSignal returns BK-101 conversion drop.
 *  4. T-32: detectExternalSignal returns live or fallback headlines, and handles network failure cleanly.
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
import { detectExternalSignal, FALLBACK_HEADLINE } from '../lib/observe/external';

async function main(): Promise<void> {
  console.log('══ Phase 3 verification (Observe detectors) ══\n');

  // ── 1. Pure Conversion Drop tests ─────────────────────────────────────
  const sampleMetrics: MetricRow[] = [
    // BK-101 days 1..7 (baseline ~4.23%)
    { product_id: '1', sku: 'BK-101', day_index: 1, views: 150, orders: 6, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 2, views: 162, orders: 7, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 3, views: 148, orders: 6, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 4, views: 171, orders: 7, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 5, views: 155, orders: 7, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 6, views: 168, orders: 7, inventory: 42 },
    { product_id: '1', sku: 'BK-101', day_index: 7, views: 160, orders: 7, inventory: 42 },
    // BK-101 day 8 (drop to 1.67%)
    { product_id: '1', sku: 'BK-101', day_index: 8, views: 180, orders: 3, inventory: 42 },
  ];

  const dropDay8 = detectConversionDrop(sampleMetrics, 8);
  assert(dropDay8 !== null, 'detectConversionDrop on day 8 returned null for BK-101');
  assert(dropDay8!.sku === 'BK-101', `Expected BK-101, got ${dropDay8!.sku}`);
  assert(dropDay8!.drop_rel_pct >= 30, `Expected drop_rel_pct >= 30, got ${dropDay8!.drop_rel_pct}`);
  assert(dropDay8!.cr_today_pct === 1.67, `Expected cr_today_pct = 1.67, got ${dropDay8!.cr_today_pct}`);
  console.log(` ✓ T-30 pure: BK-101 drop fired on day 8 (drop_rel=${dropDay8!.drop_rel_pct}%, cr_today=${dropDay8!.cr_today_pct}%)`);

  // Check days 1-7 return null for conversion drop
  for (let day = 1; day <= 7; day++) {
    const res = detectConversionDrop(sampleMetrics, day);
    assert(res === null, `detectConversionDrop should be null on day ${day}, got signal`);
  }
  console.log(' ✓ T-30 pure: detectConversionDrop returned null on days 1–7');

  // Guard test: views < 50
  const lowViewsMetrics: MetricRow[] = sampleMetrics.map((m) =>
    m.day_index === 8 ? { ...m, views: 40 } : m,
  );
  assert(
    detectConversionDrop(lowViewsMetrics, 8) === null,
    'detectConversionDrop should not fire if views_today < 50',
  );
  console.log(' ✓ T-30 guard: views < 50 blocked signal');

  // ── 2. Pure Dead Stock tests ───────────────────────────────────────────
  const deadStockMetrics: MetricRow[] = [
    { product_id: '2', sku: 'BK-109', day_index: 1, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 2, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 3, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 4, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 5, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 6, views: 40, orders: 0, inventory: 48 },
    { product_id: '2', sku: 'BK-109', day_index: 7, views: 40, orders: 0, inventory: 48 },
  ];

  const deadSignal = detectDeadStock(deadStockMetrics, 7);
  assert(deadSignal !== null, 'detectDeadStock returned null for BK-109');
  assert(deadSignal?.sku === 'BK-109', `Expected BK-109, got ${deadSignal?.sku}`);
  assert(deadSignal?.orders_7d === 0, `Expected orders_7d = 0, got ${deadSignal?.orders_7d}`);
  console.log(` ✓ T-31 pure: BK-109 dead stock fired (inventory=${deadSignal?.inventory}, orders_7d=${deadSignal?.orders_7d})`);

  // ── 3. DB Integration Test ─────────────────────────────────────────────
  const db = serverAdmin();

  // Reset database to day 0
  const { error: resetErr } = await db.rpc('demo_reset');
  assert(!resetErr, `demo_reset RPC error: ${resetErr?.message}`);

  // Advance day to 8
  for (let i = 0; i < 8; i++) {
    const { error: advErr } = await db.rpc('demo_advance_day');
    assert(!advErr, `demo_advance_day RPC error: ${advErr?.message}`);
  }

  const dbSignal = await detectInternalSignal(db, 8);
  assert(dbSignal !== null, 'detectInternalSignal returned null on day 8');
  assert(dbSignal?.kind === 'conversion_drop', `Expected conversion_drop, got ${dbSignal?.kind}`);
  assert(
    (dbSignal as any).sku === 'BK-101',
    `Expected BK-101 conversion drop, got ${(dbSignal as any).sku}`,
  );
  console.log(` ✓ T-30 DB: demo_reset -> day 8 -> detectInternalSignal returned BK-101 conversion drop`);

  // ── 4. External Signal & Fallback Drill ────────────────────────────────
  // Test live/fallback signal
  const extSignal = await detectExternalSignal({ db });
  assert(
    extSignal.kind === 'trending_headlines',
    `Expected trending_headlines, got ${extSignal.kind}`,
  );
  assert(
    extSignal.source === 'live' || extSignal.source === 'fallback',
    `Unexpected source: ${extSignal.source}`,
  );
  assert(extSignal.headlines.length > 0, 'Headlines list should not be empty');
  console.log(` ✓ T-32: detectExternalSignal returned source='${extSignal.source}' with ${extSignal.headlines.length} headline(s)`);

  // Force Fallback drill (kill network / invalid key)
  const forcedFallback = await detectExternalSignal({
    newsApiKey: 'invalid_dummy_key_to_force_failure',
    fetchTimeoutMs: 1000,
    db,
  });
  assert(forcedFallback.source === 'fallback', `Expected source='fallback', got ${forcedFallback.source}`);
  assert(
    forcedFallback.headlines[0].title === FALLBACK_HEADLINE.title,
    'Forced fallback should return FALLBACK_HEADLINE',
  );
  console.log(` ✓ T-32 Fallback drill: forced network failure returned source='fallback' with fallback headline`);

  // Verify news_cache DB table write
  const { data: cacheRows, error: cacheErr } = await db
    .from('news_cache')
    .select('source, used_title')
    .order('fetched_at', { ascending: false })
    .limit(1);

  assert(!cacheErr, `Failed to query news_cache: ${cacheErr?.message}`);
  assert(cacheRows !== null && cacheRows.length > 0, 'news_cache table should contain written row');
  console.log(` ✓ T-32 news_cache DB: persisted row with source='${cacheRows![0].source}'`);

  console.log('\nALL CHECKS PASS — Phase 3 (Observe) complete!\n');
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
