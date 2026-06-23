# Storefront Capabilities Panel + Nav Source-of-Truth Fix — Build Spec

**Status:** in progress · **Branch:** `feat/storefront-capabilities-panel` · **Date:** 2026-06-23

## Problem (two coupled issues)

1. **Nav split-brain / stale snapshot.** The storefront nav reads `public/config/nav/sections`
   only (`storefront-nav.js`). `webPresence/config/features` is written at onboarding but read
   by nothing storefront-facing — it is **vestigial**. `nav/sections` is a one-time snapshot
   derived from `features` *at onboarding instant* (`setup-wizard.js:3170-3181`) and is **never
   re-derived** when features change. Tenants onboarded during the module-gating regression got
   `nav/sections = {about, contact}` and never recovered, even after their `features` were
   corrected. (Confirmed live: `shirglassworks` has `features={shop,blog,events:true}` but
   `nav/sections={about,contact}`.)

2. **Hardcoded defaults invert reality for sparse tenants.** When `nav/sections` is sparse, the
   storefront fills gaps from `DEFAULT_SECTIONS` (`storefront-nav.js:23`), a fixed table that
   doesn't know the tenant's features/data. Net effect for a base import: `classes` shows
   (default `true`) despite no booking module → dead link; `schedule` hidden (default `false`)
   despite `events:true`.

3. **Usability:** storefront controls are fragmented across My Website (template/style/categories
   /import), Settings (Product Page Display, Domains, site visibility), and the Page Builder
   (section toggles). No single place to turn storefront capabilities on/off.

## Decisions (operator-confirmed 2026-06-23)

- **Scope:** Capabilities panel + move pure-storefront settings (Product Page Display, Domains,
  site visibility/active pages). Leave "both" settings (shipping rates, workshop/trip logistics)
  in Settings.
- **Migration:** New Capabilities panel = single toggle UI; existing Page Builder section toggles
  defer to it; leave redirect stubs at old Settings locations.

## Confirmed code targets (origin/main, NOT the shared checkout)

- **Writer (reuse):** `window.hpToggleSection(id, enabled)` — `app/modules/website-v2.js:3221`.
  Sets `public/config/nav/sections/{id}/enabled` + mirrors `webPresence/config/sections/{id}/enabled`
  + `markUnpublished()` + repaint.
- **Mount point:** top of `renderHomepage()` — `app/modules/website-v2.js:2891` (before
  `renderSectionCards()` at 2903). `navSections` already loaded at 2760.
- **Defaults table:** `DEFAULT_SECTIONS` — `storefront-nav.js:23`.
- **Onboarding derivation:** `setup-wizard.js:3170-3181`.

## Build — PR 1 (centerpiece + bug fix)

1. **Capabilities panel** — new card block at top of `renderHomepage()`. Lists nav-level
   storefront capabilities (NOT homepage content sections — those stay in `renderSectionCards`):

   | Capability | nav/sections id | Data-dependency hint |
   |---|---|---|
   | Shop | `shop` | needs active products |
   | About | `about` | — |
   | Blog / From the Studio | `blog` | needs posts |
   | Schedule (Events) | `schedule` | shows your upcoming events |
   | Classes | `classes` | needs the Classes/booking module |
   | Wholesale | `wholesale` | needs wholesale pricing |
   | Commissions | `commission` | — |
   | Gift Cards | `giftcards` | needs wallet/gift cards enabled |
   | Newsletter | `newsletter` | — |
   | Contact | `contact` | — |

   Each row: label + hint + toggle → `hpToggleSection(id, checked)`. Enabled state resolved the
   same way the storefront merge does: `navSections[id].enabled` if set, else the corrected
   `DEFAULT_SECTIONS` default. Account/context pages (orders, my-classes, my-wallet, terms) are
   NOT operator-toggled features → excluded from the panel.

2. **DEFAULT_SECTIONS fix** (`storefront-nav.js`): flip `classes.enabled` `true → false`
   (feature-gated on the booking module; defaulting on surfaces a dead link for every
   product-only tenant). Leave `shop/about/blog` defaulting `true` (correct cold-start for a
   brand-new tenant with no config). `schedule` already `false` (operator enables via panel).

3. **shirglassworks data re-derive** (separate, prod-gated): write `public/config/nav/sections`
   for shirglassworks from current `features` so Schedule appears and the stale snapshot clears.
   Do via `mast_config set` with operator confirmation AFTER panel is verified on dev.

## Build — PR 2 (relocation, follow-up)

- Move Product Page Display (`shopDisplay`) + Domains + site-visibility/active-pages from Settings
  into a My Website sub-view; leave redirect stubs at the old Settings `data-nav-key` locations.

## Verify

- Dev: toggle each capability in My Website → confirm `nav/sections/{id}/enabled` write + storefront
  nav link appears/disappears on `<tenant>.runmast.com` (hard-reload).
- Lint: cache-bust bump (`MAST_MODULES_V`), shell-size (panel lives in a module, not inline),
  docs-inventory, boot-smoke.
