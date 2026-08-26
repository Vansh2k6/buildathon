# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Decided before init, not delegated — recorded in [ARCHITECTURE.md](ARCHITECTURE.md) §1: Next.js (App Router, API routes in the same process) · Supabase (Postgres) · Groq API (`openai/gpt-oss-120b`, forced tool-use) · Razorpay test-mode REST · NewsAPI.org. TypeScript. `localhost` only — no deployment target, no CI, no hosting.

Deliberately absent, each with a stated reason in [DECISIONS.md](DECISIONS.md): agent/orchestration framework, vector store, ORM, queue, scheduler, WebSocket layer.

## Users

- **Merchant / ops owner** — primary. Sets limits once, then reads an audit log and needs to agree with every action the agent took. Wants revenue defended without babysitting a dashboard, and certainty that nothing ran past their ceiling.
- **AI shopping agent** — a machine consumer. Discovers the catalog, reads price/stock/discount, places an order programmatically against a stable JSON contract, with no human in the loop.
- **End shopper** — passive. Sees accurate prices, real discount badges, relevant featured products.
- **Judge / evaluator** — a genuine primary audience for this build, not a hypothetical. The deliverable is a recorded video, so this user's comprehension is a functional requirement. They need to verify the agent is actually bounded rather than staged, and the thing they must understand fastest is a policy rejection.

## Product Purpose

Give a merchant an agent with **bounded autonomy**: it acts on real signals inside hard limits the merchant sets, and every action is explainable after the fact.

Two failure modes the product exists to avoid: an unconstrained agent nobody would trust with money, and a fully manual process that defeats the purpose. Success for this build is narrow and specific — a viewer with no prior context watches a proposal get refused by code, and understands why.

## Positioning

**The propose/decide split.** The model proposes; deterministic code decides whether the proposal may act. Limits live in a database row the merchant owns, read by pure functions that hold no model call and no network client — so the model cannot reach the limit that governs it. A neighbouring product can claim "human-in-the-loop" or "guardrails"; this one can show the boundary as an inspectable artifact and demonstrate it refusing a specific number on camera.

Second, narrower position: the product exposes a machine-readable catalog and a programmatic order path gated by that same engine, which most merchants do not have today, ahead of the agentic-commerce infrastructure (UAP, ACP, AP2) that will eventually require it.

## Operating Context

- Buildathon prototype. Planning basis: one builder, ~30 focused hours, three days.
- **The deliverable is a ~4-minute screen recording, not a running service.** Judges get no live URL; a short README exists so anyone can run it locally.
- `localhost` only. This also satisfies NewsAPI's free-tier localhost restriction at no cost.
- **Four surfaces:** storefront `/`, audit `/audit`, policy `/policy`, control `/control`.
- The entire demo is driven from the control page. A terminal appears on camera exactly once, for the AI-buyer script.
- Simulated time is an integer day index advanced by hand, so a scripted scenario fires identically on every recording take.
- Because evaluation happens by watching a recording, on-screen numbers must survive video compression and be readable at recording zoom. This is an operating fact, not a preference.
- Three triggers converge on one engine and one audit trail: internal signal, external trend, AI buyer.

## Capabilities and Constraints

- One model call per decision attempt; at most two per cycle (initial proposal + one bounded retry). `MAX_RETRIES = 1` is a code constant, not a model-settable field.
- Policy engine: 12 agent rules and 5 buyer rules, all pure functions over a merchant-owned row. No model call, no network call, no write access.
- Detectors are arithmetic, not judgement. The model never chooses what to look at — it reasons only about a signal that already fired.
- Money is integer paise throughout; formatting to rupees happens only at render.
- Razorpay is **test mode only**. No real money moves. Programmatic offer creation is **unverified** against a test account, which is why a three-tier representation ladder exists.
- Desktop only. No responsive or mobile work, no dark mode.
- **Design ambition (decided at init):** all four surfaces receive full craft. This overrides the earlier "functional styling only" constraint in [PRD.md](PRD.md) §4.2, which has been revised accordingly. Visual coherence across the four surfaces is required; extraction into a reusable, exportable design system is **not**, because the horizon is buildathon-only.
- **Horizon (decided at init):** buildathon only. Design and code investment should serve the recording. Do not spend hours on token extraction, component libraries, or copy engineered to withstand merchant scrutiny beyond the demo.
- Out of scope, with reasons on file: merchant auth, multi-tenancy, deployment, real money movement, orchestration framework, embeddings/vector search, certified UAP/ACP/AP2 conformance, measured revenue lift.

## Brand Commitments

**None, deliberately.** Confirmed at init: the seeded shop stays **"Demo Merchant"** and the agent's working title stays **"merchant-agent"**.

Do not invent a brand name, logo, company identity, tagline, or visual mark for either. Reading plainly as a prototype is the intended effect, and it is the honest one — nothing on screen should be mistakable for a real business.

## Evidence on Hand

**Real, and safe to show as real:** live NewsAPI.org headlines (with the fetch source printed in the audit log), real Groq API calls, real Razorpay test-mode artifacts, and genuinely computed policy verdicts.

**Simulated, and must be disclosed as such on camera:** the catalog (10 seeded SKUs), all per-day metric fixtures, the conversion-drop scenario, and the AI buyer itself. Two SKUs exist specifically to make policy rules visible rather than to sell anything.

**Absent — must never be fabricated:**

- Any measured revenue lift. [PRD.md](PRD.md) §8 states the explicit anti-claim: never "increases revenue by X%". Claim the mechanism, never a result.
- Any real customer, merchant, testimonial, case study, benchmark, press mention, award, or user count.
- Any pricing, licensing, availability, uptime, or deployment claim.
- Any logo, brand asset, product photography, or founder/team identity. Do not source stock imagery that implies a real company.

No real payment has been processed. Any UI copy implying otherwise is a defect.

## Product Principles

1. **The boundary is the product.** Where model authority ends and code authority begins must be visible in the interface, not asserted in prose.
2. **Rejection is a first-class outcome.** A blocked proposal is the system working, and it is displayed with at least as much prominence as a successful action — never swallowed as an error.
3. **Craft serves comprehension.** On these surfaces expression and legibility are not in tension: the design's job is to make a policy verdict understandable within seconds, and anything decorative that slows that down has failed.
4. **Claim the mechanism, never the result.** Precision about what this prototype does and does not prove is a product feature, not modesty.
5. **Reproducibility is a feature.** Temperature 0, hand-advanced time, and deterministic verdicts exist so that a recording take can be repeated exactly.

## Accessibility & Inclusion

No product-specific standard was established at init, and none was claimed. Two operative floors apply:

- **WCAG AA contrast** as a hard minimum, enforced automatically by the installed detector hook.
- **Video legibility** — numeric values (conversion percentages, discount amounts, policy limits) must remain readable after screen-recording compression at demo zoom. This is already a pre-flight item in [TASKS.md](TASKS.md) §14 and is the more binding of the two constraints in practice.

Desktop-only is a deliberate scope decision, not an accessibility position.
