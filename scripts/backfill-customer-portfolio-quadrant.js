#!/usr/bin/env node
/**
 * Backfill `stats.portfolioQuadrant` + `stats.classifiedAt` on
 *   tenants/{tid}/admin/customers/{customerId}
 *
 * Mirrors the render-time logic in app/modules/finance.js
 *   renderCustomerPortfolio() / portfolioClassify()
 * and the onDocumentWritten CF
 *   mast-architecture/functions/customer-portfolio-classify.js
 *
 * Quadrant rule (must stay in sync with both):
 *   netMarginPct >= 0.5  &&  lapseStatus === 'active' → grow
 *   netMarginPct >= 0.5  &&  lapseStatus !== 'active' → maintain
 *   netMarginPct <  0.5  &&  lapseStatus === 'active' → reprice
 *   netMarginPct <  0.5  &&  lapseStatus !== 'active' → deprioritize
 *   typeof netMarginPct !== 'number' || !lapseStatus || lapseStatus==='unknown'
 *                                                     → unclassified
 *
 * Cost-to-serve: per-customer tickets × perTicketCents + returns × perReturnCents
 * (defaults: 1500 / 2500; tenant override at admin/config/customerSuccess/costToServeDefaults).
 *
 * Net contribution = grossMargin − costToServe (not used by classifier itself,
 * but printed in the summary for sanity).
 *
 * Pattern: Firestore REST via gcloud access token (same shape as
 * scripts/backfill-wholesale-account-fk.js and scripts/backfill-mode-set.js).
 * No Firebase Admin SDK install needed.
 *
 * Usage:
 *   node scripts/backfill-customer-portfolio-quadrant.js                 # dry-run, all tenants
 *   node scripts/backfill-customer-portfolio-quadrant.js --apply         # write classifications
 *   node scripts/backfill-customer-portfolio-quadrant.js --tenant <tid>  # restrict to one tenant
 *
 * Unattended-safe: NO per-row prompts. Operator runs --apply when ready and
 * the onDocumentWritten CF keeps it fresh from then on.
 *
 * Idea: -OtMKtFHnUZE2xD25BzV (Mast Finance), Job: -OtMNiAaGveKvqtb1Gan, W1.8.
 */

const { execSync } = require('child_process');

const PROJECT = 'mast-platform-prod';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Default cost-to-serve when tenant has no override doc.
const CTS_DEFAULTS = { perTicketCents: 1500, perReturnCents: 2500 };

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

