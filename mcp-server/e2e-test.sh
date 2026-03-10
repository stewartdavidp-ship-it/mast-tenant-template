#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# MAST MCP Server — E2E Smoke Tests
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   bash e2e-test.sh              # Test against TEST endpoint
#   bash e2e-test.sh --prod       # Test against PRODUCTION endpoint
#
# Requires: API key set in .mcp.json or passed via MAST_API_KEY env var
#

set -e

# ── Environment Selection ─────────────────────────────────────
ENV="test"
for arg in "$@"; do
  case $arg in
    --prod) ENV="prod" ;;
  esac
done

REGION="us-central1"
PROJECT_NUMBER="1038874042690"

if [ "$ENV" = "prod" ]; then
  SERVICE="mast-mcp-server"
else
  SERVICE="mast-mcp-server-test"
fi

BASE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
MCP_URL="${BASE_URL}/mcp"

# Get API key from env var or .mcp.json
if [ -z "$MAST_API_KEY" ]; then
  # Try to read from .mcp.json in the repo root
  MCP_JSON="../.mcp.json"
  if [ -f "$MCP_JSON" ]; then
    if [ "$ENV" = "prod" ]; then
      MAST_API_KEY=$(python3 -c "import json; d=json.load(open('$MCP_JSON')); print(d['mcpServers']['mast-mcp']['headers']['Authorization'].replace('Bearer ',''))" 2>/dev/null)
    else
      MAST_API_KEY=$(python3 -c "import json; d=json.load(open('$MCP_JSON')); print(d['mcpServers']['mast-mcp-test']['headers']['Authorization'].replace('Bearer ',''))" 2>/dev/null)
    fi
  fi
fi

if [ -z "$MAST_API_KEY" ]; then
  echo "Error: No API key found. Set MAST_API_KEY env var or configure .mcp.json"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  MAST MCP Server — E2E Tests ($ENV)"
echo "  Endpoint: $MCP_URL"
echo "═══════════════════════════════════════════════════════════"
echo ""

PASS=0
FAIL=0
TOTAL=0

# Helper: call MCP tool
call_tool() {
  local tool_name="$1"
  local args="$2"
  local description="$3"

  TOTAL=$((TOTAL + 1))
  echo -n "  [$TOTAL] $description... "

  RESPONSE=$(curl -s -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $MAST_API_KEY" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$TOTAL,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":$args}}")

  # Check for errors
  if echo "$RESPONSE" | grep -q '"isError":true'; then
    echo "FAIL"
    echo "    Response: $(echo "$RESPONSE" | head -c 200)"
    FAIL=$((FAIL + 1))
    return 1
  elif echo "$RESPONSE" | grep -q '"error"'; then
    # Check if it's a JSON-RPC error (not a tool-level error in content)
    if echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if 'error' in d and 'code' in d.get('error',{}) else 1)" 2>/dev/null; then
      echo "FAIL (RPC error)"
      echo "    Response: $(echo "$RESPONSE" | head -c 200)"
      FAIL=$((FAIL + 1))
      return 1
    fi
  fi

  echo "PASS"
  PASS=$((PASS + 1))
  return 0
}

# ── Health Check ──────────────────────────────────────────────
echo "Health Check:"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] GET / health check... "
HEALTH=$(curl -s "${BASE_URL}/" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
if [ "$HEALTH" = "ok" ]; then
  echo "PASS"
  PASS=$((PASS + 1))
else
  echo "FAIL (status: $HEALTH)"
  FAIL=$((FAIL + 1))
fi
echo ""

# ── Workflow Tools ────────────────────────────────────────────
echo "Workflow Tools:"
call_tool "mast_workflows" '{"action":"list_sections"}' "list_sections"
call_tool "mast_workflows" '{"action":"get_section","section":"Selling"}' "get_section (Selling)"
call_tool "mast_workflows" '{"action":"search","query":"order"}' "search (order)"
# Skip get_full — it's large and just validates same path
echo ""

# ── Mission Tools ─────────────────────────────────────────────
echo "Mission Tools:"
call_tool "mast_missions" '{"action":"list"}' "list missions"
call_tool "mast_missions" '{"action":"list","category":"Selling"}' "list missions (category filter)"
echo ""

# ── Product Tools ─────────────────────────────────────────────
echo "Product Tools:"
call_tool "mast_products" '{"action":"list"}' "list products"
call_tool "mast_products" '{"action":"list","limit":5}' "list products (limit 5)"
echo ""

# ── Order Tools ───────────────────────────────────────────────
echo "Order Tools:"
call_tool "mast_orders" '{"action":"list"}' "list orders"
call_tool "mast_orders" '{"action":"list","limit":5}' "list orders (limit 5)"
echo ""

# ── Auth Test (negative) ─────────────────────────────────────
echo "Auth Tests:"
TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] Reject request with no auth... "
NO_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
if [ "$NO_AUTH" = "401" ]; then
  echo "PASS (got 401)"
  PASS=$((PASS + 1))
else
  echo "FAIL (got $NO_AUTH, expected 401)"
  FAIL=$((FAIL + 1))
fi

TOTAL=$((TOTAL + 1))
echo -n "  [$TOTAL] Reject request with bad key... "
BAD_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mast_invalid_key_12345" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
if [ "$BAD_AUTH" = "401" ]; then
  echo "PASS (got 401)"
  PASS=$((PASS + 1))
else
  echo "FAIL (got $BAD_AUTH, expected 401)"
  FAIL=$((FAIL + 1))
fi
echo ""

# ── Summary ───────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed, $TOTAL total"
echo "═══════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
