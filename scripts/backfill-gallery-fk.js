#!/usr/bin/env node
/**
 * Backfill galleryId FK on legacy consignment placements + create Gallery
 * entities from distinct locationName strings.
 *
 * Walks `tenants/{tid}/consignments` for placements where
 *   !galleryId && locationName
 * Groups by locationName (case-insensitive). For each group, proposes either:
 *   - REUSE an existing gallery whose name matches the locationName (CI), OR
 *   - CREATE a new gallery from the locationName + assign FK to all placements
 *     in the group.
 *
 * Operator approves per GROUP (not per row — much faster: 14 placements with
 * 5 unique locationNames = 5 prompts, not 14).
 *
 * Each proposed write requires explicit operator approval per group via stdin.
 * Options at each prompt:
 *   y  — create gallery (or reuse) + apply FK to all placements in group
 *   n  — skip this group
 *   s  — skip all remaining (abort)
 *
 * One-shot Finance W3 / Accounting-arc precursor script. NOT meant for
 * unattended runs — the group-by-group prompt is the safety contract.
 *
 * Usage:
 *   node scripts/backfill-gallery-fk.js                 # dry-run, shows proposals
 *   node scripts/backfill-gallery-fk.js --apply         # interactive, writes on y
 *   node scripts/backfill-gallery-fk.js --tenant <tid>  # restrict to one tenant
 *
 * Pattern matches scripts/backfill-wholesale-account-fk.js — Firestore REST
 * via gcloud access token. Requires gcloud auth on mast-platform-prod.
 *
 * Idea: -OtMKtFHnUZE2xD25BzV (Mast Finance) — closes Devon-flagged W3 OPEN
 * (val gallery $0 owed despite $115 placement earnings). Same shape as Sales
 * W1.9 wholesale FK backfill.
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

async function fsPatch(path, fields, updateMaskFields) {
  const masks = updateMaskFields.map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${FS_BASE}/${path}?${masks}`;
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

async function fsCreate(collectionPath, docId, fields) {
  const url = `${FS_BASE}/${collectionPath}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`CREATE ${collectionPath}/${docId} → ${res.status}: ${txt}`);
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
  const doc = await fsGet('platform_tenants');
  if (!doc || !doc.documents) return [];
  return doc.documents.map(d => d.name.split('/').pop()).filter(Boolean);
}

async function listAll(collPath) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const url = `${FS_BASE}/${collPath}` + (pageToken ? `?pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`list ${collPath}: ${res.status}`);
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

function newKey() {
  // Mirrors Firebase push-id shape (rough — sortable + random suffix).
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `-${ts}${rand}`.slice(0, 20);
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim().toLowerCase())));
}

async function main() {
  const tenants = ONLY_TENANT ? [ONLY_TENANT] : await listAllTenants();
  console.log(`[gallery-fk-backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} tenants=${tenants.length}`);
  if (!APPLY) console.log('  (no writes — re-run with --apply to commit)');

  const rl = APPLY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  let totalGroups = 0, totalCreated = 0, totalReused = 0, totalLinked = 0, totalSkipped = 0;
  let skipAll = false;

  for (const tid of tenants) {
    if (skipAll) break;

    const galleries = await listAll(`tenants/${tid}/admin/galleries`);
    const placements = await listAll(`tenants/${tid}/consignments`);
    const candidates = placements.filter(p => !p.data.galleryId && p.data.locationName);
    if (candidates.length === 0) continue;

    // Group by locationName (case-insensitive)
    const groups = {};
    candidates.forEach(p => {
      const key = p.data.locationName.trim().toLowerCase();
      if (!groups[key]) groups[key] = { displayName: p.data.locationName.trim(), placements: [] };
      groups[key].placements.push(p);
    });

    // For each group, find an existing matching gallery by name (case-insensitive)
    const galleryByLcName = {};
    galleries.forEach(g => {
      if (g.data.name) galleryByLcName[g.data.name.trim().toLowerCase()] = g;
    });

    const groupKeys = Object.keys(groups);
    console.log(`\n── ${tid} — ${candidates.length} unlinked placement(s) in ${groupKeys.length} group(s) ──`);

    for (const key of groupKeys) {
      if (skipAll) break;
      totalGroups++;
      const grp = groups[key];
      const existing = galleryByLcName[key] || null;
      const action = existing ? `REUSE gallery '${existing.data.name}' (${existing.id})` : `CREATE new gallery '${grp.displayName}'`;
      console.log(`  [${key.slice(0, 50)}] ${grp.placements.length} placement(s) — propose: ${action}`);
      if (!APPLY) continue;

      const ans = await prompt(rl, '    [y]es / [n]o / [s]kip-all: ');
      if (ans === 's') { skipAll = true; break; }
      if (ans !== 'y') { totalSkipped++; continue; }

      // Resolve target gallery
      let galleryId;
      if (existing) {
        galleryId = existing.id;
        totalReused++;
      } else {
        galleryId = newKey();
        const nowIso = new Date().toISOString();
        const newFields = {
          name: { stringValue: grp.displayName },
          status: { stringValue: 'active' },
          defaultCommissionPct: { doubleValue: 30 }, // operator can edit later in #galleries
          createdAt: { timestampValue: nowIso },
          updatedAt: { timestampValue: nowIso },
          createdBy: { stringValue: 'gallery-fk-backfill-script' },
          notes: { stringValue: 'Auto-created from legacy placement.locationName by backfill script ' + nowIso }
        };
        try {
          await fsCreate(`tenants/${tid}/admin/galleries`, galleryId, newFields);
          console.log(`    ✓ created gallery ${galleryId}`);
          totalCreated++;
        } catch (e) {
          console.error(`    ✗ create failed: ${e.message}`);
          totalSkipped++;
          continue;
        }
      }

      // Patch each placement in the group with galleryId FK
      const nowIso = new Date().toISOString();
      for (const p of grp.placements) {
        try {
          await fsPatch(`tenants/${tid}/consignments/${p.id}`, {
            galleryId: { stringValue: galleryId },
            updatedAt: { timestampValue: nowIso }
          }, ['galleryId', 'updatedAt']);
          totalLinked++;
          console.log(`      ✓ linked placement ${p.id.slice(0, 14)} → gallery ${galleryId}`);
        } catch (e) {
          console.error(`      ✗ link failed for ${p.id}: ${e.message}`);
        }
      }
    }
  }

  if (rl) rl.close();
  console.log(`\nDone. groups=${totalGroups} created=${totalCreated} reused=${totalReused} placements_linked=${totalLinked} skipped=${totalSkipped}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
