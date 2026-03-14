#!/usr/bin/env bash
#
# clone-tenant.sh — Transform the template tenant repo for a new tenant.
#
# Usage:
#   ./scripts/clone-tenant.sh \
#     --tenant-id demoshop \
#     --firebase-project mast-tenant-demo \
#     --domain demoshop.com \
#     --brand-name "Demo Shop" \
#     --owner-email owner@demoshop.com \
#     [--storage-bucket mast-tenant-demo.firebasestorage.app] \
#     [--region us-central1] \
#     [--tagline "Your tagline here"] \
#     [--location "City, State"] \
#     [--instagram "https://www.instagram.com/demoshop/"] \
#     [--etsy ""] \
#     [--dry-run]
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
STORAGE_BUCKET=""
REGION="us-central1"
TAGLINE=""
LOCATION=""
INSTAGRAM=""
ETSY=""
DRY_RUN=false

# ── Parse arguments ───────────────────────────────────────────────────
TENANT_ID=""
FIREBASE_PROJECT=""
DOMAIN=""
BRAND_NAME=""
OWNER_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)        TENANT_ID="$2";        shift 2 ;;
    --firebase-project) FIREBASE_PROJECT="$2"; shift 2 ;;
    --domain)           DOMAIN="$2";           shift 2 ;;
    --brand-name)       BRAND_NAME="$2";       shift 2 ;;
    --owner-email)      OWNER_EMAIL="$2";      shift 2 ;;
    --storage-bucket)   STORAGE_BUCKET="$2";   shift 2 ;;
    --region)           REGION="$2";           shift 2 ;;
    --tagline)          TAGLINE="$2";          shift 2 ;;
    --location)         LOCATION="$2";         shift 2 ;;
    --instagram)        INSTAGRAM="$2";        shift 2 ;;
    --etsy)             ETSY="$2";             shift 2 ;;
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
[[ -z "$FIREBASE_PROJECT" ]] && missing+=("--firebase-project")
[[ -z "$DOMAIN" ]]           && missing+=("--domain")
[[ -z "$BRAND_NAME" ]]       && missing+=("--brand-name")
[[ -z "$OWNER_EMAIL" ]]      && missing+=("--owner-email")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: Missing required arguments: ${missing[*]}" >&2
  echo "" >&2
  echo "Usage: $0 --tenant-id ID --firebase-project PROJECT --domain DOMAIN --brand-name NAME --owner-email EMAIL [options]" >&2
  exit 1
fi

# ── Derived values ────────────────────────────────────────────────────
[[ -z "$STORAGE_BUCKET" ]] && STORAGE_BUCKET="${FIREBASE_PROJECT}.firebasestorage.app"
[[ -z "$TAGLINE" ]]        && TAGLINE="Welcome to ${BRAND_NAME}"
[[ -z "$LOCATION" ]]       && LOCATION="[Location TBD]"

AUTH_DOMAIN="${FIREBASE_PROJECT}.firebaseapp.com"
DATABASE_URL="https://${FIREBASE_PROJECT}-default-rtdb.firebaseio.com"
CLOUD_FUNCTIONS_BASE="https://${REGION}-${FIREBASE_PROJECT}.cloudfunctions.net"

# ── Find repo root ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Clone Tenant Script ==="
echo "Tenant ID:        $TENANT_ID"
echo "Firebase Project: $FIREBASE_PROJECT"
echo "Domain:           $DOMAIN"
echo "Brand Name:       $BRAND_NAME"
echo "Owner Email:      $OWNER_EMAIL"
echo "Storage Bucket:   $STORAGE_BUCKET"
echo "Region:           $REGION"
echo "Database URL:     $DATABASE_URL"
echo "Functions Base:   $CLOUD_FUNCTIONS_BASE"
echo "Dry Run:          $DRY_RUN"
echo ""

# ── Helper: apply or diff ─────────────────────────────────────────────
changes_made=0

apply_file() {
  local file="$1"
  local new_content="$2"

  if [[ "$DRY_RUN" == true ]]; then
    # Show diff
    local tmp
    tmp=$(mktemp)
    echo "$new_content" > "$tmp"
    echo "--- Changes to: ${file#$REPO_ROOT/} ---"
    diff -u "$file" "$tmp" || true
    echo ""
    rm -f "$tmp"
  else
    echo "$new_content" > "$file"
    echo "  Updated: ${file#$REPO_ROOT/}"
  fi
  changes_made=$((changes_made + 1))
}

# ── 1. Update storefront-tenant.js ────────────────────────────────────
echo "== Updating storefront-tenant.js =="

TENANT_JS="$REPO_ROOT/storefront-tenant.js"

