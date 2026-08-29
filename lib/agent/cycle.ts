/**
 * lib/agent/cycle.ts — Agent cycle state machine orchestrator (T-50).
 * Source of truth: AGENT.md §2 (state machine & retry budget MAX_RETRIES = 1).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serverAdmin } from '@/lib/db';
import { detectInternalSignal } from '@/lib/observe/internal';
import { detectExternalSignal } from '@/lib/observe/external';
import type { Signal } from '@/lib/observe/types';
import { proposeAction } from '@/lib/decide/propose';
import { evaluate } from '@/lib/policy/engine';
import { executeDiscount } from '@/lib/execute/discount';
import { executeFeatured } from '@/lib/execute/featured';
import { executeOrder } from '@/lib/execute/order';
import type { AgentWorldFacts, MerchantPolicyLimits, ProductFact, Proposal, Verdict } from '@/lib/policy/types';
import {
  createAgentRun,
  logAgentEvent,
  updateAgentRun,
  fetchRunEvents,
  type RunStatus,
  type RunTrigger,
} from '@/lib/audit/log';
import {
  renderDecideTemplate,
  renderExecuteTemplate,
  renderObserveTemplate,
  renderPolicyTemplate,
  renderResultTemplate,
  renderRunNarrative,
} from '@/lib/audit/narrator';

export const MAX_RETRIES = 1;

export interface CycleResult {
  runId: string;
  status: RunStatus;
  narrative: string;
  signal?: Signal | null;
  proposal?: Proposal | null;
  verdict?: Verdict | null;
  execution?: any | null;
  error?: string;
}

/**
 * Builds AgentWorldFacts object from Supabase DB state.
 */
export async function buildWorldFacts(
  db: SupabaseClient,
  currentDay: number,
): Promise<{ catalogMap: Record<string, ProductFact>; catalogList: ProductFact[]; facts: AgentWorldFacts }> {
  // 1. Fetch catalog
  const { data: pRows, error: pErr } = await db
    .from('products')
    .select('id, sku, category, price_p, cost_p, inventory, is_featured');
  if (pErr) throw new Error(`Failed to fetch products for facts: ${pErr.message}`);

  const { data: dRows, error: dErr } = await db
    .from('discounts')
    .select('product_id, pct')
    .eq('status', 'active');
  if (dErr) throw new Error(`Failed to fetch active discounts for facts: ${dErr.message}`);

  const activeMap = new Map<string, number>();
  for (const d of dRows ?? []) activeMap.set(d.product_id, d.pct);

  const catalogMap: Record<string, ProductFact> = {};
  const catalogList: ProductFact[] = [];

  for (const p of pRows ?? []) {
    const fact: ProductFact = {
      sku: p.sku,
      category: p.category,
      price_p: p.price_p,
      cost_p: p.cost_p,
      inventory: p.inventory,
      is_featured: p.is_featured,
      active_discount_pct: activeMap.get(p.id) ?? null,
    };
    catalogMap[p.sku] = fact;
    catalogList.push(fact);
  }

  // 2. Active discount count & last discount day
  const active_discount_count = dRows?.length ?? 0;

  const { data: lastDisc } = await db
    .from('discounts')
    .select('created_day_index')
    .order('created_day_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  const last_discount_day = lastDisc?.created_day_index ?? null;

  // 3. Executed runs today
  const { data: todayRuns } = await db
    .from('agent_runs')
    .select('id')
    .eq('day_index', currentDay)
    .eq('status', 'executed');

  const executed_runs_today = todayRuns?.length ?? 0;

  // 4. Spent today in paise
  const { data: todayDiscounts } = await db
    .from('discounts')
    .select('created_day_index')
    .eq('created_day_index', currentDay);

  const spent_today_p = (todayDiscounts?.length ?? 0) * 50000; // approximate or exact sum

  // 5. Featured count
  const featuredCount = catalogList.filter((p) => p.is_featured).length;

  // 6. Recent daily orders (default 4 orders/day for fallback estimate)
  const recent_daily_orders = [4, 4, 4, 4, 4, 4, 4];

  const facts: AgentWorldFacts = {
    catalog: catalogMap,
    active_discount_count,
    last_discount_day,
    executed_runs_today,
    spent_today_p,
    recent_daily_orders,
    current_day: currentDay,
    featuredCountAfter: (p) => (p.is_featured ? featuredCount : featuredCount + 1),
  };

  return { catalogMap, catalogList, facts };
}

/**
 * Fetches merchant policy limits row (id=1).
 */
export async function getMerchantPolicy(db: SupabaseClient): Promise<MerchantPolicyLimits> {
  const { data, error } = await db
    .from('merchant_policy')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    throw new Error(`Failed to fetch merchant_policy: ${error.message}`);
  }

  return {
    max_discount_pct: data.max_discount_pct,
    min_margin_pct: data.min_margin_pct,
    max_active_discounts: data.max_active_discounts,
    max_actions_per_day: data.max_actions_per_day,
    daily_discount_budget_p: data.daily_discount_budget_p,
    max_featured_slots: data.max_featured_slots,
    cooldown_days: data.cooldown_days,
    blocked_categories: data.blocked_categories ?? [],
    buyer_max_order_p: data.buyer_max_order_p,
    buyer_max_qty_per_sku: data.buyer_max_qty_per_sku,
  };
}

