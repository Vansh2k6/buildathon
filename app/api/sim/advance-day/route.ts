import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/sim/advance-day — {} → {dayIndex}; moves simulated time forward exactly one day (FR-7). */
export async function POST() {
  try {
    const { data, error } = await serverAdmin().rpc('demo_advance_day');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ dayIndex: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'advance failed' }, { status: 500 });
  }
}
