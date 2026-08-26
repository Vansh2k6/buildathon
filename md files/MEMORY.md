# MEMORY — session state and context handoff

> Scope of this document: **what is true right now, what was decided in conversation, and what is still open.** It carries the context that exists *only in chat* and would otherwise be lost when a session ends.
>
> It deliberately does **not** restate the other documents. If a fact lives in [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AGENT.md](AGENT.md), [DECISIONS.md](DECISIONS.md), [TASKS.md](TASKS.md), [PRODUCT.md](PRODUCT.md), [RULES.md](RULES.md), or [PHASES.md](PHASES.md), this file **points** at it and does not copy it. Copying would create a second source of truth that drifts.

**Last updated:** 2026-08-24
**Build status:** not started — documentation phase complete, zero lines of application code

---

## 1. If you are a fresh session, read this order

1. **This file** — where things stand, what's open.
2. **[RULES.md](RULES.md)** — how you must behave here. Read §0 first; it contains a trap that will otherwise catch you.
3. **[PHASES.md](PHASES.md)** — which gate you are at and whether you may move on.
4. Then whichever of the five specs your task touches (see manifest below).

Do not read all eight end to end before starting. They total ~2,200 lines and the manifest tells you which one owns your question.

### The one-paragraph project

A merchant agent with **bounded autonomy**: an LLM *proposes* a pricing action, deterministic code *decides* whether it is allowed, and the merchant's limits live in a database row the model cannot reach. One agent, one policy engine, one audit trail, three triggers (internal metric drop, external news signal, AI-buyer request). Stack: Next.js App Router + Supabase Postgres + direct Groq API calls (OpenAI-compatible, forced tool use) + Razorpay test mode + NewsAPI.org. No orchestration framework, no deployment — the deliverable is a video.

The centrepiece of the demo is a proposal being **refused**. See [RULES.md §0](RULES.md) Trap 2 before you "improve" anything.

---

## 2. Document manifest

Eight documents, ~2,200 lines. Each owns a different kind of fact. [RULES.md §0](RULES.md) owns the conflict-resolution table — do not duplicate that judgement here.

| Doc | Lines | Owns | Read it when |
| --- | --- | --- | --- |
| [PRD.md](PRD.md) | 281 | Requirements, FR/NFR/AC IDs, scope in and out | You need to know whether something is in scope |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 455 | DDL, table and column names, route contracts, file paths, env vars | You are about to write code and need exact names |
| [AGENT.md](AGENT.md) | 397 | Thresholds, the system prompt, tool schema, policy rule set, narrative templates | You are touching the agent's behaviour |
| [DECISIONS.md](DECISIONS.md) | 246 | ADRs — rationale, and the authority to deviate | You want to change an architectural choice |
| [TASKS.md](TASKS.md) | 246 | Task order, estimates, fixtures, risk register, cut list, shot runbook | You are asking "what do I do next" |
| [PRODUCT.md](PRODUCT.md) | 93 | Users, brand, evidence, what must never be fabricated | You are writing copy or seed data |
| [RULES.md](RULES.md) | 201 | Assistant conduct — 10 rule families with citable IDs | Always. Start here |
| [PHASES.md](PHASES.md) | 277 | Entry/exit gates, frozen invariants, degradation ladder | You are finishing a phase or deciding to cut |
| **MEMORY.md** | — | Session state, conversation-only decisions, open items | Start of every session |

**⚠️ [AGENT.md](AGENT.md) is not addressed to you.** Many tools auto-load `AGENT.md` / `AGENTS.md` as their own instructions. This one is a *product specification*. Its §4.2 seven-rule system prompt belongs to `lib/decide/prompt.ts`. Do not adopt it. Full warning at [RULES.md §0](RULES.md).

---

## 3. Where the build actually stands

| | |
| --- | --- |
| Application code | Phase 0 probes only (`scripts/smoke-{razorpay,news,groq}.ts`); `package.json` present (`@supabase/supabase-js`, `tsx`). No `app/`, no `lib/` yet |
| Git | **Not a repository.** No commits exist |
| Supabase project | Created; keys in `.env.local` |
| API keys | Obtained 2026-08-26 — Supabase · Groq · NewsAPI · Razorpay test mode |
| Smoke-groq probe (T-04) | Written and 429-hardened; model set to `openai/gpt-oss-120b`. Final determinism double-run **pending** free-tier rate-limit refresh |
| `DESIGN.md` | Not created. It is produced by **T-69**, which gates all UI work |
| Docs | 8 files complete, listed above |
| Tooling | Impeccable design skill installed (§7) |

