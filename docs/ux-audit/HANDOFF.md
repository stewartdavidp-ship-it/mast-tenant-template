# UI Redesign — Control Session Handoff / Restart

**Read this first.** It's the self-contained state of the operator-dashboard redesign so a fresh control session can continue without the prior context. Date: 2026-05-31.

## Mission & strategy
Redesign the Mast operator dashboard (`mast-tenant-template/app/`, ~40 modules) for consistency, via an **engine-first** approach: a declarative **Entity Engine** generates an on-standard list + slide-out detail from a per-object **schema**, so modules can't drift. Rollout is **strangler + flag-gated** (`uiRedesign`): new `*-v2` modules run side-by-side with legacy on separate routes; nothing changes for users until cutover.

**Locked process (the user insists on this order):**
1. Design a slide-out template per **object category** (mock → user approves → build).
2. Prove on **representative objects**, run a **QA agent panel** to find issues, fix.
3. Only after **all category templates are proven** → fan out within each category (agents do the repetitive schema conversions).

## Object categories (one template each)
| Category | Trait | Template | Rep object | Status |
|---|---|---|---|---|
| Transaction | line items + total + lifecycle | `renderTransaction` | order (`orders-v2`) | ✅ built + deployed + QA'd |
| Party / CRM | person + related records + history | `renderParty` | customer (`customers-v2`) | ✅ built + deployed + QA'd |
| Catalog / asset | media-forward; variants/pricing | TODO | product (or materials) | ⬜ design+build next |
| Event / scheduled | date/place, capacity, participants | TODO | show (or class/book) | ⬜ |
| Config / policy | named settings, no children | TODO | promotion (or policy) | ⬜ |
| Message / thread | content + status + conversation | TODO | customer-service ticket | ⬜ |
(Reports — finance/advisor — and builders — blog/newsletter — are NOT slide-outs; separate archetypes, later.)

## What's BUILT & DEPLOYED (live on sgtest15)
- **Engines (eager `shared/*.js`, wired in `app/index.html` <head>):**
  - `shared/mast-ui.js` — `MastUI`: `Num` (money/date/count, display vs canonical), `badge` (soft-tint dot), `tabs`, `list` (data-table), `slideOut` (v2 over shell `window.mastSlideOut`: width tiers sm/md/lg + expand + read/edit/create modes + MastDirty guard), `deepLink` (DISABLED — see gotchas), render components `tiles/card/kv/timeline/relatedTable/imageThumb/openImg/panelTab/paneTabsBar`, an injected tokenized `<style>`. Unit tests: `test/mast-ui.test.js`.
  - `shared/mast-io.js` — CSV export (RFC-4180 + injection guard + BOM + filename convention) + `parse` (Papa/SheetJS). Tests: `test/mast-io.test.js`.
  - `shared/mast-entity.js` — the **Entity Engine**: `define(key, schema)`, `listColumns`, `exportColumns`, `canonicalGet`, `displayCell`, `validate`, `renderList`, `openRecord(key,rec,mode,_internal)`, detail renderers `renderTransaction`/`renderParty`, `drill(targetKey,id)` + `back()` (PANEL-LOCAL stack `_panelStack`), `chips`. Tests: `test/mast-entity.test.js`.
- **Proof modules:** `app/modules/orders-v2.js` (Transaction), `app/modules/customers-v2.js` (Party, + a minimal `contacts-v2` schema). Each: flag-gated `flagOn()` (localStorage `mastUiRedesign` OR `?ui=1` URL param), self-mounting, `MastEntity.define(...)` schema with `detail` data hooks reading REAL fields, list + drill + edit.
- **Enforcement:** `scripts/lint-ux-standards.js` ratchet (baseline `scripts/ux-standards-baseline.json`, 42 files) wired into CI `.github/workflows/lint.yml` — fails PRs that increase native-dialog/`position:fixed`/`translateX`/hardcoded-hex counts; new files born clean.
- **Schema field types supported:** text, number, money, date, bool, status (tone), select (renderer NOT yet wired — see backlog), **tags** (renders array as chips; seeds future tag system), `get(row)`, `readOnly`, `list`, `sortable`, `group`, `tone`.

## How to SEE it (any browser, no devtools)
`https://sgtest15.runmast.com/app/?ui=1#orders-v2` and `…?ui=1#customers-v2`. `?ui=1` sets+persists the flag. Legacy screens (`#orders`, `#customers`) are untouched. (sgtest15 is served by the `dev` pod = `mast-tenant-shared` site.)

