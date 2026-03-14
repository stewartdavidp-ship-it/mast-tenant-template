# Multi-Tenancy Analysis: Mast Admin App (Shir Glassworks Codebase)

## Context

The Shir Glassworks admin app is a single-file HTML application (~30K lines) that serves as a full business management platform. It's currently a **deeply single-tenant** system — the business identity "Shir Glassworks" is woven into the data layer, infrastructure, UI, and content at every level.

This analysis evaluates what would need to change to support a second customer (Customer 2) alongside Shir Glassworks (Customer 1), and ultimately N customers. The goal is to identify every tenant-coupled surface and categorize the work by layer.

---

## Layer 1: Data Layer (Firebase Paths)

**Problem:** Every Firebase path is hardcoded with `shirglassworks/` prefix (~40+ paths).

**Examples:**
- `shirglassworks/public/products`
- `shirglassworks/admin/users`
- `shirglassworks/orders`
- `shirglassworks/trips/{uid}`
- `shirglassworks/config/square`
- `shirglassworks/newsletter/issues`

**What changes:**
- All path constants need a tenant prefix variable: `{tenantId}/public/products`
- Introduce a `TENANT_ID` constant (or derive from config/auth) that replaces every `shirglassworks/` prefix
- The ~25 `var XXXX_PATH = 'shirglassworks/...'` declarations (lines 5295-5431) all become `TENANT_ID + '/...'`

**Estimated scope:** ~40 path declarations + ~50 inline `db.ref('shirglassworks/...')` calls scattered through the codebase

**Approach:** Single `TENANT_ID` variable set at app init (from config or URL parameter), all paths reference it.

---

## Layer 2: Firebase Project & Infrastructure

**Problem:** The Firebase project itself is `shir-glassworks` — project ID, auth domain, database URL, storage bucket are all customer-specific.

**Hardcoded in:**
- `app/index.html` lines 5280-5287 (admin app)
- `index.html` lines 1514-1520 (landing page)
- `studio/index.html` lines 408-414 (Studio PWA)
- `about.html`, `commission.html`, etc. (all public pages)

**What changes — two approaches:**

### Option A: Shared Firebase Project (Recommended for v1)
- Keep single Firebase project (rename to something neutral like `mast-platform`)
- Tenant isolation via path prefix: `{tenantId}/public/products` vs `shirglassworks/public/products`
- Firebase rules updated to enforce tenant-scoped access
- Pro: Simpler, single deploy, shared infrastructure
- Con: All tenant data in one RTDB (billing, size limits, noisy neighbor risk)

### Option B: Separate Firebase Projects Per Tenant
- Each customer gets their own Firebase project
- App dynamically initializes Firebase based on tenant config
- Pro: Full isolation, independent billing, independent scaling
- Con: More complex deployment, need a "registry" to map tenant → Firebase config

**Cloud Functions (5 functions):**
- `classifyImage`, `commissionProposal`, `studioAssistant`, `etsyOAuthStart`, `etsyOrderSync`
- Functions use generic names (no tenant prefix) — tenant scoping comes from the Firebase project
- Base URL: `https://us-central1-shir-glassworks.cloudfunctions.net` — tied to project

**Cloud Storage:**
- Paths: `shirglassworks/builds/`, `shirglassworks/commission-docs/`, `shirglassworks/images/`
- Would need tenant prefix: `{tenantId}/builds/`

**MCP Server:**
- Service names: `mast-mcp-server-test`, `mast-mcp-server`
- All Firebase refs in `src/firebase.ts` hardcoded to `shirglassworks/`
- Would need tenant context passed per request (from auth token or header)

---

## Layer 3: Authentication & Authorization

**Problem:** Admin access is bootstrapped from a single hardcoded UID.

**Hardcoded:**
- `ALLOWED_UIDS = ['Y8RX1PIzccfT95WIIFl4I37VZZ72']` (line 5293) — Ori's UID
- Same UID in `database.rules.json` (24 locations)
- Firebase rules use `auth.uid` checks against this UID for admin writes

**What changes:**
- Replace `ALLOWED_UIDS` with a tenant-scoped admin lookup: `{tenantId}/admin/users/{uid}/role === 'admin'`
- Firebase rules need tenant-aware structure: `$tenantId/admin/users/$uid`
- Need a **tenant registry** that maps authenticated users to their tenant(s)
- On login: look up user's tenant membership → set `TENANT_ID` → load tenant-scoped data
- Consider: Can a user belong to multiple tenants? (probably yes for the developer/admin)

**RBAC (3 roles: admin/user/guest):**
- Role definitions at `shirglassworks/admin/roles` — already data-driven, just needs tenant prefix
- Invite system at `shirglassworks/admin/invites` — same, just prefix
- Permission matrix is generic (orders, products, inventory, etc.) — no glass-specific permissions

---

## Layer 4: External Service Integrations

