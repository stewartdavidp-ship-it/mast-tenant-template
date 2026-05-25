#!/usr/bin/env node
/**
 * Bootstrap the platform_qboRealmIndex/{realmId} reverse-lookup collection
 * from existing connected QBO integrations.
 *
 * W2b webhook routing uses realmId → tenantId reverse lookup (operator
 * decision, see W2b-CONTRACTS C3) because Intuit issues one webhook URL per
 * Intuit App and fans out events for ALL connected realms to it. Going
 * forward, `qboOauthCallback` writes this index at successful token exchange
 * and `disconnectQbo` removes it. This one-shot script seeds the index for
 * tenants that connected BEFORE the W2b code shipped.
 *
 * Iterates `platform_tenants` then reads each tenant's
 * `tenants/{tid}/admin_integrations/qbo` doc directly (Firestore REST does
 * not support collectionGroup queries via the documents API, so we walk the
 * platform_tenants index instead — same shape as backfill-qbo-item-bridge.js).
 *
 * Idempotent: skips rows where `platform_qboRealmIndex/{realmId}` already
 * exists. Default = dry-run; `--apply` commits.
 *
 * Usage:
 *   node scripts/bootstrap-qbo-realm-index.js                 # dry-run (all tenants)
 *   node scripts/bootstrap-qbo-realm-index.js --tenant <tid>  # dry-run (one tenant)
 *   node scripts/bootstrap-qbo-realm-index.js --apply         # commit (all tenants)
 *
 * Pattern cloned from scripts/backfill-qbo-item-bridge.js (W2a.1).
 * Firestore REST via gcloud access token; requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtKxQEhTDampnjEBjvS (Mast Accounting Integration W2b) — CONTRACT C3.
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

async function fsCreate(collectionPath, docId, fields) {
  // Firestore REST: createDocument with documentId fails if exists (409).
  const url = `${FS_BASE}/${collectionPath}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${collectionPath}/${docId} → ${res.status}: ${txt}`);
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

async function listAllTenants() {
  // Walk platform_tenants pagination — same as backfill-qbo-item-bridge.js.
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/platform_tenants` + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return out;
      throw new Error(`list platform_tenants: ${res.status}`);
    }
    const j = await res.json();
    (j.documents || []).forEach(d => {
      const id = d.name.split('/').pop();
      if (id) out.push(id);
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

async function processTenant(tid, counters) {
  // NOTE: Firestore stores this as 4-segment doc `tenants/{tid}/admin_integrations/qbo`
  // (Mast convention flattens admin/X → admin_X). The CF code uses a `ds` resolver
  // that applies the flattening internally; raw REST callers must use the flat path.
  const qboDoc = await fsGet(`tenants/${tid}/admin_integrations/qbo`);
  if (!qboDoc) {
    counters.noIntegration++;
    return;
  }
  const data = unwrap(qboDoc);
  const realmId = data.realmId;
  const status = data.status;
  if (!realmId || status !== 'connected') {
    counters.notConnected++;
    return;
  }

  // Check if index row already exists.
  const existing = await fsGet(`platform_qboRealmIndex/${realmId}`);
  if (existing) {
    counters.alreadyIndexed++;
    console.log(`  • already indexed realmId=${realmId} → ${tid}`);
    return;
  }

  counters.proposed++;
  if (!APPLY) {
    console.log(`  [DRY-RUN] would index realmId=${realmId} → tenantId=${tid}`);
    return;
  }

  const nowIso = new Date().toISOString();
  const linkedAt = data.connectedAt || nowIso;
  const lastUsedAt = data.lastUsedAt || nowIso;
  const fields = {
    tenantId: { stringValue: tid },
    linkedAt: { timestampValue: linkedAt },
    lastUsedAt: { timestampValue: lastUsedAt },
  };
  try {
    await fsCreate('platform_qboRealmIndex', realmId, fields);
    counters.applied++;
    console.log(`  ✓ platform_qboRealmIndex/${realmId} → ${tid}`);
  } catch (e) {
    counters.failed++;
    console.error(`  ✗ platform_qboRealmIndex/${realmId}: ${e.message}`);
  }
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[qbo-realm-index-bootstrap] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const counters = {
    proposed: 0,
    applied: 0,
    failed: 0,
    alreadyIndexed: 0,
    notConnected: 0,
    noIntegration: 0,
  };

  for (const tid of tenants) {
    console.log(`\n── ${tid} ──`);
    try {
      await processTenant(tid, counters);
    } catch (e) {
      console.error(`  ✗ ${tid}: ${e.message}`);
      counters.failed++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  proposed=${counters.proposed} applied=${counters.applied} failed=${counters.failed}`);
  console.log(`  skipped: alreadyIndexed=${counters.alreadyIndexed} notConnected=${counters.notConnected} noIntegration=${counters.noIntegration}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
