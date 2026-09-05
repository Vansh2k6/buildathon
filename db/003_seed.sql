-- db/003_seed.sql — idempotent bookstore fixtures + reset/advance functions (T-13, T-14)
-- Fixture spec: TASKS.md §10 (books, ADR-019). Safe to re-run any time;
-- `demo_reset()` is the ONE implementation of "reset", shared by the SQL editor
-- and POST /api/sim/reset.
--
-- Seeded PRNG (Mulberry32, seed=304181768) generates organic metrics.
-- Organic jitter: views ±20%, CR ±15%. BK-101 anomaly on day 8 (61.2% drop).
-- BK-109 has zero orders (dead stock). All other titles get PRNG-jittered curves.
-- Deterministic across every run (ADR-008).

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
  -- "where true" satisfies pg-safeupdate, which Supabase enforces on API-role
  -- executions even inside security definer functions.
  delete from product_metrics_daily where true;

  -- Per-product metrics with seeded PRNG jitter (scripts/generate-metrics.ts, seed=304181768)
  -- Organic curves: ±20% view jitter, ±15% CR jitter. BK-101 anomaly on day 8 (61.2% drop).
  -- BK-109 always 0 orders (dead stock). Deterministic across every run (ADR-008).
  insert into product_metrics_daily (product_id, day_index, views, orders, revenue_p)
  select p.id, d.day_index, d.views, d.orders, d.orders * p.price_p
  from products p
  join (values
    ('BK-101', 1, 143, 6),
    ('BK-101', 2, 142, 6),
    ('BK-101', 3, 170, 7),
    ('BK-101', 4, 180, 7),
    ('BK-101', 5, 134, 6),
    ('BK-101', 6, 134, 6),
    ('BK-101', 7, 128, 6),
    ('BK-101', 8, 180, 3),
    ('BK-102', 1, 56, 3),
    ('BK-102', 2, 41, 2),
    ('BK-102', 3, 54, 2),
    ('BK-102', 4, 46, 2),
    ('BK-102', 5, 48, 2),
    ('BK-102', 6, 55, 2),
    ('BK-102', 7, 44, 2),
    ('BK-102', 8, 53, 2),
    ('BK-103', 1, 31, 1),
    ('BK-103', 2, 31, 1),
    ('BK-103', 3, 38, 1),
    ('BK-103', 4, 40, 1),
    ('BK-103', 5, 31, 1),
    ('BK-103', 6, 40, 1),
    ('BK-103', 7, 31, 1),
    ('BK-103', 8, 32, 1),
    ('BK-104', 1, 47, 3),
    ('BK-104', 2, 37, 2),
    ('BK-104', 3, 50, 2),
    ('BK-104', 4, 37, 2),
    ('BK-104', 5, 37, 2),
    ('BK-104', 6, 36, 2),
    ('BK-104', 7, 39, 2),
    ('BK-104', 8, 47, 3),
    ('BK-105', 1, 44, 2),
    ('BK-105', 2, 40, 2),
    ('BK-105', 3, 42, 2),
    ('BK-105', 4, 56, 2),
    ('BK-105', 5, 47, 2),
    ('BK-105', 6, 47, 2),
    ('BK-105', 7, 53, 2),
    ('BK-105', 8, 56, 2),
    ('BK-106', 1, 12, 1),
    ('BK-106', 2, 16, 1),
    ('BK-106', 3, 14, 1),
    ('BK-106', 4, 14, 1),
    ('BK-106', 5, 14, 1),
    ('BK-106', 6, 14, 1),
    ('BK-106', 7, 13, 1),
    ('BK-106', 8, 16, 1),
    ('BK-107', 1, 24, 1),
    ('BK-107', 2, 16, 1),
    ('BK-107', 3, 19, 1),
    ('BK-107', 4, 23, 1),
    ('BK-107', 5, 19, 1),
    ('BK-107', 6, 16, 1),
    ('BK-107', 7, 21, 1),
    ('BK-107', 8, 19, 1),
    ('BK-108', 1, 31, 2),
    ('BK-108', 2, 32, 2),
    ('BK-108', 3, 40, 2),
    ('BK-108', 4, 31, 2),
    ('BK-108', 5, 44, 2),
    ('BK-108', 6, 35, 2),
    ('BK-108', 7, 40, 2),
    ('BK-108', 8, 42, 2),
    ('BK-109', 1, 35, 0),
    ('BK-109', 2, 47, 0),
    ('BK-109', 3, 44, 0),
    ('BK-109', 4, 39, 0),
    ('BK-109', 5, 44, 0),
    ('BK-109', 6, 34, 0),
    ('BK-109', 7, 43, 0),
    ('BK-109', 8, 33, 0),
    ('BK-110', 1, 36, 1),
    ('BK-110', 2, 44, 2),
    ('BK-110', 3, 41, 2),
    ('BK-110', 4, 51, 2),
    ('BK-110', 5, 40, 2),
    ('BK-110', 6, 37, 2),
    ('BK-110', 7, 45, 2),
    ('BK-110', 8, 51, 2)
  ) as d(sku, day_index, views, orders) on d.sku = p.sku;

  -- restore play-state so reset returns day 0 EXACTLY (AC-3 / PHASES §12):
  -- inventory back to fixture values, merchandising state back to the
  -- curated four-title baseline the hero page starts with (AGENT.md §8):
  -- fiction hero + three dataset genres (scripts/feature-books.ts). The
  -- BK-2xx rows no-op on a fresh DB until scripts/import-books.ts runs.
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
