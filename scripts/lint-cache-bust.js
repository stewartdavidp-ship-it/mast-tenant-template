#!/usr/bin/env node
// Cache-bust guard — fails a PR whose committed per-file cache-bust hashes are
// stale relative to the module / shared-engine bytes they version.
//
// As of the per-file cache-bust change, each MODULE_MANIFEST entry carries a
// content hash (`v: '<hash>'`) and each lockstep shared <head> tag carries a
// content-hashed `?v=`, stamped by scripts/gen-cache-bust.mjs. The loader reads
// `manifest.v || MAST_MODULES_V`. Browsers cache by URL, so if a module's bytes
// change but its hash doesn't, clients with the admin tab open keep serving
// stale JS after a redeploy.
//
// The hash MUST reach users, and the deploy ships the *committed* GitHub tarball
// at the merged SHA (mast_hosting downloads /tarball/<sha>; it does NOT upload
// the CI checkout), and the verify step hashes the committed app/index.html
// against the live origin. So the hashes must be committed in the PR — enforced
// here by re-deriving them from the working tree and checking they're current.
//
// This replaces the old single-global "did MAST_MODULES_V change?" check: under
// per-file hashing, two PRs touching different modules stamp different lines, so
// they no longer re-conflict on one version var. The local pre-commit hook
// (.githooks/pre-commit) stamps automatically so you never hit this gate.
//
// Delegates to the generator's --check mode (single source of truth for the
// hashing). Exits 0 if current, 1 if any hash is stale. Wired as a step in the
// required `lint` job in .github/workflows/lint.yml.

'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');

const generator = join(__dirname, 'gen-cache-bust.mjs');

try {
  execFileSync('node', [generator, '--check'], { stdio: 'inherit' });
  process.exit(0);
} catch (err) {
  // The generator already printed the drifting lines + the fix command.
  process.exit(err.status || 1);
}
