# Mast Multi-Tenancy Implementation Plan

## Overview

Transform the Mast admin app from a single-tenant system (Shir Glassworks) to a multi-tenant SaaS platform. Six phases, ordered by dependency. Each phase produces a working system — no phase leaves the app broken.

**Philosophy:** Abstract now, migrate later. Every phase runs on the current stack (Firebase RTDB, GitHub Pages until Phase 5). No premature infrastructure migrations.

---

## Phase 1: MastDB Abstraction Layer

**Goal:** Wrap every `db.ref()` call in a centralized data access object. After this phase, no app code touches Firebase directly.

**Why first:** Everything else depends on this. Tenant isolation, multi-RTDB, future database migration — all require a single place that controls data access.

**Dependencies:** None — this is the foundation.

### Step 1.1: Build the MastDB Object

Create the MastDB namespace with tenant context and entity methods.

```javascript
var MastDB = {
  tenantId: null,
  db: null,  // Firebase database reference

  init: function(config) {
    this.tenantId = config.tenantId;
    this.db = config.databaseUrl
      ? firebase.database(config.databaseUrl)
      : firebase.database();
  },

  _ref: function(path) {
    return this.db.ref(this.tenantId + '/' + path);
  }
};
```

Add entity namespaces one at a time:
- `MastDB.products` — list, get, create, update, delete, listen
- `MastDB.orders` — list, get, create, updateStatus, listen
- `MastDB.inventory` — getByProduct, update, listen
- Continue for all ~20 entities (see analysis Layer 12)

**Files:** `app/index.html` (add MastDB object, ~200-300 lines)

### Step 1.2: Migrate Path Constants

Replace all ~25 `var XXXX_PATH = 'shirglassworks/...'` declarations with MastDB calls.

**Before:**
```javascript
var PRODUCTS_PATH = 'shirglassworks/public/products';
// ... later in code ...
db.ref(PRODUCTS_PATH).once('value').then(...)
```

**After:**
```javascript
MastDB.products.list().then(...)
```

Migrate one entity at a time. Test after each migration. Order by risk (lowest first):
1. `config` (settings, read-only mostly)
2. `gallery` (simple read/write)
3. `products` (high usage, well-understood)
4. `inventory` (tied to products)
5. `orders` (complex, multiple statuses)
6. `sales` / `salesEvents` (POS)
7. `commissions`
8. `jobs` (Make module)
9. `trips` (Run module)
10. `contacts` / `users` / `roles` (Team/auth)
11. `newsletter` / `blog` / `stories` / `socialClips` (Market)
12. `analytics` / `auditLog` (logging)
13. `coupons` / `receipts` (Sell extras)

### Step 1.3: Migrate Inline db.ref() Calls

Find and replace ~50 inline `db.ref('shirglassworks/...')` calls scattered through the codebase. These are the ones NOT using path constants — direct references in functions.

Search patterns:
- `db.ref('shirglassworks/`
- `database().ref('shirglassworks/`
- `firebase.database().ref('shirglassworks/`

Each becomes a MastDB method call.

### Step 1.4: Migrate Real-Time Listeners

Convert all `.on('value', ...)` listeners to `MastDB.entity.listen(callback)` pattern. Each returns an unsubscribe function.

**Before:**
```javascript
db.ref(TRIPS_PATH + '/' + uid + '/active').on('value', function(snap) { ... });
```

**After:**
```javascript
var unsub = MastDB.trips.listenActive(uid, function(trip) { ... });
// Call unsub() when leaving the view
```

### Step 1.5: Set Default Tenant

At app init (before auth changes), set `MastDB.init({ tenantId: 'shirglassworks' })`. This makes the app work exactly as before — same paths, same data, same behavior. The abstraction is invisible to users.

### Deliverable

- MastDB object with ~80-100 methods across ~20 entities
- Zero `db.ref('shirglassworks/...')` calls remaining in app code
- App functions identically to before — all tests pass, all features work
- Ready for tenant isolation (Phase 1b)

### Verification

- Search codebase for `db.ref('shirglassworks` — should return 0 results
- Search for `XXXX_PATH` constants — should all be removed or unused
- All existing features work: products CRUD, orders, trips, POS, blog, etc.
- Real-time updates still work (trips, POS, jobs)

---

## Phase 1b: Tenant Registry + Auth Flow

