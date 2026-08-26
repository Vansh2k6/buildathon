# PRD — Bounded-Autonomy Merchant Agent

**Working title:** `merchant-agent`
**Doc owner:** build team
**Status:** approved for build
**Audience:** builders + buildathon judges
**Deliverable:** local prototype + one recorded narrative video. **No deployment.**

> Scope of this document: *what* is being built, *for whom*, and *how we will know it is done*.
> Code structure lives in [ARCHITECTURE.md](ARCHITECTURE.md). Agent behaviour and policy numbers live in [AGENT.md](AGENT.md). Rationale lives in [DECISIONS.md](DECISIONS.md). Sequencing lives in [TASKS.md](TASKS.md).

---

## 1. Problem

Two separate gaps, one shared root cause.

**Gap A — pricing and merchandising are manual or static.** Merchants selling online decide discounts and featured placement by hand, or on fixed rules ("10% off every Friday"). Both react *after* a sales dip or a demand spike has already happened. Blanket sales protect nothing: they discount inventory that was going to sell anyway.

**Gap B — merchants are invisible to AI buyers.** As agentic commerce infrastructure lands (NPCI **UAP**, OpenAI **ACP**, Google **AP2**), AI shopping agents will transact on consumers' behalf. Most merchants today expose no machine-readable catalog and no programmatic order path, so they cannot be discovered or purchased from by those agents at all.

**Root cause.** The missing capability is not automation — automation is easy and untrustworthy. It is **bounded autonomy**: an agent that acts on real signals inside hard limits the merchant sets, where every action is explainable after the fact. The two failure modes we are explicitly rejecting:

| Failure mode | Why it fails |
| --- | --- |
| Unconstrained agent with money | No merchant hands spending authority to a model that can also revise its own spending limit. |
| Fully manual process | Defeats the point; misses every demand window that opens and closes inside a day. |

---

## 2. Product thesis

> The agent **proposes**. Deterministic code **decides whether it may act**. Every cycle is logged as a readable narrative.

That single sentence is the product. Everything below is an implementation of it.

---

## 3. Users

| # | User | Needs | Success looks like |
| --- | --- | --- | --- |
| U1 | **Merchant / ops owner** (primary) | Revenue defended without babysitting a dashboard; certainty that nothing runs past their limits | Sets limits once; reads the audit log and agrees with every action taken |
| U2 | **AI shopping agent** (machine consumer) | Discover catalog, read price/stock/discount, place an order programmatically | Completes a purchase against a stable JSON contract without a human in the loop |
| U3 | **End shopper** (passive) | Sees accurate prices, real discounts, relevant featured products | Storefront reflects live state, no stale badges |
| U4 | **Judge / evaluator** (demo-time) | Verify the agent is genuinely bounded, not staged | Watches a proposal get *rejected by code* on camera and understands why |

U4 is a real user of this prototype and drives several requirements below. We are optimising for *legibility of the boundary*, not for feature count.

---

## 4. Scope

### 4.1 In scope

1. **Observe** — two signal families: internal catalog/sales data from Postgres (conversion-rate anomaly, inventory), and external trending headlines fetched live from NewsAPI.org matched semantically against the catalog.
2. **Decide** — one LLM call per cycle producing **structured JSON**, never free text: a specific action (discount %, featured placement) plus a stated justification, including *why* a given trend matched a given product.
3. **Policy engine** — deterministic plain code that checks the proposal against merchant-set limits *before anything executes*.
4. **Execute** — approved actions call **Razorpay test-mode** APIs and write results back to Postgres.
5. **Storefront** — one read-only page: product grid, active discount badges, Featured section reflecting current ranking. Renders off the same database state everything else reads.
6. **Audit trail** — every cycle logged as a timestamped, human-readable narrative: observe → reason → propose → policy-check → execute → result.
7. **AI-buyer endpoint** — an API route simulating an external AI shopping agent that queries the catalog and places an order, gated through the **same** policy engine as every other action.

### 4.2 Explicitly out of scope

