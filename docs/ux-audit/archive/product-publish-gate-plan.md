# Plan — Server-side product readiness gate (close the MCP publish-bypass)

**Date:** 2026-06-06
**Driver:** [product-crud-parity-gap-analysis.md](product-crud-parity-gap-analysis.md) §4B.2 + §7 (validated live on sgtest15: a bare draft flips `draft → active` via MCP with no readiness check).
**Decisions:** Full parity with the UI checklist · Port the pure logic into the MCP now, extract a shared package later.
**Repo for the work:** `mast-tenant-mcp-server` (the tenant MCP). No template-repo code changes in Phase 1 (the UI already gates correctly).

> ✅ **SHIPPED 2026-06-06** — PR #80 (squash-merged to main, auto-deployed to dev). Full suite 470 green. **Live-verified on sgtest15:** the bare-draft `→ active` probe now returns `PRODUCT_NOT_READY{defined,costed,listingReady}`; a completed product flips ready→active cleanly; `check_product_readiness` agrees and writes nothing. Phase 1 complete. Remaining: §7 shared-package extraction (OPEN), and the `publish_product` channel-push pre-check (§4.4) — deferred.

---

## 1. Goal

Make the AI publish path enforce the **same readiness contract** the human UI enforces, so an
agent can't push an incomplete product live. Concretely:

1. Add a real **`ready`** status to the MCP lifecycle (today `set_product_status` only accepts
   `active|draft|archived`; the UI uses `draft → ready → active`).
2. Gate `draft → ready` on the **hard** checklist gates, and `ready → active` on its checks —
   recomputed **server-side at call time** from live data (no reliance on a possibly-stale
   persisted blob).
3. Expose a non-blocking **`check_product_readiness`** read tool so the agent can self-diagnose
   before attempting to publish (mirrors the existing `checkEnrollmentReadiness` pattern).

Non-goals (Phase 1): image upload, variant-field setters, revision staging — separate gap items.

---

## 2. Why this is feasible (the load-bearing finding)

Everything the checklist needs is already persisted on `public/products/{pid}` — the exact path
the MCP reads via `forTenant(tenantId).get(...)`:

| Input the checklist needs | Where it lives | Written by |
|---|---|---|
| `acquisitionType`, `defineSpec`, `markupConfig` | `public/products/{pid}/...` | maker.js:2855, 2865 |
| `totalCost` / `materialCost` / `laborCost` / `otherCost` | `public/products/{pid}/...` | `persistCostShape` maker.js:2417–2421 |
| `name`, `images[]`/`imageIds[]`, `description`/`shortDescription` | `public/products/{pid}` | catalog |
| `externalRefs.*`, `internalStorefrontOnly`, `channelSyncEnabled` | `public/products/{pid}` | channels |
| `leadTimeDays`, `batchSize`, `capacitySkipped` | `public/products/{pid}` | maker |
| `recipe.lineItems`, recipe markups | `recipes/{recipeId}` (via `product.recipeId`) | recipes |
| (derived) `readinessChecklist` snapshot | `public/products/{pid}/readinessChecklist` | `persistReadinessChecklist` maker.js:3067 |

The source logic — `computeReadinessChecklist(product, recipe)` (maker.js:2990–3059) and its helper
`productMarkupConfig(product, recipe)` (maker.js:2955–2984) — is **pure** (no DOM/window). It ports
to TS verbatim. We recompute live rather than trusting the persisted `readinessChecklist`, because a
product created/edited entirely via MCP may never have had the UI recompute it (staleness hole).

---

## 3. The contract being ported (must match the UI exactly)

`computeReadinessChecklist` returns five booleans: `{ defined, costed, channeled, capacityPlanned, listingReady }`.

