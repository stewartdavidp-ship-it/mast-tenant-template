/**
 * cs-faqs-v2.js — read-focused Flat/Faceted Record twin of the legacy
 * Customer-Service FAQs surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy customer-service.js (#cs-faqs) renders an FAQ list of cards, each with
 * inline edit/delete/storefront-toggle controls plus an add/edit FORM
 * (renderFaqs / renderPolicyForm / savePolicy). This twin re-hosts ONE thing —
 * the FAQ list to a read detail — on the Entity Engine: a schema-driven list
 * + a read-focused Flat/Faceted Record slide-out (one Overview facet).
 *
 * Variant (doc 17 §1a): an FAQ is a flat Q&A help record (question, answer,
 * slug, storefront-visibility) with NO related collections and NO governed
 * lifecycle — its "status" is the storefrontEnabled boolean (live / hidden),
 * an assigned attribute. So → Flat/Faceted Record, NOT Process/MastFlow. It is
 * genuinely flat, so a single Overview facet is correct — padding it with empty
 * tabs would be worse, not better (doc 17 §1a: don't pad a flat record).
 *
 * DATA (verified against customer-service.js): FAQs are NOT a standalone
 * cs_faqs collection — they are cs_policies rows tagged kind='faq'. The
 * cs_policies collection is SHARED with the Sales -> Policies route, which owns
 * kind='policy' rows. We mirror the legacy partition exactly (kind==='faq', or
 * for legacy rows with no kind, slug NOT matching the policy-slug pattern) so a
 * row shows in exactly one surface. Canonical fields: question (= question ||
 * name), answer (= answer || contentHtml), slug, storefrontEnabled, createdAt,
 * updatedAt. There is no category and no sort-order field in the real data.
 *
 * Read-focused: editing an FAQ (question/answer/slug/storefront toggle, create,
 * delete) stays single-sourced on legacy #cs-faqs via a "manage in classic
 * view" link — no onSave, no edit form here. Flag-gated (?ui=1) at #cs-faqs-v2,
 * side-by-side; never touches customer-service.js.
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

  // Legacy partition (customer-service.js renderFaqs, D2 2026-05-28): cs_policies
  // is shared with Sales -> Policies. The CS surface owns kind='faq'; rows tagged
  // kind='policy' are hidden. Legacy rows with no kind are inferred from slug.
  var POLICY_SLUG_PATTERN = /(^|-)(privacy|terms|cookie|tos|t-c|shipping-policy|return-policy|security|ai-transparency|accessibility|gdpr|ccpa)(-|$)/;
  function isFaqRow(p) {
    if (!p) return false;
    if (p.kind === 'faq') return true;
    if (p.kind === 'policy') return false;
    return !POLICY_SLUG_PATTERN.test(String(p.slug || '').toLowerCase());
  }

  // Canonical read accessors (mirror the legacy backward-compat aliases):
  // question lives on `question` (new) or `name` (old); answer on `answer`
  // (new) or `contentHtml` (old, HTML). A plain-text preview strips tags.
  function questionOf(p) { return p.question || p.name || '(untitled FAQ)'; }
  function answerHtmlOf(p) { return p.answer || p.contentHtml || ''; }
  function answerText(p) {
    return String(answerHtmlOf(p)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? (s.slice(0, n - 1) + '…') : s; }

  // Status = storefront visibility (the only "state" an FAQ carries). Normalized
  // to a label string at load so BOTH the list cell (via get()) and the slide-out
  // header badge (which reads record[statusField.name] RAW) show the same value.
  function statusLabel(p) { return p.storefrontEnabled ? 'Live' : 'Hidden'; }
  function statusTone(v) { return v === 'Live' ? 'success' : 'neutral'; }

  // ── schema (read-only Flat/Faceted Record) ──────────────────────────
  MastEntity.define('cs-faqs-v2', {
    label: 'FAQ', labelPlural: 'FAQs', size: 'md',
    route: 'cs-faqs-v2',
    recordId: function (p) { return p._key || p.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes the real question.
      // The raw `question` property carries the full text (set at load), so the
      // panel title is the full question; the list cell truncates via get().
      { name: 'question', label: 'Question', type: 'text', list: true, readOnly: true, group: 'FAQ',
        get: function (p) { return truncate(questionOf(p), 80); } },
      { name: 'slug', label: 'Slug', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (p) { return p.slug ? ('/' + p.slug) : '—'; } },
      { name: '_status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['Live', 'Hidden'],
        get: function (p) { return statusLabel(p); },
        tone: statusTone },
      { name: 'updated', label: 'Updated', type: 'date', list: true, readOnly: true,
        get: function (p) { return p.updatedAt || p.createdAt || null; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, p) {
        // Vitals: status / slug / created / updated. Status is also the header
        // badge (type:'status' field) — the tile repeats it as a quick-scan vital.
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusLabel(p), statusTone(statusLabel(p))), hero: true },
          { k: 'Slug', v: p.slug ? esc('/' + p.slug) : '—' },
          { k: 'Created', v: p.createdAt ? N.date(p.createdAt) : '—' },
          { k: 'Updated', v: (p.updatedAt || p.createdAt) ? N.date(p.updatedAt || p.createdAt) : '—' }
        ]);
        // Single Overview facet — an FAQ is flat (Q + A + slug + visibility +
        // dates). No related collections to warrant additional facets.
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        var qText = questionOf(p);
        var aText = answerText(p);
        var question = '<div style="font-size:1.0rem;font-weight:600;color:var(--charcoal,var(--text));line-height:1.4;">' + esc(qText) + '</div>';
        var answer = aText
          ? '<div style="font-size:0.9rem;color:var(--warm-gray);line-height:1.55;white-space:pre-wrap;margin-top:10px;">' + esc(aText) + '</div>'
          : '<div class="mu-sub" style="margin-top:10px;">No answer yet.</div>';

        var meta = UI.kv([
          { k: 'Slug', v: p.slug ? esc('/' + p.slug) : '—' },
          { k: 'Storefront', v: UI.badge(statusLabel(p), statusTone(statusLabel(p))) },
          { k: 'Created', v: p.createdAt ? N.date(p.createdAt) : '—' },
          { k: 'Updated', v: (p.updatedAt || p.createdAt) ? N.date(p.updatedAt || p.createdAt) : '—' }
        ]);

        // Authoring (edit / publish-toggle / delete / create) stays on legacy
        // #cs-faqs. navigateToClassic bypasses the V2 route remap so it reaches
        // legacy even with Legacy UI off (else the remap loops back here).
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="CsFaqsV2.classic()">Manage in classic view →</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Question & answer', question + answer) +
            UI.card('Details', meta + manage) +
          '</div>';
      }
    }
    // No onSave -> no Edit button (FAQ authoring stays on legacy #cs-faqs).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'question', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Bounded read (mirrors legacy loadPolicies: cs_policies limitToLast(50)).
    Promise.resolve(MastDB.query('cs_policies').limitToLast(50).once()).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var p = val[k];
        if (p && typeof p === 'object' && isFaqRow(p)) {
          p = Object.assign({ _key: k }, p);
          // Normalize the title source so recordTitle() reads the full question
          // from the raw property (it reads record[fields[0].name] before get()).
          p.question = questionOf(p);
          out.push(p);
        }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[cs-faqs-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') {
      var wantLive = V2.statusFilter === 'live';
      rows = rows.filter(function (p) { return !!p.storefrontEnabled === wantLive; });
    }
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (p) {
        return questionOf(p).toLowerCase().indexOf(q) >= 0 ||
               answerText(p).toLowerCase().indexOf(q) >= 0 ||
               String(p.slug || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('cs-faqs-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('csFaqsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csFaqsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var liveCount = V2.rows.filter(function (p) { return !!p.storefrontEnabled; }).length;
    var filters = [['all', 'All'], ['live', 'Live'], ['hidden', 'Hidden']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="CsFaqsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'FAQs',
        count: N.count(liveCount) + ' live · ' + N.count(V2.rows.length) + ' total',
        actionsHtml:
          '<button class="btn btn-secondary" onclick="CsFaqsV2.classic()">+ New FAQ</button>' +
          '<button class="btn btn-secondary" onclick="CsFaqsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search question, answer or slug…" value="' + esc(V2.q) +
        '" oninput="CsFaqsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('cs-faqs-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CsFaqsV2.sort', onRowClickFnName: 'CsFaqsV2.open',
        empty: { title: 'No FAQs', message: V2.loaded ? 'Add common questions and answers in the classic FAQs view.' : 'Loading…' }
      });
  }

  window.CsFaqsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'updated' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('cs-faqs-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('cs-faqs-v2', rec, 'read');
      });
    },
    // FAQ authoring (create/edit/delete/publish) -> classic FAQs view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('cs-faqs');
      else if (typeof navigateTo === 'function') navigateTo('cs-faqs');
    },
    exportCsv: function () { return MastEntity.exportRows('cs-faqs-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('cs-faqs-v2', {
    routes: { 'cs-faqs-v2': { tab: 'csFaqsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