**Goal:** Create the platform-level tenant registry and update the auth flow to resolve tenant membership.

**Dependencies:** Phase 1 (MastDB exists and controls all data access)

### Step 1b.1: Create Platform Registry in Firebase

Seed the following data in Firebase (can be done via Firebase console or a script):

```
mast-platform/
├── tenants/
│   └── shirglassworks/
│       ├── config/
│       │   ├── businessName: "Shir Glassworks"
│       │   ├── domain: "shirglassworks.com"
│       │   └── databaseUrl: null  // uses default RTDB for now
│       ├── subscription/
│       │   ├── tier: "pro"
│       │   ├── enabledModules: ["make", "market", "sell", "ship", "run", "team"]
│       │   └── status: "active"
│       └── status: "active"
├── tenantsByDomain/
│   └── shirglassworks_com: "shirglassworks"
└── userTenantMap/
    └── {Ori's UID}/
        └── shirglassworks: { role: "admin", joinedAt: "..." }
```

### Step 1b.2: Update Auth Flow

Modify the login flow to resolve tenant before loading data:

1. User signs in (existing Firebase Auth — unchanged)
2. **NEW:** Read `mast-platform/userTenantMap/{uid}` → get tenant list
3. **NEW:** If single tenant → auto-select. If multiple → show picker (build picker UI)
4. **NEW:** Read `mast-platform/tenants/{tenantId}/config/` → get tenant config
5. `MastDB.init({ tenantId, databaseUrl })` → connect to tenant's data
6. Load data (existing flow, now via MastDB)

### Step 1b.3: Update Firebase Rules

Add rules for the platform registry paths. The `mast-platform/` tree needs:
- `userTenantMap/{uid}` readable by that uid
- `tenants/{tenantId}/config` readable by users in that tenant's userTenantMap
- `tenantsByDomain` readable by any authenticated user (for hostname lookup)

Update `database.rules.json` — replace the 24 hardcoded UID locations with tenant-scoped rules.

### Step 1b.4: Replace ALLOWED_UIDS

Remove `ALLOWED_UIDS = ['Y8RX1PIzccfT95WIIFl4I37VZZ72']`. Admin status now comes from the tenant's user record: `mast-platform/userTenantMap/{uid}/{tenantId}/role === 'admin'`.

### Deliverable

- Platform registry seeded with Shir Glassworks as tenant #1
- Auth flow resolves tenant membership
- Firebase rules enforce tenant-scoped access
- ALLOWED_UIDS removed — admin determined by tenant user record
- App still works identically for Shir Glassworks users

### Verification

- Log in as Ori → auto-resolves to `shirglassworks` tenant
- All data loads correctly through MastDB with tenant prefix
- Firebase rules reject access to paths outside the user's tenant
- Admin functions still work (settings, user management)

---

## Phase 2: Tenant Config + De-branding

**Goal:** Move all Shir-specific content (branding, categories, text, authors) from hardcoded values to Firebase tenant config. After this phase, the app renders differently based on which tenant is loaded.

**Dependencies:** Phase 1b (tenant registry exists, config path established)

### Step 2.1: Categories + Sections

Move hardcoded arrays to Firebase:

**Before (hardcoded):**
```javascript
const CATEGORIES = ['figurines', 'jewelry', 'drinkware', ...];
const SECTIONS = [{ id: 'figurines', label: 'Figurines', description: 'Glass figurines' }, ...];
```

**After (loaded from config):**
```javascript
// Loaded at app init from mast-platform/tenants/{tenantId}/config/categories
var CATEGORIES = tenantConfig.categories || ['general'];
var SECTIONS = tenantConfig.sections || [];
```

Seed Shir's current values into `mast-platform/tenants/shirglassworks/config/categories`.

### Step 2.2: Business Name + Title

Replace all hardcoded "Shir Glassworks" references:
- `<title>` tag → `tenantConfig.businessName + ' Admin'`
- Header brand lockup → `Mast / ${tenantConfig.businessName}`
- Toast messages, export filenames, modal titles

Search for: `Shir Glassworks`, `shirglassworks`, `Shir`

### Step 2.3: CSS Variables (Branding Colors)

Load color palette from tenant config:

```javascript
// After tenant config loads:
document.documentElement.style.setProperty('--primary', tenantConfig.colors.primary);
document.documentElement.style.setProperty('--secondary', tenantConfig.colors.secondary);
document.documentElement.style.setProperty('--accent', tenantConfig.colors.accent);
document.documentElement.style.setProperty('--brand-gradient', tenantConfig.colors.gradient);
```

