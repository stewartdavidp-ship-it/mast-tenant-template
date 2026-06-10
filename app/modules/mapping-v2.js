/**
 * mapping-v2.js — Channel Mapping, V2 (queue archetype, standard-record-ui §10).
 *
 * The queue over channel_listings: every external listing pulled from a
 * connected channel, sliced by mapping state — To match (no product_listing_map
 * row, not ignored) / Matched / Ignored. Rows are WORK: the row action either
 * opens the match workspace (the listing's record SO with a product picker) or
 * unlinks/restores in place. Mirrors fulfillment-v2 (the queue exemplar).
 *
 * Writes delegate to window.MappingBridge (exposed in mapping.js — playbook §4,
 * never re-implement a write in the twin):
 *   confirmMapping  → confirmListingMapping CF (Drive projection + identity row)
 *   unlinkMapping   → deleteListingMapping CF (projection teardown first)
 *   setListingIgnored / restoreListing → closed-enum channel_listings updates
 * The first-connect guided wizard (auto/fuzzy match flow) stays single-sourced
 * on legacy — "Guided matching" loads mapping.js and opens the interstitial.
 *
 * Data (recon + sgtest15 shape audit 2026-06-10):
 *   channel_listings/{channel}_{externalId} — { _channel, _externalId, _ignored,
 *     _ignoredReason, normalized:{ title, price(cents), sku, status, photos } }
 *   product_listing_map/{channel}_{externalId} — { productId, confidence, … }
 *   public/products — titles for the picker + matched display.
 * Listing doc id === map doc id, so the queue join is set subtraction.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var CHANNEL_TONE = { shopify: 'teal', etsy: 'amber', square: 'info' };
  function channelLabel(ch) { ch = String(ch || ''); return ch ? ch.charAt(0).toUpperCase() + ch.slice(1) : '—'; }

  var IGNORE_REASON_LABEL = {
    'draft': 'Draft / not for sale',
    'test': 'Test listing',
    'retired': 'Retired product',
    'tenant-marked': 'Marked by you'
  };

  var BUCKETS = [['match', 'To match'], ['matched', 'Matched'], ['ignored', 'Ignored'], ['all', 'All']];

  var V2 = {
    rows: [], byId: {}, maps: {}, products: [], productsById: {},
    sortKey: 'title', sortDir: 'asc', bucket: 'match', loaded: false, busy: {}
  };

  function bucketOf(r) {
    if (r._ignored) return 'ignored';
    return V2.maps[r._key] ? 'matched' : 'match';
  }
  function mappedProduct(r) {
    var m = V2.maps[r._key];
    return m && m.productId ? (V2.productsById[m.productId] || null) : null;
  }
  function titleOf(r) { return (r.normalized && r.normalized.title) || r._externalId || r._key; }
  function priceOf(r) { return r.normalized ? r.normalized.price : null; }
  function skuOf(r) { return (r.normalized && r.normalized.sku) || ''; }

  function canEdit() { return typeof window.can !== 'function' || window.can('mapping', 'edit'); }
  function bridge() {
    // mapping.js is loaded by setup() before first render; guard anyway.
    return window.MappingBridge || null;
  }

  // ── schema — the listing record SO doubles as the match workspace ────
  MastEntity.define('mapping-v2', {
    label: 'Listing', labelPlural: 'Channel Mapping', size: 'md', route: 'mapping-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      { name: 'title', label: 'Listing', type: 'text', list: true, required: true, get: titleOf },
      { name: 'channel', label: 'Channel', type: 'status', list: true, readOnly: true,
        options: ['shopify', 'etsy', 'square'],
        get: function (r) { return r._channel || '—'; },
        tone: function (v) { return CHANNEL_TONE[v] || 'neutral'; } },
      { name: 'sku', label: 'SKU', type: 'text', list: true, readOnly: true, get: function (r) { return skuOf(r) || '—'; } },
      { name: 'price', label: 'Price', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { var p = priceOf(r); return p == null ? '—' : N.money(p, { cents: true }); } },
      { name: 'mapped', label: 'Mapped to', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (r) {
          if (r._ignored) return 'Ignored — ' + (IGNORE_REASON_LABEL[r._ignoredReason] || r._ignoredReason || '');
          var p = mappedProduct(r);
          var m = V2.maps[r._key];
          if (m) return p ? (p.title || p.name || m.productId) : m.productId;
          return '—';
        } }
    ],
    fetch: function (id) {
      if (V2.loaded && V2.byId[id]) return Promise.resolve(V2.byId[id]);
      // Cold drill (e.g. from an audit finding): the SO's matched/ignored
      // state and the product picker read V2.maps / V2.products — a bare doc
      // get would render every listing as "To match" with an empty picker.
      // Run the FULL load first, then fall back to a direct doc get for ids
      // outside the listing set.
      return ensureLoaded().then(function () {
        if (V2.byId[id]) return V2.byId[id];
        return Promise.resolve(MastDB.get('channel_listings/' + id)).then(function (r) {
          return r ? Object.assign({ _key: id }, r) : null;
        });
      });
    },
    detail: {
      render: function (UI, r) {
        var b = bucketOf(r);
        var m = V2.maps[r._key];
        var p = mappedProduct(r);
        var nz = r.normalized || {};
        var tiles = UI.tiles([
          { k: 'Channel', v: UI.badge(channelLabel(r._channel), CHANNEL_TONE[r._channel] || 'neutral'), hero: true },
          { k: 'Price', v: priceOf(r) == null ? '—' : N.money(priceOf(r), { cents: true }) },
          { k: 'Status', v: b === 'matched' ? UI.badge('Matched', 'success') : b === 'ignored' ? UI.badge('Ignored', 'neutral') : UI.badge('To match', 'amber') },
          { k: 'Listing state', v: esc(nz.status || '—') }
        ]);

        var listingCard = UI.card('Listing', UI.kv([
          { k: 'Title', v: esc(nz.title || '—') },
          { k: 'SKU', v: esc(nz.sku || '—') },
          { k: 'External ID', v: esc(r._externalId || '—') },
          { k: 'Stock', v: nz.stock == null ? '—' : N.count(nz.stock) },
          { k: 'Last synced', v: esc(r._lastSeenAt ? String(r._lastSeenAt).slice(0, 10) : '—') }
        ]));

        var mapCard;
        if (b === 'matched') {
          mapCard = UI.card('Mapped product', UI.kv([
            { k: 'Product', v: p ? MastEntity.drillLink('products-v2', m.productId, p.title || p.name || m.productId) : esc(m.productId) },
            { k: 'Confidence', v: esc((m.confidence || '—').replace(/-/g, ' ')) },
            { k: 'Mapped', v: esc(m.createdAt ? String(m.createdAt).slice(0, 10) : '—') }
          ]) + (canEdit()
            ? '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="MappingV2.unlink(\'' + esc(r._key) + '\')">Unlink mapping</button></div>'
            : ''));
        } else if (b === 'ignored') {
          mapCard = UI.card('Ignored', UI.kv([
            { k: 'Reason', v: esc(IGNORE_REASON_LABEL[r._ignoredReason] || r._ignoredReason || '—') }
          ]) + (canEdit()
            ? '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="MappingV2.restore(\'' + esc(r._key) + '\')">Restore to queue</button></div>'
            : ''));
        } else {
          var opts = V2.products.map(function (pr) {
            return '<option value="' + esc(pr.id) + '">' + esc(pr.title || pr.name || pr.id) + '</option>';
          }).join('');
          var ignoreOpts = Object.keys(IGNORE_REASON_LABEL).map(function (k) {
            return '<option value="' + esc(k) + '">' + esc(IGNORE_REASON_LABEL[k]) + '</option>';
          }).join('');
          mapCard = UI.card('Match to product', canEdit()
            ? '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
              '<select id="mpv2Product" class="form-input" style="flex:1;min-width:200px;"><option value="">Choose a product…</option>' + opts + '</select>' +
              '<button class="btn btn-primary" onclick="MappingV2.confirmMatch(\'' + esc(r._key) + '\')">Confirm match</button>' +
              '</div>' +
              '<div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">' +
              '<select id="mpv2IgnoreReason" class="form-input" style="flex:1;min-width:200px;">' + ignoreOpts + '</select>' +
              '<button class="btn btn-secondary" onclick="MappingV2.ignore(\'' + esc(r._key) + '\')">Ignore listing</button>' +
              '</div>' +
              '<div class="mu-sub" style="margin-top:10px;">Confirming maps the listing to the product — it does not change channel bindings or push inventory.</div>'
            : '<span class="mu-sub">You don’t have permission to match listings.</span>');
        }

        return tiles + listingCard + mapCard;
      }
      // No onSave → no Edit button: the SO's actions ARE the work; listing
      // content itself is channel-owned (synced), never edited here.
    }
  });

  // ── data ─────────────────────────────────────────────────────────────
  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var r = tree[k]; if (!r || typeof r !== 'object') return;
      out.push(Object.assign({ _key: k }, r));
    });
    return out;
  }
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (V2._loading) return V2._loading;
    V2._loading = loadCore().then(function () { V2._loading = null; });
    return V2._loading;
  }
  // load() always re-reads (post-write refresh); ensureLoaded() is the
  // run-once gate used by fetch() for cold drills.
  function load() { return loadCore(); }
  function loadCore() {
    return Promise.all([
      Promise.resolve(MastDB.get('channel_listings')),
      Promise.resolve(MastDB.get('product_listing_map')),
      Promise.resolve(MastDB.get('public/products'))
    ]).then(function (res) {
      V2.rows = toRows(res[0]);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.maps = {};
      Object.keys(res[1] || {}).forEach(function (k) {
        var m = res[1][k]; if (m && typeof m === 'object') V2.maps[k] = m;
      });
      V2.productsById = {};
      V2.products = toRows(res[2]).map(function (p) {
        var row = { id: p._key, title: p.title || p.name || p._key };
        V2.productsById[row.id] = row; return row;
      }).sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[mapping-v2] load', e); V2.loaded = true; render(); });
  }

  function counts() {
    var c = { all: V2.rows.length, match: 0, matched: 0, ignored: 0 };
    V2.rows.forEach(function (r) { c[bucketOf(r)]++; });
    return c;
  }
  function visibleRows() {
    var rows = V2.rows;
    if (V2.bucket !== 'all') rows = rows.filter(function (r) { return bucketOf(r) === V2.bucket; });
    return window.mastSortRows(rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('mapping-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('mappingV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'mappingV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Channel Mapping' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var c = counts();
    var pills = BUCKETS.map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="MappingV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      U.pageHeader({ title: 'Channel Mapping', count: N.count(c.match) + ' to match',
        actionsHtml: '<button class="btn btn-secondary" onclick="MappingV2.guided()">Guided matching ↗</button>' +
          '<button class="btn btn-secondary" onclick="MappingV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      MastEntity.renderList('mapping-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'MappingV2.sort', onRowClickFnName: 'MappingV2.open',
        empty: V2.bucket === 'match'
          ? { title: 'Everything is matched', message: 'New listings pulled from your channels land here until they’re matched to a product.' }
          : { title: 'Nothing here', message: 'No listings in this view.' }
      });
  }

  // ── actions (all via MappingBridge — RBAC-gated) ─────────────────────
  function withBridge(fn) {
    if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to do that', true); return; }
    var b = bridge();
    if (b) return fn(b);
    MastAdmin.loadModule('mapping').then(function () {
      var b2 = bridge();
      if (b2) fn(b2); else if (window.showToast) showToast('Mapping bridge unavailable', true);
    });
  }
  function refreshOpen(id) {
    load();
    var rec = V2.byId[id];
    // Re-read after load() resolves is async; re-open from the fresh cache-or-db.
    MastEntity.get('mapping-v2').fetch(id).then(function (r) {
      if (r) MastEntity.openRecord('mapping-v2', r, 'read', true);
    });
  }

  window.MappingV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setBucket: function (b) { V2.bucket = b; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('mapping-v2', rec, 'read'); },
    confirmMatch: function (id) {
      var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
      var sel = document.getElementById('mpv2Product');
      var pid = sel && sel.value;
      if (!pid) { if (window.showToast) showToast('Choose a product first', true); return; }
      withBridge(function (b) {
        V2.busy[id] = true;
        b.confirmMapping(pid, rec).then(function () {
          delete V2.busy[id];
          if (window.showToast) showToast('Matched to ' + ((V2.productsById[pid] || {}).title || 'product'));
          V2.maps[id] = { productId: pid, confidence: 'user-confirmed' };
          refreshOpen(id);
        }).catch(function (e) {
          delete V2.busy[id];
          console.error('[mapping-v2] confirm', e);
          if (window.showToast) showToast('Could not match: ' + (e && e.message || e), true);
        });
      });
    },
    unlink: function (id) {
      var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
      var go = function () {
        withBridge(function (b) {
          V2.busy[id] = true;
          b.unlinkMapping(id).then(function () {
            delete V2.busy[id];
            delete V2.maps[id];
            if (window.showToast) showToast('Unlinked');
            refreshOpen(id);
          }).catch(function (e) {
            delete V2.busy[id];
            console.error('[mapping-v2] unlink', e);
            if (window.showToast) showToast('Could not unlink: ' + (e && e.message || e), true);
          });
        });
      };
      mastConfirm('Unlink this listing from its product? Channel bindings tied to the mapping are torn down.', { title: 'Unlink mapping', confirmLabel: 'Unlink', danger: true })
        .then(function (ok) { if (ok) go(); });
    },
    ignore: function (id) {
      var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
      var sel = document.getElementById('mpv2IgnoreReason');
      var reason = sel && sel.value;
      withBridge(function (b) {
        V2.busy[id] = true;
        b.setListingIgnored(id, reason).then(function () {
          delete V2.busy[id];
          if (window.showToast) showToast('Ignored — it won’t be re-prompted');
          rec._ignored = true; rec._ignoredReason = reason;
          refreshOpen(id);
        }).catch(function (e) {
          delete V2.busy[id];
          console.error('[mapping-v2] ignore', e);
          if (window.showToast) showToast('Could not ignore: ' + (e && e.message || e), true);
        });
      });
    },
    restore: function (id) {
      var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
      withBridge(function (b) {
        V2.busy[id] = true;
        b.restoreListing(id).then(function () {
          delete V2.busy[id];
          if (window.showToast) showToast('Restored to the match queue');
          rec._ignored = false; rec._ignoredReason = null;
          refreshOpen(id);
        }).catch(function (e) {
          delete V2.busy[id];
          console.error('[mapping-v2] restore', e);
          if (window.showToast) showToast('Could not restore: ' + (e && e.message || e), true);
        });
      });
    },
    guided: function () {
      // The auto/fuzzy first-connect wizard stays single-sourced on legacy.
      MastAdmin.loadModule('mapping').then(function () {
        if (window.MastMappingFlow) MastMappingFlow.open();
      });
    },
    exportCsv: function () { return MastEntity.exportRows('mapping-v2', visibleRows(), V2.bucket); }
  };

  MastAdmin.registerModule('mapping-v2', {
    routes: { 'mapping-v2': { tab: 'mappingV2Tab', setup: function () {
      ensureTab();
      // Bridge module first so actions are ready; render doesn't wait on it.
      MastAdmin.loadModule('mapping').catch(function () {});
      render(); load();
    } } }
  });
})();