**HARD gates (block the transition):** `defined`, `costed`, `listingReady`.
- `defined` — build: `recipe.lineItems.length > 0`; VAR: `defineSpec.var.components[]` or `.valueAddSteps[]` non-empty; resell: `defineSpec.resell.supplier.supplierName` && `.unitCost > 0`.
- `costed` — `product.totalCost > 0` && `productMarkupConfig(product, recipe)` non-null.
- `listingReady` — non-empty `name` && (`images[]` or `imageIds[]` non-empty) && (`description` or `shortDescription` non-empty).

**SOFT gates (warn, never block):** `channeled`, `capacityPlanned`.

**`draft → ready`** requires all 3 hard gates. **`ready → active`** adds two soft nudges (channel
mapping, inventory configured/made-to-order) — warn-only in the UI; we keep them warn-only.

> Parity rule: the MCP must block **iff** the UI's Promote button is disabled. The UI disables
> Promote only on hard-gate failure (maker.js:3169). So the MCP blocks on hard-gate failure only.

---

## 4. Implementation

### 4.1 New pure module — `src/shared/product-readiness.ts`
Verbatim TS port of `computeReadinessChecklist` + `productMarkupConfig`. No I/O. Exports:
```ts
export interface ReadinessChecklist { defined: boolean; costed: boolean; channeled: boolean; capacityPlanned: boolean; listingReady: boolean; }
export function computeReadinessChecklist(product: any, recipe: any | null): ReadinessChecklist;
export const HARD_GATES = ['defined','costed','listingReady'] as const;
export function readinessVerdict(c: ReadinessChecklist): { ready: boolean; failedHard: string[]; failedSoft: string[] };
```
Each gate keeps the UI's human label + hint (for the agent-facing message), sourced from the UI's
checklist item definitions (maker.js:3286–3333).

### 4.2 Gate the transition — `src/shared/tools/products.ts` `setProductStatus`
- Extend the valid-status enum to include `ready`.
- Before the write, when `newStatus ∈ {ready, active}`:
  1. read product (already done at products.ts:597), read recipe if `product.recipeId` (one `get`),
  2. `const c = computeReadinessChecklist(product, recipe); const v = readinessVerdict(c);`
  3. if `v.failedHard.length` → return `{ isError:true }` with
     `{ error, code:"PRODUCT_NOT_READY", failedHard, failedSoft, checklist:c }` and **do not write**.
  4. else write status (+ `promotedToReadyAt`/`promotedToActiveAt` to match UI fields maker.js:3183/3244),
     persist the fresh `readinessChecklist` (so UI + MCP agree), `writeTenantAudit(...,"update","products",pid)`.
- `archived`/`draft` transitions: unchanged (no gate).

### 4.3 New read tool — `check_product_readiness`
- Def in `src/skills/products.skill.ts` (params `{pid}`, `requiredPermission:{entity:"products",action:"read"}`),
  case in the `execute` switch, handler in `products.ts`.
- Returns `{ pid, status, ready, failedHard, failedSoft, checklist, hints }` — never writes. This is the
  agent's "why can't I publish?" tool and the thing the gate's error message points to.

### 4.4 `publish_product` (pim.ts) alignment
`publish_product` pushes to external channels and delegates real enforcement to Cloud Functions; it
already does a non-blocking channelBinding pre-check (pim.ts:686–717). Add the same readiness pre-check
as a **hard block there too** (publishing live to a channel is at least as consequential as `→ active`).
Keep CF as source of truth for channel-specific rules.

