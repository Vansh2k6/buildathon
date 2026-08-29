/**
 * verify-phase8.ts — Phase 8 exit criteria verification (AI Buyer).
 * Run: npx tsx scripts/verify-phase8.ts
 */

import { loadEnv } from './_env';
loadEnv();

import { serverAdmin } from '../lib/db';
import { evaluateBuyerOrder, DEFAULT_BUYER_POLICY_LIMITS } from '../lib/policy/buyer';
import { executeOrder } from '../lib/execute/order';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('══ Phase 8 Verification (AI Buyer & Generality Claim) ══\n');

  const db = serverAdmin();

  // 1. Test Buyer Policy Engine Rejection (Over-Quantity)
  console.log('Testing Buyer Policy Rejection (BUYER_MAX_QTY)...');
  const overQtyOrder = {
    buyer_ref: 'verify_buyer_agent',
    lines: [{ sku: 'BK-101', qty: 10, asserted_unit_price_inr: 499 }],
  };

  const facts = {
    catalog: {
      'BK-101': {
        price_p: 49900,
        active_discount_pct: null,
        inventory: 42,
      },
    },
  };

  const limits = {
    ...DEFAULT_BUYER_POLICY_LIMITS,
    buyer_max_qty_per_sku: 5,
    buyer_max_order_p: 1000000,
  };

  const v1 = evaluateBuyerOrder(overQtyOrder, limits, facts);
  assert(!v1.ok, 'Over-qty order must be rejected');
  assert(v1.rule === 'BUYER_MAX_QTY', `Expected rule BUYER_MAX_QTY, got ${v1.rule}`);
  console.log(` ✓ Over-quantity order rejected with rule '${v1.rule}'`);

  // 2. Test Buyer Policy Engine Approval & Order Execution
  console.log('\nTesting Buyer Policy Approval & Execution...');
  const validOrder = {
    buyer_ref: 'verify_buyer_agent',
    lines: [{ sku: 'BK-101', qty: 2, asserted_unit_price_inr: 499 }],
  };

  const v2 = evaluateBuyerOrder(validOrder, limits, facts);
  assert(v2.ok && v2.approvedAction !== undefined, 'Valid order must be approved');

  const dummyRunId = '00000000-0000-0000-0000-000000000008';
  await db.from('agent_runs').upsert({
    id: dummyRunId,
    trigger: 'ai_buyer',
    day_index: 8,
    status: 'running',
  });

  const execRes = await executeOrder(v2.approvedAction, dummyRunId, { db });
  assert(execRes.razorpay_payment_link_id.startsWith('plink_'), 'Razorpay payment link must be generated');
  assert(execRes.razorpay_short_url.startsWith('http'), 'Razorpay short_url must be valid URL');
  console.log(` ✓ Buyer order executed successfully: short_url=${execRes.razorpay_short_url}`);

  // Check DB orders table
  const { data: oRow } = await db.from('orders').select('*').eq('id', execRes.order_id).single();
  assert(oRow !== null, 'orders row must exist in DB');
  assert(oRow.source === 'ai_buyer', 'orders source must be ai_buyer');
  assert(oRow.total_p === 99800, `Expected total_p=99800, got ${oRow.total_p}`);
  console.log(' ✓ orders DB table record verified with source=ai_buyer');

  console.log('\nALL CHECKS PASS — Phase 8 (AI Buyer) complete!\n');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
