#!/usr/bin/env node
/**
 * Backfill wholesale-account FK on legacy wholesale orders.
 *
 * Walks `tenants/{tid}/admin/orders` looking for rows where
 *   type === 'wholesale' && !wholesaleAccountId
 * and proposes a join based on:
 *   buyerEmail.toLowerCase() === wholesaleUsers[*].email.toLowerCase()
 *   → use that user's wholesaleAccountId.
 *
 * Each proposed write requires explicit operator approval per row via stdin.
 * Options at each prompt:
 *   y  — apply the proposed account FK
 *   n  — skip this row
 *   s  — skip all remaining (abort)
 *   d  — mark as 'direct_retail' instead (the W1.9 sentinel for explicit non-wholesale)
 *
 * One-shot W1 deploy-window script. NOT meant for unattended runs — the
 * row-by-row prompt is the safety contract. DO NOT remove the prompt to make
 * it "faster"; the whole point is the operator ratifies each FK.
 *
 * Usage:
 *   node scripts/backfill-wholesale-account-fk.js                 # dry-run, shows proposals
 *   node scripts/backfill-wholesale-account-fk.js --apply         # interactive, writes on y/d
 *   node scripts/backfill-wholesale-account-fk.js --tenant <tid>  # restrict to one tenant
 *
 * Pattern matches scripts/backfill-mode-set.js — Firestore REST via gcloud
 * access token. Requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtK8Nxd5w8OAe8OIDvw (Mast Sales W1) — job -OtK9B-L_IlEs59GQG6u, W1.9.
 */

const { execSync } = require('child_process');
const readline = require('readline');

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

async function fsPatch(path, fields) {
  const url = `${FS_BASE}/${path}?updateMask.fieldPaths=wholesaleAccountId&updateMask.fieldPaths=updatedAt`;
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

// Convert Firestore document.fields → plain JSON (best-effort, handles the
// shapes we care about: stringValue, integerValue, booleanValue, mapValue,
// arrayValue, nullValue, timestampValue).
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
  return doc.documents
    .map(d => d.name.split('/').pop())
    .filter(Boolean);
}

async function listOrdersForTenant(tid) {
  // Tenant orders live at tenants/{tid}/admin/orders/... in Firestore.
  // Use the list-documents endpoint, paginated.
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/tenants/${tid}/admin/orders` + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`list orders ${tid}: ${res.status}`);
    }
    const j = await res.json();
    (j.documents || []).forEach(d => {
      const id = d.name.split('/').pop();
      out.push({ id, data: unwrap(d), name: d.name });
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

async function buildUserEmailMap(tid) {
  // wholesaleUsers live at tenants/{tid}/wholesaleUsers/{key} with .email + .wholesaleAccountId.
  const url = `${FS_BASE}/tenants/${tid}/wholesaleUsers`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) return {};
  const j = await res.json();
  const map = {};
  (j.documents || []).forEach(d => {
    const u = unwrap(d);
    if (u && u.email && u.wholesaleAccountId) {
      map[u.email.toLowerCase()] = { accountId: u.wholesaleAccountId, name: u.name || '' };
    }
  });
  return map;
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim().toLowerCase())));
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[wholesale-fk-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const rl = APPLY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  let totalCandidates = 0, totalApplied = 0, totalDirect = 0, totalSkipped = 0;
  let skipAll = false;

  for (const tid of tenants) {
    if (skipAll) break;
    const userEmailMap = await buildUserEmailMap(tid);
    const orders = await listOrdersForTenant(tid);
    const candidates = orders.filter(o => {
      const d = o.data || {};
      return d.type === 'wholesale' && !d.wholesaleAccountId;
    });
    if (candidates.length === 0) continue;
    console.log(`\n── ${tid} — ${candidates.length} candidate order(s) ──`);

    for (const o of candidates) {
      if (skipAll) break;
      totalCandidates++;
      const buyerEmail = (o.data.buyerEmail || o.data.email || '').toLowerCase();
      const match = buyerEmail ? userEmailMap[buyerEmail] : null;
      const propose = match ? match.accountId : null;
      const summary = `  ${o.id}  buyer=${buyerEmail || '(none)'}  total=$${((o.data.totalCents || 0) / 100).toFixed(2)}  → propose=${propose || '(no match — direct/retail?)'} ${match && match.name ? '(' + match.name + ')' : ''}`;
      console.log(summary);
      if (!APPLY) continue;

      const ans = await prompt(rl, '    [y]es / [n]o / [s]kip-all / [d]irect-retail: ');
      if (ans === 's') { skipAll = true; break; }
      if (ans === 'n') { totalSkipped++; continue; }
      let writeVal;
      if (ans === 'd') writeVal = 'direct_retail';
      else if (ans === 'y') {
        if (!propose) { console.log('    no proposal — skipped (use d for direct/retail).'); totalSkipped++; continue; }
        writeVal = propose;
      } else { totalSkipped++; continue; }

      const fields = {
        wholesaleAccountId: { stringValue: writeVal },
        updatedAt: { timestampValue: new Date().toISOString() }
      };
      try {
        await fsPatch(`tenants/${tid}/admin/orders/${o.id}`, fields);
        if (writeVal === 'direct_retail') totalDirect++; else totalApplied++;
        console.log(`    ✓ wrote wholesaleAccountId=${writeVal}`);
      } catch (e) {
        console.error(`    ✗ write failed: ${e.message}`);
      }
    }
  }

  if (rl) rl.close();
  console.log(`\nDone. candidates=${totalCandidates} applied=${totalApplied} direct_retail=${totalDirect} skipped=${totalSkipped}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
