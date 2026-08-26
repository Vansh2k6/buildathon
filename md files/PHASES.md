# PHASES — stage gates, capability ledger, and degradation ladder

> Scope of this document: **when you are allowed to move on, what becomes true at each stage, and what the submission still looks like if the clock runs out mid-build.**
> [TASKS.md](TASKS.md) owns the task-level checklist — IDs, hours, dependencies, fixtures, cut list, runbook. Nothing here repeats those tables. This file answers a different question: *is this phase actually closed, and what have I bought?*
> Requirement IDs → [PRD.md](PRD.md). Behaviour specs → [AGENT.md](AGENT.md). Rationale → [DECISIONS.md](DECISIONS.md). Assistant conduct → [RULES.md](RULES.md).

---

## 1. Phase map

| # | Phase | Est | Cumulative | Buys you |
| --- | --- | --- | --- | --- |
| **0** | De-risk | 3.5 | 3.5 | Three unknowns converted to written facts. No app code |
| **1** | Foundation | 3.0 | 6.5 | A database, a day counter, and a reset that works |
| **2** | Policy engine | 3.0 | 9.5 | **The differentiator, provable in a terminal** |
| **3** | Observe | 2.5 | 12.0 | Signals that fire deterministically |
| **4–5** | Decide, cycle, audit | 4.5 | 16.5 | **The T1 story, end to end, in text** |
| **6** | Execute | 3.5 | 20.0 | Real Razorpay test-mode artifacts |
| **7** | UI | 9.0 | 29.0 | **Everything watchable.** All four surfaces |
| **8** | AI buyer | 2.0 | 31.0 | The generality claim ([AC-1](PRD.md)) |
| **9** | Rehearse ([T-90](TASKS.md)) | 2.0 | 33.0 | Confidence that a take will land |
| **10** | Record ([T-95](TASKS.md)) | 2.0 | **35.0** | The submission |

Phases 9 and 10 are numbered here for completeness; [TASKS.md](TASKS.md) holds them as §13 and §14.

**Ordering principle:** phases are ordered by *risk retired per hour*, not by architectural layer ([TASKS.md](TASKS.md) planning assumptions). That is why the payment probe precedes all app code and the policy engine precedes the agent that feeds it.

### The arithmetic, stated plainly

```
  31.0h  build (phases 0–8)
+  4.0h  rehearse + record (phases 9–10)
  ─────
  35.0h  against a ~30h budget          ← the gap is real
-  2.0h  cut-list items 1–4, pre-authorized
  ─────
  33.0h  ≈ 11 focused hours per day, three days
```

Phase 7 grew from 4.5h to 9h when all four surfaces were promoted to full design craft at init. The gap is documented in [TASKS.md §8](TASKS.md) and is the reason [R8](TASKS.md) sits at High/High. **Do not reclaim it from phase 9** — an unrehearsed recording costs more than an unpolished `/policy` page.

### Day shape

| Day | Phases | Hours | Ends with |
| --- | --- | --- | --- |
| 1 | 0 → 1 → 2 → 3 | ~12 | Detectors fire; the engine passes its assertions |
| 2 | 4–5 → 6 → 8 | ~10 | **The full argument exists and executes.** No UI |
| 3 | 7 → 9 → 10 | ~13 | The video |

Day 3 is the loaded one and it is loaded with the phase most likely to overrun. That is a known, deliberate concentration of risk, not an oversight — see §7.

---

## 2. Gates

Five points where you stop and check rather than drift forward. A gate is a **binary question with a written answer**, not a feeling of progress.

| Gate | After | Question | If the answer is no |
| --- | --- | --- | --- |
| **G0** | Phase 0 | Is the Razorpay representation tier **written down**? | Time-box at 2.5h, then declare `payment_link` the primary path in `razorpay_ref_kind`, record that as the answer, and proceed. An undecided tier is worse than a conservative one |
| **G1** | Phase 2 | Do the assertions pass, **including `OIL-004 @ 15% → MIN_MARGIN_PCT`**? | Fix before Phase 3. If the margin floor never binds, the engine is one `if` and the central claim weakens ([TASKS.md T-24](TASKS.md)) |
| **G2** | Phase 4–5 | Is the T1 story — signal, proposal, rejection, retry, approval — **legible in the `agent_events` table with `execute` stubbed**? | Stop and fix. **No UI will save an illegible story.** If this gate is late, take cut-list items 1–4 immediately rather than at 2am |
| **G3** | Phase 7 | Does a viewer with no context understand the rejection in under 20s from the audit page alone ([NFR-7](PRD.md))? | Rework the `BLOCKED` line before anything else on any surface. It is the single most important element in the build |
| **G4** | Phase 9 | Did a cold reset → full script produce the same three outcomes **twice in a row** ([AC-3](PRD.md))? | Do not start recording. Fix, then re-run both passes |