Rename `--glass-gradient` → `--brand-gradient` throughout CSS.
Rename `--amber`, `--teal`, `--cream` → `--primary`, `--secondary`, `--accent`.

### Step 2.4: Author Bios

Move Madeline/Ori bios from hardcoded objects to `tenantConfig.authors`. Load dynamically in blog/story author selector.

### Step 2.5: Social Media Templates

Move niche hashtags and caption templates to tenant config:
- `tenantConfig.hashtags.niche` (replaces `['#glassart', '#handblownglass', ...]`)
- `tenantConfig.captionTemplates` (replaces hardcoded product/studio/behind-scenes templates)

### Step 2.6: Placeholder Text

Replace glass-specific placeholders with generic or config-driven values:
- `"e.g. Borosilicate glass, lampwork technique"` → `"e.g. Materials, techniques used"`
- `"Kiln conditions, techniques, observations..."` → `"Process notes, conditions, observations..."`
- `"Describe the piece, materials, design details..."` → `"Describe the item, materials, design details..."`

### Step 2.7: Blog/Story Guided Prompts

Replace person-specific prompts:
- `"A personal note from Ori or Madeline..."` → `"A personal note from the team..."`
- Or load from `tenantConfig.guidedPrompts`

### Step 2.8: Contact Categories

Make configurable: `tenantConfig.contactCategories` with sensible defaults.

### Step 2.9: Fonts

Load tenant-specific accent font. Keep Archivo (Mast brand) and DM Sans (body) as platform defaults. Tenant config specifies heading font:

```javascript
if (tenantConfig.fonts && tenantConfig.fonts.heading) {
  // Dynamically load Google Font
  var link = document.createElement('link');
  link.href = 'https://fonts.googleapis.com/css2?family=' + tenantConfig.fonts.heading;
  document.head.appendChild(link);
}
```

### Deliverable

- Zero hardcoded Shir-specific content in the codebase
- All branding, categories, text loaded from tenant config
- Shir Glassworks looks identical (config seeded with current values)
- A hypothetical new tenant with different config would render differently

### Verification

- Search for "Shir Glassworks" in codebase — should only appear in docs, not app code
- Search for "glass", "figurines", "drinkware" — should not appear as hardcoded values
- Change a value in Firebase tenant config → app reflects the change on reload
- CSS variables are set from config, not from hardcoded `:root` values

---

## Phase 3: File Split + Dynamic Module Loading

**Goal:** Split the 30K-line single file into core + shared + module files. Load modules dynamically based on subscription.

