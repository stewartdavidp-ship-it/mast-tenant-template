#!/usr/bin/env bash
# OPTIONAL dev convenience: wire git to use .githooks/ for hooks.
#
# Installing this is no longer required. The authoritative cache-bust
# enforcement is the required `lint` CI check (scripts/lint-cache-bust.js,
# Build 5): a PR that changes admin JS/HTML without bumping MAST_MODULES_V
# cannot merge. This hook just bumps automatically on commit so you never hit
# that gate locally.
#
# Why .githooks/: .git/hooks/ is not version-controlled. .githooks/ is. Pointing
# core.hooksPath at .githooks/ lets the team share the hook via the repo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* scripts/bump-modules-version.sh scripts/install-hooks.sh

echo "✓ Optional auto-bump hook installed (core.hooksPath = .githooks)"
echo "  Note: the required 'lint' CI check is the real cache-bust gate; this hook"
echo "        is just a convenience so you never hit it."
echo "  Active hooks:"
ls -1 .githooks/ | sed 's/^/    /'
