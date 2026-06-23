/**
 * audit-v2.js — Channel Audit, V2 (queue archetype, standard-record-ui §10).
 *
 * The queue over audit_results: cross-channel consistency findings written by
 * the platform audit job (the UI never creates findings). Buckets slice by
 * working state — Open (active, not suppressed) / Snoozed / Rechecking
 * (resolved-pending-recheck) / Suppressed. Rows are WORK: row click opens the
 * finding's record SO; the SO carries the actions.
 *
 * ALL state writes delegate to window.AuditFeedback (audit-feedback.js — the
 * J12 shared core; playbook §4, never re-implement a write):
 *   markResolved / snooze / suppressRule
 * Suppression matching is the SAME shared matcher legacy #audit uses
 * (AuditFeedback.matchesSuppression). The snooze/suppress dialogs are the
 * shared AuditFeedbackUI primitives — one UX for both surfaces.
 *
 * State vocab = shared/types/audit.ts AuditViolationState:
 * 'active' | 'snoozed' | 'resolved-pending-recheck' (wedge-audit lesson —
 * never invent states). Expired snoozes read back as active, like audit.js.
 *
 * Data (sgtest15 shape audit 2026-06-10):
 *   audit_results/{ruleId}__{productId|tenant}__{listingId} — { ruleId, title,
 *     detail, suggestion, severity:'warning'|…, state, tier, channels[],
 *     productId, listingId, firstSeenAt, lastSeenAt, snoozeUntil }
 *   rule_suppressions via AuditFeedback.listSuppressions().
 * Flag-gated (?ui=1) at #audit-v2, side-by-side with legacy #audit.
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

  var SEVERITY_TONE = { high: 'danger', warning: 'amber', medium: 'amber', low: 'info', info: 'info' };
  var CATEGORY_LABEL = { lq: 'Listing quality', drift: 'Cross-channel drift', pricing: 'Pricing & positioning' };
  var STATE_LABEL = { active: 'Open', snoozed: 'Snoozed', 'resolved-pending-recheck': 'Rechecking' };
  var STATE_TONE = { active: 'amber', snoozed: 'neutral', 'resolved-pending-recheck': 'teal' };
  var CHANNEL_TONE = { shopify: 'teal', etsy: 'amber', square: 'info' };

  // 'muted' is a RULES lens, not a findings bucket: it lists the
  // rule_suppressions causing the Suppressed bucket, with per-row un-suppress
  // (absorbed from the retired audit-suppressions-v2 twin — one pipeline).
  var BUCKETS = [['open', 'Open'], ['snoozed', 'Snoozed'], ['recheck', 'Rechecking'], ['suppressed', 'Suppressed'], ['muted', 'Muted rules'], ['all', 'All']];

  var V2 = {
    rows: [], byId: {}, suppressions: [], productsById: {},
    sortKey: 'lastSeenAt', sortDir: 'desc', bucket: 'open', loaded: false, busy: {}
  };

  function core() { return window.AuditFeedback || null; }
  function canEdit() { return typeof window.can !== 'function' || window.can('audit', 'edit'); }

  function categoryOf(v) {
    var c = core();
    return c && c.violationCategoryOf ? c.violationCategoryOf(v) : (v.category || 'lq');
  }
  function isSuppressed(v) {
    var c = core();
    return !!(c && c.matchesSuppression && c.matchesSuppression(v, V2.suppressions));
  }
  function bucketOf(v) {
    if (v.state === 'snoozed') return 'snoozed';
    if (v.state === 'resolved-pending-recheck') return 'recheck';
    return isSuppressed(v) ? 'suppressed' : 'open';
  }
  function productTitle(v) {
    var p = v.productId ? V2.productsById[v.productId] : null;
    return p ? (p.title || p.name || v.productId) : (v.productId || '');
  }
  function channelsOf(v) {
    if (Array.isArray(v.channels) && v.channels.length) return v.channels;
    return v.channel ? [v.channel] : [];
  }
  function ageOf(v) {
    var t = v.firstSeenAt || v.createdAt; if (!t) return null;
    var ms = Date.now() - new Date(t).getTime();
    return isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
  }

  // ── schema — the finding record SO carries the actions ──────────────
  MastEntity.define('audit-v2', {
    label: 'Finding', labelPlural: 'Channel Audit', size: 'md', route: 'audit-v2',
    recordId: function (v) { return v.id; },
    fields: [
      { name: 'title', label: 'Finding', type: 'text', list: true, required: true,
        get: function (v) { return v.title || v.ruleId || 'Audit finding'; } },
      { name: 'product', label: 'Product', type: 'text', list: true, readOnly: true,
        get: function (v) { return productTitle(v) || '—'; } },
      { name: 'channels', label: 'Channels', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (v) { return channelsOf(v).map(function (c) { return c.charAt(0).toUpperCase() + c.slice(1); }).join(', ') || '—'; } },
      { name: 'severity', label: 'Severity', type: 'status', list: true, readOnly: true,
        options: ['high', 'warning', 'medium', 'low', 'info'],
        get: function (v) { return v.severity || 'medium'; },
        tone: function (s) { return SEVERITY_TONE[s] || 'neutral'; } },
      // NOTE: the engine allows at most ONE status-typed field per entity —
      // severity holds it (the badge); state renders as a plain label.
      { name: 'state', label: 'State', type: 'text', list: true, readOnly: true,
        get: function (v) { return STATE_LABEL[v.state] || v.state; } },
      { name: 'lastSeenAt', label: 'Last seen', type: 'date', list: true, readOnly: true,
        get: function (v) { return v.lastSeenAt || v.firstSeenAt || ''; } }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      // Cache-miss fallback keeps cross-record drills working cold.
      return Promise.resolve(MastDB.get('audit_results/' + id)).then(function (r) {
        return r ? normalize(id, r) : null;
      });
    },
    detail: {
      render: function (UI, v) {
        var b = bucketOf(v);
        var days = ageOf(v);
        var tiles = UI.tiles([
          { k: 'Severity', v: UI.badge(v.severity || 'medium', SEVERITY_TONE[v.severity] || 'neutral'), hero: true },
          { k: 'State', v: UI.badge(b === 'suppressed' ? 'Suppressed' : (STATE_LABEL[v.state] || v.state), b === 'suppressed' ? 'neutral' : (STATE_TONE[v.state] || 'neutral')) },
          { k: 'Category', v: esc(CATEGORY_LABEL[categoryOf(v)] || '—') },
          { k: 'Age', v: days === null ? '—' : (days === 0 ? 'today' : days + 'd') }
        ]);

        var what = UI.card('What we found', UI.kv([
          { k: 'Rule', v: esc(v.ruleId || '—') },
          { k: 'Detail', v: esc(v.detail || '—') },
          { k: 'Suggestion', v: esc(v.suggestion || '—') },
          { k: 'Channels', v: channelsOf(v).map(function (c) {
              return UI.badge(c.charAt(0).toUpperCase() + c.slice(1), CHANNEL_TONE[c] || 'neutral');
            }).join(' ') || '—' },
          { k: 'First seen', v: esc(v.firstSeenAt ? String(v.firstSeenAt).slice(0, 10) : '—') },
          { k: 'Last seen', v: esc(v.lastSeenAt ? String(v.lastSeenAt).slice(0, 10) : '—') },
          v.state === 'snoozed' && v.snoozeUntil
            ? { k: 'Snoozed until', v: esc(String(v.snoozeUntil).slice(0, 10)) } : null
        ].filter(Boolean)));

        var subject = UI.card('Where', UI.kv([
          { k: 'Product', v: v.productId ? MastEntity.drillLink('products-v2', v.productId, productTitle(v) || v.productId) : '—' },
          { k: 'Listing', v: v.listingId ? MastEntity.drillLink('mapping-v2', v.listingId, v.listingId) : '—' }
        ]));

        var actions = '';
        if (canEdit() && v.state === 'active') {
          actions = UI.card('Actions',
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-primary" onclick="AuditV2.resolve(\'' + esc(v.id) + '\')">Mark fixed</button>' +
            '<button class="btn btn-secondary" onclick="AuditV2.snooze(this,\'' + esc(v.id) + '\')">Snooze…</button>' +
            '<button class="btn btn-secondary" onclick="AuditV2.suppress(\'' + esc(v.id) + '\')">Suppress rule…</button>' +
            '</div>' +
            '<div class="mu-sub" style="margin-top:10px;">“Mark fixed” asks the next audit run to re-check; suppressing silences the rule for this product, its category, or everywhere.</div>');
        }
        return tiles + what + subject + actions;
      }
      // No onSave → no Edit button: findings are job-written; the actions
      // above are the only legitimate mutations.
    }
  });

  // ── data — normalize EXACTLY like audit.js _loadViolations ──────────
  function normalize(id, d) {
    var state = d.state || 'active';
    if (state === 'snoozed' && d.snoozeUntil) {
      var t = Date.parse(d.snoozeUntil);
      if (isFinite(t) && t <= Date.now()) state = 'active';
    }
    return {
      id: id,
      ruleId: d.ruleId || '', productId: d.productId || '', listingId: d.listingId || '',
      channels: Array.isArray(d.channels) ? d.channels.slice() : [], channel: d.channel || '',
      severity: d.severity || 'medium', tier: d.tier || 'push', category: d.category || '',
      title: d.title || d.message || '', detail: d.detail || d.description || '',
      suggestion: d.suggestion || '',
      createdAt: d.createdAt || '', firstSeenAt: d.firstSeenAt || d.createdAt || '',
      lastSeenAt: d.lastSeenAt || '',
      state: state, snoozeUntil: d.snoozeUntil || null, dismissCount: d.dismissCount || 0
    };
  }
  function load() {
    var c = core();
    Promise.all([
      Promise.resolve(MastDB.get('audit_results')),
      c && c.listSuppressions ? c.listSuppressions() : Promise.resolve([]),
      Promise.resolve(MastDB.get('public/products'))
    ]).then(function (res) {
      V2.rows = [];
      Object.keys(res[0] || {}).forEach(function (id) {
        var d = res[0][id];
        if (d && typeof d === 'object') V2.rows.push(normalize(id, d));
      });
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r.id] = r; });
      V2.suppressions = Array.isArray(res[1]) ? res[1] : [];
      V2.productsById = {};
      Object.keys(res[2] || {}).forEach(function (pid) {
        var p = res[2][pid];
        if (p && typeof p === 'object') V2.productsById[pid] = p;
      });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[audit-v2] load', e); V2.loaded = true; render(); });
  }

  function counts() {
    var c = { all: V2.rows.length, open: 0, snoozed: 0, recheck: 0, suppressed: 0 };
    V2.rows.forEach(function (v) { c[bucketOf(v)]++; });
    c.muted = V2.suppressions.length;
    return c;
  }

  // ── Muted rules lens (absorbed suppression-rules manager) ───────────
  function reasonLabel(id) {
    var list = (core() && core().SUPPRESSION_REASONS) || [];
    var r = list.filter(function (x) { return x.id === id; })[0];
    return r ? r.label : (id || '—');
  }
  function scopeLabel(s) {
    var list = (core() && core().SUPPRESSION_SCOPES) || [];
    var r = list.filter(function (x) { return x.id === s.scope; })[0];
    var base = r ? r.label : (s.scope || '—');
    return s.scope !== 'tenant' && s.scopeId ? base + ': ' + s.scopeId : base;
  }
  function mutedPane() {
    if (!V2.suppressions.length) {
      return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:24px;text-align:center;color:var(--warm-gray);font-size:0.85rem;">' +
        'No muted rules. Suppressing a finding from its record adds a rule here.</div>';
    }
    var rows = V2.suppressions.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).map(function (s) {
      return '<div style="display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;">' +
        '<span style="flex:0 0 220px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.ruleId || '(unnamed rule)') + '</span>' +
        '<span style="flex:1;color:var(--warm-gray);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(scopeLabel(s)) + ' · ' + esc(reasonLabel(s.reason)) +
          (s.reasonText ? ' — “' + esc(s.reasonText) + '”' : '') + '</span>' +
        '<span style="flex:0 0 110px;color:var(--warm-gray);">' + (s.createdAt ? N.date(s.createdAt) : '—') + '</span>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="AuditV2.unsuppress(\'' + esc(s.id) + '\')">Unmute</button>' +
        '</div>';
    }).join('');
    return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 18px;">' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">Muted rules hide matching findings from the Open queue. Unmuting one rule leaves its batch siblings alone; the findings return on the next audit run.</div>' +
      rows + '</div>';
  }
  function visibleRows() {
    var rows = V2.rows;
    if (V2.bucket !== 'all') rows = rows.filter(function (v) { return bucketOf(v) === V2.bucket; });
    return window.mastSortRows(rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('audit-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('auditV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'auditV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Channel Audit' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var c = counts();
    var pills = BUCKETS.map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="AuditV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      U.pageHeader({ title: 'Channel Audit', count: N.count(c.open) + ' ' + MastFormat.plural(c.open, 'open finding'),
        actionsHtml: '<button class="btn btn-secondary" onclick="AuditV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      (V2.bucket === 'muted' ? mutedPane() :
      MastEntity.renderList('audit-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'AuditV2.sort', onRowClickFnName: 'AuditV2.open',
        empty: V2.bucket === 'open'
          ? { title: 'No open findings', message: 'The audit job scans your channels for price drift, sync gaps, and listing-quality issues — findings land here.' }
          : { title: 'Nothing here', message: 'No findings in this view.' }
      }));
  }

  // ── actions — all writes via AuditFeedback (RBAC-gated) ─────────────
  function gated(fn) {
    if (!canEdit()) { if (window.showToast) showToast('You don’t have permission to do that', true); return; }
    var c = core();
    if (c) return fn(c);
    MastAdmin.loadModule('auditFeedback').then(function () {
      var c2 = core();
      if (c2) fn(c2); else if (window.showToast) showToast('Audit actions unavailable', true);
    });
  }
  function refreshOpen(id) {
    load();
    MastEntity.get('audit-v2').fetch(id).then(function (r) {
      if (r) MastEntity.openRecord('audit-v2', r, 'read', true);
    });
  }

  window.AuditV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    setBucket: function (b) { V2.bucket = b; render(); },
    open: function (id) { var v = V2.byId[id]; if (v) MastEntity.openRecord('audit-v2', v, 'read'); },
    resolve: function (id) {
      var v = V2.byId[id]; if (!v || V2.busy[id]) return;
      gated(function (c) {
        V2.busy[id] = true;
        c.markResolved(id).then(function () {
          delete V2.busy[id];
          if (window.showToast) showToast('Marked fixed — the next audit run re-checks it');
          v.state = 'resolved-pending-recheck';
          refreshOpen(id);
        }).catch(function (e) {
          delete V2.busy[id];
          console.error('[audit-v2] resolve', e);
          if (window.showToast) showToast('Could not update: ' + (e && e.message || e), true);
        });
      });
    },
    snooze: function (anchorEl, id) {
      var v = V2.byId[id]; if (!v || V2.busy[id]) return;
      gated(function (c) {
        if (!(window.AuditFeedbackUI && AuditFeedbackUI.openSnoozeDialog)) return;
        AuditFeedbackUI.openSnoozeDialog(anchorEl, function (durationId) {
          V2.busy[id] = true;
          c.snooze(id, durationId).then(function () {
            delete V2.busy[id];
            if (window.showToast) showToast('Snoozed');
            refreshOpen(id);
          }).catch(function (e) {
            delete V2.busy[id];
            console.error('[audit-v2] snooze', e);
            if (window.showToast) showToast('Could not snooze: ' + (e && e.message || e), true);
          });
        });
      });
    },
    suppress: function (id) {
      var v = V2.byId[id]; if (!v || V2.busy[id]) return;
      gated(function (c) {
        if (!(window.AuditFeedbackUI && AuditFeedbackUI.openSuppressDialog)) return;
        AuditFeedbackUI.openSuppressDialog({
          title: 'Suppress ' + (v.ruleId || 'rule'),
          defaultScope: v.productId ? 'product' : 'tenant',
          onConfirm: function (pick) {
            return c.suppressRule({
              ruleId: v.ruleId,
              scope: pick.scope,
              scopeId: pick.scope === 'product' ? v.productId
                : pick.scope === 'category' ? categoryOf(v) : '*',
              reason: pick.reason,
              reasonText: pick.reasonText
            }).then(function () {
              if (window.showToast) showToast('Suppressed — manage it under Suppression rules');
              refreshOpen(id);
            });
          }
        });
      });
    },
    suppressions: function () {
      // Suppression-rule CRUD is the Muted-rules lens of THIS queue (the
      // standalone audit-suppressions-v2 twin was retired into it).
      V2.bucket = 'muted'; render();
    },
    unsuppress: function (id) {
      gated(function (c) {
        Promise.resolve(mastConfirm('Unmute this rule? Findings it was hiding come back on the next audit run. Other rules from the same batch are unaffected.', { title: 'Unmute rule', danger: true })).then(function (ok) {
          if (!ok) return;
          c.removeSuppression(id).then(function () {
            if (window.showToast) showToast('Rule unmuted — findings return on the next audit run.');
            load();
          }).catch(function (e) {
            console.error('[audit-v2] unsuppress', e);
            if (window.showToast) showToast('Could not unmute: ' + (e && e.message || e), true);
          });
        });
      });
    },
    exportCsv: function () { return MastEntity.exportRows('audit-v2', visibleRows(), V2.bucket); }
  };

  function setupRoute(entryBucket) {
    return function () {
      ensureTab();
      if (entryBucket) V2.bucket = entryBucket;
      // Shared core first so suppression matching + actions are live; render
      // doesn't block on it (counts re-render after load()).
      MastAdmin.loadModule('auditFeedback').then(function () { render(); load(); })
        .catch(function () { render(); load(); });
    };
  }
  MastAdmin.registerModule('audit-v2', {
    routes: {
      'audit-v2': { tab: 'auditV2Tab', setup: setupRoute(null) },
      // Entry route for the absorbed suppression-rules surface: legacy
      // #suppressions remaps here and lands on the Muted-rules lens.
      'audit-muted-v2': { tab: 'auditV2Tab', setup: setupRoute('muted') }
    }
  });
})();
