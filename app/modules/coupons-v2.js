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
 * Create + edit are NATIVE here: a custom detail.editRender (the legacy coupon
 * modal's field set — code/type/value/minOrder/status/validity/usage-caps/note/
 * exclude-sale) + an onSave that REPLICATES the exact client write the inline
 * saveCoupon in index.html makes — the SAME MastDB.coupons.set/update accessor +
 * path (admin/coupons keyed by CODE) + the SAME object shape (value/minOrder in
 * DOLLARS, never cents) + the SAME writeAudit('create'|'update','coupons',key)
 * call + the SAME validation. coupons writes DIRECTLY (no Bridge) because the
 * inline save is a plain MastDB write with no domain wrapper to fork. The
 * write/create handlers are RBAC-gated with can('coupons','edit') (the legacy
 * route axis), mirroring the shows.js gate convention. Only share/QR export has
 * NO V2 home (bespoke openCouponShareModal modal) and keeps a "share in classic
 * view" link via navigateToClassic. Flag-gated (?ui=1) at #coupons-v2,
 * side-by-side; never touches the legacy coupons code in index.html.
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
        // Create/edit is NATIVE now (the Edit button on this slide-out). Only
        // share/QR export has no V2 home — it stays a bespoke modal on legacy
        // #coupons. navigateToClassic so the V2 route remap doesn't loop here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="CouponsV2.classic()">Share / QR in classic view →</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Overview', overview) +
            UI.card('Admin note', note + manage) +
          '</div>';
      },
      // Native edit/create form — mirrors the legacy openCouponModal field set
      // exactly: code (required, locked on edit), type, value, minOrder, status,
      // startDate, endDate, isOneOff, maxUses, description, excludeSaleItems.
      // value + minOrder are entered/stored in DOLLARS (never cents), matching
      // saveCoupon's parseFloat handling.
      editRender: function (c, mode) {
        c = c || {};
        var isEdit = mode !== 'create';
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        var typeSel = '<select class="form-input" id="cpV2Type" style="width:100%;" onchange="CouponsV2.typeChanged()">' +
          '<option value="percent"' + (c.type === 'percent' || !c.type ? ' selected' : '') + '>Percent Off</option>' +
          '<option value="fixed"' + (c.type === 'fixed' ? ' selected' : '') + '>Fixed Amount</option>' +
          '</select>';
        var statusSel = '<select class="form-input" id="cpV2Status" style="width:100%;">' +
          '<option value="pending"' + (c.status === 'pending' ? ' selected' : '') + '>Pending</option>' +
          '<option value="active"' + (c.status === 'active' || !c.status ? ' selected' : '') + '>Active</option>' +
          '<option value="expired"' + (c.status === 'expired' ? ' selected' : '') + '>Expired</option>' +
          '</select>';
        var valuePh = (c.type === 'fixed') ? 'e.g. 5.00' : 'e.g. 15';
        var claimed = (c.claimedCount || 0);
        return '<div class="mu-editbar"><span class="mu-editpill">' + (isEdit ? 'EDITING' : 'NEW') + '</span>' + (isEdit ? 'Edit this coupon' : 'New coupon') + '</div>' +
          fg('Code *', '<input class="form-input" id="cpV2Code" value="' + esc(c.code || c._key || '') + '" style="width:100%;text-transform:uppercase;" placeholder="e.g. SUMMER20"' + (isEdit ? ' disabled' : '') + '>') +
          row2(
            fg('Type *', typeSel, true),
            fg('Value *', '<input class="form-input" type="number" id="cpV2Value" min="0" step="any" value="' + (c.value != null ? c.value : '') + '" style="width:100%;" placeholder="' + valuePh + '">', true)
          ) +
          fg('Minimum order ($)', '<input class="form-input" type="number" id="cpV2MinOrder" min="0" step="0.01" value="' + (c.minOrder != null ? c.minOrder : '') + '" style="width:100%;" placeholder="Optional">') +
          fg('Status *', statusSel) +
          row2(
            fg('Start date', '<input class="form-input" type="date" id="cpV2StartDate" value="' + esc(c.startDate || '') + '" style="width:100%;">', true),
            fg('End date', '<input class="form-input" type="date" id="cpV2EndDate" value="' + esc(c.endDate || '') + '" style="width:100%;">', true)
          ) +
          '<div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;font-weight:400;"><input type="checkbox" id="cpV2OneOff"' + (c.isOneOff ? ' checked' : '') + ' onchange="CouponsV2.oneOffChanged()"> One-off code (single use, auto-expires after claim)</label></div>' +
          '<div class="form-group" id="cpV2MaxUsesGroup"' + (c.isOneOff ? ' style="display:none;"' : '') + '><label class="form-label">Max uses</label><input class="form-input" type="number" id="cpV2MaxUses" min="1" value="' + (c.maxUses != null && !c.isOneOff ? c.maxUses : '') + '" style="width:100%;" placeholder="Unlimited"></div>' +
          fg('Description (admin note)', '<input class="form-input" id="cpV2Desc" value="' + esc(c.description || '') + '" style="width:100%;" placeholder="e.g. Summer promo for returning customers">') +
          '<div class="form-group"><label class="form-label" style="display:flex;align-items:center;gap:8px;font-weight:400;"><input type="checkbox" id="cpV2ExcludeSale"' + (c.excludeSaleItems ? ' checked' : '') + '> Exclude sale items (won\'t apply to products already on sale)</label></div>' +
          (isEdit ? '<div class="mu-sub" style="margin-top:8px;">Claimed: ' + claimed + ' time' + (claimed !== 1 ? 's' : '') + '</div>' : '');
      }
    },
    // Native onSave — replicates the inline saveCoupon write EXACTLY: same
    // accessor/path (MastDB.coupons.set/update, admin/coupons keyed by CODE),
    // same object shape (value/minOrder in DOLLARS), same writeAudit call, same
    // validation. RBAC-gated with can('coupons','edit') (shows.js convention).
    onSave: function (rec, mode) {
      var isEdit = mode !== 'create';
      if (typeof window.can === 'function' && !window.can('coupons', 'edit')) {
        if (window.showToast) showToast('You do not have permission to manage coupons.', true);
        return false;
      }
      var codeEl = document.getElementById('cpV2Code');
      var existingCode = isEdit ? (rec._key || rec.code) : '';
      var code = isEdit ? existingCode : (codeEl ? codeEl.value.trim().toUpperCase() : '');

      if (!isEdit) {
        if (!code) { if (window.showToast) showToast('Coupon code is required.', true); return false; }
        if (code.length > 30) { if (window.showToast) showToast('Code must be 30 characters or less.', true); return false; }
        if (V2.byId[code]) { if (window.showToast) showToast('A coupon with code "' + code + '" already exists.', true); return false; }
      }

      var type = (document.getElementById('cpV2Type') || {}).value || 'percent';
      var value = parseFloat((document.getElementById('cpV2Value') || {}).value);
      if (isNaN(value) || value <= 0) { if (window.showToast) showToast('Value must be greater than 0.', true); return false; }
      if (type === 'percent' && value > 100) { if (window.showToast) showToast('Percent value cannot exceed 100.', true); return false; }

      var minOrderVal = ((document.getElementById('cpV2MinOrder') || {}).value || '').trim();
      var minOrder = minOrderVal ? parseFloat(minOrderVal) : null;
      var status = (document.getElementById('cpV2Status') || {}).value || 'active';
      var startDate = (document.getElementById('cpV2StartDate') || {}).value || null;
      var endDate = (document.getElementById('cpV2EndDate') || {}).value || null;
      var isOneOff = !!(document.getElementById('cpV2OneOff') || {}).checked;
      var maxUsesVal = ((document.getElementById('cpV2MaxUses') || {}).value || '').trim();
      var maxUses = isOneOff ? 1 : (maxUsesVal ? parseInt(maxUsesVal, 10) : null);
      var description = ((document.getElementById('cpV2Desc') || {}).value || '').trim();
      var excludeSaleItems = !!(document.getElementById('cpV2ExcludeSale') || {}).checked;

      if (startDate && endDate && endDate < startDate) { if (window.showToast) showToast('End date must be after start date.', true); return false; }

      var key = isEdit ? existingCode : code;
      var data = {
        type: type,
        value: value,            // DOLLARS — mirrors saveCoupon (no cents conversion)
        status: status,
        startDate: startDate,
        endDate: endDate,
        isOneOff: isOneOff,
        maxUses: maxUses,
        description: description || null,
        minOrder: minOrder,      // DOLLARS
        excludeSaleItems: excludeSaleItems,
        updatedAt: new Date().toISOString()
      };
      if (!isEdit) { data.claimedCount = 0; data.createdAt = new Date().toISOString(); }

      if (isEdit) {
        return Promise.resolve(MastDB.coupons.update(key, data)).then(function () {
          return Promise.resolve(typeof writeAudit === 'function' ? writeAudit('update', 'coupons', key) : null);
        }).then(function () {
          // Mutate the LIVE cached record (=== the slide-out's read closure, since
          // fetch returns V2.byId[id]); the engine passes a copy to onSave. The
          // post-save read re-render then shows the edited fields immediately.
          Object.assign(V2.byId[key] || rec, data);
          if (window.showToast) showToast('Coupon updated.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[coupons-v2] update', e); if (window.showToast) showToast('Error saving coupon.', true); return false; });
      }
      return Promise.resolve(MastDB.coupons.set(key, data)).then(function () {
        return Promise.resolve(typeof writeAudit === 'function' ? writeAudit('create', 'coupons', key) : null);
      }).then(function () {
        V2.byId[key] = Object.assign({ _key: key, code: key }, data);
        if (window.showToast) showToast('Coupon created.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[coupons-v2] create', e); if (window.showToast) showToast('Error saving coupon.', true); return false; });
    }
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
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the write settle, then refresh the cache

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
        actionsHtml: '<button class="btn btn-primary" onclick="CouponsV2.create()">+ New coupon</button>' +
          '<button class="btn btn-secondary" onclick="CouponsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search code or note…" value="' + esc(V2.q) +
        '" oninput="CouponsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('coupons-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CouponsV2.sort', onRowClickFnName: 'CouponsV2.open',
        empty: { title: 'No coupons', message: V2.loaded ? 'Add a coupon to get started.' : 'Loading…' }
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
    create: function () { MastEntity.openRecord('coupons-v2', {}, 'create'); },
    // Edit-form interactivity — mirrors couponTypeChanged / couponOneOffChanged.
    typeChanged: function () {
      var t = document.getElementById('cpV2Type'), v = document.getElementById('cpV2Value');
      if (t && v) v.placeholder = (t.value === 'fixed') ? 'e.g. 5.00' : 'e.g. 15';
    },
    oneOffChanged: function () {
      var cb = document.getElementById('cpV2OneOff'), grp = document.getElementById('cpV2MaxUsesGroup');
      if (!cb || !grp) return;
      grp.style.display = cb.checked ? 'none' : '';
      if (cb.checked) { var m = document.getElementById('cpV2MaxUses'); if (m) m.value = ''; }
    },
    // Only share / QR export has no V2 home (bespoke openCouponShareModal) →
    // classic Coupons view. Create + edit are native here. navigateToClassic so
    // the V2 route remap doesn't loop us back to this twin.
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
