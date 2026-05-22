#!/usr/bin/env node
/**
 * Backfill Mast modeSet for all existing tenants.
 *
 * Reads each tenant's businessEntity, runs deriveModeSet() against the existing
 * wizard fields (category + revenueChannels + engagement.mode + engagement.modulesShown),
 * and writes the result to tenants/{tid}/admin_businessEntity/modeSet.
 *
 * IDEMPOTENT — re-runs only write if the derived modeSet differs from current
 * (modes / overlays / cohortFlag — modeVersion + derivedAt are excluded from
 * the diff). Safe to re-run after wizard logic changes.
 *
 * Job: -OtARrv1oBWpzNThG4w5 (M1 — Mode-derivation function + existing-tenant backfill)
 * Idea: -OtADygKA_JhRmk1wUqN (Mast modes — post-wizard progressive disclosure)
 *
 * Usage:
 *   node scripts/backfill-mode-set.js --dry-run          # preview changes, no writes
 *   node scripts/backfill-mode-set.js --tenant dev       # one tenant
 *   node scripts/backfill-mode-set.js --apply            # all active tenants
 *
 * Requires: gcloud auth on mast-platform-prod project. Uses Firestore REST API
 * via the same gcloud-access-token pattern as scripts/migrate-coin-ratio.js.
 */

const { execSync } = require('child_process');
const path = require('path');

// Load deriveModeSet from the shared constants file. The IIFE binds to `this`
// in Node CJS (= module.exports), so BusinessEntityConstants becomes an export.
const BEC = require(path.join(__dirname, '..', 'shared', 'business-entity-constants.js')).BusinessEntityConstants;
if (!BEC || typeof BEC.deriveModeSet !== 'function') {
  console.error('FATAL: BusinessEntityConstants.deriveModeSet not loaded. Check shared/business-entity-constants.js.');
  process.exit(2);
}

const PROJECT = 'mast-platform-prod';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Args ──
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
const TENANT_FLAG_IDX = args.indexOf('--tenant');
const SINGLE_TENANT = TENANT_FLAG_IDX >= 0 ? args[TENANT_FLAG_IDX + 1] : null;
const VERBOSE = args.includes('--verbose');
const RUN_TESTS = args.includes('--test');

if (!DRY_RUN && !APPLY && !SINGLE_TENANT && !RUN_TESTS) {
  console.error('Usage: node scripts/backfill-mode-set.js [--dry-run | --apply | --tenant <id> | --test] [--verbose]');
  process.exit(1);
}

// ── Self-tests path: just run the derivation self-tests and exit. ──
if (RUN_TESTS) {
  const result = BEC._runDerivationSelfTests();
  process.exit(result.failed === 0 ? 0 : 1);
}

// ── Auth ──
function getToken() {
  return execSync(`gcloud auth print-access-token --project ${PROJECT}`, { encoding: 'utf8' }).trim();
}

// ── Firestore typed-fields helpers (minimal — only what we need) ──

// Convert Firestore typed-field value to a plain JS value.
function unwrapValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    const items = (v.arrayValue && v.arrayValue.values) || [];
    return items.map(unwrapValue);
  }
  if ('mapValue' in v) {
    const out = {};
    const fields = (v.mapValue && v.mapValue.fields) || {};
    for (const k in fields) out[k] = unwrapValue(fields[k]);
    return out;
  }
  return null;
}

// Convert a full Firestore document fields-map to a plain JS object.
function unwrapDoc(doc) {
  if (!doc || !doc.fields) return {};
  const out = {};
  for (const k in doc.fields) out[k] = unwrapValue(doc.fields[k]);
  return out;
}

// Convert a plain JS value to Firestore typed-field.
function wrapValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(wrapValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k in v) fields[k] = wrapValue(v[k]);
    return { mapValue: { fields: fields } };
  }
  return { nullValue: null };
}

// Wrap full object as a document body.
function wrapDoc(obj) {
  const fields = {};
  for (const k in obj) fields[k] = wrapValue(obj[k]);
  return { fields: fields };
}

// ── HTTP helpers ──

