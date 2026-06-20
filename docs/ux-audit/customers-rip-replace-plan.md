# customers.js retirement — rip-and-replace cut plan (T6)

**Verdict: build customers-v2 to parity on the entity engine, then absorb the bridge
and delete V1.** `app/modules/customers.js` (3,540 lines) is NOT deeply coupled like
orders was — it is a **thin-consumer / fat-feature** module: only a handful of cross-module
globals point at it, and its V2 twin already delegates every write through `CustomersBridge`.
The blocker is a **genuine parity gap** (4 features the twin lacks), not a tangle of staying
consumers. This is rip-AND-replace: the missing features get **rebuilt on the MastEntity
engine**, not ported from V1's bespoke code.

Assessed 2026-06-20 against **`origin/main` @ c8a3babd** (NOT the working-tree branch —
see the staleness note below). All line numbers are origin/main.

> ⚠️ **Staleness correction (load-bearing).** The session branch
> `feat/readiness-shared-core` is **455 commits behind origin/main** and carries a
> *stale 260-line* `customers-v2.js`. The prior abort note
> (`project_customers_v1_retirement_blocked.md`) and this plan were re-derived against
> origin/main's **541-line** `customers-v2.js`, which is materially richer (the "Classic
> burn-down Wave E" write affordances + Activity/Classes/Wallet facets landed in #109/#110
> *after* the branch diverged). Anyone executing this **must** rebase onto origin/main
> first; a gap analysis against the working tree will be wrong.

---

## 1. Why it's not a one-PR delete

Two independent reasons, neither of which is "staying modules consume the lifecycle" (the
orders blocker):

### A. customers-v2 is a real subset — 4 parity gaps
`customers-v2.js` (541 L) already covers: list + search + sort-by-column, **saved-segment
CRUD** (apply/save/rename/delete via `CustomersBridge`), CSV export, duplicates link,
recompute-stats, the **party detail** (tiles / contact / related-orders / segments / notes /
classes / activity / wallet) with **write affordances** (tag add/remove, newsletter+SMS
opt-in, notes, add-contact, **wallet adjust**), inline edit (name + email + phone), and Ask AI.
All writes already route through `window.CustomersBridge`. So buildout is **additive**.

What it does **not** have (verified by reading both files end-to-end):

| # | Gap | V1 surface (origin/main) | V2 today |
|---|-----|--------------------------|----------|
| 1 | **Customer certifications** | `renderCertsSubsection` (1585) inside the **Classes** tab; `loadCustomerCerts` (1681) reads `admin/customers/{id}/certifications` + `admin/certTypes`; grant `customersGrantCertOpen/Confirm` (1709/1734) → delegates to **book.js `_bookGrantCert`**; revoke `customersRevokeCert/Confirm` (1763/1797) writes `…/certifications/{certId}` `{revokedAt,revokedBy,revokeReason,revokeNote}`; `customersToggleRevokedCerts` (1673) | **ZERO** certs surface |
| 2 | **Interactive list filters** | filter bar: search, `customersWholesaleFilter`, `customersSourceFilter`, `customersTagFilter`, `customersLastOrderBefore`, `customersMinSpend`, `customersNewsletterOnly`, `customersLeadsOnly` (read by `readFilters`, ~521) → feeds the **shared** `MastCustomerFilters.matches` | **search box + saved-segment dropdown only**; can *apply* a saved segment but cannot *author* the filter vocabulary (saveSegment captures only `search`) |
| 3 | **Advanced sorts** | `SORT_OPTIONS` (132): updatedAt, createdAt, name, email, spend, orders, **lastOrder**, **lapseScore**, **grossMargin** | sorts only by the 6 visible list columns (header click) |
| 4 | **Activity richness** | `renderActivityTab` (2129) — **type-filter** pills (`customersSetActivityFilter`), source coloring, drill-in (`customersOpenActivityDrillIn`, 2223) to **book-detail / orders / cs-tickets / cs-reviews / cs-surveys** | flat read-only timeline (orders + enrollments + "note on file"), no filter, no drill |