async function fsListAll(collPath) {
  // Paginated list — keeps memory bounded for large customer sets.
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
      out.push({ id: d.name.split('/').pop(), data: unwrap(d), name: d.name });
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

async function fsPatchStatsQuadrant(docPath, quadrant, classifiedAt) {
  // updateMask uses dotted paths so we don't clobber sibling stats fields.
  const url = `${FS_BASE}/${docPath}` +
    `?updateMask.fieldPaths=${encodeURIComponent('stats.portfolioQuadrant')}` +
    `&updateMask.fieldPaths=${encodeURIComponent('stats.classifiedAt')}`;
  const body = {
    fields: {
      stats: {
        mapValue: {
          fields: {
            portfolioQuadrant: { stringValue: quadrant },
            classifiedAt: { timestampValue: classifiedAt }
          }
        }
      }
    }
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PATCH ${docPath} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Firestore document.fields → plain JSON.
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
  const doc = await fsGet('platform_tenants');
  if (!doc || !doc.documents) return [];
  return doc.documents.map(d => d.name.split('/').pop()).filter(Boolean);
}

async function readCts(tid) {
  const doc = await fsGet(`tenants/${tid}/admin/config/customerSuccess/costToServeDefaults`).catch(() => null);
  if (!doc) return Object.assign({}, CTS_DEFAULTS);
  const data = unwrap(doc);
  return Object.assign({}, CTS_DEFAULTS, data || {});
}

// Mirrors portfolioClassify() in finance.js.
function classify(netMarginPct, lapseStatus) {
  if (typeof netMarginPct !== 'number' || !lapseStatus || lapseStatus === 'unknown') return 'unclassified';
  const highMargin = netMarginPct >= 0.5;
  const onCadence = lapseStatus === 'active';
  if (highMargin && onCadence) return 'grow';
  if (highMargin && !onCadence) return 'maintain';
  if (!highMargin && onCadence) return 'reprice';
  return 'deprioritize';
}

async function processTenant(tid, totals) {
  console.log(`\n── ${tid} ──`);
  const cts = await readCts(tid);

  const [customers, tickets, rmas] = await Promise.all([
    fsListAll(`tenants/${tid}/admin/customers`),
    fsListAll(`tenants/${tid}/admin/cs_tickets`),
    fsListAll(`tenants/${tid}/admin/rma`)
  ]);

  if (customers.length === 0) {
    console.log('  (no customers)');
    return;
  }

  // Per-customer event counts.
  const ticketCount = {}, returnCount = {};
  tickets.forEach(t => {
    const cid = t.data && t.data.customerId;
    if (cid) ticketCount[cid] = (ticketCount[cid] || 0) + 1;
  });
  rmas.forEach(r => {
    const cid = r.data && r.data.customerId;
    if (cid) returnCount[cid] = (returnCount[cid] || 0) + 1;
  });

  const counts = { grow: 0, maintain: 0, reprice: 0, deprioritize: 0, unclassified: 0 };
  let toWrite = 0, unchanged = 0, errors = 0;

  for (const c of customers) {
    const d = c.data || {};
    if (d.status === 'merged') continue;
    const stats = d.stats || {};
    const rev = typeof stats.trailing12mRevenueCents === 'number' ? stats.trailing12mRevenueCents : 0;
    const cogs = typeof stats.trailing12mCogsCents === 'number' ? stats.trailing12mCogsCents : 0;
    const gm = typeof stats.trailing12mGrossMarginCents === 'number'
      ? stats.trailing12mGrossMarginCents : (rev - cogs);
    const netMarginPct = typeof stats.trailing12mNetMarginPct === 'number'
      ? stats.trailing12mNetMarginPct : (rev > 0 ? gm / rev : null);
    const tc = ticketCount[c.id] || 0;
    const rc = returnCount[c.id] || 0;
    const c2s = tc * cts.perTicketCents + rc * cts.perReturnCents;
    const net = gm - c2s;

    const q = classify(netMarginPct, stats.lapseStatus || null);
    counts[q]++;

    if (stats.portfolioQuadrant === q) {
      unchanged++;
      continue;
    }
    toWrite++;
    if (!APPLY) continue;

    try {
      await fsPatchStatsQuadrant(`tenants/${tid}/admin/customers/${c.id}`, q, new Date().toISOString());
    } catch (e) {
      errors++;
      console.error(`  ✗ ${c.id}: ${e.message}`);
    }
  }

  console.log(`  customers=${customers.length} ` +
    `Grow=${counts.grow} Maintain=${counts.maintain} ` +
    `Reprice=${counts.reprice} Deprioritize=${counts.deprioritize} ` +
    `Unclassified=${counts.unclassified}`);
  console.log(`  ${APPLY ? 'wrote' : 'would write'}=${toWrite} unchanged=${unchanged}` +
    (errors ? ` errors=${errors}` : ''));

  totals.customers += customers.length;
  totals.toWrite += toWrite;
  totals.unchanged += unchanged;
  totals.errors += errors;
  for (const k of Object.keys(counts)) totals.counts[k] += counts[k];
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[customer-portfolio-quadrant-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const totals = {
    customers: 0, toWrite: 0, unchanged: 0, errors: 0,
    counts: { grow: 0, maintain: 0, reprice: 0, deprioritize: 0, unclassified: 0 }
  };

  for (const tid of tenants) {
    try { await processTenant(tid, totals); }
    catch (e) { console.error(`!! ${tid}: ${e.message}`); }
  }

  const c = totals.counts;
  console.log(`\nDone. tenants=${tenants.length} customers=${totals.customers}`);
  console.log(`  ${APPLY ? 'wrote' : 'would classify'}=${totals.toWrite} unchanged=${totals.unchanged}` +
    (totals.errors ? ` errors=${totals.errors}` : ''));
  console.log(`  Grow=${c.grow} Maintain=${c.maintain} Reprice=${c.reprice} ` +
    `Deprioritize=${c.deprioritize} Unclassified=${c.unclassified}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
