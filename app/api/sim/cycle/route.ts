import { NextResponse } from 'next/server';
import { runAgentCycle } from '@/lib/agent/cycle';
import type { RunTrigger } from '@/lib/audit/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/sim/cycle — { trigger?: 'internal' | 'external' } → RunResult */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const trigger: RunTrigger = body.trigger === 'external' ? 'external' : 'internal';

    const result = await runAgentCycle(trigger);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'agent cycle failed' },
      { status: 500 },
    );
  }
}
