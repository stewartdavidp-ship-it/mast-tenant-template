# Admin section — V2 conversion build plan

**Round:** Admin (2026-06-10). Process: `v2-conversion-playbook.md` (current through the
Classes round). Recon was Explore-agent + line-level verification on a fresh
`origin/main` worktree; every claim below was re-checked against live code (three recon
errors were caught and corrected — see Recon amendments).

**Operator directives in force this round:**
1. **Settings is READ-MOSTLY.** Recon + characterization only; any Settings write-path
   conversion needs explicit per-item operator approval BEFORE touching it. Config docs
   here are consumed by Cloud Functions and the storefront; sandbox/integration/alert
   toggles are never flipped as part of a walk without flagging first, and config docs
   are never "scrubbed" as demo data.
2. **Consolidate around hub objects, don't twin 1:1.** Sidebar mergers ship only after
   ratification (options table below).
3. **Plain-language naming** (owner vocabulary) in titles/lens pills/labels.
4. **V1 sunsets on V2 ratification** — keep `mastUiRedesign` flag-gating, zero
   legacy-parity engineering.
5. **Employees is the RBAC source** — walk CRUD only on a THROWAWAY role/member, never
   the operator's own row. Coins/Subscription are billing-ish — read-only
   characterization; Stripe-checkout CFs are never exercised in a walk.

---

## 1 · Scorecard

| Route | Sidebar label | V1 surface | V2 today | Visible in live sidebar? | Status |
|---|---|---|---|---|---|
| `employees` | Permissions | index.html embedded (~1.7k lines: users list, role matrix, user detail) | — | yes (alwaysOn) | **convert** |
| `analytics` | Analytics | index.html embedded (read-only traffic report) | — | yes (alwaysOn) | **convert** |
| `auditlog` | Audit Log | index.html embedded (read-only append-only log) | — | yes (alwaysOn) | **convert** |
| `suppressions` | Audit Suppressions | audit-feedback.js management page | `audit-suppressions-v2` (mapped) | **NO — no MODE_ROUTE_VISIBILITY entry** | **consolidate** |
| `settings` | Settings | index.html embedded, ~20 grouped sub-views | `settings-v2` **orphan** (manifest-wired, unreachable) | yes (alwaysOn) | **read-mostly: characterize** |
| `subscription` | Subscription | index.html embedded (tier/usage/revenue + Stripe CTA) | — | yes (alwaysOn) | **consolidate** |
| `coins` | Coins | index.html embedded (balance/packs/purchase CF) | — | **NO — no MODE_ROUTE_VISIBILITY entry** | **consolidate** |
| `ask-ai` | Ask AI | index.html embedded (modern chat over MastAskAi + CFs) | — | **NO — no MODE_ROUTE_VISIBILITY entry** | non-goal (already modern) |
| `about` | About | index.html embedded (static build/tenant/tier card) | — | yes (alwaysOn) | fold (options) |
| `email-log` | Email Log | email-log.js (561 ln) | `email-log-v2` (mapped, post-standard) | yes (alwaysOn) | **audit only** |
| `audit` (not in Admin sidebar) | — | audit-feedback.js | `audit-v2` (mapped, post-standard, has a **Suppressed bucket**) | n/a | reference surface |

### Recon amendments (claims corrected during verification)
- Recon said audit-suppressions-v2 "uses pageHeader" — **false**: hand-rolled `<h1>` +
  inline tiles (audit-suppressions-v2.js:182–189). Pre-standard chrome.
- Recon said "no orphan V2 twins" — **false**: `settings-v2` is manifest-wired
  (index.html:22160) but appears in no route map, no sidebar, no `navigateTo` —
  unreachable (the calendar-v2 pattern), and stale (a 4-card launcher over
  wallet/terms/brand/homepage vs the ~20-sub-view legacy surface).
- Recon's mode-visibility absences were right but under-weighted: `suppressions`,
  `coins`, `ask-ai` are **soft-hidden for every tenant** (`isRouteVisibleByDefault`:
  unknown route → false, business-entity-constants.js:882). The Audit Suppressions
  sidebar item is dead chrome today.

---

## 2 · Surface characterizations (verified)

### employees — Permissions (RBAC source)
Three views in one tab (`switchEmployeesView`, index.html:51065): **Users** (list of
`admin/users`, archived-toggle, per-row role dropdown + Archive), **Roles** (permission
matrix per role over module-permission triads + sensitive actions), **User detail**.
- Reads: `MastDB.adminUsers` (`admin/users`), `MastDB.roles` (`admin/roles`),
  DEFAULT_ROLES + FUNCTION_PERMISSIONS constants.
