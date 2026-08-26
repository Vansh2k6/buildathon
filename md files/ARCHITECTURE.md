# ARCHITECTURE — `merchant-agent`

> Scope of this document: **the shape of the code and the data.** Modules, repo layout, schema DDL, route contracts, trust boundaries, failure handling.
> Requirements → [PRD.md](PRD.md). Agent loop, prompts, thresholds, policy math → [AGENT.md](AGENT.md). Why these choices → [DECISIONS.md](DECISIONS.md). Build order → [TASKS.md](TASKS.md).

---

## 1. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| App | **Next.js (App Router)** | UI pages + API routes in one process. Server-only code stays server-only |
| Data | **Supabase (Postgres)** | Single source of truth for catalog, discounts, policy, audit. Accessed via `@supabase/supabase-js` |
| Model | **Groq API, `openai/gpt-oss-120b`** | OpenAI-compatible REST via plain `fetch` — no SDK ([ADR-017](DECISIONS.md)). Forced tool-use for schema. No orchestration framework ([ADR-002](DECISIONS.md)) |
| Payments | **Razorpay test mode** | REST via `fetch` + Basic auth. No SDK dependency required |
| External signal | **NewsAPI.org** | `/v2/everything?domains=…`, free tier, localhost-only ([ADR-018](DECISIONS.md)) |
| Runtime | Node.js on `localhost:3000` | No deployment target ([ADR-010](DECISIONS.md)) |

**Deliberately absent:** agent framework, vector store, queue, cron, WebSocket layer, ORM, state machine library. Every one of those was considered and rejected; each rejection is an ADR.

---

## 2. System shape

```
                        ┌──────────────── browser (localhost) ────────────────┐
                        │   /            /audit           /policy   /control   │
                        │ storefront   audit trail       limits    triggers    │
                        └───────┬──────────┬────────────────┬─────────┬────────┘
                                │ read     │ read           │ read    │ POST
                                ▼          ▼                ▼         ▼
  ┌───────────────────────────── Next.js server ─────────────────────────────┐
  │                                                                          │
  │  API routes ──────────────────────────────────────────────────────────┐   │
  │   POST /api/agent/run          POST /api/sim/advance-day             │   │
  │   GET  /api/catalog            POST /api/sim/reset                   │   │
  │   POST /api/agent-buyer/order  GET  /api/audit                       │   │
  │  ────────────────────────────────────────────────────────────────────┘   │
  │                                  │                                       │
  │            ┌─────────────────────▼─────────────────────┐                 │
  │            │        lib/agent/cycle.ts  (the loop)     │                 │
  │            └──┬──────────┬──────────┬──────────┬───────┘                 │
  │               │          │          │          │                         │
  │       ┌───────▼──┐  ┌────▼─────┐ ┌──▼───────┐ ┌▼────────────┐            │
  │       │ observe/ │  │ decide/  │ │ policy/  │ │ execute/    │            │
  │       │ signals  │  │ 1 LLM    │ │ PURE     │ │ razorpay +  │            │
  │       │          │  │ call     │ │ CODE     │ │ db writes   │            │
  │       └───┬──────┘  └────┬─────┘ └──┬───────┘ └──┬──────────┘            │
  │           │              │          │            │                       │
  │           │              │      ┌───▼────────────▼───┐                    │
  │           │              │      │ audit/ narrator    │                    │
  │           │              │      └─────────┬──────────┘                    │
  └───────────┼──────────────┼────────────────┼───────────────────────────────┘
              │              │                │
        ┌─────▼─────┐  ┌─────▼──────┐   ┌─────▼──────────────┐
        │ NewsAPI   │  │   Groq    │   │ Supabase Postgres  │◄── Razorpay test
        │ (untrust) │  │ API        │   │ (source of truth)  │     mode API
        └───────────┘  └────────────┘   └────────────────────┘
```