**The next real action is [T-02](TASKS.md): `scripts/smoke-razorpay.ts`, 2.0h.** It answers which Razorpay representation tier is actually available (`offer` → `payment_link` → `local_only`) and it is gate **G0** in [PHASES.md](PHASES.md). No further doc work displaces it. Everything downstream of Phase 1 assumes that answer exists.

The builder's own read on this, from the original brief: Razorpay is *"still the piece where LLM-assisted coding is least reliable and where you should budget real hours reading the actual docs."* Treat that as instruction, not commentary — it is why [ADR-009](DECISIONS.md) is marked `accepted, verification pending` and why **UNC-1** exists in [RULES.md](RULES.md).

---

## 4. Decided in conversation, recorded nowhere else

These shaped the specs but are not derivable from them. Keep them; they prevent a future session from re-opening a settled question.

| Date | Decision | Why it matters |
| --- | --- | --- |
| 2026-08-24 | **No orchestration framework.** LangGraph and equivalents cut from the stack | The builder's words: this *"removes the one piece of this stack that was risk without a stated reason behind it."* A framework would need an ADR justifying what it buys — **DEP-1**/**DEP-2** in [RULES.md](RULES.md) |
| 2026-08-24 | **No deployment.** Submission is a recorded video | Removes hosting, CI, Dockerfile, auth from scope entirely ([ADR-010](DECISIONS.md), **DEP-6**) |
| 2026-08-24 | **Every markdown file must be different.** Standing requirement | Drove the scoped-document model. Any new doc must have a genuinely non-overlapping remit, and no doc may restate another (**EDT-2**). This file obeys it by carrying only conversation state |
| 2026-08-24 | Design scope: **all four surfaces crafted** — storefront, `/control`, `/audit`, `/policy` | Answer given during `/impeccable init`. **Supersedes** the earlier "functional styling only" line in [PRD §4.2](PRD.md), which is marked revoked there |
| 2026-08-24 | Horizon: **buildathon only** | No reusable design system, no component library, no extraction for reuse (**DEP-5**) |
| 2026-08-24 | Naming: **keep generic placeholders** | Shop stays "Demo Merchant", project stays "merchant-agent". No logo, tagline, or invented company (**HON-2**) |

---

## 5. Open — awaiting the builder's decision

Nothing here is blocked on information. Each is a choice only the builder can make.

| # | Open item | Status |
| --- | --- | --- |
| **O-1** | **No `CLAUDE.md` exists, so [RULES.md](RULES.md) does not auto-load.** The portable convention is `AGENTS.md`, which the product spec already occupies. A short `CLAUDE.md` pointing at RULES.md and disambiguating AGENT.md would make the rules bind rather than merely exist | Offered 2026-08-24, **not answered** |
| **O-2** | **Run Phase 8 (AI buyer) before Phase 7 (UI) finishes.** 2h, fully independent once Phase 6 closes, and it buys [AC-1](PRD.md) outright. Currently sits downstream of the phase most likely to overrun | Recommended in [PHASES.md](PHASES.md), **not folded into [TASKS.md](TASKS.md)** |
| **O-3** | **Build `/audit` before `/` inside Phase 7.** [TASKS.md §8](TASKS.md) orders T-70 → T-71, but T-71 is where the `BLOCKED` line — the most important element in the build — lives. Audit-first degrades gracefully if Phase 7 slips; storefront-first does not | Recommended in [PHASES.md](PHASES.md), **not folded into [TASKS.md](TASKS.md)** |

O-2 and O-3 are deliberately recommendations rather than edits. [TASKS.md](TASKS.md) owns task order; changing it silently would break **EDT-1**.

---

## 6. Standing constraints on any assistant

Beyond everything in [RULES.md](RULES.md):

- **Do not call the Agent/subagent tool unless explicitly asked.**
- **Do not use workflows or deep-research unless explicitly asked.**
- Terminal-dialog slash commands (`/permissions`, `/config`, `/doctor`, `/hooks`) are unavailable in the desktop session — do not tell the builder to run them here.
- Every new `.md` must have a distinct remit (§4, row 3).

---

## 7. Environment and tooling