| Not building | Why |
| --- | --- |
| Deployment / hosting / CI | Submission is a recorded video ([ADR-010](DECISIONS.md)) |
| Merchant auth, multi-tenancy, roles | One merchant, seeded. Adds no demo value |
| Real money movement | Razorpay **test mode** only |
| Orchestration framework (LangGraph et al.) | Removed — see [ADR-002](DECISIONS.md) |
| Vector DB / embeddings pipeline | Trend↔product matching happens inside the decision call ([ADR-007](DECISIONS.md)) |
| Real UAP/ACP/AP2 protocol conformance | We expose an *agent-shaped* JSON contract, not a certified implementation. Stated as such on camera |
| Measured revenue lift | Prototype demonstrates a mechanism. See §8 |
| Responsive/mobile layout, dark mode | Desktop-only. Note: the earlier "functional styling only" constraint was **revoked at init** — all four surfaces now receive full design craft. See [PRODUCT.md](PRODUCT.md) |
| Exportable/reusable design system | Coherence across the four surfaces is required; extraction into a reusable system is not, because the horizon is buildathon-only |
| Inventory writeback to any external system | Postgres is the only source of truth |

### 4.3 Deferred (build only if time remains)

- `GET /api/agent-manifest` — capability descriptor for AI buyers (cheap, strengthens the U2 story).
- Revert action: agent expires its own discount when conversion recovers.
- Email/webhook notification on policy rejection.

---

## 5. Functional requirements

IDs are referenced by tasks in [TASKS.md](TASKS.md) and by test cases in §7.

### Catalog & storefront

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | Seeded catalog of 8–12 products with name, description, category, price, cost, inventory | P0 |
| FR-2 | Storefront renders product grid from live DB state, no hardcoded copies | P0 |
| FR-3 | Products with an active discount show a badge with original price struck through and the discounted price | P0 |
| FR-4 | Featured section renders products ordered by `featured_rank`, capped at the policy's slot limit | P0 |
| FR-5 | Storefront reflects an agent action within one manual refresh of the cycle completing | P0 |

### Observation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6 | Internal detector computes conversion rate per product over the simulated trailing window and flags a drop against baseline using the thresholds in [AGENT.md §3.1](AGENT.md) | P0 |
| FR-7 | A manual **Advance day** control moves simulated time forward one step so the conversion-drop scenario fires identically on every recording take | P0 |
| FR-8 | External detector fetches live headlines from NewsAPI.org at cycle time | P0 |
| FR-9 | If the live fetch fails, returns nothing usable, or times out, the cycle proceeds on a pre-written fallback headline and the audit log **states which source was used** | P0 |
| FR-10 | Raw fetch response is persisted so a cycle can be explained and replayed after the fact | P1 |

### Decision

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-11 | One LLM call per decision attempt, returning schema-valid JSON — enforced by forced tool-use, not by parsing prose. One call on the happy path; at most two per cycle (initial + the bounded retry in FR-19). Never a chain | P0 |
| FR-12 | Proposal contains: action type, target product, magnitude, confidence, and a natural-language justification | P0 |
| FR-13 | For trend-driven proposals the justification names the headline and explains the catalog match | P0 |
| FR-14 | The decision prompt does **not** contain the merchant's numeric limits on the first attempt ([ADR-006](DECISIONS.md)) | P0 |
| FR-15 | Schema-invalid or unparseable model output fails the cycle closed — logged, nothing executed | P0 |

### Policy engine

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-16 | Every proposal is evaluated by deterministic code before execution. No execution path bypasses it | P0 |
| FR-17 | Engine returns a verdict of `APPROVED` or `REJECTED` plus the specific rule ID and numbers involved | P0 |
| FR-18 | Limits are read from a database row the merchant owns, not from constants in the agent's code path | P0 |
| FR-19 | On rejection the agent gets **exactly one** retry, with the violated rule and its limit supplied; a second rejection is a hard stop | P0 |
| FR-20 | The engine contains no LLM call and no network call — it is pure functions over the proposal and the policy row | P0 |
| FR-21 | Enforced rules: max discount %, minimum post-discount margin, max concurrent discounts, max actions per simulated day, daily discount budget, featured-slot cap, per-product cooldown | P0 |

