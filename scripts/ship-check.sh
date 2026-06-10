#!/usr/bin/env bash
# ship-check.sh — the whole pre-PR gauntlet, in the order that doesn't bite.
#
# Why this exists (v2-conversion-playbook.md §8): two recurring CI failures in
# the Sales conversion were pure ordering/visibility mistakes — the admin
# inventory regenerated BEFORE the version bump changed index.html, and lint
# output piped through `tail` hiding violations. This runs:
#   1. bump MAST_MODULES_V (content edits must be done by now)
#   2. regenerate docs/generated/admin-inventory.md (counts post-bump lines)
#   3. every lint, FULL output
#   4. every unit test
# and exits non-zero if anything fails. Commit immediately after a green run —
# the pre-commit hook's re-bump only rewrites the version line (same line
# count), so the inventory stays valid.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "── bump + inventory ──────────────────────────────"
bash scripts/bump-modules-version.sh || exit 1
node scripts/gen-inventory.mjs || exit 1

LINTS=(
  lint-cache-bust lint-ux-standards lint-design-tokens lint-module-info
  lint-mastdb lint-rbac lint-customer-writes lint-no-debug-pii-console
  lint-no-hardcoded-ids lint-unbounded-read lint-syntax lint-readiness-parity
  lint-v2-standard
)
fail=0
echo "── lints ─────────────────────────────────────────"
for s in "${LINTS[@]}"; do
  if [ ! -f "scripts/$s.js" ]; then echo "∅ $s (missing — skipped)"; continue; fi
  if node "scripts/$s.js"; then
    echo "✓ $s"
  else
    echo "✗ $s FAILED"
    fail=1
  fi
done

echo "── unit tests ────────────────────────────────────"
for tf in test/*.test.js; do
  if out=$(node "$tf" 2>&1); then
    echo "✓ $tf"
  else
    echo "✗ $tf FAILED"
    echo "$out"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "── ALL GREEN — commit now (pre-commit re-bump is safe) ──"
else
  echo "── FAILURES above — fix before committing ──"
fi
exit "$fail"