- Writes: `changeUserRole` → `MastDB.adminUsers.update` + `writeAudit` (guards: last-admin
  lockout check, unknown-role refusal, own-row protections); `archiveUser` → CF
  `setUserArchived` (disables Firebase Auth + revokes sessions); role matrix saves →
  `MastDB.roles.setModulePermissions` / `.setSensitiveActions`; `saveNewRole` →
  `MastDB.roles.set`.
- Archetype: **record hub, two entities** (Team member + Role) — one Permissions hub
  with Users / Roles lenses. The V1 write cores are already nearly state-free; bridge
  extraction is straightforward. **Walk safety:** create a throwaway member/role for
  CRUD; never touch the operator row (V1 already self-guards, but don't lean on it).

### auditlog — Audit Log
Read-only, append-only admin action history. Reads `MastDB.auditLog`
(`admin/auditLog`, accessor rewrite-entities.js:442) ordered by `time`, paged
(`limitToLast(pageSize+1)` + cursor). Writer is `writeAudit(action, entity, entityId)`
(index.html:17229) stamping actor {uid, displayName}. Filters: actor / action / entity.
- Archetype: **read-only queue/report twin**. No writes, ever (append-only history; the
  walk itself generates real entries via writeAudit — that IS the demo data).

### suppressions — Audit Suppressions
`rule_suppressions` collection (wedge-audit rule suppressions). Twin exists, mapped,
read-only with "Manage in classic view" escape for un-suppress. **But**: the sidebar
item is invisible (no visibility entry), the twin's chrome is pre-standard, and
`audit-v2` — the audit findings queue this data belongs to — already has a
**Suppressed bucket** (audit-v2.js:48). This is a lens of the audit pipeline that got
stranded in Admin. Consolidation options in §5.

### analytics — Analytics
Read-only site-traffic report (summary/pages/interactions/visitors/recent) over
`analytics` hit data + GA config. No writes. Archetype: **report**; a thin read-only
twin is cheap; a deeper "insights" story is out of scope.

### settings — Settings (READ-MOSTLY this round)
~20 grouped sub-views (index.html:8875+): General, Product Page Display, Domains,
Payments, Shipping, Operations, Channels, Pricing Defaults, PIM, Develop,
Cost-to-Serve, Close Policy, Tax & Legal, Compliance, Workshop, Trips, Email,
**Apps/Integrations (absorbed the retired #accounting → QuickBooks tabs)**, AI & API
Keys, plus Dashboard/adminPrefs/accessibility. Carries `#sidebarAlertBadge` +
`#settingsSandboxBadge`. Writes singleton config docs (`admin/walletConfig`,
`admin/termsConfig`, `admin/subscription`, `public/settings`, `config/brand/*`,
`webPresence/config`, …) consumed by CFs and the storefront. ⚠ SINGLETON_COLLECTIONS
trap applies (shared/mastdb.js:185 — only `admin_subscription`, `admin_termsConfig`,
`admin_mappingFlowState` + 4 others are registered; any NEW singleton write path must
register first).
**This round:** no conversion. Deliverables: this characterization, the orphan
`settings-v2` disposition (§5 option S), and a debt-register entry for a future
Settings-round design discussion (a launcher/producer surface is the right shape; a
mechanical twin is not).

### subscription + coins — Plan & Billing
Two sidebar items over ONE object: `admin/subscription` + the platform tenant doc
(`v1LoadPlatformTenant`) + token wallet. Subscription renders tier/usage/revenue
forecast + upgrade CTA (CF `createUpgradeCheckoutSession`, `dismissUpgradeOffer`);
Coins renders coin balance/packs/recent + purchase CTA (CF `purchaseCoins` → Stripe).
Coins is **invisible today** (no visibility entry) — its content is reachable only by
hash. Archetype: **report + CTA hub**. Consolidation candidate: one "Plan & billing"
hub, Subscription / Coins as lenses. Stripe CFs are passthrough CTAs — never exercised
in the walk.

### ask-ai — Ask AI
Modern chat surface on shared `MastAskAi` (context payload v2 ships deep-links into
it), provider badge via CF `byoAnthropicStatus`, history, token-cost preview. Fits no
archetype (chat); already modern; flag-gating buys nothing. **Non-goal** (recorded, per
playbook §2 "a screen that fits none is a design discussion, not a build ticket").
Note: invisible today (no visibility entry) — disposition in §5.

### about — About
Static card: build/bundle versions, tenant id, tier, active modules
(`renderAboutSettings`, index.html:24656). No writes. Options in §5.

### email-log — Email Log
Twin is post-standard (pageHeader, define-at-load, static tab div, mapped, read-only
with sandboxed HTML preview + CSV export). **Audit only**: no `required:true` traps (no
editRender at all), one status field, bounded read. Round work = demo-data seed (sgtest15
email history) + walk.

---

## 3 · Consolidation analysis (evidence)

1. **Suppressions → the audit pipeline.** `audit-v2` already buckets findings
   Open/Snoozed/Rechecking/**Suppressed**/All. The suppressions page lists the RULES
   that cause the Suppressed bucket. One pipeline, currently split across two sidebar
   sections — and the Admin entry is invisible dead chrome. Fold the rules view into
   the audit surface (lens or SO), delete the Admin sidebar item.
2. **Subscription + Coins → one "Plan & billing" hub.** Same backing object
   (`admin/subscription` + platform tenant + token wallet), same CF family, and Coins
   is already invisible. Two lenses, one hub.
3. **About → fold.** A static 8-row kv card does not need a sidebar item. Natural homes:
   a card on Settings (legacy hosts it harmlessly) or the Plan & billing hub (tier +
   modules already render there).
4. **Analytics stays standalone** (thin report twin). It shares no object with anything
   else in Admin; merging it anywhere would be navigation fiction.
5. **Email Log stays** (already shipped V2; high CS-diagnostic value).

## 4 · Naming table (plain language, for ratification at holistic)

| Route | Today | Proposed | Why |
|---|---|---|---|
| employees | Permissions | **Team access** | "Permissions" describes the mechanism; owners think "who on my team can do what". |
| auditlog | Audit Log | **Activity history** | "Audit" is accountant-speak; this is "what happened, who did it". |
| suppressions | Audit Suppressions | *(absorbed — "Muted rules" lens on the audit surface)* | It's a lens of audit findings, not a destination. |
| subscription | Subscription | **Plan & billing** | Owners look for "my plan / what I pay". |
| coins | Coins | *(absorbed — "Top-ups" lens of Plan & billing)* | Coins are a billing instrument. |
| analytics | Analytics | **Site traffic** | Says what's inside; "Analytics" overpromises (it's traffic, not BI). |
| email-log | Email Log | **Email history** | Matches "Activity history"; "log" is operator-speak. |
| about | About | *(absorbed — "About Mast" card)* | — |
| settings | Settings | Settings (unchanged) | Read-mostly round. |

## 5 · Ratification options (decide at holistic PR; recommendation marked ★)

**Q1 — Audit Suppressions sidebar item (invisible dead chrome today)**
- **A ★** Remove the Admin item; surface suppression rules as a "Muted rules" lens on
  `audit-v2` (the pipeline it belongs to). Twin file is retired; `suppressions` route
  keeps a redirect mapping. Zero visible-nav loss (item is already hidden).
- B. Keep the twin, add the missing MODE_ROUTE_VISIBILITY entry, re-chrome to standard.
  (Preserves a 1:1 twin nobody could see; adds a 10th admin item.)
- C. Do nothing (leave dead chrome). Not recommended — fails the round's exit bar.

**Q2 — Subscription + Coins**
- **A ★** One `plan-billing-v2` hub (Subscription lens + Top-ups lens), both legacy
  routes mapped to it; sidebar shrinks by one. Coins becomes reachable again (it is
  invisible today).
- B. Twin each 1:1 (subscription-v2 + coins-v2 + new visibility entry for coins).
  Two surfaces over one object — against the consolidation directive.
- C. Subscription-only twin; leave Coins hash-only. Leaves a broken-window route.

**Q3 — About**
- **A ★** Fold into the Plan & billing hub as an "About Mast" card (build/bundle/tenant/
  tier already live there); remove the sidebar item on ratification.
- B. Fold into Settings as a card (read-mostly constraint allows an additive card, but
  it touches the legacy settings DOM — higher risk than A for the same outcome).
- C. Keep as-is (static V1 page persists post-V1-sunset as an exception).

**Q4 — orphan settings-v2 module**
- **A ★** Delete the orphan file + manifest entry this round (it is unreachable and
  stale); record the future Settings-producer design as a debt item for the Settings
  round. (V1 settings remains the only settings surface, per read-mostly directive.)
- B. Rewire it (map `settings` → `settings-v2`) — NO: it covers 4 of ~20 areas; shipping
  it as the settings home would hide 16 config areas behind "classic view".
- C. Leave the orphan. Dead flag-gated code keeps confusing recon (this is the 2nd
  round that tripped on an orphan).

**Q5 — Ask AI**
- **A ★** Non-goal: keep the V1 chat as the canonical surface (it's modern, shared-core
  backed); add the missing visibility entry so the sidebar item actually shows.
- B. Re-host the chat in a V2 module for chrome consistency. High risk, zero owner value.

## 6 · Waves (sequenced by end-to-end demo value)

- **Wave 0 — registry/demo-data groundwork (small PR + data work, no UI).**
  Visibility entries for routes that survive ratification (at minimum `ask-ai` per Q5-A;
  `coins`/`suppressions` resolve via Q1/Q2 instead of entries). Demo-data audit on
  sgtest15: email history (seed realistic sends if thin), admin/users + admin/roles
  census (create the THROWAWAY walk fixtures: one member "Tessa Brooks", one role
  "Studio assistant"), audit-log census (NO fabrication — append-only; the walk's own
  writeAudit entries are the demo). Verify accessor paths in rewrite-entities.js before
  any seed. MCP token self-confirm first.
- **Wave 1 — Permissions hub (`permissions-v2`)**: Users + Roles lenses, record SOs,
  bridge (`EmployeesBridge`) extracted from the V1 cores (changeUserRole / archiveUser /
  matrix + role saves), each legacy write EXECUTED ONCE on dev before bridging.
  Highest demo value (the operator manages real team access here).
- **Wave 2 — Activity history (`activity-log-v2`)**: read-only queue twin over
  MastDB.auditLog with actor/action/entity filters + pager; `auditlog` route mapped.
- **Wave 3 — Plan & billing hub (`plan-billing-v2`)**: Subscription + Top-ups lenses,
  read-only tiles + CTA passthrough buttons (CFs untouched), About card (Q3-A pending
  ratification). Routes `subscription` + `coins` mapped.
- **Wave 4 — Site traffic (`analytics-v2`)**: read-only report twin (summary tiles +
  pages/interactions/visitors/recent panes); `analytics` mapped.
- **Wave 5 — audit-pipeline consolidation (Q1-A pending ratification)**: "Muted rules"
  lens on audit-v2 delegating un-suppress to the AuditFeedback shared core; retire
  audit-suppressions-v2; remap `suppressions` → audit surface.
- **Holistic PR**: sidebar reorder + plain-language labels (post-ratification), orphan
  deletion (Q4-A), CRUD parity table, lint-v2-standard green. Operator walk happens
  BEFORE this PR.
- **Docs PR**: playbook retro (Admin round).

## 7 · Debt register

| Item | Why deferred |
|---|---|
| Settings conversion (producer/launcher design) | Operator read-mostly directive; per-archetype design discussion, not a mechanical twin. Needs its own round with per-item approval. |
| Ask AI chrome alignment | Non-goal Q5; chat fits no archetype. |
| `emails` collection still read via RTDB-style query shim in both V1 and twin | Works through MastDB compat; migrate when the email pipeline moves. |
| Analytics "insights" depth (GA4 integration, trends) | Out of scope; thin report twin only. |
| Audit log writer stamps `actor.displayName` at write time only | Historical rows with uid-only actors render via actorName fallback; durable fix is server-side. |
| testingModeItem (hidden, config-gated) | Untouched — device-local + config toggle, not part of the conversion. |

## 8 · Walk plan (pre-holistic; per playbook §5/§6)

Every nav item; every CRUD verb incl. CREATE on fresh records (throwaway member +
throwaway role); cold cross-drills; both themes (avatar menu "Dark mode"); console read
every time. Employees-specific: never edit/archive the operator's own row; role-matrix
edits only on the throwaway role; verify last-admin guard fires (read-only check, don't
complete). Settings: navigation + read assertions ONLY — no toggle flips. Subscription/
Coins: no checkout CTA clicks past the button render. Delete confirms scoped to
`#mastDialogOK`; SO saves via `window.MastUI.slideOut._save()`; record ids stashed on
`window.__vars`.