### Execution

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-22 | Approved discounts are represented in Razorpay test mode and linked to the local discount record by Razorpay id | P0 |
| FR-23 | Featured-placement changes are DB-only (no payment-provider concept exists for them) | P0 |
| FR-24 | Execution failure is caught, logged, and leaves local state consistent — no discount marked active whose Razorpay side failed | P0 |
| FR-25 | Every execution is idempotent per run id — re-running a cycle cannot double-apply | P1 |

### AI buyer

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-26 | `GET /api/catalog` returns a stable machine-readable catalog including current effective price and stock | P0 |
| FR-27 | `POST /api/agent-buyer/order` accepts a structured order from a simulated AI agent and returns a payable Razorpay test artifact | P0 |
| FR-28 | The order request passes through the same policy engine module as agent actions, with buyer-specific rules (max order value, max qty per SKU, stock availability) | P0 |
| FR-29 | A rejected AI-buyer order returns a machine-readable reason with the rule ID, not a generic 400 | P0 |
| FR-30 | AI-buyer orders appear in the same audit trail as agent actions, tagged by trigger type | P0 |

### Audit

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-31 | Each cycle writes one run record and ordered step events covering all six phases | P0 |
| FR-32 | Audit page renders newest-first, human-readable, with no JSON required to follow the story | P0 |
| FR-33 | Rejected and failed cycles are as visible as successful ones — rejection is a first-class outcome, not an error swallowed | P0 |
| FR-34 | Each run shows: signal that fired, what was proposed, verdict with rule, what executed, resulting state change | P0 |
| FR-35 | Raw payloads are available behind a toggle for anyone who wants to verify the narrative | P1 |

---

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | **Repeatability** — a cycle triggered twice from the same seeded state produces the same signal and the same policy verdict. Model temperature 0. This exists so recording retakes are possible |
| NFR-2 | **Cycle latency** ≤ 15s wall clock end to end, so the video has no dead air |
| NFR-3 | **Fail closed** — any error in observe, decide, or execute results in no state change plus an audit entry |
| NFR-4 | **No secrets client-side** — privileged DB key and all third-party keys are server-only |
| NFR-5 | **Untrusted external text** — headline content is treated as data, never as instructions. Even a hostile headline cannot widen a limit, because limits live outside the model ([AGENT.md §6](AGENT.md)) |
| NFR-6 | **Local-only operation** is a hard constraint, satisfying both the no-deploy decision and NewsAPI's free-tier localhost restriction |
| NFR-7 | **Legibility** — a viewer with no context understands the policy rejection within 20 seconds of seeing it |

---

## 7. Acceptance criteria — the three demo triggers

The build is done when this recording is possible in one take, in this order.

### T1 — Internal signal, proposal rejected, bounded retry, execution

```
Given  the seeded catalog at simulated day N
When   "Advance day" is pressed and a conversion drop crosses threshold on product P
Then   the internal detector flags P with before/after conversion numbers
And    the agent proposes a discount above the merchant's maximum
And    the policy engine returns REJECTED naming the rule and both numbers
And    the agent retries once, informed of the limit
And    the retry is APPROVED, executes against Razorpay test mode
And    the storefront shows P's discount badge on refresh
And    the audit trail shows all six phases including the rejection
```

**This is the most important 40 seconds of the video.** The rejection must be visibly produced by code, not narrated. Passing criteria: the rejected number and the limit are both on screen.

### T2 — External signal, live fetch, trend→catalog match

```
Given  the catalog contains products plausibly matching current news categories
When   an external cycle is triggered
Then   a live NewsAPI.org fetch returns a real headline (fallback path if not, stated in the log)
And    the agent's justification names the headline and explains the product match
And    the proposal (discount + featured placement) passes policy
And    both effects execute and are visible on the storefront
```

Passing criteria: the headline on screen is real and the stated match is one a human would agree with.

