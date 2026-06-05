/**
 * duplicates-v2.js — the RESOLVE micro-surface (doc 17 §9, §11).
 *
 * A duplicate is a RELATIONSHIP between two customers, not an attribute of one.
 * So the flag is a first-class record with a focused compare-and-decide slide-out,
 * reached only from a list-level queue. This fixes the legacy IA where "Duplicates"
 * was a false peer tab of a single customer detail.
 *
 * Flag-gated (uiRedesign); self-mounts on route #duplicates-v2 side-by-side with
 * the legacy customers Duplicates tab. The merge itself reuses the existing,
 * battle-tested window.customersMerge (legacy customers.js) — this surface only
 * presents the comparison and routes the decision.
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var STATUS_TONE = { active: 'success', lapsed: 'danger', lead: 'info', vip: 'amber' };
  var DUP = { flags: [], custs: {}, active: null, off: null };

  function spend(c) { return ((c && c.stats && c.stats.lifetimeSpendCents) || 0) / 100; }
  function orderCount(c) { return (c && c.stats && c.stats.orderCount) || 0; }

  // ── Data ────────────────────────────────────────────────────────────
  function load() {
    if (!window.MastDB || !MastDB.query) return;
    MastDB.query('admin/customerDuplicates').orderByChild('detectedAt').limitToLast(50).once('value')
      .then(function (snap) {
        var v = (snap && typeof snap.val === 'function') ? snap.val() : snap;
        var flags = [];
        Object.keys(v || {}).forEach(function (k) {
          var f = v[k];
          if (f && typeof f === 'object' && (f.status === 'open' || !f.status)) flags.push(Object.assign({ id: k }, f));
        });
        flags.sort(function (a, b) { return String(b.detectedAt || '').localeCompare(String(a.detectedAt || '')); });
        DUP.flags = flags;
        // Fetch every referenced customer once (for labels + compare).
        var ids = {};
        flags.forEach(function (f) { if (f.customerIdA) ids[f.customerIdA] = 1; if (f.customerIdB) ids[f.customerIdB] = 1; });
        return Promise.all(Object.keys(ids).map(function (id) {
          return Promise.resolve(MastDB.get('admin/customers/' + id))
            .then(function (c) { if (c) DUP.custs[id] = Object.assign({ id: id }, c); }).catch(function () {});
        }));
      })
      .then(render)
      .catch(function (e) { console.error('[duplicates-v2] load', e); });
  }
  function label(id) { var c = DUP.custs[id]; return c ? (c.displayName || c.primaryEmail || id) : id; }

  // ── List (the queue) ────────────────────────────────────────────────
  function ensureTab() {
    var el = document.getElementById('duplicatesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'duplicatesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  function render() {
    var tab = ensureTab();
    var head = '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
      '<h1 style="font-size:1.6rem;margin:0;">Duplicate flags</h1>' +
      '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(DUP.flags.length) + ' pending</span></div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">A uid + email resolved to two different customers. Review each pair and keep one.</div>';
    if (!DUP.flags.length) {
      tab.innerHTML = head + '<div style="padding:46px 20px;text-align:center;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:8px;">✓</div>' +
        '<div style="font-size:1.15rem;color:var(--text-primary);">No pending duplicates</div>' +
        '<div style="font-size:0.85rem;margin-top:4px;">When the resolver flags a conflict, it shows up here.</div></div>';
      return;
    }
    var rows = DUP.flags.map(function (f) {
      return '<button class="mast-row" style="display:flex;width:100%;text-align:left;align-items:center;gap:12px;background:var(--surface-card,var(--card-bg));border:1px solid var(--border,rgba(127,127,127,.2));border-radius:10px;padding:14px 18px;margin-bottom:10px;cursor:pointer;color:var(--text-primary);font:inherit;" onclick="DuplicatesV2.open(\'' + esc(f.id) + '\')">' +
        '<div style="flex:1;min-width:0;"><div style="font-size:0.9rem;"><strong>' + esc(label(f.customerIdA)) + '</strong> &harr; <strong>' + esc(label(f.customerIdB)) + '</strong></div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(f.reason || 'duplicate detected') + '</div></div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);flex-shrink:0;">' + esc(f.detectedAt ? N.date(f.detectedAt) : '') + '</div>' +
        '<span style="color:var(--warm-gray);flex-shrink:0;">›</span></button>';
    }).join('');
    tab.innerHTML = head + rows;
  }

  // ── Resolve slide-out (compare + decide) ────────────────────────────
  function compareRow(k, va, vb, recA) {
    var diff = String(va) !== String(vb);
    var bg = diff ? 'background:color-mix(in srgb,var(--warning,var(--amber)) 9%,transparent);' : '';
    var cell = 'padding:11px 14px;font-size:0.9rem;display:flex;align-items:center;gap:8px;' + bg;
    return '<div style="display:grid;grid-template-columns:150px 1fr 1fr;border-bottom:1px solid var(--border,rgba(127,127,127,.15));">' +
      '<div style="padding:11px 14px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);background:var(--surface-dark,var(--bg-secondary));">' + esc(k) + '</div>' +
      '<div style="' + cell + '">' + va + '</div><div style="' + cell + '">' + vb + '</div></div>';
  }
  function buildBody(f, a, b, winnerIsA) {
    function badge(c) { var s = String(c && c.status || '').toLowerCase(); return U.badge(c && c.status || '—', STATUS_TONE[s] || 'neutral'); }
    var rec = '<span style="font-size:0.72rem;font-weight:700;color:var(--success);border:1px solid color-mix(in srgb,var(--success) 35%,transparent);border-radius:999px;padding:1px 7px;margin-left:8px;">RECOMMENDED</span>';
    var headGrid = '<div style="display:grid;grid-template-columns:150px 1fr 1fr;margin-bottom:2px;">' +
      '<div></div>' +
      '<div style="padding:0 14px 10px;font-weight:600;">Customer A' + (winnerIsA ? rec : '') + '<div style="font-size:0.72rem;color:var(--warm-gray);font-weight:400;">' + esc(a.primaryEmail || '') + '</div></div>' +
      '<div style="padding:0 14px 10px;font-weight:600;">Customer B' + (!winnerIsA ? rec : '') + '<div style="font-size:0.72rem;color:var(--warm-gray);font-weight:400;">' + esc(b.primaryEmail || '') + '</div></div></div>';
    var grid = '<div style="border:1px solid var(--border,rgba(127,127,127,.2));border-radius:12px;overflow:hidden;">' +
      compareRow('Name', esc(a.displayName || '—'), esc(b.displayName || '—')) +
      compareRow('Email', esc(a.primaryEmail || '—'), esc(b.primaryEmail || '—')) +
      compareRow('Orders', N.count(orderCount(a)) + (winnerIsA ? ' <span style="font-size:0.72rem;color:var(--success);">keeps history</span>' : ''), N.count(orderCount(b)) + (!winnerIsA ? ' <span style="font-size:0.72rem;color:var(--success);">keeps history</span>' : '')) +
      compareRow('Lifetime spend', N.money(spend(a)), N.money(spend(b))) +
      compareRow('Status', badge(a), badge(b)) +
      compareRow('First seen', esc(a.createdAt ? N.date(a.createdAt) : '—'), esc(b.createdAt ? N.date(b.createdAt) : '—')) +
      compareRow('Source', esc(a.source || '—'), esc(b.source || '—')) +
    '</div>';
    var w = winnerIsA ? a : b, l = winnerIsA ? b : a;
    var preview = '<div style="margin-top:18px;">' + U.card('If you keep ' + (winnerIsA ? 'A' : 'B'),
      '<div style="font-size:0.9rem;color:var(--warm-gray-light);line-height:1.7;">' +
        '&#10003; <strong>' + N.count(orderCount(w) + orderCount(l)) + ' orders</strong> combined under ' + esc(w.primaryEmail || label(w.id)) + '<br>' +
        '&#10003; <strong>' + N.money(spend(w) + spend(l)) + '</strong> lifetime spend combined<br>' +
        '&#10003; the other email kept as a <strong>secondary email</strong> (no data lost)<br>' +
        '&#10003; status recomputed from the merged order cadence</div>') + '</div>';
    var reason = '<div style="background:color-mix(in srgb,var(--warning,var(--amber)) 12%,var(--surface-card,var(--card-bg)));border:1px solid color-mix(in srgb,var(--warning,var(--amber)) 30%,var(--border));border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.9rem;color:var(--warm-gray-light);"><span style="color:var(--warning,var(--amber));">&#9888;</span> ' + esc(f.reason || 'A uid and email resolved to two different customers.') + ' Detected ' + esc(f.detectedAt ? N.date(f.detectedAt) : 'recently') + '. Keep one — the other merges into it (orders, enrollments, wallet move over).</div>';
    return reason + headGrid + grid + preview;
  }

  // ── Public handlers ─────────────────────────────────────────────────
  window.DuplicatesV2 = {
    open: function (flagId) {
      var f = DUP.flags.filter(function (x) { return x.id === flagId; })[0];
      if (!f) return;
      var a = DUP.custs[f.customerIdA], b = DUP.custs[f.customerIdB];
      if (!a || !b) { if (window.showToast) showToast('One of the customers is missing', true); return; }
      DUP.active = f;
      var winnerIsA = orderCount(a) >= orderCount(b);  // more history wins by default
      U.slideOut.open({
        id: 'dup-' + f.id, size: 'lg', mode: 'read', title: 'Duplicate flag',
        badges: [{ label: 'Pending', tone: 'warning' }],
        render: function () { return buildBody(f, a, b, winnerIsA); },
        actions: [
          { label: 'Not a duplicate', onClickFnName: 'DuplicatesV2.dismiss' },
          { label: 'Keep B', onClickFnName: 'DuplicatesV2.keepB' },
          { label: (winnerIsA ? 'Keep A — merge B in' : 'Keep A'), primary: true, onClickFnName: 'DuplicatesV2.keepA' }
        ]
      });
    },
    keepA: function () { _merge(function (f) { return [f.customerIdA, f.customerIdB]; }); },
    keepB: function () { _merge(function (f) { return [f.customerIdB, f.customerIdA]; }); },
    dismiss: function () {
      var f = DUP.active; if (!f || !window.MastDB) return;
      MastDB.set('admin/customerDuplicates/' + f.id + '/status', 'dismissed')
        .then(function () { if (window.showToast) showToast('Dismissed'); _after(); })
        .catch(function (e) { if (window.showToast) showToast('Could not dismiss: ' + (e && e.message), true); });
    }
  };

  function _merge(pick) {
    var f = DUP.active; if (!f) return;
    var ensure = window.customersMerge ? Promise.resolve()
      : (window.MastAdmin && MastAdmin.loadModule ? MastAdmin.loadModule('customers') : Promise.reject(new Error('merge unavailable')));
    ensure.then(function () {
      var ids = pick(f);  // [winnerId, loserId]
      // window.customersMerge runs its own confirm + reindex + marks the flag merged.
      return window.customersMerge(f.id, ids[0], ids[1]);
    }).then(function () { _after(); })
      .catch(function (e) { console.error('[duplicates-v2] merge', e); if (window.showToast) showToast('Merge failed: ' + (e && e.message || e), true); });
  }
  function _after() {
    try { U.slideOut.requestCloseForce(); } catch (e) { try { U.slideOut.requestClose(); } catch (e2) {} }
    DUP.active = null; DUP.custs = {}; load();
  }

  MastAdmin.registerModule('duplicates-v2', {
    routes: { 'duplicates-v2': { tab: 'duplicatesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
