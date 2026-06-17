# MastIntake channels-OAuth family (`delegated-auth`) — design + build slice

**Status:** template-side slice SHIPPED (dev); per-provider OAuth CFs carved out to
separate sessions. Family is `prodReady:false`-equivalent (inert until CFs ship), like
the rest of MastIntake.

**Engine:** `shared/mast-intake.js` · **Catalog:** `app/modules/connections-providers.js`
· **Surface:** Settings → Channels → *Connected* tab (`renderConnectionsBoard` in
`app/index.html`).

**Research (CC knowledge base, validated 2026-06-16):** tree *"Unified Connections
Framework — archetypes & per-provider map"* (`-OvDZ9kCBSrseoymk5nl`), esp. the
reconciliation node `-OvKwSsHC5pUDMoiAscQ`, the Plaid / Stripe-Connect / email /
connect-UX nodes.

---

## 1. What this is — the 4th MastIntake family, NOT a new framework

MastIntake is the client-side secure-intake engine (`window.MastIntake`, eager
`shared/mast-intake.js`, provider catalog `connections-providers.js`). It already
covered three of the four connection archetypes:

| Archetype | MastIntake family | Status |
|-----------|-------------------|--------|
| **C** — guided key-paste → server vault | `held-secret` | shipped (github, SendGrid, Shippo, Stripe sk, + channel held-secrets) |
| **D** — DNS / domain-ownership verify | `domain-control` | shipped (email-domain, custom-domain) |
| PII — envelope field-encryption | `identity-data` | shipped (compliance IDs, vendor EIN/SSN) |
| **A** — one-click delegated OAuth / Link | **`delegated-auth`** | **THIS SLICE** |
| **B** — one-click authorize → server callback auto-provisions key | `delegated-auth` (`authType:'B'`, WooCommerce `wc-auth`) | catalog stub (CF carved out) |

The research's headline: *the customer rarely pastes a key — most connections are
one-click; the real cost is one-time Mast-side provider registrations.* So the build is
**add channels-OAuth + unify the surface**, reusing the live channel plumbing — not a
parallel "Connections framework."

## 2. The `delegated-auth` family grammar

Structurally a **twin of `domain-control`**: adapter-driven, the engine renders a
provider-agnostic **connect card** and drives it entirely through `def.adapter`. No
provider knowledge enters the engine.

- **`secureField()`** forks to `delegatedField()` → a connect CARD (status badge +
  action button + derived trust copy + guide), never a secret-paste input.
- **`applyDelegatedState(wrap, def, s)`** maps the `IntakeStatus` enum → card UI:
  - `not-collected` → "Connect with X" + trust copy + guide + a *skippable* nudge.
  - `connected` → **"✓ Connected to &lt;store&gt;"** (specific positive confirmation) +
    Reconnect + Disconnect.
  - `needs-reauth` / expired → "Reconnect" + Disconnect (copy varies on `refreshable`).
  - `error` → reconnectable error note.
  - `pending` → "Approve in the new tab → Refresh status" (set right after launch so the
    click is never a no-op — the OAuth dance completes in a new tab).
  - `available:false` → honest **"Coming soon"** card (disabled CTA, never a 404-ing
    button) — the *"don't make connect a cold wall"* rule.
- **Handlers** `da-connect` / `da-disconnect` / `da-refresh` wire into the existing
  delegated click-listener. `status()` / `hydrate()` / `refresh()` / `revoke()` /
  `collect()` each get a `delegated-auth` branch.
- **`status()`** prefers `adapter.healthCheck()` (rich: store name, detail,
  connectedAt, lastError) and falls back to the coarse `ChannelConnection` token-status
  vocab map already in the engine.

**Trust copy** is derived from `(family, authType)`, never free-authored:
- `authType:'A'` (pure OAuth): *"You authorize on X's own page — Mast never sees your
  password."*
- non-`A` (C→A hybrid, Etsy/Square): two-part — the paste leg AND the OAuth leg, so
  neither half is hidden.

**Concierge** is engine-forced to `false` for everything but `(delegated-auth, A)` — a
human must never receive a raw held secret/PII (design §6.5). Left off until a concierge
desk is staffed.

