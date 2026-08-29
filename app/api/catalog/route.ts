import { NextResponse } from 'next/server';
import { listBooks, effectivePriceP } from '@/lib/catalog';
import { serverAdmin } from '@/lib/db';
import { DEFAULT_BUYER_POLICY_LIMITS } from '@/lib/policy/buyer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/catalog — Public AI-agent catalog endpoint with effective prices & buyer policy summary (T-80). */
export async function GET() {
  try {
    const books = await listBooks({});

    const formattedBooks = books.map((b) => {
      const effP = b.discount_pct ? effectivePriceP(b.price_p, b.discount_pct) : b.price_p;
      return {
        sku: b.sku,
        name: b.name,
        author: b.author,
        category: b.category,
        price_inr: b.price_p / 100,
        effective_price_inr: effP / 100,
        discount_pct: b.discount_pct ?? 0,
        inventory: b.inventory,
      };
    });

    const { data: pol } = await serverAdmin().from('merchant_policy').select('*').eq('id', 1).single();

    return NextResponse.json({
      books: formattedBooks,
      policy_summary: {
        buyer_max_qty_per_line: pol?.buyer_max_qty_per_sku ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_qty_per_sku,
        buyer_max_order_total_inr: (pol?.buyer_max_order_p ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_order_p) / 100,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to fetch catalog' },
      { status: 500 },
    );
  }
}
