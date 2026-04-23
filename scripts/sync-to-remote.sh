#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# sync-to-remote — push main to origin, fall back to PR if blocked
# ═══════════════════════════════════════════════════════════════
#
# This repo has branch-protection rules that reject direct `git push origin
# main`. Template deploys are MCP-driven (mast_hosting), not local-script, so
# commits accumulate unpushed. Run this script after committing to sync those
# commits to remote:
#
#   - If origin/main accepts the push, great.
#   - If protection blocks it, a timestamped auto-sync/... feature branch is
#     created and pushed + a PR is opened for user review.
#
# Usage:
#   bash scripts/sync-to-remote.sh
#
# Safe to re-run: skips if HEAD is already in sync with origin/main.
# Working tree can be dirty — only committed history is pushed.
#
# See ~/.claude/projects/-Users-davidstewart-Downloads/memory/feedback_git_push_policy.md

set -e

cd "$(git rev-parse --show-toplevel)"

echo "Syncing commits to remote..."
git fetch origin main 2>/dev/null || true

if [ -z "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then
  echo "  already in sync with origin/main"
  exit 0
fi

if git push origin main 2>/dev/null; then
  echo "  main pushed to origin"
  exit 0
fi

BRANCH="auto-sync/$(date -u +%Y%m%dT%H%M%SZ)-$(whoami)"
echo "  direct main push blocked — creating feature branch: $BRANCH"
git checkout -b "$BRANCH"

if ! git push origin "$BRANCH"; then
  echo "  WARNING: could not push feature branch '$BRANCH' — please push manually"
  git checkout main
  exit 1
fi

PR_TITLE="auto-sync: $(git log -1 --format='%s' HEAD)"
PR_BODY="Auto-created because direct main push was blocked by branch protection. Local commits on main are already deployed (via MCP mast_hosting, from local HEAD at $(git rev-parse --short HEAD)). Review + merge to bring main in sync with deployed code."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if gh pr create --base main --head "$BRANCH" --title "$PR_TITLE" --body "$PR_BODY"; then
    echo "  feature branch '$BRANCH' pushed + PR opened"
  else
    echo "  feature branch '$BRANCH' pushed — 'gh pr create' failed, open PR manually"
  fi
else
  REPO_URL=$(git config --get remote.origin.url | sed 's|\.git$||; s|^git@github.com:|https://github.com/|')
  echo "  feature branch '$BRANCH' pushed — 'gh' CLI unavailable"
  echo "  open PR manually: ${REPO_URL}/pull/new/${BRANCH}"
fi

git checkout main
