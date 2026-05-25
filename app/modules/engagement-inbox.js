/**
 * Engagement Inbox Module — W2.3
 *
 * Unified chronological queue of cs_reviews + cs_tickets, with sentiment
 * inference and bulk actions that delegate to customer-service.js helpers
 * shipped in W1.7/W1.8. The cs-reviews and cs-tickets routes keep their
 * dedicated screens — this is the marketing-side roll-up.
 *
 * Permission: gated on customerService:read since it surfaces
 * cs_* data.
 *
 * Future-state: social DM/comment column is shown grayed-out with a
 * tooltip noting the pending social-platform integration (idea
 * -OtGTgi7XKedsvl5XZOm).
 */
(function() {
  'use strict';

  var loaded = false;
  var rows = []; // unified row list
  var selected = {}; // id -> true
  var filterSource = 'all';   // all | review | ticket | ugc
  var filterSentiment = 'all';// all | positive | neutral | negative
  var filterStatus = 'all';   // all | pending | approved | replied | closed
  var hideResolved = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _sentimentForReview(r) {
    var rating = parseFloat(r.rating || 0);
    if (rating >= 4) return 'positive';
    if (rating > 0 && rating <= 2) return 'negative';
    if (rating === 3) return 'neutral';
    return 'neutral';
  }

  // Very crude word-list sentiment for tickets — sufficient for v1 triage.
  var _NEG = ['broken', 'bad', 'refund', 'return', 'wrong', 'late', 'damaged', 'angry', 'disappointed', 'terrible', 'awful'];
  var _POS = ['thanks', 'love', 'great', 'amazing', 'beautiful', 'perfect', 'wonderful', 'excellent'];
  function _sentimentForTicket(t) {
    var text = ((t.subject || '') + ' ' + (t.body || '')).toLowerCase();
    var neg = _NEG.some(function(w) { return text.indexOf(w) !== -1; });
    var pos = _POS.some(function(w) { return text.indexOf(w) !== -1; });
    if (neg && !pos) return 'negative';
    if (pos && !neg) return 'positive';
    return 'neutral';
  }

  function _ageRel(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var ms = Date.now() - t;
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  async function loadAll() {
    var reviewsP = MastDB.query('cs_reviews').limitToLast(200).once().catch(function() { return null; });
    var ticketsP = MastDB.query('cs_tickets').limitToLast(200).once().catch(function() { return null; });
    var custP = MastDB.get('admin/customers').catch(function() { return null; });
    // W3b — pull UGC submissions for the inbox queue.
    var ugcP = MastDB.get('admin/ugc_submissions').catch(function() { return null; });

    var results = await Promise.all([reviewsP, ticketsP, custP, ugcP]);
    var reviews = results[0] || {};
    var tickets = results[1] || {};
    var customers = results[2] || {};
    var ugc = results[3] || {};

    if (reviews && reviews.val) reviews = reviews.val() || {};
    if (tickets && tickets.val) tickets = tickets.val() || {};
    if (customers && customers.val) customers = customers.val() || {};
    if (ugc && ugc.val) ugc = ugc.val() || {};

    // Build email→customer index for resolution (mirrors W1.7).
    var byEmail = {};
    Object.keys(customers || {}).forEach(function(cid) {
      var c = customers[cid];
      if (!c) return;
      (c.emails || [c.primaryEmail]).forEach(function(em) {
        if (em) byEmail[String(em).toLowerCase()] = c;
      });
    });

    var out = [];
    Object.keys(reviews).forEach(function(id) {
      var r = reviews[id] || {};
      var email = String(r.authorEmail || r.reviewerEmail || '').toLowerCase();
      var cust = email ? byEmail[email] : null;
      out.push({
        kind: 'review',
        id: id,
        customerId: cust ? cust.id : null,
        // Mirror cs-reviews list: prefer matched customer, then review-supplied
        // name, then 'Anonymous'. Do NOT fall back to the raw email — that's PII
        // and isn't a display name. (W3a-cleanup, OPEN -OtI-8rtdmqYrwjTKjYc.)
        customerName: (cust && cust.displayName) || r.authorName || r.reviewerName || 'Anonymous',
        sentiment: _sentimentForReview(r),
        preview: String(r.text || r.body || '').slice(0, 80),
        ageIso: r.createdAt || r.submittedAt || '',
        status: r.status || 'pending',
        raw: r
      });
    });
    Object.keys(tickets).forEach(function(id) {
      var t = tickets[id] || {};
      var email = String(t.contactEmail || '').toLowerCase();
      var cust = email ? byEmail[email] : null;
      out.push({
        kind: 'ticket',
        id: id,
        customerId: cust ? cust.id : null,
        customerName: (cust && cust.displayName) || t.contactName || (email || 'Anonymous'),
        sentiment: _sentimentForTicket(t),
        preview: String(t.subject || t.body || '').slice(0, 80),
        ageIso: t.createdAt || '',
        status: t.status || 'pending',
        raw: t
      });
    });

    // W3b — UGC submissions (pending-review by default; show approved/rejected too).
    Object.keys(ugc || {}).forEach(function(sid) {
      var u = ugc[sid] || {};
      var email = String(u.customerEmail || '').toLowerCase();
      var cust = email ? byEmail[email] : null;
      out.push({
        kind: 'ugc',
        id: sid,
        customerId: (cust && cust.id) || u.customerId || null,
        customerName: (cust && cust.displayName) || email || 'Customer',
        sentiment: 'positive',
        preview: 'Photo · ' + (u.productId ? ('product ' + u.productId) : 'submission'),
        ageIso: u.submittedAt || '',
        status: u.status || 'pending-review',
        raw: u
      });
    });

    out.sort(function(a, b) { return (b.ageIso || '').localeCompare(a.ageIso || ''); });
    rows = out;
    loaded = true;
  }

  function applyFilters(arr) {
    return arr.filter(function(r) {
      if (filterSource !== 'all' && r.kind !== filterSource) return false;
      if (filterSentiment !== 'all' && r.sentiment !== filterSentiment) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (hideResolved && (r.status === 'replied' || r.status === 'closed' || r.status === 'rejected')) return false;
      return true;
    });
  }

  function sentimentChip(s) {
    var color = s === 'positive' ? '#16a34a' : s === 'negative' ? '#dc2626' : '#9ca3af';
    var icon  = s === 'positive' ? '\u{1F7E2}' : s === 'negative' ? '\u{1F534}' : '\u{1F7E1}';
    return '<span style="color:' + color + ';font-size:0.85rem;" title="' + esc(s) + '">' + icon + '</span>';
  }

  async function render() {
    var host = document.getElementById('engagementInboxTab');
    if (!host) return;
    if (!loaded) {
      host.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading engagement inbox...</div>';
      await loadAll();
    }

    var filtered = applyFilters(rows);

    var html =
      '<div class="section-header">' +
        '<h2>Engagement Inbox</h2>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">Reviews + tickets in one queue</span>' +
      '</div>' +
      // Filters bar
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;font-size:0.85rem;">' +
        _selectFilter('Source', 'filterSource', filterSource, [['all','All'],['review','Reviews'],['ticket','Tickets'],['ugc','📸 UGC']]) +
        _selectFilter('Sentiment', 'filterSentiment', filterSentiment, [['all','All'],['positive','🟢 Positive'],['neutral','🟡 Neutral'],['negative','🔴 Negative']]) +
        _selectFilter('Status', 'filterStatus', filterStatus, [['all','All'],['pending','Pending'],['approved','Approved'],['replied','Replied'],['closed','Closed']]) +
        '<label style="display:inline-flex;align-items:center;gap:4px;">' +
          '<input type="checkbox" id="eiHideResolved"' + (hideResolved ? ' checked' : '') + ' onchange="engagementInboxSetHideResolved(this.checked)"> Hide resolved' +
        '</label>' +
        '<span style="margin-left:auto;color:var(--warm-gray);">' + filtered.length + ' row' + (filtered.length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      // Bulk actions bar
      '<div id="eiBulkBar" style="display:none;background:var(--cream);padding:6px 10px;border-radius:4px;margin:4px 0;font-size:0.85rem;">' +
        '<span id="eiBulkCount" style="font-weight:600;">0 selected</span> ' +
        '<button class="btn btn-secondary btn-small" onclick="engagementInboxBulkMarkReplied()">Mark replied</button> ' +
        '<button class="btn btn-secondary btn-small" onclick="engagementInboxBulkFeature()">Feature on site</button> ' +
        '<button class="btn btn-secondary btn-small" onclick="engagementInboxDraftSocial()">Draft Social Post</button> ' +
        '<button class="btn-link" onclick="engagementInboxClearSelection()" style="background:none;border:none;color:var(--text-danger,#ff6b6b);cursor:pointer;">Clear</button>' +
      '</div>';

    if (!filtered.length) {
      html += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No items match your filters.</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:1px solid var(--cream-dark);text-align:left;">' +
          '<th style="padding:6px;width:24px;"></th>' +
          '<th style="padding:6px;">Source</th>' +
          '<th style="padding:6px;">Customer</th>' +
          '<th style="padding:6px;">Sentiment</th>' +
          '<th style="padding:6px;">Preview</th>' +
          '<th style="padding:6px;">Age</th>' +
          '<th style="padding:6px;">Status</th>' +
          // 📱 column is intentionally grayed out — social DMs/comments
          // aren't unified yet. Hover tooltip explains the pending work.
          '<th style="padding:6px;color:var(--warm-gray-light,#aaa);" title="Pending social platform integrations — see Idea -OtGTgi7XKedsvl5XZOm">📱</th>' +
        '</tr></thead><tbody>';
      filtered.forEach(function(r) {
        var sIcon = r.kind === 'review' ? '★' : r.kind === 'ugc' ? '\u{1F4F8}' : '\u{1F4AC}';
        // For UGC, the Preview cell shows a thumbnail + actions; for other
        // rows, fall through to the standard text preview.
        var previewCell;
        if (r.kind === 'ugc') {
          var url = (r.raw && r.raw.photoUrl) || '';
          var thumb = url
            ? '<img src="' + esc(url) + '" alt="" data-ei-ugc-id="' + esc(r.id) + '" onclick="engagementInboxOpenUgcPhoto(\'' + esc(r.id) + '\')" style="width:40px;height:40px;object-fit:cover;border-radius:4px;cursor:pointer;vertical-align:middle;" />'
            : '<span style="color:var(--warm-gray);">(no photo)</span>';
          var actions = '';
          if (r.status === 'pending-review') {
            actions =
              ' <button class="btn btn-primary btn-small" style="padding:2px 8px;font-size:0.78rem;" onclick="engagementInboxApproveUgc(\'' + esc(r.id) + '\')">Approve</button>' +
              ' <button class="btn btn-secondary btn-small" style="padding:2px 8px;font-size:0.78rem;" onclick="engagementInboxRejectUgc(\'' + esc(r.id) + '\')">Reject</button>';
          }
          var prodName = (r.raw && (r.raw.productName || r.raw.productId)) || '';
          previewCell = thumb + ' <span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(prodName) + '</span>' + actions;
        } else {
          previewCell = esc(r.preview);
        }
        html += '<tr style="border-bottom:1px solid var(--cream);' + (selected[r.id] ? 'background:rgba(245,158,11,0.08);' : '') + '">' +
          '<td style="padding:6px;"><input type="checkbox" data-ei-id="' + esc(r.id) + '" data-ei-kind="' + esc(r.kind) + '"' + (selected[r.id] ? ' checked' : '') + ' onchange="engagementInboxToggleSelect(\'' + esc(r.id) + '\', this.checked)"></td>' +
          '<td style="padding:6px;">' + sIcon + ' ' + esc(r.kind) + '</td>' +
          '<td style="padding:6px;">' + (r.customerId
            ? '<a href="#customers?customerId=' + esc(r.customerId) + '">' + esc(r.customerName) + '</a>'
            : esc(r.customerName)) + '</td>' +
          '<td style="padding:6px;">' + sentimentChip(r.sentiment) + '</td>' +
          '<td style="padding:6px;">' + previewCell + '</td>' +
          '<td style="padding:6px;color:var(--warm-gray);">' + _ageRel(r.ageIso) + '</td>' +
          '<td style="padding:6px;">' + esc(r.status) + '</td>' +
          '<td style="padding:6px;color:var(--warm-gray-light,#aaa);">—</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    host.innerHTML = html;
    _renderBulkBar();
  }
  window.renderEngagementInbox = render;

  function _selectFilter(label, varName, current, opts) {
    return '<label style="display:inline-flex;align-items:center;gap:4px;">' + esc(label) + ' ' +
      '<select onchange="engagementInboxSetFilter(\'' + esc(varName) + '\', this.value)">' +
        opts.map(function(o) {
          return '<option value="' + esc(o[0]) + '"' + (o[0] === current ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') +
      '</select></label>';
  }

  function _renderBulkBar() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    var bar = document.getElementById('eiBulkBar');
    if (!bar) return;
    if (!ids.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    var cnt = document.getElementById('eiBulkCount');
    if (cnt) cnt.textContent = ids.length + ' selected';
  }

  // ─── Public handlers ───

  function engagementInboxSetFilter(varName, value) {
    if (varName === 'filterSource') filterSource = value;
    else if (varName === 'filterSentiment') filterSentiment = value;
    else if (varName === 'filterStatus') filterStatus = value;
    render();
  }
  window.engagementInboxSetFilter = engagementInboxSetFilter;

  function engagementInboxSetHideResolved(v) { hideResolved = !!v; render(); }
  window.engagementInboxSetHideResolved = engagementInboxSetHideResolved;

  function engagementInboxToggleSelect(id, on) {
    if (on) selected[id] = true; else delete selected[id];
    _renderBulkBar();
  }
  window.engagementInboxToggleSelect = engagementInboxToggleSelect;

  function engagementInboxClearSelection() { selected = {}; render(); }
  window.engagementInboxClearSelection = engagementInboxClearSelection;

  async function engagementInboxBulkMarkReplied() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    var updates = 0;
    for (var i = 0; i < ids.length; i++) {
      var row = rows.find(function(r) { return r.id === ids[i]; });
      if (!row) continue;
      var path = row.kind === 'review' ? 'cs_reviews/' : 'cs_tickets/';
      try {
        await MastDB.update(path + row.id, { status: 'replied', updatedAt: new Date().toISOString() });
        row.status = 'replied';
        updates++;
      } catch (_e) {}
    }
    if (typeof showToast === 'function') showToast('Marked ' + updates + ' as replied');
    selected = {};
    render();
  }
  window.engagementInboxBulkMarkReplied = engagementInboxBulkMarkReplied;

  async function engagementInboxBulkFeature() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    var featured = 0;
    for (var i = 0; i < ids.length; i++) {
      var row = rows.find(function(r) { return r.id === ids[i]; });
      if (!row || row.kind !== 'review' || row.status !== 'approved') continue;
      if (typeof window.csFeatureReviewOnSite === 'function') {
        try { await window.csFeatureReviewOnSite(row.id); featured++; } catch (_e) {}
      }
    }
    if (typeof showToast === 'function') showToast('Featured ' + featured + ' review(s) on site');
    selected = {};
    render();
  }
  window.engagementInboxBulkFeature = engagementInboxBulkFeature;

  function engagementInboxDraftSocial() {
    var ids = Object.keys(selected).filter(function(k) { return selected[k]; });
    if (ids.length !== 1) {
      if (typeof showToast === 'function') showToast('Select exactly one review to draft a social post', true);
      return;
    }
    var row = rows.find(function(r) { return r.id === ids[0]; });
    if (!row || row.kind !== 'review') {
      if (typeof showToast === 'function') showToast('Draft Social Post only works on reviews', true);
      return;
    }
    // Delegate to the customer-service helper shipped in W1.8.
    if (typeof window.csDraftSocialFromReview === 'function') {
      window.csDraftSocialFromReview(row.id);
    } else {
      if (typeof showToast === 'function') showToast('Customer Service module not loaded', true);
    }
  }
  window.engagementInboxDraftSocial = engagementInboxDraftSocial;

  // ─── W3b UGC handlers ───

  function engagementInboxOpenUgcPhoto(id) {
    var row = rows.find(function(r) { return r.id === id && r.kind === 'ugc'; });
    if (!row) return;
    var url = (row.raw && row.raw.photoUrl) || '';
    if (!url) return;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;';
    overlay.onclick = function(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    var img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;border-radius:6px;';
    overlay.appendChild(img);
    document.body.appendChild(overlay);
  }
  window.engagementInboxOpenUgcPhoto = engagementInboxOpenUgcPhoto;

  async function engagementInboxApproveUgc(id) {
    var row = rows.find(function(r) { return r.id === id && r.kind === 'ugc'; });
    if (!row) return;
    var u = row.raw || {};
    try {
      // Look up the originating review to recover quote + customer first name
      // for the auto-drafted Content body.
      var quote = '';
      var customerFirstName = '';
      var productName = u.productName || '';
      if (u.reviewId) {
        try {
          var rev = await MastDB.get('cs_reviews/' + u.reviewId);
          if (rev) {
            quote = (rev.body || rev.headline || '').trim();
            var nm = rev.authorName || rev.reviewerName || '';
            customerFirstName = (nm.split(' ')[0]) || '';
            if (!productName) productName = rev.productName || '';
          }
        } catch (_e) {}
      }
      if (!customerFirstName) {
        customerFirstName = ((row.customerName || '').split(' ')[0]) || 'A customer';
      }

      // Create a Content draft so Composer/Social/Story all converge on one
      // canonical object. Source = 'ugc' so analytics can split it out.
      var contentId = MastDB.newKey('admin/content');
      var title = 'Customer photo' + (productName ? (': ' + productName) : '');
      var body = quote
        ? ('"' + quote + '" — Photo by ' + customerFirstName)
        : ('Photo by ' + customerFirstName + (productName ? (' — ' + productName) : ''));
      var contentDoc = {
        id: contentId,
        title: title,
        body: body,
        images: [u.photoUrl].filter(Boolean),
        targetChannels: ['social', 'story'],
        status: 'draft',
        source: 'ugc',
        sourceUgcSubmissionId: id,
        sourceReviewId: u.reviewId || null,
        sourceProductId: u.productId || null,
        sourceCustomerId: row.customerId || u.customerId || null,
        scheduledAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        linkedArtifacts: {}
      };
      await MastDB.set('admin/content/' + contentId, contentDoc);

      // Mark the submission approved + link back to the Content.
      var nowIso = new Date().toISOString();
      var approver = (window.currentUser && window.currentUser.uid) || null;
      await MastDB.update('admin/ugc_submissions/' + id, {
        status: 'approved',
        approvedAt: nowIso,
        approvedBy: approver,
        contentId: contentId,
      });
      row.status = 'approved';
      row.raw.status = 'approved';
      row.raw.contentId = contentId;

      // Kick the social + story modules into creating their own drafts
      // attached to this Content. Each module owns its own per-channel draft.
      try { if (typeof window.socialOpenFromContent === 'function') window.socialOpenFromContent(contentId); } catch (_e) {}
      try { if (typeof window.storyOpenFromContent === 'function') window.storyOpenFromContent(contentId); } catch (_e) {}

      if (typeof showToast === 'function') showToast('UGC approved — social + story drafts created');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Approve failed: ' + (err && err.message || 'unknown'), true);
    }
  }
  window.engagementInboxApproveUgc = engagementInboxApproveUgc;

  async function engagementInboxRejectUgc(id) {
    if (!confirm('Reject this photo submission? The photo stays in storage for audit but will not be used.')) return;
    var row = rows.find(function(r) { return r.id === id && r.kind === 'ugc'; });
    if (!row) return;
    try {
      var nowIso = new Date().toISOString();
      var rejecter = (window.currentUser && window.currentUser.uid) || null;
      await MastDB.update('admin/ugc_submissions/' + id, {
        status: 'rejected',
        rejectedAt: nowIso,
        rejectedBy: rejecter,
      });
      row.status = 'rejected';
      row.raw.status = 'rejected';
      if (typeof showToast === 'function') showToast('Submission rejected');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Reject failed: ' + (err && err.message || 'unknown'), true);
    }
  }
  window.engagementInboxRejectUgc = engagementInboxRejectUgc;

  MastAdmin.registerModule('engagementInbox', {
    routes: {
      'engagement-inbox': {
        tab: 'engagementInboxTab',
        setup: function() { render(); }
      }
    }
  });
})();
