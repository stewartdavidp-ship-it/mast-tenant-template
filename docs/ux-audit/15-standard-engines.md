# Standard Engines — schema-driven UI (strategy)

**The big idea.** MastFlow (the workflow engine) proved a pattern: a **declarative spec → standard input/output → generated UI flow**, with the engine owning logic and surfaces supplying thin resolvers. That same pattern is the highest-leverage way to *enforce* every standard in this audit. A hand-written standard (docs 02–14) relies on 41 modules choosing to comply; an **engine generates the on-standard UI from a schema**, so divergence becomes impossible by construction.

This doc maps where the engine pattern applies beyond workflows, ranked by leverage, and how each subsumes the standards we wrote.

## The MastFlow pattern to replicate
- Declarative **spec registry**, **validated at registration** (fail loud before any render).
- Engine owns **logic + state + I/O**; never touches the DOM.
- Surface registers thin **resolvers/handlers** (render slot, focus, action).
- Versioned specs; legacy-derivation hook for migration.

Apply the same shape to each engine below.

## The engine set (ranked by leverage)

### 1. Entity Engine — `mastEntity` (the keystone)
**Input:** one declarative entity schema — `{ key, fields[ {name,type,validation,group} ], list{columns,filters,sort,status}, statusEnum, permissions, recordPath }`.
**Output (all from that one schema):**
- the **list** (data-table + controls, sort, filter pills, bulk, empty/loading, export) → enforces [11](11-list-standard.md)
- the **slide-out** read/edit/create with form layout, validation, dirty-guard → enforces [05](05-surface-decision-record.md)/[08](08-slideout-component-spec.md)/[12](12-edit-flow-and-dirty-state.md)
- **import/export** columns derived from the schema → **round-trip free** ([13](13-data-import-export.md))
**Covers:** the ~30 entity-CRUD modules (orders, customers, contacts, products, team, vendors/procurement, wholesale, events, students, promotions, campaigns, consignment, tickets…).
**Why keystone:** one schema makes list + detail/edit + import/export + permissions consistent *by construction*. This is where most of the audit's divergence lives, so this engine retires most of it.
**Composes:** the Form, List, and Filter engines below (internal or standalone).
**Plugs into MastFlow:** entities with a lifecycle declare a `workflowKey`; MastFlow drives the status/phase dimension (orders already do this).

### 2. Form Engine — `mastForm`
**Input:** field schema (type, validation, groups, conditional visibility). **Output:** `.form-group` layout + validation display + Save/Cancel + dirty tracking + canonical data object. Standalone use: settings/config screens. (Sub-engine of `mastEntity`, but reusable.)

### 3. List/Table Engine — `mastList`
**Input:** `{ columns, source, filters, sort, rowActions, bulkActions }`. **Output:** the standard table + toolbar + bulk bar + empty/loading + export. Standalone use: read-only lists/logs (audit, email-log).

### 4. Filter/Query Engine — `mastFilter`
**Input:** filter spec. **Output:** filter pills + URL state + a query predicate. Shared by `mastList` and `mastReport` so filtering is identical everywhere ([10](10-tab-and-navigation-hierarchy.md): pills, not tabs).

### 5. Report Engine — `mastReport`
**Input:** `{ period, metrics[], series, table, export }`. **Output:** the **report archetype** — period bar + color-coded KPI cards (tokens) + table + CSV. **Covers:** finance, financials, advisor dashboards, sales/AR/AP aging. Retires the per-module report hand-rolling (and finance's 320 hardcoded hex).

### 6. Import/Export Engine — `mastIO`
**Input:** the **entity schema** (same as #1). **Output:** template, column mapping (mapping.js heuristics), validation, commit, result+errors — round-trippable by design ([13](13-data-import-export.md)). Generalizes today's mapping.js.

### 7. Wizard/Stepper Engine — `mastWizard`
**Input:** linear steps + per-step validation + state. **Output:** consistent multi-step flow chrome. **Covers:** the import wizard, mapping setup, onboarding, day-close. (Sibling to MastFlow: MastFlow = gated *record* lifecycle; `mastWizard` = transient *task* flow — the logged slide-out exceptions in [09](09-conversion-inventory.md).)

### 8. Action Engine — `mastAction`
**Input:** action defs `{ label, icon, permission, confirm?, audit?, handler }`. **Output:** consistent buttons / row ⋯ menus / bulk actions, with **`mastConfirm` gating + `writeAudit`** wired uniformly, labels per the terminology lexicon. (MastFlow's `actionHandlers` is a precursor.) Enforces [02 §3/§4](02-standard.md).

### 9. Permission/Capability Engine — `mastCan`
**Input:** role → capability map. **Output:** consistent gating of fields, actions, exports, routes. Centralizes the access checks currently scattered in `navigateTo`. Feeds every other engine.

### 10. Dashboard/Card Engine — `mastCards`
**Input:** summary card defs `{ count-query, label, deep-link target }`. **Output:** the dashboard + per-module landing summaries (deep-link into a filtered list). Covers home/dashboard/advisor.

## The architecture in one line
**One entity schema → list + detail/edit + import/export + permissions + report, all on-standard.** MastFlow adds the lifecycle dimension; `mastWizard` covers transient flows; the media/file controls ([14](14-media-file-and-os-controls.md)) are the shared inputs these engines embed. This is a **metadata/schema-driven UI layer** — the standards stop being guidelines and become the output of an engine.

## What should NOT be an engine
Genuinely creative/WYSIWYG surfaces — the page-sized **builders** (blog, newsletter, lookbook, composer editors). They *consume* the shared components (image picker, file upload, slide-out for create/quick-view) but their canvas is bespoke. Keep them hand-built; don't force a schema.

## How this changes the migration plan ([04](04-divergence-and-plan.md), [09](09-conversion-inventory.md))
Two strategies — recommend the hybrid:
- **(A) Per-module conversion** (current plan): hand-convert each module to the standards. Faster to start, but 41× the work and relies on discipline to stay on-standard.
- **(B) Engine-first:** build `mastEntity` (+ Form/List/Filter) and re-express modules as schemas. Bigger upfront cost; afterward, modules are short schemas and *cannot* drift.
- **Recommended hybrid:** build the **Entity Engine** during Wave 0 alongside the slide-out (they're the same surface work), prove it on the reference modules (orders/customers) as **schemas**, then convert the ~30 CRUD modules by **writing schemas** instead of hand-editing UI. Keep `mastReport` as a fast-follow for the finance/report cluster. Builders and wizards stay bespoke (using shared components/engines where they fit).

## Suggested decision
Adopt the **Entity Engine as the keystone of Wave 0** (it *is* the slide-out + list + form + import/export work, unified behind a schema), with **Report**, **Action**, and **Permission** engines as the next tier. This converts "comply with 14 standards across 41 modules" into "define a schema; the engine guarantees compliance."
