# Human Usability Runbook — Lens 2 (ease of use, HUMAN)

> The real human-usability measurement the testing program never had. Lens 2 was only ever
> **agent-proxied** (the agent ran the flows and we measured *its* friction); SUS/SEQ were
> never collected from a person. This runbook + [`usability-harness.mjs`](../../../scripts/qa-spine/usability-harness.mjs)
> close that: the **objective half is captured automatically**, and a **human runs the
> subjective half** (SUS + SEQ). **Authored 2026-06-22.**
>
> ## ⚠️ Honesty rule (load-bearing — [phase-3-plan.md](phase-3-plan.md) §4)
> **Do NOT manufacture a human number.** No LLM-as-human-usability-judge, no invented SUS/SEQ.
> A real person performs the tasks and fills the SUS/SEQ forms. The harness pre-fills only the
> *objective* metrics (success/time/steps/errors) and the success *oracle*; the SUS/SEQ cells
> stay `null` with status **"awaiting-human-run"** until a person runs it.

---

## 0. What's automated vs human

| Half | Metric | Who/what | Status now |
|---|---|---|---|
| **Objective** | task-success (pass/fail) | harness — automated success oracle (UI figure == MCP oracle for money/read tasks) | auto on run |
| **Objective** | time-on-task, #steps, error count | harness — step-runner captures per-step `{ok, ms, error}` + screenshots | auto on run |
| **Subjective** | **SEQ** (per task, 1–7) | **human**, post-task | **awaiting human** |
| **Subjective** | **SUS** (post-suite, 0–100) | **human**, after all tasks | **awaiting human** |

Read tasks (T4, T6) run today on an authed read session. Write tasks (T1/T2/T3/T5) need the
**operator-gated writable tenant** (`?testmode=1` is write-denied) — the same constraint as the
S-2 write-delta canary; do not rebuild that. The harness records `needs-writable-tenant` rather
than a fabricated pass.

---

## 1. The task set (top money/critical flows from the spine)

Six tasks, each with **one clear success criterion** (from its W-spec Steps). Give the tester the
goal and the success criterion — **not** the click path (so navigation effort is measured, not
parroted). The path below is for the facilitator/harness only.

| # | Task (goal as told to the tester) | Success criterion | W | Writable? |
|---|---|---|---|---|
| **T1** | "List a new product so a customer could buy it, priced from cost, with two size variants." | Product is purchasable on the storefront with the correct price + variant set. | W1 | ✍️ yes |
| **T2** | "A customer ordered online — get it fulfilled and out the door." | Order reaches *complete*; inventory −N; revenue reflects the total **once**. | W2 | ✍️ yes |
| **T3** | "Ring up a $X cash sale at the counter." | Receipt shows the exact total; revenue +exact **once**; inventory −1. | W3 | ✍️ yes |
| **T4** | "Tell me this quarter's revenue and whether the profit number is trustworthy." | States the correct revenue **and** recognizes margin is *withheld* (COGS incomplete). | W6 | 👁️ read |
| **T5** | "You're low on a material — reorder it from the vendor and receive it." | PO goes draft→sent→received; on-hand += received; cost basis updates. | W4 | ✍️ yes |
| **T6** | "Find your wholesale customers and open one to check their pricing tier." | Segment/Wholesale filter returns the right cohort; the account's pricing tier resolves. | W9 | 👁️ read |

Facilitator paths (harness `TASKS`): T1 `#products-v2`→editor→publish→storefront · T2 `#orders-v2`→triage→fulfillment · T3 `#pos`→/pos/ tab→charge→cash · T4 `#finance-pl-v2` · T5 `#reorder-v2`→`#procurement-v2`→receive · T6 `#customers-v2`→filter→account.

---

## 2. Objective metrics (auto-captured) + anchors

Per task, the harness records:

| Metric | Definition | Industry anchor ([§5E](../testing-program-discovery.md)) |
|---|---|---|
| **task-success** | met the success criterion? (oracle-judged for money/read tasks) | completion **≥ 78%** (serious problems < 70%; top quartile > 92%) |
| **time-on-task** | start → success, ms | report distribution; no fixed bar |
| **# steps / clicks** | interaction steps vs the W-spec `idealSteps` baseline | fewer-is-better vs ideal path |
| **error count** | slips, wrong turns, recoveries | ~**0.7 / task** average |

Captured into `usability-out/usability-<task>.json` and rolled into `usability-suite.json`.

---

## 3. SEQ — Single Ease Question (per task, human)

**Immediately after each task**, ask the tester the one question:

> **"Overall, how difficult or easy was this task?"**
> `1` Very difficult · 2 · 3 · 4 · 5 · 6 · `7` Very easy

Record the 1–7 integer per task. **Anchor:** average ≈ **5.5/7**; aim **≥ 5.5**. A task scoring
≤ 4 is a usability flag worth a follow-up note.

