# Release Model — Mast Tenant Template

**Status:** Ratified 2026-05-30. This is the canonical source for how code moves from a
session to a tenant. It supersedes the scattered, partly-contradictory deploy/git guidance
previously spread across CLAUDE.md and ~15 memory files. Where this doc and a memory note
disagree, **this doc wins.**

Some pieces are **policy now** (follow immediately); others are **planned builds** (the
behavior they describe isn't wired yet). Each section is tagged. The build roadmap at the
bottom tracks the planned work.

---

## Organizing principle

> **Protection scales with blast radius. Pods are not equal.**

The original model treated every pod the same and applied production-grade ceremony
uniformly. The result: sessions froze on safe dev work (asking permission to deploy to the
test environment, hesitating over migration scripts) while the actual production surfaces
had *less* protection than they deserved. The fix is a two-tier model — the dev side is
frictionless, and **all** ceremony lives on the prod side.

---

## The layers (don't collapse them)

Five distinct layers get sloppily called "the environment." Conflating them is the root of
most deploy confusion.

| Layer | What it is | Examples |
|---|---|---|
| **GCP Project** | cloud container (infrastructure) | `mast-platform-prod`, `mast-platform-prod-us-east-1`, `…-west-1` |
| **Pod** | logical grouping, maps 1:1 to a project | `dev` → `mast-platform-prod`; `prod-us-east-1` → `…-east-1` |
| **Cloudflare** | edge: routing (KV `podRouting`) **+** edge cache | worker `runmast-tenant-proxy` |
| **Hosting Site** | a Firebase site *inside* a project (a project holds many) | `mast-tenant-shared`, `mast-tenant-shared-east-1` |
| **Tenant** | account in the data model; its hostname routes (via KV) to a site | `sgtest15`, `russelljonesjewelry` |

### Request path

```
<tenant>.runmast.com
   │  DNS: *.runmast.com → Cloudflare nameservers
   ▼
Cloudflare Worker  "runmast-tenant-proxy"
   │  ├─ apex runmast.com ─────────────► mast-platform-prod.web.app   (marketing, hardcoded)
   │  └─ everything else: KV lookup in namespace podRouting
   ▼
KV  podRouting[hostname] = { podId, originHost }
   │  ├─ hit  → proxy to originHost
   │  └─ miss → fallback to mast-tenant-shared.web.app  (dev shared site)
   ▼
Firebase Hosting site  (the origin a deploy lands on)
```

**Two consequences that bite people:**

1. **The tenant→site binding is a Cloudflare KV entry, not a fixed property.** A `mast_hosting deploy`
   lands code *on a site*; the KV entry decides *who reads that site*. Deploying changes nothing
   for a tenant whose KV points elsewhere. To answer "where does tenant X serve from?" do a **KV
   lookup**, never a pod-table inference.
2. **Cloudflare is also an edge cache** — a second staleness layer on top of the browser
   (`MAST_MODULES_V`). After a deploy the origin is fresh but the worker may serve a cached copy
   briefly. **Verification is therefore two checks, in order:**
   - **(a) origin-SHA** — fetch `<site>.web.app/app/index.html`, SHA-match against the deployed
     commit. Proves the bundle *shipped*.
   - **(b) worker-SHA** — fetch `<tenant>.runmast.com/app/index.html` (through the worker),
     SHA-match. Proves the edge cache cleared and that's what users *see*.

   Origin-pass + worker-fail = a *caching* problem, not a deploy problem (hard-reload / wait for
   edge TTL). The existing `deploy.yml` verify step does only (a) and fetches the origin — **it must
   be extended to add (b)**, otherwise CI declares success on a build users can't see yet.

**Site names are internal plumbing.** Reason in **pods + hostnames**. You pick a pod to deploy;
the tooling resolves the site. You verify on the hostname. You should rarely type a `.web.app` URL.

---

## The two tiers  *(policy now)*

The discriminator is one question: **can a real paying customer be affected?**

### Frictionless tier — no customer can be hit
- The **dev pod** = **one** storefront site (`mast-tenant-shared`), serving sgtest15 + all dev/test tenants.
- Dev-pod-only runtime, preview channels, and **dev/test KV edits**.

**Rule: deploying or routing within the dev pod is pre-authorized.** Never ask the user for
permission, never gate on migration scripts, never invoke "E2E-before-deploy" discipline for dev.
It is a disposable test environment. Iterate freely; fix forward.

⚠️ **Naming trap:** the dev pod's GCP project is literally named `mast-platform-prod`. **The
project name lies — the `dev` pod is dev/test.** Do not let `pod: dev` resolving to project
`mast-platform-prod` make you think you're touching production. You are not.

### Gated tier — a real customer is in the serving path
- Prod pod storefront deploys: `prod-us-east-1`, `prod-us-west-1`.
- The **`mast-platform-prod` *functions* surface** (control-plane: provisioning, billing, registry,
  webhook receivers — serves every pod). Treated as prod regardless of the shared project name.
- **runmast.com** marketing hosting (the public face).
- **Prod `podRouting` KV edits** — repointing a customer hostname is *instant*, bypasses deploy,
  build, and verify entirely. This is the sharpest action in the system; gate it hardest.

### Manageable gating — the guardrail against re-over-rotating
Gating must not become the old suffocation. The rule:

> **One gate, one layer, keyed on blast radius, one confirmation.**

- **One layer:** the gate lives in the deploy tool/command, where the target (`pod=dev` vs
  `pod=prod-us-east-1`) is known. Not stacked on top of a harness classifier and a tool confirm
  and session hesitation (the old triple-brake).
- **Keyed on target, not action-type:** reads, dry-runs, dev deploys, branch work all sail
  through. The prompt appears **only** at the moment of a real gated-surface write.
- **One confirmation:** the existing `type 'yes'` pattern. `mast-platform-prod` function deploys
  route through that same single gate — no new ceremony invented.

A gated deploy is *one* deliberate "yes." Everything around it stays frictionless.

---

## Dev workflow  *(policy now; auto-merge CI is a planned build)*

> always-isolate worktree → branch → PR → auto-merge-on-green → CI deploys dev → verify through
> the hostname → fix-forward

1. **Always isolate.** Every non-trivial task gets its **own git worktree + feature branch** —
   not the shared checkout. You cannot reliably detect whether another session is live, and
   branches alone don't help (git checks out one branch per working tree, so two sessions editing
   the same file in the same folder still clobber each other's *uncommitted* work). Use
   `spawn_task` chips, `Agent: isolation:"worktree"`, or `git worktree add /tmp/mtt-<task> -b feat/<task>`.
   Reserve the shared checkout for trivial single-shot edits where you know you're the only session.
2. **PR to main — consistently.** No fast-forward straight to main. PRs run CI (lint / RBAC /
   design-token / mastDB / module-info) *before* code reaches main and auto-deploys. **Auto-merge
   on green** for routine changes (near-FF velocity, nothing broken lands). **Delete-on-merge** to
   keep branch count sane. **No merge-time human review:** this is a single-account repo (one owner
   + AI sessions) and GitHub won't let you approve your own PR, so merge-time required review is
   structurally impossible. CI green is the merge gate; the human checkpoint for customer-facing
   change lives at the **prod deploy gate** (Build 2), not at merge.
3. **CI auto-deploys dev on merge to main.** `origin/main` *is* what's live on dev — no
   deploy-from-local-HEAD, no git/prod divergence. Do **not** hand-deploy dev from a local HEAD.
4. **Test post-merge, fix-forward (B1).** Merge → it deploys to dev → verify on
   `<tenant>.runmast.com` → fix forward if wrong. Dev breakage is cheap. For the rare high-stakes
   change you want green *before* it touches the shared dev site, use a **preview channel** (B2).
5. **Verify both layers (origin then worker).** Origin-SHA confirms the bundle shipped; worker-SHA
   on `<tenant>.runmast.com` confirms the edge + browser cache cleared and reflects what users see.
   Hard-reload to clear browser-cached module JS.

---

## Prod workflow  *(policy now)*

Lightweight, **gated**, operator-driven. Not the full CF propose→approve pipeline (deferred — see
roadmap).

1. **Push/merge first.** `mast_hosting` deploys from `origin/main` (a GitHub tarball), **not** your
   local tree. Unpushed commits silently don't ship. Push/merge, then deploy. ⚠️ The tarball fetch
   must be pinned to the merged SHA — re-fetching `/tarball/main` is the 2026-05-22 silent-success
   bug (CLI printed ✓ on a stale tree). See roadmap build 5.
2. **Pod-sequential rollout (free canary).** Deploy `prod-us-east-1` → **verify (origin-SHA then
   worker-SHA) + soak** → then `prod-us-west-1`. The two prod pods are the canary cohort.
   - **Soak criteria (concrete):** ≥ 10 minutes after east verify passes, watching for new 5xx /
     error-rate spike and a green synthetic request to a key page (`/`, `/shop`, `/app`). No new
     errors + synthetic green = proceed to west. Anything else = **roll back east, do not proceed.**
   - **Conscious trade-off:** east-1 carries real customers, so they *are* the canary cohort. That's
     acceptable for the current fleet size but is a deliberate choice, not a free lunch.
3. **Gated confirmation** (one `yes`) at each prod deploy. IAM grants on prod pods must be mirrored
   east↔west.
4. **Verify each pod** (origin-SHA then worker-SHA, on a real customer hostname) before proceeding.
5. **On failure, roll back that pod immediately** (see Rollback) and do **not** advance to the next.

Site mapping: `prod-us-east-1` → `mast-tenant-shared-east-1.web.app`;
`prod-us-west-1` → `mast-tenant-shared-west-1.web.app`.

---

## Rollback  *(policy now; redeploy-by-version may need a tool flag — roadmap build 7)*

A canary that detects but can't remediate is theater. Define the lever before relying on the soak.

- **Dev:** fix-forward. Cheap; no rollback machinery needed.
- **Prod — emergency lever:** redeploy the **prior known-good Firebase Hosting version id**
  (`mast_hosting` exposes version history via `list_versions`; redeploy-by-version is the fast path,
  no git churn). Alternatively, **KV-repoint** the pod's tenants to a preserved last-known-good
  preview channel.
- **Prod — durable fix:** a **git revert PR** so `origin/main` reflects reality. This is NOT the
  emergency lever — it has to go green first.
- ⚠️ **Because `mast_hosting` deploys the `origin/main` tarball, after an emergency version-rollback
  you MUST land the revert PR before the next deploy of *anything*** — otherwise the bad commit is
  still on main and re-ships on the next deploy.

---

## Cross-repo deploy ordering (storefront ↔ Functions)  *(policy now)*

Functions (`mast-architecture`) and the Firestore schema are **shared** across all tenants in a pod
and cannot be per-tenant frozen. The skew hazard the freeze section describes exists for *every*
release, not just freezes:

- **Deploy backward-compatible Functions first, storefront second.** Never deploy a storefront build
  that calls a Function signature not yet live.
- **A Function rollback must stay backward-compatible** with the live (and any frozen) storefront.
  Don't roll a Function back past a signature a live storefront depends on.
- When a change spans both repos, the storefront PR description must name the dependent
  `mast-architecture` deploy and confirm it's live first.

---

## Tenant freeze (release pin)  *(planned build — v1)*

Lets a tenant hold a specific build for a bounded window (e.g. a customer's internal
presentation). Same mechanism for dev demos and prod customers; only the tier (and thus the gate)
differs.

**The intent that sgtest15 got wrong:** sgtest15 was meant to be a deliberate, temporary freeze
but decayed into a permanent, invisible per-tenant-site pin. The lesson:

> **A freeze must be self-announcing and self-expiring.** A routing override with no `reason` and
> no `lockedUntil` is drift, regardless of why it was created.

**Spec:**
- **Mechanism:** snapshot the chosen release to a Firebase Hosting **preview channel**; set a
  **labeled** KV override on the tenant hostname → that channel: `{ originHost, reason, lockedUntil }`.
- **Expiry:** mandatory. Set as a duration (`7d`) or a fixed date; both resolve to an absolute
  `lockedUntil`. **Hard cap 7 days for prod** (dev demos shorter). Re-freeze allowed, each bounded
  and logged.
- **Auto-lift:** the reconciler clears the override **at or after** `lockedUntil` (never before),
  snapping at the **next low-traffic hour computed per pod** (east/west differ in timezone); the
  tenant rejoins the **current** live release. **No notification in v1.**
- **Channel TTL ≥ `lockedUntil`.** Firebase preview channels self-expire (default 7d, max 30d). Set
  the channel TTL to outlast the freeze, or the customer 404s mid-window when the channel vanishes.
- **Security override re-snapshots.** A critical patch must re-snapshot the frozen build *plus the
  patch* onto a new channel and re-point — **not** merely drop the freeze (the customer wanted *that
  build*, patched). A frozen customer must never be un-patchable, and patching must not break the freeze.
- **Every KV write is audited.** Freeze / un-freeze / repoint each writes an audit row (actor uid,
  before/after `originHost`, `reason`, `lockedUntil`). The frozen-tenants **registry is derived from
  this audit log**, not hand-maintained — a hand-maintained registry drifts exactly like sgtest15 did.
- **Tier:** setting a *dev* freeze is frictionless; a *prod* freeze is a gated action (it's a prod KV write).

**Architectural ceiling (why the 7-day cap exists):** only the per-tenant-routable layer (the
storefront) can be frozen — Cloud Functions and the Firestore schema are **shared** across all
tenants in a pod and cannot. So a freeze is a *frontend* freeze, safe only while the backend stays
backward-compatible. The longer the pin, the more frontend/backend skew accumulates. Short pins
only.

---

## Current state vs. target (migration status)

| Item | Today | Target |
|---|---|---|
| sgtest15 routing | ✅ **DONE (2026-05-30)** — un-pinned, rides `mast-tenant-shared`; dev pod = one site | — |
| Deploy gate | fires on action-type, **target-blind (dev deploys still prompt like prod)** | target-aware: silent for dev, single-confirm for gated (Build 2 — pending) |
| Merge path | ✅ **DONE (2026-05-30)** — ruleset on `main`: require PR + `lint`, auto-merge-on-green, delete-on-merge, no direct push | — |
| Cache-bust (`MAST_MODULES_V`) | opt-in local pre-commit hook (skippable) | bumped in CI so it can't be skipped |
| Tenant freeze | none (sgtest15 pin is the accidental version) | bounded, labeled, auto-expiring (v1 build) |
| Storefront prod release | manual operator deploy | pod-sequential + verify (canary-for-free); full pipeline deferred |
| KV `podRouting` writes | raw `fetch` to Cloudflare API inside a control-plane CF; no tool, no audit, no gate | gateable + audited KV-write tool (unblocks gating + freeze) |
| Prod rollback | none / ad-hoc | redeploy prior Hosting version id (or KV repoint to preserved channel) + revert-PR rule |
| Deploy verification | CI checks origin-SHA only | origin-SHA then worker-SHA (what users actually see) |
| Cross-repo ordering | unspecified | Functions-first/storefront-second rule; storefront PR names its CF dependency |

---

## Build roadmap

Sequenced cheapest-highest-leverage first. Cross-repo work is noted. Revised 2026-05-30 after a
release-manager review (added gate-zero, split the gate build, added the KV-write tool and rollback
lever, fixed the cache-bust collision).

**0. Gate-zero — GitHub branch protection.** ✅ **DONE (2026-05-30).** Repo is **public**, so
   rulesets / required-status-checks / auto-merge are available for free — the earlier "needs Pro"
   worry was about *private* repos and does not apply here. *(GitHub / admin)*

1. **Un-pin sgtest15** — ✅ **DONE (2026-05-30).** KV `sgtest15.runmast.com` set to
   `{"podId":"dev","originHost":"mast-tenant-shared.web.app"}` (was `mast-sgtest15.web.app`).
   Verified via worker: HTTP 200, serves the shared build, no regression. Rollback: restore
   `originHost` to `mast-sgtest15.web.app`. *(KV / `podRouting`)*

2a. **Arg-aware gate engine** — move the confirm from whole-tool to **argument-level** (inspect
   `pod`/`tenantId`/action before issuing a token). Preserve the frozen-arg anti-bait-and-switch
   invariant; **default-deny unknown targets**; add tests mirroring `c2-confirmation-gate.test.ts`.
   *(mast-mcp-server)*
2b. **Gated-target classification** — classify on the **resolved target site/pod**, not just the
   `pod` arg (so `deploy(tenantId:"russelljonesjewelry")` is correctly prod). Dev silent; prod
   pods / `mast-platform-prod` functions / runmast.com / prod KV writes gated. *(mast-mcp-server)*

3. **Gateable + audited KV-write tool** — surface `podRouting` writes as a tool (today they're a raw
   Cloudflare API `fetch` in a control-plane CF, with no tool/audit/gate). Emits an audit row per
   write. This is what makes "prod KV edits" actually gateable (2b) **and** unblocks the freeze (6).
   *(mast-mcp-server + mast-architecture)*

4. **PR-to-main + auto-merge-on-green** — ✅ **DONE (2026-05-30).** Ruleset `17068215` on `main`:
   require PR + require `lint` check + block force-push/deletion, **no bypass**; `allow_auto_merge`
   + `delete_branch_on_merge` enabled. **Path-scoped required review was dropped** — single-account
   repo can't self-approve (see Dev workflow §2); the human checkpoint moved to the deploy-time gate
   (Build 2). *(GitHub Actions / repo settings)*

5. **Cache-bust + tarball-pin in CI** — bump `MAST_MODULES_V` as a **build-time, uncommitted**
   substitution **before** the verify-SHA is computed (the bump edits `app/index.html`, so a
   post-hoc bump would break SHA-verify by construction). **Retire/disable the local pre-commit
   hook** so it can't double-bump or trigger a bot-commit→redeploy loop. While here, **pin the
   tarball fetch to the merged SHA** in `mast-deploy` (the 2026-05-22 silent-success fix).
   *(CI + `scripts/bump-modules-version.sh` + mast-deploy)*

6. **Tenant freeze v1** — depends on **2** (gate) + **3** (KV tool). Freeze command (snapshot→preview
   channel with TTL ≥ `lockedUntil`; labeled KV override) + reconciler auto-lift (per-pod
   low-traffic, never before expiry) + audit-derived frozen-tenants registry + security-patch
   override that **re-snapshots** onto a patched channel. *(mast-mcp-server + mast-architecture
   reconciler + KV)*

7. **Prod rollback lever** — confirm/extend `mast_hosting` to redeploy a prior Hosting version id
   (`list_versions` exists; redeploy-by-version may need a flag); document the revert-PR-before-next-
   deploy rule. Pairs with the Rollback section above. *(mast-mcp-server)*

**Deferred** (revisit when fleet size justifies): within-pod canary cohorts; full storefront-prod
release pipeline (`mast_platform_release_*` propose→approve); lift-notification on freeze expiry.
