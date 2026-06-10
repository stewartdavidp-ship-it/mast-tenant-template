#!/usr/bin/env node
/**
 * scaffold-v2-module.mjs — generate a V2 module skeleton + wire index.html
 * (v2-conversion-playbook.md §4).
 *
 *   node scripts/scaffold-v2-module.mjs <legacyRoute> <archetype> [--label "Display Name"]
 *
 *   <legacyRoute>  e.g. 'blog' → creates app/modules/blog-v2.js, route 'blog-v2'
 *   <archetype>    record | queue   (transaction/composer start from record and
 *                  add detail.template/'flow' or a custom surface by hand —
 *                  see standard-record-ui.md §10)
 *
 * Wires automatically (fails loudly if an anchor is missing):
 *   1. MODULE_MANIFEST entry        (before the workflowEngine entry)
 *   2. tab container div            (after ordersV2Tab)
 *   3. MAST_V2_ROUTE_MAP entry      (before the closing brace)
 * Prints the remaining manual steps (registry entry, RBAC, data accessor).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , route, archetype] = process.argv;
const labelIx = process.argv.indexOf('--label');
const label = labelIx > 0 ? process.argv[labelIx + 1] : null;

if (!route || !['record', 'queue'].includes(archetype || '')) {
  console.error('usage: node scripts/scaffold-v2-module.mjs <legacyRoute> record|queue [--label "Name"]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(route)) {
  console.error('legacyRoute must be kebab-case');
  process.exit(1);
}

const v2route = route + '-v2';
const fileName = v2route + '.js';
const filePath = path.join(ROOT, 'app', 'modules', fileName);
if (fs.existsSync(filePath)) {
  console.error(filePath + ' already exists');
  process.exit(1);
}
const display = label || route.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
// galleriesV2Tab-style id + GalleriesV2-style global
const camel = route.split('-').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
const tabId = camel + 'V2Tab';
const globalName = route.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('') + 'V2';

const moduleSrc = `/**
 * ${fileName} — ${display}, V2 (${archetype} archetype, standard-record-ui §10).
 *
 * Scaffolded by scripts/scaffold-v2-module.mjs — flesh out the TODOs, then:
 *   • registry entry in app/data/mode-module-info.js (outcome ≤120ch)
 *   • RBAC-gate every write with can('${route}','edit'|'delete')
 *   • bash scripts/ship-check.sh before the PR
 * Flag-gated (?ui=1) at #${v2route}, side-by-side with legacy #${route}.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var V2 = { rows: [], byId: {}, sortKey: 'updatedAt', sortDir: 'desc', loaded: false };

  // TODO: point at the real data accessor (shared/mastdb.js) — and add a
  // SINGLETON_COLLECTIONS entry if this is an admin/<x> config doc.
  MastEntity.define('${v2route}', {
    label: '${display}', labelPlural: '${display}', size: 'lg', route: '${v2route}',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      { name: 'name', label: 'Name', type: 'text', list: true, required: true },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true }
      // TODO: real fields. status fields get tone(); money via N.moneyVal.
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      // Cache-miss fallback keeps cross-record drills working cold.
      return Promise.resolve(MastDB.get('admin/${route}/' + id)).then(function (r) {
        return r ? Object.assign({ _key: id }, r) : null;
      });
    },
    detail: {
      render: function (UI, r) {
        // TODO: read view — tiles + kv/cards. Lifecycle? use detail.flow
        // (guided header is the default; load workflowEngine BEFORE the spec).
        return UI.card('${display}', UI.kv([{ k: 'Name', v: esc(r.name || '—') }]));
      }
      // TODO (write): editRender + onSave (RBAC-gated). NOTE: onSave surfaces
      // an Edit button on every read SO — for create-only intake on a
      // read-only record, define a SEPARATE create-only entity instead
      // (commission-intake-v2 pattern).
    }
  });

  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var r = tree[k]; if (!r || typeof r !== 'object') return;
      out.push(Object.assign({ _key: k }, r));
    });
    return out;
  }
  function load() {
    Promise.resolve(MastDB.get('admin/${route}')).then(function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[${v2route}] load', e); V2.loaded = true; render(); });
  }
  function visibleRows() {
    return window.mastSortRows(V2.rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('${v2route}').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }
  function ensureTab() {
    var el = document.getElementById('${tabId}');
    if (el) return el;
    el = document.createElement('div');
    el.id = '${tabId}'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: '${display}' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    tab.innerHTML =
      U.pageHeader({ title: '${display}', count: N.count(V2.rows.length) + ' records',
        actionsHtml: '<button class="btn btn-secondary" onclick="${globalName}.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;"></div>' +
      MastEntity.renderList('${v2route}', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: '${globalName}.sort', onRowClickFnName: '${globalName}.open',
        empty: { title: 'Nothing here yet', message: 'TODO: empty-state copy.' }
      });
  }

  window.${globalName} = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    open: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('${v2route}', rec, 'read'); },
    exportCsv: function () { return MastEntity.exportRows('${v2route}', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('${v2route}', {
    routes: { '${v2route}': { tab: '${tabId}', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
`;

// ── wire index.html ──
const indexPath = path.join(ROOT, 'app', 'index.html');
let idx = fs.readFileSync(indexPath, 'utf8');

const manifestAnchor = '  workflowEngine: { src: ';
if (!idx.includes(manifestAnchor)) { console.error('MODULE_MANIFEST anchor missing'); process.exit(1); }
idx = idx.replace(manifestAnchor,
  `  '${v2route}': { src: 'modules/${fileName}', routes: ['${v2route}'] }, // ${archetype} archetype (scaffolded; flag-gated, side-by-side)\n` + manifestAnchor);

const tabAnchor = '<div id="ordersV2Tab" class="tab-content" style="display:none;"></div>';
if (!idx.includes(tabAnchor)) { console.error('tab-container anchor missing'); process.exit(1); }
idx = idx.replace(tabAnchor, tabAnchor + `\n    <div id="${tabId}" class="tab-content" style="display:none;"></div><!-- ${v2route} (scaffolded) -->`);

const mapMatch = idx.match(/var MAST_V2_ROUTE_MAP = \{[\s\S]*?\n\};/);
if (!mapMatch) { console.error('MAST_V2_ROUTE_MAP anchor missing'); process.exit(1); }
idx = idx.replace(mapMatch[0], mapMatch[0].replace(/\n\};$/, `,\n  '${route}': '${v2route}'\n};`));

fs.writeFileSync(filePath, moduleSrc);
fs.writeFileSync(indexPath, idx);

console.log('created  app/modules/' + fileName);
console.log('wired    MODULE_MANIFEST + #' + tabId + ' + MAST_V2_ROUTE_MAP (' + route + ' → ' + v2route + ')');
console.log('\nRemaining manual steps:');
console.log('  1. Real data accessor + fields + detail (TODOs in the file)');
console.log('  2. Registry entry in app/data/mode-module-info.js if the route lacks one');
console.log('  3. RBAC can(\'' + route + '\',…) on any write');
console.log('  4. bash scripts/ship-check.sh');