async function fsGet(docPath, token) {
  const url = `${FS_BASE}/${docPath}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fsListCollection(collPath, token) {
  // Single page is usually enough (each tenant has ~5-10 BE sub-docs; ~30-100 tenants).
  // For large tenant counts pagination would be needed — keeping simple for v1.
  const url = `${FS_BASE}/${collPath}?pageSize=300`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (res.status === 404) return { documents: [] };
  if (!res.ok) throw new Error(`LIST ${collPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fsPatch(docPath, body, token) {
  // Replace the whole document (modeSet has no fields outside our control).
  const url = `${FS_BASE}/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PATCH ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Tenant operations ──

async function listActiveTenants(token) {
  const result = await fsListCollection('platform_tenants', token);
  const docs = result.documents || [];
  return docs.map(d => {
    const id = d.name.split('/').pop();
    const data = unwrapDoc(d);
    return { id, status: data.status || null };
  }).filter(t => t.status === 'active');
}

async function readBusinessEntity(tenantId, token) {
  // admin/businessEntity translates to collection admin_businessEntity with one
  // doc per section (identity, presence, engagement, modeSet, etc.) — see
  // shared/mastdb.js _translateTenantPath.
  const collPath = `tenants/${tenantId}/admin_businessEntity`;
  const result = await fsListCollection(collPath, token);
  const docs = result.documents || [];
  const out = {};
  for (const d of docs) {
    const key = d.name.split('/').pop();
    out[key] = unwrapDoc(d);
  }
  return out;
}

function modeSetsDiffer(current, derived) {
  if (!current) return true;
  const a = JSON.stringify((current.modes || []).slice().sort());
  const b = JSON.stringify((derived.modes || []).slice().sort());
  if (a !== b) return true;
  const oa = JSON.stringify((current.overlays || []).slice().sort());
  const ob = JSON.stringify((derived.overlays || []).slice().sort());
  if (oa !== ob) return true;
  if ((current.cohortFlag || false) !== (derived.cohortFlag || false)) return true;
  // modeVersion change is meaningful — newer version is a real update.
  if ((current.modeVersion || 0) !== (derived.modeVersion || 0)) return true;
  return false;
}

async function processTenant(tenantId, token, applyWrites) {
  const entity = await readBusinessEntity(tenantId, token);
  if (Object.keys(entity).length === 0) {
    console.log(`  ${tenantId}: SKIP (no businessEntity)`);
    return { skipped: true };
  }

  const derived = BEC.deriveModeSet(entity, { derivedFrom: 'backfill' });
  const current = entity.modeSet || null;
  const differs = modeSetsDiffer(current, derived);

  if (!differs) {
    if (VERBOSE) {
      console.log(`  ${tenantId}: unchanged (modes=[${derived.modes.join(',')}] overlays=[${derived.overlays.join(',')}])`);
    } else {
      console.log(`  ${tenantId}: unchanged`);
    }
    return { unchanged: true };
  }

  const summary = `modes=[${derived.modes.join(',')}] overlays=[${derived.overlays.join(',')}] cohort=${derived.cohortFlag}`;
  if (!applyWrites) {
    console.log(`  ${tenantId}: WOULD WRITE ${summary}`);
    if (VERBOSE && current) console.log(`    (current: modes=[${(current.modes||[]).join(',')}] overlays=[${(current.overlays||[]).join(',')}] cohort=${current.cohortFlag})`);
    return { wouldWrite: true };
  }

  const docPath = `tenants/${tenantId}/admin_businessEntity/modeSet`;
  await fsPatch(docPath, wrapDoc(derived), token);
  console.log(`  ${tenantId}: WROTE ${summary}`);
  return { wrote: true };
}

// ── Main ──

async function main() {
  if (typeof fetch === 'undefined') {
    console.error('FATAL: fetch is not defined. This script requires Node.js >= 18.');
    process.exit(2);
  }

  const token = getToken();
  const applyWrites = APPLY || (SINGLE_TENANT && !DRY_RUN);

  console.log(`Mast modeSet backfill — mode: ${applyWrites ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Project: ${PROJECT}`);
  console.log('');

  let tenants;
  if (SINGLE_TENANT) {
    tenants = [{ id: SINGLE_TENANT, status: 'active' }];
    console.log(`Single tenant: ${SINGLE_TENANT}`);
  } else {
    tenants = await listActiveTenants(token);
    console.log(`Found ${tenants.length} active tenants.`);
  }
  console.log('');

  const stats = { skipped: 0, unchanged: 0, wouldWrite: 0, wrote: 0, errored: 0 };
  for (const t of tenants) {
    try {
      const result = await processTenant(t.id, token, applyWrites);
      if (result.skipped) stats.skipped++;
      else if (result.unchanged) stats.unchanged++;
      else if (result.wouldWrite) stats.wouldWrite++;
      else if (result.wrote) stats.wrote++;
    } catch (err) {
      console.error(`  ${t.id}: ERROR — ${err.message}`);
      stats.errored++;
    }
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Skipped (no entity):  ${stats.skipped}`);
  console.log(`  Unchanged:            ${stats.unchanged}`);
  if (applyWrites) {
    console.log(`  Wrote:                ${stats.wrote}`);
  } else {
    console.log(`  Would write:          ${stats.wouldWrite}`);
  }
  console.log(`  Errored:              ${stats.errored}`);
  process.exit(stats.errored > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(2);
});
