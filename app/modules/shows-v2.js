/**
 * shows-v2.js — read-only twin SHELL of the legacy Shows lifecycle (PR2 of the
 * shows-v2 conversion; PR1 — merged — shipped window.ShowsBridge).
 *
 * Legacy shows.js (#show / #show-find / #show-apply / #show-prep / #show-execute /
 * #show-history, all tab 'showTab') hosts the craft-show lifecycle as a sub-nav of
 * five views over admin/shows/{id}, swapping a card list ⇄ a detail (Info / Prep /
 * Execute / History sections) per stage. This twin re-hosts that surface on the
 * Entity Engine: one schema-driven hub (MastEntity.define('shows-v2')) with the
 * lifecycle as LENSES (Find / Apply / Prep / Execute / History — mirrors how
 * classes-v2 switches Catalog/Rooms/Reports/Settings lenses), and a read-focused
 * Faceted Record slide-out with pane-tabs Info / Prep / Execute / History that
 * render the record's data read-only.
 *
 * Variant: a show is a lifecycle record (an application that moves
 * considering→applied→accepted→… and accumulates prep/execute/history subtrees).
 * PR3 makes the APPLY lens + record detail WRITEABLE — native create / edit /
 * status-machine / deep-dive-enrich / delete — all SINGLE-SOURCED through
 * window.ShowsBridge (shipped in PR1), never reimplementing the nested
 * admin/shows/{id} write paths. PR4 makes the Prep / Execute / History detail
 * pane-tabs WRITEABLE too — in-pane sub-editors (staffing / inventory + packed /
 * logistics; multi-day day-picked sales / reconciliation steppers / notes;
 * expenses / post-show review) all delegating to the SAME ShowsBridge methods.
 * PR5 wires the FIND lens: the /showFinder AI-discovery search (a CF READ, in the
 * twin like the /showDeepDive enrich) → ranked result cards → "+ Add to pipeline"
 * via ShowsBridge.addFromFinder (the WRITE), with dedupe vs the current pipeline.
 * PR6 ports the AI APPLICATION BUILDER: a native 6-step wizard (launched from the
 * Apply lens) that drafts a craft-show application — (1) fetch+parse the show's
 * application URL via /studioAssistant, (2) assign gallery images to photo slots +
 * tag them, (3) auto-map the studio profile onto the parsed fields, (4) gap
 * analysis, (5) AI-draft copy via /studioAssistant, (6) preview + save. The
 * /studioAssistant CF call (token-metered, 402 → coin purchase) is a READ and
 * stays in the twin; the three WRITES single-source through ShowsBridge:
 * saveApplication (showLight/applications/{key}), setImageAppMeta (images/{id}
 * applicationDescription / applicationPhoto / productId), saveProfile
 * (showLight/profile). All gate on can('show-prep','edit').
 *
 * Find-lens surface (PR5):
 *   Search        → /showFinder CF read (bearer + X-Tenant-ID), body = the search form
 *   Add result    → ShowsBridge.addFromFinder(show) (aiGenerated:true; gate: can('show-prep','edit'))
 *                   deduped vs V2.rows; an already-pipelined result is disabled.
 *
 * AI-builder surface (PR6):
 *   Step 1 parse   → /studioAssistant CF read (token-metered; 402 → openCoinPurchaseModal)
 *   Step 2 images  → ShowsBridge.setImageAppMeta(imageId, patch) (image-tagging WRITE)
 *   Step 3 map     → in-memory profile→field mapping (no write)
 *   Step 4 gaps    → gap analysis (read); inline profile backfill → ShowsBridge.saveProfile
 *   Step 5 draft   → /studioAssistant CF read (token-metered; 402 → openCoinPurchaseModal)
 *   Step 6 save    → ShowsBridge.saveApplication(appData) (draft WRITE; gate: can('show-prep','edit'))
 *
 * Apply-lens write surface (all → window.ShowsBridge):
 *   + New show / Edit  → ShowsBridge.create(data) / .update(id,data)  (gate: can('show-prep','edit'))
 *   Status actions     → ShowsBridge.setStatus(id,newStatus,record)   (any→any; accepted auto-publishes
 *                        to public events/{id}, admin-gated INSIDE the bridge)
 *   Enrich (deep dive) → /showDeepDive CF read (bearer + X-Tenant-ID), then ShowsBridge.applyDeepDive(id,details)
 *   Delete             → ShowsBridge.remove(id) (clears events/{id} mirror)  (gate: can('show-prep','delete'))
 *
 * Record shape (admin/shows/{id}, money in CENTS): name / type / format / entryType /
 * locationCity / locationState / startDate / endDate / websiteUrl / boothFee /
 * juryFee / applicationDeadline / applicationUrl / notes / applicationStatus
 * (considering|applied|accepted|waitlisted|rejected|withdrawn) / aiGenerated /
 * deepDive{} + nested prep{staffing,inventory,logistics} / execute{sales,
 * reconciliation,notes} / history{expenses,review} / applicationHistory{}.
 *
 * Cold-safe: doesn't assume legacy shows.js ran — lazy-loads the shows module so
 * window.ShowsBridge + the live showsData cache exist, and reads MastDB.shows
 * directly. Flag-gated (?ui=1). CUT OVER (PR7): #show / #show-find / #show-apply /
 * #show-prep / #show-execute / #show-history remap to this twin via
 * MAST_V2_ROUTE_MAP for V2 users; legacy shows.js still reachable via
 * navigateToClassic (darked in PR8).
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
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }
  // Shows' RBAC axis is 'show-prep'. Create / edit / status all gate on
  // can('show-prep','edit'); delete gates on can('show-prep','delete') (mirrors
  // the legacy saveShow / updateShowStatus / archiveShow gating).
  function canEdit() { return can('show-prep', 'edit'); }
  function canDelete() { return can('show-prep', 'delete'); }
  function toast(msg, isErr) { if (typeof window.showToast === 'function') window.showToast(msg, !!isErr); }
  function notPermitted() { toast('You don\'t have permission to do that.', true); }
  function bridge() { return window.ShowsBridge; }
  function bridgeLoading() { toast('Shows engine still loading — try again.', true); }
  function actionErr(e) { console.error('[shows-v2] action', e); toast('Error: ' + ((e && e.message) || e), true); }

  // ── Label / lens maps (mirror shows.js SHOW_TYPE_LABELS + status set) ────────
  var SHOW_TYPE_LABELS = {
    juried: 'Juried', 'pop-up': 'Pop-Up', market: 'Market', recurring: 'Recurring', trade: 'Trade', other: 'Other'
  };
  var STATUS_LABEL = {
    considering: 'Considering', applied: 'Applied', accepted: 'Accepted',
    waitlisted: 'Waitlisted', rejected: 'Rejected', withdrawn: 'Withdrawn'
  };
  // Application status → v2 design-token tone (NO hardcoded hex — lint-design-tokens).
  // Maps the legacy SHOW_STATUS_COLORS intent onto tone tokens.
  var STATUS_TONE = {
    considering: 'info', applied: 'teal', accepted: 'success',
    waitlisted: 'warning', rejected: 'danger', withdrawn: 'neutral'
  };
  // The five lifecycle lenses (mirror shows.js sub-nav). Find is a placeholder this
  // PR (the /showFinder form + results land in a later PR).
  var LENSES = [
    ['find', 'Find'], ['apply', 'Apply'], ['prep', 'Prep'], ['execute', 'Execute'], ['history', 'History']
  ];

  function showName(s) { return (s && s.name) || 'Unnamed Show'; }
  function typeLabel(s) { var t = s && s.type; return SHOW_TYPE_LABELS[t] || t || 'Other'; }
  function statusOf(s) { return (s && s.applicationStatus) || 'considering'; }
  function statusLabel(s) { var st = statusOf(s); return STATUS_LABEL[st] || st; }
  function locationOf(s) { return [s && s.locationCity, s && s.locationState].filter(Boolean).join(', '); }
  // boothFee / juryFee are in CENTS → dollars via the single money source of truth.
  function boothFeeVal(s) { return N.moneyVal(s, 'boothFee', null); }
  function juryFeeVal(s) { return N.moneyVal(s, 'juryFee', null); }

  // M/D/YYYY date (mirrors shows.js formatShowDate — startDate/endDate are stored
  // as YYYY-MM-DD strings, no tenant-TZ math needed).
  function fmtDate(dateStr) {
    if (!dateStr) return '';
    var parts = String(dateStr).split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var mi = parseInt(parts[1], 10) - 1;
    if (isNaN(mi) || !months[mi]) return esc(dateStr);
    return months[mi] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }
  function datesText(s) {
    if (!s || !s.startDate) return '';
    var d = fmtDate(s.startDate);
    if (s.endDate && s.endDate !== s.startDate) d += ' – ' + fmtDate(s.endDate);
    return d;
  }
  function feesText(s) {
    var parts = [];
    var bf = boothFeeVal(s); if (bf != null) parts.push('Booth ' + (N.money(bf) || ''));
    var jf = juryFeeVal(s); if (jf != null) parts.push('Jury ' + (N.money(jf) || ''));
    return parts.join(' · ');
  }
  function todayStr() { return new Date().toISOString().split('T')[0]; }
  function isMultiDay(s) { return !!(s && s.startDate && s.endDate && s.endDate !== s.startDate); }
  function getShowDates(s) {
    if (!s || !s.startDate) return [];
    var out = [];
    var d = new Date(s.startDate + 'T00:00:00');
    var end = new Date((s.endDate || s.startDate) + 'T00:00:00');
    while (d <= end) { out.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }
    return out;
  }

  // ── Lens membership (mirror shows.js updateShowTabBadges + the sub-view lists) ─
  // Apply  = active applications (considering / applied / waitlisted)
  // Prep   = accepted shows
  // Execute= accepted shows (live / upcoming day-of tooling)
  // History= past (end date < today) OR terminal (rejected / withdrawn)
  function inLens(s, lens) {
    var st = statusOf(s);
    var today = V2.today;
    var endDate = (s && (s.endDate || s.startDate)) || '';
    switch (lens) {
      case 'apply': return st === 'considering' || st === 'applied' || st === 'waitlisted';
      case 'prep': return st === 'accepted';
      case 'execute': return st === 'accepted';
      case 'history': return (endDate && endDate < today) || st === 'rejected' || st === 'withdrawn';
      default: return true; // 'find' has no list membership (placeholder)
    }
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('shows-v2', {
    label: 'Show', labelPlural: 'Shows', size: 'lg',
    route: 'shows-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      { name: 'name', label: 'Show', type: 'text', list: true, readOnly: true, group: 'Show', get: showName },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, get: function (s) { return typeLabel(s); } },
      { name: 'location', label: 'Location', type: 'text', list: true, readOnly: true, sortable: false, get: function (s) { return locationOf(s) || '—'; } },
      { name: 'dates', label: 'Dates', type: 'text', list: true, readOnly: true, sortable: false, get: function (s) { return datesText(s) || '—'; } },
      { name: 'boothFee', label: 'Booth fee', type: 'money', list: true, readOnly: true, align: 'right', get: boothFeeVal },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['considering', 'applied', 'accepted', 'waitlisted', 'rejected', 'withdrawn'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cold drills (a direct #shows-v2 deep-open, or a future cross-module drill)
    // may reach fetch before the route setup ran — gate on ensureLoaded() so the
    // showsData cache exists.
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      // Faceted-record interior (classes-v2 / orders-v2 custom-render pattern):
      // the four legacy renderShowDetail* sections (Info / Prep / Execute /
      // History) mapped 1:1 to pane-tabs. Info hosts the status-machine + enrich
      // + delete actions (PR3); Prep / Execute / History are WRITEABLE in-pane
      // sub-editors (PR4) — every write routes through ShowsBridge, re-rendering
      // the affected pane in place (refreshThenRerender).
      render: function (UI, s) {
        var status = statusOf(s);
        var bf = boothFeeVal(s), jf = juryFeeVal(s);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusLabel(s), STATUS_TONE[status] || 'neutral'), hero: true },
          { k: 'Type', v: typeLabel(s) },
          { k: 'Booth fee', v: bf != null ? (N.money(bf) || '—') : '—' },
          { k: 'Jury fee', v: jf != null ? (N.money(jf) || '—') : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'info', label: 'Info' }, { key: 'prep', label: 'Prep' },
          { key: 'execute', label: 'Execute' }, { key: 'history', label: 'History' }
        ], 'info');
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="info">' + renderInfoPane(UI, s) + '</div>' +
          '<div class="mu-pane" data-pane="prep" hidden>' + renderPrepPane(UI, s) + '</div>' +
          '<div class="mu-pane" data-pane="execute" hidden>' + renderExecutePane(UI, s) + '</div>' +
          '<div class="mu-pane" data-pane="history" hidden>' + renderHistoryPane(UI, s) + '</div>';
      },
      // Native create / edit form — mirrors the legacy createShowModal field set
      // (shows.js openCreateShowModal / saveShow): name (required) / type / city /
      // state / start+end dates / website / booth+jury fees (entered as DOLLARS,
      // converted to CENTS in onSave) / application deadline / application URL /
      // notes. prep / execute / history / applicationHistory / status are NOT
      // touched here — a partial update via the bridge preserves them.
      editRender: function (s, mode) {
        s = s || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:140px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function val(v) { return esc(v == null ? '' : v); }
        function money(c) { return (c != null && c !== '') ? (c / 100).toFixed(2) : ''; }
        var typeOpts = ['juried', 'pop-up', 'market', 'recurring', 'trade', 'other'].map(function (t) {
          var sel = (s.type || 'juried') === t ? ' selected' : '';
          return '<option value="' + t + '"' + sel + '>' + esc(SHOW_TYPE_LABELS[t] || t) + '</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' +
            (mode === 'create' ? 'New show' : 'Edit this show') + '</div>' +
          fg('Show name *', '<input class="form-input" id="showV2Name" value="' + val(s.name) + '" style="width:100%;" placeholder="e.g. Paradise City Arts Festival">') +
          fg('Type', '<select class="form-input" id="showV2Type" style="width:100%;">' + typeOpts + '</select>') +
          row2(
            fg('City', '<input class="form-input" id="showV2City" value="' + val(s.locationCity) + '" style="width:100%;" placeholder="e.g. Northampton">', true),
            fg('State', '<input class="form-input" id="showV2State" value="' + val(s.locationState) + '" style="width:100%;" placeholder="e.g. MA">', true)
          ) +
          row2(
            fg('Start date', '<input class="form-input" type="date" id="showV2Start" value="' + val(s.startDate) + '" style="width:100%;">', true),
            fg('End date', '<input class="form-input" type="date" id="showV2End" value="' + val(s.endDate) + '" style="width:100%;">', true)
          ) +
          fg('Website', '<input class="form-input" id="showV2Website" value="' + val(s.websiteUrl) + '" style="width:100%;" placeholder="https://…">') +
          row2(
            fg('Booth fee ($)', '<input class="form-input" type="number" step="0.01" id="showV2BoothFee" value="' + money(s.boothFee) + '" style="width:100%;" placeholder="0.00">', true),
            fg('Jury fee ($)', '<input class="form-input" type="number" step="0.01" id="showV2JuryFee" value="' + money(s.juryFee) + '" style="width:100%;" placeholder="0.00">', true)
          ) +
          fg('Application deadline', '<input class="form-input" type="date" id="showV2Deadline" value="' + val(s.applicationDeadline) + '" style="width:100%;">') +
          fg('Application URL', '<input class="form-input" id="showV2AppUrl" value="' + val(s.applicationUrl) + '" style="width:100%;" placeholder="https://…">') +
          fg('Notes', '<textarea class="form-input" id="showV2Notes" rows="3" style="width:100%;resize:vertical;">' + val(s.notes) + '</textarea>');
      }
    },
    // onSave — reads the editRender DOM, builds the basic-record object (money →
    // CENTS), and delegates to ShowsBridge.create / .update (the SAME write cores
    // the legacy saveShow uses). Returns false on validation/engine error so the
    // engine keeps the form open; a resolved-true closes it.
    onSave: function (rec, mode) {
      if (!canEdit()) { notPermitted(); return false; }
      if (!bridge() || !bridge().create) { bridgeLoading(); return false; }
      function v(id) { var el = document.getElementById(id); return el ? el.value : ''; }
      var name = (v('showV2Name') || '').trim();
      if (!name) { toast('Show name is required.', true); return false; }
      var boothFeeVal = parseFloat(v('showV2BoothFee'));
      var juryFeeVal = parseFloat(v('showV2JuryFee'));
      var data = {
        name: name,
        type: v('showV2Type') || 'juried',
        locationCity: (v('showV2City') || '').trim(),
        locationState: (v('showV2State') || '').trim(),
        startDate: v('showV2Start') || null,
        endDate: v('showV2End') || null,
        websiteUrl: (v('showV2Website') || '').trim() || null,
        boothFee: boothFeeVal ? Math.round(boothFeeVal * 100) : null,
        juryFee: juryFeeVal ? Math.round(juryFeeVal * 100) : null,
        applicationDeadline: v('showV2Deadline') || null,
        applicationUrl: (v('showV2AppUrl') || '').trim() || null,
        notes: (v('showV2Notes') || '').trim() || null,
        updatedAt: new Date().toISOString()
      };
      if (mode === 'create') {
        return Promise.resolve(bridge().create(data)).then(function (id) {
          toast('Show created.');
          // Returning true lets the engine close the create form (slideOut._save
          // force-closes on a truthy create resolve). Refresh the cache + re-render
          // the list so the new record shows immediately — deferred a tick so the
          // list re-paint lands AFTER the engine has torn the form down (mirrors the
          // jobs-v2 create pattern; rendering synchronously here raced the close and
          // left a stale pane behind). The maker stays on the list, not bounced into
          // a detail pane that the force-close would immediately shut.
          V2.loaded = false;
          setTimeout(function () {
            ensureLoaded().then(function () { render(); }).catch(function (e) { console.error('[shows-v2] load', e); });
          }, 60);
          return true;
        }).catch(function (e) { actionErr(e); return false; });
      }
      var sid = (rec && (rec._key || rec.id)) || (V2.current);
      return Promise.resolve(bridge().update(sid, data)).then(function () {
        toast('Show updated.');
        // Mutate the live cached record so the post-save read re-render shows the
        // edits immediately; reloadThenOpen refreshes the cache for the next open.
        Object.assign(V2.byId[sid] || rec || {}, data);
        reloadThenOpen(sid);
        return true;
      }).catch(function (e) { actionErr(e); return false; });
    }
  });

  // ── Detail panes (read-only mirrors of renderShowDetail{Info,Prep,Execute,History}) ──

  // Info — core fields + deep-dive details + application status history.
  function renderInfoPane(UI, s) {
    var coreKv = UI.kv([
      { k: 'Location', v: locationOf(s) ? esc(locationOf(s)) : '—' },
      { k: 'Dates', v: datesText(s) ? esc(datesText(s)) : '—' },
      { k: 'Type', v: esc(typeLabel(s)) + (s.aiGenerated ? ' ' + UI.badge('AI Found', 'teal') : '') },
      { k: 'Website', v: s.websiteUrl ? linkOut(s.websiteUrl, s.websiteUrl) : '—' },
      { k: 'Booth fee', v: boothFeeVal(s) != null ? (N.money(boothFeeVal(s)) || '—') : '—' },
      { k: 'Jury fee', v: juryFeeVal(s) != null ? (N.money(juryFeeVal(s)) || '—') : '—' },
      { k: 'Application deadline', v: s.applicationDeadline ? esc(fmtDate(s.applicationDeadline)) : '—' },
      { k: 'Application URL', v: s.applicationUrl ? linkOut(s.applicationUrl, 'Open') : '—' }
    ]);
    var notesBody = s.notes
      ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(s.notes) + '</div>'
      : '<span class="mu-sub">No notes.</span>';

    var out = UI.card('Show', coreKv) + UI.card('Notes', notesBody);

    // Deep dive (AI-researched blob) — render whatever fields are present.
    var dd = s.deepDive || {};
    if (dd && Object.keys(dd).length) {
      var ddPairs = [];
      function add(k, v) { if (v != null && v !== '') ddPairs.push({ k: k, v: v }); }
      if (dd.applicationMethod) add('Apply via', esc(dd.applicationMethod) + (dd.applicationUrl ? ' — ' + linkOut(dd.applicationUrl, 'Open') : ''));
      if (dd.boothFeeNotes) add('Booth fee details', esc(dd.boothFeeNotes));
      if (dd.juryFeeNotes) add('Jury fee details', esc(dd.juryFeeNotes));
      if (dd.applicationDeadline) add('Application deadline', esc(fmtDate(dd.applicationDeadline)) + (dd.lateDeadline ? ' (Late: ' + esc(fmtDate(dd.lateDeadline)) + ')' : ''));
      if (dd.notificationDate) add('Notification date', esc(fmtDate(dd.notificationDate)));
      if (dd.juryRequirements) add('Jury requirements', esc(dd.juryRequirements));
      if (dd.boothSize) add('Booth size', esc(dd.boothSize));
      if (dd.boothOptions) add('Booth options', esc(dd.boothOptions));
      if (dd.electricity === true || dd.electricity === false) add('Electricity', (dd.electricity ? 'Yes' : 'No') + (dd.electricityNotes ? ' — ' + esc(dd.electricityNotes) : ''));
      if (dd.wifi === true || dd.wifi === false) add('WiFi', dd.wifi ? 'Yes' : 'No');
      if (dd.setupTime) add('Setup', esc(dd.setupTime));
      if (dd.teardownTime) add('Teardown', esc(dd.teardownTime));
      if (dd.insuranceRequired != null) add('Insurance', (dd.insuranceRequired ? 'Required' : 'Not required') + (dd.insuranceNotes ? ' — ' + esc(dd.insuranceNotes) : ''));
      if (dd.permits) add('Permits', esc(dd.permits));
      if (dd.attendance) add('Attendance', esc(String(dd.attendance)));
      if (dd.eligibility) add('Eligibility', esc(dd.eligibility));
      if (dd.additionalNotes) add('Additional notes', esc(dd.additionalNotes));
      if (ddPairs.length) out += UI.card('Deep dive details ' + UI.badge('AI Researched', 'teal'), UI.kv(ddPairs));
    }

    // Application status actions + deep-dive enrich + delete (writeable this PR —
    // all delegate to window.ShowsBridge). Mirrors the legacy "Application Status"
    // button row (any status → any status; the bridge no-ops old===new) + the
    // Deep Dive + Delete affordances. Gated: change/enrich on can('show-prep',
    // 'edit'), delete on can('show-prep','delete').
    out += UI.card('Actions', renderActions(UI, s));

    // Application status history (newest first; mirrors the legacy Status History).
    var hist = s.applicationHistory
      ? Object.keys(s.applicationHistory).map(function (k) { return s.applicationHistory[k]; })
        .sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); })
      : [];
    var histBody;
    if (!hist.length) {
      histBody = '<span class="mu-sub">No status changes yet.</span>';
    } else {
      histBody = hist.map(function (e) {
        var ns = e.newStatus || '';
        var when = e.timestamp ? new Date(e.timestamp).toLocaleDateString() : '';
        return '<div style="padding:6px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));font-size:0.85rem;">' +
          UI.badge(STATUS_LABEL[ns] || ns, STATUS_TONE[ns] || 'neutral') +
          (e.oldStatus ? ' <span class="mu-sub">from ' + esc(STATUS_LABEL[e.oldStatus] || e.oldStatus) + '</span>' : '') +
          (when ? ' <span class="mu-sub">' + esc(when) + '</span>' : '') +
        '</div>';
      }).join('');
    }
    out += UI.card('Status history', histBody);
    return out;
  }

  // Actions card — status machine + deep-dive enrich + delete. All writes route
  // through window.ShowsBridge (PR1); RBAC + confirm stay here on the caller.
  // The status set + "any → any" transition rule mirrors the legacy detail
  // (shows.js renderShowDetailInfo): every status is a button, the current one is
  // highlighted, and the bridge's setStatus no-ops a same-status click.
  var STATUS_ORDER = ['considering', 'applied', 'accepted', 'waitlisted', 'rejected', 'withdrawn'];
  function renderActions(UI, s) {
    var id = s._key || s.id;
    var jid = "'" + id + "'";
    var cur = statusOf(s);
    var out = '';

    if (canEdit()) {
      var btns = STATUS_ORDER.map(function (st) {
        var on = cur === st;
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '"' +
          (on ? ' disabled' : '') +
          ' onclick="ShowsV2.setStatus(' + jid + ',\'' + st + '\')">' + esc(STATUS_LABEL[st] || st) + '</button>';
      }).join(' ');
      out += '<div class="mu-sub" style="margin-bottom:6px;">Application status</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + btns + '</div>' +
        '<div class="mu-sub" style="margin-top:8px;">Marking a show <strong>Accepted</strong> publishes it to the public events calendar (admins only — a non-admin change is recorded but the publish is skipped).</div>';
    } else {
      out += '<div class="mu-sub">Status: ' + esc(statusLabel(s)) + '. You don\'t have permission to change it.</div>';
    }

    // Deep-dive enrich (AI research over the show's website) + delete.
    var extra = [];
    if (canEdit()) {
      var hasUrl = !!(s.websiteUrl);
      extra.push('<button class="btn btn-secondary"' + (hasUrl ? '' : ' disabled title="Add a website URL first"') +
        ' onclick="ShowsV2.enrich(' + jid + ')">🔍 Enrich (deep dive)</button>');
    }
    if (canDelete()) {
      extra.push('<button class="btn btn-secondary" style="color:var(--danger);" onclick="ShowsV2.remove(' + jid + ')">Delete show</button>');
    }
    if (extra.length) {
      out += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' + extra.join('') + '</div>';
      if (canEdit()) out += '<div class="mu-sub" style="margin-top:6px;">Deep dive researches the show\'s website for booth/jury fees, deadlines, requirements and more, then fills in the details above.</div>';
    }
    return out;
  }

  // Prep — staffing + inventory pull list + logistics (writeable, PR4). All
  // edits delegate to ShowsBridge (setStaffing/removeStaffing, upsertInventory/
  // setPacked/removeInventory, setLogistics); gated can('show-prep','edit'); the
  // pane re-renders in place after each write (refreshThenRerender). Mirrors the
  // legacy openShowStaffingModal / openShowInventoryModal / editShowLogistics.
  function renderPrepPane(UI, s) {
    var id = s._key || s.id, jid = "'" + id + "'";
    var prep = s.prep || {};
    var ed = canEdit();
    var out = '';

    // ── Staffing ──
    var staffing = prep.staffing || {};
    var staffKeys = Object.keys(staffing);
    var staffBody;
    if (!staffKeys.length) {
      staffBody = '<span class="mu-sub">No staff assigned yet.</span>';
    } else {
      var staffCols = [
        { label: 'Name', render: function (r) { return esc(r.name || 'Unknown'); } },
        { label: 'Role', render: function (r) {
            var role = (r.showRole || 'support');
            var tone = role === 'lead' ? 'teal' : role === 'driver' ? 'info' : 'neutral';
            return UI.badge(role.charAt(0).toUpperCase() + role.slice(1), tone);
        } }
      ];
      if (ed) staffCols.push({ label: '', align: 'right', render: function (r) {
        return '<button class="btn btn-small btn-secondary" onclick="ShowsV2.staffRemove(' + jid + ',\'' + esc(r._uid) + '\')">Remove</button>';
      } });
      staffBody = UI.relatedTable(staffCols, staffKeys.map(function (uid) { return Object.assign({ _uid: uid }, staffing[uid]); }));
    }
    // Assign-staff inline form (only members not already assigned + non-guest).
    if (ed) {
      var avail = Object.keys(teamMembers()).filter(function (uid) {
        return !staffing[uid] && teamMembers()[uid] && teamMembers()[uid].role !== 'guest';
      }).map(function (uid) { var u = teamMembers()[uid]; return { uid: uid, name: u.name || u.email || uid }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (avail.length) {
        var memberOpts = avail.map(function (u) { return '<option value="' + esc(u.uid) + '">' + esc(u.name) + '</option>'; }).join('');
        staffBody += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' +
          '<div style="flex:1;min-width:150px;"><label class="form-label">Team member</label><select class="form-input" id="showV2StaffUid" style="width:100%;">' + memberOpts + '</select></div>' +
          '<div style="flex:1;min-width:130px;"><label class="form-label">Role at show</label><select class="form-input" id="showV2StaffRole" style="width:100%;">' +
            '<option value="lead">Lead (runs the booth)</option><option value="support" selected>Support (assists)</option><option value="driver">Driver (logistics)</option>' +
          '</select></div>' +
          '<button class="btn btn-primary btn-small" onclick="ShowsV2.staffAdd(' + jid + ')">Assign</button>' +
        '</div>';
      } else if (Object.keys(teamMembers()).length) {
        staffBody += '<div class="mu-sub" style="margin-top:10px;">All eligible team members are already assigned.</div>';
      }
    }
    out += UI.cardTable('Staffing', staffBody);

    // ── Inventory pull list ──
    var inventory = prep.inventory || {};
    var invKeys = Object.keys(inventory);
    var invBody = '';
    if (invKeys.length) {
      var packedCount = invKeys.filter(function (k) { return inventory[k].packed; }).length;
      var invCols = [
        { label: 'Item', render: function (r) {
            var meta = [];
            if (r.notes) meta.push(esc(r.notes));
            if (r.linkedMakeJob) meta.push('🔗 ' + esc(r.linkedMakeJob));
            return '<div style="font-weight:500;">' + esc(r.name || 'Unnamed Item') + '</div>' +
              (meta.length ? '<div class="mu-sub">' + meta.join(' · ') + '</div>' : '');
        } },
        { label: 'Qty', align: 'right', render: function (r) { return r.quantity != null ? esc(r.quantity) : '—'; } },
        { label: 'Packed', render: function (r) {
            if (!ed) return r.packed ? UI.badge('Packed', 'success') : UI.badge('Not packed', 'neutral');
            return '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;">' +
              '<input type="checkbox"' + (r.packed ? ' checked' : '') + ' onchange="ShowsV2.invPacked(' + jid + ',\'' + esc(r._itemId) + '\',this.checked)"> Packed</label>';
        } }
      ];
      if (ed) invCols.push({ label: '', align: 'right', render: function (r) {
        return '<button class="btn btn-small btn-secondary" onclick="ShowsV2.invEdit(' + jid + ',\'' + esc(r._itemId) + '\')">Edit</button> ' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.invRemove(' + jid + ',\'' + esc(r._itemId) + '\')">Remove</button>';
      } });
      invBody = '<div class="mu-sub" style="margin-bottom:6px;">' + N.count(packedCount) + ' of ' + N.count(invKeys.length) + ' items packed</div>' +
        UI.relatedTable(invCols, invKeys.map(function (k) { return Object.assign({ _itemId: k }, inventory[k]); }));
    } else {
      invBody = '<span class="mu-sub">No items in pull list yet.</span>';
    }
    var invAdd = ed ? '<button class="btn btn-small btn-secondary" onclick="ShowsV2.invAdd(' + jid + ')">+ Add item</button>' : '';
    out += UI.card('Inventory pull list', invBody, { headerRight: invAdd });

    // ── Logistics ──
    var logistics = prep.logistics || {};
    var logPairs = [];
    if (logistics.boothSize) logPairs.push({ k: 'Booth size', v: esc(logistics.boothSize) });
    if (logistics.setupTime) logPairs.push({ k: 'Setup time', v: esc(logistics.setupTime) });
    if (logistics.teardownTime) logPairs.push({ k: 'Teardown time', v: esc(logistics.teardownTime) });
    if (logistics.parkingNotes) logPairs.push({ k: 'Parking / load-in', v: esc(logistics.parkingNotes) });
    if (logistics.hotelNotes) logPairs.push({ k: 'Hotel / accommodation', v: esc(logistics.hotelNotes) });
    if (logistics.travelNotes) logPairs.push({ k: 'Travel notes', v: esc(logistics.travelNotes) });
    var logBody;
    if (!logPairs.length && !logistics.notes) {
      logBody = '<span class="mu-sub">No logistics details yet.</span>';
    } else {
      logBody = (logPairs.length ? UI.kv(logPairs) : '') +
        (logistics.notes ? '<div style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(logistics.notes) + '</div>' : '');
    }
    var logEdit = ed ? '<button class="btn btn-small btn-secondary" onclick="ShowsV2.logEdit(' + jid + ')">Edit</button>' : '';
    out += UI.card('Logistics', logBody, { headerRight: logEdit });
    return out;
  }

  // Inline inventory-item editor (add or edit) — mirrors openShowInventoryModal.
  function inventoryForm(s, itemId) {
    var id = s._key || s.id, jid = "'" + id + "'";
    var item = (itemId && s.prep && s.prep.inventory && s.prep.inventory[itemId]) || {};
    var inner =
      fgRow('Item name *', '<input class="form-input" id="showV2InvName" value="' + esc(item.name || '') + '" style="width:100%;" placeholder="e.g. Blue Hollow Bird">') +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:120px;">' + fgRow('Quantity', '<input class="form-input" type="number" min="1" id="showV2InvQty" value="' + esc(item.quantity != null ? item.quantity : '') + '" style="width:100%;">') + '</div>' +
        '<div style="flex:1;min-width:120px;">' + fgRow('Link to Make job', '<input class="form-input" id="showV2InvJob" value="' + esc(item.linkedMakeJob || '') + '" style="width:100%;" placeholder="Job name or ID">') + '</div>' +
      '</div>' +
      fgRow('Notes', '<textarea class="form-input" id="showV2InvNotes" rows="2" style="width:100%;resize:vertical;">' + esc(item.notes || '') + '</textarea>') +
      formButtons('ShowsV2.invSave(' + jid + ',' + (itemId ? '\'' + esc(itemId) + '\'' : 'null') + ')', 'ShowsV2.prepCancel(' + jid + ')', itemId ? 'Save item' : 'Add item');
    return U.card(itemId ? 'Edit inventory item' : 'New inventory item', inner);
  }

  // Inline logistics editor — mirrors editShowLogistics (singleton full replace).
  function logisticsForm(s) {
    var id = s._key || s.id, jid = "'" + id + "'";
    var lg = (s.prep && s.prep.logistics) || {};
    var inner =
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:130px;">' + fgRow('Booth size', '<input class="form-input" id="showV2LogBooth" value="' + esc(lg.boothSize || '') + '" style="width:100%;" placeholder="e.g. 10x10">') + '</div>' +
        '<div style="flex:1;min-width:130px;">' + fgRow('Setup time', '<input class="form-input" id="showV2LogSetup" value="' + esc(lg.setupTime || '') + '" style="width:100%;" placeholder="e.g. 7:00 AM">') + '</div>' +
        '<div style="flex:1;min-width:130px;">' + fgRow('Teardown time', '<input class="form-input" id="showV2LogTeardown" value="' + esc(lg.teardownTime || '') + '" style="width:100%;" placeholder="e.g. 6:00 PM">') + '</div>' +
      '</div>' +
      fgRow('Parking / load-in notes', '<textarea class="form-input" id="showV2LogParking" rows="2" style="width:100%;resize:vertical;">' + esc(lg.parkingNotes || '') + '</textarea>') +
      fgRow('Hotel / accommodation', '<textarea class="form-input" id="showV2LogHotel" rows="2" style="width:100%;resize:vertical;">' + esc(lg.hotelNotes || '') + '</textarea>') +
      fgRow('Travel notes', '<textarea class="form-input" id="showV2LogTravel" rows="2" style="width:100%;resize:vertical;">' + esc(lg.travelNotes || '') + '</textarea>') +
      fgRow('General notes', '<textarea class="form-input" id="showV2LogNotes" rows="3" style="width:100%;resize:vertical;">' + esc(lg.notes || '') + '</textarea>') +
      formButtons('ShowsV2.logSave(' + jid + ')', 'ShowsV2.prepCancel(' + jid + ')', 'Save logistics');
    return U.card('Show logistics', inner);
  }

  // Execute — day-of sales log, inventory reconciliation, show notes (writeable,
  // PR4). For a MULTI-day show (startDate≠endDate) a day-picker scopes the sales
  // + notes to the selected date (V2.execDate), exactly like the legacy execute
  // view's data-selected-date; sales/notes write that date through the bridge.
  // Single-day shows write the bridge's no-date/_default path. Tallies recompute
  // in-pane (the SO total is whole-show; the picked day's total shows per-day).
  function renderExecutePane(UI, s) {
    var id = s._key || s.id, jid = "'" + id + "'";
    var exec = s.execute || {};
    var multiDay = isMultiDay(s);
    var ed = canEdit();
    var sales = exec.sales || {};
    var out = '';

    // Resolve the active day for multi-day shows (default = today if in-range,
    // else the first show day). Persisted on V2.execDate across pane re-renders.
    var dates = getShowDates(s);
    var activeDate = null;
    if (multiDay) {
      if (V2.execDate && dates.indexOf(V2.execDate) >= 0) activeDate = V2.execDate;
      else { activeDate = dates.indexOf(V2.today) >= 0 ? V2.today : (dates[0] || null); V2.execDate = activeDate; }
    }

    // Day-picker bar (multi-day only).
    if (multiDay && dates.length) {
      var pills = dates.map(function (dt) {
        var on = dt === activeDate;
        var lbl = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        var dayCount = Object.keys(sales[dt] || {}).length;
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ShowsV2.execDay(' + jid + ',\'' + dt + '\')">' +
          esc(lbl) + (dayCount ? ' <span class="mu-sub">(' + dayCount + ')</span>' : '') + '</button>';
      }).join(' ');
      out += UI.card('Show day', '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + pills + '</div>');
    }

    // Sales for the active day (multi) or the flat single-day set.
    var daySales = [];
    if (multiDay) {
      var ds = (activeDate && sales[activeDate]) || {};
      Object.keys(ds).forEach(function (k) { daySales.push(Object.assign({ _key: k }, ds[k])); });
    } else {
      Object.keys(sales).forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return; // skip stray date sub-keys
        daySales.push(Object.assign({ _key: k }, sales[k]));
      });
    }
    daySales.sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });

    var salesBody;
    if (!daySales.length) {
      salesBody = '<span class="mu-sub">No sales recorded' + (multiDay ? ' for this day' : '') + ' yet.</span>';
    } else {
      var dayCents = daySales.reduce(function (sum, sl) { return sum + (sl.priceCents || 0); }, 0);
      var stat = UI.tiles([
        { k: multiDay ? 'Day revenue' : 'Revenue', v: N.money(N.moneyVal({ totalCents: dayCents }, 'totalCents', null)) || '—', hero: true },
        { k: 'Sales', v: N.count(daySales.length) }
      ]);
      var salesCols = [
        { label: 'Item', render: function (sl) {
            var time = sl.timestamp ? new Date(sl.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
            return '<div style="font-weight:500;">' + esc(sl.description || 'Sale') + '</div>' +
              (time ? '<div class="mu-sub">' + esc(time) + '</div>' : '');
        } },
        { label: 'Method', render: function (sl) {
            if (!sl.paymentMethod) return '<span class="mu-sub">—</span>';
            var tone = sl.paymentMethod === 'cash' ? 'success' : sl.paymentMethod === 'card' ? 'info' : sl.paymentMethod === 'square' ? 'teal' : 'neutral';
            return UI.badge(sl.paymentMethod.charAt(0).toUpperCase() + sl.paymentMethod.slice(1), tone);
        } },
        { label: 'Amount', align: 'right', render: function (sl) { return N.money(N.moneyVal(sl, 'priceCents', null)) || '—'; } }
      ];
      if (ed) salesCols.push({ label: '', align: 'right', render: function (sl) {
        return '<button class="btn btn-small btn-secondary" onclick="ShowsV2.saleEdit(' + jid + ',\'' + esc(sl._key) + '\')">Edit</button> ' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.saleRemove(' + jid + ',\'' + esc(sl._key) + '\')">Remove</button>';
      } });
      salesBody = stat + UI.relatedTable(salesCols, daySales);
    }
    var saleAdd = ed ? '<button class="btn btn-small btn-secondary" onclick="ShowsV2.saleAdd(' + jid + ')">+ Record sale</button>' : '';
    out += UI.card('Sales log' + (multiDay && activeDate ? ' — ' + esc(new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) : ''), salesBody, { headerRight: saleAdd });

    // ── Inventory reconciliation (per packed prep item: sold/returned/damaged/gifted) ──
    var prepInventory = (s.prep && s.prep.inventory) || {};
    var reconciliation = exec.reconciliation || {};
    var prepKeys = Object.keys(prepInventory).filter(function (k) { return prepInventory[k].packed; });
    var reconBody;
    if (!Object.keys(prepInventory).length) {
      reconBody = '<span class="mu-sub">No prep inventory items to reconcile.</span>';
    } else if (!prepKeys.length) {
      reconBody = '<span class="mu-sub">No packed items to reconcile yet.</span>';
    } else {
      function reconCell(itemId, field, count) {
        if (!ed) return N.count(count || 0);
        return '<div style="display:inline-flex;align-items:center;gap:5px;">' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.recon(' + jid + ',\'' + esc(itemId) + '\',\'' + field + '\',-1)" aria-label="decrease">−</button>' +
          '<span style="min-width:18px;text-align:center;display:inline-block;">' + N.count(count || 0) + '</span>' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.recon(' + jid + ',\'' + esc(itemId) + '\',\'' + field + '\',1)" aria-label="increase">+</button></div>';
      }
      reconBody = UI.relatedTable([
        { label: 'Item', render: function (r) { return esc(r.name || 'Item'); } },
        { label: 'Brought', align: 'right', render: function (r) { return N.count(r.quantity || 1); } },
        { label: 'Sold', align: 'right', render: function (r) { return reconCell(r._itemId, 'sold', r._recon.sold); } },
        { label: 'Returned', align: 'right', render: function (r) { return reconCell(r._itemId, 'returned', r._recon.returned); } },
        { label: 'Damaged', align: 'right', render: function (r) { return reconCell(r._itemId, 'damaged', r._recon.damaged); } },
        { label: 'Gifted', align: 'right', render: function (r) { return reconCell(r._itemId, 'gifted', r._recon.gifted); } }
      ], prepKeys.map(function (k) { return Object.assign({ _itemId: k, _recon: reconciliation[k] || {} }, prepInventory[k]); }));
    }
    out += UI.cardTable('Inventory reconciliation', reconBody);

    // ── Show notes (single-day: notes._default/string; multi-day: per active day) ──
    var notes = exec.notes || {};
    var curNotes = multiDay ? (notes[activeDate] || '') : (typeof notes === 'string' ? notes : (notes._default || ''));
    var notesBody;
    if (ed) {
      notesBody = '<textarea class="form-input" id="showV2Notes" rows="5" style="width:100%;resize:vertical;" placeholder="Weather, foot traffic, booth neighbors, lessons learned…">' + esc(curNotes) + '</textarea>' +
        '<div style="margin-top:8px;"><button class="btn btn-primary btn-small" onclick="ShowsV2.notesSave(' + jid + ')">Save notes</button></div>';
    } else {
      notesBody = curNotes
        ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(curNotes) + '</div>'
        : '<span class="mu-sub">No notes yet.</span>';
    }
    out += UI.card('Show notes' + (multiDay && activeDate ? ' — ' + esc(new Date(activeDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) : ''), notesBody);
    return out;
  }

  // Inline sale editor (add or edit) — mirrors openShowSaleModal. Writes the
  // active day (multi) or the no-date path (single) via ShowsBridge.upsertSale.
  function saleForm(s, saleId) {
    var id = s._key || s.id, jid = "'" + id + "'";
    var multiDay = isMultiDay(s);
    var sales = (s.execute && s.execute.sales) || {};
    var existing = null;
    if (saleId) existing = multiDay ? (V2.execDate && sales[V2.execDate] && sales[V2.execDate][saleId]) : sales[saleId];
    var sale = existing || {};
    var methodOpts = ['cash', 'card', 'square'].map(function (m) {
      return '<option value="' + m + '"' + (sale.paymentMethod === m ? ' selected' : '') + '>' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>';
    }).join('');
    var prodOpts = '<option value="">— None —</option>' + productList().filter(function (p) { return p && p.name; }).map(function (p) {
      return '<option value="' + esc(p.pid || '') + '"' + (sale.linkedProductId === p.pid ? ' selected' : '') + '>' + esc(p.name || p.pid) + '</option>';
    }).join('');
    var defaultTime = sale.timestamp ? new Date(sale.timestamp).toTimeString().slice(0, 5) : new Date().toTimeString().slice(0, 5);
    var inner =
      fgRow('Item description *', '<input class="form-input" id="showV2SaleDesc" value="' + esc(sale.description || '') + '" style="width:100%;" placeholder="e.g. Blue Hollow Bird, Cup set of 4">') +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:120px;">' + fgRow('Sale price ($) *', '<input class="form-input" type="number" step="0.01" min="0" id="showV2SalePrice" value="' + (sale.priceCents ? (sale.priceCents / 100).toFixed(2) : '') + '" style="width:100%;" placeholder="25.00">') + '</div>' +
        '<div style="flex:1;min-width:120px;">' + fgRow('Payment method', '<select class="form-input" id="showV2SaleMethod" style="width:100%;">' + methodOpts + '</select>') + '</div>' +
        '<div style="flex:1;min-width:110px;">' + fgRow('Time', '<input class="form-input" type="time" id="showV2SaleTime" value="' + esc(defaultTime) + '" style="width:100%;">') + '</div>' +
      '</div>' +
      fgRow('Link to product (optional)', '<select class="form-input" id="showV2SaleProduct" style="width:100%;">' + prodOpts + '</select>') +
      formButtons('ShowsV2.saleSave(' + jid + ',' + (saleId ? '\'' + esc(saleId) + '\'' : 'null') + ')', 'ShowsV2.execCancel(' + jid + ')', saleId ? 'Save sale' : 'Record sale');
    return U.card(saleId ? 'Edit sale' : 'Record sale', inner);
  }

  // History — post-show summary + P&L (booth/jury fees + expenses vs revenue) + review.
  function renderHistoryPane(UI, s) {
    var exec = s.execute || {};
    var historyData = s.history || {};
    var multiDay = isMultiDay(s);
    var endDate = s.endDate || s.startDate;
    var showEnded = endDate && endDate < V2.today;
    var out = '';

    // Tally revenue + reconciliation across the whole show.
    var sales = exec.sales || {};
    var totalRevenueCents = 0, totalSalesCount = 0;
    if (multiDay) {
      getShowDates(s).forEach(function (dt) {
        var ds = sales[dt] || {};
        Object.keys(ds).forEach(function (k) { totalRevenueCents += (ds[k].priceCents || 0); totalSalesCount++; });
      });
    } else {
      Object.keys(sales).forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
        totalRevenueCents += (sales[k].priceCents || 0); totalSalesCount++;
      });
    }
    var reconciliation = exec.reconciliation || {};
    var totalItemsSold = 0;
    Object.keys(reconciliation).forEach(function (k) { totalItemsSold += (reconciliation[k].sold || 0); });

    // Post-show summary
    if (!showEnded) {
      out += UI.card('Post-show summary',
        '<span class="mu-sub">Summary will be available after the show ends' + (endDate ? ' (' + esc(fmtDate(endDate)) + ')' : '') + '.</span>');
    } else if (!totalSalesCount && !totalItemsSold) {
      out += UI.card('Post-show summary', '<span class="mu-sub">No sales or reconciliation data recorded for this show.</span>');
    } else {
      out += '<div style="margin-bottom:14px;">' + UI.tiles([
        { k: 'Total revenue', v: N.money(N.moneyVal({ totalCents: totalRevenueCents }, 'totalCents', null)) || '—', hero: true },
        { k: 'Total sales', v: N.count(totalSalesCount) },
        { k: 'Items sold', v: N.count(totalItemsSold) }
      ]) + '</div>';
    }

    // Profit & Loss — revenue − (booth fee + jury fee + additional expenses).
    var boothFeeCents = s.boothFee || 0;
    var juryFeeCents = s.juryFee || 0;
    var expenses = historyData.expenses || {};
    var expenseKeys = Object.keys(expenses);
    var additionalCents = 0;
    expenseKeys.forEach(function (k) { additionalCents += (expenses[k].amountCents || 0); });
    var totalCostsCents = boothFeeCents + juryFeeCents + additionalCents;
    var plRevenue = showEnded ? totalRevenueCents : 0;
    var netCents = plRevenue - totalCostsCents;
    var roi = totalCostsCents > 0 ? ((netCents / totalCostsCents) * 100).toFixed(1) : null;

    function plRow(label, cents, kind) {
      var amt = N.money(N.moneyVal({ c: cents }, 'c', null)) || '—';
      var sign = kind === 'cost' ? '−' : '';
      var tone = kind === 'cost' ? 'var(--danger)' : 'var(--success, var(--teal))';
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));font-size:0.85rem;">' +
        '<span>' + esc(label) + '</span>' +
        '<span style="font-weight:600;color:' + tone + ';">' + sign + amt + '</span>' +
      '</div>';
    }
    var plBody = plRow('Revenue', plRevenue, 'revenue');
    if (boothFeeCents) plBody += plRow('Booth fee', boothFeeCents, 'cost');
    if (juryFeeCents) plBody += plRow('Jury fee', juryFeeCents, 'cost');
    expenseKeys.forEach(function (k) { plBody += plRow(expenses[k].description || 'Expense', expenses[k].amountCents || 0, 'cost'); });
    var netTone = netCents >= 0 ? 'var(--success, var(--teal))' : 'var(--danger)';
    plBody += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:10px 0 0;border-top:2px solid var(--cream-dark,rgba(127,127,127,.28));">' +
      '<div><div style="font-weight:700;color:' + netTone + ';">' + (netCents >= 0 ? 'Profit' : 'Loss') + ': ' +
        (N.money(N.moneyVal({ c: Math.abs(netCents) }, 'c', null)) || '—') + '</div>' +
        '<div class="mu-sub">ROI: ' + (roi == null ? '—' : roi + '%') + '</div></div>' +
      '<div class="mu-sub">Costs: ' + (N.money(N.moneyVal({ c: totalCostsCents }, 'c', null)) || '—') + '</div>' +
    '</div>';
    out += UI.card('Profit & loss', plBody);

    // ── Expenses ledger (writeable, PR4) — add/remove additional show expenses
    // (amountCents) via ShowsBridge.upsertExpense/removeExpense. Booth/jury fees
    // are NOT here (they're show-level fields) — only "additional" expenses.
    var id = s._key || s.id, jid = "'" + id + "'";
    var ed = canEdit();
    var expBody;
    if (!expenseKeys.length) {
      expBody = '<span class="mu-sub">No additional expenses recorded.</span>';
    } else {
      var expCols = [
        { label: 'Description', render: function (e) { return esc(e.description || 'Expense'); } },
        { label: 'Amount', align: 'right', render: function (e) { return N.money(N.moneyVal(e, 'amountCents', null)) || '—'; } }
      ];
      if (ed) expCols.push({ label: '', align: 'right', render: function (e) {
        return '<button class="btn btn-small btn-secondary" onclick="ShowsV2.expRemove(' + jid + ',\'' + esc(e._key) + '\')">Remove</button>';
      } });
      expBody = UI.relatedTable(expCols, expenseKeys.map(function (k) { return Object.assign({ _key: k }, expenses[k]); }));
    }
    if (ed) {
      expBody += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' +
        '<div style="flex:2;min-width:160px;"><label class="form-label">Description</label><input class="form-input" id="showV2ExpDesc" style="width:100%;" placeholder="e.g. Gas, Parking, Supplies"></div>' +
        '<div style="flex:1;min-width:110px;"><label class="form-label">Amount ($)</label><input class="form-input" type="number" step="0.01" min="0" id="showV2ExpAmt" style="width:100%;" placeholder="25.00"></div>' +
        '<button class="btn btn-primary btn-small" onclick="ShowsV2.expAdd(' + jid + ')">Add expense</button>' +
      '</div>';
    }
    out += UI.card('Additional expenses', expBody);

    // ── Show review (writeable, PR4) — rating / would-attend-again / best
    // sellers / lessons learned via ShowsBridge.setReview (singleton, full replace).
    var review = historyData.review || {};
    var reviewBody;
    if (ed) {
      var rating = review.rating || 0;
      var stars = '';
      for (var i = 1; i <= 5; i++) {
        stars += '<button type="button" class="showV2-star" data-value="' + i + '" onclick="ShowsV2.reviewStar(' + i + ')" ' +
          'style="font-size:1.6rem;cursor:pointer;background:none;border:none;padding:0 2px;color:' + (i <= rating ? 'var(--amber)' : 'var(--warm-gray)') + ';">★</button>';
      }
      var attendBtns = ['yes', 'maybe', 'no'].map(function (val) {
        var lbl = val.charAt(0).toUpperCase() + val.slice(1);
        var on = review.wouldAttendAgain === val;
        return '<button type="button" class="btn btn-small showV2-attend ' + (on ? 'btn-primary' : 'btn-secondary') + '" data-value="' + val + '" onclick="ShowsV2.reviewAttend(\'' + val + '\')">' + lbl + '</button>';
      }).join(' ');
      reviewBody =
        fgRow('Rating', '<div id="showV2ReviewStars" style="display:flex;gap:2px;">' + stars + '</div><input type="hidden" id="showV2ReviewRating" value="' + rating + '">') +
        fgRow('Would attend again', '<div id="showV2ReviewAttend" style="display:flex;gap:6px;">' + attendBtns + '</div><input type="hidden" id="showV2ReviewAttendVal" value="' + esc(review.wouldAttendAgain || '') + '">') +
        fgRow('Best sellers', '<textarea class="form-input" id="showV2ReviewBest" rows="3" style="width:100%;resize:vertical;" placeholder="What sold best? What got the most attention?">' + esc(review.bestSellers || '') + '</textarea>') +
        fgRow('Lessons learned', '<textarea class="form-input" id="showV2ReviewLessons" rows="3" style="width:100%;resize:vertical;" placeholder="What would you do differently? Any surprises?">' + esc(review.lessonsLearned || '') + '</textarea>') +
        '<div style="margin-top:8px;"><button class="btn btn-primary btn-small" onclick="ShowsV2.reviewSave(' + jid + ')">Save review</button></div>';
    } else if (!review.rating && !review.wouldAttendAgain && !review.bestSellers && !review.lessonsLearned) {
      reviewBody = '<span class="mu-sub">No review yet.</span>';
    } else {
      var rPairs = [];
      if (review.rating) {
        var st = '';
        for (var j = 1; j <= 5; j++) st += (j <= review.rating ? '★' : '☆');
        rPairs.push({ k: 'Rating', v: '<span style="color:var(--amber);">' + st + '</span>' });
      }
      if (review.wouldAttendAgain) {
        var attendLabels = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
        var attendTone = review.wouldAttendAgain === 'yes' ? 'success' : review.wouldAttendAgain === 'maybe' ? 'warning' : 'danger';
        rPairs.push({ k: 'Would attend again', v: UI.badge(attendLabels[review.wouldAttendAgain] || review.wouldAttendAgain, attendTone) });
      }
      reviewBody = (rPairs.length ? UI.kv(rPairs) : '') +
        (review.bestSellers ? '<div style="margin-top:8px;"><div class="mu-sub" style="margin-bottom:4px;">Best sellers</div><div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(review.bestSellers) + '</div></div>' : '') +
        (review.lessonsLearned ? '<div style="margin-top:8px;"><div class="mu-sub" style="margin-bottom:4px;">Lessons learned</div><div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(review.lessonsLearned) + '</div></div>' : '');
    }
    out += UI.card('Show review', reviewBody);
    return out;
  }

  // External link (mirrors the legacy <a target=_blank> — teal token, no raw hex).
  function linkOut(href, label) {
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener" style="color:var(--teal);">' + esc(label) + '</a>';
  }

  // Small form-control helpers for the in-pane sub-editors (mirror students-v2).
  function fgRow(label, inner) { return '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
  function formButtons(saveCall, cancelCall, saveLabel) {
    return '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-primary btn-small" onclick="' + saveCall + '">' + esc(saveLabel || 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="' + cancelCall + '">Cancel</button></div>';
  }
  function dollarsToCents(v) { var f = parseFloat(v); return (isNaN(f) || f < 0) ? null : Math.round(f * 100); }

  // ── module state + data ─────────────────────────────────────────────
  // execDate = the day-picker selection for a MULTI-day show's Execute pane
  // (per-record; reset when a record opens). team / products feed the staffing +
  // linked-product editors (loaded lazily on first detail open).
  var V2 = { rows: [], byId: {}, today: todayStr(), sortKey: 'name', sortDir: 'asc', q: '', lens: 'apply', loaded: false, current: null,
             execDate: null, team: null, products: null,
             // Find lens (PR5): the live /showFinder result set + per-card UI state.
             // finderResults = the raw show objects from the CF; finderState[idx] =
             // 'added' once a card's "Add to pipeline" has written, so the re-render
             // can show an Added badge instead of the button. finderBusy guards a
             // double-submit while the CF is in flight.
             finderResults: [], finderState: {}, finderBusy: false, finderError: null, finderSearched: false,
             // AI Application Builder (PR6): a native 6-step wizard launched from the
             // Apply lens. ai.active flips the Apply lens from the pipeline list to the
             // builder; ai.step 0 = select-show, 1..5 = the wizard steps. The state
             // mirrors the legacy showsAI* module vars 1:1 (parsed requirements /
             // profile→field mapping / gap list / slotIdx→imageId assignments /
             // resumed-draft record / sequential copy cursor). aiBusy guards the
             // in-flight /studioAssistant CF; aiProfile + aiApplications are loaded
             // once from showLight/* on first entry.
             ai: { active: false, step: 0, showId: null, parsed: null, mapping: null, gaps: null,
                   images: {}, currentApp: null, copyIdx: -1, busy: false,
                   profile: null, applications: null, loaded: false, loading: false } };

  // Lazily load the assignable team members (admin users, non-guest) the way the
  // legacy openShowStaffingModal does — MastDB.adminUsers.get() → { uid: {name,
  // email, role} }. Cached on V2.team. Products feed the optional linked-product
  // picker in the sale editor (window.productsData is populated once the legacy
  // shows module's products listener fires; fall back to a direct read).
  function ensureTeam() {
    if (V2.team) return Promise.resolve(V2.team);
    return Promise.resolve(MastDB.adminUsers.get()).then(function (m) { V2.team = m || {}; return V2.team; })
      .catch(function () { V2.team = {}; return V2.team; });
  }
  function teamMembers() { return V2.team || {}; }
  function ensureProducts() {
    if (Array.isArray(window.productsData) && window.productsData.length) { V2.products = window.productsData; return Promise.resolve(V2.products); }
    if (V2.products) return Promise.resolve(V2.products);
    return Promise.resolve(MastDB.products.list()).then(function (map) {
      map = map || {};
      V2.products = Object.keys(map).map(function (pid) { return Object.assign({ pid: pid }, map[pid]); });
      return V2.products;
    }).catch(function () { V2.products = []; return V2.products; });
  }
  function productList() { return (Array.isArray(window.productsData) && window.productsData.length) ? window.productsData : (V2.products || []); }

  // Re-fetch a single show record after a ShowsBridge sub-write (the bridge
  // writes to Firestore directly and returns an id/void — it does NOT hand back
  // the mutated subtree), patch the live cache, then re-render the affected
  // pane(s) in place. Lighter than reloadThenOpen (no slide-out re-open) so the
  // pane-tab + scroll position survive a staffing/inventory/sale edit.
  function refreshThenRerender(id, panes) {
    return Promise.resolve(MastDB.shows.get(id)).then(function (s) {
      if (s && typeof s === 'object') {
        var rec = Object.assign(V2.byId[id] || { _key: id }, s, { _key: id });
        rec.applicationStatus = rec.applicationStatus || 'considering';
        V2.byId[id] = rec;
      }
      (panes || []).forEach(function (key) { rerenderPaneFor(id, key); });
      return V2.byId[id];
    }).catch(function (e) { actionErr(e); });
  }
  function rerenderPaneFor(id, key) {
    var s = V2.byId[id]; if (!s) return;
    var inner = key === 'prep' ? renderPrepPane(U, s)
      : key === 'execute' ? renderExecutePane(U, s)
      : key === 'history' ? renderHistoryPane(U, s)
      : key === 'info' ? renderInfoPane(U, s) : '';
    rerenderPane(key, inner);
  }
  function rerenderPane(key, inner) {
    var body = document.getElementById('mastSlideOutBody');
    var el = body && body.querySelector('.mu-pane[data-pane="' + key + '"]');
    if (el) el.innerHTML = inner;
  }
  function curBridge() {
    var b = bridge();
    if (!b || !b.setStaffing) { bridgeLoading(); return null; }
    return b;
  }

  // Re-open the slide-out on the same record after a write (so the refreshed
  // status badge + action set + enriched fields render). Lets the legacy write
  // settle, refreshes the cache, re-renders the list, then re-opens. Mirrors
  // sales-events-v2's reloadThenOpen.
  function reloadThenOpen(id) {
    V2.loaded = false;
    setTimeout(function () {
      loadData().then(function () {
        render();
        var rec = V2.byId[id];
        if (rec) MastEntity.openRecord('shows-v2', rec, 'read');
      });
    }, 250);
  }

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { loadData().then(render); }
  function loadData() {
    V2.today = todayStr();
    // Ensure the legacy Shows module is loaded so window.ShowsBridge (the future
    // delegated write path) exists — mirrors classes-v2 / orders-v2. Reads come
    // from MastDB.shows directly so the twin works even before the listener fires.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('shows'); } catch (e) {} }
    return Promise.resolve(MastDB.shows.list(200)).catch(function () { return {}; }).then(function (snap) {
      var map = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : (snap || {});
      var out = [];
      Object.keys(map).forEach(function (k) {
        var s = map[k];
        if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.applicationStatus = s.applicationStatus || 'considering'; out.push(s); }
      });
      // Default sort matches the legacy list (newest createdAt first); the entity
      // list re-sorts by the active column when the user clicks a header.
      out.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true;
    }).catch(function (e) { console.error('[shows-v2] load', e); });
  }

  function visibleRows() {
    var rows = V2.rows.filter(function (s) { return inLens(s, V2.lens); });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return showName(s).toLowerCase().indexOf(q) >= 0 ||
               locationOf(s).toLowerCase().indexOf(q) >= 0 ||
               typeLabel(s).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('shows-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  // ── Find lens (PR5) — /showFinder AI discovery → add-to-pipeline ────
  // Mirrors the legacy runShowFinder / renderShowFinderResults / addShowToPipeline
  // (shows.js). The /showFinder CF call is a READ and stays here in the twin (like
  // the /showDeepDive enrich in PR3); the WRITE (add to pipeline) goes through
  // window.ShowsBridge.addFromFinder. The legacy did NOT dedupe — this twin DOES:
  // a result whose name+location+startDate already exists in the pipeline is marked
  // "Already in pipeline" with the Add button disabled.

  // Normalize for dedupe matching (case/space-insensitive name + state + start day).
  function finderKey(name, state, startDate) {
    return [String(name || '').trim().toLowerCase(), String(state || '').trim().toLowerCase(), String(startDate || '').trim()].join('|');
  }
  // True if a /showFinder result is already in the pipeline (V2.rows). Matches on
  // name + state + startDate (the fields a finder result carries); name-only match
  // counts too when neither has a startDate, to catch obvious dupes.
  function isInPipeline(result) {
    var rn = String((result && result.name) || '').trim().toLowerCase();
    if (!rn) return false;
    var rState = String((result && result.locationState) || '').trim().toLowerCase();
    var rStart = String((result && result.startDate) || '').trim();
    return V2.rows.some(function (s) {
      var sn = String((s && s.name) || '').trim().toLowerCase();
      if (sn !== rn) return false;
      var sState = String((s && s.locationState) || '').trim().toLowerCase();
      var sStart = String((s && s.startDate) || '').trim();
      // Same name + (same start date) OR (no start dates to compare) OR (same state).
      if (rStart && sStart) return rStart === sStart;
      if (!rStart && !sStart) return true;
      return rState && sState ? rState === sState : true;
    });
  }

  // Result-card fee/type/dates text (mirrors renderShowFinderResults — finder
  // results carry fees in CENTS, plus entryType / format / audienceProfile extras).
  function finderTypeLabel(r) {
    var entryLabel = r.entryType === 'juried' ? 'Juried' : r.entryType === 'open' ? 'Open' : '';
    var formatLabels = { market: 'Market', festival: 'Festival', 'pop-up': 'Pop-Up', trade: 'Trade Show', recurring: 'Recurring', other: 'Other' };
    var formatLabel = formatLabels[r.format] || r.format || '';
    return [entryLabel, formatLabel].filter(Boolean).join(' · ') || SHOW_TYPE_LABELS[r.type] || r.type || 'Other';
  }
  function finderFeesText(r) {
    var parts = [];
    if (r.boothFee) parts.push('Booth ' + (N.money(N.moneyVal({ c: r.boothFee }, 'c', null)) || ''));
    if (r.juryFee) parts.push('Jury ' + (N.money(N.moneyVal({ c: r.juryFee }, 'c', null)) || ''));
    return parts.join(' · ');
  }

  // The search criteria form (mirrors the legacy #showFindView field set).
  function finderForm() {
    function inp(id, label, attrs, placeholder) {
      return '<div style="flex:1;min-width:150px;"><label class="form-label">' + label + '</label>' +
        '<input class="form-input" id="' + id + '"' + (attrs || '') + ' style="width:100%;"' +
        (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></div>';
    }
    function sel(id, label, optsHtml) {
      return '<div style="flex:1;min-width:150px;"><label class="form-label">' + label + '</label>' +
        '<select class="form-input" id="' + id + '" style="width:100%;">' + optsHtml + '</select></div>';
    }
    function row(inner) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;">' + inner + '</div>'; }
    var entryOpts = '<option value="" selected>Any</option><option value="juried">Juried</option><option value="open">Open (no jury)</option>';
    var formatOpts = '<option value="" selected>Any</option>' +
      ['market', 'festival', 'pop-up', 'trade', 'recurring'].map(function (f) {
        var lbl = { market: 'Market', festival: 'Festival', 'pop-up': 'Pop-Up', trade: 'Trade Show', recurring: 'Recurring' }[f];
        return '<option value="' + f + '">' + lbl + '</option>';
      }).join('');
    var inner =
      '<div class="mu-sub" style="margin-bottom:12px;">AI-powered search for upcoming art &amp; craft shows. Search by name, location, or both.</div>' +
      row('<div style="flex:1;min-width:100%;"><label class="form-label">Show name</label>' +
        '<input class="form-input" id="showV2FinderName" style="width:100%;" placeholder="e.g. Paradise City Arts Festival"></div>') +
      row(
        inp('showV2FinderCity', 'City', '', 'e.g. Pittsburgh') +
        inp('showV2FinderState', 'State', ' maxlength="2"', 'e.g. PA') +
        inp('showV2FinderRadius', 'Search radius (miles)', ' type="number" min="1" max="500"', '50')
      ) +
      row(
        inp('showV2FinderMaxFee', 'Max booth fee ($)', ' type="number" min="0"', '500') +
        inp('showV2FinderDateStart', 'Shows after', ' type="date"', '') +
        inp('showV2FinderDateEnd', 'Shows before', ' type="date"', '')
      ) +
      row(
        sel('showV2FinderEntry', 'Entry type', entryOpts) +
        sel('showV2FinderFormat', 'Show format', formatOpts)
      ) +
      '<div style="margin-top:6px;">' +
        '<button class="btn btn-primary" id="showV2FinderBtn"' + (V2.finderBusy ? ' disabled' : '') +
          ' onclick="ShowsV2.findRun()">' + (V2.finderBusy ? 'Searching…' : 'Find shows') + '</button>' +
        (V2.finderResults.length || V2.finderSearched ? ' <button class="btn btn-secondary" onclick="ShowsV2.findClear()">Clear results</button>' : '') +
      '</div>';
    return U.card('Find shows', inner);
  }

  // Loading / error / results region (re-rendered in place on each finder action).
  function finderResultsRegion() {
    if (V2.finderBusy) {
      return U.card('Searching',
        '<div style="text-align:center;padding:30px 0;">' +
          '<div class="loading-spinner" style="margin:0 auto 12px;width:32px;height:32px;border:3px solid var(--cream-dark,rgba(127,127,127,.25));border-top-color:var(--teal);border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
          '<div class="mu-sub">Searching for shows… this may take a moment.</div>' +
        '</div>');
    }
    if (V2.finderError) {
      return U.card('Search', '<div class="mu-sub" style="color:var(--danger);">' + esc(V2.finderError) + '</div>');
    }
    if (!V2.finderResults.length) {
      if (V2.finderSearched) {
        return U.card('Results', '<span class="mu-sub">No shows found matching your criteria. Try broadening your search.</span>');
      }
      return '';
    }
    var n = V2.finderResults.length;
    var cards = V2.finderResults.map(function (r, idx) {
      return finderResultCard(r, idx);
    }).join('');
    return U.card(N.count(n) + ' show' + (n !== 1 ? 's' : '') + ' found', cards);
  }

  // A single ranked result card (name / location / dates / fees / fit-why + links +
  // Add-to-pipeline). Add gates on can('show-prep','edit'); dedupe disables it when
  // the show is already in the pipeline; once added, an Added badge replaces it.
  function finderResultCard(r, idx) {
    var loc = [r.locationCity, r.locationState].filter(Boolean).join(', ');
    var dates = '';
    if (r.startDate) { dates = fmtDate(r.startDate); if (r.endDate && r.endDate !== r.startDate) dates += ' – ' + fmtDate(r.endDate); }
    var fees = finderFeesText(r);
    var deadline = r.applicationDeadline ? 'Deadline ' + fmtDate(r.applicationDeadline) : '';
    var meta = [esc(finderTypeLabel(r))];
    if (loc) meta.push(esc(loc));
    if (dates) meta.push(esc(dates));
    if (fees) meta.push(fees);
    if (deadline) meta.push('<span class="mu-sub">' + esc(deadline) + '</span>');

    var body =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
        '<div style="font-weight:600;font-size:0.9rem;">' + esc(r.name || 'Unnamed Show') + '</div>' +
        U.badge('AI Found', 'teal') +
      '</div>' +
      '<div class="mu-sub" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 10px;">' + meta.join('<span>·</span>') + '</div>';

    // Fit / why this show (audienceProfile + notes from the CF) — mirrors the
    // legacy extra-details block.
    if (r.audienceProfile) body += '<div class="mu-sub" style="margin-top:8px;">' + esc(r.audienceProfile) + '</div>';
    if (r.notes) body += '<div class="mu-sub" style="margin-top:4px;font-style:italic;">' + esc(r.notes) + '</div>';

    // Links
    var links = [];
    if (r.websiteUrl) links.push(linkOut(r.websiteUrl, 'Website'));
    if (r.applicationUrl) links.push(linkOut(r.applicationUrl, 'Apply'));
    if (links.length) body += '<div style="margin-top:8px;font-size:0.78rem;">' + links.join(' · ') + '</div>';

    // Action row: Add to pipeline (gated + deduped) / Dismiss.
    var added = V2.finderState[idx] === 'added';
    var dupe = !added && isInPipeline(r);
    var actions = '';
    if (added) {
      actions = U.badge('Added to pipeline', 'success');
    } else if (dupe) {
      actions = '<button class="btn btn-small btn-secondary" disabled>Already in pipeline</button>';
    } else if (canEdit()) {
      actions = '<button class="btn btn-primary btn-small" onclick="ShowsV2.findAdd(' + idx + ')">+ Add to pipeline</button>';
    }
    actions += (added || actions ? ' ' : '') + '<button class="btn btn-secondary btn-small" onclick="ShowsV2.findDismiss(' + idx + ')">Dismiss</button>';

    body += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + actions + '</div>';
    return '<div style="padding:14px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' + body + '</div>';
  }

  // Render the whole Find lens into the tab (form + results region).
  function renderFindLens(tab, headerHtml, lensPills) {
    tab.innerHTML = headerHtml + lensPills +
      '<div id="showsV2FinderForm">' + finderForm() + '</div>' +
      '<div id="showsV2FinderResults">' + finderResultsRegion() + '</div>';
  }
  // Re-render only the form (to reflect the busy/clear button state) + results
  // region in place, without rebuilding the whole tab (keeps the form field values).
  function rerenderFinderResults() {
    var el = document.getElementById('showsV2FinderResults');
    if (el) el.innerHTML = finderResultsRegion();
    var formBtn = document.getElementById('showV2FinderBtn');
    if (formBtn) { formBtn.disabled = !!V2.finderBusy; formBtn.textContent = V2.finderBusy ? 'Searching…' : 'Find shows'; }
  }

  // ════════════════════════════════════════════════════════════════════
  // AI Application Builder (PR6) — native 6-step wizard, launched from the
  // Apply lens. Ports the legacy #show-apply AI mode (shows.js renderShowsAI*).
  // The /studioAssistant CF call (token-metered; 402 → coin purchase) stays in the
  // twin (a READ, like /showFinder + /showDeepDive); the three WRITES route through
  // window.ShowsBridge: setImageAppMeta (image tagging), saveProfile (gap backfill),
  // saveApplication (final draft save). All gate on can('show-prep','edit').
  // ════════════════════════════════════════════════════════════════════

  function imageLib() { return (typeof window !== 'undefined' && window.imageLibrary) || {}; }
  function productData() { return (Array.isArray(window.productsData) ? window.productsData : (V2.products || [])); }

  // Lazily load the studio profile + saved application drafts (showLight/profile +
  // showLight/applications) the way the legacy loadShowsAIProfile does. Cached on
  // V2.ai; reads only (no write). Resolves to the loaded state.
  function ensureAiData() {
    if (V2.ai.loaded) return Promise.resolve();
    if (V2.ai.loading) {
      return new Promise(function (resolve) {
        var iv = setInterval(function () { if (V2.ai.loaded) { clearInterval(iv); resolve(); } }, 100);
      });
    }
    V2.ai.loading = true;
    return Promise.all([
      Promise.resolve(MastDB.showLight.profile.get()).catch(function () { return {}; }),
      Promise.resolve(MastDB.showLight.applications.get()).catch(function () { return {}; })
    ]).then(function (res) {
      V2.ai.profile = res[0] || {};
      V2.ai.applications = res[1] || {};
      V2.ai.loaded = true; V2.ai.loading = false;
    }).catch(function () {
      V2.ai.profile = V2.ai.profile || {}; V2.ai.applications = V2.ai.applications || {};
      V2.ai.loaded = true; V2.ai.loading = false;
    });
  }
  function aiProfile() { return V2.ai.profile || {}; }
  function aiShow() { return V2.byId[V2.ai.showId] || {}; }

  // Token-wallet cost hint / suspended state (mirrors the legacy getTokenWallet read).
  function aiWallet() { return (typeof window.getTokenWallet === 'function') ? window.getTokenWallet() : { status: 'unknown' }; }
  function aiBuyCoins() { if (typeof window.openCoinPurchaseModal === 'function') window.openCoinPurchaseModal(); }

  // Render the whole builder into the Apply-lens tab (header + step body). Called
  // from render() when V2.ai.active. Step 0 = select-show; 1..5 = wizard steps.
  function renderAiBuilder(tab, headerHtml, lensPills) {
    tab.innerHTML = headerHtml + lensPills + '<div id="showsV2AiBody">' + aiBodyHtml() + '</div>';
  }
  // Re-render only the builder body in place (keeps the lens pills + header).
  function rerenderAiBody() {
    var el = document.getElementById('showsV2AiBody');
    if (el) el.innerHTML = aiBodyHtml();
  }
  function aiBodyHtml() {
    return V2.ai.step === 0 ? aiSelectShowHtml() : aiStepContainerHtml();
  }

  // Step 0 — pick an applyable show (application URL + non-terminal status) or
  // resume a saved draft. Mirrors renderShowsAISelectShow.
  function aiSelectShowHtml() {
    var applyable = V2.rows.filter(function (s) {
      var st = statusOf(s);
      return s.applicationUrl && (st === 'considering' || st === 'applied' || !s.applicationStatus);
    });
    var apps = V2.ai.applications || {};
    var appEntries = Object.keys(apps).map(function (k) { return [k, apps[k]]; });

    var body = '<div class="mu-sub" style="margin-bottom:14px;">AI Assist parses a show\'s application form, maps your vendor profile to the fields, assigns gallery images, and builds a ready-to-submit package.</div>';

    var showsCard;
    if (!applyable.length) {
      showsCard = '<span class="mu-sub">No shows with an application URL in Considering or Applied status. Add an application URL on a show, then come back.</span>' +
        '<div style="margin-top:10px;"><button class="btn btn-secondary btn-small" onclick="ShowsV2.aiExit()">Back to shows</button></div>';
    } else {
      showsCard = applyable.map(function (s) {
        var id = s._key || s.id;
        var deadline = '';
        if (s.applicationDeadline) {
          var daysUntil = Math.ceil((new Date(s.applicationDeadline + 'T00:00:00') - new Date()) / 86400000);
          if (daysUntil < 0) deadline = U.badge('Past due', 'danger');
          else if (daysUntil <= 14) deadline = U.badge(daysUntil + 'd left', 'warning');
          else deadline = '<span class="mu-sub">Due ' + esc(fmtDate(s.applicationDeadline)) + '</span>';
        }
        return '<div onclick="ShowsV2.aiStart(\'' + esc(id) + '\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' +
          '<div><div style="font-weight:600;">' + esc(showName(s)) + '</div>' + (deadline ? '<div style="margin-top:2px;">' + deadline + '</div>' : '') + '</div>' +
          '<span style="color:var(--teal);">→</span></div>';
      }).join('');
    }
    var out = body + U.card('Build application package', showsCard);

    if (appEntries.length) {
      var saved = appEntries.map(function (entry) {
        var id = entry[0], app = entry[1];
        var show = V2.byId[app.showId] || {};
        return '<div onclick="ShowsV2.aiResume(\'' + esc(id) + '\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' +
          '<div><div style="font-weight:600;">' + esc(showName(show) !== 'Unnamed Show' ? showName(show) : (app.showName || 'Unknown Show')) + '</div>' +
          '<div class="mu-sub">Saved ' + esc(app.updatedAt ? new Date(app.updatedAt).toLocaleDateString() : '') + '</div></div>' +
          U.badge(app.status || 'draft', 'neutral') + '</div>';
      }).join('');
      out += U.card('Saved packages', saved);
    }
    return out;
  }

  // The step container — back-to-list + progress bar + the active step body.
  // Mirrors renderShowsAIStepContainer (5 progress segments).
  var AI_STEPS = ['Fetch & Parse', 'Images', 'Auto-Map', 'Gap Analysis', 'Preview'];
  function aiStepContainerHtml() {
    var s = aiShow();
    var head = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<button class="btn btn-secondary btn-small" onclick="ShowsV2.aiBackToSelect()" title="Back to show list">←</button>' +
      '<div><span style="font-weight:600;font-size:1.15rem;">' + esc(showName(s)) + '</span>' +
      (s.applicationDeadline ? ' <span class="mu-sub">Deadline: ' + esc(fmtDate(s.applicationDeadline)) + '</span>' : '') +
      '</div></div>';

    var segs = AI_STEPS.map(function (label, i) {
      var stepNum = i + 1;
      var on = stepNum <= V2.ai.step;
      return '<div title="' + esc(label) + '" style="flex:1;height:4px;border-radius:2px;background:' + (on ? 'var(--teal)' : 'var(--cream-dark,rgba(127,127,127,.25))') + ';opacity:' + (on ? '1' : '0.5') + ';"></div>';
    }).join('');
    var bar = '<div style="display:flex;gap:4px;margin-bottom:18px;">' + segs + '</div>';

    var stepBody = '';
    switch (V2.ai.step) {
      case 1: stepBody = aiFetchHtml(s); break;
      case 2: stepBody = aiImagesHtml(s); break;
      case 3: stepBody = aiMapHtml(s); break;
      case 4: stepBody = aiGapsHtml(s); break;
      case 5: stepBody = aiPreviewHtml(s); break;
    }
    return head + bar + '<div id="showsV2AiStep">' + stepBody + '</div>';
  }
  // Re-render only the active step body (keeps the progress bar + header).
  function rerenderAiStep() {
    var el = document.getElementById('showsV2AiStep');
    if (!el) { rerenderAiBody(); return; }
    var s = aiShow();
    switch (V2.ai.step) {
      case 1: el.innerHTML = aiFetchHtml(s); break;
      case 2: el.innerHTML = aiImagesHtml(s); break;
      case 3: el.innerHTML = aiMapHtml(s); break;
      case 4: el.innerHTML = aiGapsHtml(s); break;
      case 5: el.innerHTML = aiPreviewHtml(s); break;
    }
  }

  // ── Step 1: Fetch & Parse ──────────────────────────────────────────
  function aiFetchHtml(s) {
    var w = aiWallet();
    var cost = w.status === 'suspended'
      ? '<span class="mu-sub" style="color:var(--danger);">⏸ AI suspended — <a onclick="ShowsV2.aiBuyCoins()" style="cursor:pointer;text-decoration:underline;">buy coins</a></span>'
      : '<span class="mu-sub">~15 tokens</span>';
    var header = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<div style="font-weight:600;">Step 1: Fetch &amp; parse application</div>' + cost + '</div>';

    if (!s.applicationUrl) {
      return U.card('Fetch & parse', header +
        '<div class="mu-sub">No application URL set. Edit this show to add one, then return.</div>');
    }

    var inner = header +
      fgRow('Application URL', '<input class="form-input" id="showV2AiUrl" value="' + esc(s.applicationUrl) + '" style="width:100%;">');

    if (V2.ai.parsed) {
      var reqs = V2.ai.parsed;
      var fields = (reqs.fields || []).map(function (f, idx) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--cream-dark,rgba(127,127,127,.12));font-size:0.85rem;">' +
          '<span>' + esc(f.name) + (f.required ? ' ' + U.badge('required', 'danger') : '') + '</span>' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiRemoveField(' + idx + ')">×</button></div>';
      }).join('');
      var photos = (reqs.photos || []).map(function (p, idx) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--cream-dark,rgba(127,127,127,.12));font-size:0.85rem;">' +
          '<span>' + esc(p.slot) + (p.dimensions ? ' <span class="mu-sub">' + esc(p.dimensions) + '</span>' : '') + '</span>' +
          '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiRemovePhoto(' + idx + ')">×</button></div>';
      }).join('');
      var meta = '';
      if (reqs.fees) meta += '<div style="font-size:0.85rem;margin-top:6px;"><strong>Fees:</strong> ' + esc(reqs.fees) + '</div>';
      if (reqs.deadline) meta += '<div style="font-size:0.85rem;"><strong>Deadline:</strong> ' + esc(reqs.deadline) + '</div>';
      if (reqs.specialRequirements && reqs.specialRequirements.length) {
        meta += '<div style="font-size:0.85rem;"><strong>Special:</strong> ' + reqs.specialRequirements.map(function (r) { return esc(r); }).join('; ') + '</div>';
      }
      var parsedBlock =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;">' +
          '<div style="font-weight:600;color:var(--teal);">Parsed requirements ' + U.badge('AI Parsed', 'teal') + '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            linkOut(s.applicationUrl, 'View source') +
            '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiReparse()">Re-parse</button></div>' +
        '</div>' +
        '<div class="mu-sub" style="margin-bottom:4px;">Fields (' + (reqs.fields || []).length + ')</div>' + fields +
        '<button class="btn btn-small btn-secondary" style="margin-top:6px;" onclick="ShowsV2.aiAddField()">+ Add field</button>' +
        '<div class="mu-sub" style="margin:12px 0 4px;">Photo slots (' + (reqs.photos || []).length + ')</div>' + photos +
        '<button class="btn btn-small btn-secondary" style="margin-top:6px;" onclick="ShowsV2.aiAddPhoto()">+ Add photo slot</button>' +
        meta +
        '<div class="mu-sub" style="font-style:italic;margin:12px 0;">Review above. Remove or add items before continuing.</div>' +
        '<button class="btn btn-primary" onclick="ShowsV2.aiGoToStep(2)">Continue to images →</button>';
      inner += parsedBlock;
    } else {
      inner += '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">' +
        '<button class="btn btn-primary" id="showV2AiFetchBtn"' + (V2.ai.busy ? ' disabled' : '') + ' onclick="ShowsV2.aiFetch()">' + (V2.ai.busy ? 'Fetching…' : 'Fetch & parse with AI') + '</button>' +
        '<span class="mu-sub" id="showV2AiFetchStatus">' + (V2.ai.busy ? 'Parsing the application page…' : '') + '</span></div>';
    }
    return U.card('Fetch & parse', inner);
  }

  // ── Step 2: Assign Images ──────────────────────────────────────────
  function aiImagesHtml(s) {
    var reqs = V2.ai.parsed || {};
    var photos = reqs.photos || [];
    var profile = aiProfile();

    // Auto-assign a booth photo from the profile default (mirrors the legacy).
    photos.forEach(function (p, idx) {
      if (!V2.ai.images[idx] && (p.slot || '').toLowerCase().indexOf('booth') >= 0 && profile.boothPhotoUrl) {
        V2.ai.images[idx] = '__profile_booth__';
      }
    });

    var slots = '';
    if (!photos.length) {
      slots = '<span class="mu-sub">No photo requirements detected. Continue to auto-map.</span>';
    } else {
      slots = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;">' +
        photos.map(function (p, idx) {
          var assigned = V2.ai.images[idx];
          var img = null, isProfileBooth = false;
          if (assigned === '__profile_booth__') { img = { url: profile.boothPhotoUrl }; isProfileBooth = true; }
          else if (assigned) img = imageLib()[assigned];
          var filled = !!(img && img.url);
          var tileInner = filled
            ? '<img src="' + esc(img.url) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;margin-bottom:6px;">' +
              '<div style="font-size:0.78rem;color:var(--teal);">✓ ' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>' +
              (isProfileBooth ? '<div class="mu-sub">From profile default</div>' : '')
            : '<div style="font-size:1.6rem;color:var(--warm-gray);margin-bottom:4px;">+</div>' +
              '<div class="mu-sub">' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>' +
              (p.dimensions ? '<div class="mu-sub" style="color:var(--amber);">' + esc(p.dimensions) + '</div>' : '');
          return '<div onclick="ShowsV2.aiPickImage(' + idx + ')" style="border:2px dashed ' + (filled ? 'var(--teal)' : 'var(--cream-dark,rgba(127,127,127,.35))') + ';border-radius:8px;padding:10px;text-align:center;cursor:pointer;">' + tileInner + '</div>';
        }).join('') + '</div>';
    }

    // Per-assigned-image product link + application-description editors.
    var editors = '';
    photos.forEach(function (p, idx) {
      var assigned = V2.ai.images[idx];
      if (!assigned || assigned === '__profile_booth__') return;
      var img = imageLib()[assigned];
      if (!img) return;
      var prodOpts = '<option value="">— Select a product —</option>' +
        productData().filter(function (pr) { return pr && pr.name; }).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
          .map(function (pr) { return '<option value="' + esc(pr.pid || '') + '"' + (pr.pid === img.productId ? ' selected' : '') + '>' + esc(pr.name) + '</option>'; }).join('');
      editors += '<div style="margin-top:12px;padding:14px;border:1px solid var(--cream-dark,rgba(127,127,127,.25));border-radius:8px;position:relative;">' +
        '<button class="btn btn-small btn-secondary" style="position:absolute;top:8px;right:8px;" title="Remove image" onclick="ShowsV2.aiAssignImage(' + idx + ',null)">×</button>' +
        '<div style="display:flex;gap:12px;align-items:flex-start;">' +
          '<img src="' + esc(img.thumbnailUrl || img.url || '') + '" style="width:72px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0;">' +
          '<div style="flex:1;">' +
            '<div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">' + esc(p.slot || 'Product photo') + '</div>' +
            '<label class="form-label">Link to product</label>' +
            '<select class="form-input" id="showV2AiProd_' + idx + '" onchange="ShowsV2.aiLinkProduct(' + idx + ',this.value)" style="width:100%;margin-bottom:10px;">' + prodOpts + '</select>' +
            '<label class="form-label">Application description</label>' +
            '<textarea class="form-input" id="showV2AiDesc_' + idx + '" rows="3" style="width:100%;resize:vertical;" placeholder="Describe this product for show applications…" onblur="ShowsV2.aiSaveSlotDesc(' + idx + ',this.value)">' + esc(img.applicationDescription || '') + '</textarea>' +
          '</div>' +
        '</div></div>';
    });

    var nav = '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="ShowsV2.aiGoToStep(1)">← Back</button>' +
      '<button class="btn btn-primary" onclick="ShowsV2.aiGoToStep(3)">Continue to auto-map →</button></div>';
    return U.card('Step 2: Assign images',
      '<div class="mu-sub" style="margin-bottom:14px;">Click each slot to assign an image from your gallery.</div>' + slots + editors + nav);
  }

  // ── Step 3: Auto-Map Fields ────────────────────────────────────────
  function aiBuildMapping() {
    var reqs = V2.ai.parsed || {};
    var fields = reqs.fields || [];
    var profile = aiProfile();
    var mapping = {};

    // Aggregate a product description from the assigned images' tags (or linked
    // products). Mirrors the legacy productDesc assembly.
    var lib = imageLib();
    var productDesc = '';
    Object.keys(V2.ai.images).forEach(function (k) {
      var imgId = V2.ai.images[k];
      if (imgId === '__profile_booth__') return;
      var img = lib[imgId];
      if (img && img.applicationDescription && productDesc.indexOf(img.applicationDescription) < 0) productDesc += img.applicationDescription + '\n';
    });
    if (!productDesc) {
      var prods = productData();
      Object.keys(V2.ai.images).forEach(function (k) {
        var imgId = V2.ai.images[k];
        if (imgId === '__profile_booth__') return;
        var img = lib[imgId];
        if (!img || !img.productId) return;
        var pr = prods.filter(function (x) { return x.pid === img.productId; })[0];
        if (pr && pr.description && productDesc.indexOf(pr.description) < 0) productDesc += (pr.name ? pr.name + ': ' : '') + (pr.shortDescription || pr.description) + '\n';
      });
    }
    productDesc = productDesc.trim();

    fields.forEach(function (f) {
      var n = (f.name || '').toLowerCase();
      var m;
      if (n.indexOf('business') >= 0 || n.indexOf('artist name') >= 0 || n.indexOf('company') >= 0)
        m = { source: 'profile.name', value: profile.name || '', confidence: profile.name ? 'high' : 'none' };
      else if (n.indexOf('bio') >= 0 || n.indexOf('statement') >= 0 || n.indexOf('about') >= 0)
        m = { source: 'profile.bio', value: profile.bio || '', confidence: profile.bio ? 'high' : 'none' };
      else if (n.indexOf('product') >= 0 || n.indexOf('description') >= 0 || n.indexOf('what you') >= 0)
        m = { source: 'gallery images', value: productDesc, confidence: productDesc ? 'medium' : 'none' };
      else if (n.indexOf('material') >= 0)
        m = { source: 'profile.materials', value: profile.materials || '', confidence: profile.materials ? 'high' : 'none' };
      else if (n.indexOf('process') >= 0 || n.indexOf('technique') >= 0)
        m = { source: 'profile.processDescription', value: profile.processDescription || '', confidence: profile.processDescription ? 'high' : 'none' };
      else if (n.indexOf('categor') >= 0 || n.indexOf('medium') >= 0 || n.indexOf('craft') >= 0) {
        var cv = profile.category || ''; if (profile.category2) cv += ', ' + profile.category2;
        m = { source: 'profile.category', value: cv, confidence: cv ? 'high' : 'none' };
      } else if (n.indexOf('price') >= 0 || n.indexOf('range') >= 0)
        m = { source: 'profile.priceRange', value: profile.priceRange || '', confidence: profile.priceRange ? 'high' : 'none' };
      else if (n.indexOf('website') >= 0 || n.indexOf('url') >= 0)
        m = { source: 'profile.website', value: profile.website || '', confidence: profile.website ? 'high' : 'none' };
      else if (n.indexOf('instagram') >= 0 || n.indexOf('social') >= 0)
        m = { source: 'profile.instagram', value: profile.instagram || '', confidence: profile.instagram ? 'high' : 'none' };
      else if (n.indexOf('email') >= 0)
        m = { source: 'profile.email', value: profile.email || '', confidence: profile.email ? 'high' : 'none' };
      else if (n.indexOf('phone') >= 0)
        m = { source: 'profile.phone', value: profile.phone || '', confidence: profile.phone ? 'high' : 'none' };
      else if (n.indexOf('location') >= 0 || n.indexOf('city') >= 0 || n.indexOf('address') >= 0)
        m = { source: 'profile.location', value: profile.location || '', confidence: profile.location ? 'medium' : 'none' };
      else if (n.indexOf('year') >= 0 || n.indexOf('experience') >= 0)
        m = { source: 'profile.yearsInBusiness', value: profile.yearsInBusiness ? profile.yearsInBusiness + ' years' : '', confidence: profile.yearsInBusiness ? 'high' : 'none' };
      else if (n.indexOf('tax') >= 0 || n.indexOf('ein') >= 0)
        m = { source: 'profile.taxId', value: profile.taxId || '', confidence: profile.taxId ? 'high' : 'none' };
      else if (n.indexOf('booth') >= 0 && n.indexOf('size') >= 0)
        m = { source: 'profile.defaultBoothSize', value: profile.defaultBoothSize || '', confidence: profile.defaultBoothSize ? 'high' : 'none' };
      else if (n.indexOf('license') >= 0)
        m = { source: 'profile.businessLicense', value: profile.businessLicense || '', confidence: profile.businessLicense ? 'high' : 'none' };
      else
        m = { source: 'manual', value: '', confidence: 'none' };
      mapping[f.name] = m;
    });
    return mapping;
  }
  function aiMapHtml(s) {
    var reqs = V2.ai.parsed || {};
    var fields = reqs.fields || [];
    if (!V2.ai.mapping) V2.ai.mapping = aiBuildMapping();

    var rows = fields.map(function (f) {
      var m = V2.ai.mapping[f.name] || { source: 'manual', value: '', confidence: 'none' };
      var confTone = m.confidence === 'high' ? 'success' : m.confidence === 'medium' ? 'warning' : 'danger';
      var confLabel = m.confidence === 'high' ? '✓ Auto-matched' : m.confidence === 'medium' ? '~ Partial match' : '✗ Not matched';
      if (m.source === 'gallery images') confLabel = '~ From gallery images';
      return '<div style="margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<label class="form-label" style="text-transform:uppercase;">' + esc(f.name) + (f.required ? ' <span style="color:var(--danger);">*</span>' : '') + '</label>' +
          U.badge(confLabel, confTone) + '</div>' +
        (f.description ? '<div class="mu-sub" style="margin-bottom:4px;">' + esc(f.description) + '</div>' : '') +
        '<textarea class="form-input" id="showV2AiMap_' + esc(String(f.name).replace(/\s+/g, '_')) + '" rows="2" style="width:100%;resize:vertical;" placeholder="Enter value…">' + esc(m.value) + '</textarea>' +
      '</div>';
    }).join('');

    var nav = '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="ShowsV2.aiGoToStep(2)">← Back</button>' +
      '<button class="btn btn-primary" onclick="ShowsV2.aiSaveMappingAndStep(4)">Continue to gap analysis →</button></div>';
    return U.card('Step 3: Auto-map fields',
      '<div class="mu-sub" style="margin-bottom:14px;">Review how your vendor profile maps to the application fields. Edit values as needed.</div>' +
      (rows || '<span class="mu-sub">No fields to map.</span>') + nav);
  }

  // ── Step 4: Gap Analysis ───────────────────────────────────────────
  function aiComputeGaps() {
    var reqs = V2.ai.parsed || {};
    var fields = reqs.fields || [];
    var photos = reqs.photos || [];
    var profile = aiProfile();
    var gaps = [];
    fields.forEach(function (f) {
      var m = V2.ai.mapping[f.name] || {};
      if (f.required && !m.value) gaps.push({ type: 'field', name: f.name, description: f.description || '' });
    });
    var byCategory = {};
    Object.keys(imageLib()).forEach(function (k) { var img = imageLib()[k]; if (img && img.category) byCategory[img.category] = (byCategory[img.category] || 0) + 1; });
    var hasBoothPhoto = !!profile.boothPhotoUrl || !!byCategory.booth;
    photos.forEach(function (p, idx) {
      if (V2.ai.images[idx]) return;
      var slotLower = (p.slot || '').toLowerCase();
      if (slotLower.indexOf('booth') >= 0 && hasBoothPhoto) return;
      if (slotLower.indexOf('product') >= 0 && byCategory.product) return;
      if (slotLower.indexOf('process') >= 0 && byCategory.process) return;
      gaps.push({ type: 'photo', name: p.slot, description: p.description || '' });
    });
    V2.ai.gaps = gaps;
    return gaps;
  }
  function aiGapsHtml(s) {
    var gaps = aiComputeGaps();
    var body;
    if (!gaps.length) {
      body = '<div style="text-align:center;padding:18px 0;">' +
        '<div style="font-size:1.6rem;color:var(--success, var(--teal));margin-bottom:6px;">✓</div>' +
        '<div style="font-weight:600;color:var(--success, var(--teal));">All requirements met!</div>' +
        '<div class="mu-sub" style="margin-top:4px;">Your profile and gallery cover everything this show needs.</div></div>';
    } else {
      body = '<div class="mu-sub" style="margin-bottom:12px;">These items are required but missing:</div>' +
        gaps.map(function (g) {
          var fix = g.type === 'photo'
            ? '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiGoToStep(2)">Fix →</button>'
            : '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiFixProfileGap()">Fix profile →</button>';
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--cream-dark,rgba(127,127,127,.25));border-radius:6px;margin-bottom:8px;">' +
            '<span style="font-size:1.0rem;">' + (g.type === 'photo' ? '📷' : '📝') + '</span>' +
            '<div style="flex:1;"><div style="font-weight:500;font-size:0.9rem;">' + esc(g.name) + '</div>' +
            (g.description ? '<div class="mu-sub">' + esc(g.description) + '</div>' : '') + '</div>' + fix + '</div>';
        }).join('');
    }
    var nav = '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="ShowsV2.aiGoToStep(3)">← Back</button>' +
      '<button class="btn btn-primary" onclick="ShowsV2.aiGoToStep(5)">Preview package →</button></div>';
    return U.card('Step 4: Gap analysis', body + nav);
  }

  // ── Step 5: Preview & Save (Application Assistant) ─────────────────
  function aiPreviewHtml(s) {
    var reqs = V2.ai.parsed || {};
    var fields = reqs.fields || [];
    var photos = reqs.photos || [];
    var profile = aiProfile();
    var appUrl = s.applicationUrl || '';
    if (V2.ai.copyIdx < 0) V2.ai.copyIdx = 0;

    var headRow = '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:1px solid var(--cream-dark,rgba(127,127,127,.25));border-radius:8px;margin-bottom:14px;">' +
      '<div><div style="font-weight:600;">' + esc(showName(s)) + '</div>' +
      (s.applicationDeadline ? '<div class="mu-sub">Deadline: ' + esc(fmtDate(s.applicationDeadline)) + '</div>' : '') + '</div>' +
      (appUrl ? '<button class="btn btn-primary btn-small" onclick="ShowsV2.aiLaunchApp()">Launch application</button>' : '') + '</div>';

    // AI-draft control row (Step 5 AI call). Token-metered; surfaces the wallet
    // cost / suspended state inline; on click runs /studioAssistant via aiDraft().
    var w = aiWallet();
    var draftCost = w.status === 'suspended'
      ? '<span class="mu-sub" style="color:var(--danger);">⏸ AI suspended — <a onclick="ShowsV2.aiBuyCoins()" style="cursor:pointer;text-decoration:underline;">buy coins</a></span>'
      : '<span class="mu-sub">~30 tokens</span>';
    var draftRow = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' +
      '<button class="btn btn-secondary btn-small" id="showV2AiDraftBtn"' + (V2.ai.busy ? ' disabled' : '') + ' onclick="ShowsV2.aiDraft()">' + (V2.ai.busy ? 'Drafting…' : '✨ AI-draft missing copy') + '</button>' +
      draftCost +
      '<span class="mu-sub" id="showV2AiDraftStatus">' + (V2.ai.busy ? 'Asking the assistant to draft your answers…' : '') + '</span></div>';

    var fieldsBody = fields.map(function (f, idx) {
      var m = V2.ai.mapping[f.name] || {};
      var val = m.value || '';
      var isCurrent = idx === V2.ai.copyIdx;
      var isCopied = idx < V2.ai.copyIdx;
      var border = isCurrent ? 'var(--amber)' : isCopied ? 'var(--success, var(--teal))' : 'var(--cream-dark,rgba(127,127,127,.25))';
      var stepMark = isCopied ? '<span style="color:var(--success, var(--teal));font-size:0.78rem;">✓</span>' : '<span class="mu-sub" style="font-weight:600;">' + (idx + 1) + '</span>';
      return '<div id="showV2AiField_' + idx + '" style="padding:12px;border:1px solid ' + border + ';border-radius:8px;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' + stepMark +
            '<span class="mu-sub" style="text-transform:uppercase;font-weight:500;">' + esc(f.name) + '</span>' +
            (f.required ? ' ' + U.badge('required', 'danger') : '') + '</div>' +
          (val ? '<button class="btn btn-small ' + (isCurrent ? 'btn-primary' : 'btn-secondary') + '" onclick="ShowsV2.aiCopyField(' + idx + ')">' + (isCopied ? 'Copied' : 'Copy') + '</button>' : '') +
        '</div>' +
        (val ? '<div style="font-size:0.9rem;white-space:pre-wrap;line-height:1.4;">' + esc(val) + '</div>'
             : '<div style="font-size:0.85rem;color:var(--danger);font-style:italic;">No value — fill in manually or AI-draft.</div>') +
      '</div>';
    }).join('');

    var photosBody = '';
    if (photos.length) {
      photosBody = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">' +
        photos.map(function (p, idx) {
          var assigned = V2.ai.images[idx];
          var img = null;
          if (assigned === '__profile_booth__') img = { url: profile.boothPhotoUrl };
          else if (assigned) img = imageLib()[assigned];
          if (img && img.url) {
            return '<div style="text-align:center;padding:10px;border:1px solid var(--cream-dark,rgba(127,127,127,.25));border-radius:8px;">' +
              '<img src="' + esc(img.url) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;margin-bottom:6px;">' +
              '<div class="mu-sub" style="margin-bottom:6px;">' + esc(p.slot || 'Photo ' + (idx + 1)) + '</div>' +
              '<button class="btn btn-small btn-secondary" onclick="ShowsV2.aiDownloadPhoto(\'' + esc(img.url) + '\',\'' + esc(p.slot || 'photo') + '\')">Download</button></div>';
          }
          return '<div style="text-align:center;padding:10px;border:1px solid var(--cream-dark,rgba(127,127,127,.25));border-radius:8px;">' +
            '<div style="aspect-ratio:1;background:var(--cream-dark,rgba(127,127,127,.12));border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--warm-gray);margin-bottom:6px;">—</div>' +
            '<div style="font-size:0.78rem;color:var(--danger);">' + esc(p.slot || 'Photo') + ' — not assigned</div></div>';
        }).join('') + '</div>';
    }

    var extras = '';
    if (reqs.specialRequirements && reqs.specialRequirements.length) {
      extras += '<div style="padding:12px;border:1px solid var(--amber);border-radius:8px;margin-bottom:14px;">' +
        '<div style="font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--amber);">Special requirements</div>' +
        reqs.specialRequirements.map(function (r) { return '<div style="font-size:0.85rem;padding:2px 0;">• ' + esc(r) + '</div>'; }).join('') + '</div>';
    }
    if (reqs.fees || reqs.deadline) {
      extras += '<div style="display:flex;gap:16px;margin-bottom:14px;font-size:0.85rem;flex-wrap:wrap;">' +
        (reqs.fees ? '<div><span class="mu-sub">Fees:</span> ' + esc(reqs.fees) + '</div>' : '') +
        (reqs.deadline ? '<div><span class="mu-sub">Deadline:</span> ' + esc(reqs.deadline) + '</div>' : '') + '</div>';
    }

    var nav = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
      '<button class="btn btn-secondary" onclick="ShowsV2.aiGoToStep(4)">← Back</button>' +
      (canEdit() ? '<button class="btn btn-primary" onclick="ShowsV2.aiSaveApp()">Save package</button>' : '') +
      (appUrl ? '<button class="btn btn-secondary" onclick="ShowsV2.aiLaunchApp()">Launch application</button>' : '') + '</div>';

    var inner = headRow + draftRow +
      (appUrl ? '<div class="mu-sub" style="margin-bottom:12px;">Copy each value below and paste it into the application form.</div>' : '') +
      '<div style="font-weight:600;font-size:0.85rem;margin-bottom:10px;">Application fields</div>' + (fieldsBody || '<span class="mu-sub">No fields.</span>') +
      (photosBody ? '<div style="font-weight:600;font-size:0.85rem;margin:18px 0 10px;">Photos to upload</div>' + photosBody : '') +
      (extras ? '<div style="margin-top:14px;">' + extras + '</div>' : '') +
      nav;
    return U.card('Step 5: Application assistant', inner);
  }

  function ensureTab() {
    var el = document.getElementById('showsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'showsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var lensPills = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' +
      LENSES.map(function (l) {
        var on = V2.lens === l[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ShowsV2.lens(\'' + l[0] + '\')">' + l[1] + '</button>';
      }).join(' ') + '</div>';

    // "+ New show" — native create (gated). Available on every list lens so a
    // maker can start an application from anywhere; opens the create form.
    var newShowBtn = canEdit() ? '<button class="btn btn-primary" onclick="ShowsV2.create()">+ New show</button>' : '';

    // AI Application Builder (PR6) — active on the Apply lens. The builder takes over
    // the tab body (select-show → 6 steps); a "Back to applications" button exits.
    if (V2.lens === 'apply' && V2.ai.active) {
      var exitBtn = '<button class="btn btn-secondary" onclick="ShowsV2.aiExit()">← Back to applications</button>';
      renderAiBuilder(tab, U.pageHeader({ title: 'Shows', count: 'AI application builder', actionsHtml: exitBtn }), lensPills);
      return;
    }

    // Find lens (PR5) — /showFinder AI discovery → add-to-pipeline. The CF call is
    // a READ (stays in the twin); the add WRITE routes through ShowsBridge.addFromFinder.
    if (V2.lens === 'find') {
      renderFindLens(tab, U.pageHeader({ title: 'Shows', count: 'find new shows', actionsHtml: newShowBtn }), lensPills);
      return;
    }

    // Apply lens gets an extra "AI Application Builder" launcher next to "+ New show".
    if (V2.lens === 'apply' && canEdit()) {
      newShowBtn = '<button class="btn btn-secondary" onclick="ShowsV2.aiLaunch()">✨ AI Application Builder</button> ' + newShowBtn;
    }

    var lensTitle = { apply: 'apply to shows', prep: 'show prep', execute: 'active shows', history: 'show history' }[V2.lens] || '';
    var rows = visibleRows();
    var emptyMsg = {
      apply: 'No active applications. Shows you\'re considering, applied to, or waitlisted for appear here.',
      prep: 'No accepted shows to prep.',
      execute: 'No accepted shows. Execute tooling activates for accepted shows.',
      history: 'No past or completed shows yet.'
    }[V2.lens] || 'No shows.';

    tab.innerHTML =
      U.pageHeader({ title: 'Shows', count: N.count(rows.length) + ' ' + lensTitle, actionsHtml: newShowBtn }) +
      lensPills +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, location or type…" value="' + esc(V2.q) +
        '" oninput="ShowsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('shows-v2', {
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ShowsV2.sort', onRowClickFnName: 'ShowsV2.open',
        empty: { title: 'No shows', message: V2.loaded ? emptyMsg : 'Loading…' }
      });
  }

  // ── Public API (referenced by the rendered HTML + route setup) ──────
  // Ensure the legacy shows module (and thus window.ShowsBridge) is loaded before
  // a write — mirrors SalesEventsV2.create / jobs-v2.
  function ensureEngine() {
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('shows'); } catch (e) {} }
  }

  // Close the detail slide-out (if open) and drop the stale open-record state, so
  // switching lenses / re-rendering the list never leaves an orphaned slide-out
  // floating over the new lens or a stale V2.current behind it. requestCloseForce
  // skips the dirty prompt — a read-detail has no dirty key, and an in-pane editor
  // shouldn't trap a lens switch. Guarded so a closed panel is a no-op.
  function closeDetailIfOpen() {
    V2.current = null;
    try { if (U.slideOut && U.slideOut.isOpen && U.slideOut.isOpen()) U.slideOut.requestCloseForce(); } catch (e) {}
  }

  window.ShowsV2 = {
    // Switching lenses (or re-clicking Apply) drops out of the AI builder so the
    // list reappears — the builder is a modal-ish takeover of the Apply lens.
    // Also close any open detail slide-out + clear the stale open record so the
    // pane never lingers over the lens you just switched to.
    lens: function (lens) { closeDetailIfOpen(); V2.ai.active = false; V2.lens = lens; render(); },
    search: function (v) { V2.q = v; render(); },
    sort: function (key, dir) { V2.sortKey = key; V2.sortDir = dir; render(); },
    open: function (id) {
      V2.current = id;
      V2.execDate = null; // reset the Execute day-picker per record
      // Pre-load the staffing roster + product list so the Prep / Execute
      // editors render with data on first paint (both are cheap + cached).
      ensureTeam(); ensureProducts();
      MastEntity.get('shows-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('shows-v2', rec, 'read');
      });
    },
    // ── Create / edit ──
    create: function () {
      if (!canEdit()) return notPermitted();
      ensureEngine();
      V2.current = null;
      MastEntity.openRecord('shows-v2', {}, 'create');
    },
    // ── Status machine ── (any → any; the bridge no-ops old===new + handles the
    // admin-gated autoPublish to the public events calendar on 'accepted')
    setStatus: function (id, newStatus) {
      if (!canEdit()) return notPermitted();
      if (!bridge() || !bridge().setStatus) return bridgeLoading();
      var rec = V2.byId[id];
      Promise.resolve(bridge().setStatus(id, newStatus, rec)).then(function (res) {
        if (res === null) return; // no-op (clicked the current status)
        if (newStatus === 'accepted' && res && res.publishSkippedNonAdmin) {
          toast('Show accepted. An admin must publish it to the public calendar.');
        } else if (newStatus === 'accepted' && res && res.published) {
          toast('Show accepted and published to the public calendar.');
        } else {
          toast('Status updated to ' + (STATUS_LABEL[newStatus] || newStatus) + '.');
        }
        reloadThenOpen(id);
      }).catch(actionErr);
    },
    // ── Deep-dive enrich ── (the /showDeepDive CF call is a READ and stays here;
    // only the resulting WRITE goes through ShowsBridge.applyDeepDive — mirrors
    // the legacy runShowDeepDive split.)
    enrich: function (id) {
      if (!canEdit()) return notPermitted();
      if (!bridge() || !bridge().applyDeepDive) return bridgeLoading();
      var s = V2.byId[id];
      if (!s || !s.websiteUrl) { toast('No website URL available for deep dive.', true); return; }
      toast('Researching show details…');
      var run = function (token) {
        return callCF('/showDeepDive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ websiteUrl: s.websiteUrl, showName: s.name || '', notes: s.notes || '' })
        }).then(function (resp) {
          return resp.json().then(function (data) {
            if (!resp.ok) throw new Error(data.error || 'Deep dive failed');
            var details = data.details || {};
            if (!Object.keys(details).length) { toast('Deep dive completed but no additional details found.', true); return; }
            return Promise.resolve(bridge().applyDeepDive(id, details)).then(function () {
              toast('Deep dive complete — details updated.');
              reloadThenOpen(id);
            });
          });
        });
      };
      try {
        window.auth.currentUser.getIdToken().then(run).catch(function (e) { toast('Deep dive failed: ' + ((e && e.message) || e), true); });
      } catch (e) { toast('Deep dive failed: ' + ((e && e.message) || e), true); }
    },
    // ── Delete / archive ── (clears the public events/{id} mirror inside the
    // bridge). Gated can('show-prep','delete') + confirm.
    remove: function (id) {
      if (!canDelete()) return notPermitted();
      if (!bridge() || !bridge().remove) return bridgeLoading();
      var go = function () {
        Promise.resolve(bridge().remove(id)).then(function () {
          toast('Show deleted.');
          // Close the slide-out (the record no longer exists) and refresh the list.
          if (window.MastUI && MastUI.slideOut && typeof MastUI.slideOut.requestCloseForce === 'function') { try { MastUI.slideOut.requestCloseForce(); } catch (e) {} }
          V2.loaded = false;
          setTimeout(function () { loadData().then(render); }, 250);
        }).catch(actionErr);
      };
      if (typeof window.mastConfirm === 'function') {
        Promise.resolve(window.mastConfirm('Delete this show? This cannot be undone.', { title: 'Delete Show', danger: true })).then(function (ok) { if (ok) go(); });
      } else { go(); }
    },

    // ════════════════════════════════════════════════════════════════════
    // PR5 — Find lens (/showFinder AI discovery → add-to-pipeline). The CF call
    // (a READ) stays here in the twin; only the WRITE (add to pipeline) routes
    // through window.ShowsBridge.addFromFinder, gated can('show-prep','edit').
    // Mirrors the legacy runShowFinder / addShowToPipeline split.
    // ════════════════════════════════════════════════════════════════════

    // findRun() — read the search form, POST /showFinder (bearer + the global
    // callCF's auto X-Tenant-ID; same envelope as the legacy runShowFinder and the
    // PR3 enrich), stash the results, re-render the results region. Handles a CF
    // failure (e.g. no Anthropic key → 500) gracefully via finderError.
    findRun: function () {
      var name = ((document.getElementById('showV2FinderName') || {}).value || '').trim();
      var city = ((document.getElementById('showV2FinderCity') || {}).value || '').trim();
      var state = ((document.getElementById('showV2FinderState') || {}).value || '').trim().toUpperCase();
      if (!name && !city && !state) { toast('Enter a show name or location to search.', true); return; }
      function num(id) { var v = parseInt(((document.getElementById(id) || {}).value || ''), 10); return isNaN(v) ? undefined : v; }
      function strOpt(id) { var v = ((document.getElementById(id) || {}).value || '').trim(); return v || undefined; }
      var body = {
        showName: name || undefined,
        locationCity: city || undefined,
        locationState: state || undefined,
        radius: num('showV2FinderRadius'),
        entryType: strOpt('showV2FinderEntry'),
        showFormat: strOpt('showV2FinderFormat'),
        dateRangeStart: strOpt('showV2FinderDateStart'),
        dateRangeEnd: strOpt('showV2FinderDateEnd'),
        maxFee: num('showV2FinderMaxFee'),
        count: 10
      };
      V2.finderBusy = true; V2.finderError = null; V2.finderResults = []; V2.finderState = {}; V2.finderSearched = false;
      rerenderFinderResults();
      var done = function () { V2.finderBusy = false; V2.finderSearched = true; rerenderFinderResults(); };
      var run = function (token) {
        return callCF('/showFinder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        }).then(function (resp) {
          return resp.json().catch(function () { return {}; }).then(function (data) {
            if (!resp.ok) throw new Error((data && data.error) || ('Search failed (' + resp.status + ')'));
            V2.finderResults = (data && data.shows) || [];
            done();
          });
        });
      };
      try {
        window.auth.currentUser.getIdToken().then(run).catch(function (e) {
          V2.finderError = 'Search failed: ' + ((e && e.message) || e); done();
        });
      } catch (e) {
        V2.finderError = 'Search failed: ' + ((e && e.message) || e); done();
      }
    },
    // findAdd(idx) — add a finder result to the pipeline via ShowsBridge.addFromFinder
    // (the ONLY write path; aiGenerated:true). Gated + deduped (the button is already
    // disabled when isInPipeline, but re-check here). On success mark the card Added
    // and refresh the pipeline cache so the Apply lens + dedupe reflect the new show.
    findAdd: function (idx) {
      if (!canEdit()) return notPermitted();
      if (!bridge() || !bridge().addFromFinder) return bridgeLoading();
      var r = V2.finderResults[idx];
      if (!r) return;
      if (V2.finderState[idx] === 'added') return;
      if (isInPipeline(r)) { toast('That show is already in your pipeline.', true); rerenderFinderResults(); return; }
      Promise.resolve(bridge().addFromFinder(r)).then(function () {
        V2.finderState[idx] = 'added';
        toast((r.name || 'Show') + ' added to pipeline.');
        // Refresh the pipeline cache so the Apply lens shows it + dedupe catches
        // any later duplicate results (don't disturb the finder result list).
        V2.loaded = false;
        loadData().then(function () { rerenderFinderResults(); });
      }).catch(actionErr);
    },
    // findDismiss(idx) — drop a result from the local set (no write).
    findDismiss: function (idx) {
      if (!V2.finderResults[idx]) return;
      V2.finderResults.splice(idx, 1);
      // Re-index finderState (indices shifted by the splice).
      var next = {};
      Object.keys(V2.finderState).forEach(function (k) {
        var ki = parseInt(k, 10);
        if (ki < idx) next[ki] = V2.finderState[ki];
        else if (ki > idx) next[ki - 1] = V2.finderState[ki];
      });
      V2.finderState = next;
      rerenderFinderResults();
    },
    // findClear() — clear the result set + error (no write).
    findClear: function () {
      V2.finderResults = []; V2.finderState = {}; V2.finderError = null; V2.finderSearched = false;
      render();
    },

    // ════════════════════════════════════════════════════════════════════
    // PR6 — AI Application Builder (native 6-step wizard). Launched from the Apply
    // lens. The /studioAssistant CF call (Step 1 parse + Step 5 draft) is a READ
    // (token-metered; 402 → openCoinPurchaseModal) and stays here in the twin; the
    // three WRITES route through window.ShowsBridge (setImageAppMeta / saveProfile /
    // saveApplication). All gate on can('show-prep','edit'). Mirrors the legacy
    // shows.js showsAI* handlers.
    // ════════════════════════════════════════════════════════════════════

    // aiLaunch() — enter the builder at the select-show screen (loads profile +
    // saved drafts first). aiStart(showId) — deep-enter directly on a show.
    aiLaunch: function () {
      if (!canEdit()) return notPermitted();
      ensureEngine();
      V2.ai.active = true; V2.lens = 'apply'; V2.ai.step = 0; V2.ai.showId = null;
      render();
      ensureAiData().then(function () { if (V2.ai.active && V2.ai.step === 0) rerenderAiBody(); });
    },
    aiStart: function (showId) {
      if (!canEdit()) return notPermitted();
      ensureEngine(); ensureProducts();
      V2.ai.active = true; V2.lens = 'apply';
      V2.ai.showId = showId; V2.ai.step = 1;
      V2.ai.parsed = null; V2.ai.mapping = null; V2.ai.gaps = null;
      V2.ai.images = {}; V2.ai.currentApp = null; V2.ai.copyIdx = -1;
      ensureAiData().then(function () { render(); });
      render();
    },
    aiResume: function (appId) {
      var app = (V2.ai.applications || {})[appId];
      if (!app) return;
      ensureEngine(); ensureProducts();
      V2.ai.active = true; V2.lens = 'apply';
      V2.ai.showId = app.showId;
      V2.ai.currentApp = Object.assign({ id: appId }, app);
      V2.ai.parsed = app.parsedRequirements || null;
      V2.ai.mapping = app.fieldMapping || null;
      V2.ai.gaps = app.gapAnalysis || null;
      V2.ai.images = app.imageAssignments || {};
      V2.ai.copyIdx = -1;
      // Resume to the furthest-completed step (mirrors the legacy showsAIResumeApp).
      V2.ai.step = V2.ai.parsed ? (Object.keys(V2.ai.images).length > 0 ? (V2.ai.mapping ? 4 : 3) : 2) : 1;
      render();
    },
    aiExit: function () { V2.ai.active = false; V2.ai.step = 0; V2.ai.showId = null; render(); },
    aiBackToSelect: function () { V2.ai.step = 0; V2.ai.showId = null; rerenderAiBody(); },
    aiGoToStep: function (step) { V2.ai.step = step; rerenderAiBody(); },
    aiBuyCoins: function () { aiBuyCoins(); },

    // ── Step 1: Fetch & Parse — /studioAssistant CF read (token-metered; 402 →
    // coin purchase). On a parse failure / non-JSON answer, fall back to a sensible
    // default field set (mirrors the legacy showsAIFetchAndParse). On sgtest15 the
    // CF may 500 (no Anthropic key) — surfaced as a graceful toast, builder stays.
    aiFetch: function () {
      var url = ((document.getElementById('showV2AiUrl') || {}).value || '').trim();
      if (!url) { toast('Enter an application URL.', true); return; }
      var w = aiWallet();
      if (w.status === 'suspended') { toast('AI suspended. Purchase coins to continue.', true); aiBuyCoins(); return; }
      V2.ai.busy = true; rerenderAiStep();
      var done = function () { V2.ai.busy = false; rerenderAiStep(); };
      var run = function (token) {
        return callCF('/studioAssistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            question: 'Parse the following show application URL and extract the jury/application requirements. URL: ' + url + '\n\nReturn a JSON object with these fields:\n- fields: array of {name, description, required: boolean} for each required field\n- photos: array of {slot, description, dimensions} for each required photo\n- fees: string describing application/booth fees\n- deadline: string with application deadline\n- specialRequirements: array of strings for any special requirements\n- rawNotes: string with any other relevant info\n\nRespond ONLY with valid JSON, no markdown.',
            assistantContext: 'show-apply-parse-application'
          })
        }).then(function (resp) {
          if (resp.status === 402) {
            toast('Token balance exhausted. Purchase coins to continue.', true);
            aiBuyCoins(); done(); return;
          }
          return resp.json().catch(function () { return {}; }).then(function (data) {
            if (!resp.ok) throw new Error((data && data.error) || ('Parse failed (' + resp.status + ')'));
            var answer = (data && data.answer) || '';
            try {
              var jsonStr = answer.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
              V2.ai.parsed = JSON.parse(jsonStr);
            } catch (e) {
              V2.ai.parsed = {
                fields: [
                  { name: 'Business Name', description: '', required: true },
                  { name: 'Artist Statement', description: '', required: true },
                  { name: 'Product Description', description: '', required: true }
                ],
                photos: [{ slot: 'Product Photo', description: '' }, { slot: 'Booth Photo', description: '' }],
                fees: '', deadline: '', specialRequirements: [], rawNotes: answer
              };
            }
            done();
          });
        });
      };
      try {
        window.auth.currentUser.getIdToken().then(run).catch(function (e) { toast('Fetch failed: ' + ((e && e.message) || e), true); done(); });
      } catch (e) { toast('Fetch failed: ' + ((e && e.message) || e), true); done(); }
    },
    aiReparse: function () { V2.ai.parsed = null; rerenderAiStep(); },
    aiRemoveField: function (idx) { if (V2.ai.parsed && V2.ai.parsed.fields) V2.ai.parsed.fields.splice(idx, 1); rerenderAiStep(); },
    aiAddField: function () {
      Promise.resolve(window.mastPrompt ? window.mastPrompt('Field name (e.g. "Product Description"):', { title: 'Add Field' }) : null).then(function (name) {
        if (!name) return;
        if (!V2.ai.parsed) V2.ai.parsed = { fields: [], photos: [] };
        if (!V2.ai.parsed.fields) V2.ai.parsed.fields = [];
        V2.ai.parsed.fields.push({ name: String(name).trim(), description: '', required: true });
        rerenderAiStep();
      });
    },
    aiRemovePhoto: function (idx) { if (V2.ai.parsed && V2.ai.parsed.photos) V2.ai.parsed.photos.splice(idx, 1); rerenderAiStep(); },
    aiAddPhoto: function () {
      Promise.resolve(window.mastPrompt ? window.mastPrompt('Photo slot name (e.g. "Process Photo 1"):', { title: 'Add Photo Slot' }) : null).then(function (slot) {
        if (!slot) return;
        if (!V2.ai.parsed) V2.ai.parsed = { fields: [], photos: [] };
        if (!V2.ai.parsed.photos) V2.ai.parsed.photos = [];
        V2.ai.parsed.photos.push({ slot: String(slot).trim(), description: '' });
        rerenderAiStep();
      });
    },

    // ── Step 2: Assign Images — image picker + per-slot product link + app
    // description. The image-tagging WRITES route through ShowsBridge.setImageAppMeta.
    aiPickImage: function (slotIdx) {
      var lib = imageLib();
      var allIds = Object.keys(lib);
      if (!allIds.length) { toast('No images in gallery. Upload some first.', true); return; }
      var appIds = allIds.filter(function (id) { return lib[id].applicationPhoto; });
      var ids = appIds.length ? appIds : allIds;
      var showingAll = !appIds.length;
      var grid = ids.map(function (id) {
        var img = lib[id];
        return '<div onclick="ShowsV2.aiAssignImage(' + slotIdx + ',\'' + esc(id) + '\');ShowsV2.aiClosePicker();" style="cursor:pointer;position:relative;border-radius:6px;overflow:hidden;">' +
          '<img src="' + esc(img.url || img.thumbnailUrl || '') + '" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">' +
          (img.productName ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:white;font-size:0.72rem;padding:2px 4px;">' + esc(img.productName) + '</div>' : '') +
          '</div>';
      }).join('');
      var hint = showingAll
        ? '<div class="mu-sub" style="margin-bottom:8px;">No application photos marked — showing all gallery images.</div>'
        : '<div class="mu-sub" style="margin-bottom:8px;color:var(--amber);">⭐ ' + appIds.length + ' application photo' + (appIds.length !== 1 ? 's' : '') + '</div>';
      var removeBtn = V2.ai.images[slotIdx]
        ? '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="ShowsV2.aiAssignImage(' + slotIdx + ',null);ShowsV2.aiClosePicker();">Remove</button>' : '';
      var inner = hint + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">' + grid + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-secondary btn-small" onclick="ShowsV2.aiClosePicker()">Cancel</button>' + removeBtn + '</div>';
      // Render the picker inline (replaces the step body) — no separate modal needed.
      var el = document.getElementById('showsV2AiStep');
      if (el) el.innerHTML = U.card('Select image', inner);
    },
    aiClosePicker: function () { rerenderAiStep(); },
    aiAssignImage: function (slotIdx, imageId) {
      if (imageId) {
        V2.ai.images[slotIdx] = imageId;
        // Seed an application description from the linked/named product, if empty
        // (mirrors the legacy auto-seed). Persist via the bridge (NO raw write).
        var img = imageLib()[imageId];
        if (img && !img.applicationDescription) {
          var prods = productData();
          var desc = '';
          if (img.productId) { var p = prods.filter(function (x) { return x.pid === img.productId; })[0]; if (p) desc = p.shortDescription || p.description || ''; }
          if (!desc && img.productName) { var p2 = prods.filter(function (x) { return x.name === img.productName; })[0]; if (p2) desc = p2.shortDescription || p2.description || ''; }
          if (desc && bridge() && bridge().setImageAppMeta) {
            img.applicationDescription = desc;
            Promise.resolve(bridge().setImageAppMeta(imageId, { applicationDescription: desc })).catch(function () {});
          }
        }
      } else {
        delete V2.ai.images[slotIdx];
      }
      rerenderAiStep();
    },
    aiSaveSlotDesc: function (slotIdx, value) {
      if (!canEdit()) return notPermitted();
      var b = bridge(); if (!b || !b.setImageAppMeta) return bridgeLoading();
      var imgId = V2.ai.images[slotIdx];
      if (!imgId || imgId === '__profile_booth__') return;
      var img = imageLib()[imgId];
      if (!img) return;
      value = (value || '').trim();
      var patch = { applicationDescription: value || null };
      if (value && !img.applicationPhoto) patch.applicationPhoto = true;
      Promise.resolve(b.setImageAppMeta(imgId, patch)).then(function () {
        img.applicationDescription = value || '';
        if (value && !img.applicationPhoto) img.applicationPhoto = true;
      }).catch(function (e) { toast('Failed to save description: ' + ((e && e.message) || e), true); });
    },
    aiLinkProduct: function (slotIdx, pid) {
      if (!canEdit()) return notPermitted();
      var b = bridge(); if (!b || !b.setImageAppMeta) return bridgeLoading();
      var imgId = V2.ai.images[slotIdx];
      if (!imgId || imgId === '__profile_booth__') return;
      var img = imageLib()[imgId];
      if (!img) return;
      var product = pid ? productData().filter(function (x) { return x.pid === pid; })[0] : null;
      if (pid && product) {
        Promise.resolve(b.setImageAppMeta(imgId, { productId: pid, productName: product.name || '' })).then(function () {
          img.productId = pid; img.productName = product.name || '';
          var ta = document.getElementById('showV2AiDesc_' + slotIdx);
          if (ta && !ta.value.trim()) {
            var desc = product.shortDescription || product.description || '';
            if (desc) {
              ta.value = desc; img.applicationDescription = desc;
              Promise.resolve(b.setImageAppMeta(imgId, { applicationDescription: desc })).catch(function () {});
            }
          }
          toast('Linked to ' + product.name);
        }).catch(actionErr);
      } else {
        Promise.resolve(b.setImageAppMeta(imgId, { productId: null, productName: null })).then(function () {
          delete img.productId; delete img.productName;
        }).catch(actionErr);
      }
    },

    // ── Step 3: Auto-Map — capture the (possibly edited) field values into the
    // mapping before advancing (mirrors the legacy showsAISaveMapping). No write.
    aiSaveMappingAndStep: function (step) {
      var fields = (V2.ai.parsed || {}).fields || [];
      fields.forEach(function (f) {
        var ta = document.getElementById('showV2AiMap_' + String(f.name).replace(/\s+/g, '_'));
        if (ta && V2.ai.mapping && V2.ai.mapping[f.name]) V2.ai.mapping[f.name].value = ta.value;
      });
      V2.ai.step = step; rerenderAiBody();
    },

    // ── Step 4: Gap Analysis — inline profile backfill. Lets the maker patch a
    // missing profile field without leaving the builder; the WRITE goes through
    // ShowsBridge.saveProfile, then the mapping is rebuilt and gaps recomputed.
    aiFixProfileGap: function () {
      if (!canEdit()) return notPermitted();
      var b = bridge(); if (!b || !b.saveProfile) return bridgeLoading();
      Promise.resolve(window.mastPrompt ? window.mastPrompt('Your artist bio / statement (used to fill applications):', { title: 'Studio Profile', defaultValue: aiProfile().bio || '' }) : null).then(function (bio) {
        if (bio == null) return;
        bio = String(bio).trim();
        Promise.resolve(b.saveProfile({ bio: bio })).then(function () {
          V2.ai.profile = Object.assign({}, V2.ai.profile, { bio: bio });
          // Rebuild the mapping with the fresh profile then recompute gaps.
          V2.ai.mapping = aiBuildMapping();
          toast('Profile updated.');
          rerenderAiStep();
        }).catch(actionErr);
      });
    },

    // ── Step 5: Preview — sequential copy + AI-draft + launch + photo download.
    aiCopyField: function (idx) {
      var fields = (V2.ai.parsed || {}).fields || [];
      var f = fields[idx];
      if (!f) return;
      var val = (V2.ai.mapping[f.name] || {}).value || '';
      if (!val) return;
      navigator.clipboard.writeText(val).then(function () {
        V2.ai.copyIdx = idx + 1;
        toast('Copied: ' + f.name);
        rerenderAiStep();
        var next = document.getElementById('showV2AiField_' + (idx + 1));
        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(function () { toast('Copy failed — select manually', true); });
    },
    aiLaunchApp: function () {
      var s = aiShow();
      var url = s.applicationUrl || '';
      if (!url) { toast('No application URL set.', true); return; }
      var fields = (V2.ai.parsed || {}).fields || [];
      var f = fields[Math.max(0, V2.ai.copyIdx)];
      if (f) {
        var val = (V2.ai.mapping[f.name] || {}).value || '';
        if (val) {
          navigator.clipboard.writeText(val).then(function () {
            V2.ai.copyIdx = Math.max(0, V2.ai.copyIdx) + 1;
            toast('Copied "' + f.name + '" — paste it in the form');
            rerenderAiStep();
          }).catch(function () {});
        }
      }
      window.open(url, '_blank');
    },
    aiDownloadPhoto: function (url, slotName) {
      toast('Downloading…');
      fetch(url).then(function (resp) { return resp.blob(); }).then(function (blob) {
        var ext = blob.type.indexOf('png') >= 0 ? '.png' : '.jpg';
        var filename = String(slotName || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-') + ext;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toast('Downloaded: ' + filename);
      }).catch(function () { window.open(url, '_blank'); toast('Opened in new tab — right-click to save'); });
    },
    // aiDraft() — Step 5 AI-draft: ask /studioAssistant to fill the still-empty
    // required fields. Token-metered (402 → coin purchase); a 500 (no Anthropic key
    // on sgtest15) surfaces gracefully. The answer JSON patches V2.ai.mapping in
    // place (no write — the draft is persisted only when the maker hits Save).
    aiDraft: function () {
      var w = aiWallet();
      if (w.status === 'suspended') { toast('AI suspended. Purchase coins to continue.', true); aiBuyCoins(); return; }
      var s = aiShow();
      var fields = (V2.ai.parsed || {}).fields || [];
      var profile = aiProfile();
      var missing = fields.filter(function (f) { return !((V2.ai.mapping[f.name] || {}).value || '').trim(); });
      if (!missing.length) { toast('All fields already have values.'); return; }
      V2.ai.busy = true; rerenderAiStep();
      var done = function () { V2.ai.busy = false; rerenderAiStep(); };
      var prompt = 'You are helping a maker draft answers for a craft-show application to "' + (s.name || 'a show') + '".\n' +
        'Studio profile: ' + JSON.stringify({ name: profile.name, bio: profile.bio, materials: profile.materials, processDescription: profile.processDescription, category: profile.category, priceRange: profile.priceRange }) + '\n' +
        'Draft a concise, authentic answer for each of these application fields:\n' +
        missing.map(function (f) { return '- ' + f.name + (f.description ? ' (' + f.description + ')' : ''); }).join('\n') +
        '\n\nReturn ONLY a JSON object mapping each exact field name to its drafted string answer. No markdown.';
      var run = function (token) {
        return callCF('/studioAssistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ question: prompt, assistantContext: 'show-apply-draft-application' })
        }).then(function (resp) {
          if (resp.status === 402) { toast('Token balance exhausted. Purchase coins to continue.', true); aiBuyCoins(); done(); return; }
          return resp.json().catch(function () { return {}; }).then(function (data) {
            if (!resp.ok) throw new Error((data && data.error) || ('Draft failed (' + resp.status + ')'));
            var answer = (data && data.answer) || '';
            var drafted = null;
            try { drafted = JSON.parse(answer.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()); } catch (e) { drafted = null; }
            if (drafted && typeof drafted === 'object') {
              var n = 0;
              missing.forEach(function (f) {
                if (drafted[f.name] && V2.ai.mapping[f.name]) { V2.ai.mapping[f.name].value = String(drafted[f.name]); n++; }
              });
              toast(n ? ('Drafted ' + n + ' field' + (n !== 1 ? 's' : '') + '.') : 'No draftable fields returned.');
            } else {
              toast('AI returned an unparseable draft — fill in manually.', true);
            }
            done();
          });
        });
      };
      try {
        window.auth.currentUser.getIdToken().then(run).catch(function (e) { toast('Draft failed: ' + ((e && e.message) || e), true); done(); });
      } catch (e) { toast('Draft failed: ' + ((e && e.message) || e), true); done(); }
    },

    // ── Step 6: Save — persist the draft via ShowsBridge.saveApplication (the
    // ONLY draft write path). Captures the assembled blob (parsed reqs + mapping +
    // gaps + image assignments) like the legacy showsAISaveApp, updates an existing
    // draft when resuming, then returns to the select-show screen.
    aiSaveApp: function () {
      if (!canEdit()) return notPermitted();
      var b = bridge(); if (!b || !b.saveApplication) return bridgeLoading();
      var s = aiShow();
      var appData = {
        showId: V2.ai.showId,
        showName: s.name || '',
        parsedRequirements: V2.ai.parsed,
        fieldMapping: V2.ai.mapping,
        gapAnalysis: V2.ai.gaps,
        imageAssignments: V2.ai.images,
        status: 'draft',
        createdAt: (V2.ai.currentApp && V2.ai.currentApp.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (V2.ai.currentApp && V2.ai.currentApp.id) appData.id = V2.ai.currentApp.id;
      Promise.resolve(b.saveApplication(appData)).then(function (key) {
        // Patch the local cache so the select-show screen's "Saved packages" reflects it.
        V2.ai.applications = V2.ai.applications || {};
        var stored = Object.assign({}, appData); delete stored.id;
        V2.ai.applications[key] = stored;
        V2.ai.currentApp = Object.assign({ id: key }, stored);
        toast('Application package saved.');
        V2.ai.step = 0; V2.ai.showId = null;
        rerenderAiBody();
      }).catch(actionErr);
    },

    // ════════════════════════════════════════════════════════════════════
    // PR4 — Prep / Execute / History detail sub-editors. Every WRITE goes
    // through window.ShowsBridge (the same DOM-free cores the legacy handlers
    // call); gated can('show-prep','edit'); after each write we re-fetch the
    // record + re-render the affected pane in place (refreshThenRerender). NO
    // raw MastDB writes here.
    // ════════════════════════════════════════════════════════════════════

    // ── Prep: staffing ──
    staffAdd: function (id) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var uid = (document.getElementById('showV2StaffUid') || {}).value || '';
      var role = (document.getElementById('showV2StaffRole') || {}).value || 'support';
      if (!uid) { toast('Pick a team member.', true); return; }
      var u = teamMembers()[uid] || {};
      var name = u.name || u.email || uid;
      Promise.resolve(b.setStaffing(id, uid, { name: name, showRole: role })).then(function () {
        toast(name + ' assigned as ' + role + '.');
        refreshThenRerender(id, ['prep']);
      }).catch(actionErr);
    },
    staffRemove: function (id, uid) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var go = function () {
        Promise.resolve(b.removeStaffing(id, uid)).then(function () { toast('Staff removed.'); refreshThenRerender(id, ['prep']); }).catch(actionErr);
      };
      mastConfirmThen('Remove this staff member from the show?', { title: 'Remove Staff' }, go);
    },

    // ── Prep: inventory ──
    invAdd: function (id) { var s = V2.byId[id]; if (s) rerenderPane('prep', inventoryForm(s, null)); },
    invEdit: function (id, itemId) { var s = V2.byId[id]; if (s) rerenderPane('prep', inventoryForm(s, itemId)); },
    prepCancel: function (id) { rerenderPaneFor(id, 'prep'); },
    invSave: function (id, itemId) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var name = ((document.getElementById('showV2InvName') || {}).value || '').trim();
      if (!name) { toast('Item name is required.', true); return; }
      var qty = parseInt((document.getElementById('showV2InvQty') || {}).value, 10);
      var item = {
        itemId: itemId || null,
        name: name,
        quantity: isNaN(qty) ? null : qty,
        linkedMakeJob: ((document.getElementById('showV2InvJob') || {}).value || '').trim() || null,
        notes: ((document.getElementById('showV2InvNotes') || {}).value || '').trim() || null
      };
      Promise.resolve(b.upsertInventory(id, item, V2.byId[id])).then(function () {
        toast(itemId ? 'Item updated.' : 'Item added.');
        refreshThenRerender(id, ['prep', 'execute']); // recon table reads packed prep items
      }).catch(actionErr);
    },
    invPacked: function (id, itemId, checked) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      Promise.resolve(b.setPacked(id, itemId, !!checked)).then(function () {
        refreshThenRerender(id, ['prep', 'execute']); // packed flag gates the recon list
      }).catch(actionErr);
    },
    invRemove: function (id, itemId) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var go = function () {
        Promise.resolve(b.removeInventory(id, itemId)).then(function () { toast('Item removed.'); refreshThenRerender(id, ['prep', 'execute']); }).catch(actionErr);
      };
      mastConfirmThen('Remove this item from the pull list?', { title: 'Remove Item' }, go);
    },

    // ── Prep: logistics ──
    logEdit: function (id) { var s = V2.byId[id]; if (s) rerenderPane('prep', logisticsForm(s)); },
    logSave: function (id) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var data = {
        boothSize: ((document.getElementById('showV2LogBooth') || {}).value || '').trim() || null,
        setupTime: ((document.getElementById('showV2LogSetup') || {}).value || '').trim() || null,
        teardownTime: ((document.getElementById('showV2LogTeardown') || {}).value || '').trim() || null,
        parkingNotes: ((document.getElementById('showV2LogParking') || {}).value || '').trim() || null,
        hotelNotes: ((document.getElementById('showV2LogHotel') || {}).value || '').trim() || null,
        travelNotes: ((document.getElementById('showV2LogTravel') || {}).value || '').trim() || null,
        notes: ((document.getElementById('showV2LogNotes') || {}).value || '').trim() || null
      };
      Promise.resolve(b.setLogistics(id, data)).then(function () { toast('Logistics saved.'); refreshThenRerender(id, ['prep']); }).catch(actionErr);
    },

    // ── Execute: day-picker (multi-day) ──
    execDay: function (id, date) { V2.execDate = date; rerenderPaneFor(id, 'execute'); },

    // ── Execute: sales ──
    saleAdd: function (id) { var s = V2.byId[id]; if (s) rerenderPane('execute', saleForm(s, null)); },
    saleEdit: function (id, saleId) { var s = V2.byId[id]; if (s) rerenderPane('execute', saleForm(s, saleId)); },
    execCancel: function (id) { rerenderPaneFor(id, 'execute'); },
    saleSave: function (id, saleId) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var desc = ((document.getElementById('showV2SaleDesc') || {}).value || '').trim();
      if (!desc) { toast('Item description is required.', true); return; }
      var priceCents = dollarsToCents((document.getElementById('showV2SalePrice') || {}).value);
      if (priceCents == null) { toast('Valid sale price is required.', true); return; }
      var s = V2.byId[id];
      var multiDay = isMultiDay(s);
      var date = multiDay ? (V2.execDate || V2.today) : null;
      var timeVal = (document.getElementById('showV2SaleTime') || {}).value || '12:00';
      var ts = new Date((date || V2.today) + 'T' + timeVal + ':00').toISOString();
      var sale = {
        saleId: saleId || null,
        description: desc,
        priceCents: priceCents,
        paymentMethod: (document.getElementById('showV2SaleMethod') || {}).value || 'cash',
        linkedProductId: (document.getElementById('showV2SaleProduct') || {}).value || null,
        timestamp: ts
      };
      Promise.resolve(b.upsertSale(id, date, sale, s)).then(function () {
        toast(saleId ? 'Sale updated.' : 'Sale recorded.');
        refreshThenRerender(id, ['execute', 'history']); // P&L revenue recomputes
      }).catch(actionErr);
    },
    saleRemove: function (id, saleId) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var s = V2.byId[id];
      var date = isMultiDay(s) ? (V2.execDate || V2.today) : null;
      var go = function () {
        Promise.resolve(b.removeSale(id, date, saleId, s)).then(function () { toast('Sale deleted.'); refreshThenRerender(id, ['execute', 'history']); }).catch(actionErr);
      };
      mastConfirmThen('Delete this sale record?', { title: 'Delete Sale', danger: true }, go);
    },

    // ── Execute: reconciliation (delta stepper → absolute count) ──
    recon: function (id, itemId, field, delta) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var s = V2.byId[id];
      var cur = (s && s.execute && s.execute.reconciliation && s.execute.reconciliation[itemId] && s.execute.reconciliation[itemId][field]) || 0;
      var next = Math.max(0, cur + Number(delta));
      Promise.resolve(b.setReconCount(id, itemId, field, next)).then(function () {
        refreshThenRerender(id, ['execute', 'history']); // items-sold tally on summary
      }).catch(actionErr);
    },

    // ── Execute: per-day notes ──
    notesSave: function (id) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var s = V2.byId[id];
      var date = isMultiDay(s) ? (V2.execDate || V2.today) : null;
      var text = ((document.getElementById('showV2Notes') || {}).value || '').trim();
      Promise.resolve(b.setNotes(id, date, text, s)).then(function () { toast('Notes saved.'); refreshThenRerender(id, ['execute']); }).catch(actionErr);
    },

    // ── History: expenses ──
    expAdd: function (id) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var desc = ((document.getElementById('showV2ExpDesc') || {}).value || '').trim();
      if (!desc) { toast('Expense description is required.', true); return; }
      var amountCents = dollarsToCents((document.getElementById('showV2ExpAmt') || {}).value);
      if (amountCents == null) { toast('Valid expense amount is required.', true); return; }
      Promise.resolve(b.upsertExpense(id, { description: desc, amountCents: amountCents })).then(function () {
        toast('Expense added.');
        refreshThenRerender(id, ['history']); // P&L costs recompute
      }).catch(actionErr);
    },
    expRemove: function (id, expId) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var go = function () {
        Promise.resolve(b.removeExpense(id, expId)).then(function () { toast('Expense deleted.'); refreshThenRerender(id, ['history']); }).catch(actionErr);
      };
      mastConfirmThen('Delete this expense?', { title: 'Delete Expense', danger: true }, go);
    },

    // ── History: review (rating picker + attend toggle held in hidden inputs) ──
    reviewStar: function (val) {
      var hidden = document.getElementById('showV2ReviewRating'); if (hidden) hidden.value = val;
      var stars = document.querySelectorAll('#showV2ReviewStars .showV2-star');
      stars.forEach(function (st) {
        var sv = parseInt(st.getAttribute('data-value'), 10);
        st.style.color = sv <= val ? 'var(--amber)' : 'var(--warm-gray)';
      });
    },
    reviewAttend: function (val) {
      var hidden = document.getElementById('showV2ReviewAttendVal'); if (hidden) hidden.value = val;
      var btns = document.querySelectorAll('#showV2ReviewAttend .showV2-attend');
      btns.forEach(function (btn) {
        var on = btn.getAttribute('data-value') === val;
        btn.classList.toggle('btn-primary', on);
        btn.classList.toggle('btn-secondary', !on);
      });
    },
    reviewSave: function (id) {
      if (!canEdit()) return notPermitted();
      var b = curBridge(); if (!b) return;
      var rating = parseInt((document.getElementById('showV2ReviewRating') || {}).value, 10) || null;
      var review = {
        rating: rating,
        wouldAttendAgain: (document.getElementById('showV2ReviewAttendVal') || {}).value || null,
        bestSellers: ((document.getElementById('showV2ReviewBest') || {}).value || '').trim() || null,
        lessonsLearned: ((document.getElementById('showV2ReviewLessons') || {}).value || '').trim() || null
      };
      Promise.resolve(b.setReview(id, review)).then(function () { toast('Review saved.'); refreshThenRerender(id, ['history']); }).catch(actionErr);
    },

    exportCsv: function () { return MastEntity.exportRows('shows-v2', visibleRows(), V2.lens); }
  };

  // Small confirm helper — uses mastConfirm when available, else proceeds.
  function mastConfirmThen(msg, opts, onYes) {
    if (typeof window.mastConfirm === 'function') {
      Promise.resolve(window.mastConfirm(msg, opts)).then(function (ok) { if (ok) onYes(); });
    } else { onYes(); }
  }

  // ── Routes ──────────────────────────────────────────────────────────
  // Each lifecycle route enters the matching lens. CUT OVER (PR7): #show /
  // #show-find / #show-apply / … now remap to these twin routes via
  // MAST_V2_ROUTE_MAP for V2 users; an explicit-legacy user (navigateToClassic)
  // still reaches the legacy shows.js routes. Cold-safe: setup runs ensureTab +
  // render + load without assuming legacy shows.js ran.
  function routeSetup(lens) {
    return function () { V2.lens = lens; ensureTab(); render(); load(); };
  }
  MastAdmin.registerModule('shows-v2', {
    routes: {
      'shows-v2':        { tab: 'showsV2Tab', setup: routeSetup('apply') },
      'show-find-v2':    { tab: 'showsV2Tab', setup: routeSetup('find') },
      'show-apply-v2':   { tab: 'showsV2Tab', setup: routeSetup('apply') },
      'show-prep-v2':    { tab: 'showsV2Tab', setup: routeSetup('prep') },
      'show-execute-v2': { tab: 'showsV2Tab', setup: routeSetup('execute') },
      'show-history-v2': { tab: 'showsV2Tab', setup: routeSetup('history') }
    }
  });
})();