**The one structural rule:** `policy/` has no imports from `decide/`, no network client, and no Supabase write access. It is pure functions from `(proposal, policyRow, worldFacts) → verdict`. Anything that wants to execute must hold a verdict object it did not construct itself.

---

## 3. Repo layout

```
merchant-agent/
├── app/
│   ├── page.tsx                     # storefront (FR-2..FR-5) — server component, reads DB
│   ├── audit/page.tsx               # audit narrative (FR-32..FR-35)
│   ├── policy/page.tsx              # merchant limits, read-only view of the row code enforces
│   ├── control/page.tsx             # demo cockpit: Advance day, Run internal, Run external, Reset
│   └── api/
│       ├── agent/run/route.ts       # POST { trigger: 'internal' | 'external' }
│       ├── agent-buyer/order/route.ts
│       ├── catalog/route.ts         # GET  machine-readable catalog (FR-26)
│       ├── audit/route.ts           # GET  ?runId= | ?limit=
│       └── sim/
│           ├── advance-day/route.ts # POST FR-7
│           └── reset/route.ts       # POST reseed fixtures
├── lib/
│   ├── db.ts                        # supabase clients: serverAdmin() | publicRead()
│   ├── agent/
│   │   ├── cycle.ts                 # orchestrates one run; owns retry-once control flow
│   │   └── narrator.ts              # events -> human-readable narrative string
│   ├── observe/
│   │   ├── internal.ts              # conversion-drop + inventory detectors
│   │   ├── external.ts              # NewsAPI fetch + cache + fallback
│   │   └── types.ts                 # Signal union
│   ├── decide/
│   │   ├── propose.ts               # the single model call (Groq)
│   │   ├── schema.ts                # tool input_schema == the proposal contract
│   │   └── prompt.ts                # system + user prompt builders
│   ├── policy/
│   │   ├── engine.ts                # evaluate(proposal, policy, facts) -> Verdict   ← NO AI
│   │   ├── rules.ts                 # one exported pure fn per rule, each with an ID
│   │   ├── buyer.ts                 # AI-buyer rules, same Verdict type
│   │   └── types.ts
│   ├── execute/
│   │   ├── discount.ts              # razorpay + discounts table, transactional-ish
│   │   ├── featured.ts              # DB-only ranking change
│   │   ├── order.ts                 # AI-buyer order -> razorpay payable artifact
│   │   └── razorpay.ts              # thin REST client, retry + timeout
│   └── audit/log.ts                 # runs + events writer
├── db/
│   ├── 001_schema.sql
│   ├── 002_policies.sql             # RLS
│   └── 003_seed.sql                 # fixtures incl. trend-bait products
├── scripts/
│   ├── ai-buyer-sim.ts              # the "external AI shopping agent" for T3
│   └── smoke-razorpay.ts            # standalone probe, written before any app code
├── .env.local.example
├── PRD.md  ARCHITECTURE.md  AGENT.md  DECISIONS.md  TASKS.md
└── README.md                        # 10-line run instructions for judges
```

---

## 4. Data model

`db/001_schema.sql`. Money is **integer paise** everywhere (`_p` suffix) — no floats touch a price. Simulated time is an integer day index, not a timestamp ([ADR-004](DECISIONS.md)).

```sql
-- ---------- catalog ----------
create table products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  description   text not null,
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
```

### 4.1 Notable constraints and why they exist

| Constraint | Protects |
| --- | --- |
| `one_active_discount_per_product` partial unique index | Makes double-discounting a **database** error, not a policy nicety. Belt to the policy engine's braces |
| `agent_events (run_id, seq)` unique | Ordered narrative; makes replay deterministic |
| `check (id = 1)` on `sim_state`, `merchant_policy` | Singleton rows; no ambiguity about which limits are in force |
| Integer paise + `cost_p` | `min_margin_pct` is computable exactly, in code, with no rounding argument |
| `run_status = 'rejected'` is a **terminal success state**, not an error | FR-33: rejection is a first-class outcome the audit page displays proudly |