/**
 * Runs one complete agent cycle through all 5 phases (T-50).
 */
export async function runAgentCycle(
  trigger: RunTrigger,
  opts?: {
    db?: SupabaseClient;
    dayIndexOverride?: number;
    executeStubbed?: boolean;
  },
): Promise<CycleResult> {
  const startTime = Date.now();
  const db = opts?.db ?? serverAdmin();
  const executeStubbed = opts?.executeStubbed ?? true;

  // Resolve current day
  let currentDay = opts?.dayIndexOverride;
  if (currentDay === undefined) {
    const { data: sim } = await db.from('sim_state').select('current_day_index').eq('id', 1).single();
    currentDay = sim?.current_day_index ?? 0;
  }

  // Create agent run entry
  const runId = await createAgentRun(db, trigger, currentDay);
  let seq = 1;

  // ── PHASE 1: OBSERVE ───────────────────────────────────────────────────
  let signal: Signal | null = null;
  if (trigger === 'internal') {
    signal = await detectInternalSignal(db, currentDay);
  } else if (trigger === 'external') {
    signal = await detectExternalSignal({ db });
  }

  if (!signal) {
    const msg = renderObserveTemplate(null, currentDay);
    await logAgentEvent(db, runId, seq++, 'observe', 'info', msg);

    const elapsed = Date.now() - startTime;
    const resMsg = renderResultTemplate('no_signal', elapsed, 'no changes');
    await logAgentEvent(db, runId, seq++, 'result', 'info', resMsg);

    const allEvents = await fetchRunEvents(db, runId);
    const narrative = renderRunNarrative(allEvents);

    await updateAgentRun(db, runId, {
      status: 'no_signal',
      signal: null,
      narrative,
      finished_at: new Date().toISOString(),
    });

    return { runId, status: 'no_signal', narrative, signal: null };
  }

  const obsMsg = renderObserveTemplate(signal, currentDay);
  await logAgentEvent(db, runId, seq++, 'observe', 'info', obsMsg, signal);
  await updateAgentRun(db, runId, { signal });

  // ── FETCH FACTS & POLICY ───────────────────────────────────────────────
  const { catalogList, facts } = await buildWorldFacts(db, currentDay);
  const policyLimits = await getMerchantPolicy(db);

  // ── PHASE 2: DECIDE (Attempt 1) ────────────────────────────────────────
  const res1 = await proposeAction(signal, catalogList, currentDay);

  if (!res1.ok || !res1.proposal) {
    const errText = res1.error ?? 'Model proposal failed';
    await logAgentEvent(db, runId, seq++, 'decide', 'error', `Model proposal failed: ${errText}`, res1.rawToolInput);

    const elapsed = Date.now() - startTime;
    const resMsg = renderResultTemplate('failed', elapsed, 'no changes (model call failed)');
    await logAgentEvent(db, runId, seq++, 'result', 'error', resMsg);

    const allEvents = await fetchRunEvents(db, runId);
    const narrative = renderRunNarrative(allEvents);

    await updateAgentRun(db, runId, {
      status: 'failed',
      narrative,
      finished_at: new Date().toISOString(),
    });

    return { runId, status: 'failed', narrative, signal, error: errText };
  }

  const proposal1 = res1.proposal;
  const decMsg1 = renderDecideTemplate(proposal1);
  await logAgentEvent(db, runId, seq++, 'decide', 'info', decMsg1, proposal1);
  await updateAgentRun(db, runId, { proposal: proposal1 });

  // ── PHASE 3: POLICY (Attempt 1) ────────────────────────────────────────
  let verdict = evaluate(proposal1, policyLimits, facts);

  if (verdict.ok) {
    const polMsg = renderPolicyTemplate(verdict);
    await logAgentEvent(db, runId, seq++, 'policy', 'info', polMsg, verdict);
    await updateAgentRun(db, runId, { verdict });
  } else {
    // Rejection on Attempt 1
    const polBlockMsg = renderPolicyTemplate(verdict);
    await logAgentEvent(db, runId, seq++, 'policy', 'block', polBlockMsg, verdict);

    // Check retry budget (MAX_RETRIES = 1)
    await updateAgentRun(db, runId, { verdict, retry_count: 1 });

    // ── DECIDE (Attempt 2 / Retry) ─────────────────────────────────────
    const res2 = await proposeAction(signal, catalogList, currentDay, {
      previousProposal: proposal1,
      previousRawInput: res1.rawToolInput,
      rejectionRule: verdict.rule,
      value: verdict.detail.value,
      limit: verdict.detail.limit,
    });

    if (!res2.ok || !res2.proposal) {
      const errText = res2.error ?? 'Model retry proposal failed';
      await logAgentEvent(db, runId, seq++, 'decide', 'error', `Retry proposal failed: ${errText}`, res2.rawToolInput);

      const elapsed = Date.now() - startTime;
      const resMsg = renderResultTemplate('failed', elapsed, 'no changes (retry failed)');
      await logAgentEvent(db, runId, seq++, 'result', 'error', resMsg);

      const allEvents = await fetchRunEvents(db, runId);
      const narrative = renderRunNarrative(allEvents);

      await updateAgentRun(db, runId, {
        status: 'failed',
        narrative,
        finished_at: new Date().toISOString(),
      });

      return { runId, status: 'failed', narrative, signal, proposal: proposal1, verdict, error: errText };
    }

    const proposal2 = res2.proposal;
    const decMsg2 = renderDecideTemplate(proposal2, true, {
      rule: verdict.rule,
      limit: verdict.detail.limit,
    });
    await logAgentEvent(db, runId, seq++, 'decide', 'info', decMsg2, proposal2);
    await updateAgentRun(db, runId, { proposal_retry: proposal2 });

    // ── POLICY (Attempt 2) ─────────────────────────────────────────────
    const verdict2 = evaluate(proposal2, policyLimits, facts);

    if (!verdict2.ok) {
      const polBlockMsg2 = renderPolicyTemplate(verdict2, true);
      await logAgentEvent(db, runId, seq++, 'policy', 'block', polBlockMsg2, verdict2);

      const elapsed = Date.now() - startTime;
      const resMsg = renderResultTemplate('rejected', elapsed, 'no changes (proposal blocked by policy)');
      await logAgentEvent(db, runId, seq++, 'result', 'info', resMsg);

      const allEvents = await fetchRunEvents(db, runId);
      const narrative = renderRunNarrative(allEvents);

      await updateAgentRun(db, runId, {
        status: 'rejected',
        verdict: verdict2,
        narrative,
        finished_at: new Date().toISOString(),
      });

      return { runId, status: 'rejected', narrative, signal, proposal: proposal2, verdict: verdict2 };
    }

    // Attempt 2 Approved!
    verdict = verdict2;
    const polMsg2 = renderPolicyTemplate(verdict2, true);
    await logAgentEvent(db, runId, seq++, 'policy', 'info', polMsg2, verdict2);
    await updateAgentRun(db, runId, { verdict: verdict2 });
  }

  // ── PHASE 4: EXECUTE ───────────────────────────────────────────────────
  const approved = verdict.approvedAction;
  let executionPayload: any = null;

  if (executeStubbed) {
    executionPayload = {
      sku: approved.sku,
      action: approved.kind,
      discount_pct: approved.discount_pct,
      stubbed: true,
    };
  } else {
    if (approved.kind === 'discount' || approved.kind === 'discount_and_feature') {
      const dRes = await executeDiscount(approved, runId, currentDay, { db });
      executionPayload = dRes;
    }
    if (approved.kind === 'feature' || approved.kind === 'discount_and_feature') {
      const fRes = await executeFeatured(approved, { db });
      executionPayload = { ...(executionPayload ?? {}), ...fRes };
    }
    if (approved.kind === 'buyer_order') {
      const oRes = await executeOrder(approved, runId, { db });
      executionPayload = oRes;
    }
  }

  const execMsg = renderExecuteTemplate(executionPayload);
  await logAgentEvent(db, runId, seq++, 'execute', 'info', execMsg, executionPayload);
  await updateAgentRun(db, runId, { execution: executionPayload });

  // ── PHASE 5: RESULT ────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime;
  let summary = approved.sku ? `${approved.sku}` : 'action';
  if (approved.discount_pct) summary += ` at ${approved.discount_pct}% discount`;

  const resMsg = renderResultTemplate('executed', elapsed, summary);
  await logAgentEvent(db, runId, seq++, 'result', 'info', resMsg);

  const allEvents = await fetchRunEvents(db, runId);
  const narrative = renderRunNarrative(allEvents);

  await updateAgentRun(db, runId, {
    status: 'executed',
    narrative,
    finished_at: new Date().toISOString(),
  });

  return {
    runId,
    status: 'executed',
    narrative,
    signal,
    proposal: verdict.approvedAction as any,
    verdict,
    execution: executionPayload,
  };
}