| Task | SEQ (1–7) | Note |
|---|---|---|
| T1 | _awaiting human_ | |
| T2 | _awaiting human_ | |
| T3 | _awaiting human_ | |
| T4 | _awaiting human_ | |
| T5 | _awaiting human_ | |
| T6 | _awaiting human_ | |

---

## 4. SUS — System Usability Scale (post-suite, human)

After **all** tasks, the tester rates these **10 canonical items**, each **1 = Strongly disagree
… 5 = Strongly agree**. Do not reword them (the norms depend on the exact wording).

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

### Scoring (0–100)

- **Odd** items (1,3,5,7,9): contribution = **(response − 1)**.
- **Even** items (2,4,6,8,10): contribution = **(5 − response)**.
- Sum all ten contributions (0–40), **× 2.5** → SUS **0–100**.

**Anchors:** average ≈ **68**; **"good" ≥ 80**; < 68 is below-average and a priority signal.
(SUS is *not* a percentage — 68 ≈ the 50th percentile.) For ≥ 2 testers, report the **mean** SUS.

| Item | 1 | 2 | 3 | 4 | 5 | Contribution |
|---|---|---|---|---|---|---|
| Q1 (odd) | | | | | | resp − 1 |
| Q2 (even) | | | | | | 5 − resp |
| … | | | | | | |
| | | | | | **Σ × 2.5 =** | **___ / 100** |

---

## 5. Run protocol

```bash
# 0) Dry run — see the plan + the objective scorecard skeleton (no browser, nothing faked):
node scripts/qa-spine/usability-harness.mjs --plan

# 1) Read-only tasks NOW (authed read session) — objective half auto-captured:
MAST_BASE_URL=https://<tenant>.<host> MAST_STORAGE_STATE=authed.json \
  TASKS=T4,T6 node scripts/qa-spine/usability-harness.mjs

# 2) Full suite on the operator-gated WRITABLE tenant (T1/T2/T3/T5 mutate):
MAST_BASE_URL=https://<tenant>.<host> MAST_STORAGE_STATE=writable.json \
  node scripts/qa-spine/usability-harness.mjs

# 3) The human performs each task (goal + success criterion only), facilitator times/observes,
#    tester fills SEQ after each task and SUS after all tasks → drop into the scorecard (§6).
```

First authed run: fill the `TODO:` selectors in `usability-harness.mjs` from the live DOM (the
admin DOM can't be read in `?testmode=1`), exactly as the W3 pilot did. Confirm
`window.MAST_MODULES_V` matches the deployed bundle before judging anything (hash-nav can serve
a stale module bundle).

---

## 6. Where the results land (scorecard schema)

Each workflow's `ui.lens2` in [`suite-scorecard.json`](suite-scorecard.json) takes the structured
object (added 2026-06-22, status-flagged):

```jsonc
"ui": {
  "lens2": {
    "taskSuccess": null,   // objective — harness
    "steps": null,         // objective — harness (vs idealSteps)
    "timeMs": null,        // objective — harness
    "clicks": null,        // objective — harness
    "errorCount": null,    // objective — harness
    "seq": null,           // SUBJECTIVE — human, post-task (1–7)
    "status": "awaiting-human-run"
  }
}
```

And the **suite level** carries the SUS:

```jsonc
"lens2Human": {
  "instrument": { "sus": "10-item, 0–100 (avg 68; good 80+)", "seq": "per-task 1–7 (avg ~5.5)",
                  "objective": "taskSuccess/time/steps/errors (completion >=78%)" },
  "harness": "scripts/qa-spine/usability-harness.mjs",
  "runbook": "docs/ux-audit/qa-spine/usability-runbook.md",
  "sus": { "score": null, "testers": 0, "status": "awaiting-human-run" },
  "status": "instrument-built; objective half auto-captured on run; subjective pass (SUS+SEQ) awaiting a human tester"
}
```

When a human runs it: the harness writes the objective cells; the facilitator types the SEQ
integers and the computed SUS into the scorecard and flips `status` → `"measured (n testers, YYYY-MM-DD)"`.
**Until then the SUS/SEQ cells stay `null`.** No fabricated numbers.

---

## 7. Deliverable status

- ✅ **Instrument built** — 6-task script, SUS (10-item + scoring), SEQ, objective harness, scorecard schema.
- ✅ **Objective half automatable** — `--plan` validated; read tasks (T4/T6) runnable on an authed read session; the money/read success oracle is wired to the live `golden-auric` baseline (2026-06-22).
- ⏳ **Subjective pass (SUS + SEQ)** — **operator-scheduled human run.** Needs a tester + (for T1/T2/T3/T5) the writable tenant. **No SUS/SEQ values until then.**
