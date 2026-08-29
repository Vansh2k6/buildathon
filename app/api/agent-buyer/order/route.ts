import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';
import { evaluateBuyerOrder } from '@/lib/policy/buyer';
import { executeOrder } from '@/lib/execute/order';
import { createAgentRun, logAgentEvent, updateAgentRun, fetchRunEvents } from '@/lib/audit/log';
import { renderRunNarrative } from '@/lib/audit/narrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/agent-buyer/order — AI-Buyer order placement endpoint (T-81). */
export async function POST(req: Request) {
  try {
    const key = req.headers.get('x-agent-key');
    const expectedKey = process.env.AGENT_BUYER_KEY || 'demo-agent-key';

    if (!key || key !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized: Invalid X-Agent-Key header' }, { status: 401 });
    }

    const body = await req.json();
    const db = serverAdmin();

    // 1. Fetch products & active discounts from DB for buyer evaluation facts
    const { data: dbProducts } = await db.from('products').select('*');
    const { data: dbDiscounts } = await db.from('discounts').select('*').eq('status', 'active');
    const { data: pol } = await db.from('merchant_policy').select('*').eq('id', 1).single();

    const catalogMap: Record<string, { price_p: number; active_discount_pct: number | null; inventory: number }> = {};
    for (const p of (dbProducts ?? [])) {
      const discPct = discountMap.get(p.id) ?? null;
      catalogMap[p.sku] = {
        price_p: p.price_p,
        active_discount_pct: discPct,
        inventory: p.inventory,
      };
    }

    const facts = { catalog: catalogMap };

    const buyerLimits = {
      ...DEFAULT_BUYER_POLICY_LIMITS,
      buyer_max_qty_per_sku: pol?.buyer_max_qty_per_sku ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_qty_per_sku,
      buyer_max_order_p: pol?.buyer_max_order_p ?? DEFAULT_BUYER_POLICY_LIMITS.buyer_max_order_p,
    };

    // 2. Evaluate buyer order against policy engine
    const verdict = evaluateBuyerOrder(body, buyerLimits, facts);
    const runId = await createAgentRun(db, 'ai_buyer', 0);
    let seq = 1;

    await logAgentEvent(
      db,
      runId,
      seq++,
      'observe',
      'info',
      `AI-buyer request received from ${body.buyer_ref ?? 'external_agent'}`,
      body,
    );

    if (!verdict.ok || !verdict.approvedAction) {
      await logAgentEvent(
        db,
        runId,
        seq++,
        'policy',
        'block',
        `Buyer order rejected: ${verdict.rule} (${verdict.detail.reason})`,
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
          error: verdict.detail.reason,
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
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'buyer order failed' },
      { status: 500 },
    );
  }
}
