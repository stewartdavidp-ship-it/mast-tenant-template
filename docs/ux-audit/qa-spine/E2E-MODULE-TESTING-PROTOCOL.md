# E2E Module Testing Protocol

> **Status:** active program, started 2026-06-25. **Control session** holds the module ledger
> and confirms completion; **worker sessions** each test ONE module and report back; **fix
> sessions** are spawned by workers to fix bugs (worktree + PR), never inline.
>
> This protocol reuses the existing QA-spine harness (it does **not** start over). See
> [README.md](README.md), [oracle-templates.md](oracle-templates.md),
> [testing-workflows-spine.md](../testing-workflows-spine.md),
> [value-coverage-matrix.md](value-coverage-matrix.md), and the canaries in
> `scripts/qa-spine/`.

## Mission

Take each app module, one at a time, and test it **end-to-end** across three perspectives:
**MCP**, **UI**, and **E2E process**. A module is *complete* only when all three are green
(or a gap is explicitly logged as known / by-design).

## The repeatable test shape (the spine)

Every test, regardless of perspective, reduces to:

> **snapshot (MCP oracle) → act (UI or MCP) → re-snapshot → assert deltas to the cent +
> zero collateral**, repeated `pass^k` (k=5) on a reset fixture where writes are involved.

| Perspective | Method | Oracle / pass bar |
|---|---|---|
| **MCP** | Run the module's MCP tool sequence (`mast_*`, `finance_*`, `team_*`, `studio_*`, `trips_*`, `orders_*`, `expenses_*`, `materials_*`) against the test tenant. Exercise every tool/action the module owns. | Tool response is the before/after snapshot. Each action returns correct data; reads match writes. |
| **UI** | Drive the admin surface via Claude-in-Chrome (the `qa-canary` skill pattern). Use boot-smoke for structural render. | The **rendered** value == the MCP oracle, **to the cent**. No console/page errors. |
| **E2E** | snapshot → act → re-snapshot → assert deltas + zero collateral, `pass^k`. Reuse `scripts/qa-spine/write-delta-core.mjs` (A1–A5). | Revenue/inventory/P&L move by *exactly* the action; exactly one canonical channel; nothing else changed. |

## Non-negotiable session rules (every worker + fix session)

1. **Ground truth = `origin/main`.** `git fetch` first; work in your OWN worktree off
   `origin/main` (`git worktree add /tmp/<task> origin/main -b <branch>`). The shared
   checkout drifts hundreds of commits behind — **never judge against it or against memory;
   use `git cat-file -e` / `git show origin/main:<path>`.**
2. **Never `git push origin main`** (ruleset-blocked). Open a PR; it auto-merges on green
   `lint`. Any change to `app/index.html` or `app/modules/*.js` MUST bump `MAST_MODULES_V`.
3. **Verify via `<tenant>.runmast.com`** (the Cloudflare worker), hard-reload to clear cached
   module JS. Not the `.web.app` origin.
4. **Test tenant = `sgtest15`** (writable; POS-cash is the most reliable write path).
   **NEVER write to `golden-auric`** (read-only golden master). Never use real payment creds.
   `?testmode=1` = read-only preview user (fine for boot-smoke/read checks, cannot write).
5. **Bugs → spawn a fix sub-session** (own worktree + PR). Do not fix inline; do not bloat
   your own context. Report the bug (with minimal repro) and the fix PR link back to control.
6. **Stale-JS guard before judging a UI value:** confirm `window.MAST_MODULES_V` is present
   (load complete) and you hard-reloaded, else a value mismatch may be a cache artifact, not a bug.

## Standardized worker report (return this verbatim shape to control)

```
MODULE: <name>  (workflow: W#, files: app/modules/x.js + shared/y.js)
COMMIT TESTED: <origin/main SHA>

PER-FUNCTION RESULTS
| function / action | MCP | UI | E2E | notes |
|-------------------|-----|----|----|-------|
| ...               | ✅/❌/➖/N/A | ... | ... | oracle delta, repro |

ORACLE DELTAS (E2E): <revenue/inventory/P&L before→after, collateral check>
BUGS FOUND: <id — 1-line repro — severity — FIX PR link or "spawned, pending">
KNOWN/BY-DESIGN GAPS: <e.g. no MCP tool for this surface>
VERDICT: COMPLETE | COMPLETE-WITH-GAPS | BLOCKED (reason)
```

`➖` = not applicable to that perspective (by design). `N/A` = no such tool/surface exists.

## Completion bar (control confirms)

A module is **COMPLETE** when: every owned function passes MCP, UI, and E2E (or a gap is
logged as by-design with rationale); all bugs have a merged fix PR (or a tracked follow-up);
and the result is reproducible (`pass^k` for write paths). Control records the verdict in the
ledger below and only then spawns the next module (serial) or wave (parallel).

## Order — value-chain (W1→W10)

Walk the maker loop. Each workflow maps to the module(s) that own it; test them in sequence.

| # | Workflow | Primary module(s) | Money | Coverage-matrix flag |
|---|----------|-------------------|:---:|---|
| W1 | List a new product | maker.js (products-v2, materials, recipes), variant-reconcile | ➖ | 🟠 partial E2E |
| W2 | Online order → delivered | orders.js / orders-v2, cart.js, fulfillment | ✅ | 🔴 partial E2E |
| W3 | In-person POS sale → books | sales.js (POS), orders-core | ✅ | proven (money-canary) |
| W4 | Restock from low inventory (PO) | procurement.js, reorder-v2 | ✅ | **no E2E** ⚠️ |
| W5 | Reprice on material cost change | maker.js, materials, price-locks | ✅ | **no E2E** ⚠️ |
| W6 | Understand financial truth | finance.js, accounting.js | ✅ | proven (money-canary) |
| W7 | Resolve a return / refund | orders.js (refund), finance | ✅ | **no E2E** ⚠️ |
| W8 | Run payroll & labor | team.js | ✅ | partial (labor parity) |
| W9 | Manage customer / wholesale | customers.js, consignment.js, customer-service.js | ➖ | gap (F9) |
| W10 | Run a class / booking program | classes/book module | ✅ | **structural only** (no MCP tool, F11) ⚠️ |

After W1–W10, sweep remaining `app/modules/*.js` not touched by a workflow (settings,
dashboard, website, marketing, events, trips, studio, migration, etc.) and the `shared/*.js`
engines (most already have deterministic unit tests — confirm + fill gaps).

## Module ledger (control maintains)

| Module | Workflow | Status | Verdict | Fix PRs | Date |
|--------|----------|--------|---------|---------|------|
| _(populated as the program runs)_ | | | | | |
