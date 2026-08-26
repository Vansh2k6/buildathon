-- db/003_seed.sql — idempotent demo fixtures + reset/advance functions (T-13, T-14)
-- Fixture spec: TASKS.md §10. Safe to re-run any time; `demo_reset()` is the ONE
-- implementation of "reset", shared by the SQL editor and POST /api/sim/reset.
--
-- Exactly one signal may fire on day 8: TEA-001's conversion drop
-- (baseline CR ≈ 4.2% → 1.67%, drop_rel ≈ 60% ≥ 30% threshold, views 180 ≥ 50).
-- Every other SKU holds a flat curve; MUG-009 has zero orders throughout so the
-- dead-stock detector has a target on days the drop is not scheduled.

insert into products (sku, name, description, category, price_p, cost_p, inventory) values
  ('TEA-001', 'Assam Breakfast Tea 250g',       'Strong, malty breakfast tea from a single Assam estate.',   'beverages',     49900, 30000, 42),  -- T1 target
  ('RAIN-002','Compact Monsoon Umbrella',       'Three-fold windproof umbrella that fits a laptop bag.',      'outdoor',       64900, 30000, 55),  -- trend bait: monsoon
  ('JRSY-003','Team India Cricket Jersey',      'Official-fit home jersey in breathable polyester mesh.',     'apparel',      129900, 70000, 60),  -- trend bait: cricket
  ('OIL-004', 'Cold-Pressed Groundnut Oil 1L',  'Wood-pressed, unrefined groundnut cooking oil.',             'grocery',       99900, 75000, 30),  -- margin-floor demo
  ('AIRP-005','HEPA Room Air Purifier',         'True-H13 HEPA purifier for rooms up to 400 sq ft.',          'appliances',   849900,600000, 12),  -- trend bait: AQI
  ('SUNS-006','SPF50 Sunscreen 100ml',          'Broad-spectrum SPF50 PA++++ gel sunscreen.',                 'personal care', 59900, 28000, 80),  -- trend bait: heatwave
  ('BOTL-007','Insulated Steel Bottle 750ml',   'Double-walled vacuum bottle, 24h cold.',                     'outdoor',       89900, 45000,  3),  -- STOCK_FLOOR demo (inventory < 5)
  ('NOTE-008','A5 Dotted Notebook',             '160-page dotted notebook, 120 gsm paper.',                   'stationery',    29900, 12000, 65),
  ('MUG-009', 'Ceramic Mug 350ml',              'Glazed stoneware mug, dishwasher safe.',                     'homeware',      39900, 18000, 48),  -- dead stock (0 orders)
  ('SOCK-010','Cotton Crew Socks 3-pack',       'Combed cotton crew socks with cushioned sole.',              'apparel',       34900, 15000, 90)
on conflict (sku) do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category,
  price_p     = excluded.price_p,
  cost_p      = excluded.cost_p,
  inventory   = excluded.inventory;

-- Merchant limits: the documented defaults (AGENT.md §5.1). The merchant owns
-- this row — R4's honest lever is editing max_discount_pct HERE, not the prompt.
insert into merchant_policy (id) values (1)
on conflict (id) do nothing;

create or replace function public.demo_reset()
returns smallint
language sql
security definer
set search_path = public
as $$
  -- effects of past runs go first (FK order handled by listing them together)
  truncate agent_events, agent_runs, discounts, orders, news_cache;
  delete from product_metrics_daily;

  -- TEA-001 scripted curve, days 1–8 (TASKS.md §10)
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, d.day_index, d.views, d.orders, d.orders * p.price_p
  from products p
  join (values
    ('TEA-001', 1, 150, 6),
    ('TEA-001', 2, 162, 7),
    ('TEA-001', 3, 148, 6),
    ('TEA-001', 4, 171, 7),
    ('TEA-001', 5, 155, 7),
    ('TEA-001', 6, 168, 7),
    ('TEA-001', 7, 160, 7),
    ('TEA-001', 8, 180, 3)
  ) as d(sku, day_index, views, orders) on d.sku = p.sku;

  -- all other SKUs flat across days 1–8; MUG-009 sells nothing (dead stock)
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, g.day,
         case when p.sku = 'MUG-009' then 40 else 45 end,
         case when p.sku = 'MUG-009' then  0 else  2 end,
         case when p.sku = 'MUG-009' then  0 else  2 * p.price_p end
  from products p
  cross join generate_series(1, 8) as g(day)
  where p.sku <> 'TEA-001';

  insert into sim_state (id, current_day_index) values (1, 0)
  on conflict (id) do update set current_day_index = excluded.current_day_index;

  select 0::smallint;
$$;

revoke all on function public.demo_reset() from public, anon, authenticated;
grant execute on function public.demo_reset() to service_role;

create or replace function public.demo_advance_day()
returns integer
language sql
security definer
set search_path = public
as $$
  update sim_state set current_day_index = current_day_index + 1 where id = 1
  returning current_day_index;
$$;

revoke all on function public.demo_advance_day() from public, anon, authenticated;
grant execute on function public.demo_advance_day() to service_role;

-- seed initial state now
select public.demo_reset();
