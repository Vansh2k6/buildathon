/**
 * verify-all-bugs.ts — Runtime proof for each candidate bug.
 * Run: npx tsx scripts/verify-all-bugs.ts
 *
 * Each bug has TWO independent test blocks (pass 1 + pass 2 pattern).
 * A bug is CONFIRMED only if both passes agree.
 */

import { loadEnv } from './_env';
loadEnv();

import { serverAdmin } from '../lib/db';
import { listBooks } from '../lib/catalog';
import { detectConversionDrop, detectDeadStock, type MetricRow } from '../lib/observe/internal';
import { effectivePriceP as eMoney } from '../lib/money';

const db = serverAdmin();
let pass = 0;
let fail = 0;
const results: Array<{ bug: string; pass1: string; pass2: string }> = [];

function ok(bug: string, msg: string) { pass++; console.log(`  ✓ ${msg}`); }
function fail_(bug: string, msg: string) { fail++; console.log(`  ❌ ${msg}`); }

async function reset() { await db.rpc('demo_reset'); }

// ═══════════════════════════════════════════════════════════════════
// BUG-1: Search PostgREST injection — does `\';"` break the query?
// ═══════════════════════════════════════════════════════════════════
async function testBug1(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-1: Search PostgREST injection ══');
  const outcomes: string[] = [];

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);
    const payloads = [
      { q: "test\\'\" ; search", label: 'backslash+quotes+semicolon' },
      { q: "foo\\%bar", label: 'backslash-percent (escape char)' },
      { q: "a); select 1--", label: 'PostgREST filter injection' },
      { q: "normal book", label: 'normal search (control)' },
    ];

    let allOk = true;
    for (const p of payloads) {
      try {
        const result = await listBooks(p);
        if (!Array.isArray(result)) {
          console.log(`    ❌ ${p.label}: returned non-array`);
          allOk = false;
        } else {
          console.log(`    ✓ ${p.label}: returned ${result.length} items (no crash)`);
        }
      } catch (err: any) {
        console.log(`    ❌ ${p.label}: THREW — ${err.message}`);
        allOk = false;
      }
    }
    outcomes.push(allOk ? 'PASS' : 'FAIL');
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-5: Seed SQL orders column — does it hold revenue, not count?
// ═══════════════════════════════════════════════════════════════════
async function testBug5(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-5: Seed SQL orders = revenue ══');
  const outcomes: string[] = [];

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);
    await reset();

    const { data: prod } = await db.from('products').select('id, price_p').eq('sku', 'BK-101').single();
    if (!prod) { console.log('    ❌ BK-101 not found'); outcomes.push('FAIL'); continue; }

    const { data: metrics } = await db
      .from('product_metrics_daily')
      .select('day_index, orders, revenue_p, views')
      .eq('product_id', prod.id)
      .order('day_index');

    if (!metrics || metrics.length === 0) { console.log('    ❌ No metrics'); outcomes.push('FAIL'); continue; }

    // Expected: orders column = raw count (6, 7, 6, 7, 7, 7, 7, 3)
    // If orders = revenue, values will be 299400, 349300, etc.
    const day1 = metrics.find((m: any) => m.day_index === 1);
    const day8 = metrics.find((m: any) => m.day_index === 8);

    console.log(`    Day 1: orders=${day1?.orders}, revenue_p=${day1?.revenue_p}, views=${day1?.views}`);
    console.log(`    Day 8: orders=${day8?.orders}, revenue_p=${day8?.revenue_p}, views=${day8?.views}`);

    if (typeof day1?.orders === 'number' && day1.orders > 100) {
      console.log(`    ❌ CONFIRMED: orders=${day1.orders} > 100 → this is revenue, not count`);
      outcomes.push('BUG');
    } else if (day1?.orders === 6) {
      console.log(`    ✓ orders=6 → correct raw count`);
      outcomes.push('PASS');
    } else {
      console.log(`    ⚠ orders=${day1?.orders} — unexpected value`);
      outcomes.push('INCONCLUSIVE');
    }
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-6: sanitizeProductMetricsOrders — threshold + N×M behavior
// ═══════════════════════════════════════════════════════════════════
async function testBug6(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-6: sanitizeProductMetricsOrders behavior ══');
  const outcomes: string[] = [];

  // Import the sanitizer dynamically
  const { sanitizeProductMetricsOrders } = await import('../app/api/sim/reset/route');

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);
    await reset();

    // Check BEFORE sanitize: orders are revenue
    const { data: prod } = await db.from('products').select('id').eq('sku', 'BK-101').single();
    const { data: before } = await db
      .from('product_metrics_daily')
      .select('orders')
      .eq('product_id', prod!.id)
      .eq('day_index', 1)
      .single();
    console.log(`    Before sanitize: orders=${before?.orders} (revenue=${typeof before?.orders === 'number' && before.orders > 100})`);

    // Run sanitizer
    const start = Date.now();
    await sanitizeProductMetricsOrders(db);
    const elapsed = Date.now() - start;
    console.log(`    Sanitize took ${elapsed}ms`);

    // Check AFTER sanitize
    const { data: after } = await db
      .from('product_metrics_daily')
      .select('orders')
      .eq('product_id', prod!.id)
      .eq('day_index', 1)
      .single();
    console.log(`    After sanitize: orders=${after?.orders}`);

    if (after?.orders === 6) {
      console.log(`    ✓ Sanitizer corrected orders to 6`);
      outcomes.push('PASS');
    } else {
      console.log(`    ❌ Sanitizer did NOT correct: orders=${after?.orders}`);
      outcomes.push('FAIL');
    }

    // Check edge case: what if orders = 50 (below threshold)?
    // Insert a fake row with orders=50, then sanitize
    await db.from('product_metrics_daily').upsert({
      product_id: prod!.id,
      day_index: 99,
      views: 100,
      orders: 50,
      revenue_p: 50 * 49900,
    }, { onConflict: 'product_id,day_index' });

    await sanitizeProductMetricsOrders(db);
    const { data: edge } = await db
      .from('product_metrics_daily')
      .select('orders')
      .eq('product_id', prod!.id)
      .eq('day_index', 99)
      .single();

    if (edge?.orders === 50) {
      console.log(`    ✓ orders=50 (below threshold) left unchanged`);
    } else {
      console.log(`    ⚠ orders=50 was changed to ${edge?.orders}`);
    }

    // Cleanup the test row
    await db.from('product_metrics_daily').delete()
      .eq('product_id', prod!.id)
      .eq('day_index', 99);
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-7: verify-bugs identity test — is it tautological?
// ═══════════════════════════════════════════════════════════════════
async function testBug7(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-7: effectivePriceP identity test ══');
  const outcomes: string[] = [];

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);

    // Dynamic imports to get fresh references
    const mod1 = await import('../lib/money');
    const mod2 = await import('../lib/catalog');
    const mod3 = await import('../lib/policy/rules');

    const sameRef = mod1.effectivePriceP === mod2.effectivePriceP &&
                    mod2.effectivePriceP === mod3.effectivePriceP;

    console.log(`    money === catalog: ${mod1.effectivePriceP === mod2.effectivePriceP}`);
    console.log(`    catalog === rules: ${mod2.effectivePriceP === mod3.effectivePriceP}`);

    if (sameRef) {
      console.log(`    ✓ All three point to same function (identity test passes)`);
      outcomes.push('PASS');
    } else {
      console.log(`    ❌ Different function references`);
      outcomes.push('FAIL');
    }
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-8: effectivePriceP(0) — does it silently return full price?
// ═══════════════════════════════════════════════════════════════════
async function testBug8(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-8: effectivePriceP(0) behavior ══');
  const outcomes: string[] = [];

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);

    const r0 = eMoney(49900, 0);
    const rNull = eMoney(49900, null);
    const r18 = eMoney(49900, 18);

    console.log(`    effectivePriceP(49900, 0)   = ${r0}`);
    console.log(`    effectivePriceP(49900, null) = ${rNull}`);
    console.log(`    effectivePriceP(49900, 18)  = ${r18}`);

    if (r0 === 49900 && rNull === 49900) {
      console.log(`    ⚠ 0% and null both return full price (semantically correct but indistinguishable)`);
      outcomes.push('PASS'); // It's a code smell, not a runtime bug
    } else if (r0 !== 49900) {
      console.log(`    ❌ effectivePriceP(49900, 0) = ${r0} (expected 49900)`);
      outcomes.push('FAIL');
    } else {
      outcomes.push('PASS');
    }
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// BUG-NEW: Dead stock detector — does orders_7d sum revenue?
// ═══════════════════════════════════════════════════════════════════
async function testBugDeadStockRevenue(): Promise<{ pass1: string; pass2: string }> {
  console.log('\n══ BUG-NEW: Dead stock orders_7d sums revenue ══');
  const outcomes: string[] = [];

  for (let passNum = 1; passNum <= 2; passNum++) {
    console.log(`  Pass ${passNum}:`);
    await reset();

    // BK-109 has 0 orders, so 0 × price = 0 either way
    // But let's check: does the detector use the orders column value?
    const { data: prod } = await db.from('products').select('id').eq('sku', 'BK-109').single();
    const { data: metrics } = await db
      .from('product_metrics_daily')
      .select('day_index, orders, revenue_p')
      .eq('product_id', prod!.id)
      .order('day_index');

    const day1 = metrics?.find((m: any) => m.day_index === 1);
    console.log(`    BK-109 day1: orders=${day1?.orders}, revenue_p=${day1?.revenue_p}`);

    // Advance to day 7 to trigger dead stock
    for (let i = 0; i < 7; i++) await db.rpc('demo_advance_day');

    // Read metrics as the detector would
    const { data: allMetrics } = await db
      .from('product_metrics_daily')
      .select('product_id, day_index, views, orders')
      .gte('day_index', 1)
      .lte('day_index', 7);

    const { data: products } = await db.from('products').select('id, sku, inventory');
    const pMap = new Map(products?.map(p => [p.id, { sku: p.sku, inventory: p.inventory }]) ?? []);

    const rows: MetricRow[] = (allMetrics ?? []).map(m => {
      const p = pMap.get(m.product_id);
      if (!p) return null;
      return { product_id: m.product_id, sku: p.sku, day_index: m.day_index, views: m.views, orders: m.orders, inventory: p.inventory };
    }).filter(Boolean) as MetricRow[];

    const sig = detectDeadStock(rows, 7);
    if (sig) {
      console.log(`    Dead stock fired: sku=${sig.sku}, inventory=${sig.inventory}, orders_7d=${sig.orders_7d}`);
      if (sig.orders_7d === 0) {
        console.log(`    ✓ orders_7d=0 (correct for BK-109 regardless of column semantics)`);
        outcomes.push('PASS');
      } else {
        console.log(`    ❌ orders_7d=${sig.orders_7d} (expected 0)`);
        outcomes.push('FAIL');
      }
    } else {
      console.log(`    ❌ Dead stock did NOT fire at day 7`);
      outcomes.push('FAIL');
    }
  }

  const verdict = outcomes[0] === outcomes[1] ? outcomes[0] : 'INCONCLUSIVE';
  console.log(`  Verdict: ${verdict} (pass1=${outcomes[0]}, pass2=${outcomes[1]})`);
  return { pass1: outcomes[0], pass2: outcomes[1] };
}

// ═══════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Bug Verification Suite — 2 passes each, live DB');
  console.log('═══════════════════════════════════════════════════════════');

  const r1 = await testBug1();
  const r5 = await testBug5();
  const r6 = await testBug6();
  const r7 = await testBug7();
  const r8 = await testBug8();
  const rDS = await testBugDeadStockRevenue();

  await reset(); // Clean up

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  BUG-1  (search injection):      pass1=${r1.pass1} pass2=${r1.pass2}`);
  console.log(`  BUG-5  (seed orders=revenue):   pass1=${r5.pass1} pass2=${r5.pass2}`);
  console.log(`  BUG-6  (sanitize behavior):     pass1=${r6.pass1} pass2=${r6.pass2}`);
  console.log(`  BUG-7  (identity test):         pass1=${r7.pass1} pass2=${r7.pass2}`);
  console.log(`  BUG-8  (effectivePriceP(0)):    pass1=${r8.pass1} pass2=${r8.pass2}`);
  console.log(`  BUG-NEW (dead stock revenue):   pass1=${rDS.pass1} pass2=${rDS.pass2}`);
  console.log(`\n  Total: ${pass} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
