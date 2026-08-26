-- db/003_seed.sql — idempotent bookstore fixtures + reset/advance functions (T-13, T-14)
-- Fixture spec: TASKS.md §10 (books, ADR-019). Safe to re-run any time;
-- `demo_reset()` is the ONE implementation of "reset", shared by the SQL editor
-- and POST /api/sim/reset.
--
-- Exactly one signal may fire on day 8: BK-101's conversion drop
-- (baseline CR ≈ 4.2% → 1.67%, drop_rel ≈ 60% ≥ 30% threshold, views 180 ≥ 50).
-- Every other title holds a flat curve; BK-109 has zero orders throughout so the
-- dead-stock detector has a target on days the drop is not scheduled.

insert into products (sku, name, author, description, category, price_p, cost_p, inventory) values
  ('BK-101', 'The Assam Tea Planter''s Daughter', 'R. Baruah',    'A family saga of love and land on a colonial Assam tea estate.', 'fiction',    49900, 30000, 42),  -- T1 target
  ('BK-102', 'Monsoon Notes: A Kerala Travelogue', 'A. Menon',    'A season of rain, backwaters and small kindnesses.',             'travel',     64900, 30000, 55),  -- trend bait: monsoon
  ('BK-103', 'Breathe Easy: Indoor Air and Health', 'Dr. S. Rao', 'Imported edition. What AQI means inside your home.',             'wellness',   99900, 75000, 30),  -- margin-floor demo + AQI bait
  ('BK-104', 'The Republic of Cricket',            'V. Iyer',     'How one sport came to run the world''s largest democracy.',      'sports',    129900, 70000, 60),  -- trend bait: cricket
  ('BK-105', 'The Heatwave Protocol',              'N. Kapoor',   'A Delhi summer breaks all records - and then the grid.',         'thriller',   59900, 28000, 80),  -- trend bait: heatwave
  ('BK-106', 'Atlas of the Indian Ocean',          'collectif',   'Gift edition. Charts, trade winds and monsoon routes.',          'gift',      849900,600000, 12),  -- near buyer order cap
  ('BK-107', 'Field Guide to the Western Ghats, 2nd ed.', 'K. Bhat','Out-of-print naturalist classic, remaining stock only.',        'nature',     89900, 45000,  3),  -- STOCK_FLOOR demo (inventory < 5)
  ('BK-108', 'A5 Dotted Reading Journal',          'Pagemill Press','160 dotted pages, ribbon marker, lay-flat binding.',          'stationery', 29900, 12000, 65),
  ('BK-109', 'Selected Verses: Volume III',        'various',     'A slim anthology nobody has ordered yet.',                       'poetry',     39900, 18000, 48),  -- dead stock (0 orders)
  ('BK-110', 'Best of Indian Short Stories',       'anthology',   'Thirty stories, one paperback, zero risk.',                      'fiction',    34900, 15000, 90)
on conflict (sku) do update set
  name        = excluded.name,
  author      = excluded.author,
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

  -- BK-101 scripted curve, days 1–8 (TASKS.md §10)
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

  -- all other titles flat across days 1–8; BK-109 sells nothing (dead stock)
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, g.day,
         case when p.sku = 'BK-109' then 40 else 45 end,
         case when p.sku = 'BK-109' then  0 else  2 end,
         case when p.sku = 'BK-109' then  0 else  2 * p.price_p end
  from products p
  cross join generate_series(1, 8) as g(day)
  where p.sku <> 'BK-101';

  -- restore play-state so reset returns day 0 EXACTLY (AC-3 / PHASES §12):
  -- inventory back to fixture values, merchandising state back to the
  -- two-title baseline the hero page starts with (AGENT.md §8).
  update products p set
    inventory     = s.inventory,
    is_featured   = s.feat,
    featured_rank = s.rank_
  from (values
    ('BK-101', 42, true,  1),
    ('BK-102', 55, true,  2),
    ('BK-103', 30, false, null::int),
    ('BK-104', 60, false, null::int),
    ('BK-105', 80, false, null::int),
    ('BK-106', 12, false, null::int),
    ('BK-107',  3, false, null::int),
    ('BK-108', 65, false, null::int),
    ('BK-109', 48, false, null::int),
    ('BK-110', 90, false, null::int)
  ) as s(sku, inventory, feat, rank_)
  where p.sku = s.sku;

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