### B. The write layer lives in V1 and is consumed past the twin
`window.CustomersBridge` is **defined in customers.js** (3240) and the merge / wallet-adjust
globals are consumed by **other** V2 modules. Deleting customers.js without re-homing these
breaks duplicates-v2, loyalty-v2, and contacts.js. (Full map in §4.) This is the orders-core
problem in miniature — small enough to solve in one keystone PR.

### Routing facts (the cut gate)
- `customers.js` manifest entry owns `routes: ['customers']` (20904); `customers-v2.js`
  owns `routes: ['customers-v2']` (20907).
- `MAST_V2_ROUTE_MAP['customers'] = 'customers-v2'` (19574). With **V2 default since
  2026-06-11** (`mastLegacyUiOn()` defaults false → `mastUseV2Routes()` true; the body-top
  boot seeds `mastUiRedesign='1'`), navigating to `#customers` **already resolves to the
  twin** for every normal user. customers.js V1 UI is reachable **only** via an explicit
  Legacy-UI opt-in or `navigateToClassic('customers')` — and **customers-v2 has no
  "view classic" hatch**, so the V1 features are *already* unreachable for default users.
- **Consequence:** the parity gap is a *latent regression that already shipped* — default
  users lost certs/filters/sorts/activity when V2 became default. Closing it is catch-up,
  and the deletion blast-radius is small (V1 UI is dark in V2 mode; smoke never renders it).

---

## 2. Engine-migration design (rebuild, don't port)

The rule (standard-record-ui §1, "raise the engine, don't fork it"): rebuild each gap on
`MastEntity` / `MastUI` / the shared predicate, not by copying V1's hand-rolled DOM.

### Gap 1 — Certifications → a new opt-in **party facet** (engine + module + core)
- **Engine (additive):** extend `renderParty` in `shared/mast-entity.js` to render a
  **Certifications** tab when the schema supplies `detail.certifications(r)` — exactly how
  `activity` / `classes` / `wallet` are already optional facets (mast-entity.js 331–354).
  The facet renders a `MastUI.cardTable` of active certs + a collapsible revoked/expired
  group, with an **RBAC-gated** "Grant" action and per-row "Revoke". No new template — it
  composes the same primitives, so it cannot drift. Unit-test the pure facet-tabs derivation.
- **Module (customers-v2):** add `detail.certifications(r)` (reads `r._certs` / `r._certTypes`
  hydrated in `fetch`), plus `CustomersV2.grantCert(id)` (delegates to **book.js
  `_bookGrantCert`** via `loadModule('book')` — same helper V1 uses, *zero* reimplementation
  of grant logic) and `CustomersV2.revokeCert(id, certId)` (→ `CustomersBridge.revokeCert`).
- **Core (write):** add `revokeCert` to `CustomersBridge` wrapping the existing field-scoped
  `MastDB.update('…/certifications/{certId}', {revokedAt,revokedBy,revokeReason,revokeNote})`.
- **RBAC win:** V1 grant/revoke have **no `can()` guard** (reachable only from the admin
  button). V2 must gate the affordances *and* the handlers (`can('customers','edit')` +
  defense-in-depth) per standard-record-ui §6 — a security improvement, not just a port.
  ⚠️ Verify the intended axis at build time (grant already self-gates inside `_bookGrantCert`;
  confirm whether certs should key on `customers:edit` or a classes/instructor axis).

### Gap 2 — Interactive filters → module-glue over the **shared predicate** (already exists)
`shared/customer-filters.js` (`MastCustomerFilters.matches`) is **the canonical matcher** and
is *already* used by customers-v2's segment apply (line 280–285), legacy list/export, and the
CS bulk-survey send. So this is **not** a port — it's a small filter-bar built from `MastUI`
form controls that produces the **same filter object** the matcher already consumes:
- Render a compact control row (source `<select>`, wholesale `<select>`, tag `<select>`,
  last-order-before `<input type=date>`, min-spend `<input>`, newsletter/leads checkboxes)
  above the list; on change, build `{source,wholesale,tag,lastOrderBefore,minSpendDollars,
  newsletterOnly,leadsOnly,search}` and filter `visibleRows()` through
  `MastCustomerFilters.matches(r, f, { isWholesale: CustomersBridge.isWholesale })`.
