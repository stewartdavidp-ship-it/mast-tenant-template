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
 *   • Share is a detail-SO action: a native modal mints a tokenized share link
 *     (mintLookbookShareToken CF), optionally emails it to a buyer, copies the
 *     link, and shows the open-tracking summary (admin/lookbook_share_opens
 *     joined to admin/lookbook_share_tokens by jti for recipient labels).
 *
 * NOTE (cross-repo, gated): the recipient-facing viewer (lookbook-view.html →
 * getLookbookByToken CF) currently reads a never-written `pdfUrl` field and
 * returns a 7-day signed URL for a 30-day token — so a shared link does not
 * render the PDF until that mast-architecture CF is fixed (field → generatedUrl
 * + re-sign on demand). Minting / email / open-tracking all work here today.
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

  // ── Share / exclusions helpers ──────────────────────────────────────────
  // Per-lookbook cache of recent open rows: { lookbookId: [openRow, ...] }.
  var shareOpensCache = {};

  function catalogMap() { return V2.catalog || window.productsData || {}; }
  function prodName(pid) { var p = catalogMap()[pid]; return (p && (p.name || p.title)) || pid; }

  function exChipHtml(pid) {
    return '<span class="lbv2-exchip" data-pid="' + esc(pid) + '" style="display:inline-flex;align-items:center;gap:6px;background:var(--cream-dark);border-radius:14px;padding:3px 10px;margin:0 6px 6px 0;font-size:0.85rem;">' +
      esc(prodName(pid)) +
      '<button type="button" title="Remove" onclick="LookbooksV2.removeExclusion(this,\'' + esc(pid) + '\')" style="border:none;background:none;cursor:pointer;color:var(--warm-gray);font-size:0.9rem;line-height:1;padding:0;">&times;</button></span>';
  }

  function _agoLabel(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '';
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }

  // Reads open events + token rows, joins them by jti (open events do NOT carry
  // the recipient — that lives on the token row), filters to this lookbook +
  // last 30 days, then re-renders #lbv2OpensPanel. Degrades gracefully.
  function loadShareOpens(id) {
    function panel() { return document.getElementById('lbv2OpensPanel'); }
    Promise.all([
      Promise.resolve(MastDB.get('admin/lookbook_share_opens')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/lookbook_share_tokens')).catch(function () { return null; })
    ]).then(function (arr) {
      var opensMap = arr[0] || {}, tokMap = arr[1] || {};
      var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      var rows = Object.keys(opensMap).map(function (k) { var o = opensMap[k] || {}; o._id = k; return o; })
        .filter(function (o) {
          if (o.lookbookId !== id) return false;
          var t = o.openedAt ? new Date(o.openedAt).getTime() : 0;
          return t >= cutoff;
        })
        .sort(function (a, b) { return String(b.openedAt || '').localeCompare(String(a.openedAt || '')); });
      rows.forEach(function (o) {
        var tok = (o.jti && tokMap[o.jti]) || null;
        o._recipientName = (tok && tok.recipientName) || '';
        o._recipientEmail = (tok && tok.recipientEmail) || '';
      });
      shareOpensCache[id] = rows.slice(0, 50);
      var el = panel(); if (el) el.innerHTML = renderOpensInner(id);
    }).catch(function () {
      var el = panel(); if (el) el.innerHTML = '<div class="mu-sub">Open tracking is unavailable right now.</div>';
    });
  }

  function renderOpensInner(id) {
    var rows = shareOpensCache[id];
    if (!rows) return '<div class="mu-sub">Loading opens…</div>';
    if (!rows.length) return '<div class="mu-sub">No opens tracked yet. Opens appear here after a buyer views the link.</div>';
    var head = '<div class="mu-sub" style="margin-bottom:6px;">' + rows.length + (rows.length === 1 ? ' open' : ' opens') +
      (rows[0].openedAt ? ' · last ' + esc(_agoLabel(rows[0].openedAt)) : '') + '</div>';
    var body = '<table class="data-table" style="width:100%;font-size:0.85rem;"><thead><tr><th>When</th><th>Recipient</th><th>Email</th></tr></thead><tbody>';
    rows.forEach(function (o) {
      var when = o.openedAt ? MastFormat.dateTime(o.openedAt) : '—';
      body += '<tr><td>' + esc(when) + ' <span class="mu-sub" style="font-size:0.72rem;">(' + esc(_agoLabel(o.openedAt)) + ')</span></td>' +
        '<td>' + esc(o._recipientName || '—') + '</td><td>' + esc(o._recipientEmail || '—') + '</td></tr>';
    });
    return head + body + '</tbody></table>';
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
        var share;
        if (urlLive(r)) {
          share = '<div class="mu-sub">Send a private, tokenized link to a buyer and see when they open it. Links work for 30 days.</div>' +
            (canEdit()
              ? '<div style="margin-top:10px;"><button class="btn btn-primary" onclick="LookbooksV2.share(\'' + esc(r._key) + '\')">Share with a buyer…</button></div>'
              : '<div class="mu-sub" style="margin-top:8px;">You do not have permission to share.</div>');
        } else {
          share = '<div class="mu-sub">Generate the PDF first — then you can share a tokenized link with buyers.</div>';
        }
        return UI.card('Setup', setup) + UI.card('PDF', pdf, { fill: true }) + UI.card('Share', share);
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
        var exIds = (r.excludeProductIds || []).slice();
        var cat = catalogMap();
        var exChips = exIds.map(exChipHtml).join('');
        var exOpts = Object.keys(cat).filter(function (pid) {
          var p = cat[pid]; if (!p || p.status === 'archived') return false;
          return exIds.indexOf(pid) === -1;
        }).sort(function (a, b) { return String(prodName(a)).localeCompare(String(prodName(b))); })
          .map(function (pid) { return '<option value="' + esc(pid) + '">' + esc(prodName(pid)) + '</option>'; }).join('');
        var exEditor =
          '<div id="lbv2Excluded" style="margin-bottom:6px;">' + exChips + '</div>' +
          '<div class="mu-sub" id="lbv2ExNone" style="margin-bottom:8px;' + (exIds.length ? 'display:none;' : '') + '">No products excluded.</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<select class="form-input" id="lbv2ExcludeSelect" style="flex:1;min-width:200px;"><option value="">Add a product to exclude…</option>' + exOpts + '</select>' +
            '<button type="button" class="btn btn-secondary" onclick="LookbooksV2.addExclusion()">Add</button>' +
          '</div>';
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
          fg('Exclude products (optional)', exEditor);
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
      var exclude = [];
      document.querySelectorAll('#lbv2Excluded .lbv2-exchip').forEach(function (chip) {
        var pid = chip.getAttribute('data-pid'); if (pid) exclude.push(pid);
      });
      var now = new Date().toISOString();
      var patch = {
        title: String(title).trim(),
        type: (document.getElementById('lbv2Type') || {}).value || 'linesheet',
        priceTier: (document.getElementById('lbv2Tier') || {}).value || 'wholesale',
        showPrices: !!(document.getElementById('lbv2ShowPrices') || {}).checked,
        includeCategories: inc,
        excludeProductIds: exclude,
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
        'onclick="event.stopPropagation();LookbooksV2.generate(\'' + esc(r._key) + '\')">' + label + '</button>' +
        ' <a href="#" onclick="event.preventDefault();event.stopPropagation();LookbooksV2.remove(\'' + esc(r._key) + '\')" ' +
        'style="color:var(--warm-gray);font-size:0.78rem;text-decoration:underline;margin-left:6px;">delete</a>';
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
      U.pageHeader({ title: 'Look Books', count: U.Num.count(V2.rows.length) + ' documents',
        actionsHtml: (canEdit() ? '<button class="btn btn-primary" onclick="LookbooksV2.newDoc()">+ New line sheet</button>' : '') }) +
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
    // Delete with the legacy PDF cascade (storage orphan = wholesale-pricing
    // data-leak hazard — see consignment of lookbooks.js deleteDocument).
    remove: function (id) {
      if (typeof window.can === 'function' && !window.can('lookbooks', 'delete') && !window.can('lookbooks', 'edit')) {
        if (window.showToast) showToast('You do not have permission to delete look books.', true);
        return;
      }
      var row = V2.byId[id]; if (!row) return;
      var msg = 'Delete "' + (row.title || 'this document') + '"?' + (row.generatedUrl ? ' Its public PDF link will stop working.' : '') + ' This cannot be undone.';
      Promise.resolve(typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Delete document', danger: true, confirmLabel: 'Delete' }) : true).then(function (ok) {
        if (!ok) return;
        var cascade = Promise.resolve();
        try {
          if (typeof storage !== 'undefined' && storage && MastDB.storagePath) {
            cascade = Promise.resolve(storage.ref(MastDB.storagePath('lookbooks/' + id + '.pdf')).delete()).catch(function (err) {
              var notFound = err && (err.code === 'storage/object-not-found' || /not.?found/i.test(err.message || ''));
              if (!notFound) console.warn('[lookbooks-v2] PDF cascade-delete failed:', err);
            });
          }
        } catch (e) {}
        cascade.then(function () { return MastDB.lookbooks.remove(id); }).then(function () {
          if (window.writeAudit) writeAudit('delete', 'lookbook', id);
          if (window.showToast) showToast('Document deleted.');
          V2.rows = V2.rows.filter(function (r) { return r._key !== id; });
          delete V2.byId[id];
          render();
        }).catch(function (e) {
          console.error('[lookbooks-v2] delete', e);
          if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true);
        });
      });
    },
    // ── Share with a buyer ───────────────────────────────────────────────
    // Native modal (replaces the classic escape hatch): mint a tokenized share
    // link via mintLookbookShareToken (onCall CF — same surface the classic
    // view used), optionally email it, copy it, and show the open-tracking
    // summary. The mint is a write → gated on canEdit() + writeAudit.
    share: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to share look books.', true); return; }
      var r = V2.byId[id]; if (!r) return;
      if (!urlLive(r)) { if (window.showToast) showToast('Generate the PDF first before sharing.', true); return; }
      if (typeof window.openModal !== 'function') { if (window.showToast) showToast('Unable to open the share dialog.', true); return; }
      var html =
        '<div style="max-width:520px;padding:24px;">' +
          '<h3 style="margin:0 0 4px;">Share &ldquo;' + esc(r.title || 'Untitled') + '&rdquo; with a buyer</h3>' +
          '<div class="mu-sub" style="margin-bottom:16px;">Creates a private link (valid 30 days). Opens are tracked below.</div>' +
          '<div class="form-group"><label class="form-label">Buyer name</label>' +
            '<input class="form-input" id="lbv2ShareName" placeholder="e.g. Anna Wilson" autocomplete="off" style="width:100%;"></div>' +
          '<div class="form-group"><label class="form-label">Buyer email</label>' +
            '<input class="form-input" id="lbv2ShareEmail" type="email" placeholder="buyer@example.com" autocomplete="off" style="width:100%;"></div>' +
          '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
            '<input type="checkbox" id="lbv2ShareSend" checked> Email this link to the buyer</label>' +
          '<div id="lbv2ShareStatus" style="margin-top:8px;font-size:0.85rem;"></div>' +
          '<div id="lbv2ShareResult" style="margin-top:12px;display:none;"></div>' +
          '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
            '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
            '<button class="btn btn-primary" id="lbv2ShareGo" onclick="LookbooksV2.generateShare(\'' + esc(id) + '\')">Generate share link</button>' +
          '</div>' +
          '<div style="margin-top:20px;border-top:1px solid var(--cream-dark);padding-top:14px;">' +
            '<div style="font-weight:500;margin-bottom:8px;">Opens (last 30 days)</div>' +
            '<div id="lbv2OpensPanel"><div class="mu-sub">Loading opens…</div></div>' +
          '</div>' +
        '</div>';
      window.openModal(html);
      loadShareOpens(id);
    },
    generateShare: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to share look books.', true); return; }
      var r = V2.byId[id]; if (!r) return;
      var nameEl = document.getElementById('lbv2ShareName');
      var emailEl = document.getElementById('lbv2ShareEmail');
      var sendEl = document.getElementById('lbv2ShareSend');
      var statusEl = document.getElementById('lbv2ShareStatus');
      var resultEl = document.getElementById('lbv2ShareResult');
      var btn = document.getElementById('lbv2ShareGo');
      var name = ((nameEl && nameEl.value) || '').trim();
      var email = ((emailEl && emailEl.value) || '').trim();
      var send = !!(sendEl && sendEl.checked);
      function setStatus(msg, color) { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--warm-gray)'; } }
      if (send && !email) { setStatus('Enter a buyer email, or uncheck “Email this link”.', 'var(--amber)'); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('That email address looks invalid.', 'var(--amber)'); return; }
      if (typeof firebase === 'undefined' || !firebase.functions) { setStatus('Sharing is unavailable right now.', 'var(--danger)'); return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
      setStatus('Minting share link…');
      var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID;
      // recipientEmail is sent ONLY when "Email this link" is checked — the CF
      // queues an email whenever recipientEmail is non-null (it has no separate
      // send flag), so withholding it gives a link-only result.
      Promise.resolve(firebase.functions().httpsCallable('mintLookbookShareToken')({
        tenantId: tenantId,
        lookbookId: id,
        recipientName: name || null,
        recipientEmail: (send && email) ? email : null,
        lookbookTitle: r.title || null
      })).then(function (res) {
        var data = (res && res.data) || {};
        if (data.ok === false || data.success === false) throw new Error(data.error || 'mint failed');
        var shareUrl = data.shareUrl || data.url || '';
        if (!shareUrl) throw new Error('No share link returned');
        if (window.writeAudit) writeAudit('share', 'lookbook', id);
        setStatus((send && email) ? ('Link created — email queued to ' + email + '.') : 'Share link created.', 'var(--teal)');
        if (resultEl) {
          resultEl.style.display = '';
          resultEl.innerHTML =
            '<label class="form-label" style="display:block;margin-bottom:4px;">Share link</label>' +
            '<div style="display:flex;gap:8px;">' +
              '<input class="form-input" id="lbv2ShareUrl" readonly value="' + esc(shareUrl) + '" style="flex:1;font-size:0.85rem;">' +
              '<button class="btn btn-secondary" onclick="LookbooksV2.copyShare()">Copy</button>' +
            '</div>' +
            (data.expiresAt ? '<div class="mu-sub" style="margin-top:6px;">Link expires ' + esc(U.Num.date(data.expiresAt)) + '.</div>' : '');
        }
        delete shareOpensCache[id];
        loadShareOpens(id);
      }).catch(function (e) {
        console.error('[lookbooks-v2] share', e);
        setStatus('Could not create the link: ' + (e && e.message || e), 'var(--danger)');
        if (btn) { btn.disabled = false; btn.textContent = 'Generate share link'; }
      });
    },
    copyShare: function () {
      var el = document.getElementById('lbv2ShareUrl'); if (!el) return;
      try { el.select(); } catch (e) {}
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value);
        else document.execCommand('copy');
        if (window.showToast) showToast('Copied to clipboard.');
      } catch (e2) { if (window.showToast) showToast('Copy failed — select and copy manually.', true); }
    },
    // ── Per-product exclusions (native; replaces the classic escape hatch) ──
    addExclusion: function () {
      var sel = document.getElementById('lbv2ExcludeSelect');
      var box = document.getElementById('lbv2Excluded');
      if (!sel || !sel.value || !box) return;
      var pid = sel.value, i;
      var chips = box.querySelectorAll('.lbv2-exchip');
      for (i = 0; i < chips.length; i++) { if (chips[i].getAttribute('data-pid') === pid) { sel.value = ''; return; } }
      box.insertAdjacentHTML('beforeend', exChipHtml(pid));
      for (i = 0; i < sel.options.length; i++) { if (sel.options[i].value === pid) { sel.remove(i); break; } }
      sel.value = '';
      var none = document.getElementById('lbv2ExNone'); if (none) none.style.display = 'none';
    },
    removeExclusion: function (btn, pid) {
      var chip = (btn && btn.closest) ? btn.closest('.lbv2-exchip') : null;
      if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
      var sel = document.getElementById('lbv2ExcludeSelect');
      if (sel) {
        var has = false, i;
        for (i = 0; i < sel.options.length; i++) { if (sel.options[i].value === pid) { has = true; break; } }
        if (!has) { var o = document.createElement('option'); o.value = pid; o.textContent = prodName(pid); sel.appendChild(o); }
      }
      var box = document.getElementById('lbv2Excluded');
      if (box && !box.querySelector('.lbv2-exchip')) { var none = document.getElementById('lbv2ExNone'); if (none) none.style.display = ''; }
    },
    refresh: render
  };

  var _lbV2Route = { tab: 'lookbooksV2Tab', setup: function () { ensureTab(); render(); load(); } };
  // The legacy 'lookbooks' route resolves here too: lookbooks.js (V1) was retired
  // (T6, Legacy-UI sunset) and this is now the only Look Books admin UI for ALL
  // users, regardless of the redesign flag.
  MastAdmin.registerModule('lookbooks-v2', {
    routes: { 'lookbooks-v2': _lbV2Route, 'lookbooks': _lbV2Route }
  });
})();
