import { NextResponse } from 'next/server';
import { serverAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/sim/state → { dayIndex: number } */
export async function GET() {
  try {
    const { data, error } = await serverAdmin()
      .from('sim_state')
      .select('current_day_index')
      .eq('id', 1)
      .single();

    if (error || !data) {
      return NextResponse.json({ dayIndex: 0 });
    }

    return NextResponse.json({ dayIndex: data.current_day_index });
  } catch (e) {
    return NextResponse.json({ dayIndex: 0 });
  }
}
