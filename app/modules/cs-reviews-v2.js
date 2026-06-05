/**
 * cs-reviews-v2.js — read-focused Faceted Record twin of the legacy Customer-
 * Service Reviews surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy customer-service.js (#cs-reviews, owned by the Customer-Service module)
 * hosts reviews as a stack of cards with inline moderation (Approve / Reject /
 * Respond / Feature-on-site / Draft-social / Ask-for-photo) plus an anonymous-
 * policy settings card. This twin re-hosts ONLY the reviews list -> read detail
 * VIEW on the Entity Engine: a schema-driven list + a read-focused Faceted Record
 * slide-out (a single Overview facet).
 *
 * Variant (doc 17 §1a): a product review is a content record (product / rating /
 * author / text + an operator reply) whose status (pending / approved / rejected)
 * is an ASSIGNED attribute, not a governed lifecycle -> Faceted Record, NOT
 * Process/MastFlow.
 *
 * Interactive-read: the core MODERATION actions (Approve / Reject / Feature-on-
 * site / Unfeature) are surfaced NATIVELY as action buttons in the read slide-out
 * (mirrors cs-tickets-v2 / duplicates-v2 — action buttons in read mode, no edit
 * form). Each button delegates to window.CsReviewsBridge, the thin shim in
 * customer-service.js that wraps the EXISTING moderation logic (cs_reviews status
 * write + the W1.8 Testimonials-promotion path) so it stays single-sourced — this
 * twin never reimplements moderation or business rules. After an action the live
 * V2.byId[id] is updated from the bridge's returned doc and the record + list
 * re-open/refresh.
 *
 * Reviews are user-generated CONTENT: status (pending/approved/rejected) is an
 * assigned attribute, so the operator MODERATES — there is intentionally NO path
 * to rewrite a customer's review text. The remaining workflows that DO touch
 * review-adjacent content or have no V2 home — the public REPLY (Respond / Edit /
 * Delete response, with its cs_review_responses audit log), Draft Social Post,
 * Ask-for-photo (UGC upload link), and the anonymous-review POLICY settings card
 * — stay on legacy #cs-reviews via a single "More actions" link (navigateToClassic
 * so the V2 route remap doesn't loop back here). Flag-gated (?ui=1) at
 * #cs-reviews-v2, side-by-side with legacy #cs-reviews.
 *
 * Data: reviews live at cs_reviews (one-shot keyed-object read via MastDB.get).
 * Fields mirror the submitReview CF + legacy renderReviews: productName (snapshot
 * -- USE IT, never paint a raw productId), productId, rating (1-5), body, headline,
 * authorName/reviewerName, authorEmail/reviewerEmail, status (pending/approved/
 * rejected), createdAt/updatedAt, response {body,authorName,createdAt,updatedAt}.
 * A best-effort products read resolves a snapshot-less productId to a name (same
 * as the legacy product index); failures are non-fatal.
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

  // status -> label/tone. Legacy default for a status-less review is 'pending'
  // (reviewBadge in customer-service.js). approved -> live on site.
  var STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
  var STATUS_TONE = { pending: 'amber', approved: 'success', rejected: 'danger' };

  function statusOf(r) { return (r && r.status) || 'pending'; }
  function authorOf(r) { return (r && (r.authorName || r.reviewerName)) || 'Anonymous'; }
  function emailOf(r) { return (r && (r.authorEmail || r.reviewerEmail)) || ''; }
  function ratingOf(r) { var n = r && Number(r.rating); return (n && !isNaN(n)) ? n : 0; }
  function bodyOf(r) { return (r && r.body) || ''; }

  // True for a Firebase push-id (e.g. "-Ooa73tvVja..."). Used so we never paint a
  // raw id where a human-readable product name belongs (mirrors csIsRawId).
  function isRawId(s) { return typeof s === 'string' && /^-[A-Za-z0-9_-]{15,}$/.test(s); }
  // Best human product label: snapshotted productName -> product index name ->
  // "(product)" when only a raw push-id remains. Never leaks an id.
  function productLabel(r) {
    var idx = (r && r.productId) ? V2.productIndex[r.productId] : null;
    var label = (r && r.productName) || (idx && idx.name) || '';
    if (!label || isRawId(label)) return '(product)';
    return label;
  }
  // Rating cell/tile: "★★★★☆ 4/5" (filled/hollow stars + numeric, like legacy
  // starsHtml). Unrated -> em-dash handled by callers / displayCell.
  function ratingStars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += (i <= (n || 0) ? '★' : '☆');
    return out;
  }
  function ratingText(r) {
    var n = ratingOf(r);
    return n ? (ratingStars(n) + ' ' + n + '/5') : '';
  }
  // fields[0] (the slide-out title source) materializes a real string:
  // "<author> on <product>" -> e.g. "Jane Doe on Amber Tumbler".
  function reviewTitle(r) { return authorOf(r) + ' on ' + productLabel(r); }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('cs-reviews-v2', {
    label: 'Review', labelPlural: 'Reviews', size: 'lg',
    route: 'cs-reviews-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      // fields[0] = title source. Not in the list (the list has dedicated
      // product/author columns); it only names the slide-out.
      { name: 'title', label: 'Review', type: 'text', readOnly: true, group: 'Review', get: reviewTitle },
      { name: 'product', label: 'Product', type: 'text', list: true, readOnly: true, get: productLabel },
      { name: 'rating', label: 'Rating', type: 'text', list: true, readOnly: true, align: 'right',
        get: function (r) { return ratingText(r) || '—'; } },
      { name: 'author', label: 'Author', type: 'text', list: true, readOnly: true, get: authorOf },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['pending', 'approved', 'rejected'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } },
      { name: 'createdAt', label: 'Date', type: 'date', list: true, readOnly: true, get: function (r) { return (r && r.createdAt) || null; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var tiles = UI.tiles([
          { k: 'Rating', v: (ratingText(r) || '—'), hero: true },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(r)] || 'Pending', STATUS_TONE[statusOf(r)] || 'neutral') },
          { k: 'Product', v: esc(productLabel(r)) },
          { k: 'Date', v: (r.createdAt ? N.date(r.createdAt) : '—') }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Overview — the review fields, the review text, and any operator reply.
        var meta = UI.kv([
          { k: 'Product', v: esc(productLabel(r)) },
          { k: 'Rating', v: (ratingText(r) || '—') },
          { k: 'Author', v: esc(authorOf(r)) },
          { k: 'Email', v: (emailOf(r) ? esc(emailOf(r)) : '—') },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(r)] || 'Pending', STATUS_TONE[statusOf(r)] || 'neutral') },
          { k: 'Submitted', v: (r.createdAt ? N.date(r.createdAt) : '—') }
        ]);

        var headlineHtml = r.headline
          ? '<div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;color:var(--charcoal,var(--text));">' + esc(r.headline) + '</div>'
          : '';
        var reviewBody = bodyOf(r)
          ? headlineHtml + '<div style="font-size:0.9rem;line-height:1.5;white-space:pre-wrap;color:var(--charcoal,var(--text));">' + esc(bodyOf(r)) + '</div>'
          : (r.headline ? headlineHtml : '<span class="mu-sub">No review text.</span>');

        // Operator reply (response {body,authorName,createdAt,updatedAt}). Editing
        // it stays on legacy #cs-reviews; this twin only displays it.
        var resp = r.response || null;
        var replyBody;
        if (resp && resp.body) {
          var who = resp.authorName || 'Shop response';
          var when = resp.updatedAt || resp.createdAt;
          replyBody =
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
              '<span style="font-weight:600;font-size:0.85rem;color:var(--teal,teal);">&#8627; ' + esc(who) + '</span>' +
              (when ? '<span class="mu-sub">' + N.date(when) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:0.9rem;line-height:1.5;white-space:pre-wrap;color:var(--charcoal,var(--text));">' + esc(resp.body) + '</div>';
        } else {
          replyBody = '<span class="mu-sub">No reply yet.</span>';
        }

        // ── Moderation — native action buttons (delegate to CsReviewsBridge) ──
        // Mirror legacy #cs-reviews button layout per status: pending → Approve +
        // Reject; rejected → Approve; approved → Feature/Unfeature on site. Each
        // delegates to the existing legacy moderation write via the bridge.
        var st = statusOf(r), id = r._key || r.id, eid = esc(String(id));
        var modBtns = [];
        if (st === 'pending') {
          modBtns.push('<button class="btn btn-primary btn-small" onclick="CsReviewsV2.approve(\'' + eid + '\')">Approve</button>');
          modBtns.push('<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.reject(\'' + eid + '\')">Reject</button>');
        } else if (st === 'rejected') {
          modBtns.push('<button class="btn btn-primary btn-small" onclick="CsReviewsV2.approve(\'' + eid + '\')">Approve</button>');
        } else if (st === 'approved') {
          if (r.featuredOnSite) {
            modBtns.push('<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.unfeature(\'' + eid + '\')" title="Remove this review from the homepage Testimonials section">Unfeature</button>');
          } else {
            modBtns.push('<button class="btn btn-primary btn-small" onclick="CsReviewsV2.feature(\'' + eid + '\')" title="Add this review to the homepage Testimonials section">Feature on site</button>');
          }
          modBtns.push('<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.reject(\'' + eid + '\')" title="Remove from the storefront">Unpublish</button>');
        }
        var modRow = '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + modBtns.join('') + '</div>';
        var featNote = (st === 'approved' && r.featuredOnSite)
          ? '<div class="mu-sub" style="margin-top:8px;">' + UI.badge('Featured on site', 'success') + (r.featuredAt ? ' since ' + N.date(r.featuredAt) : '') + '</div>'
          : '';

        // No-V2-home capabilities stay on legacy #cs-reviews: the public REPLY
        // (+ its cs_review_responses audit log), Draft Social Post, Ask-for-photo
        // (UGC upload link), and the anonymous-review policy settings card.
        // navigateToClassic so the V2 route remap doesn't loop us back here.
        var more = '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" onclick="CsReviewsV2.classic()" title="Reply publicly, draft a social post, ask for a photo, or change the review policy">More actions (reply, social, policy) &rarr;</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Moderation', modRow + featNote) +
            UI.card('Review', meta) +
            UI.card('Customer review', reviewBody) +
            UI.card('Shop reply', replyBody + more) +
          '</div>';
      }
    }
    // No onSave -> no Edit button (moderation/replies stay on legacy #cs-reviews).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, productIndex: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, busy: false };

  function load() {
    // Reviews (one-shot keyed object) + a best-effort products read so a snapshot-
    // less productId still resolves to a name. Products failure is non-fatal.
    Promise.all([
      Promise.resolve(MastDB.get('cs_reviews')).catch(function () { return null; }),
      ((MastDB.products && MastDB.products.get)
        ? Promise.resolve(MastDB.products.get()).then(function (s) { return (s && s.val && s.val()) || s || {}; }).catch(function () { return {}; })
        : Promise.resolve({}))
    ]).then(function (res) {
      var rv = res[0] || {}, pv = res[1] || {};
      var out = [];
      Object.keys(rv).forEach(function (k) {
        var r = rv[k];
        if (r && typeof r === 'object') { r = Object.assign({ _key: k }, r); r.status = r.status || 'pending'; out.push(r); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (x) { V2.byId[x._key] = x; });
      V2.productIndex = {};
      Object.keys(pv).forEach(function (pid) {
        var p = pv[pid]; if (!p) return;
        V2.productIndex[pid] = { name: p.name || p.title || pid };
      });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[cs-reviews-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (r) { return statusOf(r) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return productLabel(r).toLowerCase().indexOf(q) >= 0 ||
               authorOf(r).toLowerCase().indexOf(q) >= 0 ||
               emailOf(r).toLowerCase().indexOf(q) >= 0 ||
               bodyOf(r).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      // Rating sorts by the numeric value, not the "★★★★ 4/5" string.
      if (k === 'rating') return ratingOf(r);
      var f = MastEntity.get('cs-reviews-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('csReviewsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csReviewsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var pending = V2.rows.filter(function (r) { return statusOf(r) === 'pending'; }).length;
    var filters = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CsReviewsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Reviews',
        count: N.count(pending) + ' pending · ' + N.count(V2.rows.length) + ' total',
        actionsHtml: '<button class="btn btn-secondary" onclick="CsReviewsV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search product, author or text…" value="' + esc(V2.q) +
        '" oninput="CsReviewsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-reviews-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsReviewsV2.sort', onRowClickFnName: 'CsReviewsV2.open',
        empty: { title: 'No reviews', message: V2.loaded ? 'No reviews match this filter. Reviews arrive from the storefront review form.' : 'Loading…' }
      });
  }

  // Delegate a moderation action to the legacy write via CsReviewsBridge, then
  // refresh the live row + re-open the slide-out + re-render the list. Guarded by
  // V2.busy so a double-tap can't fire two writes.
  function moderate(action, id) {
    if (V2.busy) return Promise.resolve();
    var bridge = window.CsReviewsBridge;
    if (!bridge || typeof bridge[action] !== 'function') {
      // Bridge lives in the legacy customer-service module; kick a load + ask to retry.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('customer-service'); } catch (e) {} }
      if (window.showToast) showToast('Moderation still loading — try again', true);
      return Promise.resolve();
    }
    V2.busy = true;
    return Promise.resolve(bridge[action](id)).then(function (doc) {
      V2.busy = false;
      var row = V2.byId[id];
      if (doc && typeof doc === 'object') {
        // Merge the fresh on-doc state into the live row (keep our _key).
        if (!row) { row = { _key: id }; V2.byId[id] = row; }
        Object.keys(doc).forEach(function (k) { row[k] = doc[k]; });
        row._key = id; row.status = row.status || 'pending';
        if (V2.rows.indexOf(row) < 0) { V2.rows = V2.rows.map(function (x) { return (x._key === id ? row : x); }); }
      } else if (row && (action === 'approve' || action === 'reject')) {
        // Bridge returned no doc (review outside the legacy 100-row window). The
        // approve/reject status write lands unconditionally (MastDB.update on the
        // path), so reflect it locally. feature/unfeature short-circuit when the
        // legacy index lacks the review, so they leave the row untouched here.
        row.status = (action === 'approve') ? 'approved' : 'rejected';
      }
      render();
      // Re-open the (now-updated) record so the slide-out reflects the new status.
      var rec = V2.byId[id];
      if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
    }).catch(function (e) {
      V2.busy = false;
      console.error('[cs-reviews-v2] moderate ' + action, e);
      if (window.showToast) showToast('Action failed: ' + (e && e.message || e), true);
    });
  }

  window.CsReviewsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' || key === 'rating' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('cs-reviews-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
      });
    },
    // ── Moderation — delegate to the legacy write via window.CsReviewsBridge ──
    // The bridge wraps the existing approveReview/rejectReview/featureReviewOnSite/
    // unfeatureReviewOnSite logic (status write + W1.8 Testimonials promotion) and
    // resolves to the fresh on-doc state. We merge that back into the live
    // V2.byId[id] (preserving _key) then re-open the record + re-render the list.
    approve: function (id) { return moderate('approve', id); },
    reject: function (id) { return moderate('reject', id); },
    feature: function (id) { return moderate('feature', id); },
    unfeature: function (id) { return moderate('unfeature', id); },
    // No-V2-home capabilities (reply + audit log, social draft, UGC photo ask,
    // anonymous-review policy) -> classic Reviews view. navigateToClassic so the
    // V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('cs-reviews');
      else if (typeof navigateTo === 'function') navigateTo('cs-reviews');
    },
    exportCsv: function () { return MastEntity.exportRows('cs-reviews-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('cs-reviews-v2', {
    routes: { 'cs-reviews-v2': { tab: 'csReviewsV2Tab', setup: function () {
      // Ensure the legacy customer-service module is loaded so window.CsReviewsBridge
      // (the moderation write shim) exists before the operator acts.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('customer-service'); } catch (e) {} }
      ensureTab(); render(); load();
    } } }
  });
})();
