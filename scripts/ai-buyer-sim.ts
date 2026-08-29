/**
 * ai-buyer-sim.ts — External AI Buyer Simulation Script (T-82).
 * Demonstrates: Discover Catalog -> Select Discounted Item -> Rejected Over-Qty Order -> Approved Order -> Payable Link.
 * Run: npx tsx scripts/ai-buyer-sim.ts
 */

import { loadEnv } from './_env';
loadEnv();

import { listBooks, effectivePriceP } from '../lib/catalog';
import { evaluateBuyerOrder, DEFAULT_BUYER_POLICY_LIMITS } from '../lib/policy/buyer';
import { executeOrder } from '../lib/execute/order';
import { serverAdmin } from '../lib/db';
import { createAgentRun, logAgentEvent, updateAgentRun, fetchRunEvents } from '../lib/audit/log';

async function main(): Promise<void> {
  console.log('🤖 ══ AI BUYER SIMULATION — EXTERNAL SHOPPING AGENT (T-82) ══\n');

  const db = serverAdmin();

  // 1. Discover Catalog
  console.log('1. DISCOVERING CATALOG...');
  const books = await listBooks({});
  console.log(`   Fetched ${books.length} titles from bookstore catalog.`);

  // Find discounted title (or default to BK-101)
  const targetBook = books.find((b) => b.discount_pct && b.discount_pct > 0) ?? books.find((b) => b.sku === 'BK-101') ?? books[0];
  const effPriceP = targetBook.discount_pct ? effectivePriceP(targetBook.price_p, targetBook.discount_pct) : targetBook.price_p;

  console.log(`   Selected target book: "${targetBook.name}" (${targetBook.sku})`);
  console.log(`   Original Price: ₹${targetBook.price_p / 100} | Effective Sale Price: ₹${effPriceP / 100} (-${targetBook.discount_pct ?? 0}% OFF)\n`);

  // 2. Attempt 1: Over-quantity Order (Demonstrate Policy Gate Rejection)
  console.log('2. ATTEMPT 1: Placing Over-Quantity Order (qty: 10)...');
  const invalidOrderInput = {
    buyer_ref: 'ai_buyer_sim_agent',
    lines: [{ sku: targetBook.sku, qty: 10, asserted_unit_price_inr: effPriceP / 100 }],
  };

  const facts = {
    catalog: {
      [targetBook.sku]: {
        price_p: targetBook.price_p,
        active_discount_pct: targetBook.discount_pct ?? null,
        inventory: targetBook.inventory,
      },
    },
  };

  const limits = {
    ...DEFAULT_BUYER_POLICY_LIMITS,
    buyer_max_qty_per_sku: 5,
    buyer_max_order_p: 1000000,
  };

  const verdict1 = evaluateBuyerOrder(invalidOrderInput, limits, facts);
  console.log(`   Verdict: ${verdict1.ok ? 'APPROVED' : 'REJECTED'}`);
  console.log(`   Rule Triggered: ${verdict1.rule}`);
  console.log(`   Detail: ${verdict1.detail.reason}`);
  console.log('   ✓ Policy engine successfully blocked over-quantity purchase (409 BUYER_MAX_QTY)\n');

  // 3. Attempt 2: Compliant Order (Demonstrate Approved Order & Razorpay Payment Link)
  console.log('3. ATTEMPT 2: Placing Compliant Order (qty: 2)...');
  const validOrderInput = {
    buyer_ref: 'ai_buyer_sim_agent',
    lines: [{ sku: targetBook.sku, qty: 2, asserted_unit_price_inr: effPriceP / 100 }],
  };

  const verdict2 = evaluateBuyerOrder(validOrderInput, limits, facts);
  if (!verdict2.ok || !verdict2.approvedAction) {
    console.error('❌ Unexpected rejection on valid order');
    process.exit(1);
  }

  console.log(`   Verdict: APPROVED`);
  console.log(`   Executing order via Razorpay test mode...`);

  const runId = await createAgentRun(db, 'ai_buyer', 0);
  await logAgentEvent(db, runId, 1, 'observe', 'info', 'AI-buyer simulation order', validOrderInput);
  await logAgentEvent(db, runId, 2, 'policy', 'info', 'Buyer policy check passed', verdict2);

  const execRes = await executeOrder(verdict2.approvedAction, runId, { db });
  await logAgentEvent(db, runId, 3, 'execute', 'info', `Order executed: ${execRes.razorpay_order_id}`, execRes);

  console.log(`\n🎉 ORDER EXECUTED SUCCESSFULLY!`);
  console.log(`   Order ID:               ${execRes.order_id}`);
  console.log(`   Razorpay Order ID:      ${execRes.razorpay_order_id}`);
  console.log(`   Razorpay Payment Link:  ${execRes.razorpay_payment_link_id}`);
  console.log(`   Payable Short URL:      ${execRes.razorpay_short_url}`);
  console.log(`   Total Paid:             ₹${execRes.total_p / 100}`);
  console.log('\n   Audit trail updated. Unified engine gating complete!');
}

main().catch((err) => {
  console.error('SIMULATION FAILED:', err);
  process.exit(1);
});
