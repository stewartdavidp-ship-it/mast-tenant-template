#!/usr/bin/env node
/**
 * Backfill QBO Item bridge field on products.
 *
 * Walks tenants/{tid}/products/{productId} and null-seeds the bridge FK field
 * that W2a.1 lookup CFs will populate lazily on first wholesale-AR push:
 *
 *   tenants/{tid}/products/{productId}
 *     → if qboItemId is missing, seed qboItemId=null
 *
 * Variant model note: products use the Shopify-style nested pattern where
 * variants live at `public/products/{pid}/variants/{variantId}`. For V1 we
 * ONLY null-seed at the product-doc level per W2a-CONTRACTS C3 — qboItemId
 * is per-product, not per-variant. A future wave can extend to variants if
 * the QBO Item granularity needs to match per-variant SKUs.
 *
 * Lazy population contract: this script writes null. First call to the new
 * `lookupOrCreateQboItem` CF (in wholesale-AR push path) is what populates
 * the real qboItemId. This mirrors W1.4's customer/vendor bridge pattern
 * exactly and avoids a chicken-egg dependency on CF deployment order.
 *
 * Idempotent — re-running on a seeded tenant reports 0 changes. Only writes
 * the field if it does not already exist on the document.
 *
 * Default = dry-run. `--apply` flag commits the writes. No row-by-row prompt:
 * this is a null-seed (no per-row judgment), so the `--apply` gate alone is
 * the safety contract.
 *
 * Usage:
 *   node scripts/backfill-qbo-item-bridge.js                 # dry-run (all tenants)
 *   node scripts/backfill-qbo-item-bridge.js --tenant <tid>  # dry-run (one tenant)
 *   node scripts/backfill-qbo-item-bridge.js --apply         # commit (all tenants)
 *
 * Pattern cloned from scripts/backfill-qbo-customer-vendor-bridge.js (W1.4).
 * Firestore REST via gcloud access token; requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtKxQEhTDampnjEBjvS (Mast Accounting Integration W2a) — concept -OtUD_ohTBW3uB24Efgb (W2a.1).
 */

const { execSync } = require('child_process');

const PROJECT = 'mast-platform-prod';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Args ──
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantIdx = args.indexOf('--tenant');
const ONLY_TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

function token() {
  return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

async function fsGet(path) {
  const url = `${FS_BASE}/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GET ${path} → ${res.status}`);
  }
  return res.json();
}

async function fsPatch(path, fields, fieldPaths) {
  const mask = fieldPaths.map(fp => `updateMask.fieldPaths=${encodeURIComponent(fp)}`).join('&');
  const url = `${FS_BASE}/${path}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

function unwrap(doc) {
  if (!doc || !doc.fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = unwrapValue(v);
  return out;
}
function unwrapValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const m = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) m[k] = unwrapValue(vv);
    return m;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrapValue);
  return null;
}

// True iff the raw Firestore doc has the named field already present
// (any value, including explicit null). We check the raw .fields map so a
// previously-seeded `null` value still counts as "set" and we don't rewrite.
function hasField(doc, name) {
  return !!(doc && doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, name));
}

async function listAllTenants() {
  const doc = await fsGet('platform_tenants');
  if (!doc || !doc.documents) return [];
  return doc.documents
    .map(d => d.name.split('/').pop())
    .filter(Boolean);
}

async function listCollection(path) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/${path}` + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`list ${path}: ${res.status}`);
    }
    const j = await res.json();
    (j.documents || []).forEach(d => {
      const id = d.name.split('/').pop();
      out.push({ id, raw: d, data: unwrap(d), name: d.name });
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

async function processProducts(tid, counters) {
  const docs = await listCollection(`tenants/${tid}/products`);
  for (const d of docs) {
    if (hasField(d.raw, 'qboItemId')) continue;
    counters.proProposed++;
    if (!APPLY) {
      console.log(`  [DRY-RUN] would seed qboItemId=null on products/${d.id}`);
      continue;
    }
    const fields = {
      qboItemId: { nullValue: null },
      updatedAt: { timestampValue: new Date().toISOString() }
    };
    try {
      await fsPatch(`tenants/${tid}/products/${d.id}`, fields, ['qboItemId', 'updatedAt']);
      counters.proApplied++;
      console.log(`  ✓ products/${d.id} qboItemId=null`);
    } catch (e) {
      console.error(`  ✗ products/${d.id}: ${e.message}`);
      counters.proFailed++;
    }
  }
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[qbo-item-bridge-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const counters = { proProposed: 0, proApplied: 0, proFailed: 0 };

  for (const tid of tenants) {
    console.log(`\n── ${tid} ──`);
    try {
      await processProducts(tid, counters);
    } catch (e) {
      console.error(`  ✗ products list ${tid}: ${e.message}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  products  proposed=${counters.proProposed} applied=${counters.proApplied} failed=${counters.proFailed}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