- Wire `saveSegment` to capture this **full** vocabulary (today it persists only `search`,
  line 354–355) — so saved segments round-trip identically across V2 / legacy / CS.
- Source list + wholesale resolver already exist (`MastCustomerFilters.makeWholesaleResolver`
  / `CustomersBridge.isWholesale`). No new persistence shape.

### Gap 3 — Advanced sorts → **schema fields + a sort control** (reuse `mastSortRows`)
The list already sorts via `window.mastSortRows` resolving `field.get(r)` (line 294–297). Add
stat-derived, **non-list** sortable fields to the schema — `lastOrderAt`, `lapseScore`,
`grossMargin12m` (each `get: r => stat(r, …)`, `list:false`) — and render a small sort
`<select>` (the V1 `SORT_OPTIONS` set) that sets `V2.sortKey`. `visibleRows` already routes
through the field `get()`, so no bespoke comparators — the engine sorts them. (Numeric stats
sort numerically via the engine's value resolution; verify lapseScore/grossMargin tie-breaks
match V1's `(b-a)` direction.)

### Gap 4 — Activity richness → enrich `detail.activity` + engine drill
- **Drill-in:** make timeline rows clickable via `MastEntity.drill('orders-v2', id)` /
  `drill('contacts-v2', id)` (the engine's in-panel drill, mast-entity.js 366) instead of
  V1's `navigateTo + setTimeout` race. For cs-tickets/reviews/surveys (no entity twin yet),
  fall back to `navigateTo(route)` then the guarded `csOpen*` entrypoint (as V1 does, 2245+).
- **More event types + coloring:** broaden the `activity(r)` builder (orders, enrollments,
  certs grant/revoke, wallet adjustments, notes) with per-type tone.
- **Type filter:** add an optional `detail.activityFilters` to the engine party facet (pills
  that re-project the timeline) — additive, mirrors the filter pattern. *If the engine change
  is undesired, a `detail.render` custom interior is the fallback, but the facet is on-pattern.*

---

## 3. Recommended PR sequence

Five shippable PRs; each independently dev-verifiable on **sgtest15** and gated by boot smoke
+ `lint-manifest-integrity`. Optional splits noted → realistic range **5–7 PRs**.

### PR1 — Keystone: extract `shared/customers-core.js` (refactor, **zero behavior change**)
Move the cross-module-shared, non-UI write layer out of customers.js into a new **lazy** core,
keeping the exact `window.*` names so call sites are untouched. Contents:
- `window.CustomersBridge` + its impls: `saveCustomerField`, `setTags`, `saveNotes`,
  `listSegments`/`saveSegment`/`renameSegment`/`deleteSegment`, `setMarketingOptIn`,
  `addContact`(→`addContactToCustomer`), `recomputeStats`, `merge`(`mergeCustomers`),
  `isWholesale`(`isWholesaleCustomer`).
- The **merge** core (`mergeCustomers`), the **wallet-adjust** modal + CF call
  (`openWalletAdjustModal` / `submitWalletAdjust` → `adjustCustomerWallet`, audits
  `admin/walletAdjustments`), `addContactToCustomer`, and the cert **load/revoke** helpers
  (`loadCustomerCerts`, the revoke `MastDB.update`).
- Re-export the legacy global names the survivors call: `window.customersMerge`,
  `window.customersOpenWalletAdjust`, `window.customersOpenDetail` (alias → `CustomersV2.open`),
  `window.customersAppendLinkedContact`.

Repoint consumers to `loadModule('customers-core')`: customers-v2 (`withBridge` + `adjustWallet`),
duplicates-v2 (`customersMerge`), loyalty-v2 (`customersOpenWalletAdjust`), contacts.js
(`customersAppendLinkedContact`). customers.js's V1 UI keeps working by `await
loadModule('customers-core')` in its route setup (it's a doomed file, but must not break in
legacy mode mid-sequence). **Fully smoke + dev verifiable; no UI change.** *(Optional split:
PR1a = CustomersBridge + segment/field/stats; PR1b = merge + wallet-adjust modal + certs core.)*

> *Alternative considered:* absorb straight into customers-v2 and re-export globals (skip the
> core file). Rejected as the primary path because three **surviving** modules
> (duplicates-v2 / loyalty-v2 / contacts) consume these globals and would all have to
> `loadModule('customers-v2')` (a flag-gated UI module) just to reach a write helper — the
> orders-core precedent (a dedicated non-UI core) is cleaner and keeps customers-v2 UI-only.

### PR2 — Certifications facet (engine + customers-v2 + core)
Engine party-template cert facet (additive, unit-tested) + customers-v2 `detail.certifications`
+ grant (book.js `_bookGrantCert`) + revoke (`CustomersBridge.revokeCert`) + RBAC gating.
**Revenue-neutral but RBAC-sensitive** (adds the guard V1 lacked). Dev-verify: grant a cert,
see it active; revoke with reason → moves to revoked group, history preserved; non-editor sees
no affordances. *(Optional split: PR2a engine facet + tests; PR2b module + core.)*

### PR3 — List parity: interactive filters + advanced sorts (customers-v2)
Filter bar → shared `MastCustomerFilters.matches`; `saveSegment` captures the full vocabulary;
stat-derived sort fields + sort control. Dev-verify: each filter narrows correctly; save a
segment with wholesale+source+minSpend, reload, re-apply → identical set; CS bulk-send reads
the same segment identically (cross-surface check); each sort orders correctly incl.
lapseScore/grossMargin. *(Optional split: filters / sorts as two PRs.)*

### PR4 — Activity richness (engine party facet + customers-v2)
Drill-in via `MastEntity.drill`, broadened event types + coloring, optional type-filter pills.
Dev-verify: click an order event → drills to orders-v2 SO; class event → book-detail; filter
pills project correctly.

### PR5 — Route cutover + delete customers.js
- Drop customers-v2's `if (!flagOn()) return;` gate; claim `routes: ['customers-v2','customers']`
  (blog-v2 / rma-admin precedent) so it serves **all** users regardless of Legacy flag.
- Remove the `MAST_V2_ROUTE_MAP['customers']` pair; drop the customers.js manifest row;
  `git rm app/modules/customers.js`.
- Hand-extend the ux-standards / no-local-fmt / sink **baselines** for any relocated debt
  (verbatim, never `--update`); bump per-file cache-bust; regen `admin-inventory.md`.
- smoke ROUTES already lists `customers` + `customers-v2`; add a **facet smoke step** that
  opens a customer record and asserts the certs/activity panes render (mirrors the
  maker-settings sub-view smoke check). `lint-manifest-integrity` must show **no dead
  `loadModule('customers')`** (every site now resolves to `customers-core` / `customers-v2`).

**Why this order:** PR1 removes the write-layer blocker with zero UI change (lowest risk,
makes customers.js pure dead-UI). PR2–PR4 close the parity gap behind the live engine, each
shippable on its own. PR5 is then a mechanical route-claim + delete, gated by smoke +
manifest-integrity. Note PR2–PR4 are *catch-up* (default users already lost these), so they
can ship in any order / partially without regressing the current shipped state.

---

## 4. Coupling map (word-boundary verified, origin/main)

**`CustomersBridge`** — defined customers.js:3240; consumed **only** by customers-v2 (twin).
→ Re-homed to `customers-core` in PR1.

**Cross-module consumers of customers.js globals:**

| Global | Real consumers | Mechanism | Retarget |
|--------|----------------|-----------|----------|
| `customersOpenDetail` | cart.js:162 (direct onclick), customer-service.js:2618 (typeof-guard), finance.js:6495 (typeof-guard) | bare/guarded global; **none `loadModule`** | alias → `CustomersV2.open`; add `loadModule('customers-core')` ensure at the 3 sites (cart's onclick especially — today it **throws** in V2 mode since V1 isn't loaded) |
| `customersMerge` | duplicates-v2.js:158–163 (real; `loadModule('customers')` at :159) | guarded + ensure-load | repoint ensure to `customers-core`; call `CustomersBridge.merge` / `window.customersMerge` |
| `customersAppendLinkedContact` | contacts.js:622 (typeof-guard) | in-memory sync after linked-contact create | provide from `customers-core`; ensure-load in contacts.js |
| `customersOpenWalletAdjust` | loyalty-v2.js:489 (real; `loadModule('customers')` at :488) **+** customers-v2.js:472 (twin) | ensure-load + global | repoint ensure to `customers-core` |

**Entity-level consumer (no change needed):** `customer-portfolio-v2.js` renders
`MastEntity.renderList('customers-v2', …)` (:94) and `MastEntity.drill('customers-v2', id)`
(:137) — depends on the **customers-v2 entity**, not customers.js. It keeps working as long as
customers-v2 stays registered + drillable (it does). Worth a regression check in PR5.

**False positives ruled out:** customer-service.js:2789 `customersMerge` = comment;
contacts.js's own `viewContact` and cs's `csOpenThread` are **consumed by** customers (not
exported) and survive untouched.

**`loadModule('customers')` sites today:** customers-v2 (×2), duplicates-v2, loyalty-v2 — all
four repoint to `customers-core` in PR1. (customers.js V1 UI is reached only via the manifest
route in legacy mode / `navigateToClassic`.)

---

## 5. Risks & verification

- **Revenue / money-touching:** the **wallet-adjust** path (`adjustCustomerWallet` CF, audits
  `admin/walletAdjustments`) and **merge** (rewrites emails/phones/linkedIds/tags/notes/
  marketing across two records) move verbatim in PR1 — **byte-faithful move, no logic edit**,
  and dev-verify an actual wallet adjust + a real duplicate merge on sgtest15 after PR1.
- **RBAC:** PR2 *adds* a `can('customers','edit')` gate + defense-in-depth to cert grant/revoke
  (V1 had none). Verify the correct axis and that hidden controls can't be console-driven.
- **Cross-surface segment integrity:** filters in PR3 must produce the **exact** persisted
  shape `MastCustomerFilters.matches` expects (the D4-005 bug class — a narrowing key silently
  dropped over-includes a survey segment). Round-trip a saved segment through V2 **and** the CS
  bulk-send to confirm identical membership.
- **`fetch` cost:** adding certs + richer activity to `customers-v2.fetch` adds reads per
  record-open. Keep them in the per-record `fetch` (lazy, on open), never the list `load()`.
- **Legacy-mode engine availability:** PR5 makes customers-v2 serve Legacy-UI users too —
  confirm `MastEntity`/`MastUI`/`MastIO` are loaded in legacy mode (they're shared/eager), and
  that dropping the `flagOn()` gate doesn't double-register the entity.
- **What could regress:** `customer-portfolio-v2` list/drill (entity dependency); the
  duplicates-v2 merge ensure-load; loyalty-v2 wallet adjust; contacts.js linked-contact sync.
  Each is one guarded call site — verify all four after PR1 and again after PR5.
- **Gates per PR:** `node --check` + full lint suite (rbac, mastdb, customer-writes,
  ux-standards, manifest-integrity), per-file cache-bust, regen `admin-inventory.md`, boot
  smoke (52 routes incl. customers + customers-v2) green, + the new facet smoke step in PR5.
  Merge-train if DIRTY (rebase, `checkout origin/main -- <generated>`, regen).

## 6. Estimate
**5 PRs** core (PR1 keystone refactor → PR2 certs → PR3 list parity → PR4 activity →
PR5 cutover+delete), **5–7** with the optional splits. Lower coupling-risk than orders (no
staying-module bare-global lifecycle consumer); the real work is the **feature buildout**
(certs especially), which is why the prior clean-cut attempt correctly aborted.
