import { loadEnv } from './_env';
loadEnv();

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

function pickTarget(books: CatalogRow[]): CatalogRow {
  const inStock = books.filter((b) => b.inventory > 0);
  if (inStock.length === 0) {
    throw new Error('No in-stock books available in catalog.');
  }
  return inStock[0];
}

async function main(): Promise<void> {
  const snap: CatalogSnapshot = await getCatalogSnapshot();
  const catalogRes = snap.rows.length
    ? await httpJson<CatalogResponse>('GET', '/api/catalog')
    : { policy_summary: { buyer_max_qty_per_line: 5, buyer_max_order_total_inr: 25_000 } };

  const maxAllowedQty = catalogRes.policy_summary.buyer_max_qty_per_line || 5;
  const attemptedQty = maxAllowedQty + 10;
  const target = pickTarget(snap.rows);

  try {
    await httpJson<any>('POST', '/api/agent-buyer/order', {
      buyer_ref: 'agent_buyer_over_qty',
      lines: [
        {
          sku: target.sku,
          qty: attemptedQty,
          asserted_unit_price_inr: target.effective_price_inr,
        },
      ],
    });
    console.log('Order unexpectedly succeeded.');
  } catch (err: any) {
    if (err instanceof HttpError) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(err.body);
      } catch {
        parsed = { error: err.body };
      }

      console.log(`Product:  ${target.name} (${target.sku})`);
      console.log(`Ordered:  ${attemptedQty} units (Limit: ${maxAllowedQty})`);
      console.log(`Status:   Rejected (${err.status})`);
      console.log(`Rule:     ${parsed.rule ?? 'BUYER_MAX_QTY'}`);
      console.log(`Message:  ${parsed.error ?? parsed.message}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Request failed:', err?.message ?? err);
  process.exit(1);
});