## Data notes (from the survey, doc 17)
- `MastDB` has per-entity accessors for ~40 objects (`MastDB.orders`, `.products`, `.shows`, `.events`, `.commissions`, `.wholesaleAccounts`, `.contacts`, `.rma`, `.trips`, `.newsletter`, …). **Customers have NO accessor** → use `MastDB.list/get/update('admin/customers')`.
- Order: `items[]` (each `{productName,qty,price,priceCents,lineTotal,pid,itemType}`; `itemType` ∈ product/gift-card/class/class-materials/pass), `status`+`statusHistory`, `subtotalCents/taxCents/shippingCents/totalCents`, `customerId`, `paymentMethod`, `fulfillmentLog`, `tracking` (OBJECT `{trackingNumber,carrier,method,trackingUrl}`). **MONEY IS INCONSISTENT**: most real orders are dollar-denominated (`total`, `price`, no `*Cents`); ~11 synthetic orders have `*Cents`. This caused the P0 bug below.
- Customer: `displayName`, `primaryEmail`, `emails[]`, `status`, `source`, `linkedIds.contactIds`, `marketing{newsletterOptIn,smsOptIn}`, `notes`, `stats.*` (`lifetimeSpendCents`, `orderCount`, `lastOrderAt`, `firstOrderAt`, `portfolioQuadrant`, …; read nested first, fall back to flattened `stats.x`). Some customers share an email (real duplicates → Customers "Duplicates" tab merges them; tenant-data issue, not a bug).

## OPEN BACKLOG (from the 3-persona QA panel — fix BEFORE category build/fan-out where engine-level)
### Tier 1 — engine-level (multiply ×40; fix first, re-QA after)
1. **🔴 P0 money $0.00 in detail** on dollar-denominated orders. Detail hooks use `(totalCents||0)/100`; list falls back to `o.total`. Fix: a **canonical money accessor** `money(record, centsField, dollarField)` used by list AND detail AND export. Repro: order SGTE-0029 → detail all $0.00.
2. **🔴 Keyboard/AT unreachable**: rows `<tr onclick>`, drill links `<span onclick>`, sort headers — none focusable/operable; slide-out has no focus-trap/`inert` background despite `aria-modal`. Make rows/links real buttons or `role+tabindex+key handler`; add Tab-trap + `inert` on `#content` (mirror `addToMastDrawer` in index.html ~14095).
3. **🔴 Close-timeout race**: shell `window.mastSlideOut.close()` (index.html ~17003) has an unconditional 220ms hide → quick re-open leaves `isOpen` true but `display:none` (the recurring "panel vanished"). Guard the timeout (generation counter / re-check `_state.open`).
4. **Contrast fails AA**: `--warm-gray #888` (4.05:1) used pervasively; teal links (2.88:1); near-invisible header icons. Raise to ≥4.5:1.
5. **Empty-value handling**: blank Name cell, panel title just "Customer" (no id), bare status dot. Centralize "—" in `displayCell` for empty scalars; title falls back to email/id when first field empty.
6. **Enums as free text**: Status edits as `<input>` (accepts "banana"). Add a `select` renderer for `type:'select'/'status'` with `options`.
7. **Token/light-mode**: component inline styles use `var(--charcoal,var(--text))` where `--text` is dark-only → light breakage. VERIFY the agent's "circular `:root` token" claim (`--amber:var(--amber)`) before acting — may be a misread; the legacy app works, so tokens are likely defined in index.html `:root`. Fix at root with the known shell light-mode work.
8. **Cross-customer order leakage**: `customers-v2 fetch` matches `customerId OR email` → shared-email customers show each other's orders. Match `customerId` only.

### Tier 2 — schema/pattern (orders-v2/customers-v2; they set the fan-out template)
- Status filter pills hardcoded subset (6 statuses unreachable; pills sum 42≠53) → derive pills + tone from data/enum.
- snake_case statuses render raw ("Return_received") → humanize (`replace(/_/g,' ')` + title-case) + a label map.
- "tracking" advertised editable but is `get()`-shadowed read-only → fix claim or make editable.
- `source` wrongly rendered as a status dot-badge (it has `tone`) → plain text; drop `tone` from non-status fields.
- Customer "Orders: 41" tile vs "Orders (8)" card (truncated `_recentOrders`) → label "Showing 8 of 41".
- Stale Expand button after lg→md drill → rebuild/clear header controls each open.
- Duplicate feedback button (shell FAB still in a11y tree + header one) → hide FAB while panel open.
- Two filter paradigms (orders=pills, customers=search) → standardize (pills for enum facets, search for identity).
- Tile grid fixed 4-col too dense at md → responsive (`auto-fit minmax`).

