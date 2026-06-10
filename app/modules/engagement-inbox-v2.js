/**
 * engagement-inbox-v2.js — queue-archetype twin of the legacy Engagement
 * Inbox (standard-record-ui §10; marketing-v2-build-plan Wave 2).
 *
 * The inbox is the marketing-side roll-up of CS-owned data: one chronological
 * queue over cs_reviews + cs_tickets + admin/ugc_submissions with inferred
 * sentiment. Queue, not record: rows are WORK ("answer this", "approve this"),
 * each row carries a one-click action, and row click opens a read slide-out of
 * the underlying item. The cs-* routes keep their dedicated screens.
 *
 * Buckets: source (All / Reviews / Tickets / UGC) with count badges +
 * a needs-attention default lens (pending only) the operator can widen.
 *
 * Writes DELEGATE to window.EngagementBridge (exposed in engagement-inbox.js):
 * markReplied (reviews/tickets), approveUgc (creates the canonical Content
 * draft + social/story drafts), rejectUgc. Feature-on-site and
 * draft-social-from-review delegate to the customer-service helpers
 * (csFeatureReviewOnSite / csDraftSocialFromReview) like legacy. This module
 * never writes cs_* / ugc paths directly.
 *
 * Permission: surfaces cs_* data — actions gated on can('engagement-inbox',
 * 'edit') like the rest of the V2 surface (legacy gates the route on
 * customerService:read). Flag-gated (?ui=1) at #engagement-inbox-v2.
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

  var KIND_LABEL = { review: '★ Review', ticket: '💬 Ticket', ugc: '📸 UGC' };
  var SENTIMENT = {
    positive: { icon: '🟢', label: 'Positive' },
    neutral:  { icon: '🟡', label: 'Neutral' },
    negative: { icon: '🔴', label: 'Negative' }
  };
  var STATUS_TONE = {
    pending: 'amber', 'pending-review': 'amber', open: 'amber', in_progress: 'info',
    approved: 'teal', replied: 'success', closed: 'neutral', rejected: 'neutral', featured: 'success'
  };
  var RESOLVED = { replied: 1, closed: 1, rejected: 1 };

  // Sentiment inference mirrors legacy engagement-inbox.js exactly.
  var _NEG = ['broken', 'bad', 'refund', 'return', 'wrong', 'late', 'damaged', 'angry', 'disappointed', 'terrible', 'awful'];
  var _POS = ['thanks', 'love', 'great', 'amazing', 'beautiful', 'perfect', 'wonderful', 'excellent'];
  function sentimentForReview(r) {
    var rating = parseFloat(r.rating || 0);
    if (rating >= 4) return 'positive';
    if (rating > 0 && rating <= 2) return 'negative';
    return 'neutral';
  }
  function sentimentForTicket(t) {
    var text = ((t.subject || '') + ' ' + (t.body || '')).toLowerCase();
    var neg = _NEG.some(function (w) { return text.indexOf(w) !== -1; });
    var pos = _POS.some(function (w) { return text.indexOf(w) !== -1; });
    if (neg && !pos) return 'negative';
    if (pos && !neg) return 'positive';
    return 'neutral';
  }
  function ageRel(iso) {
    if (!iso) return '—';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    var mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(iso).toLocaleDateString();
  }
  function canEdit() { return typeof window.can !== 'function' || window.can('engagement-inbox', 'edit'); }
  function bridge() {
    if (window.EngagementBridge) return window.EngagementBridge;
    if (window.showToast) showToast('Inbox engine still loading — try again', true);
    return null;
  }

  // Read slide-out for the underlying item — the queue's row click target.
  MastEntity.define('engagement-inbox-v2', {
    label: 'Inbox item', labelPlural: 'Inbox items', size: 'md', route: 'engagement-inbox-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      { name: 'title', label: 'Item', type: 'text', list: true, readOnly: true,
        get: function (r) { return (KIND_LABEL[r.kind] || r.kind) + ' · ' + (r.customerName || 'Anonymous'); } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var raw = r.raw || {};
        var s = SENTIMENT[r.sentiment] || SENTIMENT.neutral;
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(String(r.status).replace(/[-_]/g, ' '), STATUS_TONE[r.status] || 'neutral'), hero: true },
          { k: 'Source', v: esc(KIND_LABEL[r.kind] || r.kind) },
          { k: 'Sentiment', v: s.icon + ' ' + s.label },
          { k: 'Received', v: ageRel(r.ageIso) }
        ]);

        var actions = canEdit() ? rowActions(r, true) : '';
        if (actions) actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;">' + actions + '</div>';

        var body = '';
        if (r.kind === 'review') {
          var stars = raw.rating ? '★'.repeat(Math.round(raw.rating)) + '☆'.repeat(Math.max(0, 5 - Math.round(raw.rating))) : '';
          body = UI.card('Review', (stars ? '<div style="color:var(--amber);margin-bottom:6px;">' + stars + '</div>' : '') +
            '<div style="font-size:0.9rem;line-height:1.55;white-space:pre-wrap;">' + esc(raw.text || raw.body || '(no text)') + '</div>');
        } else if (r.kind === 'ticket') {
          body = UI.card('Ticket', '<div style="font-weight:600;margin-bottom:6px;">' + esc(raw.subject || '(no subject)') + '</div>' +
            '<div style="font-size:0.9rem;line-height:1.55;white-space:pre-wrap;">' + esc(raw.body || '') + '</div>');
        } else if (r.kind === 'ugc') {
          body = UI.card('Photo submission', (raw.photoUrl ? '<div style="margin-bottom:8px;">' + UI.imageThumb(r.customerName || 'Photo', raw.photoUrl) + '</div>' : '') +
            '<div style="font-size:0.9rem;line-height:1.55;white-space:pre-wrap;">' + esc(raw.caption || '(no caption)') + '</div>' +
            (raw.handle ? '<div class="mu-sub" style="margin-top:6px;">' + esc(raw.handle) + '</div>' : ''));
        }

        var meta = UI.kv([
          { k: 'Customer', v: r.customerId
              ? '<a href="#customers?customerId=' + esc(r.customerId) + '" style="color:var(--teal);">' + esc(r.customerName) + '</a>'
              : esc(r.customerName || 'Anonymous') },
          { k: 'Received', v: r.ageIso ? N.date(r.ageIso) : '—' },
          { k: 'Manage in', v: r.kind === 'ugc' ? 'this inbox' : '<a href="#' + (r.kind === 'review' ? 'cs-reviews' : 'cs-tickets') + '" style="color:var(--teal);">Customer Service →</a>' }
        ]);

        return tiles + actions + body + UI.card('About', meta);
      }
    }
  });

  // -- module state + data ---------------------------------------------
  var V2 = { rows: [], byId: {}, sortKey: 'age', sortDir: 'asc', bucket: 'all', showResolved: false, busy: {}, loaded: false };

  function load() {
    // Ensure legacy engagement-inbox.js is loaded so window.EngagementBridge
    // (the delegated write path) exists.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('engagementInbox'); } catch (e) {} }
    Promise.all([
      Promise.resolve(MastDB.query('cs_reviews').limitToLast(200).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.query('cs_tickets').limitToLast(200).once()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/customers')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/ugc_submissions')).catch(function () { return null; })
    ]).then(function (res) {
      var reviews = res[0] || {}, tickets = res[1] || {}, customers = res[2] || {}, ugc = res[3] || {};
      if (reviews && reviews.val) reviews = reviews.val() || {};
      if (tickets && tickets.val) tickets = tickets.val() || {};
      if (customers && customers.val) customers = customers.val() || {};
      if (ugc && ugc.val) ugc = ugc.val() || {};

      // email → customer index for resolution (mirrors legacy).
      var byEmail = {};
      Object.keys(customers || {}).forEach(function (cid) {
        var c = customers[cid]; if (!c) return;
        (c.emails || [c.primaryEmail]).forEach(function (em) { if (em) byEmail[String(em).toLowerCase()] = c; });
      });

      var out = [];
      Object.keys(reviews).forEach(function (id) {
        var r = reviews[id] || {};
        var cust = byEmail[String(r.authorEmail || r.reviewerEmail || '').toLowerCase()];
        out.push({ _key: 'review:' + id, id: id, kind: 'review',
          customerId: cust ? cust.id : null,
          // No raw-email fallback — PII, not a display name (mirrors legacy).
          customerName: (cust && cust.displayName) || r.authorName || r.reviewerName || 'Anonymous',
          sentiment: sentimentForReview(r),
          preview: String(r.text || r.body || '').slice(0, 80),
          ageIso: r.createdAt || r.submittedAt || '', status: r.status || 'pending', raw: r });
      });
      Object.keys(tickets).forEach(function (id) {
        var t = tickets[id] || {};
        var email = String(t.contactEmail || '').toLowerCase();
        var cust = email ? byEmail[email] : null;
        out.push({ _key: 'ticket:' + id, id: id, kind: 'ticket',
          customerId: cust ? cust.id : null,
          customerName: (cust && cust.displayName) || t.contactName || 'Anonymous',
          sentiment: sentimentForTicket(t),
          preview: String(t.subject || t.body || '').slice(0, 80),
          ageIso: t.createdAt || '', status: t.status || 'pending', raw: t });
      });
      Object.keys(ugc || {}).forEach(function (sid) {
        var u = ugc[sid] || {};
        var cust = byEmail[String(u.customerEmail || '').toLowerCase()];
        out.push({ _key: 'ugc:' + sid, id: sid, kind: 'ugc',
          customerId: (cust && cust.id) || u.customerId || null,
          customerName: (cust && cust.displayName) || u.handle || 'Customer',
          sentiment: 'positive',
          preview: String(u.caption || 'Photo submission').slice(0, 80),
          ageIso: u.submittedAt || '', status: u.status || 'pending-review', raw: u });
      });

      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[engagement-inbox-v2] load', e); V2.loaded = true; render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }

  function isResolved(r) { return !!RESOLVED[r.status]; }
  function visibleRows() {
    var rows = V2.rows;
    if (V2.bucket !== 'all') rows = rows.filter(function (r) { return r.kind === V2.bucket; });
    if (!V2.showResolved) rows = rows.filter(function (r) { return !isResolved(r); });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      if (k === 'age') return r.ageIso || '';
      return r[k];
    });
  }
  function counts() {
    var c = { all: 0, review: 0, ticket: 0, ugc: 0 };
    V2.rows.forEach(function (r) {
      if (V2.showResolved || !isResolved(r)) { c.all++; c[r.kind]++; }
    });
    return c;
  }

  // Per-row one-click actions — the queue's work verbs. `wide` = slide-out
  // variant (adds the CS delegations for reviews).
  function rowActions(r, wide) {
    if (!canEdit()) return '';
    var k = esc(r._key);
    var out = '';
    if (r.kind === 'ugc' && r.status === 'pending-review') {
      out += '<button class="btn btn-primary btn-small" onclick="event.stopPropagation();EngageV2.approveUgc(\'' + k + '\')">Approve</button> ' +
             '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();EngageV2.rejectUgc(\'' + k + '\')">Reject</button>';
    } else if ((r.kind === 'review' || r.kind === 'ticket') && !isResolved(r)) {
      out += '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();EngageV2.markReplied(\'' + k + '\')">Mark replied ✓</button>';
      if (wide && r.kind === 'review' && r.status === 'approved') {
        out += ' <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();EngageV2.feature(\'' + k + '\')">⭐ Feature on site</button>';
      }
      if (wide && r.kind === 'review') {
        out += ' <button class="btn btn-secondary btn-small" onclick="event.stopPropagation();EngageV2.draftSocial(\'' + k + '\')">✍ Draft social post</button>';
      }
    }
    return out;
  }

  function columns() {
    return [
      { key: 'kind', label: 'Source', render: function (r) { return esc(KIND_LABEL[r.kind] || r.kind); } },
      { key: 'customerName', label: 'Customer', render: function (r) { return esc(r.customerName || 'Anonymous'); } },
      { key: 'sentiment', label: '', sortable: false, align: 'center',
        render: function (r) { var s = SENTIMENT[r.sentiment] || SENTIMENT.neutral; return '<span title="' + s.label + '">' + s.icon + '</span>'; } },
      { key: 'preview', label: 'Preview', render: function (r) { return esc(r.preview || ''); } },
      { key: 'age', label: 'Age', align: 'right', render: function (r) { return '<span class="mu-sub">' + ageRel(r.ageIso) + '</span>'; } },
      { key: 'status', label: 'Status',
        render: function (r) { return U.badge(String(r.status).replace(/[-_]/g, ' '), STATUS_TONE[r.status] || 'neutral'); } },
      { key: '_act', label: '', sortable: false, align: 'right',
        render: function (r) { return V2.busy[r._key] ? '…' : rowActions(r, false); } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('engagementInboxV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'engagementInboxV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Engagement Inbox' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var c = counts();
    var pills = [['all', 'All'], ['review', 'Reviews'], ['ticket', 'Tickets'], ['ugc', '📸 UGC']].map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="EngageV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      U.pageHeader({
        title: 'Engagement Inbox',
        count: N.count(c.all) + ' need' + (c.all === 1 ? 's' : '') + ' attention',
        subtitle: 'Reviews, tickets and customer photos in one queue. Social DMs/comments join when the platform integration lands.',
        actionsHtml:
          '<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--warm-gray);margin-right:10px;">' +
            '<input type="checkbox"' + (V2.showResolved ? ' checked' : '') + ' onchange="EngageV2.toggleResolved(this.checked)"> Show resolved</label>' +
          '<button class="btn btn-secondary" onclick="EngageV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      MastEntity.renderList('engagement-inbox-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'EngageV2.sort', onRowClickFnName: 'EngageV2.open',
        empty: { title: 'Inbox zero 🎉', message: V2.showResolved ? 'Nothing here at all.' : 'Nothing needs attention. Toggle "Show resolved" for history.' }
      });
  }

  function withBusy(key, work) {
    if (V2.busy[key]) return;
    V2.busy[key] = true; render();
    Promise.resolve(work()).then(function () { delete V2.busy[key]; render(); })
      .catch(function (e) {
        delete V2.busy[key]; render();
        console.error('[engagement-inbox-v2]', e);
        if (window.showToast) showToast('Action failed: ' + (e && e.message || e), true);
      });
  }

  window.EngageV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setBucket: function (b) { V2.bucket = b; render(); },
    toggleResolved: function (v) { V2.showResolved = !!v; render(); },
    open: function (key) { var rec = V2.byId[key]; if (rec) MastEntity.openRecord('engagement-inbox-v2', rec, 'read'); },
    _reopen: function (key) { var rec = V2.byId[key]; if (rec) MastEntity.openRecord('engagement-inbox-v2', rec, 'read'); },
    markReplied: function (key) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission for inbox actions.', true); return; }
      var b = bridge(); if (!b) return;
      var r = V2.byId[key]; if (!r) return;
      withBusy(key, function () {
        return b.markReplied(r.kind, r.id).then(function () {
          r.status = 'replied';
          if (window.showToast) showToast('Marked replied.');
        });
      });
    },
    approveUgc: function (key) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission for inbox actions.', true); return; }
      var b = bridge(); if (!b) return;
      var r = V2.byId[key]; if (!r) return;
      withBusy(key, function () {
        return b.approveUgc(r.id, r.raw, r.customerName, r.customerId).then(function (contentId) {
          r.status = 'approved'; if (r.raw) { r.raw.status = 'approved'; r.raw.contentId = contentId; }
          if (window.showToast) showToast('Approved — social + story drafts created.');
        });
      });
    },
    rejectUgc: function (key) {
      if (!canEdit()) { if (window.showToast) showToast('You don\'t have permission for inbox actions.', true); return; }
      var b = bridge(); if (!b) return;
      var r = V2.byId[key]; if (!r) return;
      Promise.resolve(window.mastConfirm
        ? mastConfirm('Reject this photo submission? The photo stays in storage for audit but won\'t be used.', { title: 'Reject photo?', confirmLabel: 'Reject', dangerous: true })
        : true).then(function (ok) {
        if (!ok) return;
        withBusy(key, function () {
          return b.rejectUgc(r.id).then(function () {
            r.status = 'rejected'; if (r.raw) r.raw.status = 'rejected';
            if (window.showToast) showToast('Submission rejected.');
          });
        });
      });
    },
    feature: function (key) {
      var r = V2.byId[key]; if (!r || r.kind !== 'review') return;
      MastAdmin.loadModule('customer-service').then(function () {
        if (typeof window.csFeatureReviewOnSite !== 'function') throw new Error('Customer Service module not loaded');
        return window.csFeatureReviewOnSite(r.id);
      }).then(function () {
        if (window.showToast) showToast('Featured on site.');
      }).catch(function (e) { console.error('[engagement-inbox-v2] feature', e); if (window.showToast) showToast('Feature failed.', true); });
    },
    draftSocial: function (key) {
      var r = V2.byId[key]; if (!r || r.kind !== 'review') return;
      MastAdmin.loadModule('customer-service').then(function () {
        if (typeof window.csDraftSocialFromReview !== 'function') throw new Error('Customer Service module not loaded');
        return window.csDraftSocialFromReview(r.id);
      }).catch(function (e) { console.error('[engagement-inbox-v2] draftSocial', e); if (window.showToast) showToast('Could not draft social post.', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('engagement-inbox-v2', visibleRows(), V2.bucket); }
  };

  MastAdmin.registerModule('engagement-inbox-v2', {
    routes: { 'engagement-inbox-v2': { tab: 'engagementInboxV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