### T3 — AI buyer, same gate

```
Given  a simulated external AI shopping agent
When   it queries GET /api/catalog and posts an order
Then   the response reflects current effective prices including agent-applied discounts
And    the order passes the same policy engine, with buyer rules applied
And    a Razorpay test-mode payable artifact is returned
And    the order appears in the same audit trail, tagged ai_buyer
```

Passing criteria: the audit page shows an agent action and a machine purchase in one uninterrupted list — proof the gate generalises.

### Cross-cutting

- **AC-1** One agent, one policy engine, one audit trail across all three triggers. No parallel code paths.
- **AC-2** At least one rejection and at least one approval are visible in the same session.
- **AC-3** A cold reset followed by the full script reproduces the same three outcomes.

---

## 8. Revenue argument — stated precisely

This prototype demonstrates a mechanism. It does **not** measure a lift, and the video will say so. The claims we will actually make:

| Claim | Mechanism | Honest limit |
| --- | --- | --- |
| Bounded targeted discounting protects margin versus blanket sales | Fires only on a specific fired signal, on a specific SKU, never past a merchant-set ceiling, with a minimum-margin floor enforced in code | No A/B measurement exists here |
| Trend-responsive featuring captures demand windows | Reacts within a cycle to a live external signal a manually-updated storefront would not see | Free-tier news data carries delay ([ADR-008](DECISIONS.md)) |
| The AI-buyer endpoint opens a channel most merchants do not have | Machine-readable catalog + programmatic order path, ahead of UAP/ACP/AP2 rollout | Our endpoint is protocol-*shaped*, not certified |
| Bounded autonomy is what makes any of the above adoptable | The limit lives in code the merchant controls; the model cannot reach it | Trust argument, not a revenue number |

Anti-claim we will not make: "increases revenue by X%".

---

## 9. Simulation approach

**Internal signals.** Hand-scripted fixture data in Postgres, advanced by a manual *Advance day* trigger. Deliberate, not incidental: the conversion-drop scenario must fire identically across takes (NFR-1).

**External signal.** Real NewsAPI.org fetch attempted first; a pre-written headline is the fallback if the live call returns nothing usable. We record until a genuinely relevant live result lands. Whichever path was used is printed in the audit log — the demo does not pretend a fallback was live.

**Catalog seeding.** 1–2 products seeded specifically to plausibly match likely trend categories, so T2 has something to hit. This is disclosed, not hidden: seeding the catalog is what a real merchant's catalog *is*.

**Not simulated.** The LLM call, the policy engine, Razorpay test-mode calls, and the audit trail are all real code paths.

---

## 10. Risks affecting scope

Full register with mitigations and owners is in [TASKS.md §5](TASKS.md). Product-level summary:

| Risk | Impact on this PRD |
| --- | --- |
| **Razorpay integration** — highest remaining risk after dropping the orchestration framework. API surface for programmatic offer creation needs verification against live docs before FR-22 is considered designed | FR-22 has a documented fallback representation; the *demo* does not depend on which one we land on |
| NewsAPI free-tier delay / relevance | FR-9 fallback path is a P0, not a nice-to-have |
| Model proposes something boring or unparseable | FR-15 fails closed; T1 tolerates it because the *rejection* is the beat, not the number |
| Time | §4.3 deferred list is the cut line, and it is already drawn |

---

## 11. Glossary

| Term | Meaning here |
| --- | --- |
| **Cycle / run** | One complete observe → decide → policy → execute → log pass |
| **Signal** | A detected condition that justifies a cycle: internal anomaly or matched external trend |
| **Proposal** | The model's structured suggested action. Has no authority |
| **Verdict** | The policy engine's deterministic `APPROVED` / `REJECTED` decision. Has all authority |
| **Bounded retry** | The single re-proposal permitted after a rejection, with the violated limit disclosed |
| **Effective price** | Catalog price after any active discount — the number both the storefront and AI buyers see |
| **Trigger type** | `internal` \| `external` \| `ai_buyer` — the three demo paths, one engine |
