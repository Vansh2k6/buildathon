import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import type { ConversionDropSignal, DeadStockSignal, Signal } from './types';

export const MIN_VIEWS = 50;
export const DROP_THRESHOLD = 0.30; // 30% relative drop
export const DEAD_STOCK_MIN_INV = 40;

export interface MetricRow {
  product_id: string;
  sku: string;
  day_index: number;
  views: number;
  orders: number;
  inventory: number;
}

/**
 * Pure conversion-drop detector logic.
 * Evaluates conversion rate drop for products at `currentDay` vs baseline over [currentDay - 7, currentDay - 1].
 */
export function detectConversionDrop(
  metrics: MetricRow[],
  currentDay: number,
): ConversionDropSignal | null {
  const bySku = new Map<string, MetricRow[]>();
  for (const m of metrics) {
    const list = bySku.get(m.sku) ?? [];
    list.push(m);
    bySku.set(m.sku, list);
  }

  const candidates: Array<{
    sku: string;
    inventory: number;
    views_today: number;
    orders_today: number;
    cr_today: number;
    cr_baseline: number;
    drop_rel: number;
  }> = [];

  for (const [sku, rows] of bySku.entries()) {
    const todayRow = rows.find((r) => r.day_index === currentDay);
    if (!todayRow) continue;
    if (todayRow.views < MIN_VIEWS || todayRow.inventory <= 0) continue;

    const cr_today = todayRow.orders / todayRow.views;

    const histRows = rows.filter(
      (r) => r.day_index >= currentDay - 7 && r.day_index <= currentDay - 1 && r.views >= 1,
    );
    if (histRows.length === 0) continue;

    const crSum = histRows.reduce((acc, r) => acc + r.orders / r.views, 0);
    const cr_baseline = crSum / histRows.length;
    if (cr_baseline <= 0) continue;

    const drop_rel = (cr_baseline - cr_today) / cr_baseline;
    // FP-safe: IEEE 754 accumulation rounding can push exact-boundary drops
    // (e.g. 30.000000%) just below the threshold. Allow a 1e-9 margin.
    if (drop_rel + 1e-9 < DROP_THRESHOLD) continue;
    candidates.push({
      sku,
      inventory: todayRow.inventory,
      views_today: todayRow.views,
      orders_today: todayRow.orders,
      cr_today,
      cr_baseline,
      drop_rel,
    });
  }

  if (candidates.length === 0) return null;

  // Highest drop_rel first
  candidates.sort((a, b) => b.drop_rel - a.drop_rel);
  const top = candidates[0];

  return {
    kind: 'conversion_drop',
    sku: top.sku,
    day_index: currentDay,
    views_today: top.views_today,
    orders_today: top.orders_today,
    cr_today_pct: Number((top.cr_today * 100).toFixed(2)),
    cr_baseline_pct: Number((top.cr_baseline * 100).toFixed(2)),
    drop_rel_pct: Number((top.drop_rel * 100).toFixed(1)),
    inventory: top.inventory,
    also_firing: candidates.length - 1,
  };
}

/**
 * Pure dead-stock detector logic.
 * Evaluates products with inventory >= 40 and zero orders in [currentDay - 6, currentDay].
 * Evaluated only if no conversion drop fired.
 */
export function detectDeadStock(
  metrics: MetricRow[],
  currentDay: number,
): DeadStockSignal | null {
  const bySku = new Map<string, MetricRow[]>();
  for (const m of metrics) {
    const list = bySku.get(m.sku) ?? [];
    list.push(m);
    bySku.set(m.sku, list);
  }

  const candidates: Array<{
    sku: string;
    inventory: number;
  }> = [];

  for (const [sku, rows] of bySku.entries()) {
    const todayRow = rows.find((r) => r.day_index === currentDay);
    if (!todayRow) continue;
    if (todayRow.inventory < DEAD_STOCK_MIN_INV) continue;

    const windowRows = rows.filter(
      (r) => r.day_index >= currentDay - 6 && r.day_index <= currentDay,
    );
    // Require a full 7-day window before declaring dead stock —
    // a partial window is premature and creates noise on early days.
    if (windowRows.length < 7) continue;
    const orders_7d = windowRows.reduce((acc, r) => acc + r.orders, 0);

    if (orders_7d === 0) {
      candidates.push({
        sku,
        inventory: todayRow.inventory,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Highest inventory first
  candidates.sort((a, b) => b.inventory - a.inventory);
  const top = candidates[0];

  return {
    kind: 'dead_stock',
    sku: top.sku,
    day_index: currentDay,
    inventory: top.inventory,
    orders_7d: 0,
    also_firing: candidates.length - 1,
  };
}

/**
 * Database detector wrapper.
 * Reads sim_state + product_metrics_daily from Supabase and evaluates internal signals.
 */
export async function detectInternalSignal(
  db?: SupabaseClient,
  dayIndexOverride?: number,
): Promise<Signal | null> {
  const client = db ?? serverAdmin();

  let currentDay: number = dayIndexOverride ?? 0;
  if (dayIndexOverride === undefined) {
    const { data: sim, error: simErr } = await client
      .from('sim_state')
      .select('current_day_index')
      .eq('id', 1)
      .single();
    if (simErr) throw new Error(`Failed to fetch sim_state: ${simErr.message}`);
    currentDay = sim.current_day_index;
  }

  const { data: products, error: pErr } = await client
    .from('products')
    .select('id, sku, inventory, price_p');
  if (pErr) throw new Error(`Failed to fetch products: ${pErr.message}`);

  const startDay = Math.max(0, currentDay - 7);
  const { data: dailyMetrics, error: mErr } = await client
    .from('product_metrics_daily')
    .select('product_id, day_index, views, orders')
    .gte('day_index', startDay)
    .lte('day_index', currentDay);
  if (mErr) throw new Error(`Failed to fetch product metrics: ${mErr.message}`);

  const pMap = new Map<string, { sku: string; inventory: number; price_p: number }>();
  for (const p of products ?? []) {
    pMap.set(p.id, { sku: p.sku, inventory: p.inventory, price_p: p.price_p });
  }

  const metricRows: MetricRow[] = [];
  for (const m of dailyMetrics ?? []) {
    const p = pMap.get(m.product_id);
    if (!p) continue;
    // Defensive check: if DB orders column accidentally holds revenue_p (orders > 100), convert to count
    const ordersCount = m.orders > 100 && p.price_p > 0 ? Math.round(m.orders / p.price_p) : m.orders;
    metricRows.push({
      product_id: m.product_id,
      sku: p.sku,
      day_index: m.day_index,
      views: m.views,
      orders: ordersCount,
      inventory: p.inventory,
    });
  }

  const dropSignal = detectConversionDrop(metricRows, currentDay);
  if (dropSignal) return dropSignal;

  const deadStockSignal = detectDeadStock(metricRows, currentDay);
  if (deadStockSignal) return deadStockSignal;

  return null;
}