**Fail-closed posture:** `delegated-auth` is deliberately **absent** from
`FAIL_CLOSED_FAMILIES` — there is no client-side plaintext write path to guard. The
upstream token is minted, vaulted, and refreshed **server-side** (the provider's
callback CF + the sync engine / refresh cron). `refreshable` / `tokenLifetime` on the
def drive status copy only; the client never refreshes a token.

## 3. Per-provider map

| Provider | id | authType | available | tokenLifetime | Notes |
|----------|-----|----------|-----------|---------------|-------|
| Shopify | `shopify` | A | ✅ live | long-lived | folds live `connectChannel('shopify')` + `*OAuthStart` CF |
| Etsy | `etsy` | C→A | ✅ live | short-refreshable | paste keystring+secret (held-secret) → OAuth |
| Square | `square` | C→A | ✅ live | short-refreshable | paste client id+secret → OAuth (sandbox/prod) |
| Wix | `wix` | A | ⏳ soon | ~5-min access (server-refresh) | CF carved out |
| Squarespace | `squarespace` | A | ⏳ soon | 30-min access / 7-day refresh | CF carved out |
| WooCommerce | `woocommerce` | B (`wc-auth`) | ⏳ soon | permanent key | authorize once → server callback auto-provisions key |
| Plaid (bank link) | `plaid` | A (hosted Link) | ⏳ soon | permanent access token | Mast holds client_id/secret; per-customer permanent token |
| Stripe Connect | `stripe-connect` | A | ⏳ deferred | no refresh | **DEFER** per research — order data already covers revenue/P&L; only adds fee/payout reconciliation |

The 3 live channels **fold the shipped plumbing** (`window.connectChannel` /
`disconnectChannelCallable` / `MastDB.businessEntity.channels.list()`) into the
MastIntake grammar — REUSE, no cross-repo work. The connect *launch* and any
credential pre-leg (the C→A hybrids' developer-app keys) stay in the live flow;
MastIntake supplies the card, trust copy, status vocabulary, positive confirmation, and
skippable re-entry.

## 4. The unified connect surface

`renderConnectionsBoard()` replaces the legacy per-platform channel cards in Settings →
Channels → *Connected* (the legacy `loadChannelsConnectCardsLegacy` is kept as a
fail-closed fallback). It presents **every MastIntake family** in one surface:

- **"Connect your tools"** — the `delegated-auth` family as connect cards (live channels
  first, then coming-soon, then deferred), each with the connected-channel Sync-now +
  cadence extras (reusing the existing globals) when connected.
- **"Other connections"** — a read-only cross-family overview of `held-secret` +
  `domain-control` providers (status badge + a *Manage* action that opens the family's
  own secure grammar via `MastIntake.collect`), plus one informational line for the
  per-field `identity-data` PII (managed in Compliance & Vendor settings).
- Preserves the **EU residency gate** (`_isEuTenant` → `#channelsEuGate`) and the
  **aggregate health card**.

Connect-UX rules honored (research node `-OvDZfgHMBd8tuQ53YF4`): guided deep-link in a
new tab, paste-and-validate (held-secret), specific positive success line, trust
microcopy, skippable + re-entry. Concierge fallback is the engine's `conciergeEligible`
hook (off until staffed).

## 5. Carved out — cross-repo CFs (each its own session)

Per-provider OAuth-start + callback Cloud Functions in `mast-architecture`, plus the
GDPR/EU data-protection gate CF. The template defs declare `available:false` until each
lands; flip the flag + wire the adapter when the CF ships.

- **Wix OAuth** start + callback (token TTL ~5 min → server refresh).
- **Squarespace OAuth** start + callback (30-min / 7-day refresh).
- **WooCommerce `wc-auth`** callback (one-click authorize → server receives + vaults the key).
- **Plaid Link** token + public-token exchange (Production review is the one-time cost).
- **Stripe Connect** OAuth (deferred per research; `scope=read_only`).
- **EU-gate CF** — server enforcement of the EU/GDPR data-protection gate for delegated
  auth (the client `_isEuTenant` placeholder is in place).

## 6. Constraints honored

Own worktree off `origin/main`; PR auto-merges on green → CI deploys dev. `app/*` change
bumped `MAST_MODULES_V` (+ the shared `mast-intake.js?v=` suffix). All 13 lints pass.
Dev-only; new family stays inert (live channels reuse existing CFs; coming-soon
providers cannot connect). Verify via `<tenant>.runmast.com`.