### 4.2 RLS (`002_policies.sql`)

Browser pages read with the **anon** key. Every table gets `enable row level security` plus a `select`-only policy for `anon` on `products`, `discounts`, `agent_runs`, `agent_events`, `orders`, `merchant_policy`. **No insert/update/delete policy for `anon` anywhere.** All writes go through API routes using the service-role key, which never leaves the server (NFR-4).

---

## 5. Route contracts

| Route | Method | Auth | Contract |
| --- | --- | --- | --- |
| `/api/agent/run` | POST | local | `{trigger:'internal'\|'external'}` → `{runId, status, narrative}` |
| `/api/sim/advance-day` | POST | local | `{}` → `{dayIndex}` |
| `/api/sim/reset` | POST | local | `{}` → `{dayIndex:0}`; truncates runs/events/discounts/orders, re-seeds metrics |
| `/api/catalog` | GET | none | agent-facing catalog, §5.1 |
| `/api/agent-buyer/order` | POST | `X-Agent-Key` header (static, demo) | §5.2 |
| `/api/audit` | GET | none | `?limit=20` → runs with events, newest first |

All routes: `export const dynamic = 'force-dynamic'` and `runtime = 'nodejs'`. No caching anywhere — a cached storefront or catalog would silently break FR-5.

### 5.1 `GET /api/catalog` — the machine-readable surface (FR-26)

This is the contract an external AI shopping agent codes against. Stable, self-describing, effective prices already applied.

```json
{
  "merchant": { "name": "Demo Merchant", "currency": "INR" },
  "generated_at": "2026-08-23T18:30:00.000Z",
  "policy_summary": { "max_qty_per_sku": 5, "max_order_value_inr": 25000 },
  "products": [
    {
      "sku": "TEA-001",
      "name": "Assam Breakfast Tea 250g",
      "category": "beverages",
      "description": "...",
      "list_price_inr": 499,
      "effective_price_inr": 424,
      "discount_pct": 15,
      "discount_reason": "trend:matched-headline",
      "in_stock": true,
      "available_qty": 42,
      "featured": true
    }
  ],
  "order_endpoint": "/api/agent-buyer/order"
}
```

`policy_summary` is published deliberately: a well-behaved buying agent should be able to see the limits *before* it composes an order. Publishing them costs nothing, because enforcement does not depend on the buyer respecting them.

### 5.2 `POST /api/agent-buyer/order`

```jsonc
// request
{ "buyer_ref": "sim-agent-01", "items": [{ "sku": "TEA-001", "qty": 2 }] }

// 200 — approved
{ "status": "approved", "order_id": "…", "total_inr": 848,
  "razorpay": { "order_id": "order_…", "payment_link": "https://rzp.io/i/…" },
  "run_id": "…" }

// 409 — rejected by the same engine that judges the agent
{ "status": "rejected", "rule": "BUYER_MAX_QTY", "detail":
  { "requested": 9, "limit": 5, "sku": "TEA-001" }, "run_id": "…" }
```

Returning the **rule ID** rather than prose (FR-29) is what makes this consumable by a machine, and is the same verdict object the audit page renders for humans. One engine, two audiences.

---

## 6. External integrations

### 6.1 Groq (OpenAI-compatible)

Single call, forced tool-use so the response *cannot* be prose:

```ts
const res = await fetch(`${process.env.GROQ_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: process.env.GROQ_MODEL,                   // 'openai/gpt-oss-120b'
    max_tokens: 4000,                                // gpt-oss reasoning shares this budget
    temperature: 0,                                  // NFR-1 repeatability
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },    // lib/decide/prompt.ts
      { role: 'user', content: buildUserPrompt(signal, catalog) },
    ],
    tools: [PROPOSE_ACTION_TOOL],                    // lib/decide/schema.ts
    tool_choice: { type: 'function', function: { name: 'propose_action' } },
  }),
});
// proposal JSON lives at res.choices[0].message.tool_calls[0].function.arguments
```

No SDK — one `fetch` call keeps [ADR-002](DECISIONS.md)'s no-abstraction stance ([ADR-017](DECISIONS.md)). Timeout 20s, one network-level retry on 429/5xx, then fail the cycle closed (NFR-3). The free tier caps tokens/min at 8k, so the cycle makes one small call and the probe spaces its legs. Schema validation on `tool_calls[0].function.arguments` before it is allowed to become a `Proposal`. The prompt text, the schema, and the retry semantics are specified in [AGENT.md §4–5](AGENT.md) — they are agent design, not architecture.

### 6.2 Razorpay (test mode) — **highest-risk integration**

Thin REST client, Basic auth `KEY_ID:KEY_SECRET`, 10s timeout, no SDK.

| Concern | Position |
| --- | --- |
| **Orders** — `POST /v1/orders` | Well-understood. Used for AI-buyer orders |
| **Payment Links** — `POST /v1/payment_links` | Well-understood, amount set by us. Gives the AI buyer a real payable artifact |
| **Offers** — programmatic creation | ✗ **Dead — probe-verified 2026-08-26:** `POST /v1/offers` → HTTP 405; offers are dashboard-created only ([ADR-009](DECISIONS.md)) |

**Design that survives either answer.** Postgres is the source of truth for discount state; the storefront and `/api/catalog` read `discounts`, never Razorpay. Razorpay is where the discount becomes *real money behaviour at checkout*. Three representations, tried in order, recorded in `discounts.razorpay_ref_kind`:

1. `offer` — dead: programmatic creation does not exist (HTTP 405, [ADR-009](DECISIONS.md)); kept in the enum for honest labelling.
2. `payment_link` — pre-create offers in the test dashboard for the tiers policy can approve (5/10/15/20%) and reference the matching id; checkout artifacts are created at the discounted amount via Payment Links. **This is the primary path — probe-verified 2026-08-26.**
3. `local_only` — discount honoured in our own pricing math with the Razorpay call logged as unavailable. Demo still complete, and honestly labelled.

The fallback ladder is a *stated* architectural position, not a hedge discovered at 3am. `scripts/smoke-razorpay.ts` is written **before** any app code precisely to collapse this uncertainty early ([TASKS.md](TASKS.md) T-02).

### 6.3 NewsAPI.org

`GET /v2/everything?domains=livemint.com,moneycontrol.com,indiatoday.in&language=en&sortBy=publishedAt&pageSize=20` — 8s timeout, response persisted to `news_cache` with `source: 'live'`. Endpoint chosen by probe ([ADR-018](DECISIONS.md)): the free plan returns zero results for `top-headlines?country=in` (US-only geo) and years-stale results for `sources=`-scoped Indian feeds; these three domains index within hours.

Two known free-tier properties, both accepted: article availability can lag, and requests must originate from localhost. The second is satisfied for free by the no-deploy decision (NFR-6). On timeout / empty / non-200 → the pre-written fallback headline is used, `source: 'fallback'`, and the audit narrative says so in plain words (FR-9).

**Trust boundary:** headline text is third-party untrusted input that reaches an LLM prompt. It is fenced as data in the prompt, and — the actual protection — it can only ever influence a *proposal*, which is then judged by code the headline cannot reach (NFR-5). See [AGENT.md §6](AGENT.md).

---

## 7. Control flow of one cycle

`lib/agent/cycle.ts`. Retry control lives here, not in the model and not in the policy engine.

```
runCycle(trigger)
 ├─ 1  createRun(trigger, dayIndex)                      → run_id
 ├─ 2  signal = observe[trigger](db)                     → log 'observe'
 │        └─ if none: status='no_signal'; return          (a boring answer is a valid answer)
 ├─ 3  proposal = propose(signal, catalog)                → log 'decide'
 │        └─ schema invalid → status='failed'; return     (NFR-3 fail closed)
 ├─ 4  verdict = policy.evaluate(proposal, policyRow, facts)   → log 'policy'
 │        ├─ APPROVED → 6
 │        └─ REJECTED → 5
 ├─ 5  retryOnce:  proposal2 = propose(signal, catalog, violation)
 │        verdict2 = policy.evaluate(proposal2, …)
 │        ├─ APPROVED → 6
 │        └─ REJECTED → status='rejected'; HARD STOP, nothing executes
 ├─ 6  result = execute(verdict.approvedAction)           → log 'execute'
 │        └─ throws → status='failed', compensate, log    (§8)
 └─ 7  narrative = narrate(events); status='executed'     → log 'result'