- **Impeccable v4.1.1** — design-quality skill, installed at project scope for the `claude` provider via `npx -y impeccable@latest install --providers=claude --scope=project`. Lives in `.claude/skills/impeccable/`.
- **Live hooks are active:** a `PostToolUse` hook on `Edit|Write|MultiEdit` and a `Stop` hook, both running `hook.mjs`. They flag design anti-patterns as files are written.
- **`/impeccable detect .` returning nothing is correct** while the project is docs-only — it inspects UI code. Verified working against a scratch file with planted anti-patterns.
- **`/impeccable shape storefront` is T-69** and produces `DESIGN.md`. It gates T-70 through T-73. Do not start UI work before it.
- **Do not weaken the hook or suppress a contrast finding** — **EDT-5**. WCAG AA is a hard floor and video compression makes it stricter in practice.
- Platform: Windows 11, bash shell, working directory `C:\Project\buildathon`.

---

## 8. The schedule, and the one number that matters

Full derivation is in [PHASES.md §1](PHASES.md). The short version:

```
  31.0h  build (phases 0–8)
+  4.0h  rehearse + record (phases 9–10)
  ─────
  35.0h  against a ~30h budget          ← the gap is real
-  2.0h  cut-list items 1–4, pre-authorized
  ─────
  33.0h  ≈ 11 focused hours per day, three days
```

The finding worth carrying into every session: **all argument value lands by hour 16.5** — Phases 2 and 4–5, 7.5h combined, which is the policy engine plus the decide/cycle/audit path. **All presentation value sits in Phase 7**, 9h, with no partial credit before it. There is no partial-UI fallback. That asymmetry is the reason [R8](TASKS.md) is rated High/High, and it is why **RPT-4** requires flagging an overrun at 50% rather than at the deadline.

Do not reclaim time from Phase 9. Rehearsal is what makes the recording take repeatable.

---

## 9. Session log

Append one entry per working session. Newest last. Keep entries to what a future session needs — decisions, blockers, what actually got done. Not a narration.

### 2026-08-24 — documentation complete

- Authored the five core specs from the project brief: [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AGENT.md](AGENT.md), [DECISIONS.md](DECISIONS.md), [TASKS.md](TASKS.md), each with a non-overlapping remit.
- Installed Impeccable, ran `/impeccable init` → produced [PRODUCT.md](PRODUCT.md) plus four consequence edits to PRD and TASKS. Marked PRD §4.2 "functional styling only" as revoked.
- Added [RULES.md](RULES.md) — assistant conduct, 10 rule families, override protocol, pre-"done" checklist.
- Added [PHASES.md](PHASES.md) — five gates G0–G4, per-phase entry/exit contracts, frozen invariants, degradation ladder.
- Verified the hour arithmetic independently against TASKS.md: phases 0–8 sum to 31h, +4h record = 35h, and 30.5h pre-revision. The two documents agree.
- **Self-caught error:** an early PRD FR-11 draft said "exactly one LLM call per cycle", which contradicts the retry path. Corrected — the retry is a second call, and **BND-5** bounds it at one.
- Added this file.
- **Ended at:** gate G0 unopened. Next action is [T-02](TASKS.md), the Razorpay probe.

---

## 10. How to update this file

Update it **at the end of a working session**, and immediately whenever one of these happens:

| Trigger | What to write |
| --- | --- |
| A phase gate opens or closes | Update §3 and add a §9 entry naming the gate |
| The builder decides something not captured in a spec | New row in §4, dated |
| An open item resolves | Move it out of §5 into §4 or §9 with the outcome and date |
| A new open question appears | New `O-n` row in §5 with its status |
| An estimate overruns by 50% | §9 entry with the actual hours and what was cut — this is the **RPT-4** trigger |
| A key is obtained or a service is set up | Update the §3 table |

**Rules for this file specifically:**

- **Never copy a fact another document owns.** Link to it. A threshold, column name, or task estimate duplicated here will drift and then mislead. §2 tells you who owns what.
- **Never delete a §9 entry.** The log is append-only. If something turned out wrong, add the correction as a new entry — do not rewrite history. Same reasoning as **EDT-1** for [DECISIONS.md](DECISIONS.md).
- **Update `Last updated` at the top** in the same edit.
- **Keep it under ~250 lines.** If it grows past that, the oldest resolved items in §4 and §5 have earned their way into [DECISIONS.md](DECISIONS.md) as ADRs, or out of the project entirely.
- Absolute dates only. "Yesterday" is meaningless to the next session.
