#!/usr/bin/env bash
# One-time setup: wire git to use .githooks/ for hooks.
# Run this once per clone of the repo.
#
# Why: .git/hooks/ is not version-controlled. .githooks/ is. Pointing
# core.hooksPath at .githooks/ lets the team share hooks via the repo.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* scripts/bump-modules-version.sh scripts/install-hooks.sh

echo "✓ Hooks installed (core.hooksPath = .githooks)"
echo "  Active hooks:"
ls -1 .githooks/ | sed 's/^/    /'