```

Properties worth naming, because they are the demo's substance:

- **The retry budget is a constant in code (`MAX_RETRIES = 1`)**, not a model decision. There is no loop the model can extend.
- **`policy.evaluate` is called on every path**, including the retry and including the AI buyer. No branch reaches `execute` without a verdict object.
- **`observe` runs before `decide`**, so the model never chooses what to look at — it only reasons about what already fired.

---

## 8. Failure handling

| Failure | Behaviour | Surface |
| --- | --- | --- |
| No signal fires | `status='no_signal'`, no LLM call spent | Audit shows "looked, found nothing" |
| Groq timeout / 429 (free-tier TPM is 8k/min) | 1 retry, then `status='failed'` | Audit `level='error'` |
| Model returns off-schema input | Rejected before becoming a `Proposal`; `status='failed'` | Audit shows the raw payload |
| Policy rejects twice | `status='rejected'` — **terminal, expected, displayed** | Audit `level='block'` |
| Razorpay call fails | Discount row written `status='failed'`; no `active` row created | Audit says which representation was attempted |
| Razorpay succeeds, DB write fails | Compensate: attempt cancel/log the Razorpay id into `agent_events.payload` so it is never orphaned silently | Audit `level='warn'` |
| NewsAPI unusable | Fallback headline, `source='fallback'`, cycle continues | Audit states the source |

**Consistency stance.** Supabase gives no cross-service transaction, so ordering is deliberate: call Razorpay **first**, write local state **second**, and treat a failed local write as the compensating case. This means the worst outcome is an unused test-mode artifact, never a discount the storefront shows but checkout does not honour (FR-24).

---

## 9. Configuration

`.env.local.example` — all server-only unless prefixed `NEXT_PUBLIC_`.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # read-only via RLS; safe in the bundle
SUPABASE_SERVICE_ROLE_KEY=            # server only. never imported into app/ components
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-120b
NEWSAPI_KEY=
RAZORPAY_KEY_ID=rzp_test_…
RAZORPAY_KEY_SECRET=
AGENT_BUYER_KEY=demo-agent-key        # X-Agent-Key for /api/agent-buyer/order
```

Guardrail: `lib/db.ts` exports `serverAdmin()` which throws if `typeof window !== 'undefined'`. Cheap, and it makes NFR-4 a runtime property rather than a code-review promise.

---

## 10. What the judges can inspect

Mapped so the walkthrough is fast:

| Claim in the pitch | File that proves it |
| --- | --- |
| "The model never overrides its own limit" | `lib/policy/engine.ts` + `rules.ts` — no imports from `decide/`, no network, no AI |
| "One LLM call, structured output" | `lib/decide/propose.ts` — one `messages.create`, `tool_choice` forced |
| "Limits are the merchant's, not the code's" | `merchant_policy` row + `/policy` page |
| "Same gate for the AI buyer" | `app/api/agent-buyer/order/route.ts` imports the same `policy/` module |
| "Every action explainable" | `agent_runs` + `agent_events` → `/audit` |
| "Storefront is not a mock" | `app/page.tsx` reads Supabase; no fixture JSON in the component |
