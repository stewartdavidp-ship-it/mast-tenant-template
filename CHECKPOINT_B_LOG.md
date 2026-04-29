# Checkpoint B — Module Rename: Maker → Develop

**Branch:** `develop/B-rename` (from `main`)
**Date:** 2026-04-28
**Scope:** User-facing label rename only. No behavior change. No id/route/section/section-id renames.

## Decision summary

- **Keep id `'make'`** in MODULE_REGISTRY, `data-section`, `toggleSection('make')`, route maps, `hasModule('make')`, baseModules array, etc. Renaming the id would touch 15+ locations across navigation maps, dashboard cards, route resolution, and module manifest — too risky for a label-only checkpoint.
- **Keep filename `app/modules/maker.js`** and all internal function names (`makerCreateRecipe`, `getMakerSettings`, etc.) per plan recommendation.
- **Keep `settingsSubMaker` element id, `switchSettingsSubView('maker')` route, `loadMakerSettings()`** function names — only the visible labels changed.
- **Keep "Maker Details" / `pdMakerAttributes*`** untouched — those are jewelry product attributes (the artisan/maker as a domain concept), not the module rename.
- **Keep "Makers" group label in `business-entity-constants.js`** — that's the artisan-business-type taxonomy (Glass artisan, Jewelry maker, etc.), not the module name.

## Grep findings (Maker / make references)

| Reference | Type | Action |
|---|---|---|
| `app/index.html:5079` `<!-- Make -->` comment | comment | renamed to `<!-- Develop -->` |
| `app/index.html:5083` sidebar label `>Make<` | user-facing | → `>Develop<` |
| `app/index.html:5080` `data-section="make"` | id | KEPT |
| `app/index.html:5081` `toggleSection('make')` | id | KEPT |
| `app/index.html:6909` settings tab `>Maker<` | user-facing | → `>Develop<` |
| `app/index.html:6909` `switchSettingsSubView('maker')` | id | KEPT |
| `app/index.html:8196` HTML comment `Maker Settings` | comment | → `Develop Settings` |
| `app/index.html:8199` heading `Maker Settings` | user-facing | → `Develop Settings` |
| `app/index.html:10431` grid layout comment `Row1: Make, …` | comment | → `Row1: Develop, …` |
| `app/index.html:10433` MODULE_REGISTRY `name: 'Make'` | user-facing | → `name: 'Develop'` |
| `app/index.html:10433` description | user-facing | broadened to reflect product lifecycle / sourcing scope |
| `app/index.html:10433` `id: 'make'`, `section: 'make'`, routes | id | KEPT |
| `app/index.html:25912` toast `Maker module not loaded — open the Make tab` | user-facing | → "Develop module not loaded — open the Develop tab" |
| `app/index.html:26230` toast `Failed to load Maker module:` | user-facing | → "Failed to load Develop module:" |
| `app/index.html:26234` toast `Maker module loaded but Apply…` | user-facing | → "Develop module loaded but Apply…" |
| `app/modules/maker.js` (header, function names, vars, `getMakerSettings`, etc.) | internal | KEPT (per plan — defer to later checkpoint) |
| `shared/business-entity-constants.js` `group: 'Makers'` (8 entries) | domain taxonomy | KEPT — refers to artisan business types |
| `app/index.html` `pdMakerAttributes*`, `Maker Details`, jewelry maker attrs | domain feature | KEPT — product-level metadata, not the module |
| `admin/config/makerSettings` Firebase path | data path | KEPT — schema stability |
| `ARCHITECTURE.md` module table row | doc | renamed display label, noted file kept |
| `ARCHITECTURE.md` "### Maker Module Architecture" section | doc | renamed heading + lead sentence |
| `scripts/rewrite-entities.js` line 627 | one-shot script artifact | KEPT — not user-facing |
| Other "Maker"/"actorType === 'staff' ? 'Staff' : 'Maker'" badge in production-event log | role label (artisan as actor) | KEPT — refers to person, not module |
| `var order = ['Makers', 'Service', 'Other'];` (line 20868) | category sort order | KEPT — domain taxonomy |

## Files changed

- `app/index.html` — sidebar label, settings tab label, settings sub-heading, MODULE_REGISTRY entry, layout comment, 3 toast messages
- `ARCHITECTURE.md` — module table row + Develop Module Architecture heading

## Out of scope (Checkpoint C+)

- Removing the "Pieces" sidebar item (Checkpoint C)
- Renaming `maker.js` filename
- Renaming `getMakerSettings`, `makerCreateRecipe`, etc.
- Renaming `MODULE_REGISTRY['make']` id to `'develop'`
- Renaming `settingsSubMaker` id / `switchSettingsSubView('maker')` arg
- Migrating Firebase path `admin/config/makerSettings`

## Verification (post-deploy)

- [ ] Sidebar shows "Develop" (was "Make")
- [ ] Click Develop expands to: Jobs, Forecast, Materials, Pieces, Look Books, Procurement
- [ ] Each sub-item still navigates correctly
- [ ] Settings → Develop tab loads (was "Maker" tab)
- [ ] No console errors on load

## Commits / deploy

- Commit SHA: `d2bc659` on branch `develop/B-rename` (pushed to origin)
- sgtest15 deploy version: `sites/mast-sgtest15/versions/ff6fcbbbe2ead398` (158 files total, 3 uploaded, 155 cached)
- Verification: `curl https://mast-sgtest15.web.app/app/` → 15 occurrences of "Develop", sidebar-section-label confirmed `<span class="sidebar-section-label">Develop</span>`

## Status: READY FOR CHECKPOINT C
