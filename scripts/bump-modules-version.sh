#!/usr/bin/env bash
# Cache-bust stamp — DELEGATES to the per-file generator.
#
# Historically this bumped a single global `MAST_MODULES_V` string (a timestamp)
# stamped on every module + shared engine tag, so one changed module invalidated
# the cache for ALL of them and the single version line re-conflicted on every
# parallel merge.
#
# That is replaced by per-file content hashing: scripts/gen-cache-bust.mjs stamps
# each MODULE_MANIFEST entry and lockstep shared <head> tag with a hash of its own
# bytes. This wrapper is kept so existing callers (scripts/ship-check.sh, the
# pre-commit hook, and docs that say "run bump-modules-version.sh") keep working.
#
# `var MAST_MODULES_V` is intentionally NOT bumped here — it is now only a
# fallback for dangling manifest stubs. Bumping it per-PR would re-introduce the
# single-line merge conflict this change removes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$REPO_ROOT/scripts/gen-cache-bust.mjs"
