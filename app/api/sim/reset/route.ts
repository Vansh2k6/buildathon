import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function sanitizeProductMetricsOrders(db = serverAdmin()) {
  const { data: books } = await db.from('products').select('id, price_p');
  for (const b of books || []) {
    const { data: rows } = await db
      .from('product_metrics_daily')
      .select('day_index, orders')
      .eq('product_id', b.id)
      .gt('orders', 100);
    for (const r of rows || []) {
      const fixed = Math.round(r.orders / b.price_p);
      await db
        .from('product_metrics_daily')
        .update({ orders: fixed })
        .eq('product_id', b.id)
        .eq('day_index', r.day_index);
    }
  }
}

/** POST /api/sim/reset — {} → {dayIndex:0}; truncates run artifacts, reseeds metrics (AC-3 idempotent). */
export async function POST() {
  try {
    const db = serverAdmin();
    const { error } = await db.rpc('demo_reset');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await sanitizeProductMetricsOrders(db);
    return NextResponse.json({ dayIndex: 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reset failed' }, { status: 500 });
  }
}
