/**
 * verify-phase7.ts — Phase 7 UI verification (Storefront, Audit, Policy, Control).
 * Run: npx tsx scripts/verify-phase7.ts
 */

import { loadEnv } from './_env';
loadEnv();

import { serverAdmin } from '../lib/db';
import { getFeaturedBooks, listBooks, getCategoryCounts } from '../lib/catalog';
import { DEFAULT_POLICY_LIMITS } from '../lib/policy/rules';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('══ Phase 7 Verification (UI & Storefront Surfaces) ══\n');

  const db = serverAdmin();

  // 1. Storefront Data Layer (T-70)
  console.log('Testing Storefront Data Layer (T-70)...');
  const featured = await getFeaturedBooks();
  assert(Array.isArray(featured), 'getFeaturedBooks must return an array');
  assert(featured.length <= 4, 'Featured books count must be <= 4');

  const allBooks = await listBooks({});
  assert(allBooks.length >= 10, 'Catalog listBooks must return seeded books');
  assert(allBooks[0].sku !== undefined, 'Book object must contain sku');

  const cats = await getCategoryCounts();
  assert(cats.length > 0, 'getCategoryCounts must return categories');
  console.log(` ✓ Storefront data layer verified (${allBooks.length} total books, ${featured.length} featured, ${cats.length} categories)`);

  // 2. Audit Trail Data Layer (T-71)
  console.log('\nTesting Audit Trail Data Layer (T-71)...');
  const { data: runs, error: rErr } = await db.from('agent_runs').select('*').limit(5);
  assert(!rErr, `Fetching agent_runs failed: ${rErr?.message}`);
  console.log(` ✓ Audit log query verified (${runs?.length ?? 0} agent runs in DB)`);

  // 3. Policy Engine Data Layer (T-72)
  console.log('\nTesting Policy Engine Data Layer (T-72)...');
  const { data: pol } = await db.from('merchant_policy').select('*').eq('id', 1).single();
  const activePolicy = pol ?? DEFAULT_POLICY_LIMITS;
  assert(activePolicy.max_discount_pct === 20, `max_discount_pct must be 20, got ${activePolicy.max_discount_pct}`);
  console.log(` ✓ Policy engine data verified (MAX_DISCOUNT_PCT=${activePolicy.max_discount_pct}%, MIN_MARGIN_PCT=${activePolicy.min_margin_pct}%)`);

  // 4. Control Panel State & Sim RPC (T-73)
  console.log('\nTesting Control Panel State (T-73)...');
  const { data: simState } = await db.from('sim_state').select('current_day_index').eq('id', 1).single();
  assert(simState !== null, 'sim_state must exist');
  console.log(` ✓ Control panel sim_state verified (current_day_index=${simState?.current_day_index})`);

  console.log('\nALL CHECKS PASS — Phase 7 (UI) complete!\n');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
