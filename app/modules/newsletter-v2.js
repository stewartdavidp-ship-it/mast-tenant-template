/**
 * newsletter-v2.js — read-focused Flat/Faceted Record twin of the legacy
 * Newsletter SUBSCRIBERS surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy newsletter.js (#newsletter, owned by the Newsletter module) hosts two
 * things: a campaign Composer/Grid Builder (out of scope) and a subscribers
 * list rendered as a wide table (renderNLSubscribers). This twin re-hosts ONLY
 * the subscribers list -> subscriber read detail on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out.
 *
 * Variant (doc 17 §1a): a subscriber is a simple person record (email, name,
 * status, source, subscribed date) with NO governed lifecycle — its status
 * (active / unsubscribed) is an assigned attribute, not a workflow phase ->
 * Flat/Faceted Record, NOT Process/MastFlow. The record is genuinely flat, so a
 * single Overview facet carries it (no invented facets, no pane tabs).
 *
 * Read-focused: adding/removing subscribers, sending issues, A/B tests and the
 * whole campaign Composer stay single-sourced on legacy #newsletter via a
 * "manage in classic view" link. This twin re-hosts the subscriber VIEW only —
 * no onSave, no edit form. Flag-gated (?ui=1) at #newsletter-v2, side-by-side;
 * never touches newsletter.js.
 *
 * Data: subscribers live at newsletter/subscribers (MastDB.newsletter.subscribers
 * -> that path; legacy reads it via .ref().once('value')). One-shot keyed-object
 * read — fields per record: email, name, status ('active'|'unsubscribed'),
 * source ('manual'|'website-form'), subscribedAt (ISO), unsubscribedAt, notes,
 * and Resend webhook health flags (bounceFlag / complaintFlag).
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

  var STATUS_LABEL = { active: 'Subscribed', unsubscribed: 'Unsubscribed' };
  var STATUS_TONE = { active: 'success', unsubscribed: 'neutral' };
  var SOURCE_LABEL = { 'website-form': 'Website', manual: 'Manual' };

  function subName(s) { return (s && s.name) || '(no name)'; }
  function subEmail(s) { return (s && s.email) || '—'; }
  function statusOf(s) { return (s && s.status) || 'active'; }
  function sourceOf(s) { return (s && s.source) || 'manual'; }
  function sourceLabel(s) { var v = sourceOf(s); return SOURCE_LABEL[v] || (v ? String(v) : 'Manual'); }
  // Health flag from the Resend webhook — bounce wins, then complaint.
  function healthLabel(s) {
    if (s && s.bounceFlag) return 'Bounced';
    if (s && s.complaintFlag) return 'Complaint';
    return null;
  }

  // ── schema (read-only Flat/Faceted Record) ──────────────────────────
  MastEntity.define('newsletter-v2', {
    label: 'Subscriber', labelPlural: 'Subscribers', size: 'md',
    route: 'newsletter-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real email string.
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, group: 'Subscriber', get: subEmail },
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, get: function (s) { return s.name || '—'; } },
      { name: 'source', label: 'Source', type: 'text', list: true, readOnly: true, get: sourceLabel,
        tone: function () { return 'teal'; } },
      { name: 'subscribedAt', label: 'Subscribed', type: 'date', list: true, readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'unsubscribed'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, s) {
        var health = healthLabel(s);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Subscribed', STATUS_TONE[statusOf(s)] || 'neutral'), hero: true },
          { k: 'Subscribed', v: s.subscribedAt ? esc(N.date(s.subscribedAt)) : '—' },
          { k: 'Source', v: esc(sourceLabel(s)) },
          { k: 'Health', v: health ? UI.badge(health, 'danger') : '<span class="mu-sub">OK</span>' }
        ]);

        // Single Overview facet — the record is genuinely flat (no cheap related
        // collection to warrant a second facet or pane tabs).
        var details = UI.kv([
          { k: 'Email', v: s.email ? esc(s.email) : '—' },
          { k: 'Name', v: s.name ? esc(s.name) : '—' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(s)] || 'Subscribed', STATUS_TONE[statusOf(s)] || 'neutral') },
          { k: 'Source', v: esc(sourceLabel(s)) },
          { k: 'Subscribed', v: s.subscribedAt ? esc(N.date(s.subscribedAt)) : '—' },
          { k: 'Unsubscribed', v: s.unsubscribedAt ? esc(N.date(s.unsubscribedAt)) : '—' }
        ]);

        var healthBody = health
          ? UI.kv([
              { k: 'Flag', v: UI.badge(health, 'danger') },
              { k: 'Flagged', v: esc((s.bounceFlagAt || s.complaintFlagAt) ? N.date(s.bounceFlagAt || s.complaintFlagAt) : '—') }
            ])
          : '<span class="mu-sub">No delivery issues reported.</span>';

        var notesBody = s.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(s.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        // Editing subscribers + sending/composing stays on legacy #newsletter.
        // Use navigateToClassic so the V2 route remap doesn't loop us back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="NewsletterV2.classic()">Manage in classic view →</button></div>';

        return tiles +
          UI.card('Subscriber', details) +
          UI.card('Delivery health', healthBody) +
          UI.card('Notes', notesBody + manage);
      }
    }
    // No onSave → no Edit button (subscriber editing stays on legacy #newsletter).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'subscribedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Subscribers — one-shot keyed-object read at the same path legacy reads.
    Promise.resolve(MastDB.get('newsletter/subscribers')).catch(function () { return null; })
      .then(function (sv) {
        var tree = sv || {};
        var out = [];
        Object.keys(tree).forEach(function (k) {
          var s = tree[k];
          if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'active'; out.push(s); }
        });
        V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
        V2.loaded = true; render();
      }).catch(function (e) { console.error('[newsletter-v2] load', e); render(); });
  }

  function activeCount() { return V2.rows.filter(function (s) { return statusOf(s) === 'active'; }).length; }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return statusOf(s) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return String(s.email || '').toLowerCase().indexOf(q) >= 0 ||
               String(s.name || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('newsletter-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('newsletterV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'newsletterV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Subscribed'], ['unsubscribed', 'Unsubscribed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="NewsletterV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Subscribers',
        count: N.count(activeCount()) + ' subscribed · ' + N.count(V2.rows.length) + ' total',
        actionsHtml: '<button class="btn btn-secondary" onclick="NewsletterV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search email or name…" value="' + esc(V2.q) +
        '" oninput="NewsletterV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('newsletter-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'NewsletterV2.sort', onRowClickFnName: 'NewsletterV2.open',
        empty: { title: 'No subscribers', message: V2.loaded ? 'Add subscribers in the classic Newsletter view.' : 'Loading…' }
      });
  }

  window.NewsletterV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'subscribedAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('newsletter-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('newsletter-v2', rec, 'read');
      });
    },
    // Subscriber editing + the campaign Composer → classic Newsletter view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('newsletter');
      else if (typeof navigateTo === 'function') navigateTo('newsletter');
    },
    exportCsv: function () { return MastEntity.exportRows('newsletter-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('newsletter-v2', {
    routes: { 'newsletter-v2': { tab: 'newsletterV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
