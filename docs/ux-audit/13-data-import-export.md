# Data Import & Export (standard)

Companion to [02-standard.md](02-standard.md). **Scope:** *tabular* data (lists/records → CSV/XLSX). Images, file attachments, and OS-level interactions (pickers, drag-drop, clipboard, camera, print, downloads, external links) are in [14-media-file-and-os-controls.md](14-media-file-and-os-controls.md). Today export is hand-rolled per module (manual CSV string-building in finance, customers, orders, mapping, newsletter, team, fulfillment…) despite **PapaParse + SheetJS already being loaded** in the shell, and import is scattered ad-hoc file inputs with no common flow. This defines one export control, one import flow, one canonical data representation — and makes them **symmetric (round-trippable)**.

## Core principle: round-trip symmetry
**What you export must be re-importable.** Export columns, headers, and value formats match the import template for the same entity. One canonical data shape for both directions; display formatting is separate (see below).

## Canonical data representation (in files — not display)
Display can be pretty (06-B7: `$102,000.00`); **files are canonical and machine-clean**:
- **Numbers/money:** raw decimal, no currency symbol, no thousands separators (`102000.00`).
- **Dates:** ISO 8601 (`2026-05-30`, or `2026-05-30T13:29:00Z` with time). One format everywhere.
- **Enums/status:** the same canonical strings the UI uses for `.status-badge` (e.g. `placed`, not "Placed ✓").
- **Booleans:** `true`/`false`. **IDs:** the stable record id. **Encoding:** UTF-8 (with BOM for Excel).

## Export — one control, one behavior
- **Affordance:** a consistent **`↓ Export`** button in the module header actions, same place on every list (orders/customers already have it). Multi-format → a small menu (**CSV** default · **Excel**).
- **Scope = what you see:** respects the **current filters + sort**; if rows are **selected**, exports the selection, else the filtered set. State it in the action/label ("Export 19 filtered" / "Export 3 selected").
- **Columns = the list's logical columns** (+ a documented full-field option), values in the canonical representation above.
- **One shared exporter** built on **`Papa.unparse`** (CSV) / **SheetJS** (XLSX) — **never hand-rolled string concatenation** (the current finance/customers/etc. approach has escaping bugs and **CSV-injection** risk). The exporter must escape correctly and neutralize injection (prefix cells starting with `= + - @`).
- **File name convention:** `{tenant}-{module}-{view}-{YYYY-MM-DD}.csv` (e.g. `shir-glassworks-orders-active-2026-05-30.csv`).
- **Large exports:** run async/background and notify via `showToast` / "we'll email it when ready" — never freeze the UI on a huge synchronous build.
- **Permissions + audit:** sensitive/PII exports gated by role; every export `writeAudit`-logged.

## Import — one flow (the standard import wizard)
A consistent **`↑ Import`** action opens one flow (the `mapping` module's heuristic matcher is the reference for step 2). Steps:
1. **Source** — download the **template** (exact columns = the export columns) + pick a **CSV/XLSX** file. Parse with **`Papa.parse`** / **SheetJS** (loaded already), not bespoke readers.
2. **Map columns** — map file columns → Mast fields; auto-match by header name / SKU / email (mapping.js heuristics). Show unmatched.
3. **Validate + preview** — per-row validation; flag errors and **duplicates** (against the entity's match key — SKU / email / id); show a preview with counts.
4. **Confirm** — choose **create-only / update / upsert** behavior for matched rows.
5. **Result** — summary: **created / updated / skipped / errored**, with a **downloadable error report** (the failed rows + reasons) so the user can fix and re-import. Record an **import batch id** + `writeAudit` (enables review/rollback).
- Partial success is fine and explicit; never silently drop rows.

## Where it lives (ties to the slide-out)
- **Export** is a header action on the list — no panel needed.
- **Import** is a **multi-step wizard** → this is a logged **exception** to the slide-out rule ([09](09-conversion-inventory.md)), same category as the mapping setup wizard: full-flow, not a single record. Keep it a consistent wizard, not a slide-out.

## Conformance (per-screen checklist additions)
- Lists that export use the shared exporter (Papa/SheetJS), `↓ Export` in the header, scope = filtered/selected, canonical value formats, conventioned filename, injection-safe.
- Imports use the standard wizard (template → map → validate → confirm → result+errors), shared parser, defined match key, audit + batch id.
- Export and import for the same entity are **symmetric** — an exported file re-imports cleanly.
- No hand-rolled CSV string-building; no bespoke per-module import UI.
