/**
 * reorder-v2.js — Tier 1 Work Item D: the "Needs reorder" queue.
 *
 * Scans materials + tracked products that have fallen to/below their reorder
 * threshold, resolves each to a preferred vendor (productSuppliers.preferred,
 * else the lone active supplier), and one-click drafts grouped purchase orders
 * (one DRAFT PO per vendor). Suggested quantity is intentionally simple — the
 * material's reorderQty (or threshold − onHand), and threshold − available for
 * products — NOT a demand forecast. Every PO is a draft for review (never
 * auto-sent), matching the universal pattern in the competitor research.
 *
 * Reads only (MastDB.get). The PO-creation write goes through
 * ProcurementBridge.createDraftPOs in the baselined procurement.js, so this twin
 * holds no MastDB write verbs (RBAC ratchet). Flag-gated (?ui=1), reached from
 * the procurement-v2 header; not a sidebar route.
 *
 * Variant products (variants.length > 0) are skipped: reorder is product-level
 * and there are no per-variant reorder points yet. (Fast-follow.)
 */
(function () {
  'use strict';
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  // Un-gated (Tier 1.5 P7, 2026-06-06): the procurement domain is the V2 default
  // for all users — no ?ui=1 required. The shared engine (MastEntity/MastUI) is
  // loaded unconditionally at boot, so self-registering here is always safe.

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var R = { materials: {}, products: {}, suppliers: {}, vendors: {}, suggestions: [], loaded: false };

  function activeSuppliersFor(kind, id) {
    return Object.keys(R.suppliers).map(function (k) { return R.suppliers[k]; })
      .filter(function (ps) { return ps && ps.active !== false && ps.targetKind === kind && ps.targetId === id; });
  }
  function preferredVendor(kind, id) {
    var list = activeSuppliersFor(kind, id);
    var ps = list.filter(function (p) { return p.preferred; })[0] || (list.length === 1 ? list[0] : null);
    return ps ? { vendorId: ps.vendorId, ps: ps } : null;
  }
  function vendorName(vid) { return (R.vendors[vid] && R.vendors[vid].name) || '(unknown vendor)'; }

  function computeSuggestions() {
    var out = [];
    Object.keys(R.materials).forEach(function (id) {
      var m = R.materials[id]; if (!m || m.status === 'archived') return;
      var thr = Number(m.reorderThreshold); if (!(thr > 0)) return;
      var onHand = Number(m.onHandQty) || 0;
      if (onHand > thr) return;
      var sug = Number(m.reorderQty) > 0 ? Number(m.reorderQty) : Math.max(1, thr - onHand);
      var pv = preferredVendor('material', id);
      out.push({
        kind: 'material', id: id, name: m.name || id, onHand: onHand, threshold: thr,
        uom: m.unitOfMeasure || '', suggestedQty: sug, vendorId: pv && pv.vendorId || null,
        unitCost: (pv && pv.ps && Number(pv.ps.unitCost)) || Number(m.unitCost) || 0,
        vendorSku: (pv && pv.ps && pv.ps.vendorSku) || null
      });
    });
    Object.keys(R.products).forEach(function (id) {
      var p = R.products[id]; if (!p || p.status === 'archived') return;
      if (p.acquisitionType === 'build') return;   // built in-house — replenished by building, not a PO
      if (Array.isArray(p.variants) && p.variants.length > 0) return;   // variant reorder deferred
      var si = p.stockInfo || {}; var st = si.stockType || '';
      if (!st || /order|build/.test(st) || si.totalAvailable == null) return;  // only tracked stock
      var thr = si.lowStockThreshold != null ? Number(si.lowStockThreshold) : 2;
      var avail = Number(si.totalAvailable) || 0;
      if (avail > thr) return;
      var pv = preferredVendor('product', id);
      out.push({
        kind: 'product', id: id, name: p.name || id, onHand: avail, threshold: thr,
        uom: '', suggestedQty: Math.max(1, thr - avail), vendorId: pv && pv.vendorId || null,
        unitCost: (pv && pv.ps && Number(pv.ps.unitCost)) || 0,
        vendorSku: (pv && pv.ps && pv.ps.vendorSku) || null
      });
    });
    out.sort(function (a, b) {
      return String(a.vendorId || 'zzz').localeCompare(String(b.vendorId || 'zzz')) || String(a.name).localeCompare(String(b.name));
    });
    return out;
  }

  function load() {
    return Promise.all([
      Promise.resolve(MastDB.get('admin/materials')),
      Promise.resolve(MastDB.products && MastDB.products.list ? MastDB.products.list() : MastDB.get('public/products')),
      Promise.resolve(MastDB.get('admin/productSuppliers')),
      Promise.resolve(MastDB.get('admin/vendors'))
    ]).then(function (res) {
      // Products live at public/products; list() returns array OR keyed — normalize to { pid: product }.
      R.materials = res[0] || {};
      R.products = (function (r) { var o = {}; (Array.isArray(r) ? r : Object.values(r || {})).forEach(function (p) { if (p) { var id = p.pid || p._key || p.id; if (id) o[id] = p; } }); return o; })(res[1]);
      R.suppliers = res[2] || {}; R.vendors = res[3] || {};
      R.suggestions = computeSuggestions(); R.loaded = true; render();
    }).catch(function (e) { console.error('[reorder-v2] load', e); render(); });
  }

  function ensureTab() {
    var el = document.getElementById('reorderV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'reorderV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var sug = R.suggestions;
    var withVendor = sug.filter(function (s) { return s.vendorId; });
    var vendorCount = Object.keys(withVendor.reduce(function (a, s) { a[s.vendorId] = 1; return a; }, {})).length;
    var rowsTable = U.relatedTable([
      { label: 'Item', render: function (s) { return esc(s.name) + ' <span class="mu-sub">· ' + esc(s.kind) + '</span>'; } },
      { label: 'On hand', align: 'right', render: function (s) { return esc(String(s.onHand)) + (s.uom ? ' ' + esc(s.uom) : ''); } },
      { label: 'Reorder at', align: 'right', render: function (s) { return esc(String(s.threshold)); } },
      { label: 'Suggested', align: 'right', render: function (s) { return esc(String(s.suggestedQty)); } },
      { label: 'Preferred vendor', render: function (s) { return s.vendorId ? esc(vendorName(s.vendorId)) : '<span class="mu-sub">set a preferred supplier</span>'; } }
    ], sug);
    var btn = withVendor.length
      ? '<button class="btn btn-primary" onclick="ReorderV2.createDrafts()">Create ' + vendorCount + ' draft PO' + (vendorCount === 1 ? '' : 's') + ' (' + withVendor.length + ' item' + (withVendor.length === 1 ? '' : 's') + ')</button>'
      : '';
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Needs reorder</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(sug.length) + ' below threshold</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="navigateTo(\'procurement-v2\')">← Purchase orders</button>' +
      '</div>' +
      '<div style="margin:12px 0;">' + btn + '</div>' +
      (sug.length
        ? U.cardTable('Suggestions', rowsTable)
        : '<div class="mu-sub" style="padding:20px;">' + (R.loaded ? 'Nothing below reorder threshold.' : 'Loading…') + '</div>');
  }

  window.ReorderV2 = {
    createDrafts: function () {
      var withVendor = R.suggestions.filter(function (s) { return s.vendorId; });
      if (!withVendor.length) return;
      if (!window.ProcurementBridge || typeof ProcurementBridge.createDraftPOs !== 'function') {
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return;
      }
      var byVendor = {};
      withVendor.forEach(function (s) {
        (byVendor[s.vendorId] = byVendor[s.vendorId] || []).push({
          kind: s.kind, targetId: s.id, variantKey: s.kind === 'product' ? '_default' : null,
          qtyOrdered: s.suggestedQty, unitCost: s.unitCost, vendorSku: s.vendorSku,
          unitOfMeasure: s.uom || null, descriptionSnapshot: s.name
        });
      });
      var groups = Object.keys(byVendor).map(function (vid) { return { vendorId: vid, lines: byVendor[vid] }; });
      var msg = 'Create ' + groups.length + ' draft PO' + (groups.length === 1 ? '' : 's') + ' from ' + withVendor.length + ' low item' + (withVendor.length === 1 ? '' : 's') + '?';
      var doIt = function () {
        ProcurementBridge.createDraftPOs(groups).then(function (ids) {
          if (window.showToast) showToast('Created ' + ids.length + ' draft PO' + (ids.length === 1 ? '' : 's'));
          if (typeof navigateTo === 'function') navigateTo('procurement-v2');
        }).catch(function (e) { if (window.showToast) showToast('Failed to create POs: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm(msg)).then(function (ok) { if (ok) doIt(); });
      else doIt();
    }
  };

  MastAdmin.registerModule('reorder-v2', {
    routes: { 'reorder-v2': { tab: 'reorderV2Tab', setup: function () {
      // Ensure the legacy procurement module is loaded so ProcurementBridge
      // (createDraftPOs) exists before the user acts.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
      ensureTab(); render(); load();
    } } }
  });
})();
