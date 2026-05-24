#!/usr/bin/env node
/**
 * Backfill legacy day-close docs into the new Close v3 versioned shape.
 *
 *   FROM: tenants/{tid}/dayClose/{YYYY-MM-DD}
 *   TO:   tenants/{tid}/closes/day/{YYYY-MM-DD}/v1
 *
 * Legacy shape (source):
 *   { date, openingCashCents, closingCashCents, varianceCents,
 *     checks:[{number, payerName, amountCents}], checkTotalCents,
 *     notes, savedAt, savedBy }
 *
 * Target v1 shape:
 *   { openingCashCents, closingCashCents, varianceCents,
 *     checks, checkTotalCents, notes,
 *     operatorUid: savedBy,
 *     serverTs:   savedAt (preserved Timestamp),
 *     hash:       canonicalCashCloseHash(...),
 *     supersededBy: null }
 *
 * This is a pure shape-translation. No recomputation, no decisions — the
 * legacy doc already has the right numbers. We copy them across and stamp
 * the canonical hash so future supersede chains have a stable anchor.
 *
 * Pattern: Firestore REST via gcloud access token (same shape as
 * scripts/backfill-customer-portfolio-quadrant.js, backfill-wholesale-account-fk.js,
 * backfill-mode-set.js). No Firebase Admin SDK install needed.
 *
 * Idempotent: skips any date where the v1 doc already exists.
 *
 * Usage:
 *   node scripts/backfill-day-close-v1.js                    # dry-run, all tenants
 *   node scripts/backfill-day-close-v1.js --apply            # write v1 docs
 *   node scripts/backfill-day-close-v1.js --tid <id>         # restrict to one tenant
 *   node scripts/backfill-day-close-v1.js --since 2026-01-01 # only dates >= this
 *   node scripts/backfill-day-close-v1.js --apply --yes-all  # skip per-row prompt
 *
 * Row-by-row confirm prompt under --apply unless --yes-all.
 *
 * Idea: -OtQH_uRXqz9jJBRsmrj (Close v3), Agent C v2 PATH A.
 */

const { execSync } = require('child_process');
const { createHash } = require('crypto');
const readline = require('readline');

const PROJECT = 'mast-platform-prod';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Args ──
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES_ALL = args.includes('--yes-all');
function flagVal(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] || null;
}
const ONLY_TENANT = flagVal('--tid') || flagVal('--tenant');
const SINCE = flagVal('--since'); // YYYY-MM-DD inclusive
if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
  console.error(`bad --since value (expected YYYY-MM-DD): ${SINCE}`);
  process.exit(2);
}

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