**G2 is the decision point of the whole plan.** It is where the submission's substance becomes real, at roughly hour 16 of 35 — before any pixel is styled. Everything after it is progressively better presentation of an argument that already exists and is already true.

**After G4, code is frozen.** No fixes during recording. A defect discovered mid-take is either lived with or the take is abandoned — it is not patched between shots.

---

## 3. Phase 0 — De-risk

**Purpose.** Convert three unknowns into written facts before anything depends on them. Nothing here is app code.

- **Entry:** nothing. This is first, on day 1, before `create-next-app`.
- **Exit:** all five keys in `.env.local`; the Razorpay tier written in the probe script's header comment; 20 real headlines printed with observed lag noted and 2–3 catalog categories chosen from what actually appeared; one forced-tool-use call returning schema-valid JSON twice identically.
- **True after:** the highest-risk integration has a known answer. [NFR-1](PRD.md) is confirmed empirically rather than assumed.
- **Still not true:** nothing runs. There is no app.
- **If you stop here:** no submission. This phase has no demo value and full option value.
- **Live risk:** [R1](TASKS.md), [R2](TASKS.md). Both are retired or bounded by G0.
- **Not yet:** do not scaffold Next.js to "get started while reading docs". The probe is the task, and splitting attention is how the 2h becomes 4h.

> The gate is explicit in [TASKS.md](TASKS.md): **do not start Phase 1 until T-02's answer is written down.** The entire schedule is arranged so this answer arrives before anything is built on it.

---

## 4. Phase 1 — Foundation

**Purpose.** A database that holds the demo's state and a simulated clock that can be rewound.

- **Entry:** G0 passed.
- **Exit:** `npm run dev` serves a page; importing `serverAdmin()` in a client component fails loudly; RLS on with `anon` holding `select` only and **no write policy anywhere**; reset → day 0 → advance to day 8 fires exactly one conversion drop, on `TEA-001`; reset is idempotent.
- **True after:** state is reproducible. Retakes become free ([ADR-004](DECISIONS.md)).
- **Still not true:** nothing observes, decides, or acts.
- **If you stop here:** no submission.
- **Live risk:** [R7](TASKS.md) — verify the `select` policies now, not when the storefront fails to read in Phase 7.
- **Not yet:** no pages beyond what `create-next-app` leaves. No styling. No components.

> The seed is a demo artifact and deserves specification rather than improvisation — the fixture tables in [TASKS.md §10](TASKS.md) are the spec. Confirm the day-8 drop fires **exactly once** before leaving this phase; a second competing signal breaks the T1 beat in a way that is painful to diagnose three phases later.

---

## 5. Phase 2 — Policy engine

**Purpose.** Build the component being judged, before the component that feeds it.

- **Entry:** Phase 1 exit met, or at minimum `lib/db.ts` and the schema in place. The engine is pure, so it does not actually need working data to be written or tested.
- **Exit:** 12 agent rules and 5 buyer rules as separate pure functions, each with a `RuleId`; `evaluate()` returns the **first** violation with `{value, limit}`; `ApprovedAction` constructible only inside `policy/`; assertions pass on the exact numbers in [AGENT.md §5.2](AGENT.md) — `TEA-001 @ 30% → MAX_DISCOUNT_PCT`, `TEA-001 @ 18% → approved`, **`OIL-004 @ 15% → MIN_MARGIN_PCT`**, plus budget and cooldown cases.
- **True after:** the claim "the model never overrides its own limit" is checkable by reading one directory ([RULES.md BND-1](RULES.md)).
- **Still not true:** nothing produces a proposal for it to judge.
- **If you stop here:** a terminal recording of passing assertions. Not a submission, but not zero — it is the differentiator, demonstrated.
- **Live risk:** none material. This phase is pure code with no integrations, which is precisely why it is early.
- **Not yet:** do not wire it into anything. Do not import it from a route.

