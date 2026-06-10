/**
 * lookbooks-v2.js — Look Books, V2 (composer archetype, standard-record-ui §10).
 *
 * The composer produces an ARTIFACT: a branded line-sheet / lookbook PDF built
 * from the product catalog (generateLookbook CF — the PDF engine is untouched).
 * V2 model:
 *   • the PAGE is the document list (title, type, tier, status, generated);
 *   • row click opens the document slide-out — read shows the setup + PDF link
 *     + recent opens; Edit is the composer form (type, tier, categories,
 *     exclusions, header/footer);
 *   • Generate is a row/SO action: save → CF → doc updated with signed URL.
 *
 * TEMP-LINK DEBT (tracked in sales-v2-build-plan.md): share-link minting
 * (mintLookbookShareToken + email) stays on the classic screen.
 *
 * Flag-gated (`uiRedesign`), side-by-side route `#lookbooks-v2`.
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

  var U = window.MastUI, esc = U._esc;

  var V2 = { rows: [], byId: {}, loaded: false, sortKey: 'updatedAt', sortDir: 'desc', busy: {}, catalog: null };

  function canEdit() {
    return typeof window.can !== 'function' || window.can('lookbooks', 'edit');
  }
  function typeLabel(t) { return t === 'lookbook' ? 'Lookbook' : 'Line sheet'; }
  function tierLabel(t) { return ({ wholesale: 'Wholesale', direct: 'Direct', retail: 'Retail' })[t] || t || '—'; }
  function urlLive(r) {
    return !!(r.generatedUrl && (!r.urlExpiresAt || new Date(r.urlExpiresAt).getTime() > Date.now()));
  }
  function categoriesOf() {
    // Catalog source: our own fetch (V2.catalog, loaded in load()) — falls back
    // to window.productsData when another surface already populated it.
    var cats = {}, pd = V2.catalog || window.productsData || {};
    Object.keys(pd).forEach(function (pid) {
      var p = pd[pid]; if (!p || p.status === 'archived') return;
      (p.categories || (p.category ? [p.category] : [])).forEach(function (c) { if (c) cats[c] = 1; });
    });
    return Object.keys(cats).sort();
  }

  MastEntity.define('lookbooks-v2', {
    label: 'Document', labelPlural: 'Look Books', size: 'lg', route: 'lookbooks-v2',
    recordId: function (r) { return r._key || r.documentId; },
    fields: [
      { name: 'title', label: 'Title', type: 'text', list: true, required: true },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true,
        get: function (r) { return typeLabel(r.type); } },
      { name: 'priceTier', label: 'Prices', type: 'text', list: true, readOnly: true,
        get: function (r) { return r.showPrices === false ? 'Hidden' : tierLabel(r.priceTier); } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        get: function (r) { return r.status === 'generated' ? 'Generated' : 'Draft'; },
        tone: function (v) { return String(v).toLowerCase() === 'generated' ? 'success' : 'amber'; } },
      { name: 'generatedAt', label: 'Generated', type: 'date', list: true, readOnly: true },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true }
    ],
    fetch: function (id) {
      return Promise.resolve(MastDB.lookbooks.get(id)).then(function (r) {
        return r ? Object.assign({ _key: id }, r) : null;
      });
    },
    detail: {
      render: function (UI, r) {
        var setup = UI.kv([
          { k: 'Type', v: esc(typeLabel(r.type)) },
          { k: 'Price tier', v: r.showPrices === false ? 'Prices hidden' : esc(tierLabel(r.priceTier)) },
          { k: 'Categories', v: (r.includeCategories && r.includeCategories.length) ? esc(r.includeCategories.join(', ')) : 'All categories' },
          { k: 'Excluded products', v: (r.excludeProductIds && r.excludeProductIds.length) ? (r.excludeProductIds.length + ' excluded') : 'None' },
          { k: 'Header', v: r.headerText ? esc(r.headerText) : '—' },
          { k: 'Footer', v: r.footerText ? esc(r.footerText) : '—' }
        ]);
        var pdf;
        if (urlLive(r)) {
          pdf = '<div style="font-size:0.9rem;color:var(--text-primary);">Generated ' + (r.generatedAt ? UI.Num.date(r.generatedAt) : '') + '.</div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
              '<a class="btn btn-primary" href="' + esc(r.generatedUrl) + '" target="_blank" rel="noopener">View PDF ↗</a>' +
              (canEdit() ? '<button class="btn btn-secondary" onclick="LookbooksV2.generate(\'' + esc(r._key) + '\')">Re-generate</button>' : '') +
            '</div>' +
            (r.urlExpiresAt ? '<div class="mu-sub" style="margin-top:8px;">Link expires ' + UI.Num.date(r.urlExpiresAt) + '.</div>' : '');
        } else {
          pdf = '<div class="mu-sub">' + (r.generatedUrl ? 'The previous link has expired.' : 'No PDF generated yet.') + '</div>' +
            (canEdit() ? '<div style="margin-top:10px;"><button class="btn btn-primary" onclick="LookbooksV2.generate(\'' + esc(r._key) + '\')">Generate PDF</button></div>' : '');
        }
        return UI.card('Setup', setup) + UI.card('PDF', pdf, { fill: true }) +
          '<div class="mu-sub" style="margin-top:10px;">Share links + open tracking are on the <a href="#" onclick="LookbooksV2.classic();return false;">classic Look Books view</a> for now.</div>';
      },
      editRender: function (r) {
        r = r || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var typeOpts = [['linesheet', 'Line sheet'], ['lookbook', 'Lookbook']].map(function (o) {
          return '<option value="' + o[0] + '"' + ((r.type || 'linesheet') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        var tierOpts = [['wholesale', 'Wholesale'], ['direct', 'Direct'], ['retail', 'Retail']].map(function (o) {
          return '<option value="' + o[0] + '"' + ((r.priceTier || 'wholesale') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        var inc = r.includeCategories || [];
        var cats = categoriesOf().map(function (c) {
          var on = inc.indexOf(c) !== -1;
          return '<label style="display:inline-flex;align-items:center;gap:6px;margin:0 12px 8px 0;font-size:0.85rem;cursor:pointer;">' +
            '<input type="checkbox" class="lbv2-cat" value="' + esc(c) + '"' + (on ? ' checked' : '') + '> ' + esc(c) + '</label>';
        }).join('') || '<span class="mu-sub">No product categories found.</span>';
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>' + (r._key ? 'Document' : 'New document') + '</div>' +
          fg('Title', '<input class="form-input" id="lbv2Title" value="' + esc(r.title || '') + '" placeholder="Spring 2026 Line Sheet" style="width:100%;">') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            '<div class="form-group" style="flex:1;min-width:150px;"><label class="form-label">Type</label><select class="form-input" id="lbv2Type" style="width:100%;">' + typeOpts + '</select></div>' +
            '<div class="form-group" style="flex:1;min-width:150px;"><label class="form-label">Price tier</label><select class="form-input" id="lbv2Tier" style="width:100%;">' + tierOpts + '</select></div>' +
          '</div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
            '<input type="checkbox" id="lbv2ShowPrices"' + (r.showPrices !== false ? ' checked' : '') + '> Show prices</label>' +
          fg('Categories (none checked = all)', '<div id="lbv2Cats">' + cats + '</div>') +
          fg('Header text', '<input class="form-input" id="lbv2Header" value="' + esc(r.headerText || '') + '" placeholder="Brand name / tagline" style="width:100%;">') +
          fg('Footer text', '<input class="form-input" id="lbv2Footer" value="' + esc(r.footerText || '') + '" placeholder="Contact info / how to order" style="width:100%;">') +
          '<div class="mu-sub">Per-product exclusions are on the <a href="#" onclick="LookbooksV2.classic();return false;">classic view</a> for now; existing exclusions are preserved.</div>';
      }
    },
    onSave: function (rec) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit look books.', true); return false; }
      var id = rec._key || rec.documentId;
      var row = id && V2.byId[id];
      var title = (document.getElementById('lbv2Title') || {}).value || '';
      if (!String(title).trim()) { if (window.showToast) showToast('Title is required', true); return false; }
      var inc = [];
      document.querySelectorAll('#lbv2Cats .lbv2-cat:checked').forEach(function (cb) { inc.push(cb.value); });
      var now = new Date().toISOString();
      var patch = {
        title: String(title).trim(),
        type: (document.getElementById('lbv2Type') || {}).value || 'linesheet',
        priceTier: (document.getElementById('lbv2Tier') || {}).value || 'wholesale',
        showPrices: !!(document.getElementById('lbv2ShowPrices') || {}).checked,
        includeCategories: inc,
        headerText: (document.getElementById('lbv2Header') || {}).value || '',
        footerText: (document.getElementById('lbv2Footer') || {}).value || '',
        updatedAt: now
      };
      return Promise.resolve(MastDB.lookbooks.update(id, patch)).then(function () {
        if (row) Object.assign(row, patch);
        if (window.writeAudit) writeAudit('update', 'lookbook', id);
        render();
        return true;
      }).catch(function (e) { console.error('[lookbooks-v2] save', e); if (window.showToast) showToast('Save failed', true); return false; });
    }
  });

  function toRows(tree) {
    return Object.keys(tree || {}).map(function (k) {
      return Object.assign({ _key: k }, tree[k] || {});
    });
  }
  function load() {
    Promise.resolve(MastDB.lookbooks.list()).then(function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[lookbooks-v2] load', e); V2.loaded = true; render(); });
    // Composer needs the catalog for the category picker — fetch it directly
    // (there is no 'products' module key; the prior loadModule('products') threw
    // an unhandled 'Unknown module' rejection on every route entry).
    if (!V2.catalog && window.MastDB && MastDB.products && typeof MastDB.products.list === 'function') {
      Promise.resolve(MastDB.products.list()).then(function (all) {
        V2.catalog = all || {};
      }).catch(function (e) { console.error('[lookbooks-v2] catalog', e); });
    }
  }

  function visibleRows() {
    return window.mastSortRows(V2.rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('lookbooks-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function columns() {
    var s = MastEntity.get('lookbooks-v2');
    var cols = s.fields.filter(function (f) { return f.list; }).map(function (f) {
      return { key: f.name, label: f.label, render: function (r) {
        var v = f.get ? f.get(r) : r[f.name];
        if (f.type === 'status') return U.badge(v, f.tone ? f.tone(v) : 'neutral');
        if (f.type === 'date') return v ? U.Num.date(v) : '—';
        return esc(v == null || v === '' ? '—' : v);
      } };
    });
    cols.push({ key: '_gen', label: '', sortable: false, align: 'right', render: function (r) {
      if (!canEdit()) return '';
      var busy = V2.busy[r._key];
      var label = busy ? '…' : (urlLive(r) ? 'Re-generate' : 'Generate PDF');
      var view = urlLive(r) ? '<a class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;margin-right:6px;" href="' + esc(r.generatedUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();">View ↗</a>' : '';
      return view + '<button class="btn btn-primary" ' + (busy ? 'disabled ' : '') +
        'style="font-size:0.78rem;padding:4px 10px;white-space:nowrap;" ' +
        'onclick="event.stopPropagation();LookbooksV2.generate(\'' + esc(r._key) + '\')">' + label + '</button>';
    } });
    return cols;
  }

  function ensureTab() {
    var el = document.getElementById('lookbooksV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lookbooksV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Look Books', subtitle: 'Branded line sheets & lookbooks from your catalog' }) +
        '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Look Books</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + U.Num.count(V2.rows.length) + ' documents</span>' +
        (canEdit() ? '<button class="btn btn-primary" style="margin-left:auto;" onclick="LookbooksV2.newDoc()">+ New line sheet</button>' : '') +
      '</div>' +
      '<div style="margin:14px 0;"></div>' +
      window.MastEntity.renderList('lookbooks-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'LookbooksV2.sort', onRowClickFnName: 'LookbooksV2.open',
        empty: { title: 'No documents yet', message: 'Create a line sheet to share your catalog with buyers.' }
      });
  }

  window.LookbooksV2 = {
    sort: function (key) {
      if (key === '_gen') return;
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      window.MastEntity.openRecord('lookbooks-v2', rec, 'read');
    },
    newDoc: function () {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit look books.', true); return; }
      var id = MastDB.lookbooks.newKey();
      var now = new Date().toISOString();
      var doc = { documentId: id, type: 'linesheet', title: '', priceTier: 'wholesale',
        includeCategories: [], excludeProductIds: [], showPrices: true, headerText: '', footerText: '',
        generatedAt: null, generatedUrl: null, urlExpiresAt: null, status: 'draft', createdAt: now, updatedAt: now };
      Promise.resolve(MastDB.lookbooks.set(id, doc)).then(function () {
        var row = Object.assign({ _key: id }, doc);
        V2.rows.push(row); V2.byId[id] = row;
        if (window.writeAudit) writeAudit('create', 'lookbook', id);
        render();
        window.MastEntity.openRecord('lookbooks-v2', row, 'edit');
      }).catch(function (e) { console.error('[lookbooks-v2] newDoc', e); if (window.showToast) showToast('Failed to create document', true); });
    },
    // Same CF + doc-update contract as legacy generatePDF() (lookbooks.js).
    generate: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to generate look books.', true); return; }
      var row = V2.byId[id]; if (!row || V2.busy[id]) return;
      if (!String(row.title || '').trim()) { if (window.showToast) showToast('Give the document a title first.', true); return; }
      V2.busy[id] = true; render();
      var done = function () { delete V2.busy[id]; render(); };
      var authObj = (typeof auth !== 'undefined' && auth) || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth());
      Promise.resolve(authObj && authObj.currentUser ? authObj.currentUser.getIdToken() : Promise.reject(new Error('Not signed in')))
        .then(function (token) {
          return callCF('/generateLookbook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ documentId: id })
          });
        })
        .then(function (resp) { if (!resp.ok) throw new Error('Generation failed'); return resp.json(); })
        .then(function (result) {
          if (!result.success) throw new Error(result.error || 'Generation failed');
          var now = new Date().toISOString();
          var patch = { generatedAt: now, generatedUrl: result.url, urlExpiresAt: result.urlExpiresAt || null, status: 'generated', updatedAt: now };
          return Promise.resolve(MastDB.lookbooks.update(id, patch)).then(function () {
            Object.assign(row, patch);
            if (window.showToast) showToast('PDF generated.');
            done();
          });
        })
        .catch(function (e) {
          console.error('[lookbooks-v2] generate', e);
          if (window.showToast) showToast('Failed to generate PDF: ' + (e && e.message || e), true);
          done();
        });
    },
    classic: function () { if (window.navigateToClassic) navigateToClassic('lookbooks'); },
    refresh: render
  };

  MastAdmin.registerModule('lookbooks-v2', {
    routes: { 'lookbooks-v2': { tab: 'lookbooksV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
