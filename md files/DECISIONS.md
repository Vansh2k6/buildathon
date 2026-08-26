# DECISIONS — architecture decision log

> Scope of this document: **why the system is shaped the way it is**, including what was considered and rejected. One entry per decision, newest concerns first where they matter.
> Nothing here restates *what* is built ([PRD.md](PRD.md)), *how the code is arranged* ([ARCHITECTURE.md](ARCHITECTURE.md)), or *how the agent behaves* ([AGENT.md](AGENT.md)). This file is rationale only.

**Status legend:** `accepted` · `accepted, verification pending` · `superseded`

---

## Summary: where we deliberately did not use AI

Buildathon judging usually asks this directly, so the answer is collected here rather than scattered.

| Component | Implementation | Why not AI |
| --- | --- | --- |
| **Policy engine** | Pure functions over a merchant-owned row ([ADR-003](#adr-003)) | A model that can approve its own spending limit has no limit. Determinism *is* the trust |
| **Signal detection** | Arithmetic thresholds on Postgres data ([ADR-012](#adr-012)) | Conversion-rate drop is a subtraction, not a judgement. Also: no model call spent on quiet days |
| **Retry control** | `MAX_RETRIES = 1` constant ([ADR-013](#adr-013)) | The bound must not be negotiable by the thing being bounded |
| **Money arithmetic** | Integer paise ([ADR-014](#adr-014)) | Prices must be exact and identical across storefront, policy, and payment provider |
| **Effective-price computation** | SQL + code, single source of truth | A price a model computed is a price nobody can audit |

Where AI **is** used, and only here: judging what a fired signal warrants, and judging whether a headline genuinely relates to a product. Both are open-ended judgement calls with no closed-form answer. That is the correct and complete use of the model in this system.

---

<a id="adr-001"></a>
## ADR-001 — Bounded autonomy is the product primitive
**Status:** accepted

**Context.** Two adoptable-looking options exist and both fail. A fully autonomous pricing agent is unfundable: no merchant grants spending authority to a system that can revise its own authority. A rules engine with no model is just the manual process with extra steps — it cannot react to a signal nobody wrote a rule for.

**Decision.** Build the split explicitly: the model *proposes*, deterministic code *decides whether the proposal may act*, and every cycle is logged as a readable narrative. Make the boundary a visible artifact of the system, not a claim in a pitch.

**Consequences.** The demo's centrepiece becomes a *rejection* rather than a clever action — the one moment that cannot be faked with a scripted output. Every subsequent decision in this log is a defence of that boundary. Cost: the agent is less impressive in isolation and more trustworthy in context, which is the trade we want.

**Rejected.** (a) Autonomous agent with a "confirm" button — that is a notification system, and the merchant is still the decision-maker. (b) Rules-only — nothing to demo.

---

<a id="adr-002"></a>
## ADR-002 — No orchestration framework
**Status:** accepted (replaces an earlier LangGraph-based plan)

**Context.** The original stack included LangGraph. Reviewing it against what the system actually needs: a linear five-phase pass with one conditional retry. That is `lib/agent/cycle.ts` — roughly 80 lines of straight-line TypeScript with an `if`.

**Decision.** Direct LLM API calls, no orchestration framework, no state-machine library.

**Consequences.** Removes an unjustified dependency, a state abstraction that would need explaining on camera, and a class of debugging where a framework's control flow hides ours. The retry rule becomes a constant a judge can read in one line instead of a graph edge. Cost: if this grew multi-step or needed durable resumption, we would reintroduce something like it — and we would then have a stated reason.

**Rejected.** LangGraph, and any "agent framework" whose value here would have been vocabulary rather than capability.

---

<a id="adr-003"></a>
## ADR-003 — The policy engine is deterministic plain code
**Status:** accepted · *the load-bearing decision in this log*

**Context.** The proposal must be checked against merchant limits. Three implementations were possible: put the limits in the prompt and trust the model; have a second model review the first; or write the check in code.

**Decision.** Pure functions in `lib/policy/`. No model call, no network call, no write access. Limits are read from a `merchant_policy` database row the merchant owns — not from constants in the agent's code path. The engine returns a `Verdict` object, and `execute` accepts nothing else.

**Consequences.** The claim "the model never overrides its own spending limit" becomes checkable by reading one directory: no imports from `decide/`, no HTTP client, no model SDK. Additional properties that fall out for free: prompt injection is contained ([AGENT.md §6](AGENT.md)), verdicts are reproducible across recording takes, and the same module can gate the AI buyer ([ADR-011](#adr-011)). Cost: the engine cannot handle a case nobody encoded — correct, since an unencoded case *should* be a rejection.

**Rejected.** (a) Limits in the prompt — makes compliance a probability. (b) LLM-as-judge reviewer — two models agreeing is not a limit, it is a correlation, and it doubles latency and cost for weaker guarantees.

---

<a id="adr-004"></a>
## ADR-004 — Simulated time is an integer day index advanced by hand
**Status:** accepted

**Context.** The conversion-drop scenario must fire identically across every recording take. Wall-clock time and cron cannot deliver that, and a live shop with real traffic does not exist.

**Decision.** `sim_state.current_day_index` — an integer, moved forward only by an explicit *Advance day* action. `product_metrics_daily` is keyed on that index with hand-scripted fixtures.

**Consequences.** Retakes are free; a reset returns to day 0 and replays exactly. Trigger timing becomes a demo decision instead of a waiting game, and no scheduler exists to fail on camera. Cost: the internal signal is scripted, which the video states plainly — the *detector*, *decision*, *policy check*, and *execution* around it are all real code.

**Rejected.** (a) Real timestamps with a cron — unreproducible, and adds a background process to debug. (b) Random traffic generator — noise makes threshold-crossing unpredictable, which is the one thing we need predictable.

---

<a id="adr-005"></a>
## ADR-005 — One model call, forced tool-use, temperature 0
**Status:** accepted

**Context.** The decision step needs schema-valid structured output, reproducibly, without an orchestration layer.

**Decision.** A single chat-completions call with `tool_choice` forcing `propose_action` and `temperature: 0`. Response is re-validated in code; off-schema output fails the cycle closed.

**Consequences.** Prose output is structurally impossible rather than filtered after the fact, so no parser, no retry-on-malformed loop, no regex. Temperature 0 keeps retakes consistent (NFR-1). Cost: at temperature 0 the model is less likely to surprise us with a creative match in T2 — acceptable, since a reproducible demo beats an occasionally-brilliant one.

**Rejected.** (a) Free-text output plus JSON extraction — a whole failure class for no benefit. (b) JSON mode without a tool schema — weaker guarantees on nested fields like `trend_match`. (c) Multiple specialised calls (one to match, one to price) — more latency, more failure surface, and it dilutes "one decision per cycle".

---

<a id="adr-006"></a>
## ADR-006 — The merchant's numeric limits are withheld from the first prompt
**Status:** accepted · *non-obvious, and worth explaining on camera*

**Context.** Putting `max_discount_pct = 20` in the prompt would make the model propose ≤20% nearly every time. Tempting: fewer rejections, smoother demo.

**Decision.** The first decision call is told a policy layer exists but never what it contains. The model proposes what the evidence justifies. Limits enter the conversation only in the retry, as a fact reported from the `Verdict`.

**Consequences.** Three things this buys, in ascending order of importance. (1) The T1 rejection is genuine — the model really wanted 30% and code really refused. (2) The separation of concerns becomes true rather than stylistic: the model reasons about commerce, code owns constraints. (3) It surfaces the model's *unconstrained* instinct, which is exactly what a merchant evaluating this system wants to see bounded. Cost: rejections cost an extra call and ~2s. That extra call is the product.

**Rejected.** Limits in the prompt with the policy engine as a backstop — the engine becomes decorative, and the honest demo ("watch it get blocked") becomes theatre.

---

<a id="adr-007"></a>
## ADR-007 — No embeddings or vector store for trend↔product matching
**Status:** accepted

**Context.** Matching headlines to catalog items looks like a semantic-search problem: embed both, cosine-similarity, threshold.

**Decision.** Pass 8 real headlines and the compact catalog into the one decision call already being made, and require a `trend_match.why_it_matches` explanation in the output.

**Consequences.** Removes an embedding pipeline, a vector index, a similarity threshold to tune, and a re-embedding step on every catalog change — for a catalog of 8–12 products, all of which fit in a prompt with room to spare. More importantly, cosine similarity returns a *number*; a merchant reading an audit log needs a *reason*, and the model produces the reason natively. Cost: does not scale to 10,000 SKUs. Not this build's problem, and the swap point is one function.

**Rejected.** pgvector + embeddings — real infrastructure whose output is less explainable than the cheaper option.

---

<a id="adr-008"></a>
## ADR-008 — Real NewsAPI fetch first, declared fallback second
**Status:** accepted

**Context.** A live external call in a recorded demo is a risk: rate limits, empty results, nothing relevant to the catalog. The free tier also carries availability lag and a localhost-only restriction.

**Decision.** Attempt the live fetch every cycle; persist the raw response; fall back to a pre-written headline only on timeout, non-200, or zero usable articles. **The audit narrative always prints which source was used.** Record retakes until a genuinely relevant live result lands.

**Consequences.** The demo can never accidentally present a fallback as live — the log says `fallback` in plain words. The localhost restriction costs nothing, being already implied by [ADR-010](#adr-010). Cost: T2 may need several takes, which is why it is scheduled with slack in [TASKS.md](TASKS.md).

**Rejected.** (a) Pre-recorded headline only — the "reads real external signals" claim would be false. (b) Live-only with no fallback — one rate limit ends the recording session.

---

<a id="adr-009"></a>
## ADR-009 — Postgres is the source of truth; Razorpay is enforcement
**Status:** **accepted, VERIFIED by probe 2026-08-26** — `POST /v1/offers` returns 405 (no programmatic creation); orders and payment_links both confirmed creatable in test mode; `razorpay_ref_kind` primary path = `payment_link`

**Context.** A discount has to be two things: state the storefront and AI buyers read, and money behaviour that actually holds at checkout. Razorpay's Offers surface has historically been dashboard-created and API-*readable*; whether a test account can create an offer programmatically must be confirmed against live documentation. This is the one integration where LLM-assisted coding is least reliable and where real hours must go into reading the actual docs.

**Decision.** Split the roles. `discounts` in Postgres is canonical for display and pricing — the storefront and `/api/catalog` never call Razorpay. Razorpay is where a discount becomes payable behaviour, via a three-tier representation ladder recorded per row in `razorpay_ref_kind`: `offer` (programmatic creation, if supported) → `payment_link` (dashboard-precreated offers for approvable tiers + discounted-amount checkout artifacts — **assumed primary**) → `local_only` (honoured in our pricing, Razorpay unavailability logged, never hidden). A standalone probe script is written **before** any app code to collapse the uncertainty on day one.

**Consequences.** No demo beat depends on which tier lands, so the schedule is not hostage to a docs answer. Ordering is deliberate — Razorpay call first, local write second — so the worst outcome is an unused test artifact rather than a badge the storefront shows and checkout ignores. Cost: `razorpay_ref_kind` is a small amount of accidental complexity, earned by removing a single point of failure from the recording.

**Rejected.** (a) Assume programmatic offer creation works and find out on day three. (b) Skip Razorpay, fake the discount — deletes the only "it really executed" evidence in the build.

---

<a id="adr-010"></a>
## ADR-010 — No deployment
**Status:** accepted

**Context.** Submission is a recorded video. Hosting would add a Supabase production project, environment plumbing, a build pipeline, and a class of works-locally-fails-deployed bugs.

**Decision.** `localhost` only. No hosting, no CI, no domain.

**Consequences.** Hours redirect to the parts being judged. Also satisfies NewsAPI's free-tier localhost restriction for free, and keeps the service-role key on a machine we control. Cost: no live link for judges — mitigated by a 10-line README so anyone can run it, and by the audit trail being inspectable in the recording.

**Rejected.** Vercel + hosted Supabase — real cost, no marginal credit.

---

<a id="adr-011"></a>
## ADR-011 — The AI buyer reuses the same policy module
**Status:** accepted

**Context.** An order endpoint would normally get its own request validation: check the SKU, check the quantity, return a 400.

**Decision.** `POST /api/agent-buyer/order` calls `lib/policy/` with buyer-specific rules that return the **same `Verdict` type**, and writes to the **same** `agent_runs` / `agent_events` tables tagged `ai_buyer`. Rejections return the rule ID, not prose.

**Consequences.** The claim "one policy engine, three triggers" becomes literally true — the audit page shows an agent discount and a machine purchase in one uninterrupted list, gated by one module. This is what makes the boundary look general rather than tailored to the discount case. A bonus fell out: `BUYER_PRICE_INTEGRITY` — when the counterparty is software that can assert a price, ours must be authoritative, and a mismatch must be a named rejection rather than a silent re-price. Cost: buyer rules are shaped by a `Verdict` type designed for agent proposals. Mild, and it is the constraint doing the useful work.

**Rejected.** Ordinary endpoint validation returning 400s — functionally equivalent, and it would quietly make the pitch's strongest structural claim untrue.

---

<a id="adr-012"></a>
## ADR-012 — Detectors are code; the model never chooses what to look at
**Status:** accepted

**Context.** A "more agentic" design lets the model query the database and decide what to investigate.

**Decision.** Deterministic detectors run first and either fire with a payload or return nothing. The model is invoked only on a fired signal and only reasons about it.

**Consequences.** Reproducible triggering ([ADR-004](#adr-004)); no model call spent on quiet days; `no_signal` becomes a cheap, honest, common outcome. Removes an entire class of demo failure where the model looks in the wrong place. Cost: the agent cannot notice something we did not write a detector for — a real limitation, stated rather than papered over.

**Rejected.** Tool-calling loop with database access — more impressive-sounding, less reproducible, and it puts unbounded query capability inside the thing we are trying to bound.

---

<a id="adr-013"></a>
## ADR-013 — Retry budget is exactly one, enforced in code
**Status:** accepted

**Context.** After a rejection the model could be re-prompted repeatedly until something passes.

**Decision.** `MAX_RETRIES = 1` in `lib/agent/cycle.ts`. A second rejection is a hard stop with terminal status `rejected`.

**Consequences.** Worst-case cost, latency, and audit length per cycle are all bounded and knowable. "Retry until approved" would let a persistent model grind toward the boundary, which is exactly the dynamic a merchant fears. Cost: an occasional cycle stops with no action taken — which is the correct behaviour, and it is displayed rather than retried away.

**Rejected.** Retry-until-pass, and retry-with-model-chosen-budget. The bound must not be negotiable by the thing being bounded.

---

<a id="adr-014"></a>
## ADR-014 — Money is integer paise
**Status:** accepted

**Context.** Prices flow through the storefront, the margin rule, the budget rule, Razorpay, and the audit log.

**Decision.** Integer paise in every column and every calculation (`_p` suffix). Formatting to rupees happens only at render.

**Consequences.** `MIN_MARGIN_PCT` and `DAILY_DISCOUNT_BUDGET` are exact integer comparisons, so a policy verdict can never hinge on a rounding artifact — and Razorpay expects the smallest currency unit anyway, removing a conversion at the boundary. Cost: `/100` at display time, and remembering the suffix.

**Rejected.** Floating-point rupees. A margin floor that fails at 14.999% is not a limit anyone will defend in a demo.

---

<a id="adr-015"></a>
## ADR-015 — Claude via the Anthropic API, one env var from swappable
**Status:** superseded by [ADR-017](#adr-017)

**Context.** The plan allowed either Claude or GPT. Forced-schema output and reproducibility matter more than provider identity.

**Decision.** `claude-sonnet-5` by default, set through `ANTHROPIC_MODEL`. Escalate to `claude-opus-5` only if trend-match quality disappoints in rehearsal. Direct SDK, no abstraction layer.

**Consequences.** Forced `tool_choice` gives the hard schema guarantee [ADR-005](#adr-005) depends on. Cost is negligible at a few dozen calls across the whole build. Cost of the choice: provider-specific call shape in `lib/decide/propose.ts` — one file, one function, and a deliberate non-abstraction.

**Rejected.** A provider-agnostic wrapper — abstraction for a swap we will not perform during a buildathon.

---

<a id="adr-016"></a>
## ADR-016 — The audit trail is narrative text *and* structured events
**Status:** accepted

**Context.** Structured logs are verifiable but unreadable on camera. Narrative text is readable but unverifiable.

**Decision.** Write both from one path: `agent_events` rows (ordered, `jsonb` payloads) plus a rendered `narrative` string per run. The audit page leads with the narrative; raw payloads sit behind a toggle.

**Consequences.** A viewer follows the story with no JSON, and a sceptic checks the story against the data in the same view — which is the actual definition of "explainable" for this system. Rejections and failures render with the same prominence as successes, so the log cannot flatter the agent. Cost: templates in `narrator.ts` must be kept in step with payload shapes.

**Rejected.** (a) JSON-only — unwatchable, and it hides the boundary we are trying to show. (b) Narrative-only — the audit trail becomes a story the system tells about itself, which is the thing we are arguing against.

---

<a id="adr-017"></a>
## ADR-017 — Model provider moves to Groq, `openai/gpt-oss-120b`
**Status:** accepted (supersedes [ADR-015](#adr-015))

**Context.** Probed live 2026-08-26: Groq has retired its Llama chat models (`llama-3.3-70b-versatile` → `model_not_found`). The key-visible catalog is now `openai/gpt-oss-120b|20b`, `qwen/qwen3.6|3.8-27b`, and the `groq/compound` agents. [ADR-015](#adr-015)'s premise — provider identity does not matter as long as forced-schema output and reproducibility hold — survives intact; only the concrete choice changes.

**Decision.** `openai/gpt-oss-120b` via the OpenAI-compatible `/chat/completions` endpoint, plain `fetch`, no SDK ([ADR-002](#adr-002) unchanged). Env becomes `GROQ_API_KEY` / `GROQ_BASE_URL` / `GROQ_MODEL`; `tool_choice` becomes `{type:'function', function:{name:'propose_action'}}`. Fallback ladder: `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`. `max_tokens` rises 1200 → 4000: gpt-oss spends completion-budget tokens on reasoning (~180 observed on the probe call).

**Consequences.** Probe evidence: forced tool-use produced a valid `propose_action` call at temperature 0 on the first leg of T-04. NFR-1 byte-identical determinism is **not yet confirmed** — the second leg hit the free-tier 8,000 TPM limit; the run resumes when limits refresh, and until then NFR-1 stays an assumption rather than a measured fact. Free-tier TPM is otherwise a live constraint: one small call per cycle, probe legs spaced apart.

**Rejected.** (a) `groq/compound(-mini)` — agentic harnesses that reintroduce the orchestration [ADR-002](#adr-002) rejected. (b) `qwen/qwen3.8-27b` as primary — weaker trend-match judgement than 120b at the same price point; kept as fallback. (c) An OpenAI SDK client for shape familiarity — one `fetch` call needs no dependency.

---

<a id="adr-018"></a>
## ADR-018 — External headlines come from `/v2/everything` over named domains
**Status:** accepted (endpoint amendment to [ADR-008](#adr-008); fetch-first strategy unchanged)

**Context.** Probed live 2026-08-26 against the free plan: `top-headlines?country=in` returns HTTP 200 with **zero** articles (free-plan geo is US-only); `top-headlines?sources=<indian outlets>` works but its index is ~5 years stale; TOI/NDTV/IndianExpress return nothing on the free plan at all.

**Decision.** The external detector fetches `GET /v2/everything?domains=livemint.com,moneycontrol.com,indiatoday.in&language=en&sortBy=publishedAt&pageSize=20`. These are the outlets the free plan indexes fresh (median lag minutes, ≤2 days worst observed). Everything else in [ADR-008](#adr-008) stands verbatim: fetch first, persist raw to `news_cache`, top-8 titles into the prompt, declared fallback on timeout/non-200/zero usable, audit always names its source.

**Consequences.** The domain list lives as a constant in `lib/observe/external.ts` — widening coverage is a one-string edit. `everything` returns article-search metadata rather than curated front-page slots, so titles skew noisier; irrelevant here, because relevance judgement was always the model's job ([ADR-007](#adr-007)). Quota spend moves to the `everything` endpoint at pageSize 20 per external cycle.

**Rejected.** (a) Paid NewsAPI tier — cost buys prestige, not a demo beat. (b) RSS scraping of the same outlets — leaves the sanctioned API and adds parser maintenance. (c) Keep `top-headlines` and wait for a geo expansion — a demo-critical path cannot rest on a maybe.

---

<a id="adr-019"></a>
## ADR-019 — The merchant is a bookstore; featured-first public surfaces
**Status:** accepted (user direction, 2026-08-26)

**Context.** The generic catalog needed a trend-bait SKU per headline bet. Books exist for every category — monsoon travelogues, cricket, wellness/AQI, heatwave thrillers — so re-domaining the merchant as a bookstore makes every external signal plausibly matchable and retires more of R3 for free. Separately: build the bookstore first, wire the agent afterwards.

**Decision.** Catalog re-domained to 10 books (`BK-101…BK-110`) with identical load-bearing numbers ([RULES.md DET-3](RULES.md)). Public surfaces: `/` renders Featured as hero with Collections beneath; `/browse` is the full filterable grid; `/collections/[category]` is the same grid pre-filtered. Judge surfaces (`/audit`, `/policy`, `/control`) unchanged. `products` gains `author` and `cover_url`. A real book dataset lands later via `scripts/import-books.ts`; until then placeholder fixtures ship. Agent wiring to curate Featured is explicitly deferred — when it arrives it flows through the existing policy-gated feature execution (FEATURED_SLOTS), never direct writes.

**Consequences.** The bookstore is watchable before Phases 2–6 exist — a deliberate plan reorder that trades schedule risk for an early real surface; policy/decide/execute phases themselves are unchanged. Effective-price computation stays in exactly one module (`lib/catalog.ts`) shared by pages and, later, `/api/catalog`. Seeded baseline features two titles so the hero is never empty before the agent runs.

**Rejected.** (a) Plain bookstore without the agent — loses the submission's thesis (bounded autonomy). (b) Single-page tabs — the user asked for distinct browse/collection routes. (c) Inventing a brand identity — PRODUCT.md's no-brand commitment stands; "Demo Merchant" sells books now.