**Problem:** All API credentials are per-business and hardcoded to paths or GCP secrets.

| Service | Current Config Location | Multi-Tenant Change |
|---------|------------------------|---------------------|
| **Square** | `shirglassworks/config/square` | Per-tenant: `{tenantId}/config/square` — each business has own Square merchant account |
| **Etsy** | `shirglassworks/config/etsy` | Per-tenant: `{tenantId}/config/etsy` — each business has own Etsy shop |
| **Google Maps** | `shirglassworks/public/config/googleMapsApiKey` | Could share one API key (Mast-owned) or per-tenant |
| **GitHub** | `shirglassworks/admin/githubToken` | Per-tenant: each gets own repo for image hosting, or shared CDN |
| **Google Contacts** | In-memory OAuth | Per-tenant Google account |
| **Label Keeper** | Hardcoded API key `lk_7d22ec38...` | Per-tenant or shared (depends on print card use case) |

**GCP Secret Manager secrets (shir-glassworks project):**
- `shir-square-sandbox-access-token`
- `shir-square-production-access-token`
- `shir-square-sandbox-webhook-signature-key`
- `shir-square-production-webhook-signature-key`
- `shir-etsy-api-key`
- All need per-tenant equivalents or a tenant-keyed secrets pattern

**GitHub repo for images:**
- Currently: `stewartdavidp-ship-it/shirglassworks` (images committed via GitHub API)
- Each tenant would need their own image hosting strategy

---

## Layer 5: UI — Terminology & Domain Language

**Problem:** Glass-specific terminology is embedded in UI labels, placeholders, prompts, and content templates.

### 5a. Product Categories (hardcoded constants)
```javascript
// Line 5298
const CATEGORIES = ['figurines', 'jewelry', 'drinkware', 'sculptures', 'vases', 'decorations', 'studio', 'other'];

// Lines 5305-5309
const SECTIONS = [
  { id: 'figurines', label: 'Figurines', description: 'Glass figurines' },
  { id: 'jewelry', label: 'Jewelry', description: 'Glass jewelry & pendants' },
  { id: 'drinkware', label: 'Drinkware', description: 'Handblown glass cups' },
  ...
];
```
**Change:** Move to Firebase config per-tenant: `{tenantId}/config/categories` — loaded at app init.

### 5b. Form Placeholder Text (glass-specific)
- Line 8029: `placeholder="e.g. Borosilicate glass, lampwork technique"` (materials field)
- Line 15961: `placeholder="Kiln conditions, techniques, observations..."` (build notes)
- Line 19482: `placeholder="Describe the piece, materials, design details..."` (commission spec)

**Change:** Placeholder text becomes tenant-configurable or generic.

### 5c. Social Media Hashtags & Templates
```javascript
// Line 20785
niche: ['#glassart', '#handblownglass', '#studioglass', '#glassblowing'],
// Line 20781
{ style: 'Product', text: '...Handblown glass, made with intention...' },
```
**Change:** Niche hashtags and caption templates stored per-tenant in Firebase.

### 5d. Blog/Story Guided Prompts
```javascript
// Lines 21025-21031
{ type: 'studio-update', guidedPrompt: 'What has the studio been working on lately? Any new techniques, materials...' },
{ type: 'behind-process', guidedPrompt: 'Walk us through how a specific piece or technique is made...' },
{ type: 'from-studio', guidedPrompt: 'A personal note from Ori or Madeline...' }
```
**Change:** Prompts stored per-tenant or made generic ("What has the team been working on...").

### 5e. Author Bios (person-specific)
```javascript
// Lines 22228-22235
{ name: 'Madeline', bio: 'Co-founder of Shir Glassworks...' },
{ name: 'Ori', bio: 'Co-founder of Shir Glassworks...' }
```
**Change:** Move to Firebase: `{tenantId}/config/authors` — loaded dynamically.

### 5f. Contact Categories
```javascript
const CONTACT_CATEGORIES = ['Supplier', 'Facilities', 'Gallery', 'Marketplace', 'Event Organizer', 'Partner', 'Student', 'Press', 'Other'];
```
**Change:** Mostly generic — "Gallery" and "Marketplace" are Shir-specific. Make configurable per tenant.

---

## Layer 6: UI — Branding & Visual Identity

### 6a. Color Palette (CSS variables)
```css
:root {
  --amber: #C4853C;        /* Shir's warm gold */
  --teal: #2A7C6F;         /* Shir's ocean green */
  --cream: #FAF6F0;        /* Shir's warm white */
  --glass-gradient: linear-gradient(135deg, #C4853C 0%, #E8B679 30%, #A8D5CE 70%, #2A7C6F 100%);
}
```
**Change:** CSS variables loaded from tenant config. The `--glass-gradient` name needs renaming to `--brand-gradient`. Each tenant defines their primary, secondary, accent colors.

