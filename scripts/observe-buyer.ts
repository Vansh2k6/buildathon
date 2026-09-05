/**
 * observe-buyer.ts — Watch an external AI buyer agent discover the catalog,
 * place an order, and have the order land in the orders table + Razorpay test mode.
 *
 * What it does:
 *   1. Reset sim to day 0.
 *   2. GET /api/catalog  →  reads the same JSON an external agent would see.
 *   3. Pick a target SKU (prefer a discounted one, else the cheapest in stock).
 *   4. Compute the buyer's effective price.
 *   5. POST /api/agent-buyer/order  with 1 unit  →  expect APPROVED + Razorpay short_url.
 *   6. Verify the order row exists in Supabase.
 *   7. Then re-fire with over-quantity (10)  →  expect 409 with BUYER_MAX_QTY.
 *
 * This calls the same public surface an external AI shopping agent would call.
 * Same engine, same audit log, three different triggers (internal / external / ai_buyer).
 *
 * Run:
 *   npm run dev   (in another terminal)
 *   npx tsx scripts/observe-buyer.ts
 *
 * Required env (.env.local):
 *   SUPABASE_SERVICE_ROLE_KEY  (to read orders for verification)
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET  (test mode)
 *   X-AGENT-KEY env var optional — buyer route accepts any value if AGENT_BUYER_KEY is unset
 */

import { loadEnv } from './_env';
loadEnv();

import { createClient } from '@supabase/supabase-js';
import {
  CatalogRow,
  CatalogSnapshot,
  getCatalogSnapshot,
  httpJson,
  HttpError,
} from './_observe-base';

type CatalogResponse = {
  books: CatalogRow[];
  policy_summary: { buyer_max_qty_per_line: number; buyer_max_order_total_inr: number };
};

type OrderResponse = {
  ok: boolean;
  order_id?: string;
  subtotal_inr?: number;
  discount_inr?: number;
  total_inr?: number;
  razorpay_order_id?: string;
  razorpay_payment_link_id?: string;
  razorpay_short_url?: string;
  policy_violations?: string[];
  error?: string;
  rule?: string;
  detail?: any;
};

function header(title: string): void {
  console.log('\n' + '═'.repeat(72));
  console.log(`  ${title}`);
  console.log('═'.repeat(72));
}

function pickTarget(books: CatalogRow[]): CatalogRow {
  const discounted = books.find((b) => (b.discount_pct ?? 0) > 0 && b.inventory > 0);
  if (discounted) return discounted;
  return [...books].filter((b) => b.inventory > 0).sort((a, b) => a.effective_price_inr - b.effective_price_inr)[0] ?? books[0];
}

async function main(): Promise<void> {
  header('OBSERVE: AI BUYER — external shopping agent, same engine, same audit');

  console.log('\n› Step 1/5 · reset sim to day 0');
  await httpJson<{ dayIndex: number }>('POST', '/api/sim/reset');

  console.log('\n› Step 2/5 · GET /api/catalog (the same call any external agent would make)');
  const snap: CatalogSnapshot = await getCatalogSnapshot();
  const pol = snap.rows.length
    ? (await httpJson<CatalogResponse>('GET', '/api/catalog')).policy_summary
    : { buyer_max_qty_per_line: 5, buyer_max_order_total_inr: 25_000 };
  console.log(`  catalog:      ${snap.rows.length} titles`);
  console.log(`  policy caps:  max qty/line = ${pol.buyer_max_qty_per_line}, max order = ₹${pol.buyer_max_order_total_inr}`);

  console.log('\n  catalog sample (first 5):');
  for (const b of snap.rows.slice(0, 5)) {
    const tag = (b.discount_pct ?? 0) > 0 ? ` -${b.discount_pct}%` : '';
    console.log(`    ${b.sku.padEnd(7)} ₹${b.effective_price_inr}${tag}  inv=${b.inventory}  ${b.name}`);
  }

  const target = pickTarget(snap.rows);
  console.log(`\n  target picked:  ${target.sku}  ${target.name}`);
  console.log(`                  ₹${target.effective_price_inr} (was ₹${target.price_inr}, -${target.discount_pct ?? 0}%)`);

  console.log('\n› Step 3/5 · POST /api/agent-buyer/order  qty=1  (expect: approved + Razorpay link)');
  const approved = await httpJson<OrderResponse>('POST', '/api/agent-buyer/order', {
    buyer_ref: 'observe_buyer_script',
    lines: [{ sku: target.sku, qty: 1, asserted_unit_price_inr: target.effective_price_inr }],
  });
  console.log(`  ok:           ${approved.ok}`);
  console.log(`  order_id:     ${approved.order_id ?? '(none)'}`);
  console.log(`  total:        ₹${approved.total_inr}  (subtotal ₹${approved.subtotal_inr} − discount ₹${approved.discount_inr})`);
  console.log(`  razorpay:     order_id=${approved.razorpay_order_id ?? '-'}`);
  console.log(`                payment_link_id=${approved.razorpay_payment_link_id ?? '-'}`);
  console.log(`                short_url=${approved.razorpay_short_url ?? '(not created)'}`);
  if (approved.policy_violations?.length) console.log(`  violations:   ${approved.policy_violations.join(', ')}`);

  console.log('\n› Step 4/5 · verify the order row landed in Supabase');
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supaUrl || !serviceKey) {
    console.log('  ⚠  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — skipping row check.');
  } else {
    const db = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await db
      .from('orders')
      .select('id, source, items, subtotal_p, total_p, razorpay_order_id, razorpay_short_url, status, created_at')
      .eq('id', approved.order_id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle();
    if (error) {
      console.log(`  ✗ read failed: ${error.message}`);
    } else if (!data) {
      console.log('  ✗ order row not found');
    } else {
      console.log(`  ✓ row present  status=${data.status}  total_p=${data.total_p}  razorpay=${data.razorpay_short_url ?? 'no link'}`);
      console.log(`    items: ${JSON.stringify(data.items)}`);
    }
  }

  console.log('\n› Step 5/5 · POST /api/agent-buyer/order  qty=10  (expect: 409 BUYER_MAX_QTY)');
  try {
    await httpJson<OrderResponse>('POST', '/api/agent-buyer/order', {
      buyer_ref: 'observe_buyer_script',
      lines: [{ sku: target.sku, qty: 10, asserted_unit_price_inr: target.effective_price_inr }],
    });
    console.log('  ⚠  expected a 409, got 2xx — buyer policy may be misconfigured.');
  } catch (e) {
    if (e instanceof HttpError) {
      console.log(`  ✓ got ${e.status} as expected`);
      const body = e.body || '';
      const m = /"rule"\s*:\s*"([^"]+)"/.exec(body);
      if (m) console.log(`    rule: ${m[1]}`);
      console.log(`    body: ${body.slice(0, 200)}`);
    } else {
      throw e;
    }
  }
}

main().catch((e) => {
  console.error('\n✗ observe-buyer failed:', e?.message ?? e);
  process.exit(1);
});
