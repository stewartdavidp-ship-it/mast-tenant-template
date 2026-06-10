# operations-v2 — Build Plan

Status: **PLANNED** (2026-06-10). Runs `v2-conversion-playbook.md` end-to-end for the
Operations section. 5 of 11 Operations sub-items already have a V2 surface (all clean
against `lint-v2-standard`); this plan covers the missing twins, the depth gaps in the
existing 5, and the holistic pass. Companion to `sales-v2-build-plan.md` /
`marketing-v2-build-plan.md` (worked examples) and `standard-record-ui.md` §10
(archetypes) — ratified decisions are applied here, not re-litigated.

## Scorecard — the 11 Operations routes (sidebar `data-section="operations"`)

| # | Route | Sidebar label | V1 source | V2 file | Status |
|---|-------|---------------|-----------|---------|--------|
| 1 | `trips` | Trips | trips.js (2,157L) | trips-v2.js (214L) | ✅ read-only twin — no writes; active-trip + retro-add stay legacy |
| 2 | `reports` | Reports | — (inline placeholder, "coming soon") | — | ⬜ non-goal — feature itself unbuilt; nothing to convert |
| 3 | `advisor` | Business Plan | advisor.js (1,401L) | — | ⬜ design discussion — dashboard, fits no archetype (see below) |
| 4 | `studio` | Studio | studio.js (788L) | — | ⬜ Wave 2 — config record (locations + equipment + hours) |
| 5 | `team` | Team | team.js (3,270L) | team-v2.js (395L) | ✅ bridge writes (TeamBridge); heavy sub-surfaces stay legacy |
| 6 | `business` | Business | — (inline `loadBusinessView`, businessTab) | — | ⬜ Wave 2 — config-singleton record over `admin/businessEntity` |
| 7 | `channels` | Channels | channels.js (2,797L) | channels-v2.js (386L) | ✅ read-only twin — connect/settings stay legacy |
| 8 | `mapping` | Channel Mapping | mapping.js (1,776L) | — | ⬜ Wave 1 — queue archetype; CF-backed confirm/unlink |
| 9 | `audit` | Channel Audit | audit.js (1,717L) | — | ⬜ Wave 1 — queue archetype over findings + suppress action |
| 10 | `contacts` | Contacts | contacts.js (1,656L) | contacts-v2.js (363L) | ✅ bridge writes (ContactsBridge) |
| 11 | `customers` | Customers | customers.js (3,485L) | customers-v2.js (312L) | ✅ bridge writes (CustomersBridge); moved in from Retention (W3e) |

Recon notes that shaped the plan (vs. the Sales/Marketing rounds):

- **No registry orphans.** All 11 routes have `mode-module-info.js` entries AND
  `MODE_ROUTE_VISIBILITY` entries — no `commission-terms`-style Wave 0 fix needed.
  `advisor` is soft-hidden (`{}`) by design; `business`, `contacts`, `customers` are
  `alwaysOn`.
- **The channel trio is one process split across three screens** (the Pack+Ship lesson,
  operations edition): channels (connect) → mapping (match listings) → audit (verify
  consistency). `mapping` and `audit` both declare `MODULE_DEPENDENCIES` on `channels`.
  Only channels-v2 exists; Wave 1 completes the trio so the channel story demos
  end-to-end.
- **Routing quirk:** `MAST_V2_ROUTE_MAP` already maps `suppressions →
  audit-suppressions-v2` — that is the J12 *suppression-rules manager*, a different
  surface from the `audit` findings viewer (J13). audit-v2 is a new module; the
  suppressions surface stays separate (it is reachable from audit-v2 via link).
- **Mapping's writes are already state-free** — `confirmListingMapping` /
  `deleteListingMapping` are Cloud Functions; mapping-v2 is a thin queue UI over the
  same CFs (no bridge-extraction refactor needed). Its first-connect interstitial
  behavior (`MastMappingFlow.checkAndMaybeShow`) is untouched — the V2 route serves the
  re-entry/delta case.
- **`audit_results` vocab is load-bearing:** findings state vocabulary is
  `shared/types/audit.ts` `AuditViolationState` (`active` | `snoozed` |
  `resolved-pending-recheck`) — match it exactly (wedge-audit lesson).
