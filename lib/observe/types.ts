/**
 * lib/observe/types.ts — Detector signal types for Phase 3.
 * Pure discriminated union: kind = 'conversion_drop' | 'dead_stock' | 'trending_headlines'
 */

export interface ConversionDropSignal {
  kind: 'conversion_drop';
  sku: string;
  day_index: number;
  views_today: number;
  orders_today: number;
  cr_today_pct: number;
  cr_baseline_pct: number;
  drop_rel_pct: number;
  inventory: number;
  also_firing: number;
}

export interface DeadStockSignal {
  kind: 'dead_stock';
  sku: string;
  day_index: number;
  inventory: number;
  orders_7d: number;
  also_firing: number;
}

export interface HeadlineItem {
  title: string;
  description: string;
  source: string;
}

export interface TrendingHeadlinesSignal {
  kind: 'trending_headlines';
  source: 'live' | 'fallback';
  fetched_at: string;
  headlines: HeadlineItem[];
}

export type Signal = ConversionDropSignal | DeadStockSignal | TrendingHeadlinesSignal;
