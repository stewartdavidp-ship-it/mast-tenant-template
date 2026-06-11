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
 * — were classic-only until the burn-down; all live natively now (no classic links
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
  // RBAC: reviews surface gates on the LEGACY route id (finance precedent).
  function canCs(axis) { return (typeof window.can === 'function') ? window.can('cs-reviews', axis) : true; }

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
        // Product cross-drill: only when the id resolves in the PRODUCT index
        // (class reviews carry a class id — no products-v2 record to drill to).
        var prodCell = (r.productId && V2.productIndex[r.productId])
          ? '<a href="javascript:void(0)" onclick="CsReviewsV2.openProduct(\'' + esc(r.productId) + '\')" style="color:var(--teal);">' + esc(productLabel(r)) + '</a>'
          : esc(productLabel(r));
        var meta = UI.kv([
          { k: 'Product', v: prodCell },
          { k: 'Rating', v: (ratingText(r) || '—') },
          { k: 'Author', v: esc(authorOf(r)) },
          { k: 'Email', v: (emailOf(r) ? esc(emailOf(r)) : '—') },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(r)] || 'Pending', STATUS_TONE[statusOf(r)] || 'neutral') },
          { k: 'Submitted', v: (r.createdAt ? N.date(r.createdAt) : '—') }
        ]);

        var headlineHtml = r.headline
          ? '<div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;color:var(--text-primary);">' + esc(r.headline) + '</div>'
          : '';
        var reviewBody = bodyOf(r)
          ? headlineHtml + '<div style="font-size:0.9rem;line-height:1.5;white-space:pre-wrap;color:var(--text-primary);">' + esc(bodyOf(r)) + '</div>'
          : (r.headline ? headlineHtml : '<span class="mu-sub">No review text.</span>');

        // Operator reply (response {body,authorName,createdAt,updatedAt}).
        // CS Wave 2: Respond / Edit / Delete live HERE natively — each write
        // delegates to the CsReviewsBridge respond/deleteResponse cores (the
        // cs_review_responses audit appends stay single-sourced on legacy).
        var resp = r.response || null;
        var id0 = r._key || r.id, eid0 = esc(String(id0));
        var canEditR = canCs('edit');
        var replyBody;
        if (V2.respondingId === id0 && canEditR) {
          replyBody =
            '<textarea id="csRevV2Resp" rows="4" maxlength="4000" placeholder="Write a public reply…" style="width:100%;box-sizing:border-box;resize:vertical;font-size:0.85rem;padding:8px 10px;background:var(--surface-card);border:1px solid var(--border,rgba(127,127,127,.2));border-radius:6px;color:var(--text,var(--charcoal));">' + esc(resp && resp.body || '') + '</textarea>' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
              '<button class="btn btn-primary btn-small" onclick="CsReviewsV2.saveResponse(\'' + eid0 + '\')">' + (resp ? 'Save' : 'Post reply') + '</button>' +
              '<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.cancelResponse(\'' + eid0 + '\')">Cancel</button>' +
            '</div>';
        } else if (resp && resp.body) {
          var who = resp.authorName || 'Shop response';
          var when = resp.updatedAt || resp.createdAt;
          replyBody =
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
              '<span style="font-weight:600;font-size:0.85rem;color:var(--teal,teal);">&#8627; ' + esc(who) + '</span>' +
              (when ? '<span class="mu-sub">' + N.date(when) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:0.9rem;line-height:1.5;white-space:pre-wrap;color:var(--text-primary);">' + esc(resp.body) + '</div>' +
            (canEditR
              ? '<div style="display:flex;gap:8px;margin-top:10px;">' +
                '<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.editResponse(\'' + eid0 + '\')">Edit</button>' +
                '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="CsReviewsV2.deleteResponse(\'' + eid0 + '\')">Delete reply</button>' +
                '</div>'
              : '');
        } else {
          replyBody = '<span class="mu-sub">No reply yet.</span>' +
            (canEditR
              ? '<div style="margin-top:10px;"><button class="btn btn-primary btn-small" onclick="CsReviewsV2.editResponse(\'' + eid0 + '\')" title="Reply publicly — shown under the review on the storefront">💬 Respond</button></div>'
              : '');
        }

        // ── Moderation — native action buttons (delegate to CsReviewsBridge) ──
        // Mirror legacy #cs-reviews button layout per status: pending → Approve +
        // Reject; rejected → Approve; approved → Feature/Unfeature on site. Each
        // delegates to the existing legacy moderation write via the bridge.
        var st = statusOf(r), id = r._key || r.id, eid = esc(String(id));
        var modBtns = [];
        if (!canCs('edit')) {
          // View-only roles see status, not levers.
        } else if (st === 'pending') {
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
        if (canCs('delete')) {
          modBtns.push('<button class="btn btn-secondary btn-small" style="margin-left:auto;color:var(--danger);" onclick="CsReviewsV2.remove(\'' + eid + '\')" title="Permanently delete this review (and its homepage testimonial, if featured)">Delete</button>');
        }
        var modRow = modBtns.length
          ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + modBtns.join('') + '</div>'
          : '<span class="mu-sub">View-only access.</span>';
        var featNote = (st === 'approved' && r.featuredOnSite)
          ? '<div class="mu-sub" style="margin-top:8px;">' + UI.badge('Featured on site', 'success') + (r.featuredAt ? ' since ' + N.date(r.featuredAt) : '') + '</div>'
          : '';

        // Classic-dependency burn-down: Draft Social and Ask-for-photo are
        // native bridge actions now (both legacy helpers were already
        // route-agnostic); the anonymous-review policy is a card on the page.
        var more = '';
        if (canCs('edit')) {
          var extras = [];
          if (bodyOf(r) || r.headline) {
            extras.push('<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.draftSocial(\'' + eid0 + '\')" title="Open the social composer pre-filled with this review">Draft social post</button>');
          }
          if (emailOf(r)) {
            extras.push('<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.askPhoto(\'' + eid0 + '\')" title="Email the customer a one-time photo upload link">📸 Ask for a photo</button>');
          }
          if (extras.length) more = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' + extras.join('') + '</div>';
        }

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
  var V2 = { rows: [], byId: {}, productIndex: {}, sortKey: 'createdAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false, busy: false, respondingId: null, anonymousAllowed: false };

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
      // Anonymous-review policy for the settings card (burn-down).
      if (window.CsReviewsBridge && CsReviewsBridge.getPolicy) {
        CsReviewsBridge.getPolicy().then(function (p) { V2.anonymousAllowed = !!p.anonymousAllowed; render(); });
      }
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

  // Anonymous-review policy (burn-down: the settings card was classic-only).
  // Writes cs_config/reviews + the public/config mirror via the bridge.
  function policyCard() {
    var on = !!V2.anonymousAllowed;
    var canEdit = canCs('edit');
    return '<div style="margin:0 0 12px;">' + U.card('Review policy',
      '<div style="display:flex;align-items:center;gap:10px;font-size:0.9rem;">' +
        '<span style="flex:1;">Allow reviews without signing in <span class="mu-sub">(off = customers must sign in, which marks reviews “verified”)</span></span>' +
        U.badge(on ? 'Anonymous allowed' : 'Sign-in required', on ? 'amber' : 'success') +
        (canEdit ? '<button class="btn btn-secondary btn-small" onclick="CsReviewsV2.setAnonPolicy(' + (on ? 'false' : 'true') + ')">' + (on ? 'Require sign-in' : 'Allow anonymous') + '</button>' : '') +
      '</div>') + '</div>';
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
      policyCard() +
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
    approve: function (id) { if (!canCs('edit')) return; return moderate('approve', id); },
    reject: function (id) { if (!canCs('edit')) return; return moderate('reject', id); },
    feature: function (id) { if (!canCs('edit')) return; return moderate('feature', id); },
    unfeature: function (id) { if (!canCs('edit')) return; return moderate('unfeature', id); },

    // ── Public reply (Wave 2) — bridge cores own the write + audit append ──
    editResponse: function (id) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      V2.respondingId = id;
      var rec = V2.byId[id];
      if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
      setTimeout(function () { var ta = document.getElementById('csRevV2Resp'); if (ta) ta.focus(); }, 60);
    },
    cancelResponse: function (id) {
      V2.respondingId = null;
      var rec = V2.byId[id];
      if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
    },
    saveResponse: function (id) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      if (V2.busy) return;
      var ta = document.getElementById('csRevV2Resp');
      var body = ta ? ta.value : '';
      V2.busy = true;
      var bridge = window.CsReviewsBridge;
      Promise.resolve(bridge.respond(id, body)).then(function (doc) {
        V2.busy = false; V2.respondingId = null;
        if (doc) { Object.assign(V2.byId[id] || {}, doc); }
        showToast('Reply posted');
        render();
        var rec = V2.byId[id];
        if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
      }).catch(function (e) {
        V2.busy = false;
        showToast('Reply failed: ' + (e && e.message || e), true);
      });
    },
    deleteResponse: function (id) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      mastConfirm('Delete this public reply? The customer\'s review will remain.', { title: 'Delete reply', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(window.CsReviewsBridge.deleteResponse(id)).then(function (doc) {
          if (V2.byId[id]) V2.byId[id].response = null;
          showToast('Reply deleted');
          render();
          var rec = V2.byId[id];
          if (rec) MastEntity.openRecord('cs-reviews-v2', rec, 'read');
        }).catch(function (e) { showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },
    // Hard-delete the review itself (bridge cascades the testimonial mirror).
    remove: function (id) {
      if (!canCs('delete')) { showToast('Reviews delete access required.', true); return; }
      var r = V2.byId[id];
      var label = r ? (authorOf(r) + "'s review of " + productLabel(r)) : 'this review';
      mastConfirm('Permanently delete ' + label + '? This cannot be undone' + (r && r.featuredOnSite ? ' — it will also be removed from the homepage testimonials' : '') + '.', { title: 'Delete review', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(window.CsReviewsBridge.remove(id)).then(function () {
          delete V2.byId[id];
          V2.rows = V2.rows.filter(function (x) { return (x._key || x.id) !== id; });
          showToast('Review deleted');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          render();
        }).catch(function (e) { showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },
    // No-V2-home capabilities (reply + audit log, social draft, UGC photo ask,
    // anonymous-review policy) -> classic Reviews view. navigateToClassic so the
    // V2 route remap doesn't loop us back to this twin.
    draftSocial: function (id) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      Promise.resolve(window.CsReviewsBridge.draftSocial(id))
        .catch(function (e) { showToast('Failed: ' + (e && e.message || e), true); });
    },
    askPhoto: function (id) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      Promise.resolve(window.CsReviewsBridge.askPhoto(id))
        .catch(function (e) { showToast('Failed: ' + (e && e.message || e), true); });
    },
    setAnonPolicy: function (allowed) {
      if (!canCs('edit')) { showToast('Reviews write access required.', true); return; }
      Promise.resolve(window.CsReviewsBridge.setAnonymousAllowed(allowed)).then(function () {
        V2.anonymousAllowed = !!allowed;
        render();
      }).catch(function (e) { showToast('Failed: ' + (e && e.message || e), true); });
    },
    // Cold-drill-safe product cross-link (Wave 4).
    openProduct: function (pid) {
      if (!pid) return;
      MastAdmin.loadModule('products-v2').then(function () {
        return MastEntity.drill('products-v2', pid);
      }).catch(function (e) { console.error('[cs-reviews-v2] openProduct', e); });
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
