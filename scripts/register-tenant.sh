#!/usr/bin/env bash
#
# register-tenant.sh — Register a new tenant on the Mast platform via MCP API.
#
# Creates the tenant record and writes hosting config using the Mast MCP server.
# Uses JSON-RPC 2.0 over Streamable HTTP (SSE responses).
#
# Usage:
#   ./scripts/register-tenant.sh \
#     --tenant-id demoshop \
#     --brand-name "Demo Shop" \
#     --domain demoshop.com \
#     --firebase-project mast-tenant-demo \
#     --github-repo "owner/repo-name" \
#     [--github-branch main] \
#     [--dry-run]
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
GITHUB_BRANCH="main"
DRY_RUN=false

# Mast MCP Server — always use TEST endpoint for scripts
MCP_ENDPOINT="https://mast-mcp-server-test-536075659586.us-central1.run.app/mcp"
MCP_API_KEY="mast_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_bd3bbac14cd9961f1f18e7b6"

# ── Parse arguments ───────────────────────────────────────────────────
TENANT_ID=""
BRAND_NAME=""
DOMAIN=""
FIREBASE_PROJECT=""
GITHUB_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)        TENANT_ID="$2";        shift 2 ;;
    --brand-name)       BRAND_NAME="$2";       shift 2 ;;
    --domain)           DOMAIN="$2";           shift 2 ;;
    --firebase-project) FIREBASE_PROJECT="$2"; shift 2 ;;
    --github-repo)      GITHUB_REPO="$2";      shift 2 ;;
    --github-branch)    GITHUB_BRANCH="$2";    shift 2 ;;
    --dry-run)          DRY_RUN=true;          shift   ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ── Validate required inputs ─────────────────────────────────────────
missing=()
[[ -z "$TENANT_ID" ]]        && missing+=("--tenant-id")
[[ -z "$BRAND_NAME" ]]       && missing+=("--brand-name")
[[ -z "$DOMAIN" ]]           && missing+=("--domain")
[[ -z "$FIREBASE_PROJECT" ]] && missing+=("--firebase-project")
[[ -z "$GITHUB_REPO" ]]      && missing+=("--github-repo")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: Missing required arguments: ${missing[*]}" >&2
  echo "" >&2
  echo "Usage: $0 --tenant-id ID --brand-name NAME --domain DOMAIN --firebase-project PROJECT --github-repo OWNER/REPO [options]" >&2
  exit 1
fi

echo "=== Register Tenant Script ==="
echo "Tenant ID:        $TENANT_ID"
echo "Brand Name:       $BRAND_NAME"
echo "Domain:           $DOMAIN"
echo "Firebase Project: $FIREBASE_PROJECT"
echo "GitHub Repo:      $GITHUB_REPO"
echo "GitHub Branch:    $GITHUB_BRANCH"
echo "MCP Endpoint:     $MCP_ENDPOINT"
echo "Dry Run:          $DRY_RUN"
echo ""

# ── Helper: call MCP tool ─────────────────────────────────────────────
call_mcp() {
  local tool_name="$1"
  local arguments="$2"
  local payload
  payload=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool_name}","arguments":${arguments}}}
EOF
)

  if [[ "$DRY_RUN" == true ]]; then
    echo "--- Would call MCP tool: ${tool_name} ---"
    echo "Endpoint: $MCP_ENDPOINT"
    echo "Payload:"
    echo "$payload" | python3 -m json.tool 2>/dev/null || echo "$payload"
    echo ""
    return 0
  fi

  echo "Calling MCP tool: ${tool_name}..."
  local response
  response=$(curl -sS -X POST "$MCP_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer ${MCP_API_KEY}" \
    -d "$payload" 2>&1)

  # Parse SSE response — extract the data lines
  local result
  result=$(echo "$response" | grep '^data: ' | sed 's/^data: //' | tail -1)

  if [[ -z "$result" ]]; then
    # Might be plain JSON response
    result="$response"
  fi

  echo "Response:"
  echo "$result" | python3 -m json.tool 2>/dev/null || echo "$result"
  echo ""
}

# ── Step 1: Create tenant via mast_tenants ────────────────────────────
echo "== Step 1: Create tenant record =="

CREATE_ARGS=$(cat <<EOF
{
  "action": "create",
  "tenantId": "${TENANT_ID}",
  "name": "${BRAND_NAME}",
  "domain": "${DOMAIN}"
}
EOF
)

call_mcp "mast_tenants" "$CREATE_ARGS"

# ── Step 2: Update tenant with hosting config via mast_config ─────────
echo "== Step 2: Write hosting config =="

# The hosting config tells mast_hosting where to find the repo and what to deploy
HOSTING_CONFIG_ARGS=$(cat <<EOF
{
  "action": "set",
  "tenantId": "${TENANT_ID}",
  "path": "hosting",
  "value": {
    "siteId": "${FIREBASE_PROJECT}",
    "repo": "${GITHUB_REPO}",
    "branch": "${GITHUB_BRANCH}",
    "excludePatterns": [
      "node_modules/**",
      ".git/**",
      "scripts/**",
      "docs/**",
      "*.md",
      "seed-data.json",
      ".firebaserc",
      "firebase.json",
      "database.rules.json",
      ".mcp.json"
    ]
  }
}
EOF
)

call_mcp "mast_config" "$HOSTING_CONFIG_ARGS"

# ── Step 3: Write site config to platform registry ────────────────────
echo "== Step 3: Write platform site config =="

SITE_CONFIG_ARGS=$(cat <<EOF
{
  "action": "set",
  "tenantId": "${TENANT_ID}",
  "path": "config/site",
  "value": {
    "github": {
      "repo": "${GITHUB_REPO}",
      "pagesBase": ""
    },
    "cloudFunctionsBase": "https://us-central1-${FIREBASE_PROJECT}.cloudfunctions.net"
  }
}
EOF
)

call_mcp "mast_config" "$SITE_CONFIG_ARGS"

# ── Step 4: Write brand config to platform registry ───────────────────
echo "== Step 4: Write platform brand config =="

BRAND_CONFIG_ARGS=$(cat <<EOF
{
  "action": "set",
  "tenantId": "${TENANT_ID}",
  "path": "config/brand",
  "value": {
    "name": "${BRAND_NAME}"
  }
}
EOF
)

call_mcp "mast_config" "$BRAND_CONFIG_ARGS"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
if [[ "$DRY_RUN" == true ]]; then
  echo "DRY RUN complete. No MCP calls were made."
  echo "Remove --dry-run to execute the registration."
else
  echo "Tenant '${TENANT_ID}' registered on Mast platform."
  echo ""
  echo "Next steps:"
  echo "  1. Import seed data to tenant RTDB"
  echo "  2. Deploy Cloud Functions to ${FIREBASE_PROJECT}"
  echo "  3. Deploy security rules to ${FIREBASE_PROJECT}"
  echo "  4. Deploy site: mast_hosting(action: 'deploy', tenantId: '${TENANT_ID}')"
fi