### 4.5 Keep the coarse platform tool honest
`mast-mcp-server`'s `mast_products` `set_status`/`update` call the **same** `shared/tools/products.ts`
handlers, so the gate applies there automatically — no separate change. (Verify: the platform server
vendors/imports the same `products.ts`; if it's a copy, port the diff.)

---

## 5. Tests (pin parity, prevent drift)
- **Unit** (`product-readiness.test.ts`): a fixture table of products (build/VAR/resell × complete/missing-each-hard-gate) asserting the exact 5-boolean output. Seed the fixtures from real sgtest15 product shapes so they mirror production data.
- **Parity guard:** a comment + test note pinning these fixtures to maker.js:2990–3059; if the UI logic changes, this test is the tripwire until the shared package lands (§7).
- **Handler test:** `setProductStatus → ready/active` on an incomplete product returns `PRODUCT_NOT_READY` and writes nothing; on a complete product it writes status + timestamps + audit.
- These run in the repo's existing test gate (per memory: tenant-mcp runs its suite as a merge gate; `npm ci` first — stale resolver footgun).

---

## 6. Rollout & verification
1. Branch + PR in `mast-tenant-mcp-server` (auto-deploys per that repo's flow; dev is frictionless).
2. **Live re-test on sgtest15** repeating the §7 probe: recreate the bare `zz-` draft, attempt
   `set_product_status → active` → expect `PRODUCT_NOT_READY` listing `failedHard:[defined,costed,listingReady]`;
   `check_product_readiness` returns the same; complete the product, then `→ ready` then `→ active` succeed.
3. Confirm the UI still promotes/launches identically (no template change, but smoke a product through
   Draft→Ready→Active in admin to be sure the persisted `readinessChecklist` shape still matches).

---

## 7. ✅ RESOLVED — single canonical core, parity-checked
Port-now had left `computeReadinessChecklist` / `productMarkupConfig` duplicated in `app/modules/maker.js`
(JS) and `mast-tenant-mcp-server/src/shared/product-readiness.ts` (TS). That duplication is now eliminated.

**Decision (over a published npm package):** the template has no bundler/npm at runtime (raw same-origin
`<script>`, CSP `script-src 'self'`), so a package would still need a copied browser file — all cost, no
benefit. Instead the gate logic lives in ONE canonical pure file, vendored byte-identical into both repos:

- **Canonical:** `shared/product-readiness.core.js` — a classic-script ES5 IIFE (no import/export, no DOM,
  no `recipesData` fallback) that assigns `window.MastProductReadiness` / `globalThis.MastProductReadiness`.
- **UI:** eager-loaded in `app/index.html` `<head>`; `maker.js`'s two functions are now thin wrappers that
  add the `recipesData` fallback (resolve the recipe) then delegate to the core.
- **MCP:** `src/shared/product-readiness.core.js` (byte-identical), imported for side-effect by the typed
  wrapper `src/shared/product-readiness.ts` (which re-exports with TS types). `tsconfig` gained
  `allowJs`/`checkJs:false` so `tsc` emits the core to `dist/`.

**Drift is blocked** by a committed-SHA parity check in BOTH repos (no cross-repo CI coupling):
`scripts/lint-readiness-parity.js` (template lint.yml) and `product-readiness-parity.test.ts` (MCP vitest)
each assert their local copy's sha256 equals the shared `BLESSED_SHA`. The §5 fixture test remains the
semantic backstop.

**To change the gate logic:** (1) edit BOTH repos' `product-readiness.core.js` identically; (2) recompute
`shasum -a 256 .../product-readiness.core.js`; (3) update `BLESSED_SHA` in both parity checks; (4) run
`scripts/bump-modules-version.sh` in the template (the core's `?v=` is kept in lockstep with `MAST_MODULES_V`).

---

## 8. Source refs
- UI gate: `app/modules/maker.js` — `computeReadinessChecklist` 2990–3059, `productMarkupConfig` 2955–2984, `promoteToReady` 3156–, `launchToActive` 3205–, persist 3062–3094 / 2417–2421, panel 3286–3333.
- MCP: `mast-tenant-mcp-server/src/shared/tools/products.ts` `setProductStatus` 587–622; `src/skills/products.skill.ts` defs+`execute` 271–328; `src/shared/tools/pim.ts` `publishProduct` 619–769; audit `src/shared/firebase-shared.ts` `writeTenantAudit`; pattern ref `src/shared/tools/students.ts` `checkEnrollmentReadiness`.