### Tier 3 — polish / a11y niceties
`:focus-visible` rings (none exist); `paneTabsBar` ARIA (tablist/tab/aria-selected, arrow keys); sortable `th` `aria-sort`+button; `imageThumb` aria-label; lightbox as managed dialog (focus + remove stale Esc listener); `rowActions` span→button; kv right-align truncates long emails (left-align text); edit-form lead with editable fields; suppress read-mode status badge in edit mode.

### Previously known (still open)
- **Activity timeline** oversimplified (only Placed→current) → build from `statusHistory` (all sub-steps) + **link Pack/Ship records** (in `fulfillmentLog` / pickship workflow).
- **Table/panel right-edge clip** on narrow windows: `.mast-table-wrap{overflow:hidden}` + lg panel can exceed viewport → `overflow-x:auto` + contain panel; don't right-align money into the clip zone.
- **"unclassified" segment label** too technical (from `portfolioQuadrant`) → friendlier labels.

## Decisions locked (don't relitigate)
One slide-out for view/edit/create (read=template, edit=form); tabs hierarchy (one `mastTabs`, ≤2 levels, not for filtering); table-vs-card by item identity; **no invented fields — only real data-model fields**; dark+light parity required; cross-object links open the target's OWN category template; **drill/back = panel-local stack** (NOT route nav); title prefixed with object type ("Order: X"); icons not emoji; `tags` field type seeds a future **user-defined tag system** (OPEN ITEM, all objects); **open-ended/declarative filtering** is an OPEN ITEM. Customer Location = one field from the linked contact rendered as a drill link.

## Process & gotchas (important — these bit us repeatedly)
- **Branch fresh off `origin/main` for EVERY change.** Branches squash-merge, so reusing a merged branch causes cherry-pick/divergence pain. `git fetch origin main && git checkout -b <name> origin/main`.
- **Bump cache version** when touching `app/index.html` or `app/modules/*.js`: `bash scripts/bump-modules-version.sh` (CI `lint-cache-bust` fails PRs otherwise). The hook is NOT installed locally.
- **Verify before commit:** `node --check <file>`, `node test/*.test.js`, `node scripts/lint-ux-standards.js` (ratchet), `node scripts/lint-design-tokens.js` (font 7-scale BLOCKING: 0.72/0.78/0.85/0.9/1.0/1.15/1.6rem; hex advisory — keep engines hex-free), `lint-rbac.js`, `lint-mastdb.js`, `lint-module-info.js`.
- **Deploy:** PR → merge to main → GHA `deploy.yml` auto-deploys to the **dev pod** (`mast-tenant-shared`, serves sgtest15) in ~1min. Prod is operator-driven (`mast_hosting`). Never push `main` directly.
- **Live viewing:** add `?cb=<timestamp>` to bust the index.html cache; flag via `?ui=1`. Boot shows "Still loading…" overlay sometimes — reload + wait ~10s.
- **History ↔ overlay conflict:** writing `location.hash` (deep-link) fires `hashchange` → the SPA router tears down the open overlay. That's why `deepLink` is DISABLED. Any URL-state work must use `history.replaceState` + a router guard, and not while an overlay is open.
- **QA panel** (re-runnable): three `general-purpose` agents — UX-consistency, data-edge-cases, accessibility — each reads the engine source + drives `?ui=1` live in its own Chrome tab. Prompts are in this session's history; re-spawn per category rep.

## RECOMMENDED PLAN for the new control session
1. **Batch-fix Tier 1** (engine-level, hardens all categories) → re-run the QA panel to confirm. (Verify the money bug + circular-token claim first.)
2. **Tier 2** schema/pattern fixes on orders-v2/customers-v2.
3. **Build the remaining category templates** (Catalog→product, Event→show, Config→promotion/policy, Message→CS-ticket): mock → user approves → build on hardened engine → QA-panel each.
4. **Fan out** within all categories using agents (one per module, flag-gated PR each, through the ratchet): Transaction → invoices/POs/RMAs/wholesale/consignment; Party → contacts/students/team/vendors; etc. See `09-conversion-inventory.md` (on docs PR #75) for the per-module wave list.

## Pointers
- Open docs PR **#75** (`docs/ux-audit-spec` branch) holds the full standards 00–15 (rubric, scorecards, standard, slide-out spec, conversion inventory, polish, north-star mock). On `main`: `16-enforcement-and-guardrails.md`, `17-data-capability-map.md`, `CONTROL-PLANE.md`, `templates-mock.html`, this file.
- Worktree used this session: `/tmp/mast-tt-ui-redesign`.
- Merged PRs this session: engine + proof + ~13 fixes (#77, #78–#92), all on `main`.