# Build the new file content using a temp file to avoid heredoc quoting issues
TENANT_JS_TMP=$(mktemp)
cat > "$TENANT_JS_TMP" <<TEMPLATE_EOF
/**
 * Storefront Tenant Resolution + Firebase Config
 *
 * Resolves the current tenant from the domain. All storefront files
 * include this script before other JS to make TENANT_ID and
 * TENANT_FIREBASE_CONFIG available.
 *
 * Cloud Functions receive tenantId via data.tenantId (onCall) or
 * X-Tenant-ID header (onRequest). Without it they fall back to
 * DEFAULT_TENANT.
 *
 * DEPLOY: Each tenant repo has its own copy of this file with the
 * correct domain→tenantId mapping and Firebase config. Update both
 * when cloning for a new tenant.
 */
var TENANT_ID = (function() {
  // 1. URL param override (local dev only): ?tenant=other_tenant
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    var p = new URLSearchParams(window.location.search).get('tenant');
    if (p) return p;
  }

  // 2. Domain → tenant mapping
  //    DEPLOY: Update this map for each tenant deployment.
  var map = {
    '${DOMAIN}':                '${TENANT_ID}',
    'www.${DOMAIN}':            '${TENANT_ID}',
    '${FIREBASE_PROJECT}.web.app':           '${TENANT_ID}',
    'localhost':                         '${TENANT_ID}'  // local dev
  };

  return map[window.location.hostname] || 'unknown';
})();

/**
 * DEPLOY: Update these values for each tenant Firebase project.
 */
var TENANT_FIREBASE_CONFIG = {
  apiKey: '[REPLACE_WITH_API_KEY]',
  authDomain: '${AUTH_DOMAIN}',
  databaseURL: '${DATABASE_URL}',
  projectId: '${FIREBASE_PROJECT}',
  storageBucket: '${STORAGE_BUCKET}',
  cloudFunctionsBase: '${CLOUD_FUNCTIONS_BASE}'
};

/**
 * DEPLOY: Update brand strings for each tenant.
 * JS files reference these instead of hardcoding the brand name.
 * HTML files use <!-- TENANT: brand --> markers for clone-time sed replacement.
 */
var TENANT_BRAND = {
  name: '${BRAND_NAME}',
  tagline: '${TAGLINE}',
  location: '${LOCATION}',
  instagram: '${INSTAGRAM}',
  etsy: '${ETSY}',
  domain: '${DOMAIN}'
};
TEMPLATE_EOF

NEW_TENANT_JS=$(cat "$TENANT_JS_TMP")
rm -f "$TENANT_JS_TMP"

apply_file "$TENANT_JS" "$NEW_TENANT_JS"

# ── 2. Replace brand markers in HTML files ────────────────────────────
echo "== Replacing brand markers in HTML files =="

HTML_FILES=(
  index.html
  shop.html
  product.html
  about.html
  schedule.html
  orders.html
  commission.html
  wholesale.html
  blog/index.html
  blog/post.html
  pos/index.html
  studio/index.html
  newsletter/unsubscribe.html
)

for html_file in "${HTML_FILES[@]}"; do
  full_path="$REPO_ROOT/$html_file"
  if [[ ! -f "$full_path" ]]; then
    echo "  SKIP (not found): $html_file"
    continue
  fi

  new_content=$(cat "$full_path")

  # Replace title-style brand markers: "Something — Shir Glassworks" or "Shir Glassworks — Something"
  # These lines end with <!-- TENANT: brand -->
  # Strategy: replace "Shir Glassworks" with the new brand name on lines with the marker
  new_content=$(echo "$new_content" | sed "s|Shir Glassworks\(.*<!-- TENANT: brand -->\)|${BRAND_NAME}\1|g")

  # Replace copyright/footer brand markers
  # e.g., "© 2026 Shir Glassworks" → "© 2026 Demo Shop"
  new_content=$(echo "$new_content" | sed "s|Shir Glassworks\(.*<!-- TENANT: brand -->\)|${BRAND_NAME}\1|g")

  # Replace location in footer brand markers
  # e.g., "Shir Glassworks • Western Massachusetts" → "Demo Shop • [Location]"
  new_content=$(echo "$new_content" | sed "s|Western Massachusetts\(.*<!-- TENANT: brand -->\)|${LOCATION}\1|g")

  # Replace social links on lines with <!-- TENANT: social --> marker
  if [[ -n "$INSTAGRAM" ]]; then
    new_content=$(echo "$new_content" | sed "s|https://www.instagram.com/shirglassworks/\(.*<!-- TENANT: social -->\)|${INSTAGRAM}\1|g")
  fi

  # Replace wholesale-specific content
  new_content=$(echo "$new_content" | sed "s|Handmade in Greenfield, MA\(.*<!-- TENANT: brand -->\)|${LOCATION}\1|g")

  apply_file "$full_path" "$new_content"
done

# ── 3. Update .firebaserc ─────────────────────────────────────────────
FIREBASERC="$REPO_ROOT/.firebaserc"
if [[ -f "$FIREBASERC" ]]; then
  echo "== Updating .firebaserc =="
  NEW_FIREBASERC=$(cat <<EOF
{
  "projects": {
    "default": "${FIREBASE_PROJECT}"
  }
}
EOF
)
  apply_file "$FIREBASERC" "$NEW_FIREBASERC"
