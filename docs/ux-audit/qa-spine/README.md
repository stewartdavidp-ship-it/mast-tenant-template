# QA Spine — harness home

The runnable home of the next-gen testing program. The **spine** is 10 business workflows
(see [`../testing-workflows-spine.md`](../testing-workflows-spine.md)) each run through
**both** surfaces — the human admin **UI** and the AI-agent **MCP** API — and scored on
three lenses. Discovery & rationale: [`../testing-program-discovery.md`](../testing-program-discovery.md).

## Layout

```
docs/ux-audit/qa-spine/
  README.md             ← this file (structure + scorecard schema)
  W3-pilot.md           ← the pilot workflow, proxy-validated live (POS sale → books)
  scorecard-W3.json     ← machine-readable pilot result (agent baseline + proxy run)
  oracle-templates.md   ← agent/MCP oracle for the other 9 (W1,W2,W4–W10) + findings ledger (F1–F20)
  suite-scorecard.json  ← consolidated 10-workflow rollup (feeds the heatmap)
  money-canary.md       ← cross-surface VALUE assertion layer (Phase 3 item 3)
  value-coverage-matrix.md (+ .json) ← Lens 3: ranked capability × importance × coverage ("where to invest")
  usability-runbook.md  ← Lens 2 (human): the SUS + SEQ + objective-metrics protocol
scripts/qa-spine/
  w3-pos-ui.mjs         ← Playwright UI runner (records steps/time/errors/console)
  money-canary.mjs      ← live cross-surface money probe (oracle self-check + UI cross-check)
  usability-harness.mjs ← Lens 2 (human): objective-metrics capture (6 tasks; SUS/SEQ left to a human)
test/
  money-canary.test.js  ← deterministic money-canary (CI-gated; UI math == canonical oracle)
```

The **agent/MCP** side of a workflow is run by an agent executing the documented tool
sequence (the MCP *is* the interface) — no separate client needed; results land in the
scorecard. The **UI** side is a Playwright runner that drives the admin app and records the
ease-of-use metrics. One scorecard per workflow rolls both surfaces up.

## Scorecard schema (per workflow, reused for all 10)

```jsonc
{
  "workflow": "W3", "title": "...", "tenant": "sgtest15", "date": "YYYY-MM-DD",
  "surfaces": {
    "agent": {
      "runnable": true, "executed": true,
      "lens1": { "passAt1": true|null, "passHatK": {"k":5,"passes":null}, "collateral": "..." },
      "lens2": { "toolCalls": n, "responseBytes": n, "approxTokens": n, "costUsd": null },
      "oracle": { "before": {...}, "after": {...}, "assertions": [ {"name","expected","actual","pass"} ] }
    },
    "ui": {
      "runnable": true, "executed": false,
      "lens1": { "passAt1": null, "collateral": null },
      "lens2": { "taskSuccess": null, "steps": null, "timeMs": null, "errorCount": null, "seq": null }
    }
  },
  "findings": [ {"severity","title","detail"} ]
}
```

**Lens 1 (functional):** `passAt1` + `passHatK` (k repeats, all must pass = reliable) +
`collateral` (AppWorld-style: nothing *else* changed). **Lens 2 (ease of use):** UI = task
success, steps, time, errors, SEQ (1–7); agent = tool-calls, tokens/bytes, $ cost — reported
as an accuracy–cost trade-off. **Lens 3 (value):** not per-run; workflows are value-weighted
at the suite level (which money-critical flows are weakly covered).

## Status (2026-06-22)

- **Agent/MCP oracle: instrumented for all 10** — W3 proxy-validated; W1/W5/W6/W8/W9 baselines
  captured live on `sgtest15`; W2/W4/W7 read-side runnable; **W10 has no agent tool**. Details in
  [oracle-templates.md](oracle-templates.md), rollup in [suite-scorecard.json](suite-scorecard.json).
- **Money canary (Phase 3 item 3): BUILT** — the cross-surface VALUE assertion. Deterministic
  `test/money-canary.test.js` is CI-gated (UI money math == canonical oracle, fixture discriminating);
  live `scripts/qa-spine/money-canary.mjs` self-checks the MCP oracle (W6 matrix, all channels canonical)
  and cross-checks the rendered admin surface. **F14 closed** (deployed; `marginReliable` parity verified
  live). See [money-canary.md](money-canary.md).
- **Lens 3 (business value): BUILT** — [`value-coverage-matrix.md`](value-coverage-matrix.md) ranks
  20 capabilities (the 9-module catalog × W1–W10) by importance × coverage on all three surfaces.
  Coverage is **live-verified** (surfaced **F20** — W4/W2 agent coverage drifted *positive*; the ledger
  was stale). Value-at-risk headliners: classes/booking (F11, a whole revenue line, agent+test blind),
  returns/refund (untested money-out), restock/PO (new agent write power, no regression net).
- **Lens 2 (human ease-of-use): INSTRUMENT BUILT** — [`usability-runbook.md`](usability-runbook.md) +
  [`usability-harness.mjs`](../../../scripts/qa-spine/usability-harness.mjs): SUS (10-item) + SEQ + objective
  metrics over 6 top flows. Objective half auto-captured; **subjective SUS/SEQ = operator-scheduled human run**
  (no numbers fabricated — phase-3-plan §4). Was: "Human UI 0/10 measured, blocked on a writable session."
- **Findings:** F1 fixed (`task_f0d1c0e4`), F14 fixed+deployed (`task_14a258f4` closed); **F19** logged
  (latent MCP order-`totalCents` divergence); **F20** logged (positive coverage drift). Ledger in oracle-templates.md.

Per-workflow surface × lens maturity is in `suite-scorecard.json` and the heatmap.
