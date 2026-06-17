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
 * admin/shows/{id} write paths. The prep/execute/history sub-editors (PR4-6), the
 * Find lens /showFinder (PR7) and the AI builder (PR8) remain read-only for now.
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
 * directly. Flag-gated (?ui=1). Routes are REGISTERED but intentionally NOT in
 * MAST_V2_ROUTE_MAP yet — reachable by direct hash (#shows-v2) for QA; cutover is
 * a later PR.
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
      // Read-only interior (classes-v2 / orders-v2 custom-render pattern): the four
      // legacy renderShowDetail* sections (Info / Prep / Execute / History) mapped
      // 1:1 to read-only pane-tabs. NO write actions (later PRs wire those through
      // ShowsBridge).
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
          // Refresh the cache then land in the new show's read detail.
          V2.loaded = false;
          return ensureLoaded().then(function () {
            render();
            var rec2 = V2.byId[id];
            if (rec2) MastEntity.openRecord('shows-v2', rec2, 'read');
            return true;
          });
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

  // Prep — staffing + inventory pull list + logistics (read-only).
  function renderPrepPane(UI, s) {
    var prep = s.prep || {};
    var out = '';

    // Staffing
    var staffing = prep.staffing || {};
    var staffKeys = Object.keys(staffing);
    var staffBody;
    if (!staffKeys.length) {
      staffBody = '<span class="mu-sub">No staff assigned yet.</span>';
    } else {
      staffBody = UI.relatedTable([
        { label: 'Name', render: function (r) { return esc(r.name || 'Unknown'); } },
        { label: 'Role', render: function (r) {
            var role = (r.showRole || 'support');
            var tone = role === 'lead' ? 'teal' : role === 'driver' ? 'info' : 'neutral';
            return UI.badge(role.charAt(0).toUpperCase() + role.slice(1), tone);
        } }
      ], staffKeys.map(function (uid) { return Object.assign({ _uid: uid }, staffing[uid]); }));
    }
    out += UI.cardTable('Staffing', staffBody);

    // Inventory pull list
    var inventory = prep.inventory || {};
    var invKeys = Object.keys(inventory);
    var invBody;
    if (!invKeys.length) {
      invBody = '<span class="mu-sub">No items in pull list yet.</span>';
    } else {
      var packedCount = invKeys.filter(function (k) { return inventory[k].packed; }).length;
      invBody = UI.relatedTable([
        { label: 'Item', render: function (r) {
            var meta = [];
            if (r.notes) meta.push(esc(r.notes));
            if (r.linkedMakeJob) meta.push('🔗 Linked to Make');
            return '<div style="font-weight:500;">' + esc(r.name || 'Unnamed Item') + '</div>' +
              (meta.length ? '<div class="mu-sub">' + meta.join(' · ') + '</div>' : '');
        } },
        { label: 'Qty', align: 'right', render: function (r) { return r.quantity != null ? esc(r.quantity) : '—'; } },
        { label: 'Packed', render: function (r) { return r.packed ? UI.badge('Packed', 'success') : UI.badge('Not packed', 'neutral'); } }
      ], invKeys.map(function (k) { return Object.assign({ _itemId: k }, inventory[k]); }));
      invBody = '<div class="mu-sub" style="margin-bottom:6px;">' + N.count(packedCount) + ' of ' + N.count(invKeys.length) + ' items packed</div>' + invBody;
    }
    out += UI.cardTable('Inventory pull list', invBody);

    // Logistics
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
    out += UI.card('Logistics', logBody);
    return out;
  }

  // Execute — sales log (whole show), inventory reconciliation, show notes.
  // (The detail SO is read-only and date-agnostic; it tallies ALL sales across
  // the show rather than the day-picker the legacy execute view uses.)
  function renderExecutePane(UI, s) {
    var exec = s.execute || {};
    var multiDay = isMultiDay(s);
    var out = '';

    // Flatten sales across all days (multi-day = sales[date][saleId]; single-day =
    // sales[saleId], excluding any stray YYYY-MM-DD date sub-keys).
    var allSales = [];
    var sales = exec.sales || {};
    if (multiDay) {
      getShowDates(s).forEach(function (dt) {
        var ds = sales[dt] || {};
        Object.keys(ds).forEach(function (k) { allSales.push(Object.assign({ _key: k, _date: dt }, ds[k])); });
      });
    } else {
      Object.keys(sales).forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
        allSales.push(Object.assign({ _key: k }, sales[k]));
      });
    }
    allSales.sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });

    var salesBody;
    if (!allSales.length) {
      salesBody = '<span class="mu-sub">No sales recorded yet.</span>';
    } else {
      var totalCents = allSales.reduce(function (sum, sl) { return sum + (sl.priceCents || 0); }, 0);
      var stat = UI.tiles([
        { k: 'Revenue', v: N.money(N.moneyVal({ totalCents: totalCents }, 'totalCents', null)) || '—', hero: true },
        { k: 'Sales', v: N.count(allSales.length) }
      ]);
      var table = UI.relatedTable([
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
      ], allSales);
      salesBody = stat + table;
    }
    out += UI.cardTable('Sales log', salesBody);

    // Inventory reconciliation (per packed prep item: sold/returned/damaged/gifted).
    var prepInventory = (s.prep && s.prep.inventory) || {};
    var reconciliation = exec.reconciliation || {};
    var prepKeys = Object.keys(prepInventory).filter(function (k) { return prepInventory[k].packed; });
    var reconBody;
    if (!Object.keys(prepInventory).length) {
      reconBody = '<span class="mu-sub">No prep inventory items to reconcile.</span>';
    } else if (!prepKeys.length) {
      reconBody = '<span class="mu-sub">No packed items to reconcile yet.</span>';
    } else {
      reconBody = UI.relatedTable([
        { label: 'Item', render: function (r) { return esc(r.name || 'Item'); } },
        { label: 'Brought', align: 'right', render: function (r) { return N.count(r.quantity || 1); } },
        { label: 'Sold', align: 'right', render: function (r) { return N.count((r._recon.sold) || 0); } },
        { label: 'Returned', align: 'right', render: function (r) { return N.count((r._recon.returned) || 0); } },
        { label: 'Damaged', align: 'right', render: function (r) { return N.count((r._recon.damaged) || 0); } },
        { label: 'Gifted', align: 'right', render: function (r) { return N.count((r._recon.gifted) || 0); } }
      ], prepKeys.map(function (k) { return Object.assign({ _itemId: k, _recon: reconciliation[k] || {} }, prepInventory[k]); }));
    }
    out += UI.cardTable('Inventory reconciliation', reconBody);

    // Show notes (single-day: notes._default or string; multi-day: per-date blocks).
    var notes = exec.notes || {};
    var notesBody;
    if (multiDay) {
      var blocks = '';
      getShowDates(s).forEach(function (dt) {
        var txt = notes[dt];
        if (!txt) return;
        var dayLabel = new Date(dt + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        blocks += '<div style="margin-bottom:8px;"><div class="mu-sub" style="margin-bottom:4px;">' + esc(dayLabel) + '</div>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(txt) + '</div></div>';
      });
      notesBody = blocks || '<span class="mu-sub">No notes yet.</span>';
    } else {
      var single = typeof notes === 'string' ? notes : (notes._default || '');
      notesBody = single
        ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(single) + '</div>'
        : '<span class="mu-sub">No notes yet.</span>';
    }
    out += UI.card('Show notes', notesBody);
    return out;
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

    // Show review
    var review = historyData.review || {};
    var reviewBody;
    if (!review.rating && !review.wouldAttendAgain && !review.bestSellers && !review.lessonsLearned) {
      reviewBody = '<span class="mu-sub">No review yet.</span>';
    } else {
      var rPairs = [];
      if (review.rating) {
        var stars = '';
        for (var i = 1; i <= 5; i++) stars += (i <= review.rating ? '★' : '☆');
        rPairs.push({ k: 'Rating', v: '<span style="color:var(--amber);">' + stars + '</span>' });
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

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, today: todayStr(), sortKey: 'name', sortDir: 'asc', q: '', lens: 'apply', loaded: false, current: null };

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

    // Find lens — placeholder this PR (the /showFinder AI form + results land later).
    if (V2.lens === 'find') {
      tab.innerHTML = U.pageHeader({ title: 'Shows', count: 'find new shows', actionsHtml: newShowBtn }) + lensPills +
        U.card('Find shows', '<span class="mu-sub">AI show discovery lands in a later PR. For now, add a show with <strong>+ New show</strong>.</span>');
      return;
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

  window.ShowsV2 = {
    lens: function (lens) { V2.lens = lens; render(); },
    search: function (v) { V2.q = v; render(); },
    sort: function (key, dir) { V2.sortKey = key; V2.sortDir = dir; render(); },
    open: function (id) {
      V2.current = id;
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
    exportCsv: function () { return MastEntity.exportRows('shows-v2', visibleRows(), V2.lens); }
  };

  // ── Routes ──────────────────────────────────────────────────────────
  // Each lifecycle route enters the matching lens. REGISTERED here, but
  // intentionally NOT added to MAST_V2_ROUTE_MAP yet (#show etc. still resolve to
  // the legacy shows.js) — reachable by direct hash (#shows-v2 / #show-apply-v2 …)
  // for QA; cutover is a later PR. Cold-safe: setup runs ensureTab + render + load
  // without assuming legacy shows.js ran.
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