### 6b. Business Name in Admin UI
- Header: `Shir Glassworks` (line 3791, in brand lockup with Mast logo)
- Page title: `<title>Shir Glassworks Admin</title>` (line 6)
- Throughout toasts, modals, export filenames

**Change:** Loaded from tenant config: `{tenantId}/config/businessName`.

### 6c. Logo & Favicon
- Favicon: `/app/favicon.svg` (currently Shir's)
- Header brand lockup: Mast mark + "Mast" wordmark + "/" + business name
- The Mast branding stays (it's the platform brand) — business name is the variable part

### 6d. Fonts
- `Archivo` (Mast brand — stays)
- `DM Sans` (body — could stay as platform default)
- `Cormorant Garamond` (Shir's elegant serif — this is tenant-specific)

**Change:** Headline/accent font configurable per tenant. Body font could stay as platform standard.

---

## Layer 7: Public Pages (Customer-Facing)

**Problem:** 9 separate HTML files each have hardcoded business copy, Firebase config, branding, and social links.

| Page | Hardcoded Content |
|------|------------------|
| `index.html` | "Shir Glassworks — Handmade Glass Art", hero copy, gallery, Instagram link |
| `shop.html` | Title, product grid, category filters (glass-specific), footer |
| `about.html` | "Ori & Madeline Shir", full bio paragraphs about glassblowing, "sand, soda, and lime" |
| `commission.html` | "one-of-a-kind glass piece" copy, form labels |
| `schedule.html` | Title, event listings |
| `product.html` | Product detail, "Request Commission" CTA |
| `orders.html` | Customer order lookup |
| `blog/index.html` | Blog listing, @shirglassworks Instagram link |
| `blog/post.html` | Single post view |

**Footer on all pages:**
- `© 2026 Shir Glassworks`
- Instagram: `instagram.com/shirglassworks/`
- "Powered by Mast" badge (this stays — it's the platform attribution)

**Approach: Public website is optional — most customers already have one.**

Most customers will already have their own website and domain. For these customers, Mast provides the data/API layer (products, orders, blog content, events) that their existing site can consume — Mast is the back office, not the storefront.

For customers who DON'T have a website, Mast can provide an auto-generated site as an opt-in feature — following a consistent Mast-branded template populated with tenant-specific content. These could be hosted at `{business}.runmast.com` or on the customer's own domain if they acquire one.

**Which pages exist depends on which modules are enabled:**

| Page | Required Module | Content Source |
|------|----------------|---------------|
| Landing / Home | Always (Manage) | Hero, gallery grid, business intro from tenant config |
| About | Always (Manage) | Business bio, team bios from tenant config authors |
| Shop | Sell | Product grid from `{tenantId}/public/products` |
| Product Detail | Sell | Individual product view |
| Orders (lookup) | Sell | Customer order status check |
| Commission | Sell (if commissions enabled) | Custom work inquiry form |
| Schedule | Teach | Workshop/event listings |
| Blog | Market | Blog listing + post pages |
| Behind the Scenes | Make | Production/process content (renamed from "From the Studio") |

**"From the Studio" → "Behind the Scenes."** Generic enough for any business type — glass studio, pottery, bakery, woodworker.

**Site generation approach:**
- Master template set (HTML/CSS) with placeholder tokens for business name, colors, copy, social links
- Build/deploy pipeline: pull tenant config → generate static pages → deploy to tenant's hosting
- Pages not needed (module off) simply aren't generated
- Content updates (copy, images, products) can be live via Firebase reads — the static template loads dynamic data for product grids, blog posts, etc.
- Static elements (business name, colors, footer, about copy) baked in at build time for fast load / SEO

---

## Layer 8: Studio PWA

- `manifest.json`: `"name": "Shir Glassworks Studio"` — needs tenant name
- `index.html`: Title, description, Firebase config all hardcoded
- Same multi-tenant pattern as admin app applies

---

## Layer 9: Domain, Deployment & Hosting

**Current:**
- Admin: `stewartdavidp-ship-it.github.io/shirglassworks/app/` (GitHub Pages)
- Public: `shirglassworks.com` (customer's domain, GitHub Pages)
- Repo: `stewartdavidp-ship-it/shirglassworks`

**Multi-tenant approach (DECIDED):**
- **Hosting:** Firebase Hosting replaces GitHub Pages. CDN, auto-SSL, custom domains, deploy from CLI or GitHub Actions.
- **Source code:** GitHub stays as the repo. GitHub Actions deploys to Firebase Hosting on push to main.
- **Admin app:** Single deployment at Firebase Hosting. All tenants access the same files. Custom domains per tenant (e.g., `shirglassworks.com/admin`, `customer2.com/admin`, `app.runmast.com`).
- **Tenant resolution:** App reads `window.location.hostname` → looks up `mast-platform/tenantsByDomain/{hostname}` → resolves tenantId → applies branding before login screen.
- **Customer's own website:** Most tenants already have a domain and website. Mast is the back office. Public tenant pages deferred — not v1.
- **Fallback:** `app.runmast.com` shows generic Mast login → after auth, tenant picker if user belongs to multiple tenants.

**Firebase Hosting data model:**
```
mast-platform/
├── tenantsByDomain/
│   ├── shirglassworks_com: "shirglassworks"
│   ├── customer2_com: "customer2"
│   └── app_runmast_com: null  // fallback → tenant picker
```

## Layer 9b: File Architecture (Single File → Modular)

**Problem:** 30K-line single HTML file is at a breaking point.

**Approach (DECIDED):** Dynamic module loading based on subscription.

```
app/
├── index.html          # HTML shell + CSS (~4-5K lines)
├── core.js             # Auth, routing, MastDB, sidebar, tenant config (~4-5K)
├── shared.js           # Modals, tables, forms, date utils, toasts (~2-3K)
├── mod-make.js         # Make: jobs, procurement (~2-3K)
├── mod-market.js       # Market: social, blog, newsletter, stories (~3-4K)
├── mod-sell.js         # Sell: POS, orders, commissions, events, coupons (~5-6K)
├── mod-ship.js         # Ship: pack, ship (~1-2K)
├── mod-run.js          # Run: trips, expenses, reports (~2-3K)
├── mod-teach.js        # Teach: workshops (~1-2K)
├── mod-team.js         # Team: employees, contacts (~1-2K)
└── mod-manage.js       # Manage: products, inventory, customers, images, settings (~5-6K)
```

**Loading sequence:**
1. `index.html` loads `core.js` and `shared.js` (always)
2. After auth + tenant resolution, `core.js` reads `enabledModules` from subscription
3. Dynamically loads only the `mod-*.js` files for enabled modules
4. Unsubscribed modules never downloaded — less code, faster load

**Migration from single file:**
1. Extract CSS first → `styles.css` (biggest win, zero risk)
2. Extract shared utilities (toasts, modals, date helpers)
3. Extract one module at a time (start with Run/Trips — most self-contained)
4. Core is what's left after all modules extracted

---

## Summary: Change Inventory by Category

| Category | Items to Change | Effort |
|----------|----------------|--------|
| **Firebase path constants** | ~25 var declarations + ~50 inline refs | Medium — mechanical find/replace + TENANT_ID variable |
| **Firebase project config** | 6 files × firebaseConfig object | Low — extract to config loader |
| **Auth/RBAC bootstrap** | ALLOWED_UIDS, Firebase rules (24 locations) | Medium — tenant registry + rule rewrite |
| **Cloud Functions** | 5 functions with `shir` prefix + project-bound URLs | High — rename, redeploy, or make tenant-aware |
| **External API credentials** | Square, Etsy, GitHub, Google Maps, Label Keeper | Medium — per-tenant config paths |
| **GCP Secrets** | 5 secrets with `shir-` prefix | Low — naming convention change |
| **Product categories** | 3 hardcoded arrays (CATEGORIES, SECTIONS, SHOP_SECTION_IDS) | Low — move to Firebase config |
| **UI placeholder text** | ~5 glass-specific placeholders | Low — genericize or make configurable |
| **Social media templates** | Hashtag array, caption templates | Low — move to Firebase config |
| **Author bios** | 2 hardcoded author objects | Low — move to Firebase config |
| **Blog/story prompts** | 3 guided prompt objects | Low — genericize |
| **CSS color palette** | 12 CSS variables + `--glass-gradient` | Medium — dynamic CSS injection from tenant config |
| **Business name in UI** | ~15 locations (titles, headers, toasts, exports) | Low — single variable replacement |
| **Fonts** | 1 tenant-specific font (Cormorant Garamond) | Low — configurable font loading |
| **Public pages (9 files)** | Titles, copy, social links, footer text, Firebase config | High — template system or dynamic loading |
| **Studio PWA** | manifest.json, title, Firebase config | Low — same pattern as admin app |
| **MCP Server** | Firebase refs in TypeScript, deploy scripts | Medium — tenant context per request |
| **Domain/routing** | URL → tenantId mapping | Medium — subdomain or path-based routing |

---

## Layer 10: Subscription Model & Module Gating

### Module Definition

The app's sidebar sections become the subscription-gated modules. Current and proposed:

| Module | Current Sidebar | Routes | Gated? |
|--------|----------------|--------|--------|
| **Make** | 🔥 Make | jobs, procurement | Yes — subscription |
| **Market** | 📣 Market | social, blog, newsletter, stories | Yes — subscription |
| **Sell** | 💰 Sell | pos, events, orders, commissions, wholesale, galleries, coupons, receipts | Yes — subscription |
| **Ship** | 📦 Ship | pack, ship | Yes — subscription |
| **Run** | 📋 Run | trips, expenses, reports | Yes — subscription |
| **Teach** | 🎓 Teach | teach (future) | Yes — subscription |
| **Team** | NEW | employees, contacts (pulled from Manage) | Yes — subscription |
| **Manage** | ⚙️ Manage | products, inventory, customers, images, website, analytics, auditlog, financials, settings | Always visible |

**Team module** — new, created by pulling from Manage:
- Employees & Permissions (currently `employees` route in Manage)
- Contacts (currently `contacts` route in Manage)
- These move out of Manage into their own gated module

**Manage** — always visible regardless of subscription tier. Retains: Products, Inventory, Customers, Images, Website Content, Analytics, Audit Log, Financials, Settings & Integrations.

### Subscription Tiers

| Tier | Modules Included | Price | Customer Choice |
|------|-----------------|-------|-----------------|
| **Starter (1)** | Manage + 1 module | $39/mo | Customer picks which 1 module to enable |
| **Growth (2-3)** | Manage + 2-3 modules | $99/mo | Customer picks which modules to enable |
| **Pro (4+)** | Manage + all modules | $149/mo | All modules enabled |
| **Trial** | All modules (full Pro) | Free | Time-limited, pick tier when trial ends |

### Gating Architecture

**What exists today:**
- `SECTION_ROUTES` object already maps module names to their routes (line 6046)
- `navigateTo()` is the single routing entry point — one place to add module checks
- `isAdmin()` / `hasPermission()` functions already exist for role-based gating
- Settings route is already gated to admin-only (line 6062)
- Sidebar is rebuilt after auth/role load (line 6238)

**What needs to be added:**
- Tenant subscription record in Firebase: `tenants/{tenantId}/subscription/`
  ```
  subscription/
  ├── tier: "starter" | "growth" | "pro"
  ├── enabledModules: ["sell", "run"]  // customer's chosen modules
  ├── status: "active" | "trial" | "past_due" | "cancelled"
  ├── trialEndsAt: ISO timestamp
  ├── billingCycleStart: ISO timestamp
  └── billingCycleEnd: ISO timestamp
  ```
- Module gating function: `isModuleEnabled(moduleName)` — checks subscription + enabledModules
- Sidebar rendering: hide entire section `div` if module not enabled (not just muted — hidden)
- Route guard in `navigateTo()`: if module not enabled, show "upgrade" message instead of view
- Module selection UI in Settings or onboarding: let customer toggle which modules they want within their tier limit
- Public page gating: if "Market" module is off, blog/newsletter routes shouldn't serve content
- Ship module: could be standalone or bundled with Sell (architectural decision needed)

### Module Dependency Considerations

Some modules have cross-dependencies:
- **Sell** uses Products/Inventory from **Manage** — Manage is always on, so this works
- **Ship** (Pack/Ship) consumes Orders from **Sell** — if Sell is off but Ship is on, are there orders to fulfill?
- **Make** (Production Jobs) references Products from **Manage** — works since Manage is always on
- **Market** (Social/Blog/Newsletter/Stories) references Products — works since Manage is always on
- **Run** (Trips) is self-contained — no dependencies
- **Team** (Employees/Contacts) is self-contained — no dependencies
- **Teach** — future, no dependencies defined yet

**Key question:** Should Ship require Sell, or can Ship exist independently (e.g., customer uses external order system, just needs pack/ship workflow)?

---

## Layer 11: Mast Management Application (Platform Admin)

### Purpose

A separate application for Mast platform administration — the "god view" for managing tenants, subscriptions, usage, and platform health. This is NOT the customer-facing admin app; it's the Mast team's internal tool.

### Core Features

| Feature | Description |
|---------|-------------|
| **Tenant Onboarding** | Create new tenant, set up Firebase paths, configure business identity, assign admin user, set initial subscription |
| **Subscription Management** | View/change tier, toggle modules, manage billing status, trial management |
| **Usage Tracking** | Per-tenant metrics: active users, data volume, API call counts, storage usage |
| **Tenant Config** | Edit tenant branding, categories, integrations from platform level |
| **User Directory** | Cross-tenant view of all users, which tenants they belong to, roles |
| **Health & Billing** | Firebase usage per tenant, cost allocation, alert thresholds |
| **Platform Settings** | Global config, default categories, onboarding templates, feature flags |

### Data Model

```
mast-platform/                          # Top-level platform data (NOT tenant-scoped)
├── tenants/
│   ├── {tenantId}/
│   │   ├── config/
│   │   │   ├── businessName: string
│   │   │   ├── domain: string
│   │   │   ├── colors: { primary, secondary, accent }
│   │   │   ├── fonts: { heading, body }
│   │   │   ├── categories: [...]
│   │   │   ├── authors: [...]
│   │   │   ├── socialLinks: { instagram, facebook, ... }
│   │   │   ├── hashtags: { niche: [...], general: [...] }
│   │   │   ├── captionTemplates: [...]
│   │   │   └── contactCategories: [...]
│   │   ├── subscription/
│   │   │   ├── tier: "starter" | "growth" | "pro"
│   │   │   ├── enabledModules: ["sell", "market", "run"]
│   │   │   ├── status: "active" | "trial" | "past_due" | "cancelled"
│   │   │   ├── trialEndsAt: ISO timestamp
│   │   │   └── billing: { cycleStart, cycleEnd, amount, currency }
│   │   ├── adminUids: [uid1, uid2]
│   │   ├── createdAt: ISO timestamp
│   │   └── status: "active" | "suspended" | "archived"
│   └── ...
├── userTenantMap/
│   ├── {uid}/
│   │   ├── {tenantId}: { role: "admin", joinedAt: ISO }
│   │   └── ...                         # User can belong to multiple tenants
│   └── ...
├── platformConfig/
│   ├── defaultCategories: [...]
│   ├── onboardingTemplate: { ... }
│   ├── featureFlags: { ... }
│   └── moduleDefs/
│       ├── make: { label, icon, routes: [...], description }
│       ├── market: { label, icon, routes: [...], description }
│       ├── sell: { label, icon, routes: [...], description }
│       ├── ship: { label, icon, routes: [...], description }
│       ├── run: { label, icon, routes: [...], description }
│       ├── teach: { label, icon, routes: [...], description }
│       └── team: { label, icon, routes: [...], description }
└── usage/
    ├── {tenantId}/
    │   ├── {month}/
    │   │   ├── activeUsers: number
    │   │   ├── apiCalls: number
    │   │   ├── storageBytes: number
    │   │   └── events: number
    │   └── ...
    └── ...
```

### Auth Flow (Updated for Multi-Tenant + Subscription)

1. User signs in (Firebase Auth — shared across all tenants)
2. Look up `userTenantMap/{uid}` → get list of tenant memberships
3. If single tenant → auto-select, set `TENANT_ID`
4. If multiple tenants → show tenant picker
5. Load `tenants/{tenantId}/config/` → apply branding, categories, etc.
6. Load `tenants/{tenantId}/subscription/` → determine enabled modules
7. Render sidebar with only enabled modules visible
8. Load tenant-scoped data from `{tenantId}/public/products`, etc.

### Where Does Mast Management Live?

Options:
- **A) Separate single-file app** at `runmast.com/admin/` — Mast's own admin tool, independent codebase
- **B) Mode within existing app** — platform admin mode activated by Mast team members, shows management UI alongside tenant data
- **C) Part of Command Center** — CC already has app management; extend it with tenant/subscription management

### Tenant Data Isolation

Per-tenant business data lives under `{tenantId}/` prefix (same structure as today's `shirglassworks/`):

```
{tenantId}/
├── public/
│   ├── products/
│   ├── gallery/
│   ├── events/
│   └── config/
├── admin/
│   ├── users/
│   ├── roles/
│   ├── jobs/
│   ├── inventory/
│   ├── commissions/
│   ├── sales/
│   ├── contacts/
│   └── ...
├── orders/
├── trips/
├── config/
│   ├── square/
│   └── etsy/
├── newsletter/
├── blog/
└── analytics/
```

---

## Decisions Made

1. **Ship is standalone** — Ship does NOT require Sell. Customers may use external order systems (Etsy, Shopify) and only need pack/ship workflows within Mast.
2. **Mast Management is a separate app** — Its own codebase at `runmast.com/admin/`, clean separation from the tenant-facing admin app.
3. **Dashboard is always visible** — Like Manage, Dashboard is a core feature every customer gets regardless of tier. It aggregates from whatever modules are enabled.
4. **Trial = full Pro access** — Trial customers get all modules unlocked. When trial ends, they pick a tier and choose which modules to keep.

## More Decisions Made

5. **"From the Studio" → "Behind the Scenes"** — generic section name for any business type.
6. **Commissions always included with Sell** — no sub-feature toggles within modules. If Sell is on, all Sell features (POS, Orders, Commissions, Events, Coupons, Receipts) are on. Simpler gating model.
7. **Module granularity = section level** — each sidebar section is exactly one module. No sub-feature toggles.

## Decisions Made (Session 2 — Architecture Deep Dive)

8. **Multi-RTDB** — one RTDB instance per tenant within the same Firebase project. Each tenant gets a full 256MB independently. Tenant's database URL stored in platform registry.
9. **Dynamic module file loading** — split 30K-line single file into core.js + shared.js + mod-{module}.js files. Modules loaded dynamically based on tenant subscription. Unsubscribed modules never downloaded.
10. **Firebase Hosting with custom domains** — replace GitHub Pages. Each tenant gets their custom domain pointed at the same admin app deployment. Tenant resolved from hostname via `tenantsByDomain` lookup.
11. **GitHub stays as source repo** — deploy to Firebase Hosting via GitHub Actions on push to main.
12. **Keep `shirglassworks` as tenantId** — no data migration. The existing path prefix becomes the tenantId.
13. **Single login, tenant switcher** — Mast admin logs in once, can switch between tenants. UID present in every tenant's `userTenantMap`.
14. **Stripe integration from day one** — build subscription billing into the platform from the start.
15. **Public tenant pages deferred** — not v1. Most customers have their own websites. Build when a customer actually needs it.
16. **Tenant resolution via hostname** — `tenantsByDomain` Firebase lookup maps domain → tenantId. Branding applied before login screen.
17. **MastDB + MCP server share same interface contract** — same entity/action naming enables future swap from client-side RTDB to API-first architecture.

## Pricing (First Pass)

| Tier | Modules | Price |
|------|---------|-------|
| **Starter** | Manage + 1 module | $39/mo |
| **Growth** | Manage + 2-3 modules | $99/mo |
| **Pro** | Manage + 4+ modules (all) | $149/mo |
| **Trial** | All modules (full Pro) | Free (time-limited) |

## Layer 12: Data Access Abstraction (Migration Insurance)

### The Problem
The admin app has ~25 path constants and ~50 inline `db.ref()` calls scattered through 30K lines. Each call bakes in three things: the tenant identity (`shirglassworks`), the database technology (RTDB-specific API), and the query logic. Changing any of these requires touching 50+ locations.

### The Solution: MastDB Abstraction Layer
A centralized data access object that all app code goes through. The app never calls `db.ref()` directly.

```
MastDB.tenantId = 'shir';  // Set at login

MastDB.products.list({ category, limit })   → Promise<Product[]>
MastDB.products.get(id)                     → Promise<Product>
MastDB.products.create(data)                → Promise<id>
MastDB.products.update(id, data)            → Promise<void>
MastDB.products.listen(callback)            → unsubscribe function
```

~20 entities × 3-6 methods each = ~80-100 functions total.

### Entities to Abstract

| Entity | Module | Methods Needed |
|--------|--------|---------------|
| products | Manage | list, get, create, update, delete, listen |
| inventory | Manage | getByProduct, update, listen |
| orders | Sell | list, get, create, updateStatus, listen |
| sales | Sell (POS) | create, list, listenRecent |
| salesEvents | Sell (Events) | list, get, create, update |
| commissions | Sell | list, get, create, update |
| coupons | Sell | list, get, create, update, delete |
| jobs | Make | list, get, create, update, listen |
| trips | Run | list, getActive, create, complete, listenActive |
| contacts | Team | list, get, create, update, delete |
| users | Team | list, get, update, invite |
| roles | Team | list, get, update |
| gallery | Manage | list, update, reorder |
| images | Manage | list, get, upload |
| analytics | Manage | logEvent, query |
| auditLog | Manage | list, write |
| newsletter | Market | listIssues, getIssue, saveIssue, listSubscribers |
| blog | Market | listPosts, getPost, savePost |
| stories | Market | list, get, save |
| socialClips | Market | listPending, create, publish |
| config | System | get, update (tenant settings, Square, Etsy, etc.) |

### What This Buys at Each Scale Transition

- **1-100 (RTDB):** MastDB internals use `db.ref()`. Tenant ID is a path prefix.
- **100-1000 (Firestore):** Rewrite MastDB internals to use `firestore.doc()`. App code unchanged.
- **1000+ (PostgreSQL/API):** MastDB internals become `fetch('/api/products')`. App code unchanged.

### MCP Server Alignment
The MCP server's `mast_products`, `mast_orders` tools already implement this pattern server-side. The MastDB client-side abstraction should match the same interface contract so:
- Both use the same entity/action naming
- Migration to API-first (admin app → MCP server → database) is a swap, not a rewrite
- MCP server becomes the single source of truth for data access at scale

### Real-Time Handling
CRUD operations abstract cleanly. Real-time listeners need a `listen()` / `subscribe()` method per entity that returns an unsubscribe function. Today: RTDB `.on('value')`. Tomorrow: Firestore `.onSnapshot()`. Later: WebSocket subscription. The UI code doesn't care — it calls `MastDB.trips.listenActive(uid, callback)`.

---

## Remaining Open Questions

All resolved — see Decisions Made sections above and below.

1. ~~Module granularity~~ → Resolved: section-level, no sub-toggles.
2. ~~Billing integration~~ → Resolved: Stripe integration from day one.
3. ~~Data migration~~ → Resolved: keep `shirglassworks` as tenantId. No data migration needed.
4. ~~Public pages per tenant~~ → Resolved: defer, not v1. Most customers have their own sites.
5. ~~Cross-tenant features~~ → Resolved: single login, tenant switcher for Mast admin.
6. ~~Pricing model~~ → Resolved: flat per tier (see below).

---

## Migration Strategy: Abstract Now, Migrate Later

### Philosophy
Stay on the current infrastructure (Firebase RTDB, single-file app, GitHub Pages) as long as it works. Don't prematurely migrate. Instead, inject abstraction layers NOW so that when growth demands a migration, it's contained and fast.

When a migration IS needed, skip intermediate steps. Go directly from "prototype" (RTDB, path prefixes, single file) to "enterprise" (proper backend, proper database, proper deployment) — don't waste time on half-measures in between.

### What "Abstract Now" Means in Practice

**Build these abstraction layers on the current stack:**

1. **MastDB data access layer** — wrap all `db.ref()` calls. Today it talks to RTDB. Tomorrow it could talk to Firestore, PostgreSQL, or a REST API. The 30K-line app never knows the difference.

2. **Tenant config loader** — business name, categories, colors, authors, social links all loaded from Firebase config instead of hardcoded. Today it's a simple Firebase read. Tomorrow it could be an API call to a tenant service.

3. **Module gating via subscription config** — `isModuleEnabled()` checks a config object. Today that config comes from a Firebase path. Tomorrow it could come from a Stripe subscription webhook.

4. **Auth → tenant resolution** — login flow resolves tenant membership from `userTenantMap`. This is the bridge that makes multi-tenancy work regardless of what's behind it.

5. **MCP server interface contract** — MastDB client-side and MCP server-side use the same entity/action naming. When the admin app eventually moves to API-first, it's swapping `MastDB.products.list()` from `db.ref()` to `fetch('/api/products')`.

### What This Gives You at Each Growth Stage

**Now → Customer 2-10 (prototype):**
- RTDB with path prefixes, abstraction layers in place
- Module gating working, tenant config working
- Mast Management app for onboarding
- Cost: minimal infrastructure change

**Customer 10-100 (growth):**
- Same stack, same abstractions
- Monitor RTDB size (256MB limit), connection counts, costs
- If healthy, don't touch it

**Trigger point (approaching limits):**
- When RTDB size, cost, or performance forces a move
- Skip Firestore/intermediate steps
- Go directly to enterprise: PostgreSQL + API backend + proper frontend build
- MastDB abstraction means this migration only touches the data layer internals
- Everything else (UI, module gating, auth flow, MCP server) stays the same

### What NOT to Build Now
- Don't migrate to Firestore preemptively
- Don't build a separate API backend yet
- Don't add a build system / SPA framework yet
- Don't set up per-tenant Firebase projects
- Don't over-engineer billing integration (manual invoicing is fine for 2-10 customers)

### Recommended Phasing (Prototype → Multi-Tenant)

### Phase 1: MastDB Abstraction + Tenant Isolation
- Build MastDB data access layer (wrap all ~50 db.ref calls)
- Replace all hardcoded `shirglassworks/` paths with `MastDB.tenantId`
- Create `userTenantMap` and `tenants/` registry in Firebase
- Update Firebase rules for tenant-scoped access
- Auth flow: login → resolve tenant → set MastDB.tenantId → load data
- Seed Shir Glassworks as tenant #1

### Phase 2: Tenant Config + De-branding
- Move business name, categories, colors, authors, hashtags, etc. to `tenants/{tenantId}/config/`
- CSS variable injection from tenant config
- Replace glass-specific placeholder text with config-driven values
- Dynamic category arrays loaded from config

### Phase 3: Module Gating
- Add subscription record per tenant
- Create `isModuleEnabled()` function
- Create Team module (move Employees + Contacts from Manage)
- Gate sidebar sections and routes by subscription
- Module selection UI for Starter/Growth tier customers

### Phase 4: Mast Management Application
- Separate app at `runmast.com/admin/`
- Tenant onboarding flow (create tenant, set config, assign admin)
- Subscription management (tier, modules, trial status)
- Usage dashboard

### Phase 5: Onboard Customer 2
- Use Mast Management to create tenant
- Configure their business identity, modules, admin user
- Validate everything works with two tenants on shared RTDB

### Phase 6: Infrastructure (When Growth Demands)
- Cloud Functions made tenant-aware
- MCP server tenant context per request
- Per-tenant API credentials
- Public page mechanism for customers without websites
- Billing integration (Stripe or similar)

---

## Key Files to Modify

| File | Role |
|------|------|
| `app/index.html` | Admin app — ALL layers affected |
| `index.html` | Landing page — branding, Firebase config |
| `shop.html` | Shop — categories, products, branding |
| `about.html` | About — full business bio copy |
| `commission.html` | Commission — glass-specific copy |
| `schedule.html` | Schedule — branding |
| `product.html` | Product detail — commission CTA |
| `orders.html` | Orders — branding |
| `blog/index.html` | Blog — branding, social links |
| `blog/post.html` | Blog post — branding |
| `studio/index.html` | Studio PWA — Firebase config, title |
| `studio/manifest.json` | PWA manifest — app name |
| `mcp-server/src/firebase.ts` | MCP — hardcoded paths |
| `database.rules.json` | Firebase rules — admin UID, paths |
| NEW: Mast Management App | Platform admin — tenant CRUD, subscriptions, usage |
