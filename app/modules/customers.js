/**
 * Customers Module — Canonical person hub.
 *
 * v1 scope (Phase 4): list page, source filter, search, sort, duplicates queue,
 * minimal detail-view stub. Renders entirely from JS into the empty
 * #customersTab container, mirroring the students module pattern.
 *
 * Loaded skills before writing: mast-ux-style-guide, mast-security-checklist.
 * Uses global esc() for all data interpolation. CSS vars only — no hardcoded
 * hex. Standard .btn / .detail-back / .data-table / .loading patterns.
 *
 * Phase 5 will add: linked orders + enrollments lists, embedded interactions
 * tab (absorbs the existing contacts module), wallet/membership/loyalty
 * mirror, tag + notes editing, manual merge UI.
 *
 * Plan: snoopy-gathering-sun.md
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var customersData = [];
  // Tenant business timezone — lazy-fetched from businessEntity for
  // URL-driven date filtering so admin agrees with MCP regardless of
  // where the user is browsing from. Mirrors orders.js' helpers.
  var _tenantTz = null;
  var _tenantTzLoading = null;
  function ensureTenantTz() {
    if (_tenantTz !== null) return Promise.resolve(_tenantTz);
    if (_tenantTzLoading) return _tenantTzLoading;
    _tenantTzLoading = (window.MastDB && MastDB.businessEntity
      ? MastDB.businessEntity.get('operations')
      : Promise.resolve({ data: null })
    ).then(function(r) {
      var d = (r && r.data) || {};
      _tenantTz = (d.localization && d.localization.timezone) || '';
      return _tenantTz;
    }).catch(function() { _tenantTz = ''; return ''; });
    return _tenantTzLoading;
  }
  function tzDateStr(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    var opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
    if (_tenantTz) opts.timeZone = _tenantTz;
    var fmt = new Intl.DateTimeFormat('en-CA', opts);
    return fmt.format(d); // YYYY-MM-DD
  }
  var duplicatesData = [];
  var segmentsData = [];           // Phase 6.3 — saved segments from admin/customerSegments
  var currentSegmentId = null;     // active segment id (built-in or saved)
  var customersLoaded = false;
  var customersBackfillRunning = false; // Phase 6.1 — guards the backfill button
  // W2d follow-up — email→accountId derived from admin/wholesaleAuthorized,
  // used to compute isWholesale at render time without a customer-schema migration.
  var wholesaleEmailMap = {};
  var currentView = 'list'; // list | detail | duplicates
  var selectedCustomerId = null;
  var detailTab = 'overview'; // overview | orders | contacts | classes | interactions | wallet
  var customerEditMode = false;    // Paradigm A — read-only until user clicks Edit
  var customersSortKey = 'lastOrderAt';
  var customersSortDir = 'desc';
  // Per-customer cache: { customerId: { orders, enrollments, interactions, wallets, loaded:{...} } }
  var detailCache = {};

  // Phase 6.3 — built-in segments (not stored). Filter object matches the
  // shape of saved segments. `_builtin` flag prevents save-over.
  var BUILTIN_SEGMENTS = [
    { id: '__all',          name: 'All customers',  filters: {}, _builtin: true },
    { id: '__new_week',     name: 'New this week',  filters: { _newThisWeek: true }, _builtin: true },
    { id: '__no_orders',    name: 'No orders yet',  filters: { _noOrders: true }, _builtin: true },
    { id: '__at_risk',      name: 'At-risk',        filters: { _lapseStatus: 'at-risk' }, _builtin: true },
    { id: '__lapsed',       name: 'Lapsed',         filters: { _lapseStatus: 'lapsed' }, _builtin: true }
  ];

  // Build 5a — tab refactor from 6 → 5 to comply with design system
  // "max 5 tabs on detail-complex" rule.
  //
  // Before: Overview / Orders / Contacts / Classes / Interactions / Wallet
  // After:  Overview / Orders / Activity / Classes / Wallet
  //
  // - Contacts (linked-contact directory) moves to a card on Overview
  //   (drill-out to contacts module remains via MastNavStack)
  // - Interactions merges into the new Activity timeline (also includes
  //   notes, enrollments, and orders; Build 5b adds tickets/surveys/reviews)
  // - The name collision between the customer-tab "Interactions" and the
  //   global "Interactions" view (caught in persona walk 2026-05-21) is
  //   resolved by renaming.
  var DETAIL_TABS = [
    { value: 'overview', label: 'Overview' },
    { value: 'orders',   label: 'Orders' },
    { value: 'activity', label: 'Activity' },
    { value: 'classes',  label: 'Classes' },
    { value: 'wallet',   label: 'Wallet' }
  ];

  // Activity timeline filter chips
  var ACTIVITY_TYPE_LABELS = {
    'all':                 'All',
    'order':               'Orders',
    'enrollment':          'Enrollments',
    'contact-interaction': 'Contacts',
    'note':                'Notes',
    // Build 5b.2 — CS events now emitted by getCustomerActivityTimeline
    'ticket':              'Tickets',
    'review':              'Reviews',
    'survey-response':     'Surveys'
  };
  var activityFilter = 'all';

  var SOURCE_OPTIONS = [
    { value: 'all',         label: 'All sources' },
    { value: 'order',       label: 'Order' },
    { value: 'enrollment',  label: 'Enrollment' },
    { value: 'contact',     label: 'Contact' },
    { value: 'newsletter',  label: 'Newsletter' },
    { value: 'account',     label: 'Account' },
    { value: 'manual',      label: 'Manual' },
    { value: 'import',      label: 'Import' }
  ];

  var WHOLESALE_OPTIONS = [
    { value: 'all',       label: 'All customers' },
    { value: 'retail',    label: 'Retail only' },
    { value: 'wholesale', label: 'Wholesale only' }
  ];

  var SORT_OPTIONS = [
    { value: 'updatedAt',  label: 'Recently updated' },
    { value: 'createdAt',  label: 'Newest' },
    { value: 'name',       label: 'Name (A–Z)' },
    { value: 'email',      label: 'Email (A–Z)' },
    { value: 'spend',      label: 'Lifetime spend (high → low)' },
    { value: 'orders',     label: 'Orders (most → least)' },
    { value: 'lastOrder',  label: 'Last order (recent → old)' },
    { value: 'lapseScore', label: 'Lapse score (most overdue → on rhythm)' },
    { value: 'grossMargin', label: 'Gross margin 12m (high → low)' }
  ];

  // ============================================================
  // Helpers
  // ============================================================

  function relativeTime(iso) {
    if (!iso) return '—';
    try {
      var diff = Date.now() - new Date(iso).getTime();
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

  // Source uses .status-badge with semantic palette colors per ux skill.
  // No new badge system invented — small text label inside the unified badge.
  // Backgrounds use opaque-ish color stops chosen so contrast works on BOTH
  // light cream (var(--cream)) and dark cream (#2a2a2a) cards in admin dark mode.
  function sourceBadge(source) {
    if (!source) return '';
    var bg, color;
    switch (source) {
      case 'order':       bg = 'rgba(42,124,111,0.28)';  color = '#6fc'; break;
      case 'enrollment':  bg = 'rgba(196,133,60,0.30)';  color = 'var(--amber-light)'; break;
      case 'contact':     bg = 'rgba(99,102,241,0.30)';  color = '#a5a8f5'; break;
      case 'newsletter':  bg = 'rgba(220,53,69,0.25)';   color = '#f49aa3'; break;
      case 'account':     bg = 'rgba(22,163,74,0.30)';   color = '#7ddca0'; break;
      case 'import':      bg = 'rgba(245,158,11,0.30)';  color = '#fbcc70'; break;
      default:            bg = 'rgba(155,149,142,0.35)'; color = '#cfcac3';
    }
    return '<span class="status-badge" style="background:' + bg + ';color:' + color + ';">' + esc(source) + '</span>';
  }

  // Build 3 — cadence-aware lapse chip. Mirrors palette + sizing of
  // sourceBadge so list density stays consistent.
  function lapseChip(status, score) {
    if (!status || status === 'unknown') {
      return '<span style="color:var(--warm-gray-light);font-size:0.72rem;">—</span>';
    }
    var bg, color, label;
    if (status === 'active') {
      bg = 'rgba(34,197,94,0.20)'; color = '#7ddca0'; label = 'Active';
    } else if (status === 'at-risk') {
      bg = 'rgba(245,158,11,0.30)'; color = '#fbcc70'; label = 'At-risk';
    } else { // lapsed
      bg = 'rgba(220,53,69,0.30)'; color = '#f49aa3'; label = 'Lapsed';
    }
    var hint = (typeof score === 'number') ? (' title="lapse score ' + score.toFixed(2) + '× expected cadence"') : '';
    return '<span class="status-badge" style="background:' + bg + ';color:' + color + ';"' + hint + '>' + esc(label) + '</span>';
  }

  // Build 6b — client-side mirror of server-side classifyQuadrant.
  // Quadrant: high margin (≥50%) × on-cadence (active lapse) →
  //   grow / maintain / reprice / deprioritize / unclassified.
  function portfolioQuadrant(netMarginPct, lapseStatus) {
    if (typeof netMarginPct !== 'number' || !lapseStatus || lapseStatus === 'unknown') return 'unclassified';
    var highMargin = netMarginPct >= 0.5;
    var onCadence = lapseStatus === 'active';
    if (highMargin && onCadence) return 'grow';
    if (highMargin && !onCadence) return 'maintain';
    if (!highMargin && onCadence) return 'reprice';
    return 'deprioritize';
  }

  function portfolioQuadrantChip(q) {
    var label, bg, color;
    if (q === 'grow')              { label = 'Grow';         bg = 'rgba(34,197,94,0.25)';  color = '#7ddca0'; }
    else if (q === 'maintain')     { label = 'Maintain';     bg = 'rgba(99,102,241,0.30)'; color = '#a5a8f5'; }
    else if (q === 'reprice')      { label = 'Reprice';      bg = 'rgba(245,158,11,0.30)'; color = '#fbcc70'; }
    else if (q === 'deprioritize') { label = 'Deprioritize'; bg = 'rgba(220,53,69,0.30)';  color = '#f49aa3'; }
    else                           { return '<span style="color:var(--warm-gray-light);font-size:0.72rem;">—</span>'; }
    return '<span class="status-badge" style="background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }

  // ============================================================
  // Data loading
  // ============================================================

  async function loadCustomers() {
    var container = document.getElementById('customersTab');
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading customers…</div>';

    try {
      var results = await Promise.all([
        MastDB.query('admin/customers').orderByChild('updatedAt').limitToLast(500).once('value'),
        MastDB.query('admin/customerDuplicates').orderByChild('detectedAt').limitToLast(50).once('value'),
        MastDB.get('admin/customerSegments').catch(function() { return { val: function() { return null; } }; }),
        // W2d — best-effort: missing/empty wholesaleAuthorized just means the
        // wholesale filter shows zero rows, never blocks customers loading.
        MastDB.get('admin/wholesaleAuthorized').catch(function() { return null; })
      ]);
      var cVal = results[0].val() || {};
      customersData = Object.values(cVal);

      var dVal = results[1].val() || {};
      duplicatesData = Object.entries(dVal)
        .map(function(entry) { var v = entry[1]; v._flagId = entry[0]; return v; })
        .filter(function(d) { return d.status !== 'merged'; });

      var sVal = (results[2] && results[2].val && results[2].val()) || {};
      segmentsData = Object.entries(sVal).map(function(e) {
        var v = e[1] || {}; v.id = e[0]; return v;
      });

      // W2d — build email→accountId map for the Retail/Wholesale filter. Key
      // is the Firebase-escaped form (email with dots replaced by commas);
      // wsKeyToEmail (`,`→`.`) is the inverse used elsewhere in wholesale.js.
      var wsVal = (results[3] && results[3].val && results[3].val()) || (results[3] || {});
      wholesaleEmailMap = {};
      Object.keys(wsVal || {}).forEach(function(k) {
        var u = wsVal[k];
        if (u && u.wholesaleAccountId) {
          var email = k.replace(/,/g, '.').toLowerCase();
          if (email) wholesaleEmailMap[email] = u.wholesaleAccountId;
        }
      });

      customersLoaded = true;
    } catch (e) {
      console.error('[customers] load failed', e);
      customersData = [];
      duplicatesData = [];
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Failed to load customers: ' + esc(e && e.message) + '</div>';
      return;
    }

    render();
    // Populate the table synchronously — render() writes the wrap div via
    // innerHTML in the same task, so it's already in the DOM. Deferring to
    // rAF here opens a window where a stray render() (segment init,
    // mastaskai listener, etc.) can land between the queue and the fire and
    // leave the wrap visible-but-empty until a later trigger re-paints.
    if (currentView === 'list') renderTable();
  }

  // ============================================================
  // Top-level render
  // ============================================================

  function render() {
    var container = document.getElementById('customersTab');
    if (!container) return;

    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'list' || currentView === 'detail' ? ' active' : '') + '" onclick="customersSwitchView(\'list\')">Customers</button>';
    h += '<button class="view-tab' + (currentView === 'duplicates' ? ' active' : '') + '" onclick="customersSwitchView(\'duplicates\')">Duplicates';
    if (duplicatesData.length > 0) {
      h += ' <span class="status-badge" style="background:var(--danger);color:white;margin-left:6px;">' + duplicatesData.length + '</span>';
    }
    h += '</button>';
    h += '</div>';

    if (currentView === 'list') {
      h += renderList();
    } else if (currentView === 'detail') {
      h += renderDetail();
    } else if (currentView === 'duplicates') {
      h += renderDuplicates();
    }

    container.innerHTML = h;
  }

  // ------------------------------------------------------------
  // State-preserving render
  // ------------------------------------------------------------
  // Every field save in the customer module triggers a re-render of the
  // overview tab, which blows away unsaved input in siblings (notes,
  // tag input, identity fields, contact editor fields). snapshotFormState
  // captures in-flight values + focus + selection range so restore can put
  // them back after the innerHTML replace.

  function snapshotFormState() {
    var tab = document.getElementById('customersTab');
    if (!tab) return null;
    var active = document.activeElement;
    var snap = {
      fields: {},
      focusId: (active && tab.contains(active)) ? active.id : null,
      focusSelStart: null,
      focusSelEnd: null
    };
    if (snap.focusId && active && typeof active.selectionStart === 'number') {
      snap.focusSelStart = active.selectionStart;
      snap.focusSelEnd = active.selectionEnd;
    }
    // Capture any element with id starting "cust" or known editable markers
    tab.querySelectorAll('input, textarea, select').forEach(function(el) {
      if (!el.id) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        snap.fields[el.id] = { type: 'check', checked: el.checked };
      } else {
        snap.fields[el.id] = { type: 'val', value: el.value };
      }
    });
    return snap;
  }

  function restoreFormState(snap) {
    if (!snap) return;
    var tab = document.getElementById('customersTab');
    if (!tab) return;
    Object.keys(snap.fields).forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var s = snap.fields[id];
      if (s.type === 'check') el.checked = s.checked;
      else el.value = s.value;
    });
    if (snap.focusId) {
      var el = document.getElementById(snap.focusId);
      if (el) {
        try {
          el.focus();
          if (snap.focusSelStart !== null && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(snap.focusSelStart, snap.focusSelEnd);
          }
        } catch (e) { /* focus may fail on detached elements */ }
      }
    }
  }

  // Public helper: any caller that would have called render() should call
  // this instead so in-flight edits survive.
  function renderPreservingEdits() {
    var snap = snapshotFormState();
    render();
    restoreFormState(snap);
  }

  // Non-blocking feedback — reuse the global showToast helper from index.html.
  function toast(msg, isErr) {
    if (typeof window.showToast === 'function') window.showToast(msg, !!isErr);
  }

  // ============================================================
  // Surface 1: Customers List
  // ============================================================

  // Phase 6.3 — gather every distinct tag in current customer set for the
  // tag filter dropdown.
  function allKnownTags() {
    var seen = {};
    customersData.forEach(function(c) {
      if (!c || !c.tags) return;
      c.tags.forEach(function(t) { if (t) seen[t] = 1; });
    });
    return Object.keys(seen).sort();
  }

  function renderList() {
    var totalCount = customersData.filter(function(c) { return c && c.status !== 'merged'; }).length;

    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Customers</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += totalCount + ' total · auto-created from orders, enrollments, contacts, newsletter signups';
    h += '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    if (window.MastAskAi && window.MastAskAi.isEnabled()) {
      h += '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'customers\')" title="Ask Claude about these customers">✨ Ask AI</button>';
    }
    h += '<button class="btn btn-secondary btn-small" onclick="customersExportCsv()" title="Download current view as CSV">⤓ Export CSV</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="customersBackfillStats()" title="Recompute cached stats for all customers">↻ Recompute stats</button>';
    h += '</div>';
    h += '</div>';

    if (totalCount === 0) {
      h += renderEmptyState();
      return h;
    }

    // ----- Segments dropdown row -----
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">';
    h += '<label style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">Segment:</label>';
    h += '<select id="customersSegmentSelect" onchange="customersApplySegment(this.value)" ' +
         'style="padding:7px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.85rem;min-width:180px;">';
    BUILTIN_SEGMENTS.forEach(function(s) {
      var sel = (currentSegmentId === s.id || (!currentSegmentId && s.id === '__all')) ? ' selected' : '';
      h += '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + '</option>';
    });
    if (segmentsData.length > 0) {
      h += '<option disabled>──────────</option>';
      segmentsData.forEach(function(s) {
        var sel = (currentSegmentId === s.id) ? ' selected' : '';
        h += '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + '</option>';
      });
    }
    h += '</select>';
    h += '<button class="btn btn-secondary btn-small" onclick="customersSaveSegment()" title="Save current filters as a segment">+ Save as segment</button>';
    if (segmentsData.length > 0) {
      h += '<button class="btn btn-secondary btn-small" onclick="customersManageSegments()">Manage</button>';
    }
    h += '</div>';

    // ----- Filter bar -----
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<input type="text" id="customersSearch" placeholder="Search by name or email…" oninput="customersRender()" ' +
         'style="flex:1;min-width:220px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.9rem;">';

    h += '<select id="customersWholesaleFilter" onchange="customersRender()" title="Filter by wholesale-account linkage" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    WHOLESALE_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';

    h += '<select id="customersSourceFilter" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    SOURCE_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';

    var tags = allKnownTags();
    h += '<select id="customersTagFilter" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    h += '<option value="">All tags</option>';
    tags.forEach(function(t) {
      h += '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    });
    h += '</select>';

    h += '<input type="date" id="customersLastOrderBefore" onchange="customersRender()" title="Last order before…" ' +
         'style="padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.85rem;">';

    h += '<input type="number" id="customersMinSpend" min="0" step="1" placeholder="Min spend $" onchange="customersRender()" oninput="customersRender()" ' +
         'style="width:120px;padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.85rem;">';

    h += '<select id="customersSortBy" onchange="customersRender()" ' +
         'style="padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);color:var(--text-primary);font-family:DM Sans,sans-serif;font-size:0.9rem;">';
    SORT_OPTIONS.forEach(function(opt) {
      h += '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // D5 (2026-05-28) — orthogonal signal toggles. The dropdowns above filter
    // by *origin* (source) and *purchase shape* (last order, min spend).
    // These checkboxes filter by *current state*:
    //  - newsletterOnly: customers with marketing.newsletterOptIn === true,
    //    independent of how they arrived. Answers "who's subscribed to my
    //    newsletter right now?" (the source dropdown's 'newsletter' option
    //    only catches customers whose origin was newsletter signup, not
    //    customers who opted in later via the toggle on their record).
    //  - leadsOnly: customers with stats.orderCount === 0. Uses the existing
    //    f._noOrders builtin flag. Mast auto-creates customers for newsletter
    //    signups (mast-customer-resolver pkg, status='active' but no orders).
    h += '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:16px;font-size:0.85rem;color:var(--warm-gray);">';
    h += '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">' +
         '<input type="checkbox" id="customersNewsletterOnly" onchange="customersRender()" style="accent-color:var(--teal);">' +
         ' Newsletter subscribers' +
         '</label>';
    h += '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">' +
         '<input type="checkbox" id="customersLeadsOnly" onchange="customersRender()" style="accent-color:var(--teal);">' +
         ' Leads (no orders yet)' +
         '</label>';
    h += '</div>';

    h += '<div id="customersTableWrap"></div>';

    return h;
  }

  // Phase 6.1/6.2/6.3 — collect the active filter object from DOM controls.
  // Returns { search, source, tag, lastOrderBefore, minSpendCents, sortBy, builtinFlags }.
  function readActiveFilters() {
    return {
      search:           ((document.getElementById('customersSearch')           || {}).value || '').trim().toLowerCase(),
      source:           (document.getElementById('customersSourceFilter')      || {}).value || 'all',
      wholesale:        (document.getElementById('customersWholesaleFilter')   || {}).value || 'all',
      tag:              (document.getElementById('customersTagFilter')         || {}).value || '',
      lastOrderBefore:  (document.getElementById('customersLastOrderBefore')   || {}).value || '',
      minSpendDollars:  (document.getElementById('customersMinSpend')          || {}).value || '',
      sortBy:           (document.getElementById('customersSortBy')            || {}).value || 'updatedAt',
      newsletterOnly:   !!(document.getElementById('customersNewsletterOnly')  || {}).checked,
      leadsOnly:        !!(document.getElementById('customersLeadsOnly')       || {}).checked
    };
  }

  // W2d — true if any of the customer's emails appears in the authorized-users
  // map with a non-null wholesaleAccountId. Customers without a primary email
  // can never match wholesale.
  function isWholesaleCustomer(c) {
    if (!c) return false;
    var candidates = [];
    if (c.primaryEmail) candidates.push(c.primaryEmail);
    if (Array.isArray(c.emails)) candidates = candidates.concat(c.emails);
    for (var i = 0; i < candidates.length; i++) {
      var e = (candidates[i] || '').toLowerCase().trim();
      if (e && wholesaleEmailMap[e]) return true;
    }
    return false;
  }

  // Phase 6.1 — apply filter object to a customer record. Centralised so the
  // list table, CSV export and segments all share the same logic.
  //
  // The predicate body now lives in shared/customer-filters.js (window.MastCustomerFilters)
  // so the survey bulk-send flow in customer-service.js shares the exact same
  // matcher instead of a hand-synced mirror that had drifted (review D4-005).
  // We inject this module's wholesale resolver; the list keeps archived
  // customers visible, so excludeArchived stays false.
  function customerMatchesFilters(c, f) {
    return window.MastCustomerFilters.matches(c, f, { isWholesale: isWholesaleCustomer });
  }

  function renderEmptyState() {
    var h = '';
    h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
    h += '<div style="font-size:1.6rem;margin-bottom:12px;">👥</div>';
    h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No customers yet</p>';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">They\'ll appear here automatically as orders, enrollments, contacts, and newsletter signups come in.</p>';
    h += '</div>';
    return h;
  }

  // URL-driven filters from MCP admin links: tag, source, dateFrom,
  // dateTo, customerIds (#customers?...). Read once, used by getFilteredCustomers
  // and the banner renderer. URL-overrides-pill: when any URL filter is
  // present it bypasses pill / segment state for this render.
  function getCustomersUrlFilters() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var ids = (rp && typeof rp.customerIds === 'string' ? rp.customerIds : '')
      .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    var idLookup = ids.length > 0 ? Object.create(null) : null;
    if (idLookup) ids.forEach(function(id) { idLookup[id] = true; });
    return {
      tag:       (rp && typeof rp.tag === 'string') ? rp.tag : '',
      source:    (rp && typeof rp.source === 'string') ? rp.source : '',
      dateFrom:  (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '',
      dateTo:    (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '',
      ids:       ids,
      idLookup:  idLookup,
      get hasAny() {
        return !!(this.tag || this.source || this.dateFrom || this.dateTo || this.ids.length);
      }
    };
  }

  // Phase 6.1 — apply current segment + filters to the customer set.
  // Returns the filtered, sorted array. Shared by renderTable and CSV export.
  function getFilteredCustomers() {
    var urlF = getCustomersUrlFilters();

    if (urlF.hasAny) {
      // URL-driven filters from an MCP admin link override pill / segment state.
      if ((urlF.dateFrom || urlF.dateTo) && _tenantTz === null) {
        // First render uses browser TZ; re-render once tenant TZ resolves.
        ensureTenantTz().then(function() { renderTable(); });
      }
      var filteredU = customersData.filter(function(c) {
        if (!c || c.status === 'merged' || c.status === 'archived') return false;
        if (urlF.tag && (c.tags || []).indexOf(urlF.tag) === -1) return false;
        if (urlF.source && urlF.source !== 'all' && c.source !== urlF.source) return false;
        if (urlF.idLookup && !urlF.idLookup[c.id]) return false;
        if (urlF.dateFrom || urlF.dateTo) {
          var stats = c.stats || {};
          var d = tzDateStr(stats.firstOrderAt || '');
          if (!d) return false;
          if (urlF.dateFrom && d < urlF.dateFrom) return false;
          if (urlF.dateTo && d > urlF.dateTo) return false;
        }
        return true;
      });
      // Sort by spend desc by default for URL-driven views (matches the
      // common "top spenders" / "top customers" use case); fall back to
      // active sort if pill state has one selected.
      var fAct = readActiveFilters();
      var sortBy = fAct.sortBy || 'spend';
      filteredU.sort(function(a, b) {
        var sa = a.stats || {};
        var sb = b.stats || {};
        if (sortBy === 'name')      return (a.displayName || '').localeCompare(b.displayName || '');
        if (sortBy === 'email')     return (a.primaryEmail || '').localeCompare(b.primaryEmail || '');
        if (sortBy === 'lastOrder') return (sb.lastOrderAt || '').localeCompare(sa.lastOrderAt || '');
        if (sortBy === 'spend')     return (sb.lifetimeSpendCents || 0) - (sa.lifetimeSpendCents || 0);
        if (sortBy === 'orders')    return (sb.orderCount || 0) - (sa.orderCount || 0);
        if (sortBy === 'lapseScore') {
          var ascore = typeof sa.lapseScore === 'number' ? sa.lapseScore : -1;
          var bscore = typeof sb.lapseScore === 'number' ? sb.lapseScore : -1;
          return bscore - ascore;
        }
        if (sortBy === 'grossMargin') {
          return (sb.trailing12mGrossMarginCents || 0) - (sa.trailing12mGrossMarginCents || 0);
        }
        var av = a[sortBy] || '';
        var bv = b[sortBy] || '';
        return bv.localeCompare(av);
      });
      return filteredU;
    }

    var f = readActiveFilters();

    // Mix in built-in segment flags from the active segment.
    var seg = findSegmentById(currentSegmentId);
    if (seg && seg.filters) {
      if (seg.filters._newThisWeek) f._newThisWeek = true;
      if (seg.filters._noOrders)    f._noOrders = true;
    }

    var filtered = customersData.filter(function(c) {
      return customerMatchesFilters(c, f);
    });

    var sortBy = f.sortBy;
    filtered.sort(function(a, b) {
      var sa = a.stats || {};
      var sb = b.stats || {};
      if (sortBy === 'name')      return (a.displayName || '').localeCompare(b.displayName || '');
      if (sortBy === 'email')     return (a.primaryEmail || '').localeCompare(b.primaryEmail || '');
      if (sortBy === 'spend')     return (sb.lifetimeSpendCents || 0) - (sa.lifetimeSpendCents || 0);
      if (sortBy === 'orders')    return (sb.orderCount || 0) - (sa.orderCount || 0);
      if (sortBy === 'lastOrder') return (sb.lastOrderAt || '').localeCompare(sa.lastOrderAt || '');
      // createdAt / updatedAt — newest first
      var av = a[sortBy] || '';
      var bv = b[sortBy] || '';
      return bv.localeCompare(av);
    });

    return filtered;
  }

  // Re-rendered on every search/filter/sort change without re-fetching.
  function renderTable() {
    var wrap = document.getElementById('customersTableWrap');
    if (!wrap) return;

    // URL-filter banner — surfaces active MCP-link filters with a Clear
    // button. Inserted just above the table wrap, lazily.
    var urlF = getCustomersUrlFilters();
    var bannerEl = document.getElementById('customersUrlFilterBanner');
    if (!bannerEl && urlF.hasAny) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'customersUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      if (wrap.parentNode) wrap.parentNode.insertBefore(bannerEl, wrap);
    }
    if (bannerEl) {
      if (urlF.hasAny) {
        var parts = [];
        if (urlF.ids.length) parts.push(urlF.ids.length + ' selected customer' + (urlF.ids.length === 1 ? '' : 's'));
        if (urlF.tag) parts.push('tag: ' + urlF.tag);
        if (urlF.source) parts.push('source: ' + urlF.source);
        if (urlF.dateFrom && urlF.dateTo) parts.push('first order ' + urlF.dateFrom + ' to ' + urlF.dateTo);
        else if (urlF.dateFrom) parts.push('first order from ' + urlF.dateFrom + ' onward');
        else if (urlF.dateTo) parts.push('first order through ' + urlF.dateTo);
        bannerEl.innerHTML = '<span>👥 Showing ' + parts.join(', ') + '</span>' +
          '<button type="button" onclick="clearCustomersFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    var filtered = getFilteredCustomers();

    // W3 follow-up — defensive fallback. The W3 final verifier reported
    // `MastCustomers.listCustomers()` returning 83 customers while the rendered
    // table held zero <tr>. That can only happen via the early-return path
    // below — meaning getFilteredCustomers excluded everything. When the user
    // hasn't actually set any filter (no search text, no source/tag/date/spend
    // selection, no URL-driven filter), the chain shouldn't be dropping
    // everyone — recover by showing all non-merged customers and surface a
    // console warning. When user-driven filters ARE active, the empty state
    // now includes a "Clear filters" button so the user is never stuck.
    var fActSnap = readActiveFilters();
    var urlActiveSnap = getCustomersUrlFilters().hasAny;
    var anyUserFilterSnap = !!(
      fActSnap.search ||
      (fActSnap.source && fActSnap.source !== 'all') ||
      fActSnap.tag ||
      fActSnap.lastOrderBefore ||
      fActSnap.minSpendDollars ||
      fActSnap.newsletterOnly ||
      fActSnap.leadsOnly
    );
    if (filtered.length === 0 && customersData.length > 0) {
      var rawNonMerged = customersData.filter(function(c) { return c && c.status !== 'merged'; });
      if (rawNonMerged.length > 0 && !anyUserFilterSnap && !urlActiveSnap) {
        console.warn('[customers] filter chain returned 0 despite ' + rawNonMerged.length + ' non-merged customers; falling back to raw list. Active filters: ' + JSON.stringify(fActSnap));
        filtered = rawNonMerged;
      }
    }

    if (filtered.length === 0) {
      if (anyUserFilterSnap || urlActiveSnap) {
        wrap.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No customers match your filters. ' +
          '<button class="btn btn-secondary btn-small" onclick="clearCustomersFilter()" style="margin-left:8px;">Clear filters</button>' +
        '</div>';
      } else if (customersData.length === 0) {
        wrap.innerHTML = renderEmptyState();
      } else {
        // Defensive: customersData has rows but nothing was visible AND we have
        // no obvious filter pressure. Show every non-merged customer rather
        // than leave the user stuck.
        filtered = customersData.filter(function(c) { return c && c.status !== 'merged'; });
        if (filtered.length === 0) { wrap.innerHTML = renderEmptyState(); return; }
        // fall through to the normal table render below
      }
      if (filtered.length === 0) return;
    }

    // Sortable: apply current sort key/dir.
    if (typeof window.mastSortRows === 'function') {
      filtered = window.mastSortRows(filtered, customersSortKey, customersSortDir, function(row, key) {
        if (!row) return null;
        var stats = row.stats || {};
        if (key === 'displayName') return row.displayName || row.primaryEmail || '';
        if (key === 'primaryEmail') return row.primaryEmail || '';
        if (key === 'source') return row.source || '';
        if (key === 'orderCount') return Number(stats.orderCount) || 0;
        if (key === 'lifetimeSpendCents') return Number(stats.lifetimeSpendCents) || 0;
        if (key === 'status') return row.status || '';
        if (key === 'lastOrderAt') return stats.lastOrderAt || '';
        if (key === 'updatedAt') return row.updatedAt || '';
        return row[key];
      });
    }

    var rows = filtered.map(function(c) {
      var linked = c.linkedIds || {};
      var bits = [];
      var emailCount = (c.emails || []).length;
      var uidCount = (linked.uids || []).length;
      var contactCount = (linked.contactIds || []).length;
      if (emailCount > 1) bits.push(emailCount + ' emails');
      if (uidCount > 0) bits.push(uidCount + ' uid' + (uidCount > 1 ? 's' : ''));
      if (contactCount > 0) bits.push(contactCount + ' contact' + (contactCount > 1 ? 's' : ''));
      var linkedText = bits.length ? bits.join(' · ') : '—';

      var nameDisplay = esc(c.displayName || c.primaryEmail || c.id);
      var emailDisplay = esc(c.primaryEmail || '—');

      var stats = c.stats || {};
      var spendCell = (typeof stats.lifetimeSpendCents === 'number')
        ? esc(fmtMoney(stats.lifetimeSpendCents))
        : '<span style="color:var(--warm-gray-light);">—</span>';
      var ordersCell = (typeof stats.orderCount === 'number' && stats.orderCount > 0)
        ? esc(stats.orderCount + (stats.orderCount === 1 ? ' order' : ' orders'))
        : '<span style="color:var(--warm-gray-light);">—</span>';
      var lastOrderCell = stats.lastOrderAt
        ? esc(relativeTime(stats.lastOrderAt))
        : '<span style="color:var(--warm-gray-light);">—</span>';
      var statusCell = lapseChip(stats.lapseStatus, stats.lapseScore);

      return '<tr data-customer-id="' + esc(c.id) + '" style="cursor:pointer;" onclick="customersOpenDetail(this.dataset.customerId)">' +
        '<td>' + nameDisplay + '</td>' +
        '<td style="color:var(--warm-gray);">' + emailDisplay + '</td>' +
        '<td>' + sourceBadge(c.source) + '</td>' +
        '<td>' + ordersCell + '</td>' +
        '<td>' + spendCell + '</td>' +
        '<td>' + statusCell + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + lastOrderCell + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(linkedText) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(c.updatedAt || c.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var html = '';
    var nonMergedTotal = customersData.filter(function(c) { return c && c.status !== 'merged'; }).length;
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Showing ' + filtered.length + ' of ' + nonMergedTotal + '</div>';
    html += '<div class="data-table"><table>';
    html += '<thead><tr>';
    if (typeof window.mastSortableTh === 'function') {
      html += window.mastSortableTh('Name',         'displayName',        customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Primary email','primaryEmail',       customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Source',       'source',             customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Frequency',    'orderCount',         customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Spend',        'lifetimeSpendCents', customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Status',       'status',             customersSortKey, customersSortDir, 'window._customersSort');
      html += window.mastSortableTh('Last order',   'lastOrderAt',        customersSortKey, customersSortDir, 'window._customersSort');
      html += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);">Linked</th>';
      html += window.mastSortableTh('Last activity','updatedAt',          customersSortKey, customersSortDir, 'window._customersSort');
    } else {
      html += '<th>Name</th><th>Primary email</th><th>Source</th><th>Frequency</th><th>Spend</th><th>Status</th><th>Last order</th><th>Linked</th><th>Last activity</th>';
    }
    html += '</tr></thead>';
    html += '<tbody>' + rows + '</tbody>';
    html += '</table></div>';
    wrap.innerHTML = html;
  }

  // ============================================================
  // Surface 2: Customer Detail (Phase 5a — tabbed)
  // ============================================================

  function renderDetail() {
    var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
    if (!c) {
      return '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Customer not found.</div>';
    }

    var h = '';
    var backLabel = (window.MastNavStack && MastNavStack.label()) ? ('← Back to ' + MastNavStack.label()) : '← Back to Customers';
    h += '<button class="detail-back" onclick="customersBackFromDetail()">' + esc(backLabel) + '</button>';

    // Header — Paradigm A: Edit button right side (read mode only); Source badge inline
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(c.displayName || c.primaryEmail || c.id) + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(c.primaryEmail || 'no primary email') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += sourceBadge(c.source) || '';
    if (!customerEditMode) {
      h += '<button class="btn btn-secondary btn-small" onclick="customersEnterEdit()">Edit</button>';
    } else {
      h += '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
    }
    h += '</div>';
    h += '</div>';

    // Sub-tabs
    h += '<div class="view-tabs" style="margin-bottom:16px;">';
    DETAIL_TABS.forEach(function(t) {
      var active = (detailTab === t.value) ? ' active' : '';
      h += '<button class="view-tab' + active + '" data-detail-tab="' + esc(t.value) +
           '" onclick="customersSwitchDetailTab(this.dataset.detailTab)">' + esc(t.label) + '</button>';
    });
    h += '</div>';

    h += '<div id="customersDetailTabBody">';
    if (detailTab === 'overview')          h += renderOverviewTab(c);
    else if (detailTab === 'orders')       h += renderOrdersTab(c);
    else if (detailTab === 'activity')     h += renderActivityTab(c);
    else if (detailTab === 'classes')      h += renderClassesTab(c);
    else if (detailTab === 'wallet')       h += renderWalletTab(c);
    // Legacy routes — fall through to Activity so saved deep-links keep
    // working after the 5a tab refactor.
    else if (detailTab === 'interactions') h += renderActivityTab(c);
    else if (detailTab === 'contacts')     h += renderActivityTab(c);
    h += '</div>';

    return h;
  }

  function identityRow(label, valueHtml) {
    return '<div style="color:var(--warm-gray-light);">' + esc(label) + '</div>' +
           '<div>' + valueHtml + '</div>';
  }

  function detailCardOpen(title) {
    var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    if (title) h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">' + esc(title) + '</div>';
    return h;
  }
  function detailCardClose() { return '</div>'; }

  function getCache(customerId) {
    if (!detailCache[customerId]) {
      detailCache[customerId] = { orders: [], enrollments: [], interactions: [], wallets: [], loaded: {} };
    }
    return detailCache[customerId];
  }

  function renderTagsEditor(c) {
    var tags = c.tags || [];
    var h = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
    tags.forEach(function(t) {
      h += '<span class="status-badge" style="background:rgba(196,133,60,0.30);color:var(--amber-light);display:inline-flex;align-items:center;gap:6px;">' +
        esc(t) +
        '<button data-customer-id="' + esc(c.id) + '" data-tag="' + esc(t) + '" ' +
        'onclick="customersRemoveTag(this.dataset.customerId, this.dataset.tag)" ' +
        'style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.9rem;line-height:1;padding:0;">×</button>' +
        '</span>';
    });
    h += '<input type="text" id="customersTagInput" placeholder="+ tag" ' +
         'data-customer-id="' + esc(c.id) + '" ' +
         'onkeydown="if(event.key===\'Enter\'){event.preventDefault();customersAddTag(this.dataset.customerId,this.value);this.value=\'\';}" ' +
         'style="padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.78rem;width:90px;">';
    h += '</div>';
    return h;
  }

  function renderNewsletterToggle(c) {
    var on = !!(c.marketing && c.marketing.newsletterOptIn);
    var bg = on ? 'rgba(22,163,74,0.30)' : 'rgba(155,149,142,0.35)';
    var color = on ? '#7ddca0' : '#cfcac3';
    var label = on ? 'Opted in' : 'Not opted in';
    return '<button data-customer-id="' + esc(c.id) + '" data-on="' + (on ? '1' : '0') + '" ' +
      'onclick="customersToggleNewsletter(this.dataset.customerId, this.dataset.on === \'1\')" ' +
      'style="background:' + bg + ';color:' + color + ';border:none;padding:3px 10px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;cursor:pointer;">' +
      esc(label) + '</button>';
  }

  // Writer — updates customer field and refreshes the in-memory copy + UI.
  function saveCustomerField(customerId, fieldPath, value) {
    var updates = {};
    updates[fieldPath] = value;
    updates['updatedAt'] = new Date().toISOString();
    return MastDB.update('admin/customers/' + customerId, updates).then(function() {
      // Mirror into in-memory copy
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      if (c) {
        // Apply field path (only top-level or marketing.x for now)
        if (fieldPath.indexOf('.') !== -1) {
          var parts = fieldPath.split('.');
          if (!c[parts[0]]) c[parts[0]] = {};
          c[parts[0]][parts[1]] = value;
        } else {
          c[fieldPath] = value;
        }
        c.updatedAt = updates['updatedAt'];
      }
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') {
        renderPreservingEdits();
      }
      toast('Saved');
    }).catch(function(e) {
      console.error('[customers] save failed', fieldPath, e);
      toast('Save failed: ' + (e && e.message), true);
    });
  }

  // ------------------------------------------------------------
  // Paradigm A — customer edit mode lifecycle
  // ------------------------------------------------------------

  // MastDirty integration — baseline of identity inputs only.
  // Notes/tags/newsletter/archive are atomic widgets, excluded by design.
  var _custEditBaseline = null;
  function _custEditCaptureBaseline() {
    setTimeout(function() {
      var nameInput = document.getElementById('custIdentityDisplayName');
      var emailInput = document.getElementById('custIdentityPrimaryEmail');
      _custEditBaseline = {
        name: nameInput ? nameInput.value : '',
        email: emailInput ? emailInput.value : ''
      };
      _custEditUpdateDirtyIndicator();
    }, 0);
  }
  function _custEditIsDirty() {
    if (!customerEditMode) return false;
    var nameInput = document.getElementById('custIdentityDisplayName');
    var emailInput = document.getElementById('custIdentityPrimaryEmail');
    if (!nameInput || !emailInput || !_custEditBaseline) return false;
    return nameInput.value !== _custEditBaseline.name || emailInput.value !== _custEditBaseline.email;
  }
  function _custEditUpdateDirtyIndicator() {
    var btn = document.querySelector('#customersTab button.btn-primary[onclick*="customersSaveEdit"]');
    if (!btn) return;
    if (_custEditIsDirty()) btn.classList.add('dirty');
    else btn.classList.remove('dirty');
  }

  function enterCustomerEditMode() {
    customerEditMode = true;
    renderPreservingEdits();
    if (window.MastDirty) {
      MastDirty.register('customerEdit', _custEditIsDirty, { label: 'Customer detail' });
    }
    _custEditCaptureBaseline();
  }

  function cancelCustomerEditMode() {
    var doCancel = function() {
      customerEditMode = false;
      _custEditBaseline = null;
      if (window.MastDirty) MastDirty.unregister('customerEdit');
      // Discard any in-flight changes by NOT preserving — straight render
      // pulls fresh values from in-memory customersData.
      render();
    };
    if (window.MastDirty && MastDirty.getDirtyKeys().indexOf('customerEdit') !== -1) {
      MastDirty.checkAndExit(doCancel);
    } else {
      doCancel();
    }
  }

  // Save commits any changed identity fields, stays in edit mode (matches
  // the product flow Paradigm A pattern), and shows a toast.
  function saveCustomerEditMode() {
    if (!selectedCustomerId) return;
    var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
    if (!c) return;

    var nameInput = document.getElementById('custIdentityDisplayName');
    var emailInput = document.getElementById('custIdentityPrimaryEmail');
    if (!nameInput && !emailInput) {
      // Nothing to save (probably not on overview tab)
      toast('Saved');
      return;
    }

    var newName = nameInput ? (nameInput.value || '').trim() : (c.displayName || '');
    var newEmail = emailInput ? (emailInput.value || '').trim() : (c.primaryEmail || '');
    var oldName = c.displayName || '';
    var oldEmail = c.primaryEmail || '';

    var updates = {};
    if (newName !== oldName) updates.displayName = newName || null;
    if (newEmail !== oldEmail) updates.primaryEmail = newEmail || null;

    if (Object.keys(updates).length === 0) {
      // No changes — just confirm and stay in edit mode
      toast('No changes to save');
      return;
    }

    updates.updatedAt = new Date().toISOString();
    MastDB.update('admin/customers/' + selectedCustomerId, updates).then(function() {
      // Mirror into in-memory copy
      Object.keys(updates).forEach(function(k) {
        c[k] = updates[k];
      });
      // Live-update the header h3 since the name may have changed
      var h3 = document.querySelector('#customersTab h3');
      if (h3) h3.innerText = c.displayName || c.primaryEmail || c.id;
      toast('Saved');
      // Stay in edit mode — Paradigm A. Retake baseline so dirty clears.
      renderPreservingEdits();
      _custEditCaptureBaseline();
    }).catch(function(e) {
      console.error('[customers] save edit failed', e);
      toast('Save failed: ' + (e && e.message), true);
    });
  }

  function addTag(customerId, raw) {
    var t = (raw || '').trim();
    if (!t) return;
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var tags = (c.tags || []).slice();
    if (tags.indexOf(t) !== -1) return;
    tags.push(t);
    saveCustomerField(customerId, 'tags', tags);
  }

  function removeTag(customerId, tag) {
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var tags = (c.tags || []).filter(function(t) { return t !== tag; });
    saveCustomerField(customerId, 'tags', tags);
  }

  function toggleNewsletter(customerId, currentlyOn) {
    saveCustomerField(customerId, 'marketing/newsletterOptIn', !currentlyOn);
    // saveCustomerField stores via update on the customer ref, but marketing is
    // nested. Use a separate path-based update so we don't blow away smsOptIn.
  }

  // Override toggleNewsletter to use the shared CustomersBridge.setMarketingOptIn
  // core (deep set on the nested marketing object) — single-sourced with the V2
  // twin's opt-in toggles.
  toggleNewsletter = function(customerId, currentlyOn) {
    var newVal = !currentlyOn;
    CustomersBridge.setMarketingOptIn(customerId, 'newsletter', newVal).then(function() {
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') renderPreservingEdits();
      }, 0);
      toast(newVal ? 'Opted in to newsletter' : 'Opted out of newsletter');
    }).catch(function(e) {
      console.error('[customers] newsletter toggle failed', e);
      toast('Toggle failed: ' + (e && e.message), true);
    });
  };

  function saveNotes(customerId, value) {
    saveCustomerField(customerId, 'notes', value || '');
  }

  // ----- Merge -----

  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function(v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  async function mergeCustomers(flagId, winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    var winnerCust = customersData.find(function(x) { return x && x.id === winnerId; });
    var loserCust = customersData.find(function(x) { return x && x.id === loserId; });
    var winnerLabel = (winnerCust && (winnerCust.displayName || winnerCust.primaryEmail)) || 'this customer';
    var loserLabel = (loserCust && (loserCust.displayName || loserCust.primaryEmail)) || 'the other customer';
    var ok = await window.mastConfirm(
      'Merge "' + loserLabel + '" into "' + winnerLabel + '"?\n\nThis rewrites all linked orders, enrollments and contacts. This cannot be undone.',
      { title: 'Merge customers', confirmLabel: 'Merge', danger: true }
    );
    if (!ok) return;

    try {
      var refs = await Promise.all([
        MastDB.get('admin/customers/' + winnerId),
        MastDB.get('admin/customers/' + loserId),
        MastDB.query('orders').orderByChild('customerId').equalTo(loserId).once('value'),
        MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(loserId).once('value')
      ]);
      var winner = refs[0].val();
      var loser = refs[1].val();
      if (!winner || !loser) { await window.mastAlert('One of the customers no longer exists.'); return; }

      var loserOrders = refs[2].val() || {};
      var loserEnrollments = refs[3].val() || {};

      var winnerLinked = winner.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var loserLinked = loser.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };

      var mergedEmails = uniq([].concat(winner.emails || [], loser.emails || []));
      var mergedPhones = uniq([].concat(winner.phones || [], loser.phones || []));
      var mergedUids = uniq([].concat(winnerLinked.uids || [], loserLinked.uids || []));
      var mergedContactIds = uniq([].concat(winnerLinked.contactIds || [], loserLinked.contactIds || []));
      var mergedStudentIds = uniq([].concat(winnerLinked.studentIds || [], loserLinked.studentIds || []));
      var mergedTags = uniq([].concat(winner.tags || [], loser.tags || []));
      var mergedFromList = uniq([].concat(winner.mergedFrom || [], [loserId], loser.mergedFrom || []));
      var now = new Date().toISOString();

      var notes = winner.notes || '';
      if (loser.notes) {
        notes = (notes ? notes + '\n\n' : '') + '— merged from ' + loserId + ' —\n' + loser.notes;
      }

      var updates = {};
      // Winner record overwrites
      updates['admin/customers/' + winnerId + '/emails'] = mergedEmails;
      updates['admin/customers/' + winnerId + '/phones'] = mergedPhones;
      updates['admin/customers/' + winnerId + '/linkedIds'] = {
        uids: mergedUids,
        contactIds: mergedContactIds,
        studentIds: mergedStudentIds,
        squareCustomerId: winnerLinked.squareCustomerId || loserLinked.squareCustomerId || null
      };
      updates['admin/customers/' + winnerId + '/tags'] = mergedTags;
      updates['admin/customers/' + winnerId + '/notes'] = notes;
      updates['admin/customers/' + winnerId + '/marketing/newsletterOptIn'] =
        !!((winner.marketing && winner.marketing.newsletterOptIn) || (loser.marketing && loser.marketing.newsletterOptIn));
      updates['admin/customers/' + winnerId + '/mergedFrom'] = mergedFromList;
      updates['admin/customers/' + winnerId + '/updatedAt'] = now;

      // Loser archive
      updates['admin/customers/' + loserId + '/status'] = 'merged';
      updates['admin/customers/' + loserId + '/mergedInto'] = winnerId;
      updates['admin/customers/' + loserId + '/updatedAt'] = now;

      // Reindex byEmail/byUid/byContactId for loser → winner. Use the shared
      // canonical key (gmail dot/+tag aware) so merged keys match the resolver.
      function emailKey(e) {
        if (window.MastCustomerResolver) return window.MastCustomerResolver.emailKey(e);
        return e ? String(e).trim().toLowerCase().replace(/[.#$\[\]\/]/g, ',') : null;
      }
      (loser.emails || []).forEach(function(e) {
        var k = emailKey(e);
        if (k) updates['admin/customerIndexes/byEmail/' + k] = winnerId; // lint-customer-writes-ok: merge re-points loser's byEmail key to winner
      });
      (loserLinked.uids || []).forEach(function(u) {
        updates['admin/customerIndexes/byUid/' + u] = winnerId;
      });
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/customerIndexes/byContactId/' + cid] = winnerId;
      });

      // Rewrite customerId on linked orders + enrollments
      Object.keys(loserOrders).forEach(function(orderId) {
        updates['orders/' + orderId + '/customerId'] = winnerId;
      });
      Object.keys(loserEnrollments).forEach(function(enId) {
        updates['admin/enrollments/' + enId + '/customerId'] = winnerId;
      });

      // Rewrite customerId on linked contacts (so contact records still point at winner)
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/contacts/' + cid + '/customerId'] = winnerId;
      });

      // Mark duplicate flag merged
      if (flagId) {
        updates['admin/customerDuplicates/' + flagId + '/status'] = 'merged';
        updates['admin/customerDuplicates/' + flagId + '/mergedAt'] = now;
        updates['admin/customerDuplicates/' + flagId + '/winnerId'] = winnerId;
        updates['admin/customerDuplicates/' + flagId + '/loserId'] = loserId;
      }

      await MastDB.multiUpdate(updates);

      // Reload
      customersLoaded = false;
      detailCache = {};
      await loadCustomers();
    } catch (e) {
      console.error('[customers] merge failed', e);
      window.mastAlert('Merge failed: ' + (e && e.message));
    }
  }

  function fmtMoney(cents) {
    if (typeof cents !== 'number') return '—';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return '—'; }
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (e) { return '—'; }
  }

  // ----- Overview tab -----

  function renderOverviewTab(c) {
    var cache = getCache(c.id);

    var h = '';

    // Identity card — Paradigm A: plain text in read mode, inputs in edit mode.
    // Tags and Newsletter are atomic widgets and stay live regardless of edit mode.
    var inlineInputStyle = 'width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;';
    var nameField, emailField;
    if (customerEditMode) {
      nameField = '<input type="text" id="custIdentityDisplayName" data-customer-id="' + esc(c.id) + '" ' +
        'value="' + esc(c.displayName || '') + '" placeholder="(no name)" ' +
        'oninput="customersLiveUpdateHeader(this.value)" ' +
        'style="' + inlineInputStyle + '">';
      emailField = '<input type="text" id="custIdentityPrimaryEmail" data-customer-id="' + esc(c.id) + '" ' +
        'value="' + esc(c.primaryEmail || '') + '" placeholder="no primary email" ' +
        'autocomplete="off" ' +
        'style="' + inlineInputStyle + '">';
    } else {
      nameField = esc(c.displayName || '—');
      emailField = esc(c.primaryEmail || '—');
    }
    h += detailCardOpen('Identity');
    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
    h += identityRow('Name', nameField);
    h += identityRow('Primary email', emailField);
    h += identityRow('Tags', renderTagsEditor(c));
    h += identityRow('Newsletter', renderNewsletterToggle(c));
    h += identityRow('Source', sourceBadge(c.source) || '—');
    h += identityRow('Created', esc(fmtDateTime(c.createdAt)));
    h += identityRow('Updated', esc(fmtDateTime(c.updatedAt)));
    h += '</div>';
    h += detailCardClose();

    // Notes card
    h += detailCardOpen('Notes');
    h += '<textarea id="custNotesTextarea" data-customer-id="' + esc(c.id) + '" onblur="customersSaveNotes(this.dataset.customerId, this.value)" ' +
         'placeholder="Internal notes (saved on blur)…" ' +
         'style="width:100%;min-height:90px;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;resize:vertical;">' + esc(c.notes || '') + '</textarea>';
    h += detailCardClose();

    // Stats card — Phase 6.1 reads from c.stats (maintained by Cloud Function
    // triggers). Falls back to per-tab cache when stats haven't been computed
    // yet, which is "—" for an empty customer. The "load Orders tab" copy is
    // gone — stats are always available without opening tabs.
    h += detailCardOpen('Stats');
    var stats = c.stats || null;
    var hasStats = !!(stats && (typeof stats.lifetimeSpendCents === 'number' || stats.statsUpdatedAt));
    var spendStr   = hasStats ? fmtMoney(stats.lifetimeSpendCents || 0) : '—';
    var ordCntStr  = hasStats ? String(stats.orderCount || 0) : '—';
    var firstStr   = hasStats ? fmtDate(stats.firstOrderAt) : '—';
    var lastStr    = hasStats ? fmtDate(stats.lastOrderAt) : '—';
    var enrCntStr  = hasStats ? String(stats.enrollmentCount || 0) : '—';
    var lastEnrStr = hasStats ? fmtDate(stats.lastEnrollmentAt) : '—';

    h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;margin-top:4px;">';
    h += identityRow('Lifetime spend',  esc(spendStr));
    h += identityRow('Order count',     esc(ordCntStr));
    h += identityRow('First order',     esc(firstStr));
    h += identityRow('Last order',      esc(lastStr));
    h += identityRow('Enrollments',     esc(enrCntStr));
    h += identityRow('Last enrollment', esc(lastEnrStr));
    // Build 3 — cadence + lapse meter. Only render when there's real signal.
    if (hasStats && typeof stats.medianIntervalDays === 'number' && stats.medianIntervalDays > 0) {
      var cadenceStr = stats.medianIntervalDays + (stats.medianIntervalDays === 1 ? ' day' : ' days');
      h += identityRow('Median reorder cadence', esc(cadenceStr));
      if (stats.expectedNextOrderBy) {
        var nextStr = fmtDate(stats.expectedNextOrderBy);
        h += identityRow('Expected next order', esc(nextStr));
      }
      if (stats.lapseStatus && stats.lapseStatus !== 'unknown') {
        var scoreText = (typeof stats.lapseScore === 'number') ? (' &middot; ' + stats.lapseScore.toFixed(2) + '&times; expected') : '';
        h += identityRow('Lapse status', lapseChip(stats.lapseStatus, stats.lapseScore) + '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:8px;">' + scoreText + '</span>');
      }
    }
    h += '</div>';
    if (!hasStats) {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:10px;">';
      h += 'Cached stats not yet computed. They populate automatically on the next order or enrollment write — or run "Recompute stats" from the customers list.';
      h += '</div>';
    } else if (stats.statsUpdatedAt) {
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:10px;">';
      h += 'Updated ' + esc(relativeTime(stats.statsUpdatedAt));
      h += '</div>';
    }
    h += detailCardClose();

    // Build 6b — Trailing-12m financial card. Renders only when there's
    // real signal (revenue OR gross margin populated). Cost-to-serve +
    // net contribution come from get_customer_portfolio at query time —
    // here we surface what's denormalized on stats: revenue, cogs, GM,
    // net margin %. Quadrant inferred client-side from margin + lapse
    // (mirrors server classifyQuadrant).
    var fin = c.stats || {};
    var hasFin = (typeof fin.trailing12mRevenueCents === 'number' && fin.trailing12mRevenueCents > 0)
              || (typeof fin.trailing12mGrossMarginCents === 'number' && fin.trailing12mGrossMarginCents > 0);
    if (hasFin) {
      h += detailCardOpen('Financial contribution (trailing 12m)');
      h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
      h += identityRow('Revenue', esc(fmtMoney(fin.trailing12mRevenueCents || 0)));
      h += identityRow('COGS', esc(fmtMoney(fin.trailing12mCogsCents || 0)));
      h += identityRow('Gross margin', esc(fmtMoney(fin.trailing12mGrossMarginCents || 0)));
      if (typeof fin.trailing12mNetMarginPct === 'number') {
        h += identityRow('Net margin %', esc((fin.trailing12mNetMarginPct * 100).toFixed(1) + '%'));
      }
      var quadrant = portfolioQuadrant(fin.trailing12mNetMarginPct, fin.lapseStatus);
      if (quadrant !== 'unclassified') {
        h += identityRow('Portfolio quadrant', portfolioQuadrantChip(quadrant));
      }
      h += '</div>';
      // Flag missing-cogs orders so the operator knows the GM may be under-counted.
      if (typeof fin.trailing12mOrdersWithoutCogs === 'number' && fin.trailing12mOrdersWithoutCogs > 0) {
        h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:10px;">';
        h += esc(String(fin.trailing12mOrdersWithoutCogs)) + ' order' + (fin.trailing12mOrdersWithoutCogs === 1 ? '' : 's') + ' missing COGS — GM may be under-counted. ';
        h += 'Run the COGS backfill or link these products to recipes.';
        h += '</div>';
      }
      h += detailCardClose();
    }

    // Build 5a — Linked contacts summary card. Replaces the standalone
    // Contacts tab (consolidated to stay within max-5-tabs rule). Lists
    // each linked contact with a drill-through to the contacts module;
    // editing remains in the contacts module (Paradigm A drill-through).
    var linkedC = c.linkedIds || {};
    var linkedContactIds = linkedC.contactIds || [];
    h += detailCardOpen('Linked contacts');
    if (linkedContactIds.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No linked contacts yet. ';
      h += '<a href="#" onclick="customersAddContact();return false;" style="color:var(--teal);text-decoration:underline;">Add a contact</a> to attach addresses, phones, or interactions to this customer.</div>';
    } else {
      var contactsCache = getCache(c.id);
      if (!contactsCache.loaded.contacts) {
        // Trigger fetch; will re-render when ready.
        loadCustomerContacts(c.id);
        h += '<div class="loading">Loading…</div>';
      } else {
        var cts = contactsCache.contacts || [];
        h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + cts.length + ' linked contact' + (cts.length === 1 ? '' : 's') + '</div>';
        h += '<div style="display:flex;flex-direction:column;gap:4px;">';
        cts.slice(0, 5).forEach(function(ct) {
          var nm = ct.name || ct.email || ct._id;
          var sub = [ct.email, ct.phone, ct.address].filter(Boolean).join(' · ');
          h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:6px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;cursor:pointer;" data-contact-id="' + esc(ct._id) + '" onclick="customersOpenContact(this.dataset.contactId)">';
          h += '<div><div style="font-weight:600;">' + esc(nm) + '</div>' + (sub ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(sub) + '</div>' : '') + '</div>';
          h += '<div style="font-size:0.72rem;color:var(--teal);white-space:nowrap;">Open →</div>';
          h += '</div>';
        });
        h += '</div>';
        if (cts.length > 5) {
          h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">+ ' + (cts.length - 5) + ' more — drill in for the full list.</div>';
        }
        h += '<div style="margin-top:10px;"><a href="#" onclick="customersAddContact();return false;" style="font-size:0.78rem;color:var(--teal);text-decoration:underline;">+ Add another contact</a></div>';
      }
    }
    h += detailCardClose();

    // Save / Cancel buttons — Paradigm A, only when editing
    if (customerEditMode) {
      h += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark);">';
      h += '<button class="btn btn-secondary" onclick="customersCancelEdit()">Cancel</button>';
      h += '<button class="btn btn-primary" onclick="customersSaveEdit()">Save</button>';
      h += '</div>';
    }

    return h;
  }

  // ----- Orders tab -----

  function renderOrdersTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.orders) {
      // Fire async load and show loading
      loadCustomerOrders(c.id);
      return '<div class="loading">Loading orders…</div>';
    }
    var orders = cache.orders;
    if (!orders.length) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No orders linked to this customer.</div>';
    }
    orders = orders.slice().sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var contactsById = cache.orderContacts || {};

    var rows = orders.map(function(o) {
      var num = o.orderNumber || o._id || '—';
      var status = o.status || '—';
      var items = (o.items || []).reduce(function(s, it) { return s + (it.qty || 1); }, 0);

      // Ship to cell — drill-through to contact module if contactId present.
      var shipCell;
      if (o.contactId && contactsById[o.contactId]) {
        var ct = contactsById[o.contactId];
        var shipName = ct.name || '';
        var shipAddr = ct.address || '';
        var displayName = (shipName && shipName !== c.displayName) ? shipName : '';
        var shipText = displayName ? (displayName + ' · ' + shipAddr) : shipAddr;
        shipCell = '<td style="color:var(--warm-gray);font-size:0.78rem;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" ' +
          'data-contact-id="' + esc(o.contactId) + '" ' +
          'onclick="event.stopPropagation();customersOpenContact(this.dataset.contactId);">' +
          esc(shipText || '—') + '</td>';
      } else {
        shipCell = '<td style="color:var(--warm-gray);">—</td>';
      }

      return '<tr data-order-id="' + esc(o._id) + '" style="cursor:pointer;" onclick="customersOpenOrder(this.dataset.orderId)">' +
        '<td>' + esc(num) + '</td>' +
        '<td><span class="status-badge">' + esc(status) + '</span></td>' +
        '<td>' + esc(fmtMoney(o.totalCents)) + '</td>' +
        '<td style="color:var(--warm-gray);">' + items + '</td>' +
        shipCell +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(o.createdAt)) + '</td>' +
      '</tr>';
    }).join('');

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + '</div>';
    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Order #</th><th>Status</th><th>Total</th><th>Items</th><th>Ship to</th><th>Placed</th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    return h;
  }

  function loadCustomerOrders(customerId) {
    var cache = getCache(customerId);
    MastDB.query('orders').orderByChild('customerId').equalTo(customerId).once('value')
      .then(function(snap) {
        var val = snap.val() || {};
        cache.orders = Object.entries(val).map(function(e) { var o = e[1] || {}; o._id = e[0]; return o; });
        cache.loaded.orders = true;

        // Load any linked shipping contacts in parallel.
        var contactIds = cache.orders
          .map(function(o) { return o.contactId; })
          .filter(function(id, i, arr) { return id && arr.indexOf(id) === i; });
        if (contactIds.length === 0) {
          cache.orderContacts = {};
          if (currentView === 'detail' && selectedCustomerId === customerId &&
              (detailTab === 'orders' || detailTab === 'overview')) {
            renderPreservingEdits();
          }
          return;
        }
        Promise.all(contactIds.map(function(cid) {
          return MastDB.get('admin/contacts/' + cid)
            .then(function(s) { return { id: cid, val: s.val() }; })
            .catch(function() { return { id: cid, val: null }; });
        })).then(function(results) {
          var byId = {};
          results.forEach(function(r) { if (r.val) byId[r.id] = r.val; });
          cache.orderContacts = byId;
          if (currentView === 'detail' && selectedCustomerId === customerId &&
              (detailTab === 'orders' || detailTab === 'overview')) {
            renderPreservingEdits();
          }
        });
      })
      .catch(function(e) {
        console.error('[customers] orders load failed', e);
        cache.orders = [];
        cache.orderContacts = {};
        cache.loaded.orders = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) renderPreservingEdits();
      });
  }

  // ----- Classes tab -----

  function renderClassesTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.enrollments) {
      loadCustomerEnrollments(c.id);
    }
    if (!cache.loaded.certs) {
      loadCustomerCerts(c.id);
    }

    var h = '';
    h += renderCertsSubsection(c, cache);

    if (!cache.loaded.enrollments) {
      h += '<div class="loading">Loading enrollments…</div>';
      return h;
    }
    var enrollments = cache.enrollments || [];
    if (!enrollments.length) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No class enrollments linked to this customer.</div>';
      return h;
    }
    enrollments = enrollments.slice().sort(function(a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    var classNames = cache.classNames || {};
    var rows = enrollments.map(function(en) {
      var name = en.className || en.classTitle || classNames[en.classId] || en.classId || '—';
      var sessionDate = en.sessionDate || en.sessionStartAt || en.scheduledFor || en.createdAt;
      var status = en.status || en.enrollmentStatus || '—';
      var price = (typeof en.priceCents === 'number') ? en.priceCents : (typeof en.amountCents === 'number' ? en.amountCents : null);
      var clickable = en.classId
        ? ' style="cursor:pointer;" onclick="customersOpenActivityDrillIn(\'classes\',\'' + esc(en.classId) + '\')"'
        : '';
      return '<tr' + clickable + '>' +
        '<td>' + (en.classId ? '<a style="color:var(--teal,#2a7c6f);">' + esc(name) + '</a>' : esc(name)) + '</td>' +
        '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(sessionDate)) + '</td>' +
        '<td><span class="status-badge">' + esc(status) + '</span></td>' +
        '<td>' + esc(price === null ? '—' : fmtMoney(price)) + '</td>' +
      '</tr>';
    }).join('');

    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + enrollments.length + ' enrollment' + (enrollments.length === 1 ? '' : 's') + '</div>';
    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Class</th><th>Session</th><th>Status</th><th>Price</th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    return h;
  }

  // Per-customer toggle: show revoked/expired certs in the sub-section.
  var _certsShowInactive = {};

  function renderCertsSubsection(c, cache) {
    var h = '<div style="margin-bottom:20px;">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    h += '<h4 style="margin:0;font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--warm-gray);">Certifications</h4>';
    h += '<button class="btn btn-link" onclick="window.customersGrantCertOpen(\'' + esc(c.id) + '\')">+ Grant cert</button>';
    h += '</div>';
    if (!cache.loaded.certs) {
      h += '<div style="color:var(--warm-gray);font-size:0.85rem;">Loading…</div></div>';
      return h;
    }
    var certs = cache.certs || [];
    var types = cache.certTypes || {};
    var now = new Date().toISOString();
    var showInactive = !!_certsShowInactive[c.id];

    function isActive(cert) {
      if (!cert) return false;
      if (cert.revokedAt) return false;
      if (cert.expiresAt && cert.expiresAt < now) return false;
      return true;
    }
    var active = certs.filter(isActive);
    var inactive = certs.filter(function(x) { return x && !isActive(x); });

    function statusBadge(cert) {
      if (cert.revokedAt) return '<span style="font-size:0.72rem;color:#b91c1c;">Revoked</span>';
      if (cert.expiresAt && cert.expiresAt < now) return '<span style="font-size:0.72rem;color:var(--warm-gray);">Expired</span>';
      return '<span style="font-size:0.72rem;color:var(--teal,#2a7c6f);">Active</span>';
    }

    function rowFor(cert, isInactiveRow) {
      var typeName = (types[cert.typeId] && types[cert.typeId].name) || cert.typeId;
      var attestor = cert.instructorOfRecord && cert.instructorOfRecord.displayName
        ? cert.instructorOfRecord.displayName
        : (cert.grantedBy || '—');
      var grantedDate = cert.grantedAt ? fmtDate(cert.grantedAt) : '—';
      var expires = cert.expiresAt ? fmtDate(cert.expiresAt) : 'Lifetime';
      var lastCol = isInactiveRow
        ? (cert.revokedAt
            ? '<span style="font-size:0.72rem;color:var(--warm-gray);" title="' + esc(cert.revokeReason || '') + '">' + esc(_revokeReasonLabel(cert.revokeReason)) + '</span>'
            : '')
        : '<button class="btn btn-link" onclick="window.customersRevokeCert(\'' + esc(c.id) + '\',\'' + esc(cert.id) + '\')">Revoke</button>';
      return '<tr' + (isInactiveRow ? ' style="opacity:0.6;"' : '') + '>' +
        '<td><strong>' + esc(typeName) + '</strong></td>' +
        '<td>' + statusBadge(cert) + '</td>' +
        '<td style="font-size:0.78rem;color:var(--warm-gray);">Attested by ' + esc(attestor) + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(grantedDate) + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(expires) + '</td>' +
        '<td style="text-align:right;">' + lastCol + '</td>' +
      '</tr>';
    }

    if (!active.length && !(showInactive && inactive.length)) {
      h += '<div style="color:var(--warm-gray);font-size:0.85rem;padding:8px 0;">No active certifications.</div>';
      if (inactive.length) {
        h += '<button class="btn btn-link" style="font-size:0.78rem;" onclick="window.customersToggleRevokedCerts(\'' + esc(c.id) + '\')">Show ' + inactive.length + ' revoked/expired</button>';
      }
      h += '</div>';
      return h;
    }

    var rows = active.map(function(cert) { return rowFor(cert, false); }).join('');
    if (showInactive) {
      rows += inactive.map(function(cert) { return rowFor(cert, true); }).join('');
    }

    h += '<div class="data-table"><table>';
    h += '<thead><tr><th>Certification</th><th>Status</th><th>Attestor</th><th>Granted</th><th>Expires</th><th></th></tr></thead>';
    h += '<tbody>' + rows + '</tbody>';
    h += '</table></div>';
    if (inactive.length) {
      h += '<button class="btn btn-link" style="font-size:0.78rem;margin-top:4px;" onclick="window.customersToggleRevokedCerts(\'' + esc(c.id) + '\')">' +
        (showInactive ? 'Hide revoked/expired' : 'Show ' + inactive.length + ' revoked/expired') + '</button>';
    }
    h += '</div>';
    return h;
  }

  function _revokeReasonLabel(reason) {
    var map = {
      'mistake': 'Granted in error',
      'violation': 'Policy violation',
      'expired-by-policy': 'Expired by policy',
      'other': 'Other'
    };
    return map[reason] || (reason ? reason : 'Revoked');
  }

  window.customersToggleRevokedCerts = function(customerId) {
    _certsShowInactive[customerId] = !_certsShowInactive[customerId];
    if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'classes') {
      renderPreservingEdits();
    }
  };

  function loadCustomerCerts(customerId) {
    var cache = getCache(customerId);
    Promise.all([
      MastDB.get('admin/customers/' + customerId + '/certifications'),
      MastDB.get('admin/certTypes')
    ]).then(function(results) {
      var data = results[0] || {};
      var types = results[1] || {};
      cache.certs = Object.keys(data).map(function(k) {
        var c = data[k] || {};
        c.id = k;
        return c;
      });
      cache.certTypes = types;
      cache.loaded.certs = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'classes') {
        renderPreservingEdits();
      }
    }).catch(function(e) {
      console.error('[customers] certs load failed', e);
      cache.certs = [];
      cache.certTypes = {};
      cache.loaded.certs = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'classes') {
        renderPreservingEdits();
      }
    });
  }

  window.customersGrantCertOpen = async function(customerId) {
    var types = (await MastDB.get('admin/certTypes')) || {};
    var activeIds = Object.keys(types).filter(function(t) { return !types[t].archivedAt; });
    if (!activeIds.length) {
      window.MastAdmin && MastAdmin.showToast('No cert types defined. Add one in Book → Settings.', true);
      return;
    }
    var options = activeIds.map(function(tid) {
      return '<option value="' + esc(tid) + '">' + esc(types[tid].name || tid) + '</option>';
    }).join('');
    if (!window.mastSlideOut || !window.mastSlideOut.open) {
      window.MastAdmin && MastAdmin.showToast('Slide-out unavailable', true);
      return;
    }
    window.mastSlideOut.open({
      title: 'Grant Certification',
      subtitle: null,
      bodyHtml:
        '<div class="book-field"><label class="form-label">Certification Type</label>' +
          '<select id="custGrantTypeSel" class="form-input">' + options + '</select></div>',
      footerHtml: '<button class="btn btn-primary" onclick="window.customersGrantCertConfirm(\'' + esc(customerId) + '\')">Grant</button>',
      onClose: function() {}
    });
  };

  window.customersGrantCertConfirm = async function(customerId) {
    var sel = document.getElementById('custGrantTypeSel');
    if (!sel || !sel.value) return;
    var typeId = sel.value;
    if (!window._bookGrantCert) {
      // Lazy-load book module to get the grant helper
      if (window.MastAdmin && MastAdmin.loadModule) {
        try { await MastAdmin.loadModule('book'); } catch (e) {}
      }
    }
    if (!window._bookGrantCert) {
      window.MastAdmin && MastAdmin.showToast('Cert helper unavailable', true);
      return;
    }
    var result = await window._bookGrantCert({
      typeId: typeId,
      customerId: customerId,
      sourceClassId: null,
      sourceEnrollmentId: null
    });
    if (result) {
      window.mastSlideOut && window.mastSlideOut.close && window.mastSlideOut.close();
      // Invalidate certs cache + re-render
      var cache = getCache(customerId);
      cache.loaded.certs = false;
      loadCustomerCerts(customerId);
    }
  };

  window.customersRevokeCert = function(customerId, certId) {
    var cache = getCache(customerId);
    var cert = (cache.certs || []).find(function(x) { return x && x.id === certId; });
    var types = cache.certTypes || {};
    var typeName = cert && types[cert.typeId] && types[cert.typeId].name ? types[cert.typeId].name : (cert ? cert.typeId : 'this certification');

    if (!window.mastSlideOut || !window.mastSlideOut.open) {
      window.MastAdmin && MastAdmin.showToast('Slide-out unavailable', true);
      return;
    }
    var reasonOptions = [
      { v: 'mistake', l: 'Granted in error' },
      { v: 'violation', l: 'Policy violation' },
      { v: 'expired-by-policy', l: 'Expired by policy' },
      { v: 'other', l: 'Other' }
    ];
    var optsHtml = reasonOptions.map(function(o) {
      return '<option value="' + esc(o.v) + '">' + esc(o.l) + '</option>';
    }).join('');

    window.mastSlideOut.open({
      title: 'Revoke certification',
      subtitle: typeName,
      bodyHtml:
        '<div class="book-field"><label class="form-label">Reason</label>' +
          '<select id="custRevokeReasonSel" class="form-input">' + optsHtml + '</select></div>' +
        '<div class="book-field" style="margin-top:10px;"><label class="form-label">Note (optional)</label>' +
          '<textarea id="custRevokeNote" class="form-input" rows="2" placeholder="Visible in the cert history"></textarea></div>' +
        '<p style="color:var(--warm-gray);font-size:0.78rem;margin-top:10px;">The certification stays on the record as <strong>revoked</strong> — it is not deleted, so the history is preserved.</p>',
      footerHtml: '<button class="btn btn-danger" onclick="window.customersRevokeCertConfirm(\'' + esc(customerId) + '\',\'' + esc(certId) + '\')">Revoke</button>',
      onClose: function() {}
    });
  };

  window.customersRevokeCertConfirm = async function(customerId, certId) {
    var reason = (document.getElementById('custRevokeReasonSel') || {}).value || 'other';
    var note = (document.getElementById('custRevokeNote') || {}).value || '';
    try {
      await MastDB.update('admin/customers/' + customerId + '/certifications/' + certId, {
        revokedAt: new Date().toISOString(),
        revokedBy: (window.MastAdmin && MastAdmin.currentUser && MastAdmin.currentUser.uid) || 'admin',
        revokeReason: reason,
        revokeNote: note.trim() || null
      });
      window.MastAdmin && MastAdmin.showToast('Certification revoked');
      window.mastSlideOut && window.mastSlideOut.close && window.mastSlideOut.close();
      var cache = getCache(customerId);
      cache.loaded.certs = false;
      loadCustomerCerts(customerId);
    } catch (err) {
      window.MastAdmin && MastAdmin.showToast('Revoke failed', true);
    }
  };

  function loadCustomerEnrollments(customerId) {
    var cache = getCache(customerId);
    var c = customersData.find(function(x) { return x.id === customerId; }) || {};
    var email = (c.primaryEmail || '').toLowerCase().trim();

    // Enrollments may be keyed by customerId OR by studentEmail/customerEmail —
    // query both and merge to handle older records created before customerId was stored.
    var queries = [
      MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(customerId).once('value')
    ];
    if (email) {
      queries.push(
        MastDB.query('admin/enrollments').orderByChild('customerEmail').equalTo(email).once('value')
      );
    }

    Promise.all(queries)
      .then(function(snaps) {
        var seen = {};
        var enrollments = [];
        snaps.forEach(function(snap) {
          var val = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : (snap || {});
          Object.entries(val).forEach(function(e) {
            if (!seen[e[0]]) {
              seen[e[0]] = true;
              var en = e[1] || {};
              en._id = e[0];
              enrollments.push(en);
            }
          });
        });
        cache.enrollments = enrollments;
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId &&
            (detailTab === 'classes' || detailTab === 'overview')) {
          renderPreservingEdits();
        }
        // Resolve raw classIds → className for display. One MastDB.classes.list
        // call covers every enrollment (no per-row N+1). Re-renders when ready.
        if (window.MastDB && MastDB.classes && typeof MastDB.classes.list === 'function') {
          MastDB.classes.list(500).then(function(map) {
            var names = {};
            Object.keys(map || {}).forEach(function(cid) {
              var cls = map[cid];
              if (cls && (cls.name || cls.title)) names[cid] = cls.name || cls.title;
            });
            cache.classNames = names;
            if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'classes') {
              renderPreservingEdits();
            }
          }).catch(function() { /* names stay empty — falls back to classId */ });
        }
      })
      .catch(function(e) {
        console.error('[customers] enrollments load failed', e);
        cache.enrollments = [];
        cache.loaded.enrollments = true;
        if (currentView === 'detail' && selectedCustomerId === customerId) renderPreservingEdits();
      });
  }

  // ----- Interactions tab -----

  function renderInteractionsTab(c) {
    var linked = c.linkedIds || {};
    var contactIds = linked.contactIds || [];
    if (contactIds.length === 0) {
      var h = '';
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No linked contacts</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Interactions are manually logged touchpoints (calls, emails, meetings, notes) tracked per contact. ';
      h += 'This customer has no linked contact records yet. ';
      h += '<a href="#" onclick="navigateTo(\'contacts\');return false;" style="color:var(--teal);text-decoration:underline;">Open Contacts</a> to log interactions.</p>';
      h += '</div>';
      return h;
    }

    var cache = getCache(c.id);
    if (!cache.loaded.interactions) {
      loadCustomerInteractions(c.id, contactIds);
      return '<div class="loading">Loading interactions…</div>';
    }
    var ix = cache.interactions;
    if (!ix.length) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No interactions recorded</p>' +
        '<p style="font-size:0.85rem;">Interactions are manually logged touchpoints (calls, emails, notes). ' +
        'Log them from the <a href="#" onclick="navigateTo(\'contacts\');return false;" style="color:var(--teal);text-decoration:underline;">Contacts module</a>.</p>' +
        '</div>';
    }

    var h = '';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + ix.length + ' interaction' + (ix.length === 1 ? '' : 's') + ' across ' + contactIds.length + ' contact' + (contactIds.length === 1 ? '' : 's') + '</div>';
    ix.forEach(function(item) {
      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
      h += '<div style="font-size:0.85rem;flex:1;min-width:200px;">';
      h += '<span class="status-badge" style="margin-right:8px;">' + esc(item.type || 'note') + '</span>';
      h += esc(item.notes || item.body || item.summary || '—');
      h += '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;white-space:nowrap;">' + esc(fmtDateTime(item.date || item.createdAt)) + '</div>';
      h += '</div>';
      h += '</div>';
    });
    return h;
  }

  function loadCustomerInteractions(customerId, contactIds) {
    var cache = getCache(customerId);
    var promises = contactIds.map(function(cid) {
      return MastDB.get('admin/contacts/' + cid + '/interactions')
        .then(function(s) { return s.val() || {}; })
        .catch(function() { return {}; });
    });
    Promise.all(promises).then(function(results) {
      var merged = [];
      results.forEach(function(r) {
        Object.entries(r).forEach(function(e) {
          var item = e[1] || {};
          item._id = e[0];
          merged.push(item);
        });
      });
      merged.sort(function(a, b) {
        var ad = a.date || a.createdAt || '';
        var bd = b.date || b.createdAt || '';
        return bd.localeCompare(ad);
      });
      cache.interactions = merged;
      cache.loaded.interactions = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'interactions') renderPreservingEdits();
    });
  }

  // ----- Activity tab (Build 5a) -----
  //
  // Unified dated touchpoint timeline. Pulls a normalized event stream
  // (orders + enrollments + linked-contact interactions + customer notes)
  // and renders it with type-filter chips.
  //
  // Backed by MastDB direct reads to mirror the patterns of the existing
  // tabs and keep the load path consistent. A future enhancement can swap
  // to a single MCP call to get_customer_activity_timeline so AI assistants
  // and the UI compute against the exact same merge logic.

  function loadCustomerActivity(customerId, contactIds, customer) {
    var cache = getCache(customerId);
    // Build 5b.2 — also pull CS events (tickets, reviews, survey responses).
    // Matches each record on customerId AND falls back to email/contactId/uid
    // so the timeline is accurate before the CS-FK backfill completes
    // (mirrors server-side getCustomerActivityTimeline).
    var promises = [
      MastDB.query('orders').orderByChild('customerId').equalTo(customerId).once()
        .then(function(s) { return { ordersRaw: (s && s.val()) || {} }; })
        .catch(function() { return { ordersRaw: {} }; }),
      MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(customerId).once()
        .then(function(s) { return { enrRaw: (s && s.val()) || {} }; })
        .catch(function() { return { enrRaw: {} }; }),
      MastDB.query('cs_tickets').limitToLast(500).once()
        .then(function(s) { return { ticketsRaw: (s && s.val()) || {} }; })
        .catch(function() { return { ticketsRaw: {} }; }),
      MastDB.query('cs_reviews').limitToLast(500).once()
        .then(function(s) { return { reviewsRaw: (s && s.val()) || {} }; })
        .catch(function() { return { reviewsRaw: {} }; }),
      MastDB.query('cs_survey_responses').limitToLast(500).once()
        .then(function(s) { return { responsesRaw: (s && s.val()) || {} }; })
        .catch(function() { return { responsesRaw: {} }; })
    ];
    (contactIds || []).forEach(function(cid) {
      promises.push(
        MastDB.get('admin/contacts/' + cid + '/interactions')
          .then(function(s) { return { contactId: cid, interactions: (s && s.val()) || {} }; })
          .catch(function() { return { contactId: cid, interactions: {} }; })
      );
    });

    // CS-event matcher — uses linkedEmails/contactIds/uids so pre-backfill
    // records still surface in the timeline.
    var linkedEmails = {};
    var primEmail = (customer && customer.primaryEmail || '').toLowerCase();
    if (primEmail) linkedEmails[primEmail] = true;
    ((customer && customer.emails) || []).forEach(function(e) { if (e) linkedEmails[String(e).toLowerCase()] = true; });
    var linkedC = ((customer && customer.linkedIds) || {});
    var linkedContactSet = {};
    ((linkedC.contactIds) || []).forEach(function(id) { linkedContactSet[id] = true; });
    var linkedUidSet = {};
    ((linkedC.uids) || []).forEach(function(u) { linkedUidSet[u] = true; });

    function csMatches(record, uidField) {
      if (!record) return false;
      if (record.customerId === customerId) return true;
      var em = String(record.contactEmail || record.authorEmail || record.email || '').toLowerCase();
      if (em && linkedEmails[em]) return true;
      if (record.contactId && linkedContactSet[record.contactId]) return true;
      if (uidField && record[uidField] && linkedUidSet[record[uidField]]) return true;
      return false;
    }

    Promise.all(promises).then(function(results) {
      var ordersRaw = results[0].ordersRaw || {};
      var enrRaw = results[1].enrRaw || {};
      var ticketsRaw = results[2].ticketsRaw || {};
      var reviewsRaw = results[3].reviewsRaw || {};
      var responsesRaw = results[4].responsesRaw || {};
      var events = [];

      Object.keys(ticketsRaw).forEach(function(tid) {
        var t = ticketsRaw[tid];
        if (!csMatches(t)) return;
        var at = t.updatedAt || t.createdAt;
        if (!at) return;
        events.push({
          type: 'ticket',
          at: at,
          summary: (t.ticketNumber || tid) + (t.subject ? ' · ' + t.subject : '') + (t.status ? ' [' + t.status + ']' : ''),
          sourceRoute: 'cs-tickets',
          sourceId: tid
        });
      });

      Object.keys(reviewsRaw).forEach(function(rid) {
        var r = reviewsRaw[rid];
        if (!csMatches(r, 'authorUid')) return;
        var at = r.createdAt;
        if (!at) return;
        var prodLabel = r.productName || r.productId || '';
        var stars = (typeof r.rating === 'number' ? '★'.repeat(r.rating) : '');
        events.push({
          type: 'review',
          at: at,
          summary: (stars ? stars + ' · ' : '') + prodLabel + (r.title ? ' · ' + r.title : ''),
          sourceRoute: 'cs-reviews',
          sourceId: rid
        });
      });

      Object.keys(responsesRaw).forEach(function(rid) {
        var resp = responsesRaw[rid];
        if (!csMatches(resp)) return;
        var at = resp.completedAt || resp.createdAt;
        if (!at) return;
        var ans = (resp.answers && resp.answers.length) ? resp.answers.length + ' answer(s)' : '';
        events.push({
          type: 'survey-response',
          at: at,
          summary: 'Survey response · ' + (resp.status || 'pending') + (ans ? ' · ' + ans : ''),
          sourceRoute: 'cs-surveys',
          sourceId: rid
        });
      });

      Object.keys(ordersRaw).forEach(function(oid) {
        var o = ordersRaw[oid];
        if (!o || o.status === 'cancelled') return;
        var at = o.createdAt || o.placedAt;
        if (!at) return;
        var cents = (typeof o.totalCents === 'number') ? o.totalCents : (o.total || 0);
        events.push({
          type: 'order',
          at: at,
          summary: 'Order ' + (o.orderNumber || oid) + ' ($' + (cents / 100).toFixed(2) + ') · ' + (o.status || 'placed'),
          sourceRoute: 'orders',
          sourceId: oid
        });
      });

      Object.keys(enrRaw).forEach(function(eid) {
        var e = enrRaw[eid];
        if (!e || e.status === 'cancelled' || e.enrollmentStatus === 'cancelled') return;
        var at = e.createdAt;
        if (!at) return;
        var name = e.className || e.classTitle || '(class)';
        events.push({
          type: 'enrollment',
          at: at,
          summary: 'Enrolled · ' + name,
          sourceRoute: 'classes',
          sourceId: eid
        });
      });

      // Contact-interaction promises start at index 5 now that we have:
      // 0=orders, 1=enrollments, 2=tickets, 3=reviews, 4=responses, 5+=contactIds.
      for (var i = 5; i < results.length; i++) {
        var pair = results[i];
        var ix = pair.interactions || {};
        Object.keys(ix).forEach(function(ixId) {
          var raw = ix[ixId];
          if (!raw) return;
          var at = raw.date || raw.createdAt;
          if (!at) return;
          var body = raw.notes || raw.body || raw.summary || '';
          var short = body.length > 140 ? body.slice(0, 137) + '…' : body;
          events.push({
            type: 'contact-interaction',
            at: at,
            summary: (raw.type || 'note') + (short ? ' · ' + short : ''),
            sourceRoute: 'contacts',
            sourceId: pair.contactId
          });
        });
      }

      events.sort(function(a, b) { return (b.at || '').localeCompare(a.at || ''); });
      cache.activityEvents = events;
      cache.loaded.activity = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'activity') {
        renderPreservingEdits();
      }
    });
  }

  function renderActivityTab(c) {
    var linked = c.linkedIds || {};
    var contactIds = linked.contactIds || [];

    var cache = getCache(c.id);
    if (!cache.loaded.activity) {
      loadCustomerActivity(c.id, contactIds, c);
      return '<div class="loading">Loading activity…</div>';
    }

    // Notes from the customer record show as a synthetic "note" event.
    // Atomic-widget edit lives on Overview (existing pattern); this is
    // a read-only summary entry in the timeline.
    var events = (cache.activityEvents || []).slice();
    if (c.notes && c.notes.trim().length > 0) {
      var short = c.notes.length > 140 ? c.notes.slice(0, 137) + '…' : c.notes;
      events.push({
        type: 'note',
        at: c.updatedAt || c.createdAt || new Date().toISOString(),
        summary: short
      });
      events.sort(function(a, b) { return (b.at || '').localeCompare(a.at || ''); });
    }

    // Build per-type counts before filtering so chip badges always show
    // the full population.
    var counts = { 'all': events.length, 'order': 0, 'enrollment': 0, 'ticket': 0, 'review': 0, 'survey-response': 0, 'contact-interaction': 0, 'note': 0 };
    events.forEach(function(e) { if (counts[e.type] != null) counts[e.type]++; });

    var filtered = activityFilter === 'all' ? events : events.filter(function(e) { return e.type === activityFilter; });

    var h = '';

    // Filter chips
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
    ['all', 'order', 'enrollment', 'ticket', 'review', 'survey-response', 'contact-interaction', 'note'].forEach(function(t) {
      var label = ACTIVITY_TYPE_LABELS[t] || t;
      var active = (activityFilter === t);
      var n = counts[t] || 0;
      h += '<button class="view-tab' + (active ? ' active' : '') + '" onclick="customersSetActivityFilter(\'' + esc(t) + '\')" style="font-size:0.78rem;padding:4px 10px;">' +
        esc(label) + ' <span style="opacity:0.6;">(' + n + ')</span></button>';
    });
    h += '</div>';

    if (events.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No activity recorded</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Orders, enrollments, contact interactions, and notes will appear here as the customer relationship develops.</p>';
      h += '</div>';
      return h;
    }
    if (filtered.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);font-size:0.85rem;">No activity of this type yet.</div>';
      return h;
    }

    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' +
      filtered.length + ' event' + (filtered.length === 1 ? '' : 's') + (activityFilter !== 'all' ? ' (' + esc(ACTIVITY_TYPE_LABELS[activityFilter] || activityFilter) + ')' : '') +
      '</div>';

    filtered.forEach(function(item) {
      var typeColor = activityTypeColor(item.type);
      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:8px;' +
        (item.sourceRoute && item.sourceId ? 'cursor:pointer;' : '') + '"' +
        (item.sourceRoute && item.sourceId ? ' onclick="customersOpenActivityDrillIn(\'' + esc(item.sourceRoute) + '\',\'' + esc(item.sourceId) + '\')"' : '') + '>';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
      h += '<div style="font-size:0.85rem;flex:1;min-width:200px;">';
      h += '<span class="status-badge" style="margin-right:8px;background:' + typeColor.bg + ';color:' + typeColor.fg + ';">' + esc(ACTIVITY_TYPE_LABELS[item.type] || item.type) + '</span>';
      h += esc(item.summary || '—');
      h += '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;white-space:nowrap;">' + esc(fmtDateTime(item.at)) + '</div>';
      h += '</div>';
      h += '</div>';
    });
    return h;
  }

  function activityTypeColor(type) {
    if (type === 'order')               return { bg: 'rgba(42,124,111,0.28)', fg: '#6fc' };
    if (type === 'enrollment')          return { bg: 'rgba(196,133,60,0.30)', fg: 'var(--amber-light)' };
    if (type === 'contact-interaction') return { bg: 'rgba(99,102,241,0.30)', fg: '#a5a8f5' };
    if (type === 'note')                return { bg: 'rgba(155,149,142,0.35)', fg: '#cfcac3' };
    // Build 5b.2 — CS event palette
    if (type === 'ticket')              return { bg: 'rgba(220,53,69,0.25)',  fg: '#f49aa3' };
    if (type === 'review')              return { bg: 'rgba(245,158,11,0.30)', fg: '#fbcc70' };
    if (type === 'survey-response')     return { bg: 'rgba(168,85,247,0.25)', fg: '#c8a8f5' };
    return { bg: 'rgba(155,149,142,0.35)', fg: '#cfcac3' };
  }

  function customersSetActivityFilter(t) {
    activityFilter = t;
    renderPreservingEdits();
  }

  function customersOpenActivityDrillIn(route, sourceId) {
    if (typeof MastNavStack !== 'undefined' && MastNavStack.push) {
      var c = customersData.find(function(x) { return x && x.id === selectedCustomerId; });
      var label = c ? (c.displayName || c.primaryEmail || c.id) : 'customer';
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: selectedCustomerId, detailTab: 'activity', scrollTop: 0 },
        label: label
      });
    }
    // Some "routes" used here are logical surface IDs that don't map 1:1 to
    // a registered hash route. For 'classes' specifically, the book module
    // ships a purpose-built 'book-detail' route that accepts an id param —
    // navigating directly to it eliminates the navigate-then-setTimeout
    // race we hit when the body was still rendering the previous view.
    if (route === 'classes' && sourceId) {
      if (typeof navigateTo === 'function') navigateTo('book-detail', { id: sourceId });
      return;
    }

    // All other drills: navigate to the list route, then call the per-surface
    // open-detail entrypoint once the module has been lazy-loaded.
    if (typeof navigateTo === 'function') navigateTo(route);
    if (sourceId) {
      var open = function() {
        if (route === 'cs-tickets' && typeof window.csOpenThread === 'function') {
          window.csOpenThread(sourceId);
        } else if (route === 'cs-reviews' && typeof window.csOpenReview === 'function') {
          window.csOpenReview(sourceId);
        } else if (route === 'cs-surveys' && typeof window.csOpenSurveyResponse === 'function') {
          window.csOpenSurveyResponse(sourceId);
        } else if (route === 'orders' && typeof window.openOrderDetail === 'function') {
          window.openOrderDetail(sourceId);
        }
      };
      // The module may need to load before its open-fn is wired; wait once.
      if (typeof MastAdmin !== 'undefined' && typeof MastAdmin.loadModule === 'function') {
        var mod = (route.indexOf('cs-') === 0) ? 'customer-service'
                : (route === 'orders' ? 'orders' : null);
        if (mod) {
          MastAdmin.loadModule(mod).then(function() { setTimeout(open, 100); });
        } else {
          setTimeout(open, 200);
        }
      } else {
        setTimeout(open, 200);
      }
    }
  }

  // ----- Wallet tab -----

  function renderWalletTab(c) {
    var linked = c.linkedIds || {};
    var uids = linked.uids || [];
    if (uids.length === 0) {
      return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:8px;">No linked account</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Wallet, passes, membership and loyalty live on a customer-facing account. This customer hasn\'t signed in yet.</p>' +
        '</div>';
    }

    var cache = getCache(c.id);
    if (!cache.loaded.wallets) {
      loadCustomerWallets(c.id, uids);
      return '<div class="loading">Loading wallet…</div>';
    }
    // D4: parallel-load this customer's wallet-adjustment audit history.
    // Independent of the wallet load — first paint can render the summary
    // cards and replace the "Loading history…" stub when audit lands.
    if (!cache.loaded.walletAudit) loadCustomerWalletAudit(c.id);

    var h = '';
    cache.wallets.forEach(function(w, idx) {
      var label = cache.wallets.length > 1 ? 'Account ' + (idx + 1) : 'Account';
      h += detailCardOpen(label);
      var creditCount = w.credits ? Object.keys(w.credits).length : 0;
      var creditBalance = 0;
      if (w.credits) {
        Object.values(w.credits).forEach(function(cr) {
          if (cr && typeof cr.amountCents === 'number' && cr.status !== 'redeemed' && cr.status !== 'revoked') creditBalance += cr.amountCents;
        });
      }
      var passCount = w.passes ? Object.keys(w.passes).filter(function(k){var p=w.passes[k];return p && p.status !== 'revoked';}).length : 0;
      var membershipTier = w.membership && (w.membership.tier || w.membership.tierName) || '—';
      var loyaltyTotalPts = w.loyalty && (typeof w.loyalty.totalPoints === 'number' ? w.loyalty.totalPoints :
                              (typeof w.loyalty.points === 'number' ? w.loyalty.points :
                              (typeof w.loyalty.balance === 'number' ? w.loyalty.balance : 0)));
      var uid = w.uid;
      var cidSafe = _jsAttrSafe(c.id);
      var uidSafe = _jsAttrSafe(uid);

      h += '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
      h += identityRow('Credits', esc(fmtMoney(creditBalance)) + ' <span style="color:var(--warm-gray);font-size:0.78rem;">(' + creditCount + ' record' + (creditCount === 1 ? '' : 's') + ')</span>');
      h += identityRow('Passes', String(passCount));
      h += identityRow('Membership', esc(String(membershipTier)));
      h += identityRow('Loyalty', String(loyaltyTotalPts) + ' pts');
      h += '</div>';

      // D4: inline action buttons. Each opens a modal that writes via the
      // adjustCustomerWallet CF, which audits to admin/walletAdjustments.
      h += '<div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:6px;">';
      if (hasPermission('wallet', 'grantCredit')) {
        h += '<button class="btn btn-secondary btn-small" onclick="customersOpenWalletAdjust(\'credit\',\'' + cidSafe + '\',\'' + uidSafe + '\')">+ Adjust credits</button>';
      }
      h += '<button class="btn btn-secondary btn-small" onclick="customersOpenWalletAdjust(\'pass\',\'' + cidSafe + '\',\'' + uidSafe + '\')">+ Grant pass</button>';
      h += '<button class="btn btn-secondary btn-small" onclick="customersOpenWalletAdjust(\'membership\',\'' + cidSafe + '\',\'' + uidSafe + '\')">Change tier</button>';
      h += '<button class="btn btn-secondary btn-small" onclick="customersOpenWalletAdjust(\'loyalty\',\'' + cidSafe + '\',\'' + uidSafe + '\')">Adjust loyalty</button>';
      h += '</div>';
      h += detailCardClose();
    });

    // D4 inline audit timeline — this customer's wallet adjustments,
    // ordered newest first. Global view (Wallet → History) shows the
    // full tenant log; this is the per-customer slice.
    h += '<div style="margin-top:20px;">';
    h += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">Adjustment history</div>';
    if (!cache.loaded.walletAudit) {
      h += '<div style="color:var(--warm-gray-light);font-size:0.78rem;">Loading history…</div>';
    } else if (!cache.walletAudit || cache.walletAudit.length === 0) {
      h += '<div style="color:var(--warm-gray-light);font-size:0.78rem;">No adjustments yet.</div>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:6px;font-size:0.78rem;">';
      cache.walletAudit.forEach(function(a) {
        h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;padding:8px 12px;">';
        h += '<div style="display:flex;justify-content:space-between;gap:8px;">';
        h += '<span><strong>' + esc(a.kind) + '</strong> · ' + esc(a.action);
        if (typeof a.amountCents === 'number') h += ' · ' + esc(fmtMoney(a.amountCents));
        if (typeof a.delta === 'number') h += ' · ' + (a.delta > 0 ? '+' : '') + esc(String(a.delta)) + ' pts';
        if (a.tier) h += ' · tier=' + esc(a.tier);
        if (a.passDefId) h += ' · pass=' + esc(a.passDefId);
        h += '</span>';
        h += '<span style="color:var(--warm-gray-light);">' + esc(relativeTime(a.createdAt)) + '</span>';
        h += '</div>';
        h += '<div style="color:var(--warm-gray);margin-top:2px;">' + esc(a.reason || '') + '</div>';
        if (a.operatorName) h += '<div style="color:var(--warm-gray-light);font-size:0.72rem;margin-top:2px;">by ' + esc(a.operatorName) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    return h;
  }

  // D4 — escape a string for safe interpolation inside an inline onclick.
  // Mirrors the existing pattern from accounting.js / finance.js: the caller
  // wraps the result in their own quotes (onclick="fn('"+_jsAttrSafe(v)+"')").
  function _jsAttrSafe(s) {
    return String(s || '').replace(/[\\'"]/g, '\\$&');
  }

  // ----- Contacts tab (linked contact records — addresses/phones) -----
  //
  // Paradigm A drill-through: list-only on the customer. All edits happen
  // in the contacts module (via customersOpenContact → openContactFromCustomer
  // → MastNavStack push → contacts.viewContact). Creation also routes through
  // the contacts module via customersAddContact (see addContactToCustomer).

  function renderContactsTab(c) {
    var cache = getCache(c.id);
    if (!cache.loaded.contacts) {
      loadCustomerContacts(c.id);
      return '<div class="loading">Loading contacts…</div>';
    }
    // Orders cache is used to compute # Orders + Last Order per contact.
    // Trigger the load in the background if not yet present — the columns
    // will show "—" until it resolves, then a re-render fills them in.
    if (!cache.loaded.orders) loadCustomerOrders(c.id);

    var contacts = cache.contacts || [];
    var h = '';

    if (!contacts.length) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No contacts linked to this customer yet.</div>';
    } else {
      // Pre-compute per-contact order aggregates from cache.orders (if loaded).
      var ordersByContact = {};
      if (cache.loaded.orders && Array.isArray(cache.orders)) {
        cache.orders.forEach(function(o) {
          if (!o.contactId) return;
          var bucket = ordersByContact[o.contactId] || (ordersByContact[o.contactId] = { count: 0, last: null });
          bucket.count += 1;
          if (!bucket.last || (o.createdAt || '') > bucket.last) bucket.last = o.createdAt || null;
        });
      }

      var rows = contacts.map(function(ct) {
        var name = ct.name || ct.displayName || '(unnamed contact)';
        var email = ct.email || '—';
        var phone = ct.phone || '—';
        var address = ct.address || '—';
        var agg = ordersByContact[ct.id];
        var ordCountCell, lastOrderCell;
        if (cache.loaded.orders) {
          ordCountCell = agg ? String(agg.count) : '0';
          lastOrderCell = (agg && agg.last) ? fmtDate(agg.last) : '—';
        } else {
          ordCountCell = '—';
          lastOrderCell = '—';
        }
        return '<tr data-contact-id="' + esc(ct.id) + '" style="cursor:pointer;" onclick="customersOpenContact(this.dataset.contactId)">' +
          '<td style="font-weight:500;">' + esc(name) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(email) + '</td>' +
          '<td style="color:var(--warm-gray);">' + esc(phone) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(address) + '</td>' +
          '<td style="text-align:right;color:var(--warm-gray);">' + esc(ordCountCell) + '</td>' +
          '<td style="color:var(--warm-gray);font-size:0.78rem;">' + esc(lastOrderCell) + '</td>' +
        '</tr>';
      }).join('');

      h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + contacts.length + ' contact' + (contacts.length === 1 ? '' : 's') + '</div>';
      h += '<div class="data-table"><table>';
      h += '<thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th style="text-align:right;"># Orders</th><th>Last Order</th></tr></thead>';
      h += '<tbody>' + rows + '</tbody>';
      h += '</table></div>';
    }

    h += '<div style="margin-top:16px;">';
    h += '<button class="btn btn-secondary btn-small" data-customer-id="' + esc(c.id) + '" onclick="customersAddContact(this.dataset.customerId)">+ Add contact</button>';
    h += '</div>';
    return h;
  }

  function loadCustomerContacts(customerId) {
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) { console.warn('[customers] loadContacts: customer not in memory', customerId); return; }
    var contactIds = (c.linkedIds && c.linkedIds.contactIds) || [];
    var cache = getCache(customerId);
    // Guard: if a load is already in flight for this customer, don't start another.
    if (cache._contactsLoading) return;
    cache._contactsLoading = true;
    console.log('[customers] loadContacts start', customerId, contactIds);

    if (contactIds.length === 0) {
      cache.contacts = [];
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
      return;
    }
    var promises = contactIds.map(function(cid) {
      return MastDB.get('admin/contacts/' + cid)
        .then(function(s) { var v = s.val(); if (v) v.id = cid; return v; })
        .catch(function(e) { console.warn('[customers] contact read failed', cid, e); return null; });
    });
    Promise.all(promises).then(function(results) {
      console.log('[customers] loadContacts done', customerId, results);
      cache.contacts = results.filter(function(x) { return x; });
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
    }).catch(function(e) {
      console.error('[customers] loadContacts FAILED', customerId, e);
      cache.contacts = [];
      cache.loaded.contacts = true;
      cache._contactsLoading = false;
      setTimeout(function() {
        if (currentView === 'detail' && selectedCustomerId === customerId && (detailTab === 'contacts' || detailTab === 'overview')) renderPreservingEdits();
      }, 0);
    });
  }

  function openContactFromCustomer(contactId) {
    var c = selectedCustomerId
      ? customersData.find(function(x) { return x && x.id === selectedCustomerId; })
      : null;
    var label = c ? (c.displayName || c.primaryEmail || 'customer') : 'Customers';
    if (window.MastNavStack && selectedCustomerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: selectedCustomerId, detailTab: detailTab, scrollTop: window.scrollY || 0 },
        label: label
      });
    }
    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('contacts');
      } finally {
        window._mastNavInternal = false;
      }
      setTimeout(function() {
        if (typeof window.viewContact === 'function') window.viewContact(contactId);
      }, 0);
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  // Back button from a customer detail. If MastNavStack has an entry,
  // pop and return to the original context. Otherwise fall back to list.
  function backFromDetail() {
    if (window.MastNavStack && MastNavStack.size() > 0) {
      MastNavStack.popAndReturn();
      return;
    }
    var doBack = function() {
      if (customerEditMode) {
        customerEditMode = false;
        if (window.MastDirty) MastDirty.unregister('customerEdit');
      }
      switchView('list');
    };
    if (window.MastDirty) MastDirty.checkAndExit(doBack); else doBack();
  }

  // Route "+ Add contact" through the contacts module, mirroring the
  // openOrderFromCustomer / openContactFromCustomer drill-through pattern.
  // Pushes a MastNavStack breadcrumb, stashes a pending-link hint so the
  // contacts module can atomically link the new contact to this customer,
  // then navigates to contacts and opens its Add Contact modal. On save,
  // contacts.saveNewContact reads the hint, writes the link + byContactId
  // index, and popAndReturns here — restoring the Contacts tab with the
  // new record visible.
  function addContactToCustomer(customerId) {
    if (!customerId) customerId = selectedCustomerId;
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var label = c.displayName || c.primaryEmail || 'customer';

    if (window.MastNavStack && customerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: customerId, detailTab: 'contacts', scrollTop: window.scrollY || 0 },
        label: label
      });
    }

    window._pendingContactCustomerLink = {
      customerId: customerId,
      prefillName: c.displayName || '',
      prefillEmail: c.primaryEmail || ''
    };

    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('contacts');
      } finally {
        window._mastNavInternal = false;
      }
      var openIt = function() {
        if (typeof window.openAddContactModal === 'function') {
          window.openAddContactModal();
        } else {
          console.error('[customers] openAddContactModal not available after contacts load');
          toast('Failed to open add-contact form', true);
        }
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('contacts').then(openIt).catch(function(err) {
          console.error('[customers] contacts module load failed', err);
          toast('Failed to load contacts module: ' + (err && err.message || err), true);
        });
      } else {
        setTimeout(openIt, 50);
      }
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  function loadCustomerWallets(customerId, uids) {
    var cache = getCache(customerId);
    var promises = uids.map(function(uid) {
      return MastDB.get('public/accounts/' + uid + '/wallet')
        .then(function(s) { var v = s.val() || {}; v.uid = uid; return v; })
        .catch(function() { return { uid: uid }; });
    });
    Promise.all(promises).then(function(wallets) {
      cache.wallets = wallets;
      cache.loaded.wallets = true;
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'wallet') renderPreservingEdits();
    });
  }

  // D4 — load this customer's wallet-adjustment audit history (admin/walletAdjustments
  // where customerId == c.id). Sorted newest-first. Read-only — writes happen
  // exclusively through the adjustCustomerWallet CF.
  function loadCustomerWalletAudit(customerId) {
    var cache = getCache(customerId);
    cache.walletAudit = [];
    MastDB.query('admin/walletAdjustments')
      .orderByChild('createdAt').limitToLast(200).once()
      .then(function(snap) {
        var data = (snap && snap.val && snap.val()) || (snap || {});
        var rows = [];
        Object.keys(data || {}).forEach(function(k) {
          var r = data[k];
          if (r && r.customerId === customerId) rows.push(r);
        });
        rows.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        cache.walletAudit = rows;
        cache.loaded.walletAudit = true;
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'wallet') renderPreservingEdits();
      })
      .catch(function(err) {
        console.warn('[customers] wallet audit load failed:', err && err.message);
        cache.walletAudit = [];
        cache.loaded.walletAudit = true;
        if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'wallet') renderPreservingEdits();
      });
  }

  // D4 — open the wallet-adjustment modal for a (kind, customerId, walletUid).
  // Routes to the right form per kind. Each form collects payload + reason
  // and submits to the adjustCustomerWallet CF.
  function openWalletAdjustModal(kind, customerId, walletUid) {
    var titleByKind = {
      credit: 'Adjust store credit', pass: 'Grant a pass',
      membership: 'Change membership tier', loyalty: 'Adjust loyalty points'
    };
    var bodyHtml;
    if (kind === 'credit') {
      bodyHtml =
        '<div class="form-group"><label>Action</label>' +
          '<select id="walletAdjAction" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">' +
            '<option value="grant">Grant new credit</option>' +
            '<option value="adjust">Adjust existing credit</option>' +
            '<option value="revoke">Revoke existing credit</option>' +
          '</select></div>' +
        '<div class="form-group" id="walletAdjCreditIdRow" style="display:none;"><label>Credit ID</label>' +
          '<input type="text" id="walletAdjCreditId" placeholder="Credit record ID" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjAmountRow"><label>Amount ($)</label>' +
          '<input type="number" id="walletAdjAmount" min="0" step="0.01" placeholder="e.g. 25.00" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjExpiryRow"><label>Expires (optional)</label>' +
          '<input type="date" id="walletAdjExpiry" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    } else if (kind === 'pass') {
      bodyHtml =
        '<div class="form-group"><label>Action</label>' +
          '<select id="walletAdjAction" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">' +
            '<option value="grant">Grant a pass</option>' +
            '<option value="revoke">Revoke an existing pass</option>' +
          '</select></div>' +
        '<div class="form-group" id="walletAdjPassDefRow"><label>Pass definition ID</label>' +
          '<input type="text" id="walletAdjPassDefId" placeholder="passDefId (Book → Passes)" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjSessionsRow"><label>Sessions total (optional)</label>' +
          '<input type="number" id="walletAdjSessions" min="1" step="1" placeholder="e.g. 10" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjExpiryRow"><label>Expires (optional)</label>' +
          '<input type="date" id="walletAdjExpiry" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjPassIdRow" style="display:none;"><label>Pass ID (to revoke)</label>' +
          '<input type="text" id="walletAdjPassId" placeholder="Pass record ID" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    } else if (kind === 'membership') {
      bodyHtml =
        '<div class="form-group"><label>New tier</label>' +
          '<input type="text" id="walletAdjTier" placeholder="e.g. gold, silver, founder" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">No proration — billing settles on the next cycle.</p>';
    } else if (kind === 'loyalty') {
      bodyHtml =
        '<div class="form-group"><label>Point delta (use negative to deduct)</label>' +
          '<input type="number" id="walletAdjDelta" step="1" placeholder="e.g. 100 or -50" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    }
    var html =
      '<div class="modal-header"><h3>' + esc(titleByKind[kind] || 'Wallet adjustment') + '</h3></div>' +
      '<div class="modal-body">' +
        '<input type="hidden" id="walletAdjKind" value="' + esc(kind) + '">' +
        '<input type="hidden" id="walletAdjCustomerId" value="' + esc(customerId) + '">' +
        '<input type="hidden" id="walletAdjUid" value="' + esc(walletUid) + '">' +
        bodyHtml +
        '<div class="form-group"><label>Reason <span style="color:var(--danger);">*</span></label>' +
          '<textarea id="walletAdjReason" rows="2" placeholder="Required. Shown in the audit trail." style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></textarea></div>' +
        '<div id="walletAdjStatus" style="font-size:0.85rem;margin-top:8px;"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="walletAdjSaveBtn" onclick="customersSubmitWalletAdjust()">Save</button>' +
      '</div>';
    if (typeof openModal === 'function') openModal(html);

    // Wire up action-switch for credit + pass (changes visible field rows)
    var actionEl = document.getElementById('walletAdjAction');
    if (actionEl) {
      var updateFields = function() {
        var act = actionEl.value;
        if (kind === 'credit') {
          var cidRow = document.getElementById('walletAdjCreditIdRow');
          var expRow = document.getElementById('walletAdjExpiryRow');
          if (cidRow) cidRow.style.display = (act === 'grant') ? 'none' : '';
          if (expRow) expRow.style.display = (act === 'grant') ? '' : 'none';
        } else if (kind === 'pass') {
          var defRow = document.getElementById('walletAdjPassDefRow');
          var sesRow = document.getElementById('walletAdjSessionsRow');
          var pexRow = document.getElementById('walletAdjExpiryRow');
          var pidRow = document.getElementById('walletAdjPassIdRow');
          if (defRow) defRow.style.display = (act === 'grant') ? '' : 'none';
          if (sesRow) sesRow.style.display = (act === 'grant') ? '' : 'none';
          if (pexRow) pexRow.style.display = (act === 'grant') ? '' : 'none';
          if (pidRow) pidRow.style.display = (act === 'revoke') ? '' : 'none';
        }
      };
      actionEl.addEventListener('change', updateFields);
      updateFields();
    }
  }

  // D4 — submit handler reads modal fields, validates, calls CF.
  async function submitWalletAdjust() {
    var kind = (document.getElementById('walletAdjKind') || {}).value;
    var customerId = (document.getElementById('walletAdjCustomerId') || {}).value;
    var walletUid = (document.getElementById('walletAdjUid') || {}).value;
    var action = (document.getElementById('walletAdjAction') || {}).value || 'adjust';
    var reason = ((document.getElementById('walletAdjReason') || {}).value || '').trim();
    var statusEl = document.getElementById('walletAdjStatus');
    var btn = document.getElementById('walletAdjSaveBtn');
    var setStatus = function(msg, color) {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--warm-gray)'; }
    };
    if (!reason || reason.length < 3) { setStatus('Reason is required.', 'var(--danger)'); return; }

    var payload = {};
    if (kind === 'credit') {
      if (!hasPermission('wallet', 'grantCredit')) { setStatus('You do not have permission to grant store credit.', 'var(--danger)'); return; }
      if (action === 'grant') {
        var amt = parseFloat((document.getElementById('walletAdjAmount') || {}).value || '0');
        if (!(amt > 0)) { setStatus('Enter an amount.', 'var(--danger)'); return; }
        payload.amountCents = Math.round(amt * 100);
        var exp = (document.getElementById('walletAdjExpiry') || {}).value;
        if (exp) payload.expiresAt = exp;
      } else {
        payload.creditId = ((document.getElementById('walletAdjCreditId') || {}).value || '').trim();
        if (!payload.creditId) { setStatus('Credit ID required.', 'var(--danger)'); return; }
        if (action === 'adjust') {
          var amt2 = parseFloat((document.getElementById('walletAdjAmount') || {}).value || '');
          if (!Number.isFinite(amt2) || amt2 < 0) { setStatus('Enter a valid amount.', 'var(--danger)'); return; }
          payload.amountCents = Math.round(amt2 * 100);
        }
      }
    } else if (kind === 'pass') {
      if (action === 'grant') {
        payload.passDefId = ((document.getElementById('walletAdjPassDefId') || {}).value || '').trim();
        if (!payload.passDefId) { setStatus('Pass definition ID required.', 'var(--danger)'); return; }
        var sess = parseInt((document.getElementById('walletAdjSessions') || {}).value || '0', 10);
        if (sess > 0) payload.sessionsTotal = sess;
        var pexp = (document.getElementById('walletAdjExpiry') || {}).value;
        if (pexp) payload.expiresAt = pexp;
      } else {
        payload.passId = ((document.getElementById('walletAdjPassId') || {}).value || '').trim();
        if (!payload.passId) { setStatus('Pass ID required.', 'var(--danger)'); return; }
      }
    } else if (kind === 'membership') {
      payload.tier = ((document.getElementById('walletAdjTier') || {}).value || '').trim();
      if (!payload.tier) { setStatus('Tier required.', 'var(--danger)'); return; }
      action = 'adjust';
    } else if (kind === 'loyalty') {
      var delta = parseInt((document.getElementById('walletAdjDelta') || {}).value || '0', 10);
      if (!Number.isFinite(delta) || delta === 0) { setStatus('Enter a non-zero delta.', 'var(--danger)'); return; }
      payload.delta = delta;
      action = 'adjust';
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    setStatus('');
    try {
      var fn = firebase.functions().httpsCallable('adjustCustomerWallet');
      var result = await fn({
        tenantId: MastDB.tenantId(),
        customerId: customerId,
        walletUid: walletUid,
        kind: kind,
        action: action,
        payload: payload,
        reason: reason
      });
      if (!result || !result.data || result.data.ok !== true) {
        throw new Error((result && result.data && result.data.message) || 'CF returned non-ok');
      }
      // Invalidate caches and re-render so the new state + audit row show.
      var cache = getCache(customerId);
      cache.loaded.wallets = false;
      cache.loaded.walletAudit = false;
      if (typeof closeModal === 'function') closeModal();
      if (typeof showToast === 'function') showToast('Wallet adjustment recorded.');
      renderPreservingEdits();
    } catch (e) {
      console.error('[customers] wallet adjust failed', e);
      setStatus('Save failed: ' + (e && e.message), 'var(--danger)');
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  // ============================================================
  // Surface 3: Duplicates Queue (read-only v1)
  // ============================================================

  function renderDuplicates() {
    var h = '';
    h += '<div style="margin-bottom:16px;">';
    h += '<h2 style="margin:0;">Duplicate customer flags</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += 'Conflicts where a uid and email resolved to different existing customers. ';
    h += 'Flag-only in v1 — manual merge UI lands in Phase 5.';
    h += '</div>';
    h += '</div>';

    if (duplicatesData.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">✓</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No pending duplicates</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">When the resolver detects a conflict, it shows up here.</p>';
      h += '</div>';
      return h;
    }

    duplicatesData.forEach(function(d) {
      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 18px;margin-bottom:10px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
      // Look up display names from in-memory customer list (fallback to "Customer A/B").
      var custA = customersData.find(function(x) { return x && x.id === d.customerIdA; });
      var custB = customersData.find(function(x) { return x && x.id === d.customerIdB; });
      var labelA = (custA && (custA.displayName || custA.primaryEmail)) || 'Customer A';
      var labelB = (custB && (custB.displayName || custB.primaryEmail)) || 'Customer B';

      h += '<div style="font-size:0.85rem;flex:1;min-width:240px;">';
      h += '<div style="font-weight:600;margin-bottom:4px;">' + esc(d.reason || 'duplicate detected') + '</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">';
      h += 'A: <span data-customer-id="' + esc(d.customerIdA) + '" style="cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(labelA) + '</span><br>';
      h += 'B: <span data-customer-id="' + esc(d.customerIdB) + '" style="cursor:pointer;text-decoration:underline;" onclick="customersOpenDetail(this.dataset.customerId)">' + esc(labelB) + '</span>';
      h += '</div>';
      h += '</div>';
      h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">' + esc(relativeTime(d.detectedAt)) + '</div>';
      h += '<div style="display:flex;gap:6px;">';
      h += '<button class="btn btn-secondary btn-small" data-flag-id="' + esc(d._flagId) + '" data-winner="' + esc(d.customerIdA) + '" data-loser="' + esc(d.customerIdB) + '" ' +
        'onclick="customersMerge(this.dataset.flagId,this.dataset.winner,this.dataset.loser)">Keep A</button>';
      h += '<button class="btn btn-secondary btn-small" data-flag-id="' + esc(d._flagId) + '" data-winner="' + esc(d.customerIdB) + '" data-loser="' + esc(d.customerIdA) + '" ' +
        'onclick="customersMerge(this.dataset.flagId,this.dataset.winner,this.dataset.loser)">Keep B</button>';
      h += '</div>';
      h += '</div>';
      h += '</div>';
      h += '</div>';
    });

    return h;
  }

  // ============================================================
  // Navigation
  // ============================================================

  function switchView(view) {
    currentView = view;
    if (view !== 'detail') selectedCustomerId = null;
    render();
    if (view === 'list') {
      // W3 follow-up — clicking the in-detail "Back to Customers" button
      // routes through here, and the previous rAF-only path could race / drop
      // leaving #customersTableWrap empty until something else triggered a
      // re-render. Same root cause + same fix as the setup else-branch and
      // clearCustomersFilter: synchronous renderTable now, rAF as the
      // defensive second pass.
      try { renderTable(); } catch (_e) {}
      requestAnimationFrame(renderTable);
    }
  }

  function openDetail(customerId) {
    selectedCustomerId = customerId;
    currentView = 'detail';
    detailTab = 'overview';
    render();
  }

  function switchDetailTab(tab) {
    detailTab = tab;
    render();
  }

  function openOrderFromCustomer(orderId) {
    // Push a MastNavStack entry so Back from the order detail returns to
    // THIS customer's Orders tab (Paradigm A popAndReturn). Must happen
    // BEFORE navigateTo('orders') so navigateTo doesn't clear the stack.
    var c = selectedCustomerId
      ? customersData.find(function(x) { return x && x.id === selectedCustomerId; })
      : null;
    var label = c ? (c.displayName || c.primaryEmail || 'customer') : 'Customers';
    if (window.MastNavStack && selectedCustomerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: selectedCustomerId, detailTab: 'orders', scrollTop: window.scrollY || 0 },
        label: label
      });
    }
    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('orders');
      } finally {
        window._mastNavInternal = false;
      }
      var callView = function() {
        if (typeof window.viewOrder === 'function') {
          window.viewOrder(orderId);
        } else {
          showToast && showToast('Could not open order — orders module failed to load.', true);
        }
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('orders').then(callView).catch(function(err) {
          console.error('[customers] failed to load orders module', err);
          showToast && showToast('Failed to load orders module: ' + (err && err.message || err), true);
        });
      } else {
        setTimeout(callView, 50);
      }
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  // ============================================================
  // Phase 6.1 — Stats backfill (admin button → callable)
  // ============================================================

  async function backfillStats() {
    if (customersBackfillRunning) return;
    var ok = await window.mastConfirm(
      'Recompute cached stats for every customer in this tenant? Runs once and may take a few seconds.',
      { title: 'Recompute customer stats', confirmLabel: 'Recompute' }
    );
    if (!ok) return;
    customersBackfillRunning = true;
    try {
      var fn = firebase.functions().httpsCallable('recomputeAllCustomerStats');
      var result = await fn({ tenantId: MastDB.tenantId() });
      var d = (result && result.data) || {};
      window.mastAlert('Stats recomputed. ' + (d.processed || 0) + ' customers processed (' + (d.skipped || 0) + ' skipped).');
      // Reload to pick up the new stats fields.
      customersLoaded = false;
      await loadCustomers();
    } catch (e) {
      console.error('[customers] backfill failed', e);
      window.mastAlert('Backfill failed: ' + (e && e.message));
    } finally {
      customersBackfillRunning = false;
    }
  }

  // ============================================================
  // Phase 6.2 — CSV export
  // ============================================================

  function csvField(v) {
    if (v == null) return '';
    var s = String(v);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCsv() {
    var rows = getFilteredCustomers();
    if (rows.length === 0) {
      window.mastAlert('No customers in the current view to export.');
      return;
    }
    var header = ['displayName', 'primaryEmail', 'phones', 'tags', 'lifetimeSpend', 'orderCount', 'lastOrderAt', 'source', 'createdAt', 'customerId'];
    var lines = [header.join(',')];
    rows.forEach(function(c) {
      var stats = c.stats || {};
      var phones = (c.phones || []).join('; ');
      var tags = (c.tags || []).join('; ');
      var spend = (typeof stats.lifetimeSpendCents === 'number') ? (stats.lifetimeSpendCents / 100).toFixed(2) : '';
      var orderCount = (typeof stats.orderCount === 'number') ? String(stats.orderCount) : '';
      var lastOrder = stats.lastOrderAt || '';
      var line = [
        csvField(c.displayName || ''),
        csvField(c.primaryEmail || ''),
        csvField(phones),
        csvField(tags),
        csvField(spend),
        csvField(orderCount),
        csvField(lastOrder),
        csvField(c.source || ''),
        csvField(c.createdAt || ''),
        csvField(c.id || '')
      ].join(',');
      lines.push(line);
    });
    var csvText = lines.join('\n');

    var tenantId = (typeof MastDB !== 'undefined' && MastDB.tenantId) ? MastDB.tenantId() : 'tenant';
    var ymd = new Date().toISOString().slice(0, 10);
    var filename = 'mast-customers-' + tenantId + '-' + ymd + '.csv';

    try {
      var blob = new Blob([csvText], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[customers] csv export failed', e);
      window.mastAlert('CSV export failed: ' + (e && e.message));
    }
  }

  // ============================================================
  // Phase 6.3 — Segments
  // ============================================================

  function findSegmentById(id) {
    if (!id) return null;
    var b = BUILTIN_SEGMENTS.find(function(s) { return s.id === id; });
    if (b) return b;
    return segmentsData.find(function(s) { return s.id === id; }) || null;
  }

  // Apply a segment by writing its filters into the DOM controls and re-rendering.
  function applySegment(segId) {
    currentSegmentId = segId;
    var seg = findSegmentById(segId);
    var f = (seg && seg.filters) || {};

    var src = document.getElementById('customersSourceFilter'); if (src) src.value = f.source || 'all';
    var ws  = document.getElementById('customersWholesaleFilter'); if (ws) ws.value = f.wholesale || 'all';
    var tag = document.getElementById('customersTagFilter');    if (tag) tag.value = f.tag || '';
    var lob = document.getElementById('customersLastOrderBefore'); if (lob) lob.value = f.lastOrderBefore || '';
    var min = document.getElementById('customersMinSpend');     if (min) min.value = (typeof f.minSpendCents === 'number') ? (f.minSpendCents / 100) : '';
    var srch = document.getElementById('customersSearch');      if (srch && typeof f.search === 'string') srch.value = f.search;
    var nl  = document.getElementById('customersNewsletterOnly'); if (nl) nl.checked = !!f.newsletterOnly;
    var ld  = document.getElementById('customersLeadsOnly');      if (ld) ld.checked = !!f.leadsOnly;

    renderTable();
  }

  // Snapshot current filter DOM into a serialisable filter object.
  function readFilterSnapshot() {
    var f = readActiveFilters();
    var snap = {};
    if (f.source && f.source !== 'all') snap.source = f.source;
    if (f.wholesale && f.wholesale !== 'all') snap.wholesale = f.wholesale;
    if (f.tag) snap.tag = f.tag;
    if (f.lastOrderBefore) snap.lastOrderBefore = f.lastOrderBefore;
    if (f.minSpendDollars !== '' && f.minSpendDollars != null) {
      var n = Math.round(parseFloat(f.minSpendDollars) * 100);
      if (!isNaN(n)) snap.minSpendCents = n;
    }
    if (f.search) snap.search = f.search;
    if (f.newsletterOnly) snap.newsletterOnly = true;
    if (f.leadsOnly) snap.leadsOnly = true;
    return snap;
  }

  async function saveSegment() {
    var name = await window.mastPrompt('Name this segment:', { title: 'Save segment', confirmLabel: 'Save' });
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var filters = readFilterSnapshot();
    var id = 'seg_' + Date.now().toString(36);
    var now = new Date().toISOString();
    var record = {
      id: id,
      name: name,
      filters: filters,
      createdBy: (window.currentUser && window.currentUser.uid) || null,
      createdAt: now,
      updatedAt: now
    };
    try {
      await MastDB.set('admin/customerSegments/' + id, record);
      segmentsData.push(record);
      currentSegmentId = id;
      render();
      try { renderTable(); } catch (_e) {}
      requestAnimationFrame(renderTable);
    } catch (e) {
      console.error('[customers] save segment failed', e);
      window.mastAlert('Save segment failed: ' + (e && e.message));
    }
  }

  async function deleteSegment(segId) {
    var seg = segmentsData.find(function(s) { return s.id === segId; });
    if (!seg) return;
    var ok = await window.mastConfirm('Delete segment "' + seg.name + '"?', { title: 'Delete segment', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await MastDB.remove('admin/customerSegments/' + segId);
      segmentsData = segmentsData.filter(function(s) { return s.id !== segId; });
      if (currentSegmentId === segId) currentSegmentId = '__all';
      render();
      try { renderTable(); } catch (_e) {}
      requestAnimationFrame(renderTable);
      // Re-render manage modal if open
      if (document.getElementById('cmSegmentsModalBody')) manageSegments();
    } catch (e) {
      console.error('[customers] delete segment failed', e);
      window.mastAlert('Delete segment failed: ' + (e && e.message));
    }
  }

  async function renameSegment(segId) {
    var seg = segmentsData.find(function(s) { return s.id === segId; });
    if (!seg) return;
    var name = await window.mastPrompt('Rename segment:', { title: 'Rename segment', confirmLabel: 'Rename', defaultValue: seg.name });
    if (name === null) return;
    name = name.trim();
    if (!name || name === seg.name) return;
    try {
      await CustomersBridge.renameSegment(segId, name);
      render();
      try { renderTable(); } catch (_e) {}
      requestAnimationFrame(renderTable);
      if (document.getElementById('cmSegmentsModalBody')) manageSegments();
    } catch (e) {
      console.error('[customers] rename segment failed', e);
      window.mastAlert('Rename failed: ' + (e && e.message));
    }
  }

  function manageSegments() {
    var html = '';
    html += '<div class="modal-header"><h3>Manage segments</h3></div>';
    html += '<div class="modal-body" id="cmSegmentsModalBody">';
    if (segmentsData.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);">No saved segments yet. Build a filter combination on the customers list and click "Save as segment".</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      segmentsData.forEach(function(s) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;padding:10px 14px;gap:12px;">';
        html += '<div style="font-size:0.85rem;flex:1;min-width:0;">';
        html += '<div style="font-weight:600;">' + esc(s.name) + '</div>';
        html += '<div style="font-size:0.72rem;color:var(--warm-gray-light);">' + esc(describeFilters(s.filters || {})) + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:6px;">';
        html += '<button class="btn btn-secondary btn-small" data-seg-id="' + esc(s.id) + '" onclick="customersRenameSegment(this.dataset.segId)">Rename</button>';
        html += '<button class="btn btn-secondary btn-small" data-seg-id="' + esc(s.id) + '" onclick="customersDeleteSegment(this.dataset.segId)" style="color:var(--danger);">Delete</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="modal-footer"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>';
    if (typeof openModal === 'function') openModal(html);
  }

  function describeFilters(f) {
    var bits = [];
    if (f.source) bits.push('source=' + f.source);
    if (f.tag) bits.push('tag=' + f.tag);
    if (f.lastOrderBefore) bits.push('last order before ' + f.lastOrderBefore);
    if (typeof f.minSpendCents === 'number') bits.push('min spend $' + (f.minSpendCents / 100).toFixed(2));
    if (f.search) bits.push('search "' + f.search + '"');
    if (f.newsletterOnly) bits.push('newsletter subscribers');
    if (f.leadsOnly) bits.push('leads only');
    if (f._newThisWeek) bits.push('new this week');
    if (f._noOrders) bits.push('no orders yet');
    return bits.length ? bits.join(' · ') : 'no filters';
  }

  // ============================================================
  // Globals exposed for inline onclick handlers
  // (matching the studentsSwitchView / studentsViewDetail pattern)
  // ============================================================

  window.customersSwitchView = switchView;
  window.customersOpenDetail = openDetail;
  window.customersRender = renderTable;
  window.customersOpenWalletAdjust = openWalletAdjustModal;
  window.customersSubmitWalletAdjust = submitWalletAdjust;
  window._customersSort = function(key) {
    if (customersSortKey === key) customersSortDir = (customersSortDir === 'asc') ? 'desc' : 'asc';
    else {
      customersSortKey = key;
      // Numeric/date defaults to desc; text defaults to asc.
      var descKeys = { orderCount: 1, lifetimeSpendCents: 1, lastOrderAt: 1, updatedAt: 1 };
      customersSortDir = descKeys[key] ? 'desc' : 'asc';
    }
    renderTable();
  };
  window.clearCustomersFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { tag: 1, source: 1, dateFrom: 1, dateTo: 1, customerIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    // Explicitly reset the form filters so the re-render reflects a truly
    // clean state. Without this, the existing input values can briefly persist
    // between the click and the re-render, leaving the user staring at a
    // populated search box and an empty table for a frame or two — or
    // worse, never re-rendering if the navigateTo path no-ops because route
    // params didn't actually change.
    ['customersSearch', 'customersSourceFilter', 'customersWholesaleFilter',
     'customersTagFilter', 'customersLastOrderBefore', 'customersMinSpend'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['customersNewsletterOnly', 'customersLeadsOnly'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.checked = false;
    });
    if (typeof navigateTo === 'function') navigateTo('customers', next);
    // Belt-and-suspenders synchronous re-render — the navigateTo→setup→rAF
    // chain can race, and Clear filters that doesn't immediately repopulate
    // is exactly the bug the W3 verifier reported.
    if (typeof renderTable === 'function') {
      try { renderTable(); } catch (_e) {}
    }
  };
  window.customersSwitchDetailTab = switchDetailTab;
  window.customersOpenOrder = openOrderFromCustomer;
  window.customersAddTag = addTag;
  window.customersRemoveTag = removeTag;
  window.customersToggleNewsletter = function(id, on) { return toggleNewsletter(id, on); };
  window.customersSaveNotes = saveNotes;
  window.customersMerge = mergeCustomers;

  // ── V2 bridge (classic burn-down Wave E) — state-free cores shared with
  // customers-v2; the twin never re-implements a write. Merge stays
  // single-sourced on mergeCustomers (already consumed by duplicates-v2).
  window.CustomersBridge = {
    saveField: saveCustomerField,
    setTags: function (customerId, tags) { return saveCustomerField(customerId, 'tags', Array.isArray(tags) ? tags : []); },
    saveNotes: function (customerId, value) { return saveCustomerField(customerId, 'notes', value || ''); },
    listSegments: async function () {
      var raw = await MastDB.get('admin/customerSegments') || {};
      return Object.keys(raw).map(function (k) { return Object.assign({ _key: k }, raw[k]); })
        .filter(function (x) { return x && x.name; });
    },
    saveSegment: async function (name, filters) {
      name = (name || '').trim();
      if (!name) throw new Error('Segment name required');
      var id = 'seg_' + Date.now().toString(36);
      var now = new Date().toISOString();
      var record = {
        id: id, name: name, filters: filters || {},
        createdBy: (window.currentUser && window.currentUser.uid) || null,
        createdAt: now, updatedAt: now
      };
      await MastDB.set('admin/customerSegments/' + id, record);
      segmentsData.push(record);
      return record;
    },
    deleteSegment: async function (segId) {
      await MastDB.remove('admin/customerSegments/' + segId);
      segmentsData = segmentsData.filter(function (x) { return x.id !== segId; });
      return true;
    },
    renameSegment: async function (segId, name) {
      name = (name || '').trim();
      if (!name) throw new Error('Segment name required');
      var now = new Date().toISOString();
      await MastDB.update('admin/customerSegments/' + segId, { name: name, updatedAt: now });
      var seg = segmentsData.find(function (x) { return x.id === segId; });
      if (seg) { seg.name = name; seg.updatedAt = now; }
      return true;
    },
    // Marketing opt-in (newsletter + SMS) — a deep set on the nested marketing
    // object so a single-channel write never clobbers the other channel. Same
    // write legacy's toggleNewsletter performs; SMS reuses the identical path.
    // This is the SINGLE source for both the legacy toggle and the V2 twin.
    setMarketingOptIn: async function (customerId, channel, value) {
      var key = (channel === 'sms') ? 'smsOptIn' : 'newsletterOptIn';
      var val = !!value;
      var now = new Date().toISOString();
      await MastDB.set('admin/customers/' + customerId + '/marketing/' + key, val);
      await MastDB.set('admin/customers/' + customerId + '/updatedAt', now);
      var c = customersData.find(function (x) { return x && x.id === customerId; });
      if (c) { if (!c.marketing) c.marketing = {}; c.marketing[key] = val; c.updatedAt = now; }
      return val;
    },
    // Add/link a contact to this customer — opens the contacts add-contact flow
    // with the customer pre-linked (legacy addContactToCustomer). Navigation +
    // modal only; the atomic contact write lives in contacts.js.
    addContact: function (customerId) { return addContactToCustomer(customerId); },
    recomputeStats: async function () {
      var fn = firebase.functions().httpsCallable('recomputeAllCustomerStats');
      var res = await fn({ tenantId: MastDB.tenantId() });
      var data = (res && res.data) || {};
      if (data.ok !== true) throw new Error(data.message || 'Recompute failed');
      return data;
    },
    merge: mergeCustomers,
    isWholesale: isWholesaleCustomer
  };
  window.customersOpenContact = openContactFromCustomer;
  window.customersBackFromDetail = backFromDetail;

  // Delegated input listener for dirty indicator on customer edit.
  document.addEventListener('input', function(e) {
    var tab = document.getElementById('customersTab');
    if (tab && tab.contains(e.target)) _custEditUpdateDirtyIndicator();
  }, true);

  // Register MastNavStack restorer for the customers route.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('customers', function(view, state) {
      if (view !== 'detail' || !state || !state.customerId) return;
      var openIt = function() {
        if (customersData.find(function(x) { return x && x.id === state.customerId; })) {
          selectedCustomerId = state.customerId;
          currentView = 'detail';
          detailTab = state.detailTab || 'overview';
          render();
          if (state.scrollTop != null) {
            setTimeout(function() { window.scrollTo(0, state.scrollTop); }, 50);
          }
        }
      };
      if (!customersLoaded) loadCustomers().then(openIt);
      else openIt();
    });
  }
  window.customersAddContact = addContactToCustomer;
  // Build 5a — Activity tab handlers
  window.customersSetActivityFilter = customersSetActivityFilter;
  window.customersOpenActivityDrillIn = customersOpenActivityDrillIn;
  // Called by contacts.js after atomically creating a contact that's linked
  // to a customer. Keeps the customers module's in-memory copy in sync so
  // MastNavStack.popAndReturn → restorer → render shows the new entry.
  window.customersAppendLinkedContact = function(customerId, contactId) {
    var cust = customersData.find(function(x) { return x && x.id === customerId; });
    if (!cust) return;
    if (!cust.linkedIds) cust.linkedIds = {};
    var ids = (cust.linkedIds.contactIds || []).slice();
    if (ids.indexOf(contactId) === -1) ids.push(contactId);
    cust.linkedIds.contactIds = ids;
    cust.updatedAt = new Date().toISOString();
    // Invalidate the per-customer contacts cache so loadCustomerContacts
    // refetches fresh and picks up the new contact record.
    var cache = detailCache[customerId];
    if (cache) {
      cache.loaded.contacts = false;
      cache._contactsLoading = false;
    }
  };
  window.customersEnterEdit = enterCustomerEditMode;
  window.customersCancelEdit = cancelCustomerEditMode;
  window.customersSaveEdit = saveCustomerEditMode;
  window.customersLiveUpdateHeader = function(v) {
    var h3 = document.querySelector('#customersTab h3');
    if (h3) h3.innerText = (v || '').trim() || '(no name)';
  };
  window.customersBackfillStats = backfillStats;
  window.customersExportCsv = exportCsv;
  window.customersApplySegment = applySegment;
  window.customersSaveSegment = saveSegment;
  window.customersManageSegments = manageSegments;
  window.customersDeleteSegment = deleteSegment;
  window.customersRenameSegment = renameSegment;

  // ============================================================
  // Module registration
  // ============================================================

  // ============================================================
  // Ask AI registration (MastAskAi page registry)
  // CC Idea -Os1Lrm8ShTKZMafXV4k.
  // ============================================================

  window.addEventListener('mastaskai:configchanged', function() {
    var tab = document.getElementById('customersTab');
    if (tab && tab.style.display !== 'none' && currentView === 'list') {
      try { render(); } catch (_e) {}
    }
  });

  if (window.MastAskAi) {
    window.MastAskAi.register('customers', {
      title: 'Ask AI about these customers',
      placeholder: 'e.g. Who are my top spenders? Which customers haven\'t ordered in 6+ months? Where are my customers coming from?',
      notes: [
        'Lifetime spend amounts (lifetimeSpendCents and totalLifetimeSpendCents) are in CENTS.',
        'topCustomers is sorted by lifetimeSpendCents descending; spendBracketUSD groups customers by tier.',
        'Sources: order, enrollment, contact, newsletter, account, manual, import — describes how the customer first entered the system.',
        'A customer with stats.orderCount = 0 has joined (e.g. via newsletter) but never bought; useful for re-engagement questions.',
        'bySource counts how customers ENTERED the system; it does not necessarily reflect ongoing revenue source.',
        'lastOrderAt is ISO; "stale" customers are those whose last order was many months ago.',
        'If filters.search is set, the listing is narrowed by free-text on name/email; topCustomers reflects only the filtered set.'
      ],
      buildContext: function() {
        var filtered = getFilteredCustomers();
        var totalLifetimeSpendCents = 0;
        var totalOrders = 0;
        var bySource = {}, byTag = {}, byCreatedMonth = {}, bySpendBracket = {};
        var BRACKETS = [
          { name: '$0', min: 0, max: 0 },
          { name: '$1–$99', min: 1, max: 9999 },
          { name: '$100–$499', min: 10000, max: 49999 },
          { name: '$500–$999', min: 50000, max: 99999 },
          { name: '$1k–$4.9k', min: 100000, max: 499999 },
          { name: '$5k+', min: 500000, max: Infinity }
        ];

        filtered.forEach(function(c) {
          var stats = c.stats || {};
          var spend = stats.lifetimeSpendCents || 0;
          totalLifetimeSpendCents += spend;
          totalOrders += stats.orderCount || 0;

          var source = c.source || 'unknown';
          if (!bySource[source]) bySource[source] = { count: 0, totalSpendCents: 0 };
          bySource[source].count++; bySource[source].totalSpendCents += spend;

          (c.tags || []).forEach(function(t) {
            if (!byTag[t]) byTag[t] = { count: 0, totalSpendCents: 0 };
            byTag[t].count++; byTag[t].totalSpendCents += spend;
          });

          var month = (c.createdAt || '').substring(0, 7) || 'unknown';
          if (!byCreatedMonth[month]) byCreatedMonth[month] = { count: 0 };
          byCreatedMonth[month].count++;

          for (var i = 0; i < BRACKETS.length; i++) {
            if (spend >= BRACKETS[i].min && spend <= BRACKETS[i].max) {
              if (!bySpendBracket[BRACKETS[i].name]) bySpendBracket[BRACKETS[i].name] = { count: 0, totalSpendCents: 0 };
              bySpendBracket[BRACKETS[i].name].count++;
              bySpendBracket[BRACKETS[i].name].totalSpendCents += spend;
              break;
            }
          }
        });

        var topCustomers = filtered.slice()
          .sort(function(a, b) { return ((b.stats || {}).lifetimeSpendCents || 0) - ((a.stats || {}).lifetimeSpendCents || 0); })
          .slice(0, 15)
          .map(function(c) {
            var s = c.stats || {};
            return {
              name: c.displayName || '(no name)',
              email: c.primaryEmail || '',
              source: c.source || 'unknown',
              orderCount: s.orderCount || 0,
              lifetimeSpendUSD: +((s.lifetimeSpendCents || 0) / 100).toFixed(2),
              lastOrderAt: s.lastOrderAt ? s.lastOrderAt.slice(0, 10) : null,
              tags: c.tags || []
            };
          });

        var f = readActiveFilters();
        var seg = findSegmentById(currentSegmentId);
        return {
          route: '/app#customers',
          pageTitle: 'Customers',
          filters: {
            search: f.search || null,
            source: f.source !== 'all' ? f.source : null,
            tag: f.tag || null,
            lastOrderBefore: f.lastOrderBefore || null,
            minSpendDollars: f.minSpendDollars || null,
            sortBy: f.sortBy,
            segment: seg ? { id: seg.id, name: seg.name, builtin: !!seg._builtin } : null
          },
          aggregates: {
            rowCount: filtered.length,
            totalLifetimeSpendCents: totalLifetimeSpendCents,
            totalLifetimeSpendUSD: +(totalLifetimeSpendCents / 100).toFixed(2),
            totalOrdersAcrossCustomers: totalOrders,
            avgSpendPerCustomerUSD: filtered.length > 0
              ? +(totalLifetimeSpendCents / 100 / filtered.length).toFixed(2)
              : 0,
            bySource: bySource,
            byTag: byTag,
            byCreatedMonth: byCreatedMonth,
            bySpendBracketUSD: bySpendBracket
          },
          topCustomers: topCustomers
        };
      }
    });
  }

  MastAdmin.registerModule('customers', {
    routes: {
      'customers': {
        tab: 'customersTab',
        setup: function() {
          // Detail-view restoration is now handled by MastNavStack restorer.
          // Deep-link: ?id=X opens detail directly so cross-module links
          // (e.g. enrollment signals card, pass cohort drill) land on the
          // canonical customer detail page instead of the list.
          var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
          var deepLinkId = rp && typeof rp.id === 'string' ? rp.id : '';
          if (!customersLoaded) {
            currentView = 'list';
            selectedCustomerId = null;
            loadCustomers().then(function() {
              if (deepLinkId && typeof openDetail === 'function') openDetail(deepLinkId);
            });
          } else {
            currentView = 'list';
            selectedCustomerId = null;
            render();
            // W3 follow-up — the prior code relied solely on requestAnimationFrame
            // to populate the table, but the rAF can race / drop on mid-session
            // re-entry (sidebar click after a prior visit), leaving #customersTableWrap
            // empty until something else triggers a re-render. Run renderTable
            // synchronously NOW; keep the rAF as a defensive second pass for
            // any layout-dependent measurements.
            try { renderTable(); } catch (_e) {}
            requestAnimationFrame(renderTable);
            if (deepLinkId && typeof openDetail === 'function') openDetail(deepLinkId);
          }
        }
      }
    },
    detachListeners: function() {
      customersData = [];
      duplicatesData = [];
      segmentsData = [];
      wholesaleEmailMap = {};
      currentSegmentId = null;
      customersLoaded = false;
      currentView = 'list';
      selectedCustomerId = null;
      detailTab = 'overview';
      detailCache = {};
    }
  });

})();
