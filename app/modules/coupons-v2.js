/**
 * coupons-v2.js — read-focused Faceted Record twin of the legacy Coupons surface
 * (doc 17 §11/§12; conversion playbook).
 *
 * Legacy coupons live INSIDE app/index.html (not a module): loadCoupons /
 * renderCoupons / getCouponEffectiveStatus / formatCouponValue render the
 * #coupons tab (a desktop table + mobile cards), and create/edit/delete/share
 * run through openCouponModal / saveCoupon / confirmDeleteCoupon /
 * openCouponShareModal. This twin re-hosts the list to detail VIEW on the Entity
 * Engine: a schema-driven list + a read-focused Faceted Record slide-out.
 *
 * Variant (doc 17 §1a): a coupon (code + discount + usage limits + validity +
 * status) is a Faceted Record with NO governed lifecycle — its effective status
 * (active / pending / expired) is a DERIVED attribute computed from the stored
 * status + dates + claim count (mirrors legacy getCouponEffectiveStatus), not a
 * gated multi-phase workflow → Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: creating / editing / issuing a coupon is a multi-field modal
 * (code, type/value, validity, usage caps, share/QR export) wired into the core
 * shell and stays single-sourced on legacy #coupons via a "manage in classic
 * view" link. This twin re-hosts the VIEW only — no onSave, no edit form.
 * Flag-gated (?ui=1) at #coupons-v2, side-by-side; never touches the legacy
 * coupons code in index.html.
 *
 * Data: coupons live at admin/coupons (MastDB.coupons -> that path), keyed by the
 * coupon CODE; one-shot read via MastDB.coupons.list() / MastDB.get('admin/coupons').
 * value + minOrder are stored in DOLLARS (not cents) — formatCouponValue / the
 * legacy table use $value.toFixed(2); percent values render as N%.
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

  var STATUS_LABEL = { active: 'Active', pending: 'Pending', expired: 'Expired' };
  var STATUS_TONE = { active: 'success', pending: 'info', expired: 'neutral' };

  // ── pure helpers (mirror the legacy coupons code in index.html) ─────────
  function todayStr() {
    var now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }
  // Effective status — replicates getCouponEffectiveStatus(): stored 'expired'
  // wins; 'pending' auto-activates once startDate passes; 'active' flips to
  // 'expired' once endDate passes, a one-off is claimed, or maxUses is reached.
  function effectiveStatus(c) {
    if (!c) return 'expired';
    if (c.status === 'expired') return 'expired';
    if (c.status === 'pending') {
      if (c.startDate && c.startDate <= todayStr()) return 'active';
      return 'pending';
    }
    if (c.endDate && c.endDate < todayStr()) return 'expired';
    if (c.isOneOff && (c.claimedCount || 0) > 0) return 'expired';
    if (c.maxUses && (c.claimedCount || 0) >= c.maxUses) return 'expired';
    return 'active';
  }
  // Discount label — "20%" or "$10.00" (value is DOLLARS, mirrors formatCouponValue).
  function discountText(c) {
    if (!c) return '';
    if (c.type === 'percent') return (c.value != null ? c.value : 0) + '%';
    return N.money(c.value || 0) || '$0.00';
  }
  function discountLong(c) {
    return discountText(c) + ' off';
  }
  function usageLimitNum(c) {
    if (!c) return null;
    if (c.isOneOff) return 1;
    return (c.maxUses != null && c.maxUses !== '') ? c.maxUses : null; // null = unlimited
  }
  function usageText(c) {
    var used = (c && c.claimedCount) || 0;
    var lim = usageLimitNum(c);
    return N.count(used) + ' / ' + (lim == null ? '∞' : N.count(lim));
  }
  // Validity window — "From X", "Until Y", "X – Y", or em-dash (mirrors legacy dateStr).
  function validityText(c) {
    if (!c) return '—';
    if (c.startDate && c.endDate) return N.date(c.startDate) + ' – ' + N.date(c.endDate);
    if (c.startDate) return 'From ' + N.date(c.startDate);
    if (c.endDate) return 'Until ' + N.date(c.endDate);
    return '—';
  }
  function minOrderText(c) {
    return (c && c.minOrder) ? (N.money(c.minOrder) || '—') : '—';
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────────
  MastEntity.define('coupons-v2', {
    label: 'Coupon', labelPlural: 'Coupons', size: 'md',
    route: 'coupons-v2',
    recordId: function (c) { return c._key || c.code || c.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes the coupon CODE.
      { name: 'code', label: 'Code', type: 'text', list: true, readOnly: true, group: 'Coupon',
        get: function (c) { return c.code || c._key || ''; } },
      { name: 'discount', label: 'Discount', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (c) { return discountText(c); } },
      { name: 'usage', label: 'Usage', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (c) { return usageText(c); } },
      { name: 'expiry', label: 'Expiry', type: 'text', list: true, readOnly: true,
        get: function (c) { return c.endDate ? N.date(c.endDate) : '—'; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'pending', 'expired'],
        get: effectiveStatus,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      // Faceted Record — composes the same MastUI primitives the stock templates
      // use. Single Overview facet (a coupon is one flat object); status drives
      // the header badge via the type:'status' field above.
      render: function (UI, c) {
        var eff = effectiveStatus(c);
        var tiles = UI.tiles([
          { k: 'Discount', v: esc(discountText(c)), hero: true },
          { k: 'Usage', v: esc(usageText(c)) },
          { k: 'Expiry', v: c.endDate ? esc(N.date(c.endDate)) : '—' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[eff] || eff, STATUS_TONE[eff] || 'neutral') }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        var overview = UI.kv([
          { k: 'Code', v: esc(c.code || c._key || '') },
          { k: 'Discount', v: esc(discountLong(c)) },
          { k: 'Usage', v: esc(usageText(c)) },
          { k: 'One-off', v: c.isOneOff ? 'Yes (single use)' : 'No' },
          { k: 'Min order', v: esc(minOrderText(c)) },
          { k: 'Validity', v: esc(validityText(c)) },
          { k: 'Excludes sale items', v: c.excludeSaleItems ? 'Yes' : 'No' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[eff] || eff, STATUS_TONE[eff] || 'neutral') }
        ]);
        var note = c.description
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(c.description) + '</div>'
          : '<span class="mu-sub">No admin note.</span>';
        // Editing / issuing / sharing a coupon stays on legacy #coupons. Use
        // navigateToClassic so the V2 route remap doesn't loop us back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="CouponsV2.classic()">Manage in classic view →</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Overview', overview) +
            UI.card('Admin note', note + manage) +
          '</div>';
      }
    }
    // No onSave → no Edit button (coupon editing/issuing stays on legacy #coupons).
  });

  // ── module state + data ─────────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'status', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function toRows(tree) {
    var out = []; tree = tree || {};
    Object.keys(tree).forEach(function (code) {
      var c = tree[code];
      if (c && typeof c === 'object') { out.push(Object.assign({ _key: code, code: code }, c)); }
    });
    return out;
  }

  function load() {
    // One-shot keyed-object read of admin/coupons (keyed by code).
    Promise.resolve(MastDB.coupons.list()).then(function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[coupons-v2] load', e); V2.loaded = true; render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (c) { return effectiveStatus(c) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (c) {
        return String(c.code || c._key || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('coupons-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('couponsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'couponsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['expired', 'Expired']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CouponsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Coupons',
        count: N.count(V2.rows.length) + ' coupon' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="CouponsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search code or note…" value="' + esc(V2.q) +
        '" oninput="CouponsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('coupons-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CouponsV2.sort', onRowClickFnName: 'CouponsV2.open',
        empty: { title: 'No coupons', message: V2.loaded ? 'Add coupons in the classic Coupons view.' : 'Loading…' }
      });
  }

  window.CouponsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'expiry' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('coupons-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('coupons-v2', rec, 'read');
      });
    },
    // Coupon editing / issuing / sharing → classic Coupons view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('coupons');
      else if (typeof navigateTo === 'function') navigateTo('coupons');
    },
    exportCsv: function () { return MastEntity.exportRows('coupons-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('coupons-v2', {
    routes: { 'coupons-v2': { tab: 'couponsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
