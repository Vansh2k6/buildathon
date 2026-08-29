/**
 * apply-seed-fix.ts — Re-applies the corrected demo_reset() SQL function to Supabase.
 * Fixes BUG-5: live function was writing revenue_p into the orders column.
 * Run: npx tsx scripts/apply-seed-fix.ts
 */

import { loadEnv } from './_env';
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Corrected demo_reset function (orders column = d.orders, NOT d.orders * price_p)
const SQL = `
create or replace function public.demo_reset()
returns smallint
language sql
security definer
set search_path = public
as $$
  truncate agent_events, agent_runs, discounts, orders, news_cache;
  -- "where true" satisfies pg-safeupdate which Supabase enforces on API-role
  -- executions even inside security definer functions.
  delete from product_metrics_daily where true;

  -- BK-101 scripted curve, days 1-8 (TASKS.md sec 10)
  -- orders = raw count (d.orders), revenue_p = d.orders * price_p
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, d.day_index, d.views, d.orders, d.orders * p.price_p
  from products p
  join (values
    ('BK-101', 1, 150, 6),
    ('BK-101', 2, 162, 7),
    ('BK-101', 3, 148, 6),
    ('BK-101', 4, 171, 7),
    ('BK-101', 5, 155, 7),
    ('BK-101', 6, 168, 7),
    ('BK-101', 7, 160, 7),
    ('BK-101', 8, 180, 3)
  ) as d(sku, day_index, views, orders) on d.sku = p.sku;

  -- all other titles flat across days 1-8; BK-109 sells nothing (dead stock)
  -- orders = 2 (raw count), revenue_p = 2 * price_p
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, g.day,
         case when p.sku = 'BK-109' then 40 else 45 end,
         case when p.sku = 'BK-109' then  0 else  2 end,
         case when p.sku = 'BK-109' then  0 else  2 * p.price_p end
  from products p
  cross join generate_series(1, 8) as g(day)
  where p.sku <> 'BK-101';

  -- restore play-state so reset returns day 0 EXACTLY (AC-3 / PHASES sec 12)
  update products p set
    inventory     = s.inventory,
    is_featured   = s.feat,
    featured_rank = s.rank_
  from (values
    ('BK-101', 42, true,  1),
    ('BK-102', 55, false, null::int),
    ('BK-103', 30, false, null::int),
    ('BK-104', 60, false, null::int),
    ('BK-105', 80, false, null::int),
    ('BK-106', 12, false, null::int),
    ('BK-107',  3, false, null::int),
    ('BK-108', 65, false, null::int),
    ('BK-109', 48, false, null::int),
    ('BK-110', 90, false, null::int),
    ('BK-215', 62, true,  4),
    ('BK-247', 14, true,  3),
    ('BK-271', 11, true,  2)
  ) as s(sku, inventory, feat, rank_)
  where p.sku = s.sku;

  insert into sim_state (id, current_day_index) values (1, 0)
  on conflict (id) do update set current_day_index = excluded.current_day_index;

  select 0::smallint;
$$;

revoke all on function public.demo_reset() from public, anon, authenticated;
grant execute on function public.demo_reset() to service_role;
`;

async function applySql(sql: string): Promise<void> {
  // Supabase exposes a /pg endpoint for raw SQL via the service role key
  // We use the pg REST endpoint available at /rest/v1/rpc only for RPCs.
  // For DDL we must use the Supabase Management API or the pg wire protocol.
  // The simplest approach without the pg wire is to call the REST endpoint with
  // the supabase_admin role via the sql edge function that Supabase provides.
  //
  // Alternative: use fetch against the Supabase postgres-meta /query endpoint
  // which is available on self-hosted only. On cloud we use the pg REST.
  //
  // The standard approach for cloud Supabase is: POST /rest/v1/rpc/... doesn't
  // support DDL. Instead we POST to the internal /pg query endpoint if available,
  // or use the Management API with a personal access token.
  //
  // Simplest available path: call a stored procedure that executes dynamic SQL.
  // We don't have one, so instead we POST directly to the Supabase db REST API
  // using the postgres-meta /query endpoint if it's exposed.

  const pgMetaUrl = SUPABASE_URL.replace('.supabase.co', '.supabase.co') + '/rest/v1/';
  
  // Try Supabase's internal query endpoint (available in some configurations)
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(30000),
  });
  
  if (!res.ok) {
    const txt = await res.text();
    console.log(`exec_sql RPC not available (${res.status}): ${txt.slice(0, 200)}`);
    console.log('\n>>> Cannot apply DDL directly via REST API.');
    console.log('>>> Please run the following SQL in your Supabase SQL Editor:');
    console.log('\n' + SQL);
    return;
  }
  
  console.log('SQL applied successfully via exec_sql RPC.');
}

async function main(): Promise<void> {
  console.log('Applying BUG-5 fix: corrected demo_reset() to Supabase...\n');

  // First, try the pg-meta or exec_sql approach
  // If that fails (most likely for cloud Supabase), output the SQL for manual apply
  try {
    await applySql(SQL);
  } catch (e: any) {
    console.log('\n>>> Direct SQL execution failed:', e.message);
    console.log('>>> Please run the following SQL in your Supabase SQL Editor:\n');
    console.log(SQL);
    return;
  }

  // Verify the fix by running demo_reset and checking orders column
  console.log('\nVerifying fix...');
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  
  const { error: rErr } = await db.rpc('demo_reset');
  if (rErr) {
    console.error('demo_reset failed after applying fix:', rErr.message);
    process.exit(1);
  }

  const { data } = await db
    .from('product_metrics_daily')
    .select('day_index, orders, revenue_p')
    .filter('day_index', 'eq', 1)
    .order('orders', { ascending: false })
    .limit(3);

  console.log('Sample rows after reset:', JSON.stringify(data));

  const bk101Day1 = data?.find((r: any) => r.orders < 100);
  if (bk101Day1 && bk101Day1.orders <= 10) {
    console.log('\n✓ BUG-5 FIXED: orders column now holds raw count, not revenue');
  } else {
    console.log('\n✗ BUG-5 still present in live function — manual SQL editor apply required');
    console.log('Run this in Supabase SQL Editor:\n');
    console.log(SQL);
  }
}

main().catch((e) => {
  console.error(e.message);
  console.log('\nRun the SQL below manually in Supabase SQL Editor:\n');
  console.log(SQL);
  process.exit(1);
});
