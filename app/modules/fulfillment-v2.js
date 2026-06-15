/**
 * fulfillment-v2.js — ONE fulfillment queue (queue archetype,
 * standard-record-ui §10), replacing the separate pack-v2 + ship-v2 twins.
 *
 * Operator review (2026-06-10): Pack and Ship are not two objects — they're
 * one continuous process over the same orders, sliced by stage. This module
 * serves BOTH routes (#pack-v2 and #ship-v2) with one queue spanning the
 * whole post-payment pipeline; the route you arrive by only picks the default
 * stage bucket (Pack → "To pick", Ship → "To ship"). Same one-click guarded
 * advance via MastFlow as before (blocked → record SO checklist), row click
 * opens the standard orders-v2 record SO.
 *
 * Label purchase is NATIVE (2026-06-15): the Tracking column offers "Buy label"
 * on shippable, untracked rows → opens a self-contained slide-out that pre-fills
 * ship-from / ship-to / parcel, fetches rates (shippingGetRates CF), and on
 * confirm buys the label (shippingBuyLabel CF) and persists tracking on the
 * order exactly like the legacy #ship surface (status→shipped, shippedAt,
 * tracking{}, statusHistory, writeAudit, onOrderShipped). The old
 * navigateToClassic('ship') escape hatch is retired. A manual-tracking fallback
 * covers the no-provider / failed-buy case so the action never dead-ends.
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
  if (!window.MastAdmin || !window.MastEntity) return;
  if (!flagOn()) return;

  // The whole post-payment pipeline, one stage map. Phase keys match
  // pickship.workflow.js; 'pack' (phase picked) is the branch point and
  // advances into the pack-ship branch explicitly.
  var STAGES = {
    confirmed:         { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    building:          { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    ready:             { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    pack:              { phase: 'picked',    next: 'packing',   nextLabel: 'Pack & ship →', bucket: 'pack', branchChoice: 'pack-ship' },
    packing:           { phase: 'packing',   next: 'labeled',   nextLabel: 'Packed ✓',      bucket: 'pack' },
    packed:            { phase: 'labeled',   next: 'shipped',   nextLabel: 'Mark shipped →', bucket: 'ship' },
    handed_to_carrier: { phase: 'shipped',   next: 'delivered', nextLabel: 'Delivered ✓',   bucket: 'transit' },
    shipped:           { phase: 'shipped',   next: 'delivered', nextLabel: 'Delivered ✓',   bucket: 'transit' }
  };
  var TONE = { confirmed: 'info', building: 'amber', ready: 'teal', pack: 'amber', packing: 'amber',
    packed: 'teal', handed_to_carrier: 'teal', shipped: 'teal' };
  var BUCKETS = [['all', 'All'], ['pick', 'To pick'], ['pack', 'To pack'], ['ship', 'To ship'], ['transit', 'In transit']];
  // Statuses where a shipping label is buyable (packing range, pre-ship) and the
  // row has no tracking yet — mirrors the legacy buy-labels candidate set.
  var LABELABLE = { pack: 1, packing: 1, packed: 1 };

  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'asc', bucket: 'all', off: null, busy: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Label purchase / manual-ship are order WRITES (mark shipped, spend postage),
  // so gate them. The queue serves both fulfillment routes; edit on either grants
  // it (admins always pass via can()).
  function canShipEdit() {
    return typeof window.can !== 'function' || window.can('ship-v2', 'edit') || window.can('pack-v2', 'edit');
  }

  function inQueue(o) { return !!STAGES[String(o.status || '').toLowerCase()]; }
  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      var r = Object.assign({ _key: k }, o);
      if (inQueue(r)) out.push(r);
    });
    return out;
  }

  function load() {
    var o = window.MastDB && MastDB.orders;
    if (!o) return;
    var apply = function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    };
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[fulfillment-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function ageDays(o) {
    var t = o.placedAt || o.createdAt; if (!t) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));
  }
  function trackingLabel(o) {
    var t = o.tracking;
    if (t && typeof t === 'object') return [t.carrier, t.trackingNumber].filter(Boolean).join(' ');
    if (typeof t === 'string' && t) return t;
    var sh = o.shipping || {};
    return sh.trackingNumber || sh.tracking_number || '';
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.bucket !== 'all') rows = rows.filter(function (r) { return STAGES[String(r.status).toLowerCase()].bucket === V2.bucket; });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      if (k === 'age') return ageDays(r);
      if (k === 'tracking') return trackingLabel(r);
      var f = MastEntity.get('orders-v2') && MastEntity.get('orders-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function columns() {
    var N = window.MastUI.Num;
    return [
      { key: 'orderNumber', label: 'Order', render: function (r) { return r.orderNumber || r._key; } },
      { key: 'email', label: 'Customer', render: function (r) { return r.customerName || r.email || '—'; } },
      { key: 'items', label: 'Items', align: 'right',
        render: function (r) { return Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : (r.itemCount || 0); } },
      { key: 'total', label: 'Total', align: 'right', render: function (r) { return N.money(N.moneyVal(r, 'totalCents', 'total')) || '—'; } },
      { key: 'status', label: 'Status',
        render: function (r) { var s = String(r.status).toLowerCase(); return window.MastUI.badge(s.replace(/_/g, ' '), TONE[s] || 'neutral'); } },
      { key: 'tracking', label: 'Tracking',
        render: function (r) {
          var tl = trackingLabel(r);
          if (tl) {
            var url = (r.tracking && (r.tracking.labelUrl || r.tracking.trackingUrl)) || '';
            return esc(tl) + (url ? ' <a href="' + esc(url) + '" target="_blank" rel="noopener" ' +
              'onclick="event.stopPropagation();" style="color:var(--teal);font-size:0.78rem;white-space:nowrap;">label ↗</a>' : '');
          }
          if (LABELABLE[String(r.status).toLowerCase()] && canShipEdit()) {
            return '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 9px;white-space:nowrap;" ' +
              'onclick="event.stopPropagation();FulfillV2.buyLabel(\'' + r._key + '\')">Buy label</button>';
          }
          return '<span style="color:var(--warm-gray);">—</span>';
        } },
      { key: 'age', label: 'Age', align: 'right',
        render: function (r) { var d = ageDays(r); return d === null ? '—' : (d === 0 ? 'today' : d + 'd'); } },
      { key: '_advance', label: '', sortable: false, align: 'right', render: function (r) {
          var st = STAGES[String(r.status).toLowerCase()]; if (!st) return '';
          var busy = V2.busy[r._key];
          return '<button class="btn btn-secondary" ' + (busy ? 'disabled ' : '') +
            'style="font-size:0.78rem;padding:4px 10px;white-space:nowrap;" ' +
            'onclick="event.stopPropagation();FulfillV2.advance(\'' + r._key + '\')">' +
            (busy ? '…' : st.nextLabel) + '</button>';
        } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('fulfillmentV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fulfillmentV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function counts() {
    var c = { all: V2.rows.length, pick: 0, pack: 0, ship: 0, transit: 0 };
    V2.rows.forEach(function (r) { c[STAGES[String(r.status).toLowerCase()].bucket]++; });
    return c;
  }

  function render() {
    var tab = ensureTab();
    var c = counts();
    var pills = BUCKETS.map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="FulfillV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      window.MastUI.pageHeader({ title: 'Fulfillment', count: window.MastUI.Num.count(V2.rows.length) + ' in the pipeline',
        actionsHtml: '<button class="btn btn-secondary" onclick="FulfillV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'FulfillV2.sort', onRowClickFnName: 'FulfillV2.open',
        empty: { title: 'Nothing in the pipeline', message: 'Paid orders land here until they\'re delivered.' }
      });
  }

  // One-click advance: same engine path + guards as the Process pane. Engine
  // FIRST, then the spec (the spec IIFE no-ops without the engine — the old
  // Promise.all race).
  function advance(id) {
    var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
    var st = STAGES[String(rec.status).toLowerCase()]; if (!st) return;
    V2.busy[id] = true; render();
    var done = function () { delete V2.busy[id]; render(); };
    MastAdmin.loadModule('workflowEngine')
      .then(function () { return MastAdmin.loadModule('pickshipWorkflow'); })
      .then(function () {
        rec.id = rec.id || rec._key;
        var opts = { recordId: rec.id, expectedFromPhase: st.phase };
        if (st.branchChoice) opts.branchChoice = st.branchChoice;
        return window.MastFlow.transition('pickship', rec, st.next, opts);
      })
      .then(function () {
        if (window.showToast) showToast((rec.orderNumber || 'Order') + ' → ' + st.nextLabel.replace(/[→✓]/g, '').trim());
        done();
      })
      .catch(function (e) {
        done();
        if (e && e.code === 'REQUIREMENTS_UNMET') {
          if (window.showToast) showToast('Blocked — see the checklist for what\'s missing', true);
          open(id);
        } else if (e && e.code === 'STALE_STATE') {
          if (window.showToast) showToast('Order changed elsewhere — refreshing', true);
          load();
        } else {
          console.error('[fulfillment-v2] advance', e);
          if (window.showToast) showToast('Could not advance: ' + (e && e.message || e), true);
        }
      });
  }

  function open(id) {
    var rec = V2.byId[id]; if (!rec) return;
    MastAdmin.loadModule('orders-v2').then(function () {
      window.MastEntity.openRecord('orders-v2', rec, 'read');
    }).catch(function (e) { console.error('[fulfillment-v2] open', e); });
  }

  // ── Native label picker (Shippo) ───────────────────────────────────────────
  // Self-contained slide-out replacing the old navigateToClassic('ship') hatch.
  // Reuses the SAME CFs as legacy #ship (shippingGetRates / shippingBuyLabel) and
  // persists tracking identically (status→shipped + tracking{} + statusHistory +
  // onOrderShipped). LP holds state for the lifetime of one open panel.
  var LP = null;

  function toast(msg, err) { if (window.showToast) window.showToast(msg, !!err); }
  function lpRoot() { return document.getElementById('lpRoot'); }
  function lpIdToken() {
    var u = (window.auth && window.auth.currentUser) ||
      (window.firebase && firebase.auth && firebase.auth().currentUser);
    return u ? u.getIdToken() : Promise.reject(new Error('Not signed in'));
  }
  // MastDB.get(path) resolves to the value directly; tolerate the .once('value')
  // ref-compat shim too so this is robust to either return shape.
  function lpReadVal(p, fallback) {
    return Promise.resolve(p).then(function (s) {
      if (s && typeof s.val === 'function') { var v = s.val(); return v == null ? fallback : v; }
      return s == null ? fallback : s;
    }).catch(function () { return fallback; });
  }
  function lpGetProvider() { return lpReadVal(MastDB.config.shippingProvider('provider'), 'manual'); }
  function lpGetPresets() { return lpReadVal(MastDB.config.shippingProvider('packagePresets'), []); }
  function lpGetLocations() {
    // .get() (no id) returns the full id-keyed location map — the proven pattern
    // the live Settings UI + legacy #ship both use.
    return Promise.resolve(MastDB.studioLocations.get()).then(function (m) { return m || {}; }).catch(function () { return {}; });
  }
  function lpCalcWeight(order) {
    var pd = window.productsData;
    if (!Array.isArray(pd)) return 0;
    var oz = 0;
    (order.items || []).forEach(function (it) {
      var p = pd.find(function (x) { return x.pid === it.pid; });
      if (p && p.weightOz) oz += p.weightOz * (it.qty || 1);
    });
    return oz;
  }
  function lpShipTo(order) {
    var a = order.shippingAddress || order.shipping || order.address || {};
    return {
      name: a.name || order.customerName || order.email || '',
      address1: a.address1 || a.line1 || '',
      address2: a.address2 || a.line2 || '',
      city: a.city || '', state: a.state || '',
      zip: a.zip || a.postalCode || '', phone: a.phone || ''
    };
  }

  function lpField(label, control) {
    return '<div style="margin-bottom:12px;"><label style="display:block;font-size:0.78rem;' +
      'color:var(--warm-gray);margin-bottom:4px;">' + label + '</label>' + control + '</div>';
  }
  function lpDim(id, label, val) {
    return '<div style="flex:1;min-width:80px;">' +
      lpField(label, '<input type="number" id="' + id + '" min="0" step="0.1" value="' + esc(val) + '" style="width:100%;">') + '</div>';
  }
  function lpBanner(msg, tone) {
    var c = tone === 'danger' ? 'var(--danger)' : 'var(--amber)';
    return '<div style="border:1px solid ' + c + ';border-radius:6px;padding:8px 12px;margin-bottom:12px;' +
      'font-size:0.78rem;color:' + c + ';">' + esc(msg) + '</div>';
  }

  function lpPaint() {
    var el = lpRoot(); if (!el || !LP) return;
    var s = LP.step;
    if (s === 'configure') el.innerHTML = lpPaintConfigure();
    else if (s === 'rates') el.innerHTML = lpPaintRates();
    else if (s === 'manual') el.innerHTML = lpPaintManual();
    else if (s === 'buying') el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--warm-gray);">Purchasing label…</div>';
    else if (s === 'done') el.innerHTML = lpPaintDone();
  }

  function lpPaintConfigure() {
    var s = LP;
    var locKeys = Object.keys(s.locations || {});
    var defaultKey = '';
    locKeys.forEach(function (k) { if (s.locations[k] && s.locations[k].isDefaultShipFrom) defaultKey = k; });
    if (!s.selectedFromKey) s.selectedFromKey = defaultKey || (locKeys[0] || '');
    var fromOpts = '';
    locKeys.forEach(function (k) {
      var loc = s.locations[k]; if (!loc || !loc.address1) return;
      var label = (loc.name || k) + ' — ' + [loc.city, loc.state].filter(Boolean).join(', ');
      fromOpts += '<option value="' + esc(k) + '"' + (s.selectedFromKey === k ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    var noFrom = fromOpts === '';
    var to = lpShipTo(s.order);
    var toLine = [to.name, to.address1, to.city, to.state, to.zip].filter(Boolean).join(', ');
    var noTo = !(to.address1 && to.city && to.state && to.zip);

    if (s.selectedPreset === undefined && s.presets && s.presets.length) s.selectedPreset = 0;
    var presetOpts = '<option value="custom"' + (s.selectedPreset === undefined ? ' selected' : '') + '>Custom dimensions</option>';
    (s.presets || []).forEach(function (p, i) {
      presetOpts += '<option value="' + i + '"' + (s.selectedPreset === i ? ' selected' : '') + '>' +
        esc(p.name) + ' (' + p.lengthIn + '×' + p.widthIn + '×' + p.heightIn + '")</option>';
    });
    var sel = (s.selectedPreset !== undefined && s.presets) ? s.presets[s.selectedPreset] : null;
    var L = sel ? sel.lengthIn : (s.parcelLength || '');
    var W = sel ? sel.widthIn : (s.parcelWidth || '');
    var H = sel ? sel.heightIn : (s.parcelHeight || '');
    var wt = s.manualWeight || s.autoWeight || '';

    var html = '';
    if (noFrom) html += lpBanner('No studio location has a ship-from address. Add one in Settings → Workshop → Studio locations, then reopen.', 'amber');
    if (noTo) html += lpBanner('This order has no complete shipping address — rates need street, city, state and ZIP.', 'amber');
    html +=
      lpField('Ship from', '<select id="lpFrom" onchange="FulfillV2.lpSetFrom(this.value)" style="width:100%;">' + (fromOpts || '<option>No addresses on file</option>') + '</select>') +
      lpField('Ship to', '<div style="padding:8px 12px;background:var(--surface-2,rgba(255,255,255,0.04));border-radius:6px;font-size:0.9rem;">' + (toLine ? esc(toLine) : 'No shipping address on order') + '</div>') +
      lpField('Package', '<select id="lpPreset" onchange="FulfillV2.lpSetPreset(this.value)" style="width:100%;">' + presetOpts + '</select>') +
      '<div id="lpDims" style="display:' + (s.selectedPreset === undefined ? 'flex' : 'none') + ';gap:8px;">' +
        lpDim('lpLen', 'Length (in)', L) + lpDim('lpWid', 'Width (in)', W) + lpDim('lpHt', 'Height (in)', H) +
      '</div>' +
      '<div style="max-width:220px;">' +
        lpField('Weight (oz)' + (s.autoWeight ? ' · auto ' + s.autoWeight : ''), '<input type="number" id="lpWt" min="0" step="0.1" value="' + esc(wt) + '" style="width:100%;">') +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:18px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="FulfillV2.lpManual()">Enter tracking manually</button>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" onclick="MastUI.slideOut.requestClose()">Cancel</button>' +
          '<button class="btn btn-primary" id="lpRatesBtn" onclick="FulfillV2.lpGetRates()"' + ((noFrom || noTo) ? ' disabled' : '') + '>Get rates</button>' +
        '</div>' +
      '</div>';
    return html;
  }

  function lpPaintRates() {
    var s = LP;
    var html = '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0 0 14px;">Select a rate to purchase a label.</p>';
    if (s.rateError) html += lpBanner(s.rateError, 'danger');
    if (!s.rates.length) {
      html += '<div style="padding:16px 0;color:var(--warm-gray);">No rates returned for this shipment.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      s.rates.forEach(function (rate, i) {
        var on = s.selectedRate === i;
        html += '<button type="button" onclick="FulfillV2.lpSelectRate(' + i + ')" ' +
          'style="text-align:left;border:1px solid ' + (on ? 'var(--teal)' : 'var(--border,rgba(255,255,255,0.12))') + ';' +
          'background:' + (on ? 'color-mix(in srgb,var(--teal) 14%,transparent)' : 'transparent') + ';' +
          'border-radius:8px;padding:10px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;">' +
          '<span><strong>' + esc(rate.carrier || '') + '</strong> · ' + esc(rate.service || '') +
          (rate.estimatedDays ? ' <span style="color:var(--warm-gray);">· ' + esc(rate.estimatedDays) + 'd</span>' : '') + '</span>' +
          '<span style="font-family:monospace;font-weight:600;">$' + parseFloat(rate.price || 0).toFixed(2) + '</span>' +
          '</button>';
      });
      html += '</div>';
    }
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">' +
      '<button class="btn btn-secondary" onclick="FulfillV2.lpBack()">Back</button>' +
      '<button class="btn btn-primary" id="lpBuyBtn" onclick="FulfillV2.lpBuy()"' + (s.selectedRate === null ? ' disabled' : '') + '>Buy label</button>' +
      '</div>';
    return html;
  }

  function lpPaintManual() {
    var s = LP;
    var note = (s.provider === 'manual')
      ? '<p style="color:var(--warm-gray);font-size:0.78rem;margin:0 0 12px;">No shipping provider is connected — enter the tracking number from your carrier to mark this order shipped.</p>'
      : '';
    return note +
      lpField('Carrier', '<select id="lpMCarrier" style="width:100%;"><option>USPS</option><option>UPS</option><option>FedEx</option><option>Other</option></select>') +
      lpField('Tracking number', '<input type="text" id="lpMTrack" placeholder="Enter tracking number" style="width:100%;">') +
      lpField('Note (optional)', '<input type="text" id="lpMNote" placeholder="e.g. Priority Mail" style="width:100%;">') +
      '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:18px;flex-wrap:wrap;">' +
        (s.provider !== 'manual' ? '<button class="btn btn-secondary" onclick="FulfillV2.lpBack()">Back</button>' : '<span></span>') +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" onclick="MastUI.slideOut.requestClose()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="FulfillV2.lpSubmitManual()">Mark shipped</button>' +
        '</div>' +
      '</div>';
  }

  function lpPaintDone() {
    var t = LP.result || {};
    var url = t.labelUrl || '';
    return '<div style="padding:8px 0;text-align:center;">' +
      '<div style="font-size:1.6rem;">✅</div>' +
      '<h3 style="margin:8px 0;">Label purchased</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.9rem;margin:0 0 8px;">' + esc(t.carrier || '') + ' · ' + esc(t.trackingNumber || '') + '</p>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0 0 16px;">The order is marked shipped and tracking is saved.</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
        (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;">Open label PDF</a>' : '') +
        '<button class="btn btn-secondary" onclick="MastUI.slideOut.requestClose()">Done</button>' +
      '</div></div>';
  }

  function lpReadParcel() {
    var num = function (id) { var e = document.getElementById(id); return e ? (parseFloat(e.value) || 0) : 0; };
    return { lengthIn: num('lpLen'), widthIn: num('lpWid'), heightIn: num('lpHt'), weightOz: num('lpWt') };
  }

  function buyLabel(orderId) {
    var rec = V2.byId[orderId]; if (!rec) return;
    if (!canShipEdit()) { toast('You don\'t have permission to buy labels', true); return; }
    LP = { orderId: orderId, order: rec, step: 'loading', rates: [], selectedRate: null, selectedFromKey: '', selectedPreset: undefined };
    window.MastUI.slideOut.open({
      title: 'Buy shipping label',
      subtitle: 'Order ' + (rec.orderNumber || orderId),
      size: 'md', mode: 'read', deepLink: false,
      bodyHtml: '<div id="lpRoot"><div style="padding:24px;text-align:center;color:var(--warm-gray);">Loading shipping options…</div></div>',
      onClose: function () { LP = null; }
    });
    Promise.all([lpGetProvider(), lpGetLocations(), lpGetPresets()]).then(function (res) {
      if (!LP || LP.orderId !== orderId) return; // panel closed or replaced
      LP.provider = res[0] || 'manual';
      LP.locations = res[1] || {};
      LP.presets = res[2] || [];
      LP.autoWeight = lpCalcWeight(rec);
      LP.step = (LP.provider === 'manual') ? 'manual' : 'configure';
      lpPaint();
    }).catch(function (e) {
      if (lpRoot()) lpRoot().innerHTML = '<div style="padding:20px;color:var(--danger);">Couldn\'t load shipping setup: ' + esc(e && e.message || e) + '</div>';
    });
  }

  function lpGetRates() {
    var s = LP; if (!s) return;
    var btn = document.getElementById('lpRatesBtn');
    var loc = s.locations[s.selectedFromKey];
    if (!loc || !loc.address1) { toast('Selected location has no address', true); return; }
    var parcel = lpReadParcel();
    if (!parcel.weightOz) { toast('Weight is required', true); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Getting rates…'; }
    lpIdToken().then(function (token) {
      return window.callCF('/shippingGetRates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          tenantId: MastDB.tenantId(),
          from: { name: loc.name || '', address1: loc.address1, address2: loc.address2 || '', city: loc.city, state: loc.state, zip: loc.zip, phone: loc.phone || '0000000000', email: 'info@runmast.com' },
          to: lpShipTo(s.order),
          parcel: parcel
        })
      });
    }).then(function (resp) {
      return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
    }).then(function (r) {
      if (!LP || LP.orderId !== s.orderId) return;
      if (!r.ok) { LP.rateError = (r.data && r.data.error) || 'Failed to get rates'; LP.rates = []; LP.step = 'rates'; lpPaint(); return; }
      var rates = (r.data.result && r.data.result.rates) || r.data.rates || [];
      rates.sort(function (a, b) { return parseFloat(a.price || 0) - parseFloat(b.price || 0); });
      LP.rates = rates; LP.rateError = null; LP.selectedRate = rates.length ? 0 : null; LP.step = 'rates'; lpPaint();
    }).catch(function (e) {
      toast('Error getting rates: ' + (e && e.message || e), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Get rates'; }
    });
  }

  // Persist exactly like legacy #ship: status→shipped, shippedAt, full tracking{}
  // (incl. transactionId so a later void works), statusHistory, audit, then the
  // canonical onOrderShipped CF (inventory deduction + shipped email).
  function lpPersistShipped(order, orderId, result, rate, provider, manualNote) {
    var now = new Date().toISOString();
    var carrier = result.carrier || (rate && rate.carrier) || '';
    var history = (order && order.statusHistory) ? order.statusHistory.slice() : [];
    history.push({ status: 'shipped', at: now, by: 'admin', note: manualNote || (carrier + ' via ' + (provider || 'shippo')) });
    var tracking = {
      carrier: carrier,
      trackingNumber: result.trackingNumber || '',
      trackingUrl: result.trackingUrl || '',
      shipmentId: result.shipmentId || '',
      transactionId: result.transactionId || '',
      labelUrl: result.labelUrl || '',
      labelProvider: result.labelProvider || provider || 'shippo',
      purchasedAt: now,
      voidedAt: null
    };
    return Promise.resolve(MastDB.orders.update(orderId, { status: 'shipped', shippedAt: now, tracking: tracking, statusHistory: history }))
      .then(function () { try { if (window.writeAudit) return window.writeAudit('update', 'orders', orderId); } catch (e) {} })
      .then(function () {
        try { return firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() }); }
        catch (e) { /* best-effort; tracking is already persisted */ }
      })
      .catch(function (e) { console.error('[fulfillment-v2] onOrderShipped', e); });
  }

  function lpBuy() {
    var s = LP; if (!s || s.selectedRate === null) return;
    if (!canShipEdit()) { toast('You don\'t have permission to buy labels', true); return; }
    var rate = s.rates[s.selectedRate]; if (!rate) return;
    s.step = 'buying'; lpPaint();
    lpIdToken().then(function (token) {
      return window.callCF('/shippingBuyLabel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tenantId: MastDB.tenantId(), rateId: rate.id, orderId: s.orderId })
      });
    }).then(function (resp) {
      return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
    }).then(function (r) {
      if (!LP || LP.orderId !== s.orderId) return;
      if (!r.ok) {
        // Buy failed → DO NOT mark shipped. Stay on rates so the user can retry.
        toast((r.data && r.data.error) || 'Failed to buy label', true);
        LP.step = 'rates'; lpPaint();
        return;
      }
      var result = r.data.result || r.data;
      return lpPersistShipped(s.order, s.orderId, result, rate, s.provider).then(function () {
        if (!LP || LP.orderId !== s.orderId) return;
        LP.result = { carrier: result.carrier || rate.carrier || '', trackingNumber: result.trackingNumber || '', labelUrl: result.labelUrl || '' };
        LP.step = 'done'; lpPaint();
        toast('Label purchased — order shipped');
      });
    }).catch(function (e) {
      // Network/persist error after the buy attempt → never silently mark shipped.
      toast('Error buying label: ' + (e && e.message || e), true);
      if (LP && LP.orderId === s.orderId) { LP.step = 'rates'; lpPaint(); }
    });
  }

  function lpSubmitManual() {
    var s = LP; if (!s) return;
    if (!canShipEdit()) { toast('You don\'t have permission to mark orders shipped', true); return; }
    var carrier = (document.getElementById('lpMCarrier') || {}).value || 'Other';
    var track = (((document.getElementById('lpMTrack') || {}).value) || '').trim();
    var noteIn = (((document.getElementById('lpMNote') || {}).value) || '').trim();
    if (!track) { toast('Please enter a tracking number', true); return; }
    var url = (window.TRACKING_URLS && TRACKING_URLS[carrier]) ? TRACKING_URLS[carrier](track) : '';
    var result = { carrier: carrier, trackingNumber: track, trackingUrl: url, labelProvider: 'manual' };
    s.step = 'buying'; lpPaint();
    lpPersistShipped(s.order, s.orderId, result, { carrier: carrier }, 'manual', noteIn || (carrier + ' ' + track)).then(function () {
      if (!LP || LP.orderId !== s.orderId) return;
      LP.result = { carrier: carrier, trackingNumber: track, labelUrl: '' };
      LP.step = 'done'; lpPaint();
      toast('Order marked shipped');
    }).catch(function (e) {
      toast('Couldn\'t mark shipped: ' + (e && e.message || e), true);
      if (LP && LP.orderId === s.orderId) { LP.step = 'manual'; lpPaint(); }
    });
  }

  window.FulfillV2 = {
    sort: function (key) {
      if (key === '_advance') return;
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setBucket: function (b) { V2.bucket = b; render(); },
    open: open,
    advance: advance,
    buyLabel: buyLabel,
    lpSetFrom: function (v) { if (LP) LP.selectedFromKey = v; },
    lpSetPreset: function (v) {
      if (!LP) return;
      var dims = document.getElementById('lpDims');
      if (v === 'custom') { LP.selectedPreset = undefined; if (dims) dims.style.display = 'flex'; }
      else {
        var i = parseInt(v, 10); LP.selectedPreset = i;
        var p = LP.presets[i];
        if (p) {
          var set = function (id, val) { var e = document.getElementById(id); if (e) e.value = (val == null ? '' : val); };
          set('lpLen', p.lengthIn); set('lpWid', p.widthIn); set('lpHt', p.heightIn);
        }
        if (dims) dims.style.display = 'none';
      }
    },
    lpGetRates: lpGetRates,
    lpSelectRate: function (i) { if (LP) { LP.selectedRate = i; lpPaint(); } },
    lpBack: function () { if (LP) { LP.step = 'configure'; LP.rates = []; LP.selectedRate = null; lpPaint(); } },
    lpManual: function () { if (LP) { LP.step = 'manual'; lpPaint(); } },
    lpSubmitManual: lpSubmitManual,
    lpBuy: lpBuy,
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), 'fulfillment-' + V2.bucket); }
  };

  // Both routes land in the SAME queue; the route only picks the entry bucket.
  function setupFor(bucket) {
    return function () {
      ensureTab();
      V2.bucket = bucket;
      MastAdmin.loadModule('orders-v2').then(function () { render(); load(); })
        .catch(function (e) { console.error('[fulfillment-v2] setup', e); });
    };
  }
  MastAdmin.registerModule('fulfillment-v2', {
    routes: {
      'pack-v2': { tab: 'fulfillmentV2Tab', setup: setupFor('pick') },
      'ship-v2': { tab: 'fulfillmentV2Tab', setup: setupFor('ship') }
    }
  });
})();