> `OIL-004` earns its five extra minutes at G1: it proves the margin floor is **not** redundant with the discount ceiling. 15% is comfortably under the 20% ceiling and still refused, because the margin binds at 11.7%. That single case is the difference between a policy engine and an `if`.

---

## 6. Phase 3 — Observe

**Purpose.** Deterministic detectors, so the model never chooses what to look at ([ADR-012](DECISIONS.md)).

- **Entry:** Phase 1 seed verified. External work also needs the category choices made in Phase 0.
- **Exit:** the drop detector fires on day 8 with the documented payload shape and returns `null` on days 1–7; the dead-stock detector fires on the seeded SKU and never competes with the drop; killing the network still completes the external path with `source: 'fallback'`, said out loud in the log.
- **True after:** triggering is reproducible; quiet days cost no model call; `no_signal` is a cheap, honest, common outcome.
- **Still not true:** no decision is made about anything that fires.
- **If you stop here:** no submission.
- **Live risk:** [R3](TASKS.md) — this is where you learn whether the trend-bait categories actually appear in live headlines. Four bets are placed across monsoon, cricket, AQI, and heatwave for exactly this reason.
- **Not yet:** do not add detectors beyond the two specified. Each additional signal is another thing that can fire on camera when you did not want it to.

> Run the fallback drill here rather than deferring it to rehearsal. It is a one-minute test now and a discovered-on-day-3 problem otherwise.

---

## 7. Phase 4–5 — Decide, cycle, audit

**Purpose.** The single model call, the retry-once control flow, and the narrative that makes it all legible.

- **Entry:** G1 passed and Phase 3 detectors firing.
- **Exit:** the tool schema and system prompt match [AGENT.md §4.2/§4.4](AGENT.md) verbatim; off-schema input never becomes a `Proposal`; all five terminal statuses reachable; every path to `execute` holds a `Verdict`; six phases logged per cycle with `(run_id, seq)` holding; a full run reads start to finish with no JSON visible.
- **True after:** **the argument exists.** Signal → proposal → rejection → retry → approval, real and reproducible.
- **Still not true:** nothing executes. Nothing is visible outside a database table.
- **If you stop here:** **a submission with complete substance and no presentation.** Every claim in the pitch is true and inspectable, but the video would be a screen recording of a Supabase table. Unwatchable, and yet the hard part is done — which is the whole point of the phase order.
- **Live risk:** [R4](TASKS.md) and [R5](TASKS.md) both become observable here for the first time. If the model proposes *within* limits on attempt one, there is no rejection and the demo loses its centrepiece; the honest fix is to lower `max_discount_pct` in the merchant row — a merchant-side lever, not a prompt hack.
- **Not yet:** do not start any page. Do not stub a UI "just to see it".

> **This phase ends at G2, and G2 is the plan's hinge.** Trigger an internal cycle with `execute` stubbed and read the `agent_events` rows as a story. If the rejection is not legible *there*, it will not be legible anywhere, and no amount of Phase 7 will fix it.

---

## 8. Phase 6 — Execute

**Purpose.** Turn an approved action into real money behaviour and durable local state.

- **Entry:** G2 passed. The tier answer from G0 determines what this phase actually builds.
- **Exit:** a real test-mode call succeeds **from the app**, not just from the probe script; a forced Razorpay failure leaves **no** `active` discount row; a forced local-write failure logs the orphaned id at `level='warn'`; promoting into a full featured set is refused by *policy*, not silently truncated by execute; the AI-buyer order path returns a real test-mode `short_url`.
- **True after:** "it really executed" is evidence rather than assertion. The Razorpay test dashboard corroborates the audit log.
- **Still not true:** nothing is watchable. There is still no UI.
- **If you stop here:** substance complete *and* corroborated — the audit narrative can be checked against the Razorpay dashboard in a second tab. Still a recording of database tables.
- **Live risk:** [R2](TASKS.md) — docs-versus-reality surprises land here. Keep the probe script runnable as a regression check rather than deleting it.
- **Not yet:** do not optimise the failure paths beyond the two compensating cases specified.

