-- db/001_schema.sql — run once in the Supabase SQL editor (T-12)
-- Source of truth: ARCHITECTURE.md §4. Money is integer paise (_p); simulated
-- time is an integer day index (ADR-004). Do not rename columns casually —
-- lib/policy, the audit narrator, and /api/catalog all cite these names.

-- ---------- catalog ----------
create table products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  description   text not null,
  author        text not null default '',
  cover_url     text,
  category      text not null,
  price_p       integer not null check (price_p > 0),      -- list price, paise
  cost_p        integer not null check (cost_p >= 0),      -- unit cost -> margin floor
  inventory     integer not null default 0 check (inventory >= 0),
  is_featured   boolean not null default false,
  featured_rank integer,                                   -- 1 = leftmost slot
  created_at    timestamptz not null default now()
);

-- ---------- simulated time & metrics ----------
create table sim_state (
  id                integer primary key default 1 check (id = 1),
  current_day_index integer not null default 0
);

create table product_metrics_daily (
  product_id  uuid not null references products(id) on delete cascade,
  day_index   integer not null,
  views       integer not null default 0,
  orders      integer not null default 0,
  revenue_p   integer not null default 0,
  primary key (product_id, day_index)
);

-- ---------- merchant limits: the row that outranks the model ----------
create table merchant_policy (
  id                       integer primary key default 1 check (id = 1),
  max_discount_pct         integer not null default 20,
  min_margin_pct           integer not null default 15,
  max_active_discounts     integer not null default 3,
  max_actions_per_day      integer not null default 5,
  daily_discount_budget_p  integer not null default 500000,   -- ₹5,000 projected give-away
  max_featured_slots       integer not null default 4,
  cooldown_days            integer not null default 1,
  blocked_categories       text[]  not null default '{}',
  buyer_max_order_p        integer not null default 2500000,  -- ₹25,000
  buyer_max_qty_per_sku    integer not null default 5,
  updated_at               timestamptz not null default now()
);

-- ---------- agent output ----------
create type run_trigger as enum ('internal','external','ai_buyer');
create type run_status  as enum ('running','executed','rejected','failed','no_signal');

create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  trigger        run_trigger not null,
  day_index      integer not null,
  status         run_status  not null default 'running',
  signal         jsonb,          -- what fired, with the numbers
  proposal       jsonb,          -- model output, attempt 1
  proposal_retry jsonb,          -- model output, attempt 2 (null if none)
  verdict        jsonb,          -- final verdict incl. rule id
  execution      jsonb,          -- razorpay ids, rows touched
  retry_count    smallint not null default 0,
  narrative      text,           -- rendered story, what the audit page shows
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create type phase_t as enum ('observe','decide','policy','execute','result');

create table agent_events (
  id         bigserial primary key,
  run_id     uuid not null references agent_runs(id) on delete cascade,
  seq        integer not null,
  phase      phase_t not null,
  level      text not null default 'info',   -- info | warn | block | error
  message    text not null,                  -- human-readable, no JSON required
  payload    jsonb,                           -- raw, behind a UI toggle
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

-- ---------- effects ----------
create type discount_status as enum ('active','expired','reverted','failed');

create table discounts (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id),
  pct                integer not null check (pct between 1 and 90),
  status             discount_status not null default 'active',
  run_id             uuid references agent_runs(id),
  razorpay_offer_id  text,
  razorpay_ref_kind  text,        -- 'offer' | 'payment_link' | 'local_only'  (see §6.2)
  created_day_index  integer not null,
  expires_day_index  integer,
  created_at         timestamptz not null default now()
);
create unique index one_active_discount_per_product
  on discounts (product_id) where status = 'active';

create table orders (
  id                       uuid primary key default gen_random_uuid(),
  source                   run_trigger not null,     -- 'ai_buyer' for T3
  buyer_ref                text,                     -- opaque agent identifier
  items                    jsonb not null,           -- [{sku, qty, unit_price_p, discount_pct}]
  subtotal_p               integer not null,
  discount_p               integer not null default 0,
  total_p                  integer not null,
  razorpay_order_id        text,
  razorpay_payment_link_id text,
  razorpay_short_url       text,
  status                   text not null default 'created',
  run_id                   uuid references agent_runs(id),
  created_at               timestamptz not null default now()
);

-- ---------- external signal provenance ----------
create table news_cache (
  id         uuid primary key default gen_random_uuid(),
  fetched_at timestamptz not null default now(),
  query      text not null,
  source     text not null,      -- 'live' | 'fallback'
  raw        jsonb,              -- full response, for post-hoc explanation (FR-10)
  used_title text
);
