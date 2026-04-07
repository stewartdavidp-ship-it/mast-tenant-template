/**
 * Customers Module — Canonical person hub.
 *
 * v1 scope (Phase 4): list page only.
 *  - Browse all customers
 *  - Search by name/email
 *  - Filter by source
 *  - Sort by updatedAt / createdAt / name / email
 *  - Open detail view (Phase 5 placeholder)
 *  - Surface duplicates queue count
 *
 * Detail view (Phase 5) will show identity, linked records, tags, notes,
 * wallet/membership/loyalty mirror, and absorb the contacts interaction log.
 *
 * Plan: snoopy-gathering-sun.md
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var customersData = [];
  var customersLoaded = false;
  var duplicatesData = [];
  var selectedCustomerId = null;

  var SOURCE_BADGE_COLORS = {
    order:       { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    enrollment:  { bg: 'rgba(91,33,182,0.2)',  color: '#B39DDB', border: 'rgba(91,33,182,0.35)' },
    contact:     { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    newsletter:  { bg: 'rgba(157,23,77,0.2)',  color: '#F48FB1', border: 'rgba(157,23,77,0.35)' },
    account:     { bg: 'rgba(15,118,110,0.2)', color: '#4DB6AC', border: 'rgba(15,118,110,0.35)' },
    manual:      { bg: 'rgba(55,48,163,0.2)',  color: '#7986CB', border: 'rgba(55,48,163,0.35)' },
    'import':    { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  function sourceBadgeStyle(source) {
    var c = SOURCE_BADGE_COLORS[source] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';padding:2px 8px;border-radius:10px;font-size:0.72rem;text-transform:capitalize;';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function(ch) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    try {
      var then = new Date(iso).getTime();
      var diff = Date.now() - then;
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      if (days < 7) return days + 'd ago';
      return new Date(iso).toLocaleDateString();
    } catch (e) {
      return '—';
    }
  }

  // ============================================================
  // Data loading
  // ============================================================

  async function loadCustomers() {
    var loadingEl = document.getElementById('customersLoading');
    var wrapEl = document.getElementById('customersTableWrap');
    var emptyEl = document.getElementById('customersEmpty');
    if (loadingEl) loadingEl.style.display = '';
    if (wrapEl) wrapEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      var snap = await MastDB._ref('admin/customers')
        .orderByChild('updatedAt')
        .limitToLast(500)
        .once('value');
      var val = snap.val() || {};
      customersData = Object.values(val);
      customersLoaded = true;
    } catch (e) {
      console.error('[customers] load failed', e);
      customersData = [];
      MastAdmin.showToast('Failed to load customers: ' + (e && e.message), true);
    }

    // Load duplicates count in parallel — non-blocking
    try {
      var dSnap = await MastDB._ref('admin/customerDuplicates')
        .orderByChild('detectedAt')
        .limitToLast(50)
        .once('value');
      var dVal = dSnap.val() || {};
      duplicatesData = Object.entries(dVal).map(function(entry) {
        var v = entry[1]; v._flagId = entry[0]; return v;
      }).filter(function(d) { return d.status !== 'merged'; });
    } catch (e) {
      duplicatesData = [];
    }

    renderDuplicatesBadge();
    render();
  }

  function renderDuplicatesBadge() {
    var badge = document.getElementById('customersDuplicatesBadge');
    if (!badge) return;
    if (duplicatesData.length > 0) {
      badge.style.display = '';
      badge.textContent = duplicatesData.length;
    } else {
      badge.style.display = 'none';
    }
  }

  // ============================================================
  // Render
  // ============================================================

  function render() {
    var loadingEl = document.getElementById('customersLoading');
    var wrapEl = document.getElementById('customersTableWrap');
    var emptyEl = document.getElementById('customersEmpty');
    var bodyEl = document.getElementById('customersTableBody');
    var countEl = document.getElementById('customersCount');
    if (loadingEl) loadingEl.style.display = 'none';
    if (!bodyEl) return;

    var search = (document.getElementById('customersSearch') || {}).value || '';
    var sourceFilter = (document.getElementById('customersSourceFilter') || {}).value || 'all';
    var sortBy = (document.getElementById('customersSortBy') || {}).value || 'updatedAt';
    var q = search.trim().toLowerCase();

    var filtered = customersData.filter(function(c) {
      if (!c) return false;
      if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
      if (!q) return true;
      var name = (c.displayName || '').toLowerCase();
      var email = (c.primaryEmail || '').toLowerCase();
      var emails = (c.emails || []).join(' ').toLowerCase();
      return name.indexOf(q) !== -1 || email.indexOf(q) !== -1 || emails.indexOf(q) !== -1;
    });

    filtered.sort(function(a, b) {
      if (sortBy === 'name') return (a.displayName || '').localeCompare(b.displayName || '');
      if (sortBy === 'email') return (a.primaryEmail || '').localeCompare(b.primaryEmail || '');
      // createdAt / updatedAt — newest first
      var av = a[sortBy] || '';
      var bv = b[sortBy] || '';
      return bv.localeCompare(av);
    });

    if (countEl) countEl.textContent = filtered.length + ' of ' + customersData.length;

    if (filtered.length === 0) {
      if (wrapEl) wrapEl.style.display = 'none';
      if (emptyEl) {
        emptyEl.style.display = '';
        emptyEl.textContent = customersData.length === 0
          ? "No customers yet. They'll appear here as orders, enrollments, contacts, and newsletter signups come in."
          : 'No customers match your filters.';
      }
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = '';

    var rows = filtered.map(function(c) {
      var linkedIds = c.linkedIds || {};
      var linkBits = [];
      var orderCount = 0; // computed lazily on detail page
      var uidCount = (linkedIds.uids || []).length;
      var contactIdCount = (linkedIds.contactIds || []).length;
      var emailCount = (c.emails || []).length;
      if (emailCount > 1) linkBits.push(emailCount + ' emails');
      if (uidCount > 0) linkBits.push(uidCount + ' uid' + (uidCount > 1 ? 's' : ''));
      if (contactIdCount > 0) linkBits.push(contactIdCount + ' contact' + (contactIdCount > 1 ? 's' : ''));
      var linkText = linkBits.length ? linkBits.join(' · ') : '<span style="color:#6b7280;">—</span>';

      var nameDisplay = escapeHtml(c.displayName || c.primaryEmail || c.id);
      var emailDisplay = escapeHtml(c.primaryEmail || '—');
      var sourceTag = c.source
        ? '<span style="' + sourceBadgeStyle(c.source) + '">' + escapeHtml(c.source) + '</span>'
        : '<span style="color:#6b7280;">—</span>';
      var lastActivity = relativeTime(c.updatedAt || c.createdAt);

      return '<tr style="cursor:pointer;" onclick="window._customersOpenDetail(\'' + c.id + '\')">' +
        '<td style="padding:8px 6px;">' + nameDisplay + '</td>' +
        '<td style="padding:8px 6px;color:#9ca3af;">' + emailDisplay + '</td>' +
        '<td style="padding:8px 6px;">' + sourceTag + '</td>' +
        '<td style="padding:8px 6px;color:#9ca3af;font-size:0.85rem;">' + linkText + '</td>' +
        '<td style="padding:8px 6px;color:#9ca3af;font-size:0.85rem;">' + lastActivity + '</td>' +
      '</tr>';
    }).join('');

    bodyEl.innerHTML = rows;
  }

  // ============================================================
  // Detail view (Phase 5 placeholder — minimal record dump)
  // ============================================================

  function openDetail(customerId) {
    selectedCustomerId = customerId;
    var listView = document.getElementById('customersListView');
    var detailView = document.getElementById('customerDetailView');
    var content = document.getElementById('customerDetailContent');
    if (!listView || !detailView || !content) return;
    listView.style.display = 'none';
    detailView.style.display = '';
    content.innerHTML = '<div style="color:#9ca3af;">Loading…</div>';

    MastDB._ref('admin/customers/' + customerId).once('value').then(function(snap) {
      var c = snap.val();
      if (!c) {
        content.innerHTML = '<div style="color:#ef4444;">Customer not found.</div>';
        return;
      }
      content.innerHTML = renderDetailPlaceholder(c);
    }).catch(function(e) {
      content.innerHTML = '<div style="color:#ef4444;">Load failed: ' + escapeHtml(e && e.message) + '</div>';
    });
  }

  function renderDetailPlaceholder(c) {
    var linked = c.linkedIds || {};
    return '' +
      '<div class="card" style="padding:16px;margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
          '<div>' +
            '<h2 style="margin:0 0 4px 0;">' + escapeHtml(c.displayName || c.primaryEmail || c.id) + '</h2>' +
            '<div style="color:#9ca3af;">' + escapeHtml(c.primaryEmail || 'no email') + '</div>' +
          '</div>' +
          '<span style="' + sourceBadgeStyle(c.source) + '">' + escapeHtml(c.source || 'unknown') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:16px;margin-bottom:12px;">' +
        '<h3 style="margin-top:0;">Identity</h3>' +
        '<div style="display:grid;grid-template-columns:140px 1fr;gap:8px;font-size:0.9rem;">' +
          '<div style="color:#9ca3af;">Customer ID</div><div style="font-family:monospace;font-size:0.8rem;">' + escapeHtml(c.id) + '</div>' +
          '<div style="color:#9ca3af;">Emails</div><div>' + ((c.emails || []).map(escapeHtml).join('<br>') || '—') + '</div>' +
          '<div style="color:#9ca3af;">Phones</div><div>' + ((c.phones || []).map(escapeHtml).join('<br>') || '—') + '</div>' +
          '<div style="color:#9ca3af;">Linked uids</div><div style="font-family:monospace;font-size:0.8rem;">' + ((linked.uids || []).map(escapeHtml).join('<br>') || '—') + '</div>' +
          '<div style="color:#9ca3af;">Contact IDs</div><div style="font-family:monospace;font-size:0.8rem;">' + ((linked.contactIds || []).map(escapeHtml).join('<br>') || '—') + '</div>' +
          '<div style="color:#9ca3af;">Tags</div><div>' + ((c.tags || []).map(escapeHtml).join(', ') || '—') + '</div>' +
          '<div style="color:#9ca3af;">Newsletter</div><div>' + (c.marketing && c.marketing.newsletterOptIn ? 'Opted in' : '—') + '</div>' +
          '<div style="color:#9ca3af;">Created</div><div>' + escapeHtml(c.createdAt || '—') + '</div>' +
          '<div style="color:#9ca3af;">Updated</div><div>' + escapeHtml(c.updatedAt || '—') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="padding:16px;color:#9ca3af;">' +
        '<strong>Phase 5 will add:</strong> linked orders, linked enrollments, interactions tab (absorbs contacts), wallet/membership/loyalty mirror, tags + notes editing, manual merge.' +
      '</div>';
  }

  function backToList() {
    selectedCustomerId = null;
    var listView = document.getElementById('customersListView');
    var detailView = document.getElementById('customerDetailView');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';
  }

  // ============================================================
  // Duplicates queue (minimal v1 — read-only list, merge in Phase 5+)
  // ============================================================

  function openDuplicates() {
    if (duplicatesData.length === 0) {
      MastAdmin.showToast('No pending duplicates.');
      return;
    }
    var lines = duplicatesData.map(function(d) {
      return '• ' + (d.reason || 'duplicate') +
        '\n  A: ' + d.customerIdA +
        '\n  B: ' + d.customerIdB +
        '\n  detected: ' + (d.detectedAt || '—');
    }).join('\n\n');
    alert('Pending customer duplicates (' + duplicatesData.length + '):\n\n' + lines + '\n\nManual merge UI coming in Phase 5.');
  }

  // ============================================================
  // Module registration
  // ============================================================

  window._customersRender = render;
  window._customersOpenDetail = openDetail;
  window._customersBackToList = backToList;
  window._customersOpenDuplicates = openDuplicates;

  MastAdmin.registerModule('customers', {
    routes: {
      'customers': {
        tab: 'customersTab',
        setup: function() {
          backToList();
          if (!customersLoaded) {
            loadCustomers();
          } else {
            render();
            renderDuplicatesBadge();
          }
        }
      }
    },
    detachListeners: function() {
      customersData = [];
      customersLoaded = false;
      duplicatesData = [];
      selectedCustomerId = null;
    }
  });

})();