> Ordering is non-negotiable and easy to get backwards: **Razorpay first, local write second** ([RULES.md ERR-4](RULES.md)). The worst outcome must be an unused test artifact, never a badge the storefront shows and checkout ignores.

---

## 9. Phase 7 — UI

**Purpose.** Everything watchable. All four surfaces, full craft, coherent shared tokens.

- **Entry:** Phase 6 closed, so surfaces are built against real state rather than placeholders. The visual world is fixed **once**, before any surface is coded, so per-surface work is execution rather than deliberation.
- **Exit:** the shared token set is written down and used by all four surfaces; the storefront reads Supabase with **zero fixture JSON in the component**; rejected runs are as visually prominent as executed ones; a judge can point at `max_discount_pct = 20` and then at the rejection citing it; the entire demo is drivable from `/control` with no terminal.
- **True after:** the video as designed becomes recordable.
- **Still not true:** the AI-buyer surface, if Phase 8 has not run.
- **If you stop here:** the runbook minus shot 7 — a strong submission that argues bounded autonomy and loses the generality claim.
- **Live risk:** **[R8](TASKS.md), High/High.** This is the only phase whose overrun eats a later phase, and the later phase it eats is rehearsal. The trigger to act is any single surface running 50% over estimate; the response is cut-list items 1–4, already pre-authorized.
- **Not yet:** no responsive work, no dark mode, no component library, no token extraction for reuse ([RULES.md DEP-4, DEP-5](RULES.md)).

> **Intra-phase order matters more here than anywhere else, because there is no partial-UI fallback** — until a surface exists, nothing is watchable at all. Recommended order, by value at risk rather than by page hierarchy:
>
> 1. **Visual world first.** One pass covering type, palette, spacing, and component vocabulary for all four surfaces at once.
> 2. **`/audit`** — the argument. The surface judges spend the most time on, and the `BLOCKED` line is the single most important element in the build.
> 3. **`/control`** — makes the demo drivable on camera and removes the terminal from every shot but one.
> 4. **`/`** — shows the effect: badges, struck-through originals, Featured by rank.
> 5. **`/policy`** — last, because it is already cut-list item 4 and the `merchant_policy` row can be shown in the Supabase table editor if it goes.
>
> [TASKS.md §8](TASKS.md) lists the storefront before the audit page. If the schedule holds, either order works; if it slips, this one degrades gracefully and that one does not.

---

## 10. Phase 8 — AI buyer

**Purpose.** Prove the gate generalises — one engine, three triggers.

- **Entry:** Phase 6 closed. **This phase does not depend on Phase 7.**
- **Exit:** a discount created by the agent appears in `effective_price_inr` on the next catalog request; an over-quantity order returns `409 {rule:'BUYER_MAX_QTY', …}` rather than a generic 400; one command produces a readable discover → select → order → payable-link transcript.
- **True after:** [AC-1](PRD.md) is literally true — the audit page shows an agent discount and a machine purchase in one uninterrupted list, gated by one module.
- **Still not true:** nothing. This is the last build phase.
- **If you stop here:** the full runbook is recordable.
- **Live risk:** low. The buyer rules and the order execution path were both built in earlier phases; this phase wires them to a route.
- **Not yet:** no `/api/agent-manifest` — it is deferred and it is cut-list item 1.

> **Recommended reordering:** run this phase **before** Phase 7 finishes, immediately after Phase 6. It is 2h, it is independent, and it buys the generality claim outright. Phase 7 is the phase that overruns; leaving a cheap, high-value, fully independent phase downstream of it is the one sequencing choice in the plan worth revisiting. [TASKS.md](TASKS.md) lists it last by numbering, not by necessity.

---

## 11. Phases 9–10 — Rehearse, record

**Purpose.** Convert a working system into a recording that lands in one take.

- **Entry:** all build phases closed, or consciously cut.
- **Exit (9):** G4 — cold reset → full script, same three outcomes, twice in a row. Every check in the rehearsal table passes, including the fallback drill and the timing budget.
- **Exit (10):** nine shots, ~4 minutes, two browser tabs, terminal on camera exactly once.
- **True after:** done.
- **Live risk:** [R9](TASKS.md), and [R4](TASKS.md) resolves for the last time — rehearsal is the stated trigger for lowering `max_discount_pct` if the model has been behaving conservatively.
- **Not yet:** nothing. Code is frozen at G4.

