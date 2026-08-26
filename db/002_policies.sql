-- db/002_policies.sql — RLS everywhere; anon reads six tables; NO write policy
-- for anon anywhere (ARCHITECTURE.md §4.2). All writes go through API routes
-- holding the service-role key, which bypasses RLS server-side only.
-- Frozen after Phase 1 (PHASES.md §12): do not add an anon write policy later.

-- Enable RLS on every table, including ones anon cannot read at all
-- (no policy == denied by default for anon; service role bypasses).
alter table products              enable row level security;
alter table sim_state             enable row level security;
alter table product_metrics_daily enable row level security;
alter table merchant_policy       enable row level security;
alter table agent_runs            enable row level security;
alter table agent_events          enable row level security;
alter table discounts             enable row level security;
alter table orders                enable row level security;
alter table news_cache            enable row level security;

-- Read-only surfaces for the browser pages (storefront, audit, policy).
create policy "anon read products"        on products        for select to anon using (true);
create policy "anon read discounts"       on discounts       for select to anon using (true);
create policy "anon read agent_runs"      on agent_runs      for select to anon using (true);
create policy "anon read agent_events"    on agent_events    for select to anon using (true);
create policy "anon read orders"          on orders          for select to anon using (true);
create policy "anon read merchant_policy" on merchant_policy for select to anon using (true);

-- sim_state, product_metrics_daily, news_cache: intentionally NO anon policy.
-- The control page gets its day index via /api/sim/* (service role), not direct reads.
