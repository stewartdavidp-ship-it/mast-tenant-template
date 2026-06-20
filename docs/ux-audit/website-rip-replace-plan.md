# website.js retirement — rip-and-replace cut plan (T6)

**Verdict: re-home the cross-module write layer into a `shared/website-core.js`, relocate
the AI import wizard into a dedicated lazy module (a genuine feature relocation — the
engine does NOT cover it), then delete the now-dead legacy tab UI.** `app/modules/website.js`
(3,480 lines) is the website holdout. Unlike customers, the parity work is **narrow** —
website-v2 already has FULL builder parity (looks/colors/fonts/logo/layout/sections/
categories/testimonials/preview/words-import). The **only** user feature website-v2 lacks
is the **AI import wizard** (catalog crawl → cherry-pick → import → enrich → review/publish →
draft templates). The blockers are (a) that one parity gap, (b) a **delegated DESTRUCTIVE
template-switch cascade** that lives in V1 and is consumed by the twin, and (c) a **category
manager dialog** consumed by *three* other surfaces. None is "staying modules consume the
lifecycle"; all three are re-homing problems.

Assessed 2026-06-20 against **`origin/main` @ a6dcd078** (NOT the working-tree branch — see
the staleness note). All line numbers are origin/main.

> ⚠️ **Staleness correction (load-bearing).** The session branch
> `feat/readiness-shared-core` is **459 commits behind origin/main**. This plan was
> re-derived end-to-end against origin/main's website.js (3,480 L) and website-v2.js
> (2,611 L). The prior abort note (`project_website_v1_retirement_blocked.md`) was assessed
> at the older `9815351d`; two of its facts are now **stale** and were corrected here:
> (1) `wpSwitchTab` has **zero** external consumers (the setup-wizard deep-link was repointed
> to `navigateToClassic` by #716); (2) the import "View Report" entry moved to
> `index.html:45971`. Anyone executing this **must** work off an origin/main worktree.

---

## 1. Why it's not a one-PR delete

Three independent reasons:

### A. One real parity gap — the AI import wizard (~1,100–1,500 L, no V2 home)
website-v2 has only a **words-only** import: `WebsiteV2.copyFromSite` (website-v2.js:2111)
calls the `analyzeExistingSite` CF and fills exactly **5 fields** (heroHeadline, heroSub,
aboutText, contactEmail, contactPhone) — self-contained, no catalog. website.js hosts the
**full** import wizard:

| Sub-surface | website.js (origin/main) |
|---|---|
| **Analyze a site** | `wpAnalyze` (2235) → CF `analyzeExistingSite`; renders apply chips + Site Profile + scored Template Match + "Draft Template Created" |
| **Crawl + import jobs** | `wpStartImport`/`doStartImport` (2681/2637) create `webPresence/importJobs/{id}`; live-subscribed by `startImportJobsListener` (314); `renderActiveImportJobs` (1237), `renderImportProgress` (1507) |
| **Cherry-pick** | `renderCherryPickSection` (1257), `wpImportAll`/`wpImportCherryPicked` (2725/2737) flip job `status:'importing'` + write `cherryPickExclude` |
| **Collection report + AI enrich** | `renderCollectionReportSection` (1540), `renderGapAnalysisTable` (1641), `wpRunEnrichment` (1711) → CF `runEnrichment` |
| **Review + publish** | `renderReviewProducts` (1761), `wpPublishProduct`/`wpPublishAllProducts` (2495/2507) → `public/products/{id}` status flips; blog/events review are stubs |
| **Draft templates** | `wpReviewDraft` (3250) … `wpSaveDraftAsTemplate` (3397) writes `public/config/theme` + `public/config/draftTemplate` |

Line ranges: render block **1108–1869**, handlers **2235–2778**, draft-template **3249–3447**.
The import-specific surface is **~1,100–1,200 L** (more if you count the `wpApply*` analyze-
result appliers that partially overlap copyFromSite). **The backend CFs
(`analyzeExistingSite`, `runEnrichment`, plus the server-side `processImportJob`) live in
`mast-architecture` and STAY** — only the *client UI* moves.

### B. The destructive template-switch cascade lives in V1 and the twin delegates to it
`window.WebsiteBridge` (website.js:**2942**, 11 methods) is the twin's write layer for
Look & Feel. website-v2's Looks gallery delegates the whole switch:
`previewSwitch` (called website-v2.js:1905) → `captureThemeState` (378) → `switchTemplate`
(380) → on Undo `restoreThemeState` (1925); plus `getTemplates` (2540), `setCustomColors`
(646), `setThemeField` (675, 2090), `saveCategories` (1327, 2322), `slugForCategory` (1338).
`switchTemplate` runs `window.wpConfirmSwitch` (2011) →
`computeGalleryMigration` (1896, pure) + `executeGalleryMigration` (1958, **writes**
`public/gallery/{id}/templateHidden|templateHiddenSection|templateHiddenFrom`) + writes
`public/config/theme/*` (templateId/colorSchemeId set; primaryColor/accentColor/fontPair/
designScale/navStyle/heroVariant/galleryVariant/productGridVariant removed). **Undo**
(`restoreThemeState`, 3152) is a whole-doc `MastDB.set('public/config/theme', snap)` +
reverse gallery flips — destructive REPLACE with partial-failure paths. **This is the highest-
risk code in the cut.** Deleting website.js without re-homing this breaks the twin's entire
Look & Feel card.

### C. The category manager dialog has three external consumers
`window.openManageCategoriesDialog` (website.js:**2873**) + `wpCat*` handlers (2782–2858) +
`renderCategoriesTab` (1022) + the private `saveCategories` (294, writes `public/config/
categories`) + `slugify`/`isSlugUnique`/`loadCategories` + state (`tenantCategories` 40,
`editingCategoryIdx` 54, `catDialogRender` 55) are consumed **beyond the twin**:
**index.html** (31602–31603, 33167–33174, 33187–33201 — product-detail + image-library
category-change flows) and **gallery-metadata-modal.js** (139–153), each `typeof`-guarded and
backed by `loadModule('website')` at index.html:33177, index.html:33204,
gallery-metadata-modal.js:156. (website-v2 manages categories *natively* in Card 3 and does
**not** call this dialog — it uses `WebsiteBridge.saveCategories`/`slugForCategory`.)

### Routing facts (the cut gate)
- `website.js` manifest: `website: { routes: ['website'] }` (index.html:**20975**);
  `website-v2.js`: `routes: ['website-v2']` (**20928**, flag-gated).
- `MAST_V2_ROUTE_MAP`: `website: 'website-v2', brand: 'website-v2', homepage: 'website-v2'`
  (index.html:**19583**). With V2 default, the sidebar **"Your Website"** entry
  (`navigateTo('website')`, index.html:6773) and the product-settings "Site" link (10607)
  **already resolve to the twin**. website.js's UI is reachable **only** via
  `navigateToClassic('website', {tab:'import', importOnly:'1'})`.
- **The legacy 6-tab UI is already dead.** The route setup (3455) honors `{tab, importOnly}`
  (3466–3475), but the only `navigateToClassic('website')` calls force `importOnly` → the
  **import tab only**. So website.js's overview/template/style/categories/storefront tab
  renderers are unreachable today except the import tab (and the category dialog, reached
  out-of-band via `openManageCategoriesDialog`). **No parity buildout is needed for those six
  tabs — website-v2's four cards already supersede them.**
- **Three live import entry points** (all `navigateToClassic('website', {tab:'import',
  importOnly:'1'})`): setup-wizard.js:**4103** (onboarding "import your existing site"),
  index.html:**45971** ("View Report"), website-v2.js:**2396** (Card 3 "Advanced (classic)
  Import →" door, `WebsiteV2.openImport`).

---

## 2. Engine-migration design (re-home, don't rebuild-from-scratch)

The standard rule (standard-record-ui §1, "raise the engine, don't fork it") says rebuild on
`MastEntity` / `MastUI`. Here that rule applies **only partially**, and the honest scope is
mostly **re-homing verbatim**:

### The import wizard does NOT fit `MastEntity` — give it a dedicated module
`shared/mast-entity.js` (read end-to-end) is a **list + record** engine: a declarative schema
yields `renderList` (a sortable table) and `openRecord` (a read/edit/create slide-out, with
optional `party`/`transaction`/`flow` detail templates and in-panel `drill`). website-v2 itself
uses it for exactly **two drill-only records** (`homepage-section-v2` at 1142,
`shop-category-v2` at 1154) and hand-rolls everything else.

The import wizard is a **multi-step asynchronous job pipeline** (analyze → crawl job → poll/
subscribe → cherry-pick → import → enrich → review/publish → draft template), not an
entity list/record. **MastEntity offers nothing for this flow.** Forcing it onto the engine
would be a fiction. **Honest verdict: this is a feature relocation, not an engine migration.**

- **Primary path — verbatim absorb into a new lazy `app/modules/website-import.js`** with its
  own route (`website-import`), reached by the three entry points. Lowest risk: the wizard's
  ~1,100–1,200 L move byte-identically, the backend CFs are unchanged, and website.js becomes
  deletable fast. (Mirrors the absorb-first cuts: shows/team/newsletter.)
- **Optional modernization (PR-2b, polish only):** compose the wizard's *leaf* surfaces from
  **MastUI primitives** — `MastUI.statusBadge('job', …)` for job state,
  `MastUI.emptyState` for empty history/review, `MastUI.cardTable` for the review/history
  lists — while the flow orchestration stays bespoke. This is the lower-level building-block
  layer, **not** the entity engine. Defer or skip; it does not gate the retirement.

### The cascade + category dialog → re-home VERBATIM into `shared/website-core.js`
These are not engine candidates either — they're a cross-module **write layer**. Move them
verbatim into a new core (the orders-core / customers-core precedent), keeping the exact
`window.*` names so call sites are untouched. Re-homing > rewriting for destructive code.

### `markUnpublished` + the `setData('themeConfig'/'templateManifest')` contract
- `markUnpublished` (website.js:**2922**) flips `webPresence/config/status` published→draft.
  homepage.js has its **own local fallback** (homepage.js:43–44: `if (window.markUnpublished)
  return window.markUnpublished()`, else writes `updatedAt` only) and 7 call sites — so it
  does **not** hard-depend on V1. Move `markUnpublished` into website-core (keep the global).
- website.js publishes `MastAdmin.setData('themeConfig')` (210) / `setData('templateManifest')`
  (253), read by homepage.js `getData` (122/145). **This contract is effectively dormant in
  V2 mode today** (those setData calls fire only inside `renderWebsite` first-run, which V2
  never triggers) — so homepage.js already tolerates `undefined`. website-core should keep
  publishing them when its loaders run; **verify, don't block.**

---

## 3. Recommended PR sequence

Three core PRs; each independently dev-verifiable on **sgtest15**, gated by boot smoke +
`lint-manifest-integrity`. Optional splits noted → realistic range **4–6 PRs**.

### PR1 — Keystone: extract `shared/website-core.js` (refactor, **zero behavior change**)
Move the cross-module write/bridge layer out of website.js into a new core, keeping exact
`window.*` names. Contents (all verbatim):
- **`window.WebsiteBridge`** (2942) + the **template-switch cascade**: `wpConfirmSwitch`
  (2011), `computeGalleryMigration` (1896), `executeGalleryMigration` (1958), the theme/
  manifest/registry loaders `loadThemeConfig` (196), `loadTemplateManifest` (213),
  `loadTemplateRegistry` (256), and the cascade state vars (`themeConfig` 36,
  `templateManifest` 37, `allTemplateManifests` 62, `pendingSwitchTemplateId` 63,
  `showCustomColors` 61, `websiteConfig` 35, `window._wpGalleryCache`). Keep the
  `setData('themeConfig'/'templateManifest')` publishing so homepage.js `getData` survives.
- **Category manager:** `openManageCategoriesDialog` (2873), `closeCatMgrDialog` (2908),
  `wpCat*` (2782–2858), `renderCategoriesTab` (1022), `saveCategories` (294), `slugify`
  (306), `isSlugUnique` (310), `loadCategories` (167), state (`tenantCategories`/
  `editingCategoryIdx`/`catDialogRender`).
- **`markUnpublished`** (2922).
- **Note:** `loadTenantCategories` is a *shell* global (consumed at website.js:298/2912, not
  defined here) — leave it; website-core just calls it (typeof-guarded as today).

Repoint the four `loadModule('website')` consumers → `loadModule('website-core')`:
website-v2.js (688, 1900, 2534, 2600), index.html (33177, 33204), gallery-metadata-modal.js
(156). The `typeof openManageCategoriesDialog === 'function'` guards (index.html 31602/33167/
33174/33187/33201, gallery-metadata-modal.js 139/153) are unchanged — the symbol is still a
global, now sourced from the core. website.js keeps working in legacy mode by
`loadModule('website-core')` in its route setup. **Lazy core** (mirrors customers-core);
`shared/` is exempt from ux-standards / no-local-fmt lints, so no relocated-debt baselines.
**Fully smoke + dev verifiable; no UI change.** *(Optional split: PR1a = WebsiteBridge +
cascade + theme loaders; PR1b = category dialog + markUnpublished.)*

> *Alternative considered:* absorb the bridge straight into website-v2 (skip the core file).
> Rejected — index.html (×5) and gallery-metadata-modal.js consume `openManageCategoriesDialog`
> and would have to `loadModule('website-v2')` (a flag-gated UI module) just to reach a write
> helper. A dedicated non-UI core (orders-core / customers-core precedent) is cleaner and keeps
> website-v2 UI-only.

### PR2 — Relocate the AI import wizard → `app/modules/website-import.js` (the parity gap)
Absorb the import subsystem **verbatim** into a new lazy module with route `website-import`:
the render block (1108–1869), handlers (2235–2778), draft-template actions (3249–3447), the
`webPresence/importJobs` listener (`startImportJobsListener` 314 — **and wire a real
`detach`**; the V1 `stopImportJobsListener` at 335 is dead code, so the subscription currently
leaks across nav — fix on the way through). Verify the transitive helper closure at extraction
time (e.g. `slugify`, `markUnpublished`, `esc`) resolves to website-core / shell globals /
locals. Repoint the **three** entry points (setup-wizard.js:4103, index.html:45971,
website-v2.js:2396) from `navigateToClassic('website', {tab:'import', importOnly:'1'})` →
`navigateTo('website-import')`. Add `website-import` to the manifest + smoke ROUTES.
**Self-contained** (no cross-module consumers of the `wp*` import functions — verified). Backend
CFs unchanged. *(Optional split: PR2a verbatim absorb + entry-point repoint; PR2b modernize
leaf surfaces onto MastUI statusBadge/emptyState/cardTable.)*

### PR3 — Route cutover + delete website.js
After PR1+PR2, website.js holds only the **dead legacy 6-tab UI** (renderWebsite + overview/
template/style/storefront tab renderers + their `wp*` theme/style/template handlers) — all
unreachable in V2 mode.
- Drop website-v2's `if (!flagOn()) return;` gate (website-v2.js:45) and claim
  `routes: ['website-v2','website']` (blog-v2 / rma-admin precedent) so it serves **all**
  users regardless of the Legacy flag.
- Remove the `MAST_V2_ROUTE_MAP['website']` pair (keep brand/homepage → website-v2; they're
  separate cuts — see §4); drop the website.js manifest row (20975); `git rm
  app/modules/website.js`.
- Confirm `lint-manifest-integrity` shows **no dead `loadModule('website')`** (all now resolve
  to `website-core` / `website-import`). Hand-extend any relocated ux/no-local-fmt baselines
  for `website-import.js` (verbatim, never `--update`); bump per-file cache-bust; regen
  `admin-inventory.md`.
- smoke ROUTES already lists `website` (smoke-boot.mjs:53) → exercises website-v2 via the
  remap; add a **template-switch + Undo** dev-verify and a `website-import` route smoke step.

**Why this order:** PR1 removes the destructive write-layer blocker with zero UI change
(lowest risk, makes website.js pure dead-UI + a doomed import host). PR2 closes the one parity
gap behind a live module. PR3 is then a mechanical route-claim + delete, gated by smoke +
manifest-integrity.

---

## 4. Coupling map (word-boundary verified, origin/main)

**`WebsiteBridge`** — defined website.js:2942; the **only runtime consumer is website-v2**
(the index.html:20926 hit is a manifest *comment*). → Re-homed to `website-core` in PR1.

**`loadModule('website')` sites (4 distinct callers):**

| Site | Purpose | Retarget |
|---|---|---|
| website-v2.js 688, 1900, 2534, 2600 | reach WebsiteBridge (cascade/getTemplates/setThemeField) | → `website-core` |
| index.html 33177, 33204 | warm `openManageCategoriesDialog` for product-detail / image-library category change | → `website-core` |
| gallery-metadata-modal.js 156 | warm `openManageCategoriesDialog` for gallery metadata | → `website-core` |

**Cross-module consumers of website.js globals:**

| Global | Real consumers | Mechanism | Retarget |
|--------|----------------|-----------|----------|
| `openManageCategoriesDialog` | index.html 31602, 33167/33174, 33187/33201; gallery-metadata-modal.js 139/153 | `typeof`-guard + `loadModule('website')` | provide from `website-core`; repoint the 3 `loadModule` sites |
| `markUnpublished` | homepage.js 43–44 (local fallback) + 7 calls (597/610/619/639/697/752/922) | guarded global, fallback present | provide from `website-core`; homepage.js unchanged (fallback already tolerant) |
| `themeConfig` / `templateManifest` (via `MastAdmin.setData`) | homepage.js getData 122/145 | shared data bus; dormant in V2 today | website-core keeps publishing; verify homepage render |
| `wp*` import fns (`wpAnalyze`/`wpStartImport`/…) | **none** outside website.js | onclick strings in own DOM | move with the import module (PR2) |
| `wpSwitchTab` | **none** outside website.js (#716 removed the last one) | — | move with website.js dead UI (PR3) |

**Import deep-links (3):** setup-wizard.js:4103, index.html:45971, website-v2.js:2396 — all
`navigateToClassic('website', {tab:'import', importOnly:'1'})` → repoint to
`navigateTo('website-import')` in PR2.

**Out of scope — the rest of the website cluster (separate future cuts).** `homepage.js`
(942 L, `HomepageBridge` @686) and `brand.js` (668 L, `BrandBridge` @544) are **also twin-only
bridge hosts**: both remap to website-v2 (19583) and are `loadModule`'d **only** by website-v2
(homepage ×4: 1286/1298/1856/2590; brand ×3: 705/2006/2599). Retiring website.js does **not**
require touching them. `shared/brand-sync.js` (`MastBrandSync` @161) is shared/eager — stays.
A later cut can absorb HomepageBridge/BrandBridge into website-v2 the same way (note them, do
not bundle).

**False positives ruled out:** index.html:20926 `WebsiteBridge` = comment; maker.js:6485
`openImport` = a maker-local function (not the website import door).

---

## 5. Risks & verification

- **DESTRUCTIVE template switch (highest risk).** `wpConfirmSwitch` + `executeGalleryMigration`
  rewrite `public/config/theme/*` and `public/gallery/{id}/templateHidden*`; `restoreThemeState`
  (Undo) is a whole-doc `set` with partial-failure paths. PR1 moves them **byte-identically**
  (no logic edit). Dev-verify on sgtest15 with website.js **unloaded** (only website-core
  loaded): switch a template via website-v2's Looks gallery (e.g. the-studio → the-gallery) →
  theme reset + gallery `templateHidden` flips; **Undo → exact baseline restore** (the #581
  precedent did precisely this round-trip). Do NOT skip the Undo check — it has the riskiest
  partial-failure surface.
- **Category writes.** `saveCategories` whole-array `set('public/config/categories')` drives
  storefront nav. Dev-verify category CRUD via **all three** paths: website-v2 Card 3, the
  index.html product-detail/image-library category-change dialog, and gallery-metadata-modal.
- **homepage.js theme contract.** Confirm sections still render after PR1 (getData('themeConfig')
  was already best-effort/undefined in V2 — should be inert, but verify).
- **Import module fidelity (PR2).** The wizard's analyze/crawl/import/enrich/publish path is
  large and async. Dev-verify the wizard renders, `analyzeExistingSite` is callable, a job
  writes to `webPresence/importJobs`, the live listener refreshes, and the new `detach` stops
  it on nav-away. All three entry points must reach `website-import`. (sgtest15 may lack a real
  external site to crawl end-to-end — at minimum prove the CF round-trip + job-record write +
  render; flag any path you couldn't exercise honestly.)
- **Legacy-mode availability (PR3).** Dropping website-v2's `flagOn()` gate serves Legacy-UI
  users too — confirm `MastEntity`/`MastUI`/`MastIO`/`MastBrandSync` are loaded in legacy mode
  (shared/eager) and that the entity isn't double-registered.
- **What could regress:** the twin's Look & Feel card (cascade dependency); the index.html ×2 +
  gallery-metadata category dialogs; homepage section render. Each is one guarded call site —
  verify after PR1 and again after PR3.
- **Gates per PR:** `node --check` + full lint suite (rbac, mastdb, ux-standards,
  manifest-integrity), per-file cache-bust, regen `admin-inventory.md`, boot smoke (incl.
  `website` → website-v2 and the new `website-import` route) green. Merge-train if DIRTY
  (rebase, `checkout origin/main -- <generated>`, regen).

## 6. Estimate
**3 PRs** core (PR1 keystone `website-core` → PR2 import module → PR3 cutover+delete),
**4–6** with optional splits (PR1a/PR1b; PR2a/PR2b). This is **less buildout than customers**
(which rebuilt 4 features) because website-v2 already has full builder parity and the six
legacy tabs are already dead — the work is **re-homing** (the destructive cascade + category
dialog, verbatim) plus **one feature relocation** (the import wizard, a verbatim absorb into a
dedicated module — **not** an engine migration; the MastEntity engine does not fit an async
multi-step job flow). The risk profile is **higher** than customers despite fewer PRs, because
of the destructive template-switch cascade — handle PR1 with byte-identical moves and the full
switch+Undo dev-verify.
