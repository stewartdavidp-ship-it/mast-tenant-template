#!/usr/bin/env node
/**
 * Backfill QBO customer/vendor bridge fields.
 *
 * Walks two paths per tenant and null-seeds the bridge FK fields that W1.4
 * lookup CFs will populate once a QBO connection is established:
 *
 *   tenants/{tid}/admin/wholesale/accounts/{accountId}
 *     → if qboCustomerId is missing, seed qboCustomerId=null
 *
 *   tenants/{tid}/vendors/{vendorId}
 *     → if qboVendorId is missing, seed qboVendorId=null
 *
 * Idempotent — re-running on a seeded tenant reports 0 changes. Only writes
 * the field if it does not already exist on the document.
 *
 * Default = dry-run. `--apply` flag commits the writes. No row-by-row prompt:
 * this is a null-seed (no per-row judgment), so the `--apply` gate alone is
 * the safety contract.
 *
 * Usage:
 *   node scripts/backfill-qbo-customer-vendor-bridge.js                 # dry-run (all tenants)
 *   node scripts/backfill-qbo-customer-vendor-bridge.js --tenant <tid>  # dry-run (one tenant)
 *   node scripts/backfill-qbo-customer-vendor-bridge.js --apply         # commit (all tenants)
 *
 * Pattern mirrors scripts/backfill-wholesale-account-fk.js (Firestore REST
 * via gcloud access token). Requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtKxQEhTDampnjEBjvS (Mast Accounting Integration W1) — concept -OtQ1367CQxgv-b5cRLi (W1.4).
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

async function processWholesaleAccounts(tid, counters) {
  const docs = await listCollection(`tenants/${tid}/admin/wholesale/accounts`);
  for (const d of docs) {
    if (hasField(d.raw, 'qboCustomerId')) continue;
    counters.wsProposed++;
    if (!APPLY) {
      console.log(`  [DRY-RUN] would seed qboCustomerId=null on wholesale/accounts/${d.id}`);
      continue;
    }
    const fields = {
      qboCustomerId: { nullValue: null },
      updatedAt: { timestampValue: new Date().toISOString() }
    };
    try {
      await fsPatch(`tenants/${tid}/admin/wholesale/accounts/${d.id}`, fields, ['qboCustomerId', 'updatedAt']);
      counters.wsApplied++;
      console.log(`  ✓ wholesale/accounts/${d.id} qboCustomerId=null`);
    } catch (e) {
      console.error(`  ✗ wholesale/accounts/${d.id}: ${e.message}`);
      counters.wsFailed++;
    }
  }
}

async function processVendors(tid, counters) {
  const docs = await listCollection(`tenants/${tid}/vendors`);
  for (const d of docs) {
    if (hasField(d.raw, 'qboVendorId')) continue;
    counters.venProposed++;
    if (!APPLY) {
      console.log(`  [DRY-RUN] would seed qboVendorId=null on vendors/${d.id}`);
      continue;
    }
    const fields = {
      qboVendorId: { nullValue: null },
      updatedAt: { timestampValue: new Date().toISOString() }
    };
    try {
      await fsPatch(`tenants/${tid}/vendors/${d.id}`, fields, ['qboVendorId', 'updatedAt']);
      counters.venApplied++;
      console.log(`  ✓ vendors/${d.id} qboVendorId=null`);
    } catch (e) {
      console.error(`  ✗ vendors/${d.id}: ${e.message}`);
      counters.venFailed++;
    }
  }
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[qbo-bridge-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const counters = { wsProposed: 0, wsApplied: 0, wsFailed: 0, venProposed: 0, venApplied: 0, venFailed: 0 };

  for (const tid of tenants) {
    console.log(`\n── ${tid} ──`);
    try {
      await processWholesaleAccounts(tid, counters);
    } catch (e) {
      console.error(`  ✗ wholesale list ${tid}: ${e.message}`);
    }
    try {
      await processVendors(tid, counters);
    } catch (e) {
      console.error(`  ✗ vendors list ${tid}: ${e.message}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  wholesale/accounts  proposed=${counters.wsProposed} applied=${counters.wsApplied} failed=${counters.wsFailed}`);
  console.log(`  vendors             proposed=${counters.venProposed} applied=${counters.venApplied} failed=${counters.venFailed}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