> Shot 3 is the submission — 40 seconds holding on the `BLOCKED` line, saying *it asked for 30%, the ceiling is 20%, the code refused, and the model was never told the limit.* If time forces a choice, everything else compresses around it. Reserve the pre-flight checklist ten minutes before the first take rather than discovering a spent NewsAPI quota mid-shot.

---

## 12. Frozen invariants

Once a phase closes, these must never regress. A later phase that breaks one has introduced a defect, not a trade-off. [RULES.md](RULES.md) is the enforceable form of this list.

| Frozen after | Invariant |
| --- | --- |
| Phase 0 | The Razorpay tier answer is written down and `razorpay_ref_kind` records it per row |
| Phase 1 | `anon` has no write policy anywhere · `serverAdmin()` throws in the browser · reset restores day 0 exactly |
| Phase 2 | `policy/` has no import from `decide/`, no network client, no writes · `ApprovedAction` is constructible only inside `policy/` · first-violation-wins |
| Phase 3 | Exactly one signal fires per internal cycle · the fallback path names its source |
| Phase 4–5 | `MAX_RETRIES = 1` is a code constant · `temperature: 0` · every path to `execute` holds a `Verdict` · limits are absent from the first prompt |
| Phase 6 | Razorpay first, local write second · no `active` discount row survives a failed Razorpay call |
| Phase 7 | Rejections render at least as prominently as successes · no fixture JSON in any component · WCAG AA contrast |
| Phase 8 | The buyer path calls the same `policy/` module and writes to the same audit tables |

---

## 13. Degradation ladder

If the clock runs out, this is what the submission actually is. Written now so the choice is made awake.

| Stopped after | What you can record | Verdict |
| --- | --- | --- |
| Phase 2 | Terminal output of the policy assertions | Not a submission. The differentiator exists but nothing demonstrates it in context |
| Phase 3 | The above, plus detectors firing on cue | Not a submission |
| **Phase 4–5** | **The complete T1 story read off `agent_events`** | **A submission with all substance and no presentation.** Every claim true and inspectable; unwatchable |
| Phase 6 | The above, corroborated live in the Razorpay test dashboard | The argument plus evidence. Still a database recording |
| Phase 7 | Runbook shots 1–6, 8, 9 | Strong. Loses the generality claim |
| Phase 8 | The full nine-shot runbook | The submission as designed |
| Phase 9 | The above, rehearsed | The submission as designed, delivered in one take |

Two things follow from this table, and both are worth internalising before day 1:

1. **All presentation value is concentrated in Phase 7.** There is no partial credit before it and no additional credit after it. That is why [R8](TASKS.md) is the highest-rated risk in the register and why the cut list is drawn in advance.
2. **All argument value is concentrated in Phases 2 and 4–5**, which together cost 7.5h and land by hour 16.5. Protect those two phases absolutely. Everything in the cut list sits outside them, and [TASKS.md §12](TASKS.md)'s never-cut tier — policy engine, rejection path, audit trail, AI-buyer gate — is exactly their output.

---

## 14. What may be reordered, and what may not

**May not move:**

- Phase 0 before all app code. The probe's answer must arrive uncontaminated by surrounding code that assumes one outcome ([ADR-009](DECISIONS.md)).
- Phase 2 before Phase 4–5. The engine is pure and unit-testable with zero integrations; building the agent first means debugging two unproven components against each other.
- Phase 3 before Phase 4–5. The model may only reason about a signal that already fired.
- Phase 9 before Phase 10, twice through, cold.

**May move:**

- **Phase 8 before Phase 7** — recommended, see §10.
- The dead-stock detector may be dropped entirely (cut-list item 3); internal cycles then fire only on the scripted day.
- `/policy` may be dropped (cut-list item 4) and the `merchant_policy` row shown in the Supabase table editor instead.
- Within Phase 7, the surface order in §9 supersedes the numbering in [TASKS.md §8](TASKS.md) if the schedule slips.

**Never cut, at any point, for any reason:** the policy engine, the rejection path, the audit trail, the AI-buyer gate. Those four are the submission.