- **Singletons:** `business` + `advisor` both read `admin/businessEntity`, registered in
  `SINGLETON_COLLECTIONS`. Write via field-scoped create-or-merge `set()`, never
  `update()`.
- **`trips` is RTDB-compat** (`trips/{uid}`), not Firestore — trips-v2 already handles
  it; any new write path must use the same accessor.

## Archetype per sub-item (standard-record-ui §10 — no bespoke layouts)

| Route | Archetype | Shape |
|---|---|---|
| trips | **Record** (read) ✅ | history list + SO; active-trip pulse + retro-add stay legacy (live-tracking surface ≠ record list) |
| reports | — | unbuilt feature; archetype TBD when it ships (likely Composer) |
| advisor | **none — design discussion** | KPI dashboard + review-capture modal; closest precedent is the calendar *index control*, but the health-score/dimension layout is bespoke. Not a build ticket this round. |
| studio | **Record** ×2 lenses | Locations lens (record SO: identity + hours) + Equipment lens (per-location sub-records); config-flavored, mirrors brand-v2's read-on-page spirit but is a real list |
| team | **Record** ✅ | faceted record, bridge writes; Time Clock / PTO / Documents / Labor Burden stay legacy (classic escape hatches) |
| business | **Record** (singleton) | one record, no list — read-on-page detail (brand-v2 pattern) over `admin/businessEntity`; edit via engine form, field-scoped merge; regulatory fields (EIN, entityStatus) read-only in V2 |
| channels | **Record** ✅ + depth | add bridge-delegated light edit (name/notes/fee profile); connect/disconnect/wizard stay legacy |
| mapping | **Queue** | unmatched-listings worklist (fulfillment-v2 pattern): count badges, row = listing, action = match-to-product (or create), confirm via CF; matched list with unlink |
| audit | **Queue** | findings buckets by severity/state, row click opens finding SO, actions: suppress/unsuppress (bridge-extracted from audit.js), link to suppression-rules surface |
| contacts | **Record** ✅ | faceted record, bridge writes; interactions sub-records |
| customers | **Record** ✅ | faceted record, bridge writes; wallet adjustments stay CF-backed |