async function fsListAll(collPath) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/${collPath}` + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`list ${collPath} → ${res.status}`);
    }
    const j = await res.json();
    (j.documents || []).forEach(d => {
      out.push({ id: d.name.split('/').pop(), raw: d, data: unwrap(d), name: d.name });
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

async function fsCreateDoc(parentPath, docId, fields) {
  // createDocument with explicit documentId. 409 if it already exists.
  const url = `${FS_BASE}/${parentPath}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`POST ${parentPath}/${docId} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ── Firestore value (un)wrapping ──
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
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('mapValue' in v) {
    const m = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) m[k] = unwrapValue(vv);
    return m;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrapValue);
  return null;
}

// Raw field-pluck — returns the wire-format Value so we can preserve
// timestamps without re-encoding.
function rawField(doc, name) {
  if (!doc || !doc.fields) return null;
  return doc.fields[name] || null;
}

// Wrap a plain JS value into Firestore wire-format.
function wrap(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(wrap) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = wrap(vv);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// ── Canonical hash ──
// Sort checks by number asc, JSON.stringify a sorted-key object of the
// financially-meaningful fields, sha256 hex.
function canonicalCashCloseHash({ openingCashCents, closingCashCents, varianceCents, checks, checkTotalCents }) {
  const sortedChecks = (Array.isArray(checks) ? checks.slice() : []).sort((a, b) => {
    const an = (a && a.number != null) ? String(a.number) : '';
    const bn = (b && b.number != null) ? String(b.number) : '';
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  }).map(c => {
    const sorted = {};
    for (const k of Object.keys(c || {}).sort()) sorted[k] = c[k];
    return sorted;
  });
  const canonical = {
    checkTotalCents: checkTotalCents | 0,
    checks: sortedChecks,
    closingCashCents: closingCashCents | 0,
    openingCashCents: openingCashCents | 0,
    varianceCents: varianceCents | 0
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function listAllTenants() {
  const doc = await fsGet('platform_tenants');
  if (!doc || !doc.documents) return [];
  return doc.documents.map(d => d.name.split('/').pop()).filter(Boolean);
}

function prompt(rl, q) {
  return new Promise(r => rl.question(q, ans => r(ans.trim().toLowerCase())));
}

async function processTenant(tid, totals, rl, ctx) {
  const docs = await fsListAll(`tenants/${tid}/dayClose`);
  if (docs.length === 0) return;

  const filtered = SINCE ? docs.filter(d => d.id >= SINCE) : docs;
  filtered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (filtered.length === 0) return;
  console.log(`\n── ${tid} — ${filtered.length} legacy day-close doc(s)${SINCE ? ` since ${SINCE}` : ''} ──`);

  for (const d of filtered) {
    if (ctx.skipAll) break;
    totals.found++;
    const date = d.id;
    const data = d.data || {};
    const raw = d.raw;

    // Idempotency check
    const existing = await fsGet(`tenants/${tid}/closes/day/${date}/v1`);
    if (existing) {
      totals.skipped++;
      console.log(`  ${date}  v1 already exists — skip`);
      continue;
    }

    // Edge-case extraction
    let edgeNotes = [];
    const checksRaw = Array.isArray(data.checks) ? data.checks : [];
    if (!Array.isArray(data.checks)) edgeNotes.push('no checks[] → []');
    const checks = checksRaw.map(c => ({
      number: c && c.number != null ? c.number : '',
      payerName: c && c.payerName != null ? c.payerName : '',
      amountCents: c && typeof c.amountCents === 'number' ? c.amountCents : 0
    }));
    const checkTotalCents = typeof data.checkTotalCents === 'number'
      ? data.checkTotalCents
      : (checks.reduce((s, c) => s + (c.amountCents || 0), 0));
    if (typeof data.checkTotalCents !== 'number') edgeNotes.push('no checkTotalCents → derived from checks');

    const openingCashCents = typeof data.openingCashCents === 'number' ? data.openingCashCents : 0;
    const closingCashCents = typeof data.closingCashCents === 'number' ? data.closingCashCents : 0;
    const varianceCents = typeof data.varianceCents === 'number' ? data.varianceCents : 0;
    const notes = typeof data.notes === 'string' ? data.notes : '';

    const savedBy = typeof data.savedBy === 'string' && data.savedBy ? data.savedBy : 'unknown-legacy';
    if (savedBy === 'unknown-legacy') {
      edgeNotes.push('missing savedBy → operatorUid=unknown-legacy');
      totals.unknownLegacy++;
    }
    if (edgeNotes.length) totals.withEdgeCases++;

    // Preserve savedAt as a Timestamp via raw wire-format pluck.
    const savedAtRaw = rawField(raw, 'savedAt');
    if (!savedAtRaw) edgeNotes.push('missing savedAt');

    const hash = canonicalCashCloseHash({
      openingCashCents, closingCashCents, varianceCents, checks, checkTotalCents
    });

    const summary = `  ${date}  open=$${(openingCashCents/100).toFixed(2)} close=$${(closingCashCents/100).toFixed(2)} var=$${(varianceCents/100).toFixed(2)} checks=${checks.length}` +
      (edgeNotes.length ? `  [${edgeNotes.join(', ')}]` : '');
    console.log(summary);

    if (!APPLY) {
      totals.wouldWrite++;
      continue;
    }

    if (!YES_ALL) {
      const ans = await prompt(rl, '    [y]es / [n]o / [a]ll / [s]kip-all: ');
      if (ans === 's') { ctx.skipAll = true; break; }
      if (ans === 'a') { ctx.yesAll = true; }
      else if (ans !== 'y' && !ctx.yesAll) { totals.userSkipped++; continue; }
    }

    // Build wire-format fields for the v1 doc.
    const fields = {
      openingCashCents: wrap(openingCashCents),
      closingCashCents: wrap(closingCashCents),
      varianceCents: wrap(varianceCents),
      checks: wrap(checks),
      checkTotalCents: wrap(checkTotalCents),
      notes: wrap(notes),
      operatorUid: wrap(savedBy),
      serverTs: savedAtRaw || { timestampValue: new Date().toISOString() },
      hash: wrap(hash),
      supersededBy: { nullValue: null }
    };

    try {
      // Parent path: tenants/{tid}/closes/day/{date}  (doc id: v1)
      await fsCreateDoc(`tenants/${tid}/closes/day/${date}`, 'v1', fields);
      totals.wrote++;
      console.log(`    ✓ wrote v1  hash=${hash.slice(0, 12)}…`);
    } catch (e) {
      totals.errors++;
      console.error(`    ✗ write failed: ${e.message}`);
    }
  }
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[day-close-v1-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}${YES_ALL ? ' yes-all' : ''} tenants=${tenants.length}${SINCE ? ` since=${SINCE}` : ''}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const rl = (APPLY && !YES_ALL) ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ctx = { skipAll: false, yesAll: false };
  const totals = {
    tenantsScanned: 0, found: 0, skipped: 0,
    wouldWrite: 0, wrote: 0, userSkipped: 0,
    errors: 0, withEdgeCases: 0, unknownLegacy: 0
  };

  for (const tid of tenants) {
    if (ctx.skipAll) break;
    totals.tenantsScanned++;
    try { await processTenant(tid, totals, rl, ctx); }
    catch (e) { console.error(`!! ${tid}: ${e.message}`); }
  }

  if (rl) rl.close();
  console.log(`\nDone. tenants_scanned=${totals.tenantsScanned} docs_found=${totals.found}`);
  console.log(`  skipped_existing=${totals.skipped} ${APPLY ? `wrote=${totals.wrote} user_skipped=${totals.userSkipped}` : `would_write=${totals.wouldWrite}`}` +
    (totals.errors ? `  errors=${totals.errors}` : ''));
  if (totals.withEdgeCases) {
    console.log(`  docs_with_edge_cases=${totals.withEdgeCases} (unknown_legacy_operator=${totals.unknownLegacy})`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
