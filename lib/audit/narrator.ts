/**
 * lib/audit/narrator.ts — Human-readable story rendering from cycle events (T-52).
 * Templates: AGENT.md §7. All lines read without JSON (FR-32).
 */

import type { AgentEvent, RunStatus } from './log';
import type { Signal } from '@/lib/observe/types';
import type { Proposal, Verdict } from '@/lib/policy/types';
import { formatInr } from '@/lib/money';

export function renderObserveTemplate(
  signal: Signal | null,
  dayIndex: number,
  productCount = 10,
): string {
  if (!signal) {
    return `Day ${dayIndex}: checked ${productCount} products, nothing crossed threshold. No action taken.`;
  }

  if (signal.kind === 'conversion_drop') {
    return `Day ${dayIndex}: conversion on ${signal.sku} fell to ${signal.cr_today_pct}% from a ${signal.cr_baseline_pct}% baseline (${signal.drop_rel_pct}% drop) across ${signal.views_today} views.`;
  }

  if (signal.kind === 'dead_stock') {
    return `Day ${dayIndex}: dead stock detected on ${signal.sku} (${signal.inventory} in stock, 0 sales over trailing 7 days).`;
  }

  if (signal.kind === 'trending_headlines') {
    const topTitle = signal.headlines[0]?.title ?? '(no title)';
    return `Fetched ${signal.headlines.length} headlines from NewsAPI (${signal.source}). Top: "${topTitle}".`;
  }

  return `Day ${dayIndex}: signal detected (${(signal as any).kind}).`;
}

export function renderDecideTemplate(
  proposal: Proposal,
  isRetry = false,
  rejectionInfo?: { rule: string; limit: string | number },
): string {
  let mag = '';
  if (proposal.discount_pct !== undefined) mag += ` ${proposal.discount_pct}%`;
  if (proposal.featured_rank !== undefined) mag += ` rank ${proposal.featured_rank}`;
  mag = mag.trim();
  const magStr = mag ? ` (${mag})` : '';

  if (isRetry && rejectionInfo) {
    return `Retry (1 of 1), informed of ${rejectionInfo.rule}=${rejectionInfo.limit}. Agent proposed ${proposal.action}${proposal.sku ? ` on ${proposal.sku}` : ''}${magStr}.`;
  }

  let text = `Agent proposed ${proposal.action}${proposal.sku ? ` on ${proposal.sku}` : ''}${magStr}, confidence ${proposal.confidence}. Reason: ${proposal.justification}`;

  if (proposal.trend_match) {
    text += ` Match: "${proposal.trend_match.headline}" → ${proposal.sku}, because ${proposal.trend_match.why_it_matches}`;
  }

  return text;
}

export function renderPolicyTemplate(verdict: Verdict, isRetry = false): string {
  if (verdict.ok) {
    const count = verdict.checked.length;
    return `Policy check passed (${count} rules evaluated).`;
  }

  if (isRetry) {
    return `BLOCKED again by ${verdict.rule}. Retry budget exhausted — nothing executed.`;
  }

  return `BLOCKED by ${verdict.rule}: proposed ${verdict.detail.value}, merchant limit ${verdict.detail.limit}.`;
}

export function renderExecuteTemplate(
  execution?: {
    sku?: string | null;
    action?: string;
    discount_pct?: number | null;
    featured_rank?: number | null;
    old_price_p?: number;
    new_price_p?: number;
    razorpay_ref_kind?: string;
    razorpay_id?: string;
    degraded?: boolean;
    error?: string;
    stubbed?: boolean;
  } | null,
): string {
  if (!execution || execution.action === 'no_action' || (!execution.sku && !execution.discount_pct && !execution.featured_rank)) {
    return 'Execution verified: no action taken, storefront unchanged.';
  }

  if (execution.action === 'feature' || (execution.sku && execution.featured_rank && !execution.discount_pct)) {
    return `Promoted ${execution.sku} to storefront featured hero (rank ${execution.featured_rank ?? 1}).`;
  }

  if (execution.stubbed) {
    return `[STUBBED] Execution verified for ${execution.sku ?? 'product'} (${execution.discount_pct ?? 0}% discount).`;
  }

  const refKind = execution.razorpay_ref_kind ?? 'payment_link';
  const rId = execution.razorpay_id ?? 'test_id';

  if (execution.degraded) {
    return `Discount applied locally; Razorpay ${refKind} unavailable (${execution.error ?? 'network error'}). Logged, not silently dropped.`;
  }

  const oldPrice = execution.old_price_p ? formatInr(execution.old_price_p) : '';
  const newPrice = execution.new_price_p ? formatInr(execution.new_price_p) : '';
  const priceStr = oldPrice && newPrice ? ` (${oldPrice} → ${newPrice})` : '';

  return `Applied ${execution.discount_pct ?? 0}% discount to ${execution.sku}${priceStr}. Razorpay ${refKind} ${rId}.`;
}

export function renderResultTemplate(
  status: RunStatus,
  elapsedMs: number,
  summary: string,
): string {
  return `Run ${status} in ${elapsedMs}ms. Storefront now shows ${summary}.`;
}

/**
 * Renders full multi-line narrative story from all events in a run.
 */
export function renderRunNarrative(events: AgentEvent[]): string {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  return sorted.map((e) => e.message).join('\n');
}
