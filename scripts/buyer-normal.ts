import { loadEnv } from './_env';
loadEnv();

import { CatalogRow, CatalogSnapshot, getCatalogSnapshot, httpJson } from './_observe-base';

type CatalogResponse = {
  books: CatalogRow[];
  policy_summary: { buyer_max_qty_per_line: number; buyer_max_order_total_inr: number };
};

type OrderResponse = {
  order_id?: string;
  subtotal_inr?: number;
  discount_inr?: number;
  total_inr?: number;
  razorpay_order_id?: string;
  razorpay_payment_link_id?: string;
  razorpay_short_url?: string;
  error?: string;
};

function pickTarget(books: CatalogRow[]): CatalogRow {
  const inStock = books.filter((b) => b.inventory > 0);
  if (inStock.length === 0) {
    throw new Error('No in-stock books available in catalog.');
  }
  const discounted = inStock.find((b) => (b.discount_pct ?? 0) > 0);
  if (discounted) return discounted;
  return [...inStock].sort((a, b) => a.effective_price_inr - b.effective_price_inr)[0];
}

async function main(): Promise<void> {
  const snap: CatalogSnapshot = await getCatalogSnapshot();
  const target = pickTarget(snap.rows);

  const order = await httpJson<OrderResponse>('POST', '/api/agent-buyer/order', {
    buyer_ref: 'agent_buyer_normal',
    lines: [
      {
        sku: target.sku,
        qty: 1,
        asserted_unit_price_inr: target.effective_price_inr,
      },
    ],
  });

  console.log(`Product: ${target.name} (${target.sku})`);
  console.log(`Amount:  INR ${order.total_inr}`);
  console.log(`Order:   ${order.order_id}`);
  console.log(`Payment: ${order.razorpay_short_url ?? '(created)'}`);
}

main().catch((err) => {
  console.error('Order failed:', err?.message ?? err);
  process.exit(1);
});
