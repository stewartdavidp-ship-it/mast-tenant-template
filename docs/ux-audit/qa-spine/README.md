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
  oracle-templates.md   ← agent/MCP oracle for the other 9 (W1,W2,W4–W10) + findings ledger
  suite-scorecard.json  ← consolidated 10-workflow rollup (feeds the heatmap)
scripts/qa-spine/
  w3-pos-ui.mjs         ← Playwright UI runner (records steps/time/errors/console)
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

## Status (2026-06-20)

- **Agent/MCP oracle: instrumented for all 10** — W3 proxy-validated; W1/W5/W6/W8/W9 baselines
  captured live on `sgtest15`; W2/W4/W7 read-side runnable; **W10 has no agent tool**. Details in
  [oracle-templates.md](oracle-templates.md), rollup in [suite-scorecard.json](suite-scorecard.json).
- **Human UI: 0/10 measured** — blocked on a writable automated session (the #1 open decision).
- **11 findings** surfaced (ledger in oracle-templates.md); F1 chipped as `task_f0d1c0e4`.

Per-workflow surface × lens maturity is in `suite-scorecard.json` and the heatmap.
