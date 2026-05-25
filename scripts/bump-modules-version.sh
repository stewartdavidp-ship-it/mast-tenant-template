#!/usr/bin/env bash
# Bump the admin app's MAST_MODULES_V cache-bust string.
#
# Format: YYYYMMDD-HHMMSS-<short-sha>
#   - YYYYMMDD-HHMMSS: timestamp (guarantees uniqueness per second)
#   - <short-sha>: current git HEAD short SHA (parent of the commit being made
#     when invoked from pre-commit; helpful for debugging which commit shipped
#     which bust string)
#
# Always bumps (not idempotent). The timestamp portion ensures uniqueness
# across runs even when HEAD SHA hasn't changed (the case during a single
# commit's pre-commit hook). Use sparingly outside the hook — every standalone
# invocation produces a new value.
#
# Why: app/modules/*.js are lazy-loaded by app/index.html with a `?v=<MAST_MODULES_V>`
# query suffix. Browsers cache by URL, so the suffix MUST change whenever any
# module changes — otherwise clients with the admin tab already open will serve
# stale JS even after a no-cache-headered redeploy.
#
# See OPEN -OtS06k59X1EXiTqfa2d (Close v3 build, 2026-05-24).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX_HTML="$REPO_ROOT/app/index.html"

if [[ ! -f "$INDEX_HTML" ]]; then
  echo "error: $INDEX_HTML not found" >&2
  exit 1
fi

# Get current value (for logging only)
CURRENT_LINE=$(grep "^var MAST_MODULES_V" "$INDEX_HTML" || true)
if [[ -z "$CURRENT_LINE" ]]; then
  echo "error: could not find 'var MAST_MODULES_V' declaration in $INDEX_HTML" >&2
  exit 1
fi
CURRENT_VALUE=$(echo "$CURRENT_LINE" | sed -E "s/^var MAST_MODULES_V = '([^']+)';.*/\1/")

# Compute new value (always unique per second + commit)
SHORT_SHA=$(cd "$REPO_ROOT" && git rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NEW_VALUE="${TIMESTAMP}-${SHORT_SHA}"

# Replace in place (use temp file for cross-platform sed compatibility)
TMP_FILE="$(mktemp)"
awk -v new="$NEW_VALUE" '
  /^var MAST_MODULES_V = / {
    print "var MAST_MODULES_V = '\''" new "'\'';"
    next
  }
  { print }
' "$INDEX_HTML" > "$TMP_FILE"
mv "$TMP_FILE" "$INDEX_HTML"

echo "MAST_MODULES_V: $CURRENT_VALUE → $NEW_VALUE"
