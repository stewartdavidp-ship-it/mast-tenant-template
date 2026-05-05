# Storefront Reader Migration Checklist

Verifies that a tenant storefront reads brand fields from canonical paths instead of legacy mirrors. Use after deploying a reader-migration phase to a test tenant.

## Context

Writes consolidated to `shared/brand-sync.js` in commit `2d9faa2`. That helper writes the canonical paths AND fans out to legacy mirrors so storefront readers stay working during migration. The migration moves readers off the mirrors so the mirrors can eventually be dropped from `brand-sync.js`.

| Field | Canonical (truth) | Public storefront source |
|---|---|---|
| Logo (primary) | `config/brand/logo/primary.url` | `STOREFRONT_DATA.brandLogo.primary.url` (prefetched from `config/brand`) |
| Logo (placement) | n/a (admin-managed) | `public/config/brand/logo/{placement}/url` |
| Brand name | `config/brand.name` | `publicConfig.brandName` (in `TENANT_BRAND.name`) |
| Brand tagline | `config/brand.tagline` | `publicConfig.brandTagline` (in `TENANT_BRAND.tagline`) |
| Primary color | `public/config/theme.primaryColor` | same |
| Accent color | `public/config/theme.accentColor` | same |
| Font pair | `public/config/theme.fontPair` | same |

## Test Tenant

- Default: `sgtest37` — `https://mast-sgtest37.web.app/`
- Set logo, name, tagline, primary/accent colors, and a fontPair via the admin app at `/app#brand`.
- Wait ~1 minute (cache TTL) or hard-reload (Cmd+Shift+R) before testing.

## Phase 1 — Logo

After Phase 1 deploy, verify all logo surfaces render and that each one is reading from the canonical path (DevTools network tab should NOT show fresh fetches to `public/config/nav/logoUrl` for logo URLs — only the canonical `config/brand` doc fetched once via `STOREFRONT_DATA`).

- [ ] **Nav logo (homepage)** — `https://mast-sgtest37.web.app/` — img inside `nav#mainNav .nav-logo` shows the configured logo. `document.querySelector('.nav-logo img').src` matches `config/brand/logo/primary.url`.
- [ ] **Nav logo (interior page)** — `https://mast-sgtest37.web.app/shop` — same selector, same URL.
- [ ] **Hero logo (homepage)** — `#heroLogo img` shows configured logo. If a hero-specific URL is set in admin, that wins; otherwise primary.
- [ ] **Footer logo** — every page — `.footer-logo img` shows configured logo.
- [ ] **Wholesale gate logo** — `https://mast-sgtest37.web.app/wholesale` — `.ws-gate-logo` shows configured logo.
- [ ] **Favicon** — browser tab + `link[rel="icon"]` href reads `public/config/brand/logo/favicon/url` when configured.
- [ ] **Network sanity** — DevTools Network tab on first paint shows ONE fetch to `tenants/{tid}/config__/brand` (or `config_brand`); does NOT show repeated fetches to `public_config/nav` for the logo URL.
- [ ] **Cache fallback** — Clear localStorage, reload — logo still renders (cache repopulates correctly).
- [ ] **Empty-state behavior** — On a tenant with no logo set, nav uses `favicon.svg` fallback; footer-logo elements are hidden via `display:none`.

## Phase 2 — Brand name + tagline (NOT YET MIGRATED)

- [ ] **Document title** — `document.title` contains brand name.
- [ ] **`[data-tenant="brand"]` elements** — render brand name.
- [ ] **`[data-tenant="tagline"]` elements** — render tagline.
- [ ] **Footer copyright** — `[data-tenant="year-brand"]` shows `© {year} {brand}`.
- [ ] **schema.org JSON-LD** — view source, find `<script type="application/ld+json">` — `name` matches brand name, `description` matches tagline.
- [ ] **Share widget** — Click any share button — share title/text use brand name.
- [ ] **Source verification** — `TENANT_BRAND` object reads from `publicConfig.brandName` / `brandTagline` (mirrors of `config/brand.name` / `.tagline`). After migration, decide whether to keep this mirror for pre-paint or read canonical.

## Phase 3 — Theme colors + font pair (NOT YET MIGRATED)

- [ ] **Light mode primary** — `getComputedStyle(document.documentElement).getPropertyValue('--primary')` matches admin-set primary.
- [ ] **Light mode accent** — `--accent` matches admin-set accent.
- [ ] **Dark mode** — toggle dark mode (or `?dark=1` if supported) — primary/accent should NOT invert.
- [ ] **Hero gradient** — homepage hero gradient uses primary + accent.
- [ ] **Buttons** — primary buttons use `--primary`.
- [ ] **Font pair** — `getComputedStyle(document.body).fontFamily` matches the pair body font; headings (`h1`, `.hero-title`) match the pair display font.
- [ ] **Source verification** — `storefront-theme.js` already reads `public/config/theme` directly. Confirm no other path is consulted.

## Phase 4 — Mirror cleanup (final)

After all readers migrated and verified across multiple tenants:

- [ ] Drop mirror writes from `shared/brand-sync.js`:
  - `public/config/nav/logoUrl`
  - `config/brand.logoUrl` (legacy admin newsletter — verify `app/modules/newsletter.js` reads canonical first)
  - `businessEntity/identity.logoUrl`
  - `mast-platform/tenants/{tid}/publicConfig.brandLogoUrl` (only if no pre-paint dependency)
  - `mast-platform/tenants/{tid}/publicConfig.brandName` (only if TENANT_BRAND switched to canonical)
  - `mast-platform/tenants/{tid}/publicConfig.brandTagline` (same)
- [ ] Run this checklist on at least 2 production tenants before merging mirror removal.
