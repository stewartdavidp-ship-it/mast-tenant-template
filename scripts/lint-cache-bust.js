#!/usr/bin/env node
// Cache-bust guard — fails a PR that changes admin JS/HTML without bumping
// MAST_MODULES_V, the cache-bust suffix on the admin app's lazy-loaded modules.
//
// Why this is a *merge gate* and not a deploy-time substitution
// -------------------------------------------------------------
// The admin shell loads app/modules/*.js with a `?v=<MAST_MODULES_V>` suffix
// (declared in app/index.html). Browsers cache by URL, so if a module's bytes
// change but the suffix doesn't, customers with the admin tab already open keep
// serving stale JS after a redeploy.
//
// The suffix MUST reach users, and the deploy ships the *committed* GitHub
// tarball at the merged SHA (mast_hosting downloads /tarball/<sha>; it does NOT
// upload the CI checkout). So a build-time, uncommitted bump in deploy.yml could
// never reach users, AND would make the verify step (which hashes the committed
// app/index.html against the live origin) mismatch by construction. Branch
// protection on `main` also forbids a CI bot-commit (no bypass actors). The only
// design that reaches users, passes verify, and respects "origin/main is what's
// live" is to require the bump to be *committed in the PR* — enforced here.
//
// Replaces the opt-in local pre-commit hook (.githooks/pre-commit) as the
// authoritative enforcement. That hook still works as an optional dev
// convenience (it auto-bumps so you never hit this gate), but installing it is
// no longer required — this check is.
//
// To satisfy the gate: run `scripts/bump-modules-version.sh` and commit the
// resulting app/index.html change in the same PR.
//
// Exits 0 if clean (or N/A), 1 if a bump is required but missing.
// Wired as a step in the required `lint` job in .github/workflows/lint.yml.
//
// Release-model Build 5 (docs/release-model.md). See also CLAUDE.md bootstrap
// step 5 and feedback_mast_cache_bust_process_gap.

'use strict';

const { execSync } = require('child_process');

const ADMIN_INDEX = 'app/index.html';
const MODULE_RE = /^app\/modules\/.*\.js$/;
const VERSION_RE = /^var MAST_MODULES_V = '([^']*)';/m;

function sh(cmd) {
  // app/index.html is ~1MB+, so `git show` of it blows past execSync's default
  // 1MB maxBuffer (ENOBUFS). Give it generous headroom.
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

function extractVersion(ref) {
  // ref is e.g. `origin/main:app/index.html` or `HEAD:app/index.html`.
  let content;
  try {
    content = sh(`git show ${ref}`);
  } catch {
    // File didn't exist at that ref (e.g. brand-new repo state). Treat as absent.
    return null;
  }
  const m = content.match(VERSION_RE);
  return m ? m[1] : null;
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF; // set only on pull_request events

  // This gate only makes sense on a PR (we need a base to diff against). On
  // push-to-main, workflow_dispatch, or a local non-PR run, there is nothing to
  // compare to — pass and let the bump-on-merge already in the tree stand.
  if (eventName !== 'pull_request' || !baseRef) {
    console.log(
      `cache-bust guard: not a PR (event=${eventName || 'none'}); nothing to check.`,
    );
    return 0;
  }

  const base = `origin/${baseRef}`;

  // Ensure the `origin/<base>` tracking ref resolves. actions/checkout@v4 on a
  // pull_request checks out the merge commit but does not reliably populate
  // origin/<base>, so fetch it explicitly into the tracking ref (the explicit
  // refspec is what guarantees `origin/<base>` exists, regardless of the
  // checkout's configured refspec).
  try {
    sh(`git fetch --no-tags --quiet origin +${baseRef}:refs/remotes/origin/${baseRef}`);
  } catch {
    /* best-effort; the diff below surfaces a real problem if base is missing */
  }

  let changed;
  try {
    changed = sh(`git diff --name-only ${base}...HEAD`)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    console.error(
      `cache-bust guard: could not diff against ${base} ` +
        `(${err.message.split('\n')[0]}). Ensure the lint checkout uses fetch-depth: 0.`,
    );
    return 1;
  }

  const adminTouched = changed.some(
    (f) => f === ADMIN_INDEX || MODULE_RE.test(f),
  );
  if (!adminTouched) {
    console.log(
      'cache-bust guard: no admin app/index.html or app/modules/*.js changes; ok.',
    );
    return 0;
  }

  const baseVersion = extractVersion(`${base}:${ADMIN_INDEX}`);
  const headVersion = extractVersion(`HEAD:${ADMIN_INDEX}`);

  if (headVersion === null) {
    console.error(
      `cache-bust guard: could not find 'var MAST_MODULES_V' in ${ADMIN_INDEX} at HEAD.`,
    );
    return 1;
  }

  if (baseVersion !== null && headVersion === baseVersion) {
    console.error('✗ cache-bust guard: MAST_MODULES_V was not bumped.');
    console.error('');
    console.error(
      `  This PR changes admin JS/HTML (${changed
        .filter((f) => f === ADMIN_INDEX || MODULE_RE.test(f))
        .join(', ')})`,
    );
    console.error(
      `  but MAST_MODULES_V is still '${headVersion}' (unchanged from ${baseRef}).`,
    );
    console.error('');
    console.error(
      '  Lazy-loaded modules are cached by URL via the ?v=<MAST_MODULES_V> suffix,',
    );
    console.error(
      '  so customers with the admin tab open would keep serving stale module JS.',
    );
    console.error('');
    console.error('  Fix: run the bumper and commit the change in this PR:');
    console.error('      ./scripts/bump-modules-version.sh');
    console.error('      git add app/index.html && git commit --amend --no-edit  # or a new commit');
    console.error('');
    console.error(
      '  (Or install the optional auto-bump hook once: ./scripts/install-hooks.sh)',
    );
    return 1;
  }

  console.log(
    `✓ cache-bust guard: MAST_MODULES_V bumped (${baseVersion ?? '<absent>'} → ${headVersion}).`,
  );
  return 0;
}

process.exit(main());
