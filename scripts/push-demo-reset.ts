/**
 * push-demo-reset.ts — Pushes the corrected demo_reset() SQL to Supabase
 * using the pg-meta /query endpoint (available on Supabase cloud, service_role).
 * Run: npx tsx scripts/push-demo-reset.ts
 */

import { loadEnv } from './_env';
loadEnv();

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PROJECT_REF    = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const FIXED_SQL = `
create or replace function public.demo_reset()
returns smallint
language sql
security definer
set search_path = public
as $$
  truncate agent_events, agent_runs, discounts, orders, news_cache;
  delete from product_metrics_daily where true;

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

  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, g.day,
         case when p.sku = 'BK-109' then 40 else 45 end,
         case when p.sku = 'BK-109' then  0 else  2 end,
         case when p.sku = 'BK-109' then  0 else  2 * p.price_p end
  from products p
  cross join generate_series(1, 8) as g(day)
  where p.sku <> 'BK-101';

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

async function tryEndpoint(url: string, headers: Record<string,string>, body: string): Promise<{ok: boolean; text: string}> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch (e: any) {
    return { ok: false, text: e.message };
  }
}

async function main() {
  console.log(`Project ref: ${PROJECT_REF}`);
  console.log('Trying Supabase DDL via pg-meta /query endpoint...\n');

  const authHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
  };

  // Attempt 1: pg-meta query endpoint (Supabase internal, not always exposed)
  const pgMetaResult = await tryEndpoint(
    `${SUPABASE_URL}/pg/query`,
    authHeaders,
    JSON.stringify({ query: FIXED_SQL })
  );
  console.log(`/pg/query → ${pgMetaResult.ok ? 'OK' : 'FAIL'}: ${pgMetaResult.text.slice(0, 200)}`);

  if (pgMetaResult.ok) {
    console.log('\n✓ DDL applied via pg-meta!');
    await verifyFix();
    return;
  }

  // Attempt 2: postgres-meta endpoint at /rest/v1/
  const pgRestResult = await tryEndpoint(
    `${SUPABASE_URL}/rest/v1/`,
    { ...authHeaders, 'X-Client-Info': 'supabase-js/2.0.0', 'Prefer': 'return=minimal' },
    JSON.stringify({ query: FIXED_SQL })
  );
  console.log(`/rest/v1/ POST query → ${pgRestResult.ok ? 'OK' : 'FAIL'}: ${pgRestResult.text.slice(0, 200)}`);

  console.log('\n--- DDL cannot be applied via REST API automatically ---');
  console.log('Please apply the SQL manually in the Supabase SQL Editor:');
  console.log('URL: https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new');
  console.log('\nSQL to run:\n');
  console.log(FIXED_SQL);
  console.log('\n--- After applying, run: npx tsx scripts/verify-bug5.ts ---');
}

async function verifyFix() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await db.rpc('demo_reset');
  const { data } = await db
    .from('product_metrics_daily')
    .select('day_index, orders, revenue_p')
    .order('day_index')
    .limit(3);
  console.log('Verification rows after reset:', JSON.stringify(data));
  const maxOrders = Math.max(...(data ?? []).map((r: any) => r.orders));
  if (maxOrders <= 10) {
    console.log('✓ BUG-5 FIXED: orders column holds raw counts (max=' + maxOrders + ')');
  } else {
    console.log('✗ BUG-5 still present (max orders=' + maxOrders + ')');
  }
}

main().catch(console.error);
