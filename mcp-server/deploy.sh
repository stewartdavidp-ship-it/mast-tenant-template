#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# MAST MCP Server — Deploy
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   bash deploy.sh              # Build + deploy to TEST (default)
#   bash deploy.sh --prod       # Build + deploy to PRODUCTION (confirmation required)
#   bash deploy.sh --build-only # Just build TypeScript, don't deploy
#
# ── ENVIRONMENTS ────────────────────────────────────────────────
#
# TEST  (mast-mcp-server-test) — Validate MCP server code changes.
#       Max 1 instance. Only used during MCP dev.
#
# PROD  (mast-mcp-server) — Claude.ai Chat + Claude Code.
#       Max 2 instances.
#
# Both environments share the same Firebase RTDB (shir-glassworks).
#
# ── PROMOTION WORKFLOW ──────────────────────────────────────────
#
#   1. bash deploy.sh              # deploy to test
#   2. bash e2e-test.sh            # run tests against test
#   3. bash deploy.sh --prod       # promote to prod
#   4. bash e2e-test.sh --prod     # optional: verify prod
#

set -e

# ── Environment Selection ─────────────────────────────────────
ENV="test"
BUILD_ONLY=false
for arg in "$@"; do
  case $arg in
    --prod) ENV="prod" ;;
    --build-only) BUILD_ONLY=true ;;
  esac
done

REGION="us-central1"
GCP_PROJECT="shir-glassworks"
PROJECT_NUMBER="1038874042690"

if [ "$ENV" = "prod" ]; then
  SERVICE="mast-mcp-server"
  MAX_INSTANCES=2
else
  SERVICE="mast-mcp-server-test"
  MAX_INSTANCES=1
fi

BASE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

# Build TypeScript first
echo "Building TypeScript..."
npm run build
echo "Build complete."

if [ "$BUILD_ONLY" = true ]; then
  echo "Build-only mode — skipping deploy."
  exit 0
fi

# Production confirmation gate
if [ "$ENV" = "prod" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  DEPLOYING TO PRODUCTION                             ║"
  echo "║  Service: mast-mcp-server                                ║"
  echo "║  Project: shir-glassworks                                ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  read -p "Type 'yes' to confirm production deploy: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
echo "Deploying to Cloud Run..."
echo "  Environment: $ENV"
echo "  Service:     $SERVICE"
echo "  Project:     $GCP_PROJECT"
echo "  Region:      $REGION"
echo "  BASE_URL:    $BASE_URL"
echo "  Max instances: $MAX_INSTANCES"
echo ""

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,BASE_URL=${BASE_URL}" \
  --memory=256Mi \
  --timeout=60 \
  --min-instances=0 \
  --max-instances=$MAX_INSTANCES

echo ""
echo "Deploy complete ($ENV)."
echo ""

# Verify health check
echo "Verifying health check..."
HEALTH=$(curl -s "${BASE_URL}/" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)

if [ "$HEALTH" = "ok" ]; then
  echo "  ✅ Health check passed"
else
  echo "  ❌ Health check failed (got: $HEALTH)"
  echo "     Check Cloud Run logs for errors."
  exit 1
fi

echo ""
if [ "$ENV" = "prod" ]; then
  echo "Production deploy ready."
else
  echo "Test deploy ready. Validate with: bash e2e-test.sh"
  echo "When satisfied, promote with: bash deploy.sh --prod"
fi