Deliberate non-goals (design discussions, not build tickets): the advisor dashboard
rebuild, the reports builder (feature doesn't exist), the team Time-Clock/PTO/Labor
sub-surfaces, the trips live active-trip surface, and the channel connect/OAuth wizard.
Each stays single-sourced on legacy with links from the V2 twins (blog-v2 precedent).

## Light/dark + standard compliance

`lint-v2-standard` + the hex/rgb token lint are live in CI; all 5 existing operations V2
modules are debt-free. Every new module arrives clean (scaffold via
`scripts/scaffold-v2-module.mjs`). Every wave's verify step includes one light + one
dark screenshot on sgtest15.

## Demo data (sgtest15 / Shir Glassworks — audit BEFORE building)

Operator-ratified rules (2026-06-10): realistic names/content only — no test/demo/harness
strings anywhere customer-visible, **including `source`-type fields**. Audit scope for
operations: `trips/{uid}`, `admin/employees`, `admin/businessEntity` (+ renewals/
documents), `config/studioLocations` + equipment, `admin/channels` (+ nested `mappings`,
listings), `admin/auditResults` + `admin/ruleSuppressions`, `admin/contacts` (+
interactions), customers + wallet. Hard deletes authorized on sgtest15 but reported.
Key fixtures: a channel with unmatched listings (powers the mapping queue demo) and a
few open audit findings (powers the audit queue demo).

## Waves (sequenced by end-to-end demo value)

### Wave 1 — complete the channel trio: mapping-v2 + audit-v2
The channel story is the strongest operations demo and today it dead-ends after
channels-v2. Both new modules are queues (fulfillment-v2 pattern).
- **mapping-v2**: queue over unmatched channel listings; match-to-product action →
  `confirmListingMapping` CF; matched lens with unlink (`deleteListingMapping`);
  cache-miss-safe drills to product + channel SOs.
- **audit-v2**: queue over `audit_results` findings (severity buckets, AuditViolationState
  vocab); suppress/unsuppress via a bridge core extracted from audit.js; link to the
  existing suppression-rules surface; drills to the offending product/channel.
*Demo:* open Channels → see the Shopify channel → Mapping shows 2 unmatched listings →
match them → Audit shows a price-drift finding on a mapped product → suppress it.

### Wave 2 — config records: business-v2 + studio-v2
After this wave every *built* operations feature has a V2 home.
- **business-v2**: singleton record over `admin/businessEntity` (identity, address, tax
  registration states read-only EIN); field-scoped merge writes; links to advisor for
  the plan-side view.
- **studio-v2**: Locations + Equipment lenses; bridge-extracted writes from studio.js
  (add/edit/delete location, equipment, hours) — current handlers are DOM-coupled.
*Demo:* fix the studio's Saturday hours → add a new kiln to Equipment → update the
business mailing address.

### Wave 3 — depth + cross-links on the existing five
- **channels-v2 light edit** (name/notes/fees) via a ChannelsBridge core.
- **Deletes** where appropriate (confirm + `writeAudit` + RBAC `can(route,'delete')`):
  contacts, customers (guard: no orders/wallet balance → else archive), studio
  locations/equipment, trips (retro-logged rows only). **Immutability respected:**
  trips with linked mileage deductions, employees (deactivate not delete), channels
  with order history (disconnect is the legacy action), audit findings (suppress ≠
  delete).
- **Cross-links** via `MastEntity.drill` + cache-miss fetch fallbacks: customer SO →
  orders; contact SO → linked orders/classes; channel SO → mapping queue + audit
  findings filtered to that channel; employee SO → labor entries (classic link).
*Demo:* open a customer → drill into their latest order → back; open the Shopify
channel → "3 open findings" → audit queue pre-filtered.

### Wave 4 — holistic pass (final PR)
- **Operator walk**: every nav item, every record, create/edit/delete, every link.
- **Sidebar reorder** around the operator's process (run the business → sell through
  channels → know your people): Business, Studio, Team · Channels, Channel Mapping,
  Channel Audit · Customers, Contacts · Trips, Reports, Business Plan.
- CRUD parity table finalized (below), `lint-v2-standard` green, light+dark proof.

## CRUD parity — target end-state

| Route | C | R | U | D | Notes |
|---|---|---|---|---|---|
| trips | classic | ✅ | — | ✅ retro rows | active trip + retro-add stay legacy this round |
| reports | — | — | — | — | unbuilt feature |
| advisor | n/a | classic | n/a | n/a | design discussion; stays V1 |
| studio | ✅ | ✅ | ✅ | ✅ | locations + equipment + hours via StudioBridge |
| team | ✅ | ✅ | ✅ | deactivate | employees never hard-delete (payroll history) |
| business | n/a | ✅ | ✅ | n/a | singleton; EIN/entityStatus read-only in V2 |
| channels | classic | ✅ | ✅ light | classic | connect/disconnect/wizard stay legacy |
| mapping | n/a | ✅ | ✅ (match) | ✅ (unlink) | CF-backed; queue, not records |
| audit | n/a | ✅ | ✅ (suppress) | n/a | findings written by platform job; suppress ≠ delete |
| contacts | ✅ | ✅ | ✅ | ✅ | delete = confirm + writeAudit; interactions cascade |
| customers | ✅ | ✅ | ✅ | ✅ guarded | only when no orders + zero wallet; else archive |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`.

## Debt / known leftovers (tracked, not blocking)

- [ ] **advisor** stays V1 — bespoke dashboard; needs an "index control / dashboard"
      archetype design discussion before any build.
- [ ] **reports** placeholder — archetype decision deferred until the report builder
      exists as a feature.
- [ ] **`suppressions` route mismatch** — `audit-suppressions-v2` is in
      `MAST_V2_ROUTE_MAP` but `suppressions` is not a sidebar item; reachable only by
      deep link + from audit-v2. IA question, not this round.
- [ ] **Team heavy sub-surfaces** (Time Clock, PTO, Documents, Labor Burden) stay
      legacy with classic escape hatches.
- [ ] **Trips active-trip surface** (start/stop, pulse) stays legacy.
- [ ] **Channel connect/OAuth wizard** stays legacy; channels-v2 links to it.
