import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/sim/reset — {} → {dayIndex:0}; truncates run artifacts, reseeds metrics (AC-3 idempotent). */
export async function POST() {
  try {
    const db = serverAdmin();
    const { error } = await db.rpc('demo_reset');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ dayIndex: 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reset failed' }, { status: 500 });
  }
}
