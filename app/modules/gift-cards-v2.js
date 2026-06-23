/**
 * gift-cards-v2.js — read-focused Faceted Record twin of the legacy issued
 * Gift Cards list (doc 17 §11/§12; conversion playbook).
 *
 * Legacy cart.js (#gift-cards, owned by the Cart module) hosts a config panel +
 * an issued-cards table that opens a read-only detail MODAL (_gcViewDetail).
 * This twin re-hosts ONLY that surface — the issued-cards list → read detail —
 * on the Entity Engine: a schema-driven list + a read-focused Faceted Record
 * slide-out (Overview facet). The gift-card SETTINGS (denominations, enable
 * toggle) are a different surface already covered by wallet-v2; this is the
 * issued-CARDS list.
 *
 * Variant (doc 17 §1a): a gift-card instance (code / amount / balance / buyer /
 * recipient) is a value record whose status (issued / claimed / expired) is an
 * ASSIGNED attribute — no governed lifecycle → Faceted Record, NOT Process/
 * MastFlow. A single Overview facet is correct here; the record is flat.
 *
 * Issuance is NATIVE here: two header actions — "Issue gift card" and "Promo
 * credit" — open a focused create form in the slide-out (kind-switched
 * editRender). onSave delegates to window.GiftCardsBridge.issue / .issuePromo
 * (added in cart.js), thin shims that replicate the EXACT legacy _gcIssueCard /
 * _gcIssuePromo writes (client-side code gen, the 'issued' / promotion object
 * shape, the permission gate, MastDB.giftCards.set + writeAudit) — this twin
 * reimplements NO issuance logic and adds NO direct MastDB write. Amounts are
 * entered in DOLLARS; the Bridge converts to amountCents = Math.round($*100).
 * The gift-card SETTINGS (denominations, enable toggle) are a different surface
 * already covered by wallet-v2, so the classic-view crutch is gone — every
 * capability this twin needs (view + issue + promo) now has a V2 home.
 *
 * Flag-gated (?ui=1) at #gift-cards-v2, side-by-side; reads issuance logic from
 * cart.js's GiftCardsBridge but never edits cart.js behavior.
 *
 * Data: issued cards live at admin/giftCards (MastDB.giftCards → that path);
 * the most reliable one-shot is MastDB.get('admin/giftCards') (keyed object,
 * key = card code). Money is CENTS (amountCents / balanceCents).
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

  // Status label/tone maps mirror the legacy gcStatusBadge intent (issued=blue,
  // claimed=green, expired=grey) translated onto the v2 tone vocabulary.
  var STATUS_LABEL = { issued: 'Issued', claimed: 'Claimed', expired: 'Expired' };
  var STATUS_TONE = { issued: 'info', claimed: 'success', expired: 'neutral' };

  function gcCode(gc) { return (gc && (gc._key || gc.code)) || '(no code)'; }
  function statusOf(gc) { return (gc && gc.status) || 'issued'; }
  // Balance falls back to the original amount when balanceCents is absent
  // (mirrors cart.js: balanceCents != null ? balanceCents : amountCents).
  function balanceCents(gc) { return (gc && gc.balanceCents != null) ? gc.balanceCents : (gc && gc.amountCents) || 0; }
  function balanceVal(gc) { var v = balanceCents(gc); return (v == null || isNaN(v)) ? null : Number(v) / 100; }
  function buyerOf(gc) { return (gc && gc.purchasedBy) || 'admin'; }
  // Recipient: explicit recipientEmail, else "self" for claimed (legacy default).
  function recipientOf(gc) { return (gc && gc.recipientEmail) || (statusOf(gc) === 'claimed' ? 'self' : ''); }
  function isMigrated(gc) { return gc && gc.source === 'migrated'; }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('gift-cards-v2', {
    label: 'Gift card', labelPlural: 'Gift cards', size: 'md',
    route: 'gift-cards-v2',
    recordId: function (gc) { return gc._key || gc.code; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real code string.
      { name: 'code', label: 'Code', type: 'text', list: true, readOnly: true, group: 'Gift card', get: gcCode },
      { name: 'amount', label: 'Amount', type: 'money', list: true, readOnly: true, align: 'right',
        get: function (gc) { return N.moneyVal(gc, 'amountCents', null); } },
      { name: 'balance', label: 'Balance', type: 'money', list: true, readOnly: true, align: 'right', get: balanceVal },
      { name: 'buyer', label: 'Buyer', type: 'text', list: true, readOnly: true, sortable: false, get: buyerOf },
      { name: 'recipient', label: 'Recipient', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (gc) { return recipientOf(gc) || '—'; } },
      { name: 'issuedAt', label: 'Issued', type: 'date', list: true, readOnly: true, get: function (gc) { return gc.issuedAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['issued', 'claimed', 'expired'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, gc) {
        var tiles = UI.tiles([
          { k: 'Amount', v: (N.money(N.moneyVal(gc, 'amountCents', null)) || '—'), hero: true },
          { k: 'Balance', v: (N.money(balanceVal(gc)) || '—') },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(gc)] || 'Issued', STATUS_TONE[statusOf(gc)] || 'neutral') },
          { k: 'Issued', v: gc.issuedAt ? N.date(gc.issuedAt) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Overview — code/amount/balance/status/buyer/recipient/issued/source,
        // plus the claim + order context the legacy detail modal surfaces.
        var card = UI.kv([
          { k: 'Code', v: '<span style="font-family:monospace;">' + esc(gcCode(gc)) + '</span>' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(gc)] || 'Issued', STATUS_TONE[statusOf(gc)] || 'neutral') +
              (isMigrated(gc) ? ' ' + UI.badge('Migrated', 'amber') : '') },
          { k: 'Original amount', v: N.money(N.moneyVal(gc, 'amountCents', null)) || '—' },
          { k: 'Balance', v: N.money(balanceVal(gc)) || '—' },
          { k: 'Issued', v: gc.issuedAt ? N.date(gc.issuedAt) : '—' },
          { k: 'Expires', v: gc.expiresAt ? N.date(gc.expiresAt) : '—' }
        ]);
        var people = UI.kv([
          { k: 'Buyer', v: esc(buyerOf(gc)) },
          { k: 'Recipient', v: recipientOf(gc) ? esc(recipientOf(gc)) : '—' },
          { k: 'Claimed by', v: gc.claimedBy ? esc(gc.claimedBy) : '—' },
          { k: 'Claimed', v: gc.claimedAt ? N.date(gc.claimedAt) : '—' },
          { k: 'Order', v: gc.orderNumber ? esc(gc.orderNumber) : '—' },
          { k: 'Source', v: isMigrated(gc) ? 'Migrated' + (gc.legacyPlatform ? ' · ' + esc(gc.legacyPlatform) : '') : 'Native' }
        ]);
        var noteBody = gc.adminNote
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(gc.adminNote) + '</div>'
          : '<span class="mu-sub">No note.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Gift card', card) +
            UI.card('People & order', people) +
            UI.card('Note', noteBody) +
          '</div>';
      }
    }
    // No schema onSave → an ISSUED card has no Edit affordance (matching legacy
    // _gcViewDetail, which is read-only; there is no legacy per-card edit write
    // to delegate to). Creation (issue / promo) is a separate create-mode slide-
    // out driven by GiftCardsV2.issue() / .promo() — see below — so the read
    // detail stays Edit-free while issuance is still native.
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'issuedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // One-shot keyed-object read at admin/giftCards (key = card code).
    Promise.resolve(MastDB.get('admin/giftCards')).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var gc = val[k];
        if (gc && typeof gc === 'object') { gc = Object.assign({ _key: k }, gc); gc.status = gc.status || 'issued'; out.push(gc); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[gift-cards-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the write settle, then re-read admin/giftCards

  // Can the operator issue? Mirror the engine-first RBAC convention (coupons-v2:
  // can('<route>','edit')). The authoritative gate still lives in the Bridge
  // (hasPermission giftCards/issue + wallet/grantCredit); this just hides the
  // header actions when the operator can't issue, so they never see a dead form.
  function canIssue() { return typeof window.can === 'function' ? window.can('gift-cards', 'edit') : true; }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (gc) { return statusOf(gc) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (gc) {
        return String(gcCode(gc)).toLowerCase().indexOf(q) >= 0 ||
               String(buyerOf(gc)).toLowerCase().indexOf(q) >= 0 ||
               String(recipientOf(gc)).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('gift-cards-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('giftCardsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'giftCardsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['issued', 'Issued'], ['claimed', 'Claimed'], ['expired', 'Expired']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="GiftCardsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Gift cards',
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'card'),
        actionsHtml:
          (canIssue() ? '<button class="btn btn-primary" onclick="GiftCardsV2.issue()">+ Issue gift card</button>' +
            '<button class="btn btn-secondary" onclick="GiftCardsV2.promo()">+ Promo credit</button>' : '') +
          '<button class="btn btn-secondary" onclick="GiftCardsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search code, buyer or recipient…" value="' + esc(V2.q) +
        '" oninput="GiftCardsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('gift-cards-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'GiftCardsV2.sort', onRowClickFnName: 'GiftCardsV2.open',
        empty: { title: 'No gift cards', message: V2.loaded ? 'Gift cards appear here when purchased at checkout or issued with “Issue gift card”.' : 'Loading…' }
      });
  }

  window.GiftCardsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'amount' || key === 'balance' || key === 'issuedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('gift-cards-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('gift-cards-v2', rec, 'read');
      });
    },
    // Native issuance — a create-mode slide-out (the SAME MastUI.slideOut the
    // Entity Engine drives) whose onSave delegates to GiftCardsBridge in cart.js.
    // Driven here (not via the engine schema's onSave) so an ISSUED card keeps
    // no Edit affordance. 'issue' mirrors _gcOpenManualIssue; 'promo' mirrors
    // _gcOpenPromoCredit. Amounts in DOLLARS (the Bridge does Math.round($*100)).
    issue: function () { openCreate('issue'); },
    promo: function () { openCreate('promo'); },
    exportCsv: function () { return MastEntity.exportRows('gift-cards-v2', visibleRows(), 'all'); }
  };

  // Build the create form (engine form primitives only — form-group/-label/-input,
  // mu-editbar/-editpill, mu-sub). kind: 'issue' | 'promo'.
  function createFormHtml(kind) {
    function fg(label, inner, hint) {
      return '<div class="form-group"><label class="form-label">' + esc(label) + '</label>' + inner +
        (hint ? '<div class="mu-sub" style="margin-top:2px;">' + esc(hint) + '</div>' : '') + '</div>';
    }
    var bar = '<div class="mu-editbar"><span class="mu-editpill">NEW</span>' +
      (kind === 'promo' ? 'New promotional credit' : 'Issue a gift card') + '</div>';
    if (kind === 'promo') {
      return bar +
        fg('Amount ($)', '<input class="form-input" type="number" id="gcV2PromoAmount" min="1" step="0.01" placeholder="10.00" style="width:100%;">') +
        fg('Expires in (days)', '<input class="form-input" type="number" id="gcV2PromoDays" min="1" max="365" value="30" style="width:100%;">', 'Short expiration encourages quick redemption.') +
        fg('Promo code (optional)', '<input class="form-input" id="gcV2PromoCode" placeholder="Auto-generated if blank" style="width:100%;text-transform:uppercase;">', 'Custom promo code for marketing (e.g. WELCOME10). Leave blank for random.') +
        fg('Recipient email', '<input class="form-input" type="email" id="gcV2PromoEmail" placeholder="customer@example.com" style="width:100%;">') +
        fg('Note (internal)', '<input class="form-input" id="gcV2PromoNote" placeholder="e.g. Welcome bonus for new subscriber" style="width:100%;">');
    }
    return bar +
      fg('Amount ($)', '<input class="form-input" type="number" id="gcV2IssueAmount" min="1" step="0.01" placeholder="50.00" style="width:100%;">') +
      fg('Recipient email (optional)', '<input class="form-input" type="email" id="gcV2IssueEmail" placeholder="customer@example.com" style="width:100%;">') +
      fg('Note (internal)', '<input class="form-input" id="gcV2IssueNote" placeholder="Reason for issuance" style="width:100%;">');
  }

  function openCreate(kind) {
    if (!canIssue()) { if (window.showToast) showToast('You do not have permission to issue gift cards.', true); return; }
    var promo = kind === 'promo';
    U.slideOut.open({
      id: 'new', deepLink: false,
      title: promo ? 'New promotional credit' : 'Issue gift card',
      size: 'md', mode: 'create',
      createLabel: promo ? 'Create credit' : 'Issue card',
      render: function () { return createFormHtml(kind); },
      isDirty: function () {
        var ids = promo ? ['gcV2PromoAmount', 'gcV2PromoCode', 'gcV2PromoEmail', 'gcV2PromoNote']
                        : ['gcV2IssueAmount', 'gcV2IssueEmail', 'gcV2IssueNote'];
        return ids.some(function (id) { var el = document.getElementById(id); return el && el.value && el.value.trim() !== ''; });
      },
      onSave: function () {
        var bridge = window.GiftCardsBridge;
        if (!bridge) { if (window.showToast) showToast('Gift card issuance is unavailable.', true); return false; }
        function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
        var p = promo
          ? bridge.issuePromo({ amountVal: val('gcV2PromoAmount'), days: val('gcV2PromoDays'), customCode: val('gcV2PromoCode'), email: val('gcV2PromoEmail'), note: val('gcV2PromoNote') })
          : bridge.issue({ amountVal: val('gcV2IssueAmount'), email: val('gcV2IssueEmail'), note: val('gcV2IssueNote') });
        return Promise.resolve(p).then(function (res) {
          if (!res || !res.code) return false;   // Bridge already toasted the reason (perms / bad amount / dup code)
          // Optimistic cache add so the card shows immediately; then a settle-
          // delayed reload re-reads admin/giftCards authoritatively.
          var row = Object.assign({ _key: res.code }, res.gcData);
          V2.byId[res.code] = row; V2.rows.unshift(row);
          reloadSoon();
          return true;
        }).catch(function (e) { console.error('[gift-cards-v2] issue', e); if (window.showToast) showToast('Failed to issue gift card.', true); return false; });
      }
    });
  }

  MastAdmin.registerModule('gift-cards-v2', {
    routes: { 'gift-cards-v2': { tab: 'giftCardsV2Tab', setup: function () {
      // Ensure the legacy cart module is loaded so window.GiftCardsBridge
      // (issue/issuePromo) exists when the operator opens an issue form.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('cart'); } catch (e) {} }
      ensureTab(); render(); load();
    } } }
  });
})();
