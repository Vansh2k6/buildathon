/**
 * verify-phase6.ts — Phase 6 exit criteria verification (Execute).
 * Run: npx tsx scripts/verify-phase6.ts
 *
 * Razorpay test-mode rate limit: calls are spaced with sleeps.
 */

import { loadEnv } from './_env';
loadEnv();

import { serverAdmin } from '../lib/db';
import { executeDiscount } from '../lib/execute/discount';
import { executeFeatured } from '../lib/execute/featured';
import { executeOrder } from '../lib/execute/order';


// Minimal ApprovedAction builder for test — matches lib/policy/types shape
function fakeApproved(fields: Record<string, any>): any {
  return { ...fields };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('══ Phase 6 Verification (Execute) ══\n');

  const db = serverAdmin();

  // Reset database before test
  const { error: rErr } = await db.rpc('demo_reset');
  assert(!rErr, `demo_reset failed: ${rErr?.message}`);

  const dummyRunId = '00000000-0000-0000-0000-000000000002';

  // Insert a dummy agent_run row to satisfy FK constraints
  await db.from('agent_runs').upsert({
    id: dummyRunId,
    trigger: 'internal',
    day_index: 8,
    status: 'running',
  });

  // ── 1. T-61: Execute Discount (Razorpay first, local write second) ────────
  console.log('Testing T-61 (executeDiscount)...');
  const approvedDiscount = fakeApproved({
    kind: 'discount',
    sku: 'BK-101',
    discount_pct: 18,
  });

  const discRes = await executeDiscount(approvedDiscount, dummyRunId, 8, { db });
  assert(!discRes.degraded, `executeDiscount should not be degraded (error: ${discRes.error})`);
  assert(discRes.razorpay_ref_kind === 'payment_link', 'razorpay_ref_kind should be payment_link');
  assert(discRes.razorpay_id !== undefined && discRes.razorpay_id.startsWith('plink_'), 'Razorpay ID must be recorded');
  assert(typeof discRes.new_price_p === 'number' && discRes.new_price_p < discRes.old_price_p, 'Discounted price must be lower than original');
  console.log(` ✓ T-61 executeDiscount: ${discRes.sku} at 18%, plink=${discRes.razorpay_id}, old_p=${discRes.old_price_p} new_p=${discRes.new_price_p}`);

  // Verify discounts table row
  const { data: dRow } = await db.from('discounts').select('*').eq('run_id', dummyRunId).single();
  assert(dRow !== null, 'discounts row must exist in DB');
  assert(dRow.status === 'active', 'discount status must be active');
  assert(dRow.pct === 18, 'discount pct must be 18');
  assert(dRow.razorpay_ref_kind === 'payment_link', 'ref_kind must be payment_link');
  console.log(' ✓ T-61 discounts DB record verified (Razorpay-first, local-second)');

  // FR-24 fallback: forced Razorpay failure — no extra API call
  const forcedRes = await executeDiscount(approvedDiscount, dummyRunId, 8, { db, forceRazorpayFailure: true });
  assert(forcedRes.degraded === true, 'Forced failure must set degraded=true');
  assert(forcedRes.razorpay_ref_kind === 'local_only', 'Forced failure must fallback to local_only');
  console.log(' ✓ T-61 Razorpay failure fallback (local_only) verified — FR-24');

  await sleep(2000); // Space calls to avoid 429

  // ── 2. T-62: Execute Featured (DB-only, no API call) ────────────────────
  console.log('\nTesting T-62 (executeFeatured)...');
  const approvedFeatured = fakeApproved({
    kind: 'feature',
    sku: 'BK-102',
    featured_rank: 2,
  });

  const featRes = await executeFeatured(approvedFeatured, { db });
  assert(featRes.sku === 'BK-102', 'SKU must match BK-102');
  assert(featRes.featured_rank === 2, 'Featured rank must be 2');

  const { data: bk102 } = await db.from('products').select('is_featured, featured_rank').eq('sku', 'BK-102').single();
  assert(bk102?.is_featured === true, 'BK-102 should be marked is_featured=true');
  assert(bk102?.featured_rank === 2, 'BK-102 featured_rank should be 2');
  console.log(' ✓ T-62 executeFeatured DB rank update verified');

  await sleep(3000); // Space calls to avoid 429

  // ── 3. T-63: Execute AI-Buyer Order ─────────────────────────────────────
  console.log('\nTesting T-63 (executeOrder — AI Buyer with Razorpay artifacts)...');
  const approvedOrder = fakeApproved({
    kind: 'buyer_order',
    buyer_ref: 'test_buyer_agent_1',
    lines: [{ sku: 'BK-101', qty: 2, unit_price_p: 40918 }],
    total_p: 81836,
  });

  const orderRes = await executeOrder(approvedOrder, dummyRunId, { db });
  assert(typeof orderRes.razorpay_order_id === 'string' && orderRes.razorpay_order_id.startsWith('order_'),
    `Expected order_ prefix, got "${orderRes.razorpay_order_id}"`);
  assert(typeof orderRes.razorpay_payment_link_id === 'string' && orderRes.razorpay_payment_link_id.startsWith('plink_'),
    `Expected plink_ prefix, got "${orderRes.razorpay_payment_link_id}"`);
  assert(typeof orderRes.razorpay_short_url === 'string' && orderRes.razorpay_short_url.startsWith('http'),
    `Expected http short_url, got "${orderRes.razorpay_short_url}"`);
  console.log(` ✓ T-63 executeOrder: rzp_order=${orderRes.razorpay_order_id}, short_url=${orderRes.razorpay_short_url}`);

  // Verify orders table row
  const { data: oRow } = await db.from('orders').select('*').eq('id', orderRes.order_id).single();
  assert(oRow !== null, 'orders row must exist in DB');
  assert(oRow.source === 'ai_buyer', 'orders source must be ai_buyer');
  assert(oRow.total_p === 81836, `orders total_p must be 81836, got ${oRow.total_p}`);
  assert(oRow.razorpay_order_id === orderRes.razorpay_order_id, 'orders.razorpay_order_id must match');
  assert(oRow.razorpay_short_url === orderRes.razorpay_short_url, 'orders.razorpay_short_url must match');
  console.log(' ✓ T-63 orders DB record verified (order_id + plink + short_url all stored)');

  // ── 4. T-60: Verify the tools structurally (no extra API calls) ──────────
  console.log('\nTesting T-60 (Razorpay client structural checks, no extra calls)...');
  // Confirm the discount result had plink_ from Razorpay API (live call verified above)
  assert(discRes.razorpay_id!.startsWith('plink_'), 'T-60: payment link API round-tripped OK (from T-61)');
  assert(orderRes.razorpay_order_id.startsWith('order_'), 'T-60: orders API round-tripped OK (from T-63)');
  console.log(' ✓ T-60 REST client test-mode calls verified via T-61 and T-63 results');

  console.log('\nALL CHECKS PASS — Phase 6 (Execute) complete!\n');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
