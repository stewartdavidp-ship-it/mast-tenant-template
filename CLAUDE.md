# CLAUDE.md — mast-tenant-template (public storefront)

This is the **public** tenant storefront template. The full internal architecture,
release model, finance schema, and control-plane design have been relocated to a
**private** repo (they revealed internal design beyond what the running app shows).
This file keeps only what's needed to work in *this* repo.

## Git & deploys
1. **Work in your own git worktree + feature branch** — never the shared checkout
   (`git worktree add /tmp/<task> -b feat/<task>`). Two sessions in one working tree
   clobber each other's uncommitted edits.
2. **Never `git push origin main`** — it's ruleset-protected. Open a PR; it
   **auto-merges on green** (the `lint` check). CI auto-deploys the dev site from
   `origin/main` on merge — don't hand-deploy dev from a local HEAD.
3. **Dev is frictionless, prod is gated.** The dev pod (shared site
   `mast-tenant-shared`) is pre-authorized — iterate freely, fix forward. Ceremony
   (a single deliberate `yes` + pod-sequential rollout) is for prod only:
   `prod-us-east-1`/`prod-us-west-1`, the `mast-platform-prod` *functions* surface,
   `runmast.com`, and prod `podRouting` KV edits. ⚠️ The dev pod's GCP project is
   *named* `mast-platform-prod` — the name lies; `pod: dev` is not production.

## Cache-bust (enforced by the required `lint` check)
4. Any PR that changes `app/index.html` or `app/modules/*.js` **must commit a bump of
   `MAST_MODULES_V`** — a deploy ships the committed tarball at the merged SHA, so the
   fresh suffix only reaches users if it's on `main`. `scripts/lint-cache-bust.js`
   fails the PR otherwise. Run `./scripts/install-hooks.sh` once for the auto-bumper.

## Verify
5. Verify through **`<tenant>.runmast.com`** (the Cloudflare worker — covers edge +
   browser cache), not the `.web.app` origin. Hard-reload to clear cached module JS.

---
*Internal architecture / release model / finance design: private repo. Operating
rules are also injected at session start by the `SessionStart` hook.*
