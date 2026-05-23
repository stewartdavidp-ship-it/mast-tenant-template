#!/usr/bin/env node
/**
 * Backfill gallery entities from existing consignment placements.
 *
 * Walks `tenants/{tid}/admin/consignments` and groups placements by
 *   lower(trim(locationName))
 * to derive a distinct set of galleries. For each distinct group:
 *   - creates `tenants/{tid}/admin/galleries/{galleryId}` with:
 *       name                  = first-seen locationName (preserves original casing)
 *       contacts              = dedup of (name, email, phone) triples across placements
 *                               (only includes rows with at least name OR email)
 *       defaultCommissionPct  = mode of placement.commissionRate values (×100, rounded)
 *       currency              = 'USD'
 *       addresses             = []   (no address data on placements; operator adds later)
 *       notes                 = ''
 *       createdAt / updatedAt = now
 *   - writes `placement.galleryId = <new galleryId>` on each member placement.
 *
 * Each proposed gallery creation requires explicit operator approval per row
 * via stdin. Options at each prompt:
 *   y  — apply (create gallery + backfill galleryId on its placements)
 *   n  — skip this group
 *   s  — skip all remaining (abort)
 *
 * Dry-run by default. Pass --apply to commit writes.
 *
 * Usage:
 *   node scripts/backfill-gallery-entities.js                 # dry-run, lists proposals
 *   node scripts/backfill-gallery-entities.js --apply         # interactive, writes on y
 *   node scripts/backfill-gallery-entities.js --tenant <tid>  # restrict to one tenant
 *
 * Pattern matches scripts/backfill-wholesale-account-fk.js — Firestore REST via
 * gcloud access token. Requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtK8Nxd5w8OAe8OIDvw (Mast Sales W2) — job -OtK9NrneAcYU133yfno, W2.7.
 *
 * NOT meant for unattended runs — the row-by-row prompt is the safety contract.
 */

const { execSync } = require('child_process');
const readline = require('readline');

const PROJECT = 'mast-platform-prod';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

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

async function fsCreate(path, fields) {
  // PATCH with full mask creates-or-replaces atomically.
  const url = `${FS_BASE}/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH (create) ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

async function fsPatchFields(path, fields, updateMaskFields) {
  const mask = updateMaskFields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
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

function wrapValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(wrapValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = wrapValue(vv);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

async function listAllTenants() {
  const doc = await fsGet('platform_tenants');
  if (!doc || !doc.documents) return [];
  return doc.documents.map(d => d.name.split('/').pop()).filter(Boolean);
}

async function listPlacements(tid) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/tenants/${tid}/admin/consignments` + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`list placements ${tid}: ${res.status}`);
    }
    const j = await res.json();
    (j.documents || []).forEach(d => {
      const id = d.name.split('/').pop();
      out.push({ id, data: unwrap(d) });
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

function modeOf(values) {
  if (!values.length) return null;
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function newId() {
  // Simulates Firestore's push-id roughly — sortable timestamp prefix + random suffix.
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let s = '-';
  for (let i = 0; i < 19; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

function prompt(rl, q) {
  return new Promise(r => rl.question(q, a => r(a.trim().toLowerCase())));
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[gallery-entity-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const rl = APPLY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  let totalGroups = 0, totalCreated = 0, totalSkipped = 0, totalPlacementWrites = 0;
  let skipAll = false;

  for (const tid of tenants) {
    if (skipAll) break;
    const placements = await listPlacements(tid);
    if (!placements.length) continue;

    // Group by dedup-key.
    const groups = new Map(); // key → { firstName, placements[], contacts[], rates[] }
    for (const p of placements) {
      const loc = (p.data.locationName || '').trim();
      if (!loc) continue;
      if (p.data.galleryId) continue; // already backfilled
      const key = loc.toLowerCase();
      let g = groups.get(key);
      if (!g) { g = { firstName: loc, placements: [], contacts: [], rates: [] }; groups.set(key, g); }
      g.placements.push(p);
      if (p.data.locationContact || p.data.locationEmail) {
        g.contacts.push({ name: p.data.locationContact || '', email: p.data.locationEmail || '', phone: '', role: '' });
      }
      if (typeof p.data.commissionRate === 'number') g.rates.push(Math.round(p.data.commissionRate * 1000) / 1000);
    }

    if (groups.size === 0) continue;
    console.log(`\n── ${tid} — ${groups.size} candidate gallery group(s) ──`);

    for (const [, g] of groups) {
      if (skipAll) break;
      totalGroups++;
      // Dedup contacts on (name|email).
      const seen = new Set();
      const dedup = [];
      for (const c of g.contacts) {
        const k = (c.name || '').toLowerCase() + '|' + (c.email || '').toLowerCase();
        if (k === '|') continue;
        if (seen.has(k)) continue;
        seen.add(k);
        dedup.push(c);
      }
      const modeRate = modeOf(g.rates);
      const defaultPct = (modeRate !== null && modeRate !== undefined) ? Math.round(modeRate * 100 * 100) / 100 : null;
      console.log(`  "${g.firstName}"  placements=${g.placements.length}  contacts=${dedup.length}  defaultPct=${defaultPct !== null ? defaultPct + '%' : '(none)'}`);
      if (!APPLY) continue;

      const ans = await prompt(rl, '    [y]es / [n]o / [s]kip-all: ');
      if (ans === 's') { skipAll = true; break; }
      if (ans !== 'y') { totalSkipped++; continue; }

      const galleryId = newId();
      const now = new Date().toISOString();
      const galleryRec = {
        id: galleryId,
        name: g.firstName,
        addresses: [],
        contacts: dedup,
        defaultCommissionPct: defaultPct,
        currency: 'USD',
        notes: '',
        createdAt: now,
        updatedAt: now
      };
      const fields = {};
      for (const [k, v] of Object.entries(galleryRec)) fields[k] = wrapValue(v);
      try {
        await fsCreate(`tenants/${tid}/admin/galleries/${galleryId}`, fields);
        totalCreated++;
        console.log(`    ✓ created gallery ${galleryId}`);
      } catch (e) {
        console.error(`    ✗ gallery create failed: ${e.message}`);
        continue;
      }

      // Backfill galleryId on each placement.
      for (const p of g.placements) {
        try {
          await fsPatchFields(
            `tenants/${tid}/admin/consignments/${p.id}`,
            { galleryId: { stringValue: galleryId }, updatedAt: { timestampValue: now } },
            ['galleryId', 'updatedAt']
          );
          totalPlacementWrites++;
        } catch (e) {
          console.error(`    ✗ placement ${p.id} backfill failed: ${e.message}`);
        }
      }
      console.log(`    ✓ wrote galleryId on ${g.placements.length} placement(s)`);
    }
  }

  if (rl) rl.close();
  console.log(`\nDone. groups=${totalGroups} created=${totalCreated} placement-writes=${totalPlacementWrites} skipped=${totalSkipped}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
