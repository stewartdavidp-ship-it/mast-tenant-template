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
 * Create + edit are NATIVE here: a custom detail.editRender (the legacy add-modal
 * field set — name, email, notes — plus the subscribed/unsubscribed status the
 * legacy unsubscribe path toggles) + an onSave that DELEGATES to
 * window.NewsletterBridge (exposed in newsletter.js) so the subscriber record
 * write, the active-email dedup + email validation, and the unsubscribe status
 * stamp stay single-sourced — this twin never reimplements that logic (mirrors
 * the contacts-v2 / ContactsBridge precedent). Legacy "add subscriber" is a pure
 * record write (it does NOT send a welcome/confirmation email), so create stays a
 * plain write through the bridge — there is no send to route.
 *
 * Sending issues, A/B tests and the whole campaign Composer have no V2 home and
 * stay single-sourced on legacy #newsletter via a "compose / send in classic
 * view" link. Flag-gated (?ui=1) at #newsletter-v2, side-by-side.
 *
 * Data: subscribers live at newsletter/subscribers (MastDB.newsletter.subscribers
 * -> that path; legacy reads it via .ref().once('value')). One-shot keyed-object
 * read — fields per record: email, name, status ('active'|'unsubscribed'),
 * source ('manual'|'website-form'), subscribedAt (ISO), unsubscribedAt, notes,
 * unsubscribeToken, and Resend webhook health flags (bounceFlag / complaintFlag).
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
      { name: 'status', label: 'Status', type: 'status', list: true,
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

        // Subscriber create/edit is NATIVE now (the Edit button on this slide-out).
        // What has NO V2 home: composing + sending issues, A/B tests, and the
        // campaign Composer — those stay bespoke on legacy #newsletter.
        // navigateToClassic so the V2 route remap doesn't loop back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="NewsletterV2.classic()">Compose / send issues in classic view →</button></div>';

        return tiles +
          UI.card('Subscriber', details) +
          UI.card('Delivery health', healthBody) +
          UI.card('Notes', notesBody + manage);
      },
      // Native edit form — the legacy add-modal field set (name *, email *, notes)
      // plus the subscribed/unsubscribed status the legacy unsubscribe path
      // toggles. source / subscribedAt / unsubscribeToken / health flags are
      // system-owned (not editable; a partial update preserves them).
      editRender: function (s, mode) {
        s = s || {};
        var st = statusOf(s);
        var statusOpts = [['active', 'Subscribed'], ['unsubscribed', 'Unsubscribed']].map(function (o) {
          return '<option value="' + o[0] + '"' + (st === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New subscriber' : 'Edit this subscriber') + '</div>' +
          fg('Name *', '<input class="form-input" id="nlV2Name" value="' + esc(s.name || '') + '" style="width:100%;" placeholder="Subscriber name">') +
          fg('Email *', '<input class="form-input" type="email" id="nlV2Email" value="' + esc(s.email || '') + '" style="width:100%;" placeholder="email@example.com">') +
          row2(
            fg('Status', '<select class="form-input" id="nlV2Status" style="width:100%;">' + statusOpts + '</select>', true),
            fg('Notes', '<input class="form-input" id="nlV2Notes" value="' + esc(s.notes || '') + '" style="width:100%;">', true)
          );
      }
    },
    onSave: function (rec, mode) {
      if (!window.NewsletterBridge) { if (window.showToast) showToast('Newsletter engine still loading — try again', true); return false; }
      var data = {
        name: ((document.getElementById('nlV2Name') || {}).value || '').trim(),
        email: ((document.getElementById('nlV2Email') || {}).value || '').trim(),
        notes: ((document.getElementById('nlV2Notes') || {}).value || '').trim(),
        status: (document.getElementById('nlV2Status') || {}).value || 'active'
      };
      // Mirror legacy nlSaveSubscriber validation exactly.
      if (!data.name || !data.email) { if (window.showToast) showToast('Name and email are required', true); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { if (window.showToast) showToast('Invalid email address', true); return false; }

      if (mode === 'create') {
        if (window.NewsletterBridge.isDuplicate(data.email)) { if (window.showToast) showToast('This email is already subscribed', true); return false; }
        return Promise.resolve(window.NewsletterBridge.create(data)).then(function () {
          if (window.showToast) showToast('Subscriber added'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[newsletter-v2] create', e); if (window.showToast) showToast('Error adding subscriber.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.NewsletterBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        var live = V2.byId[id] || rec;
        live.name = data.name; live.email = data.email; live.notes = data.notes || null;
        if (data.status !== live.status) {
          live.status = data.status;
          live.unsubscribedAt = data.status === 'unsubscribed' ? new Date().toISOString() : null;
        }
        if (window.showToast) showToast('Subscriber updated'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[newsletter-v2] update', e); if (window.showToast) showToast('Error updating subscriber.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'subscribedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure the legacy newsletter module is loaded so window.NewsletterBridge
    // (the delegated write path) + its in-memory nlSubscribers (dedup source)
    // exist — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('newsletter'); } catch (e) {} }
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
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

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
        actionsHtml: '<button class="btn btn-primary" onclick="NewsletterV2.create()">+ New subscriber</button>' +
          '<button class="btn btn-secondary" onclick="NewsletterV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search email or name…" value="' + esc(V2.q) +
        '" oninput="NewsletterV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('newsletter-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'NewsletterV2.sort', onRowClickFnName: 'NewsletterV2.open',
        empty: { title: 'No subscribers', message: V2.loaded ? 'Add a subscriber to get started.' : 'Loading…' }
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
    create: function () {
      // Ensure the legacy module (and thus window.NewsletterBridge + nlSubscribers)
      // is loaded before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('newsletter'); } catch (e) {} }
      MastEntity.openRecord('newsletter-v2', {}, 'create');
    },
    // Subscriber create/edit is native here. Composing + sending issues, A/B
    // tests, and the campaign Composer have no V2 home → classic Newsletter view.
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
