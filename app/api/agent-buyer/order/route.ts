import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';
import { evaluateBuyerOrder, DEFAULT_BUYER_POLICY_LIMITS } from '@/lib/policy/buyer';
import { DEFAULT_POLICY_LIMITS } from '@/lib/policy/rules';
import { executeOrder } from '@/lib/execute/order';
import { createAgentRun, logAgentEvent, updateAgentRun, fetchRunEvents } from '@/lib/audit/log';
import { renderRunNarrative } from '@/lib/audit/narrator';
import type { ProductFact, MerchantPolicyLimits } from '@/lib/policy/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/agent-buyer/order — AI-Buyer order placement endpoint (T-81). */
export async function POST(req: Request) {
  try {
    const key = req.headers.get('x-agent-key');
    const configuredKey = process.env.AGENT_BUYER_KEY;

    if (!key || (configuredKey && key !== configuredKey)) {
      return NextResponse.json({ error: 'Unauthorized: Invalid or missing X-Agent-Key header' }, { status: 401 });
    }

    const body = await req.json();

    // P1c: Validate request body shape before any DB work
    if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: "lines" must be a non-empty array' },
        { status: 400 },
      );
    }
    for (let i = 0; i < body.lines.length; i++) {
      const line = body.lines[i];
      if (!line.sku || typeof line.sku !== 'string') {
        return NextResponse.json(
          { error: `Invalid request: lines[${i}].sku must be a non-empty string` },
          { status: 400 },
        );
      }
      if (line.qty === undefined || !Number.isInteger(line.qty) || line.qty < 1) {
        return NextResponse.json(
          { error: `Invalid request: lines[${i}].qty must be a positive integer (got ${line.qty})` },
          { status: 400 },
        );
      }
    }

    const db = serverAdmin();

    // 1. Fetch products & active discounts from DB for buyer evaluation facts
    const { data: dbProducts } = await db.from('products').select('*');
    const { data: dbDiscounts } = await db.from('discounts').select('*').eq('status', 'active');
    const { data: pol } = await db.from('merchant_policy').select('*').eq('id', 1).single();

    const discountMap = new Map<string, number>();
    for (const d of (dbDiscounts ?? [])) {
      discountMap.set(d.product_id, d.pct);
    }

    const catalogMap: Record<string, ProductFact> = {};
    for (const p of (dbProducts ?? [])) {
      const discPct = discountMap.get(p.id) ?? null;
      catalogMap[p.sku] = {
        sku: p.sku,
        category: p.category,
        price_p: p.price_p,
        cost_p: p.cost_p,
        inventory: p.inventory,
        is_featured: p.is_featured,
        active_discount_pct: discPct,
      };
    }

    const facts = { catalog: catalogMap };

    const buyerLimits: MerchantPolicyLimits = {
      ...DEFAULT_POLICY_LIMITS,
      buyer_max_qty_per_sku: pol?.buyer_max_qty_per_sku ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_qty_per_sku,
      buyer_max_order_p: pol?.buyer_max_order_p ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_order_p,
    };

    // 2. Evaluate buyer order against policy engine
    const verdict = evaluateBuyerOrder(body, buyerLimits, facts);

    // P3: use actual sim day index instead of hardcoded 0
    const { data: sim } = await db.from('sim_state').select('current_day_index').eq('id', 1).single();
    const dayIndex = sim?.current_day_index ?? 0;

    const runId = await createAgentRun(db, 'ai_buyer', dayIndex);
    let seq = 1;

    try {
    await logAgentEvent(
      db,
      runId,
      seq++,
      'observe',
      'info',
      `AI-buyer request received from ${body.buyer_ref ?? 'external_agent'}`,
      body,
    );

    if (!verdict.ok) {
      await logAgentEvent(
        db,
        runId,
        seq++,
        'policy',
        'block',
        `Buyer order rejected: ${verdict.rule} (${verdict.message})`,
        verdict,
      );

      const events = await fetchRunEvents(db, runId);
      const narrative = renderRunNarrative(events);

      await updateAgentRun(db, runId, {
        status: 'rejected',
        verdict,
        narrative,
        finished_at: new Date().toISOString(),
      });

      return NextResponse.json(
        {
          rule: verdict.rule,
          detail: verdict.detail,
          error: verdict.message,
        },
        { status: 409 },
      );
    }

    // 3. Approved! Execute Order via Razorpay
    await logAgentEvent(
      db,
      runId,
      seq++,
      'policy',
      'info',
      'Buyer order policy check passed',
      verdict,
    );

    // P1c: assert total > 0 before execution
    if (verdict.approvedAction.kind === 'buyer_order' && verdict.approvedAction.total_p <= 0) {
      await logAgentEvent(db, runId, seq++, 'execute', 'error', 'Order total must be positive', { total_p: verdict.approvedAction.total_p });
      const events = await fetchRunEvents(db, runId);
      const narrative = renderRunNarrative(events);
      await updateAgentRun(db, runId, { status: 'rejected', verdict, narrative, finished_at: new Date().toISOString() });
      return NextResponse.json({ error: 'Order total must be positive' }, { status: 400 });
    }

    const execRes = await executeOrder(verdict.approvedAction, runId, { db });

    await logAgentEvent(
      db,
      runId,
      seq++,
      'execute',
      'info',
      `Order executed successfully: ${execRes.razorpay_order_id}`,
      execRes,
    );

    const events = await fetchRunEvents(db, runId);
    const narrative = renderRunNarrative(events);

    await updateAgentRun(db, runId, {
      status: 'executed',
      verdict,
      execution: execRes,
      narrative,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({
      order_id: execRes.order_id,
      razorpay_order_id: execRes.razorpay_order_id,
      razorpay_payment_link_id: execRes.razorpay_payment_link_id,
      razorpay_short_url: execRes.razorpay_short_url,
      total_inr: execRes.total_p / 100,
    });

    } catch (innerErr: any) {
      // P2a: ensure buyer run ends in terminal status, never stranded RUNNING
      try {
        await logAgentEvent(db, runId, seq++, 'result', 'error', `Unhandled error: ${innerErr?.message ?? innerErr}`);
        const events = await fetchRunEvents(db, runId);
        const narrative = renderRunNarrative(events);
        await updateAgentRun(db, runId, { status: 'failed', narrative, finished_at: new Date().toISOString() });
      } catch { /* best-effort finalization */ }
      throw innerErr;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'buyer order failed' },
      { status: 500 },
    );
  }
}