else
  echo "== Creating .firebaserc =="
  NEW_FIREBASERC=$(cat <<EOF
{
  "projects": {
    "default": "${FIREBASE_PROJECT}"
  }
}
EOF
)
  if [[ "$DRY_RUN" == true ]]; then
    echo "--- Would create: .firebaserc ---"
    echo "$NEW_FIREBASERC"
    echo ""
  else
    echo "$NEW_FIREBASERC" > "$FIREBASERC"
    echo "  Created: .firebaserc"
  fi
  changes_made=$((changes_made + 1))
fi

# ── 4. Generate seed-data.json ────────────────────────────────────────
echo "== Generating seed-data.json =="

# Derive email values from owner email
FROM_EMAIL="$OWNER_EMAIL"
FROM_NAME="$BRAND_NAME"

# Build order prefix from tenant ID (uppercase, max 4 chars)
ORDER_PREFIX=$(echo "$TENANT_ID" | tr '[:lower:]' '[:upper:]' | cut -c1-4)

SEED_DATA=$(cat <<EOF
{
  "${TENANT_ID}": {
    "config": {
      "email": {
        "fromEmail": "${FROM_EMAIL}",
        "fromName": "${FROM_NAME}",
        "ownerEmail": "${OWNER_EMAIL}",
        "noReplyEmail": "noreply@${DOMAIN}"
      },
      "site": {
        "siteUrl": "https://${DOMAIN}",
        "shopUrl": "https://${DOMAIN}/shop.html",
        "adminUrl": "https://${DOMAIN}/app"
      },
      "brand": {
        "name": "${BRAND_NAME}",
        "tagline": "${TAGLINE}",
        "location": "${LOCATION}",
        "orderPrefix": "${ORDER_PREFIX}",
        "description": "",
        "ownerNames": "",
        "brandVoice": ""
      }
    },
    "admin": {
      "roles": {
        "admin": {
          "name": "Admin",
          "permissions": {
            "gallery": { "read": true, "write": true, "delete": true },
            "products": { "read": true, "write": true, "delete": true },
            "orders": { "read": true, "write": true, "delete": true },
            "inventory": { "read": true, "write": true, "delete": true },
            "settings": { "read": true, "write": true },
            "users": { "read": true, "write": true, "delete": true },
            "analytics": { "read": true },
            "commissions": { "read": true, "write": true, "delete": true },
            "production": { "read": true, "write": true, "delete": true },
            "market": { "read": true, "write": true, "delete": true },
            "wholesale": { "read": true, "write": true, "delete": true },
            "pos": { "read": true, "write": true }
          }
        },
        "user": {
          "name": "User",
          "permissions": {
            "gallery": { "read": true },
            "products": { "read": true, "write": true },
            "orders": { "read": true, "write": true },
            "inventory": { "read": true, "write": true },
            "commissions": { "read": true, "write": true },
            "production": { "read": true, "write": true },
            "market": { "read": true, "write": true },
            "pos": { "read": true, "write": true }
          }
        },
        "guest": {
          "name": "Guest",
          "permissions": {
            "gallery": { "read": true },
            "products": { "read": true },
            "orders": { "read": true }
          }
        }
      },
      "orderCounter": 0
    },
    "feedbackSettings": {
      "publicEnabled": true,
      "requireEmail": false
    }
  },
  "mast-platform": {
    "tenants": {
      "${TENANT_ID}": {
        "config": {
          "site": {
            "github": {
              "repo": "[GITHUB_OWNER/REPO_NAME]",
              "pagesBase": ""
            },
            "cloudFunctionsBase": "${CLOUD_FUNCTIONS_BASE}"
          },
          "brand": {
            "name": "${BRAND_NAME}"
          },
          "email": {
            "fromEmail": "${FROM_EMAIL}",
            "fromName": "${FROM_NAME}",
            "ownerEmail": "${OWNER_EMAIL}"
          }
        }
      }
    }
  }
}
EOF
)

SEED_FILE="$REPO_ROOT/seed-data.json"
if [[ "$DRY_RUN" == true ]]; then
  echo "--- Would create: seed-data.json ---"
  echo "$SEED_DATA"
  echo ""
else
  echo "$SEED_DATA" > "$SEED_FILE"
  echo "  Created: seed-data.json"
fi
changes_made=$((changes_made + 1))

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
echo "Files affected: $changes_made"
echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo "DRY RUN complete. No files were modified."
  echo "Remove --dry-run to apply changes."
else
  echo "Clone complete. Next steps:"
  echo "  1. Update storefront-tenant.js apiKey with the real Firebase API key"
  echo "  2. Update seed-data.json github repo path"
  echo "  3. Review all changes: git diff"
  echo "  4. Import seed data: firebase database:set / --project ${FIREBASE_PROJECT} --data seed-data.json --merge"
  echo "  5. Register tenant: ./scripts/register-tenant.sh --tenant-id ${TENANT_ID} ..."
  echo "  6. Deploy via mast_hosting"
fi
