/**
 * promotions-v2.js — conversion #1 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy `promotions.js` puts create/edit in a modal and lists with bespoke
 * table+cards. This is the same surface on the Entity Engine: a MastEntity
 * schema drives the standard list + the slide-out shell, and promotions opts
 * into CUSTOM interiors (detail.render / detail.editRender) because a sale fits
 * neither stock template — it is config + a product-scope facet.
 *
 * Variant (doc 17 §1a test): status (active/scheduled/ended) is a DERIVED
 * attribute computed from dates, not a governed lifecycle → Faceted Record,
 * NOT Process. Facets: Overview (discount + schedule + lifecycle actions) and
 * Products (the in-scope product list). Flag-gated (`?ui=1`), side-by-side with
 * legacy `#promotions`; never touches the legacy module.
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
  var STATUS_TONE = { active: 'success', scheduled: 'info', ended: 'neutral' };

  // ── pure helpers (mirror legacy promotions.js) ──────────────────────
  function computeStatus(s) {
    if (!s) return 'ended';
    if (s.archived) return 'ended';
    var now = new Date().toISOString();
    if (s.startDate && s.startDate > now) return 'scheduled';
    if (s.endDate && s.endDate < now) return 'ended';
    return 'active';
  }
  function extractPids(products) {
    if (!Array.isArray(products)) return [];
    return products.map(function (p) { return typeof p === 'string' ? p : p && p.pid; }).filter(Boolean);
  }
  function formatDiscount(s) {
    if (!s) return '';
    if (s.discountType === 'quantity-tier') {
      return (s.tiers || []).slice().sort(function (a, b) { return a.qty - b.qty; })
        .map(function (t) { return t.qty + ' for ' + (N.money(t.totalCents, { cents: true }) || '$0'); }).join(', ') || 'Quantity tier';
    }
    if (s.discountType === 'percent') return s.discountValue + '% off';
    return (N.money((s.discountValue || 0) / 100) || '$0.00') + ' off';
  }
  // Which channels a sale applies to. Missing/empty = both (legacy + default).
  function formatChannels(ch) {
    if (!ch || !ch.length) return 'POS + Online';
    var pos = ch.indexOf('pos') !== -1, on = ch.indexOf('online') !== -1;
    if (pos && on) return 'POS + Online';
    if (pos) return 'POS only';
    if (on) return 'Online only';
    return '—';
  }
  // One editable tier row (qty → total $) for the quantity-tier editor.
  function tierRowHtml(qty, totalCents) {
    return '<div class="promo-v2-tier" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
      '<input class="form-input promo-v2-tier-qty" type="number" min="1" value="' + (qty != null && qty !== '' ? esc(qty) : '') + '" placeholder="Qty" style="width:80px;">' +
      '<span style="color:var(--warm-gray);font-size:0.85rem;">for</span>' +
      '<input class="form-input promo-v2-tier-total" type="number" min="0" step="0.01" value="' + (totalCents != null && totalCents !== '' ? esc(N.moneyRaw(totalCents, { cents: true })) : '') + '" placeholder="Total $" style="flex:1;min-width:90px;">' +
      '<button type="button" onclick="PromotionsV2.removeTierRow(this)" style="background:none;border:none;color:var(--warm-gray);font-size:1.15rem;cursor:pointer;line-height:1;">×</button>' +
    '</div>';
  }
  function windowText(s) {
    if (!s) return '';
    if (s.startDate && s.endDate) return N.date(s.startDate) + ' – ' + N.date(s.endDate);
    if (s.startDate) return 'From ' + N.date(s.startDate) + (s.keepAfterEnd ? ' (ongoing)' : '');
    return '';
  }

  // ── schema ──────────────────────────────────────────────────────────
  MastEntity.define('promotions-v2', {
    label: 'Sale', labelPlural: 'Promotions', size: 'lg',
    route: 'promotions-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      { name: 'name', label: 'Name', type: 'text', list: true, required: true, group: 'Sale' },
      { name: 'discount', label: 'Discount', type: 'text', list: true, readOnly: true, group: 'Sale',
        get: function (s) { return formatDiscount(s); } },
      { name: 'productCount', label: 'Products', type: 'number', list: true, readOnly: true,
        get: function (s) { return extractPids(s.products || []).length; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'scheduled', 'ended'],
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'window', label: 'Window', type: 'text', list: true, readOnly: true,
        get: function (s) { return windowText(s) || '—'; } }
    ],
    fetch: function (id) {
      // The list listener already holds the records; read it (avoids a 2nd fetch).
      // Fall back to a point read so drill/deep-link still resolve.
      var cached = V2.byId[id];
      var p = cached ? Promise.resolve(cached) : Promise.resolve(MastDB.promotions.get(id)).then(function (s) {
        return s ? Object.assign({ _key: id }, s) : null;
      });
      return p.then(function (s) {
        if (!s) return null;
        s.status = computeStatus(s);
        s._products = resolveProducts(s.products || []);
        return s;
      });
    },
    detail: {
      // Faceted Record — composes the same MastUI primitives the stock templates use.
      render: function (UI, s) {
        var tiles = UI.tiles([
          { k: 'Discount', v: esc(formatDiscount(s)), hero: true },
          { k: 'Products', v: N.count(extractPids(s.products || []).length) },
          { k: 'Starts', v: s.startDate ? N.date(s.startDate) : '—' },
          { k: 'Ends', v: s.endDate ? N.date(s.endDate) : (s.keepAfterEnd ? 'Ongoing' : '—') }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'products', label: 'Products' }], 'ov');

        var schedule = UI.kv([
          { k: 'Discount', v: esc(formatDiscount(s)) },
          { k: 'Window', v: esc(windowText(s) || '—') },
          { k: 'Applies to', v: esc(formatChannels(s.channels)) },
          { k: 'Keep after end', v: s.keepAfterEnd ? 'Yes' : 'No' }
        ]);
        var id = s._key || s.id;
        var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
          (s.status === 'active'
            ? '<button class="btn btn-secondary" onclick="PromotionsV2.endSale(\'' + esc(id) + '\')">End sale now</button>' : '') +
          '<button class="btn btn-danger" onclick="PromotionsV2.deleteSale(\'' + esc(id) + '\')">Delete</button>' +
          '</div>';

        var prods = s._products || resolveProducts(s.products || []);
        var prodTable = prods.length
          ? UI.relatedTable([
              { label: 'Product', render: function (p) { return esc(p.name); } },
              { label: 'Price', align: 'right', render: function (p) { return p.priceCents ? (N.money(p.priceCents / 100) || '—') : '—'; } }
            ], prods)
          : '<span class="mu-sub">No products in this sale.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Schedule', schedule + actions) + '</div>' +
          '<div class="mu-pane" data-pane="products" hidden>' + UI.cardTable('Products (' + prods.length + ')', prodTable) + '</div>';
      },
      // Custom edit/create interior — datetime + checkbox + scope picker, ported
      // faithfully from the legacy modal (tokens/scale cleaned for born-0).
      editRender: function (s, mode) {
        if (!V2.products) { setTimeout(function () { loadProducts().then(function () { if (U.slideOut.isOpen()) U.slideOut.setMode(mode); }); }, 0); return '<div style="padding:18px;color:var(--warm-gray);font-size:0.9rem;">Loading products…</div>'; }
        var existingPids = extractPids((s && s.products) || []);
        V2._editPids = {}; existingPids.forEach(function (pid) { V2._editPids[pid] = true; });
        var nowLocal = new Date().toISOString().slice(0, 16);

        var catSet = {};
        V2.products.forEach(function (p) { (p.categories || []).forEach(function (c) { if (c) catSet[c] = true; }); });
        var catOptions = '<option value="">All categories</option>' +
          Object.keys(catSet).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

        var head = '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' +
          (mode === 'create' ? 'Create a sale' : 'Update this sale') + '</div>';

        var fields =
          '<div class="form-group"><label class="form-label">Sale name *</label>' +
            '<input class="form-input" name="name" id="promoV2Name" value="' + esc(s ? s.name : '') + '" placeholder="e.g., Spring Sale, Seconds" style="width:100%;"></div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            '<div class="form-group" style="flex:1;min-width:160px;"><label class="form-label">Discount type</label>' +
              '<select class="form-input" id="promoV2Type" onchange="PromotionsV2.typeChanged()" style="width:100%;">' +
                '<option value="percent"' + (s && s.discountType === 'percent' ? ' selected' : '') + '>Percent off</option>' +
                '<option value="fixed"' + (s && s.discountType === 'fixed' ? ' selected' : '') + '>Fixed amount off</option>' +
                '<option value="quantity-tier"' + (s && s.discountType === 'quantity-tier' ? ' selected' : '') + '>Quantity tier (X for $Y)</option>' +
              '</select></div>' +
            '<div class="form-group" id="promoV2ValueGroup" style="flex:1;min-width:160px;display:' + (s && s.discountType === 'quantity-tier' ? 'none' : '') + ';"><label class="form-label">Discount value</label>' +
              '<input class="form-input" type="number" id="promoV2Value" min="0" value="' + (s && s.discountValue != null ? esc(s.discountValue) : '') + '" placeholder="' + (s && s.discountType === 'fixed' ? 'Amount in cents' : '0-100') + '" style="width:100%;"></div>' +
          '</div>' +
          '<div class="form-group" id="promoV2TierGroup" style="display:' + (s && s.discountType === 'quantity-tier' ? 'block' : 'none') + ';"><label class="form-label">Quantity tiers <span style="color:var(--warm-gray);font-size:0.78rem;">(total price for N items)</span></label>' +
            '<div id="promoV2Tiers">' + ((s && s.discountType === 'quantity-tier' && s.tiers && s.tiers.length) ? s.tiers.slice().sort(function (a, b) { return a.qty - b.qty; }).map(function (t) { return tierRowHtml(t.qty, t.totalCents); }).join('') : (tierRowHtml(1, '') + tierRowHtml(2, ''))) + '</div>' +
            '<button type="button" class="btn btn-secondary" onclick="PromotionsV2.addTierRow()" style="font-size:0.85rem;margin-top:6px;">+ Add tier</button></div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            '<div class="form-group" style="flex:1;min-width:160px;"><label class="form-label">Start date</label>' +
              '<input class="form-input" type="datetime-local" id="promoV2Start" value="' + (s && s.startDate ? esc(s.startDate.slice(0, 16)) : nowLocal) + '" style="width:100%;"></div>' +
            '<div class="form-group" style="flex:1;min-width:160px;"><label class="form-label">End date <span style="color:var(--warm-gray);font-size:0.78rem;">(optional)</span></label>' +
              '<input class="form-input" type="datetime-local" id="promoV2End" value="' + (s && s.endDate ? esc(s.endDate.slice(0, 16)) : '') + '" style="width:100%;"></div>' +
          '</div>' +
          '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;">' +
            '<input type="checkbox" id="promoV2Keep"' + (s && s.keepAfterEnd ? ' checked' : '') + '> Keep after end (prevent auto-archiving)</label></div>' +
          '<div class="form-group"><label class="form-label">Where it applies</label>' +
            '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="promoV2ChPos"' + (!s || !s.channels || s.channels.indexOf('pos') !== -1 ? ' checked' : '') + '> Point of sale</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" id="promoV2ChOnline"' + (!s || !s.channels || s.channels.indexOf('online') !== -1 ? ' checked' : '') + '> Online store</label>' +
            '</div></div>';

        var picker =
          '<div class="form-group"><label class="form-label">Products</label>' +
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
              '<input class="form-input" id="promoV2Search" placeholder="Search products…" oninput="PromotionsV2.filterProducts()" style="flex:1;min-width:140px;font-size:0.85rem;">' +
              '<select class="form-input" id="promoV2Cat" onchange="PromotionsV2.filterProducts()" style="font-size:0.85rem;">' + catOptions + '</select>' +
              '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;white-space:nowrap;">' +
                '<input type="checkbox" id="promoV2SelectAll" onchange="PromotionsV2.selectAllToggle()"> Select all</label>' +
            '</div>' +
            '<div id="promoV2Picker" style="max-height:240px;overflow-y:auto;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:8px;padding:8px;">' +
              pickerRows('', '') +
            '</div>' +
          '</div>';

        return head + fields + picker;
      }
    },
    onSave: function (rec, mode) {
      var name = (document.getElementById('promoV2Name') || {}).value;
      name = (name || '').trim();
      var type = (document.getElementById('promoV2Type') || {}).value || 'percent';
      var start = (document.getElementById('promoV2Start') || {}).value;
      var end = (document.getElementById('promoV2End') || {}).value || null;
      var keep = !!(document.getElementById('promoV2Keep') || {}).checked;

      if (!name) { showToast('Sale name is required', true); return false; }
      if (!start) { showToast('Start date is required', true); return false; }

      // Discount: percent/fixed use a single value; quantity-tier uses tier rows.
      var value = null, tiers = null;
      if (type === 'quantity-tier') {
        tiers = [];
        document.querySelectorAll('#promoV2Tiers .promo-v2-tier').forEach(function (row) {
          var q = parseInt((row.querySelector('.promo-v2-tier-qty') || {}).value, 10);
          var t = parseFloat((row.querySelector('.promo-v2-tier-total') || {}).value);
          if (q > 0 && !isNaN(t) && t >= 0) tiers.push({ qty: q, totalCents: Math.round(t * 100) });
        });
        tiers.sort(function (a, b) { return a.qty - b.qty; });
        if (!tiers.length) { showToast('Add at least one quantity tier', true); return false; }
      } else {
        value = parseFloat((document.getElementById('promoV2Value') || {}).value);
        if (isNaN(value) || value <= 0) { showToast('Discount value must be greater than 0', true); return false; }
        if (type === 'percent' && value > 100) { showToast('Percent cannot exceed 100', true); return false; }
      }

      var pids = [];
      document.querySelectorAll('#promoV2Picker .promo-v2-cb:checked').forEach(function (cb) { pids.push(cb.getAttribute('data-pid')); });
      if (!pids.length) { showToast('Select at least one product', true); return false; }

      var startISO = new Date(start).toISOString();
      var endISO = end ? new Date(end).toISOString() : null;
      if (endISO && endISO < startISO) { showToast('End date must be after start date', true); return false; }

      var channels = [];
      if ((document.getElementById('promoV2ChPos') || {}).checked) channels.push('pos');
      if ((document.getElementById('promoV2ChOnline') || {}).checked) channels.push('online');
      if (!channels.length) { showToast('Pick at least one place: Point of sale or Online store', true); return false; }

      var now = new Date().toISOString();
      var data = { name: name, discountType: type, products: pids,
        startDate: startISO, endDate: endISO, keepAfterEnd: keep, updatedAt: now,
        discountValue: (type === 'quantity-tier' ? null : value), tiers: (type === 'quantity-tier' ? tiers : null), channels: channels };

      var id = rec._key || rec.id;
      var op;
      if (mode !== 'create' && id) {
        op = Promise.resolve(MastDB.promotions.update(id, data)).then(function () {
          if (window.writeAudit) writeAudit('update', 'sale-promotion', id);
          // Mutate the LIVE cached record (=== the slide-out's read closure, since
          // fetch returns V2.byId[id]) so the post-save read re-render shows fresh
          // data. Mutating the `rec` copy the engine passes here would not.
          var live = V2.byId[id] || rec;
          Object.assign(live, data); live.status = computeStatus(live); live._products = resolveProducts(pids);
          showToast('Sale updated');
        });
      } else {
        data.archived = false; data.createdAt = now;
        var newId = MastDB.promotions.newKey();
        op = Promise.resolve(MastDB.promotions.set(newId, data)).then(function () {
          if (window.writeAudit) writeAudit('create', 'sale-promotion', newId);
          showToast('Sale created');
        });
      }
      return op.then(function () { return true; }).catch(function (e) {
        console.error('[promotions-v2] save', e); showToast('Failed to save sale', true); return false;
      });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'status', sortDir: 'asc', listener: null, products: null, q: '', _editPids: {} };

  function resolveProducts(products) {
    var pids = extractPids(products);
    var byPid = {};
    (V2.products || []).forEach(function (p) { byPid[p.pid] = p; });
    return pids.map(function (pid) { return byPid[pid] || { pid: pid, name: pid, priceCents: 0 }; });
  }

  function loadProducts() {
    if (V2.products) return Promise.resolve(V2.products);
    return Promise.resolve(MastDB.products.list(500)).then(function (data) {
      V2.products = Object.keys(data || {}).map(function (k) {
        var v = data[k] || {};
        return { pid: v.pid || k, name: v.name || k, priceCents: v.priceCents || 0, categories: v.categories || [], status: v.status || 'active' };
      }).filter(function (p) { return p.status === 'active'; });
      return V2.products;
    }).catch(function (e) { console.error('[promotions-v2] products', e); V2.products = []; return V2.products; });
  }

  // One checkbox row per product, honoring current search/category + selection.
  function pickerRows(search, cat) {
    search = (search || '').toLowerCase(); cat = cat || '';
    var html = '', visible = 0;
    (V2.products || []).forEach(function (p) {
      if (search && p.name.toLowerCase().indexOf(search) === -1) return;
      if (cat && (p.categories || []).indexOf(cat) === -1) return;
      var checked = !!V2._editPids[p.pid];
      var price = p.priceCents ? (N.money(p.priceCents / 100) || '') : '';
      html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-bottom:1px solid var(--border-light,rgba(127,127,127,.12));font-size:0.9rem;">' +
        '<input type="checkbox" class="promo-v2-cb" data-pid="' + esc(p.pid) + '"' + (checked ? ' checked' : '') + '>' +
        '<span style="flex:1;">' + esc(p.name) + '</span>' +
        (price ? '<span style="color:var(--warm-gray);font-size:0.85rem;">' + price + '</span>' : '') +
      '</label>';
      visible++;
    });
    return visible ? html : '<div style="padding:12px;color:var(--warm-gray);font-size:0.85rem;">No products match.</div>';
  }

  function toRows(tree) {
    var out = []; tree = tree || {};
    Object.keys(tree).forEach(function (k) {
      var s = tree[k]; if (s && typeof s === 'object') { var r = Object.assign({ _key: k }, s); r.status = computeStatus(r); out.push(r); }
    });
    return out;
  }
  function load() {
    loadProducts();
    if (V2.listener) { render(); return; }
    V2.listener = MastDB.promotions.listen(200, function (snap) {
      V2.rows = toRows(snap.val() || {});
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    }, function (err) { console.error('[promotions-v2] listen', err); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) { return String(r.name || '').toLowerCase().indexOf(q) >= 0; });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('promotions-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('promotionsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'promotionsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Sale Promotions</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-primary" style="margin-left:auto;" onclick="PromotionsV2.create()">+ Create Sale</button>' +
        '<button class="btn btn-secondary" onclick="PromotionsV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search sale name…" value="' + esc(V2.q) +
        '" oninput="PromotionsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('promotions-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'PromotionsV2.sort', onRowClickFnName: 'PromotionsV2.open',
        empty: { title: 'No promotions', message: 'Create a sale to run your first promotion.' }
      });
  }

  window.PromotionsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('promotions-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('promotions-v2', rec, 'read');
      });
    },
    create: function () {
      loadProducts().then(function () { MastEntity.openRecord('promotions-v2', {}, 'create'); });
    },
    typeChanged: function () {
      var type = (document.getElementById('promoV2Type') || {}).value;
      var isTier = type === 'quantity-tier';
      var vg = document.getElementById('promoV2ValueGroup'); if (vg) vg.style.display = isTier ? 'none' : '';
      var tg = document.getElementById('promoV2TierGroup'); if (tg) tg.style.display = isTier ? 'block' : 'none';
      var v = document.getElementById('promoV2Value');
      if (v) v.placeholder = type === 'fixed' ? 'Amount in cents (e.g., 500 = $5)' : '0-100';
    },
    addTierRow: function () {
      var c = document.getElementById('promoV2Tiers');
      if (c) c.insertAdjacentHTML('beforeend', tierRowHtml('', ''));
    },
    removeTierRow: function (btn) {
      var row = btn && btn.closest ? btn.closest('.promo-v2-tier') : null;
      if (row) row.remove();
    },
    filterProducts: function () {
      var picker = document.getElementById('promoV2Picker'); if (!picker) return;
      // Snapshot current selection before re-render so checks survive filtering.
      picker.querySelectorAll('.promo-v2-cb').forEach(function (cb) { V2._editPids[cb.getAttribute('data-pid')] = cb.checked; });
      var search = (document.getElementById('promoV2Search') || {}).value || '';
      var cat = (document.getElementById('promoV2Cat') || {}).value || '';
      picker.innerHTML = pickerRows(search, cat);
      var cbs = picker.querySelectorAll('.promo-v2-cb');
      var sel = document.getElementById('promoV2SelectAll');
      if (sel) sel.checked = cbs.length > 0 && Array.prototype.every.call(cbs, function (cb) { return cb.checked; });
    },
    selectAllToggle: function () {
      var on = (document.getElementById('promoV2SelectAll') || {}).checked;
      var picker = document.getElementById('promoV2Picker'); if (!picker) return;
      picker.querySelectorAll('.promo-v2-cb').forEach(function (cb) { cb.checked = on; V2._editPids[cb.getAttribute('data-pid')] = on; });
    },
    endSale: function (id) {
      var s = V2.byId[id]; if (!s) return;
      var doIt = function () {
        var now = new Date().toISOString();
        Promise.resolve(MastDB.promotions.update(id, { endDate: now, updatedAt: now })).then(function () {
          if (window.writeAudit) writeAudit('update', 'sale-promotion', id);
          showToast('Sale ended'); U.slideOut.requestCloseForce();
        }).catch(function () { showToast('Failed to end sale', true); });
      };
      var msg = 'End “' + s.name + '” now? Products return to full price on the storefront.';
      (typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'End sale', confirmLabel: 'End sale' }) : Promise.resolve(true))
        .then(function (ok) { if (ok) doIt(); });
    },
    deleteSale: function (id) {
      var s = V2.byId[id]; if (!s) return;
      var doIt = function () {
        Promise.resolve(MastDB.promotions.remove(id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'sale-promotion', id);
          showToast('Sale deleted'); U.slideOut.requestCloseForce();
        }).catch(function () { showToast('Failed to delete sale', true); });
      };
      var msg = 'Permanently delete “' + s.name + '”? This cannot be undone.';
      (typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Delete sale', confirmLabel: 'Delete', danger: true }) : Promise.resolve(true))
        .then(function (ok) { if (ok) doIt(); });
    },
    exportCsv: function () { return MastEntity.exportRows('promotions-v2', visibleRows(), 'all'); }
  };

  var _promoV2Route = { tab: 'promotionsV2Tab', setup: function () { ensureTab(); render(); load(); } };
  // The legacy 'promotions' route resolves here too: promotions.js (V1) was retired
  // (T6, Legacy-UI sunset); this is now the only Sale Promotions admin UI for ALL
  // users, regardless of the redesign flag.
  MastAdmin.registerModule('promotions-v2', {
    routes: { 'promotions-v2': _promoV2Route, 'promotions': _promoV2Route }
  });
})();