**Dependencies:** Phase 2 (de-branding complete, so we're splitting clean code)

### Step 3.1: Extract CSS → styles.css

Move all `<style>` content from `index.html` to `app/styles.css`. Replace with `<link rel="stylesheet" href="styles.css">`. Biggest line-count reduction, zero functional risk.

### Step 3.2: Extract Shared Utilities → shared.js

Move framework-level code that all modules depend on:
- Toast notification system
- Modal/dialog system
- Table rendering helpers
- Form validation helpers
- Date formatting utilities
- Common UI components (badges, chips, status indicators)

### Step 3.3: Extract Core → core.js

Move the app framework:
- Firebase initialization
- MastDB object (from Phase 1)
- Auth flow + tenant resolution (from Phase 1b)
- Routing system (`navigateTo`, `ROUTE_MAP`, `SECTION_ROUTES`)
- Sidebar rendering
- Permission system (`isAdmin`, `hasPermission`, `isModuleEnabled`)
- Tenant config loader
- Dynamic module loader function

### Step 3.4: Build Dynamic Module Loader

Add to `core.js`:

```javascript
async function loadEnabledModules(enabledModules) {
  // Always load shared.js first
  await loadScript('shared.js');

  // Load Manage always (not gated)
  await loadScript('mod-manage.js');

  // Load enabled modules
  for (var mod of enabledModules) {
    await loadScript('mod-' + mod + '.js');
  }

  // All modules loaded — render the app
  renderApp();
}

function loadScript(src) {
  return new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
```

### Step 3.5: Extract Modules (One at a Time)

Extract in order of independence (least cross-dependencies first):

1. **mod-run.js** — Trips, expenses, reports. Most self-contained. Good first test.
2. **mod-team.js** — Employees, contacts (pulled from Manage). Self-contained.
3. **mod-ship.js** — Pack, ship. Small, self-contained.
4. **mod-teach.js** — Workshops. Future/minimal code.
5. **mod-make.js** — Jobs, procurement. References products (via MastDB).
6. **mod-market.js** — Social, blog, newsletter, stories. References products.
7. **mod-sell.js** — POS, orders, commissions, events, coupons. Largest module.
8. **mod-manage.js** — Products, inventory, customers, images, settings. Always loaded.

For each extraction:
1. Identify all functions, variables, and components belonging to that module
2. Move to `mod-{name}.js`
3. Verify all cross-references resolved (shared utilities, MastDB calls)
4. Test the module works when loaded dynamically
5. Test the app works without the module loaded (routes should show "module not available")

### Step 3.6: Update index.html

After all extractions, `index.html` should contain:
- HTML structure (shell, sidebar skeleton, main content area)
- `<link>` to `styles.css`
- `<script>` for `core.js` (only script loaded synchronously)
- No inline JavaScript beyond the initial `<script src="core.js"></script>`

### Deliverable

- ~10-12 separate files instead of one 30K-line file
- Dynamic loading: only enabled modules are downloaded
- Each file is 1-6K lines — manageable, readable
- App functions identically for Shir Glassworks (all modules enabled)

### Verification

- App loads and all features work
- Browser Network tab shows only enabled module files being loaded
- Disabling a module in subscription config → that module's JS file is not requested
- No JavaScript errors in console from missing dependencies

---

## Phase 4: Module Gating + Subscription

**Goal:** Gate sidebar sections and routes based on tenant subscription. Create the Team module. Build subscription awareness into the app.

**Dependencies:** Phase 3 (modules are separate files, dynamic loading works)

### Step 4.1: Create isModuleEnabled() Function

```javascript
function isModuleEnabled(moduleName) {
  if (moduleName === 'manage' || moduleName === 'dashboard') return true;
  if (!tenantSubscription) return false;
  if (tenantSubscription.status === 'trial') return true;
  return tenantSubscription.enabledModules &&
         tenantSubscription.enabledModules.indexOf(moduleName) !== -1;
}
```

### Step 4.2: Gate Sidebar Rendering

Modify sidebar builder to hide sections for disabled modules:

```javascript
// For each section in sidebar:
if (!isModuleEnabled(sectionModule)) {
  sectionDiv.style.display = 'none';
}
```

### Step 4.3: Gate Route Navigation

Add module check to `navigateTo()`:

```javascript
function navigateTo(route) {
  var module = getModuleForRoute(route);
  if (module && !isModuleEnabled(module)) {
    showUpgradePrompt(module);
    return;
  }
  // ... existing navigation logic
}
```

### Step 4.4: Create Team Module

Move from Manage:
- Employees & Permissions view → `mod-team.js`
- Contacts view → `mod-team.js`

Update `SECTION_ROUTES` to map Team routes. Add Team section to sidebar between Run and Manage.

### Step 4.5: Build Upgrade Prompt

When a user navigates to a disabled module, show a clean message:
- "This module is not included in your current plan"
- Show which tier includes it
- Link to settings/subscription management

### Step 4.6: Subscription Status Display

Add subscription info to Settings view:
- Current tier (Starter/Growth/Pro)
- Enabled modules (with toggle UI for choosing modules within tier limit)
- Billing status
- Trial countdown (if applicable)

### Deliverable

- Sidebar hides sections for disabled modules
- Route guards prevent navigation to disabled modules
- Team module exists as its own gated section
- Subscription status visible in Settings
- Shir Glassworks set to Pro (all modules) — no visible change for them

### Verification

- Change Shir's subscription to Starter with only "sell" enabled
- Sidebar shows only Dashboard, Sell, and Manage
- Navigating to `/trips` shows upgrade prompt
- Change back to Pro — all sections reappear
- Team module works independently (employees, contacts)

---

## Phase 5: Firebase Hosting Migration

**Goal:** Move from GitHub Pages to Firebase Hosting. Set up custom domain support and GitHub Actions deploy pipeline.

**Dependencies:** Phase 3 (multi-file structure — need to serve multiple JS files correctly)

*Note: This phase can run in parallel with Phase 4.*

### Step 5.1: Set Up Firebase Hosting

```bash
# In the shirglassworks repo
firebase init hosting
```

Configure `firebase.json`:
```json
{
  "hosting": {
    "public": ".",
    "ignore": ["firebase.json", "**/node_modules/**", "mcp-server/**", "docs/**"],
    "rewrites": [
      { "source": "/app/**", "destination": "/app/index.html" }
    ],
    "headers": [
      {
        "source": "/app/**/*.js",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }]
      }
    ]
  }
}
```

### Step 5.2: Test Deploy

```bash
firebase deploy --only hosting --project shir-glassworks
```

Verify the app works at the Firebase Hosting URL (e.g., `shir-glassworks.web.app`).

### Step 5.3: Set Up GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Firebase Hosting
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
```

### Step 5.4: Configure Custom Domains

Add domains in Firebase console:
- `shirglassworks.com` → point DNS to Firebase Hosting
- `app.runmast.com` → generic Mast admin entry point

Firebase auto-provisions SSL for each domain.

### Step 5.5: Add Hostname-Based Tenant Resolution

Add to `core.js` (runs before auth):

```javascript
function resolveTenanFromHostname() {
  var hostname = window.location.hostname;
  var key = hostname.replace(/\./g, '_');
  return firebase.database().ref('mast-platform/tenantsByDomain/' + key)
    .once('value')
    .then(function(snap) {
      return snap.val(); // tenantId or null
    });
}
```

If resolved → apply tenant branding to login screen before auth.
If null (e.g., `app.runmast.com`) → show generic Mast login, resolve tenant after auth.

### Step 5.6: Retire GitHub Pages

Once Firebase Hosting is verified:
- Update DNS records
- Remove GitHub Pages configuration from repo settings
- Update deploy documentation

### Deliverable

- App served from Firebase Hosting with CDN and auto-SSL
- GitHub Actions deploys on push to main
- Custom domains working (shirglassworks.com, app.runmast.com)
- Hostname-based tenant resolution applies branding before login
- GitHub Pages retired

### Verification

- Visit `shirglassworks.com/admin` → see Shir Glassworks branding on login
- Visit `app.runmast.com` → see generic Mast login
- Push to GitHub → GitHub Actions deploys to Firebase Hosting automatically
- SSL working on all custom domains

---

## Phase 6: Mast Management Application

**Goal:** Build a separate platform admin app for managing tenants, subscriptions, and usage.

**Dependencies:** Phase 1b (tenant registry), Phase 4 (subscription model), Phase 5 (Firebase Hosting for deployment)

### Step 6.1: Scaffold the App

Create new directory/repo for Mast Management. Single-file HTML app (same pattern as CC and the admin app):
- React via CDN
- Firebase RTDB for data
- Deploy to `runmast.com/admin/` via Firebase Hosting

### Step 6.2: Tenant List View

Dashboard showing all tenants:
- Business name, domain, status, tier, enabled modules
- Active users count, last activity
- Quick actions: edit config, manage subscription

### Step 6.3: Tenant Onboarding Flow

Create new tenant wizard:
1. Business name, domain
2. Admin user email (sends invite)
3. Select subscription tier + modules
4. Configure branding (colors, logo)
5. Set up categories (use defaults or customize)
6. **Automated:** Create RTDB instance, seed paths, add to `tenantsByDomain`, create `userTenantMap` entry

### Step 6.4: Subscription Management

Per-tenant subscription controls:
- Change tier (Starter/Growth/Pro)
- Toggle enabled modules (within tier limits)
- Manage billing status (active/trial/past_due/cancelled)
- Trial management (extend, convert)

### Step 6.5: Stripe Integration

Connect Stripe for automated billing:
- Create Stripe products for each tier ($39/$99/$149)
- Checkout flow for new subscriptions
- Webhook handler (Cloud Function) to update Firebase subscription status
- Customer portal for self-service billing management
- Trial → paid conversion flow

### Step 6.6: Usage Dashboard

Per-tenant usage metrics:
- Active users (daily/monthly)
- Data volume (RTDB size per tenant)
- Storage usage (images, documents)
- API call counts (if MCP server is instrumented)

### Deliverable

- Mast Management app at `runmast.com/admin/`
- Tenant onboarding flow (create tenant end-to-end)
- Subscription management with Stripe billing
- Usage monitoring per tenant

### Verification

- Create a test tenant via Mast Management
- Complete Stripe checkout for the test tenant
- Log into the admin app as the test tenant → see correct branding, modules
- Verify subscription status updates when Stripe webhook fires

---

## Phase 7: Onboard Customer 2

**Goal:** Validate the entire multi-tenant system with a real second customer.

**Dependencies:** All previous phases

### Step 7.1: Create Tenant via Mast Management

Use the onboarding flow to create the new tenant:
- Business name, domain, branding
- Admin user setup
- Subscription tier + module selection
- RTDB instance provisioned

### Step 7.2: Configure Integrations

Per the new tenant's needs:
- Square merchant account (if using Sell + POS)
- Etsy shop connection (if using Sell)
- Google Maps API key
- Image hosting setup

### Step 7.3: Custom Domain Setup

- Add tenant's domain to Firebase Hosting
- Guide tenant through DNS configuration (CNAME/A record)
- Verify SSL provisioning
- Confirm hostname-based tenant resolution works

### Step 7.4: Validation Checklist

- [ ] Login as Customer 2 admin → correct branding, modules
- [ ] Login as Shir Glassworks admin → unchanged experience
- [ ] Customer 2 cannot see Shir's data
- [ ] Shir cannot see Customer 2's data
- [ ] Module gating works for Customer 2's tier
- [ ] Stripe billing active for Customer 2
- [ ] Customer 2's custom domain resolves correctly
- [ ] Real-time features work (if applicable)
- [ ] MCP server handles both tenants (if used)

### Step 7.5: Monitoring Setup

- Firebase usage alerts per RTDB instance
- Stripe webhook health monitoring
- Error tracking per tenant (which tenant hit which error)

### Deliverable

- Two tenants running on the same platform
- Complete isolation verified
- Billing working for both
- Monitoring in place

---

## Phase 8: Infrastructure Scaling (When Growth Demands)

**Goal:** Address infrastructure limits when customer count or data volume demands it. NOT scheduled — triggered by monitoring thresholds.

**Triggers:**
- RTDB instance approaching 256MB
- Connection count > 100K concurrent
- Firebase costs exceeding thresholds
- Performance degradation observed

### Step 8.1: Cloud Functions Made Tenant-Aware

Rename `shir*` functions to `mast*`. Add tenant context parameter. Each function reads tenant config to determine which RTDB instance and credentials to use.

### Step 8.2: MCP Server Tenant Context

Pass tenant ID per request (from auth token or header). MCP server reads from the correct RTDB instance based on tenant config.

### Step 8.3: Per-Tenant API Credentials

Move Square, Etsy, and other API credentials to per-tenant secret storage. Cloud Functions and MCP server look up credentials by tenant ID.

### Step 8.4: Enterprise Migration (If Needed)

When RTDB limits are reached:
- Swap MastDB internals from `db.ref()` to `fetch('/api/...')`
- Build REST API backend (PostgreSQL + Node.js/Cloud Run)
- MCP server becomes the API backend
- App code unchanged — only MastDB internals change

---

## Phase Summary

| Phase | What | Depends On | Effort Estimate |
|-------|------|-----------|-----------------|
| **1** | MastDB abstraction layer | — | Large (wrap ~50 db.ref calls, build ~80 methods) |
| **1b** | Tenant registry + auth flow | Phase 1 | Medium (registry, auth changes, Firebase rules) |
| **2** | Tenant config + de-branding | Phase 1b | Medium (move ~15 hardcoded sections to config) |
| **3** | File split + dynamic loading | Phase 2 | Large (split 30K lines into ~12 files) |
| **4** | Module gating + subscription | Phase 3 | Medium (gating functions, Team module, UI) |
| **5** | Firebase Hosting migration | Phase 3 | Medium (hosting setup, GitHub Actions, DNS) |
| **6** | Mast Management app | 1b, 4, 5 | Large (new app: onboarding, subscriptions, Stripe) |
| **7** | Onboard Customer 2 | All above | Medium (validation, config, monitoring) |
| **8** | Infrastructure scaling | Triggered by growth | Large (when needed — Cloud Functions, MCP, API backend) |

**Parallelism:** Phases 4 and 5 can run in parallel (module gating is independent of hosting migration).

**Total estimated scope:** Phases 1-7 represent the work needed before Customer 2 goes live. Phase 8 is deferred until growth demands it.
