# SESSION RULES — read before writing any code in this repo

You are working in **mast-tenant-template**. These are non-negotiable. Where anything
conflicts, **the internal release model (private repo) wins** (it supersedes older memory notes).

## Git & deploys
1. **Work in your OWN git worktree + feature branch** — never the shared checkout.
   Two sessions in one working tree clobber each other's *uncommitted* edits.
   (`git worktree add /tmp/<task> -b feat/<task>`, or a spawn_task chip.)
2. **Never `git push origin main`** — it's blocked by a ruleset. Open a PR; it
   **auto-merges on green** (~12s lint). Don't hand-deploy dev from local HEAD.
3. CI **auto-deploys the dev site from `origin/main` on merge.** Merge → verify → fix forward.

## Dev vs prod — protection scales with blast radius
4. **DEV IS FRICTIONLESS.** Deploying/iterating on the **dev pod** (shared site
   `mast-tenant-shared`, sgtest15, all test tenants) is pre-authorized.
   Do **NOT** ask permission, do **NOT** gate on migration scripts, do **NOT** run
   "E2E-before-deploy" for dev. It's disposable — iterate freely, fix forward.
5. The `dev` pod's GCP project is **named `mast-platform-prod`. The name lies** —
   `pod: dev` is NOT production. Don't freeze over it.
6. **Ceremony is for PROD only:** `prod-us-east-1` / `prod-us-west-1`, the
   `mast-platform-prod` *functions* surface, `runmast.com`, and **prod `podRouting` KV edits**.

## Verify
7. **Verify through `<tenant>.runmast.com`** (the worker — covers Cloudflare edge +
   browser cache), **not** the `.web.app` origin. Hard-reload to clear cached module JS.

## One-time setup per clone
8. Run `./scripts/install-hooks.sh` (cache-bust auto-bump). Confirm
   `git config user.email` is your GitHub noreply, not a local hostname.

---
*Injected at session start by the `SessionStart` hook in `.claude/settings.json`.
Full model + rationale: the internal release model (private repo).*
