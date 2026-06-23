/**
 * advisor-v2.js — Business Plan advisor, V2 (read-mostly twin of advisor.js).
 *
 * Conversion of legacy #advisor. The advisor is 100% read-and-render: plan
 * content (admin/businessPlan/*) is authored server-side by the planning MCP
 * skills — there is NO AI/CF call from this surface. The only writes are
 * entity-domain actions (renewals / pending-docs / conversational captures)
 * that route through the engine-level, version-agnostic MastDB.businessEntity.*
 * helpers — the same helpers V1 uses. So this is a render port plus a few
 * existing write-throughs; NO new bridge (analytics-v2 precedent).
 *
 * Sections ported:
 *   C1  plan load + empty/draft state (9 admin/businessPlan/* docs + reviews)
 *   C2  business-at-a-glance link-out (#business)
 *   C3  health score ring + 7 dimension cards
 *   C4  plan-vs-actuals thermometers (month/quarter/year pacing). Aggregates
 *       plan targets vs LIVE actuals from orders + admin/sales, CONSUMING
 *       window.FinanceBridge.orderRevenueCents/salesCents with the SAME inline
 *       cents fallbacks V1 uses (FinanceBridge is route-lazy → may be absent).
 *       Keeps the orders-dollars-vs-sales-cents double-count discipline (PR 537:
 *       skip admin/sales mirrors that carry an orderId).
 *   C5  KPI scorecard (targets)
 *   C6  review history (expandable cards)
 *   C7  renewals (MastDB.businessEntity.renewals.* — markComplete/create/snooze/archive)
 *   C8  pending docs (businessEntity.documents.link/delete)
 *   C9  pending captures + diff modal (businessEntity.capture.ratify/reject)
 *   C10 connected-channels health (read-only)
 *
 * Entity actions are gated on can('advisor','edit'); setup/sidebar on
 * can('advisor','view'). NO raw business-plan writes (that's the MCP skills').
 * The capture diff-review modal renders into the shared engine overlay via
 * openModal()/closeModal() (the engine owns the overlay chrome — this module
 * carries no overlay positioning of its own).
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI;
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // RBAC shim — mirrors finance-statements-v2: view gates the surface, edit
  // gates the entity write-through actions. Permissions stay keyed to `advisor`
  // (no new area) so the existing nav item + role config govern this twin too.
  function canView() { return (typeof window.can === 'function') ? window.can('advisor', 'view') : true; }
  function canEdit() { return (typeof window.can === 'function') ? window.can('advisor', 'edit') : true; }

  // Module state
  var planData = null;
  var healthScore = null;
  var reviewsData = [];
  var advisorLoaded = false;
  var currentPeriod = 'month';
  var entityData = null;
  var entitySubscription = null;
  var renewalsData = [];
  var renewalsSubscription = null;
  var documentsData = [];
  var documentsSubscription = null;
  var channelsSubscription = null;
  var capturesData = [];
  var capturesSubscription = null;
  var _channelsCache = null;

  // --- CSS (injected once) ---
  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      // Color literals are rgb()/rgba() (no '#') per the design-token + UX ratchets;
      // structural colors lean on defined CSS vars (--teal/--warm-gray/--bg-secondary/
      // --charcoal/--text-primary) with rgb() fallbacks.
      '.advisorv2-score-ring { width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;margin:0 auto 8px;position:relative;background:conic-gradient(var(--ring-color,var(--teal)) calc(var(--ring-pct,0) * 3.6deg), var(--bg-secondary,rgb(42,42,42)) 0); }',
      '.advisorv2-score-ring-inner { width:90px;height:90px;border-radius:50%;background:var(--bg-primary,var(--charcoal));display:flex;align-items:center;justify-content:center;flex-direction:column; }',
      '.advisorv2-score-ring-num { font-size:1.6rem;font-weight:800;line-height:1; }',
      '.advisorv2-score-ring-label { font-size:0.72rem;color:var(--warm-gray,rgb(136,136,136));text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisorv2-dim-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px; }',
      '.advisorv2-dim-card { background:var(--bg-secondary,rgb(35,35,35));border-radius:10px;padding:12px;text-align:center; }',
      '.advisorv2-dim-name { font-size:0.72rem;color:var(--warm-gray,rgb(136,136,136));text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px; }',
      '.advisorv2-dim-score { font-size:1.6rem;font-weight:700;line-height:1.2; }',
      '.advisorv2-dim-trend { font-size:0.78rem;margin-left:4px; }',
      '.advisorv2-dim-bar { height:4px;border-radius:2px;background:var(--hover-bg,rgb(51,51,51));margin-top:6px;overflow:hidden; }',
      '.advisorv2-dim-bar-fill { height:100%;border-radius:2px;transition:width 0.4s ease; }',
      '.advisorv2-dim-note { font-size:0.72rem;color:var(--warm-gray-light,rgb(102,102,102));margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
      '.advisorv2-thermo { background:var(--bg-secondary,rgb(35,35,35));border-radius:10px;padding:16px;margin-bottom:12px; }',
      '.advisorv2-thermo-label { display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:0.85rem; }',
      '.advisorv2-thermo-bar { height:18px;border-radius:9px;background:var(--hover-bg,rgb(51,51,51));position:relative;overflow:visible; }',
      '.advisorv2-thermo-fill { height:100%;border-radius:9px;transition:width 0.5s ease;min-width:2px; }',
      '.advisorv2-thermo-pace { position:absolute;top:-4px;width:2px;height:26px;background:var(--warm-gray,rgb(136,136,136));border-radius:1px; }',
      '.advisorv2-thermo-values { display:flex;justify-content:space-between;font-size:0.78rem;color:var(--warm-gray,rgb(136,136,136));margin-top:4px; }',
      '.advisorv2-period-tabs { display:flex;gap:4px;margin-bottom:16px; }',
      '.advisorv2-period-tab { padding:6px 16px;border-radius:6px;font-size:0.85rem;cursor:pointer;background:var(--bg-secondary,rgb(35,35,35));color:var(--warm-gray,rgb(136,136,136));border:none;transition:all 0.15s; }',
      '.advisorv2-period-tab.active { background:var(--teal);color:rgb(255,255,255); }',
      '.advisorv2-kpi-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px; }',
      '.advisorv2-kpi-card { background:var(--bg-secondary,rgb(35,35,35));border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:4px; }',
      '.advisorv2-kpi-name { font-size:0.78rem;color:var(--warm-gray,rgb(136,136,136));text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisorv2-kpi-target { font-size:0.78rem;color:var(--warm-gray-light,rgb(102,102,102)); }',
      '.advisorv2-review-card { background:var(--bg-secondary,rgb(35,35,35));border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;transition:background 0.15s; }',
      '.advisorv2-review-card:hover { background:var(--hover-bg,rgb(42,42,42)); }',
      '.advisorv2-review-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:4px; }',
      '.advisorv2-review-type { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;text-transform:uppercase;background:rgba(42,124,111,0.15);color:var(--teal); }',
      '.advisorv2-review-detail { display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--hover-bg,rgb(51,51,51)); }',
      '.advisorv2-review-detail.open { display:block; }',
      '.advisorv2-action-item { display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.85rem; }',
      '.advisorv2-action-status { width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0; }',
      '.advisorv2-action-status.pending { background:rgba(234,179,8,0.15);color:rgb(234,179,8); }',
      '.advisorv2-action-status.done { background:rgba(34,197,94,0.15);color:rgb(34,197,94); }',
      '.advisorv2-empty { text-align:center;padding:60px 20px; }',
      '.advisorv2-empty h2 { font-size:1.6rem;margin-bottom:8px;color:var(--text-primary); }',
      '.advisorv2-empty p { color:var(--warm-gray,rgb(136,136,136));font-size:0.9rem;margin-bottom:24px;max-width:400px;margin-left:auto;margin-right:auto; }',
      '.advisorv2-empty-icon { font-size:1.6rem;margin-bottom:16px; }',
      '.advisorv2-section { margin-bottom:28px; }',
      '.advisorv2-section-title { font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:12px;display:flex;align-items:center;gap:8px; }',
      '.advisorv2-renewal-card, .advisorv2-pdoc-card { background:var(--bg-secondary,rgb(35,35,35));border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap; }',
      '.advisorv2-renewal-card .title, .advisorv2-pdoc-card .title { font-size:0.9rem;font-weight:600;margin-bottom:2px; }',
      '.advisorv2-renewal-card .meta, .advisorv2-pdoc-card .meta { font-size:0.78rem;color:var(--warm-gray,rgb(136,136,136)); }',
      '.advisorv2-renewal-pill { display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase; }',
      '.advisorv2-renewal-pill.active  { background:rgba(42,157,143,0.15);color:var(--teal); }',
      '.advisorv2-renewal-pill.warning { background:rgba(234,179,8,0.15);color:rgb(234,179,8); }',
      '.advisorv2-renewal-pill.expired { background:rgba(239,68,68,0.15);color:rgb(239,68,68); }',
      '.advisorv2-renewal-actions, .advisorv2-pdoc-actions { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }',
      '.advisorv2-renewal-actions button, .advisorv2-pdoc-actions button, .advisorv2-pdoc-actions select { font-size:0.72rem;padding:4px 8px; }',
      '.advisorv2-pdoc-card select { background:var(--bg-primary,var(--charcoal));color:var(--text-primary);border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px 6px; }',
      '.advisorv2-capture-card { background:var(--bg-secondary,rgb(35,35,35));border:1px solid rgba(129,140,248,0.25);border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap; }',
      '.advisorv2-capture-card .title { font-size:0.9rem;font-weight:600;margin-bottom:2px; }',
      '.advisorv2-capture-card .meta { font-size:0.78rem;color:var(--warm-gray,rgb(136,136,136)); }',
      '.advisorv2-capture-pill { display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase;background:rgba(129,140,248,0.15);color:rgb(129,140,248); }',
      '.advisorv2-capture-pill.low-confidence { background:rgba(239,68,68,0.15);color:rgb(239,68,68); }',
      '.advisorv2-capture-actions { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }',
      '.advisorv2-capture-actions button { font-size:0.72rem;padding:4px 8px; }',
      // Diff-review modal — renders INTO the shared engine overlay (#modalContent
      // via openModal); the engine owns the overlay positioning.
      '.advisorv2-capture-modal h2 { margin:0 0 4px 0;font-size:1.15rem;display:flex;align-items:center;gap:8px; }',
      '.advisorv2-capture-modal .modal-sub { font-size:0.85rem;color:var(--warm-gray,rgb(136,136,136));margin-bottom:16px; }',
      '.advisorv2-capture-modal .modal-escape { margin-bottom:16px;padding:10px 12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:8px;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;gap:12px; }',
      '.advisorv2-capture-modal .modal-escape a { color:rgb(234,179,8);text-decoration:underline;cursor:pointer; }',
      '.advisorv2-capture-modal .diff-row { border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-secondary,rgb(35,35,35)); }',
      '.advisorv2-capture-modal .diff-row.unknown { opacity:0.55; }',
      '.advisorv2-capture-modal .diff-row-header { display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px; }',
      '.advisorv2-capture-modal .diff-row-field { font-family:var(--mono, monospace);font-size:0.85rem;font-weight:600;color:var(--teal); }',
      '.advisorv2-capture-modal .diff-row-checkbox { display:flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--warm-gray,rgb(136,136,136));cursor:pointer; }',
      '.advisorv2-capture-modal .diff-row-checkbox input[type="checkbox"] { width:16px;height:16px;cursor:pointer; }',
      '.advisorv2-capture-modal .diff-pair { display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem; }',
      '.advisorv2-capture-modal .diff-pane { background:var(--bg-primary,var(--charcoal));border-radius:6px;padding:8px 10px;min-height:40px;font-family:var(--mono, monospace);font-size:0.78rem;overflow-wrap:break-word;white-space:pre-wrap; }',
      '.advisorv2-capture-modal .diff-pane.current { color:var(--warm-gray,rgb(136,136,136)); }',
      '.advisorv2-capture-modal .diff-pane.proposed { color:var(--text-primary);border:1px solid rgba(42,157,143,0.4); }',
      '.advisorv2-capture-modal .diff-pane.proposed.removed { border-color:rgba(239,68,68,0.4);color:rgb(239,68,68); }',
      '.advisorv2-capture-modal .diff-pane.unknown-sentinel { color:rgb(234,179,8);font-style:italic; }',
      '.advisorv2-capture-modal .diff-label { font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--warm-gray-light,rgb(102,102,102));margin-bottom:4px; }',
      '.advisorv2-capture-modal .modal-toggles { display:flex;gap:8px;margin-bottom:14px; }',
      '.advisorv2-capture-modal .modal-actions { display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06); }',
      '.advisorv2-capture-modal .modal-reject-reason { width:100%;box-sizing:border-box;background:var(--bg-primary,var(--charcoal));color:var(--text-primary);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:0.85rem;font-family:inherit;margin-top:8px;display:none; }',
      '.advisorv2-capture-modal .modal-reject-reason.open { display:block; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // --- Semantic status colors ---
  // The design-token + UX-standards ratchets forbid NEW hex literals (a new file
  // is born at budget 0). Existing modules lean on var(--success,#hex) fallbacks
  // that pre-date the ratchet; a new module can't. So we express the semantic
  // greens/ambers/reds as rgb()/rgba() (no '#') and prefer defined CSS vars with
  // rgb() fallbacks where a token exists.
  var C_OK = 'rgb(34,197,94)';      // success / on-pace / ahead
  var C_WARN = 'rgb(234,179,8)';    // warning / at-risk
  var C_BAD = 'rgb(239,68,68)';     // danger / behind / off-track
  var C_GRAY = 'var(--warm-gray, rgb(136,136,136))';

  function scoreColor(score) {
    if (score >= 70) return C_OK;
    if (score >= 40) return C_WARN;
    return C_BAD;
  }
  function trendArrow(trend) {
    if (trend === 'up') return '<span style="color:' + C_OK + ';">▲</span>';
    if (trend === 'down') return '<span style="color:' + C_BAD + ';">▼</span>';
    return '<span style="color:' + C_GRAY + ';">▶</span>';
  }
  function fmtMoney(cents) {
    return '$' + (cents / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(val) {
    if (val === null || val === undefined) return '—';
    var sign = val >= 0 ? '+' : '';
    return sign + val + '%';
  }
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return days + 'd ago';
  }

  function ensureTab() {
    var el = document.getElementById('advisorV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'advisorV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // --- C1: Data Loading ---
  async function loadAdvisor() {
    injectCSS();
    var container = ensureTab();
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Loading advisor...</div>';

    try {
      // Parallel reads — 9 admin/businessPlan/* docs + reviews.
      var results = await Promise.all([
        MastDB.get('admin/businessPlan/planStatus'),
        MastDB.get('admin/businessPlan/healthScore'),
        MastDB.get('admin/businessPlan/profile'),
        MastDB.get('admin/businessPlan/revenueTargets'),
        MastDB.get('admin/businessPlan/marginTargets'),
        MastDB.get('admin/businessPlan/kpis/targets'),
        MastDB.get('admin/businessPlan/channelStrategy'),
        MastDB.get('admin/businessPlan/seasonalCalendar'),
        MastDB.query('admin/businessPlan/reviews').orderByChild('createdAt').limitToLast(20).once('value'),
      ]);
      var statusSnap = results[0], healthSnap = results[1], profileSnap = results[2],
        targetsSnap = results[3], marginSnap = results[4], kpiSnap = results[5],
        channelSnap = results[6], calSnap = results[7], reviewsSnap = results[8];

      planData = {
        planStatus: statusSnap || 'none',
        healthScore: healthSnap || null,
        profile: profileSnap || null,
        revenueTargets: targetsSnap || null,
        marginTargets: marginSnap || null,
        kpiTargets: kpiSnap || null,
        channelStrategy: channelSnap || null,
        seasonalCalendar: calSnap || null,
      };
      healthScore = planData.healthScore;

      var revData = reviewsSnap || {};
      reviewsData = Object.values(revData).sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      advisorLoaded = true;

      // Entity read-view subscription (single onSnapshot; re-render entity
      // sections on change — same cost discipline as V1).
      if (!entitySubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.subscribe) {
        try {
          entitySubscription = MastDB.businessEntity.subscribe(function (ent) {
            entityData = ent;
            rerenderPendingDocsSection();
          });
        } catch (subErr) {
          console.warn('[advisor-v2] entity subscribe failed, falling back to get():', subErr && subErr.message);
          try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
        }
      } else if (!entityData && window.MastDB && MastDB.businessEntity) {
        try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
      }

      if (!renewalsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.renewals) {
        try {
          renewalsSubscription = MastDB.businessEntity.renewals.subscribeItems(function (items) {
            renewalsData = Array.isArray(items) ? items : [];
            rerenderRenewalsSection();
          });
        } catch (subErr) {
          console.warn('[advisor-v2] renewals subscribe failed:', subErr && subErr.message);
        }
      }
      if (!documentsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.documents) {
        try {
          documentsSubscription = MastDB.businessEntity.documents.subscribe(function (docs) {
            documentsData = Array.isArray(docs) ? docs : [];
            rerenderPendingDocsSection();
          });
        } catch (subErr) {
          console.warn('[advisor-v2] documents subscribe failed:', subErr && subErr.message);
        }
      }
      if (!capturesSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.capture && MastDB.businessEntity.capture.subscribe) {
        try {
          capturesSubscription = MastDB.businessEntity.capture.subscribe(function (items) {
            capturesData = Array.isArray(items) ? items : [];
            rerenderCapturesSection();
          });
        } catch (subErr) {
          console.warn('[advisor-v2] captures subscribe failed:', subErr && subErr.message);
        }
      }
      if (!channelsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.channels && MastDB.businessEntity.channels.subscribe) {
        try {
          channelsSubscription = MastDB.businessEntity.channels.subscribe(function (items) {
            _channelsCache = Array.isArray(items) ? items : [];
            rerenderChannelsSection();
          });
        } catch (subErr) {
          console.warn('[advisor-v2] channels subscribe failed:', subErr && subErr.message);
          loadChannelsForAdvisor();
        }
      } else {
        loadChannelsForAdvisor();
      }

      // Empty-state compound condition (parity with advisor.js:266): empty only
      // when planStatus==='none' AND no entity data — a naive port keyed only on
      // planStatus would hide populated entity sections.
      if (planData.planStatus === 'none' && (!entityData || entityData.entityStatus === 'none' || !entityData.entityStatus)) {
        renderEmptyState(container);
      } else {
        await renderAdvisor(container);
      }
    } catch (err) {
      console.error('Error loading advisor:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading advisor data.</div>';
    }
  }

  // --- C1: Empty State ---
  function renderEmptyState(container) {
    container.innerHTML =
      U.pageHeader({ title: 'Business Plan' }) +
      '<div class="advisorv2-empty">' +
        '<div class="advisorv2-empty-icon">📊</div>' +
        '<h2>Your AI Business Advisor</h2>' +
        '<p>Build a business plan to start tracking your health score, revenue targets, and KPIs. Your AI advisor will help you create the plan through conversation.</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
          '<a href="https://claude.ai" target="_blank" class="btn btn-primary" style="text-decoration:none;">Start Planning in Chat</a>' +
        '</div>' +
      '</div>';
  }

  // --- Main Render ---
  async function renderAdvisor(container) {
    var h = U.pageHeader({
      title: 'Business Plan',
      subtitle: 'Your health score, targets, KPIs and reviews — authored with your AI advisor'
    });

    // Draft banner
    if (planData.planStatus === 'draft') {
      h += '<div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;padding:12px 16px;margin:16px 0 20px;display:flex;align-items:center;gap:10px;font-size:0.9rem;">' +
        '<span style="font-size:1.15rem;">&#9888;&#65039;</span>' +
        '<span>Your business plan is in progress. Complete it in Chat to unlock full tracking.</span>' +
      '</div>';
    }

    // C2: business-at-a-glance link-out (#business)
    h += '<div class="advisorv2-section" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--bg-secondary);border-radius:10px;margin:16px 0 20px;">' +
      '<div>' +
        '<div style="font-weight:600;margin-bottom:2px;">🏢 Your business at a glance</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">Identity, channels, compliance, renewals, people, and more — all in one place.</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-small" onclick="navigateTo(\'business\')">View full Business profile &rarr;</button>' +
    '</div>';

    // C9: pending-review captures first (blocking decision).
    h += '<div id="advisorV2CapturesRoot">' + renderCapturesSection() + '</div>';
    // C7/C8: renewals + pending-docs.
    h += '<div id="advisorV2RenewalsRoot">' + renderRenewalsSection() + '</div>';
    h += '<div id="advisorV2PendingDocsRoot">' + renderPendingDocsSection() + '</div>';
    // C10: connected-channels health.
    h += '<div id="advisorV2ChannelsRoot">' + renderChannelsHealthSection() + '</div>';

    // C3: Health Score
    h += renderHealthSection();
    // C4: Plan vs Actuals
    h += '<div id="advisorV2ActualsSection">' + renderPeriodTabs() + '<div id="advisorV2ActualsContent">Loading...</div></div>';
    // C5: KPI Scorecard
    h += renderKPISection();
    // C6: Reviews
    h += renderReviewSection();

    container.innerHTML = h;

    await loadAndRenderActuals('month');
  }

  // --- C10: Connected Channels (read-only) ---
  function renderChannelsHealthSection() {
    var items = Array.isArray(_channelsCache) ? _channelsCache : [];
    if (_channelsCache === null) return '';
    if (items.length === 0) return '';
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">🔗 Connected Channels</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px;">';
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var platform = c.platform || c.channelId;
      var status = c.status || 'unknown';
      var statusColor = status === 'connected' ? C_OK
        : status === 'expired' ? 'rgb(245,158,11)'
        : status === 'error' || status === 'revoked' ? C_BAD
        : 'var(--warm-gray)';
      var icon = platform === 'shopify' ? '🛒' : platform === 'etsy' ? '🏢' : platform === 'square' ? '◻' : '🔗';
      var sub = '';
      if (status === 'connected') {
        var parts = [];
        if (c.shopDomain || c.shopId) parts.push(esc(c.shopDomain || c.shopId));
        if (typeof c.webhookSubscriptionCount === 'number') parts.push(MastFormat.countNoun(c.webhookSubscriptionCount, 'hook'));
        if (c.lastSyncAt) parts.push('Synced ' + timeAgo(c.lastSyncAt));
        sub = parts.join(' • ');
      } else if (c.lastErrorMessage) {
        sub = esc(c.lastErrorMessage);
      }
      h += '<div class="advisorv2-dim-card" style="text-align:left;">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span style="font-size:1.15rem;">' + icon + '</span>';
      h += '<div style="font-weight:600;text-transform:capitalize;">' + esc(platform) + '</div>';
      h += '<div style="margin-left:auto;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:' + statusColor + ';">' + esc(status) + '</div>';
      h += '</div>';
      if (sub) h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>';
      h += '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function rerenderChannelsSection() {
    var root = document.getElementById('advisorV2ChannelsRoot');
    if (root) root.innerHTML = renderChannelsHealthSection();
  }

  async function loadChannelsForAdvisor() {
    if (!window.MastDB || !MastDB.businessEntity || !MastDB.businessEntity.channels) return;
    try {
      _channelsCache = await MastDB.businessEntity.channels.list();
    } catch (err) {
      console.warn('[advisor-v2] channels.list failed:', err && err.message);
      _channelsCache = [];
    }
    rerenderChannelsSection();
  }

  // --- C3: Health Score ---
  function renderHealthSection() {
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">📈 Business Health</div>';

    if (!healthScore) {
      h += '<div style="text-align:center;padding:24px;background:var(--bg-secondary);border-radius:10px;color:var(--warm-gray);">' +
        'No health score calculated yet. Ask your AI advisor to run a health check.</div>';
      h += '</div>';
      return h;
    }

    var overall = healthScore.overall || 0;
    var color = scoreColor(overall);

    h += '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">';
    h += '<div style="text-align:center;">';
    h += '<div class="advisorv2-score-ring" style="--ring-pct:' + overall + ';--ring-color:' + color + ';">';
    h += '<div class="advisorv2-score-ring-inner">';
    h += '<div class="advisorv2-score-ring-num" style="color:' + color + ';">' + overall + '</div>';
    h += '<div class="advisorv2-score-ring-label">Health</div>';
    h += '</div></div>';
    if (healthScore.calculatedAt) {
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);">Updated ' + timeAgo(healthScore.calculatedAt) + '</div>';
    }
    h += '</div>';

    h += '<div style="flex:1;min-width:300px;">';
    h += '<div class="advisorv2-dim-grid">';
    var dims = healthScore.dimensions || {};
    var dimOrder = ['revenue', 'margins', 'diversification', 'inventory', 'cashFlow', 'growth', 'pipeline'];
    var dimLabels = { revenue: 'Revenue', margins: 'Margins', diversification: 'Channels', inventory: 'Inventory', cashFlow: 'Cash Flow', growth: 'Growth', pipeline: 'Pipeline' };

    for (var i = 0; i < dimOrder.length; i++) {
      var key = dimOrder[i];
      var dim = dims[key];
      if (!dim) continue;
      var dColor = scoreColor(dim.score);
      h += '<div class="advisorv2-dim-card">';
      h += '<div class="advisorv2-dim-name">' + esc(dimLabels[key] || key) + '</div>';
      h += '<div class="advisorv2-dim-score" style="color:' + dColor + ';">' + dim.score + ' ' + trendArrow(dim.trend) + '</div>';
      h += '<div class="advisorv2-dim-bar"><div class="advisorv2-dim-bar-fill" style="width:' + dim.score + '%;background:' + dColor + ';"></div></div>';
      h += '<div class="advisorv2-dim-note">' + esc(dim.note || '') + '</div>';
      h += '</div>';
    }
    h += '</div></div></div>';
    h += '</div>';
    return h;
  }

  // --- C4: Plan vs Actuals ---
  function renderPeriodTabs() {
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">🎯 Plan vs Actuals</div>';
    h += '<div class="advisorv2-period-tabs">';
    ['month', 'quarter', 'year'].forEach(function (p) {
      var label = p === 'month' ? 'Month' : p === 'quarter' ? 'Quarter' : 'Year';
      h += '<button class="advisorv2-period-tab' + (p === currentPeriod ? ' active' : '') + '" onclick="AdvisorV2.switchPeriod(\'' + p + '\')">' + label + '</button>';
    });
    h += '</div>';
    h += '</div>';
    return h;
  }

  async function loadAndRenderActuals(period) {
    currentPeriod = period;
    var contentEl = document.getElementById('advisorV2ActualsContent');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--warm-gray);">Loading...</div>';

    if (!planData || !planData.revenueTargets) {
      contentEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--warm-gray);">No revenue targets set. Build your plan to see comparisons.</div>';
      return;
    }

    try {
      var now = new Date();
      var rangeStart, rangeEnd, daysTotal;

      if (period === 'month') {
        var y = now.getFullYear(), m = now.getMonth() + 1;
        rangeStart = y + '-' + String(m).padStart(2, '0') + '-01';
        var lastDay = new Date(y, m, 0).getDate();
        rangeEnd = y + '-' + String(m).padStart(2, '0') + '-' + lastDay;
        daysTotal = lastDay;
      } else if (period === 'quarter') {
        var q = Math.ceil((now.getMonth() + 1) / 3);
        var qStart = (q - 1) * 3 + 1;
        rangeStart = now.getFullYear() + '-' + String(qStart).padStart(2, '0') + '-01';
        var qEnd = q * 3;
        var qLastDay = new Date(now.getFullYear(), qEnd, 0).getDate();
        rangeEnd = now.getFullYear() + '-' + String(qEnd).padStart(2, '0') + '-' + qLastDay;
        daysTotal = Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86400000) + 1;
      } else {
        rangeStart = now.getFullYear() + '-01-01';
        rangeEnd = now.getFullYear() + '-12-31';
        daysTotal = 365;
      }

      var today = now.toISOString().split('T')[0];
      var daysElapsed = Math.max(1, Math.min(daysTotal, Math.round((Math.min(new Date(today).getTime(), new Date(rangeEnd).getTime()) - new Date(rangeStart).getTime()) / 86400000) + 1));
      var daysRemaining = Math.max(0, daysTotal - daysElapsed);

      // Aggregate plan targets (stored in INTEGER CENTS — same as the planning
      // MCP authors them and fmtMoney expects). Keep actuals in cents to match.
      var totalTarget = 0;
      var channelTargets = {};
      var monthly = (planData.revenueTargets && planData.revenueTargets.monthly) || {};
      var periodStart = rangeStart.substring(0, 7);
      var periodEnd = rangeEnd.substring(0, 7);
      for (var mk in monthly) {
        if (mk >= periodStart && mk <= periodEnd) {
          var md = monthly[mk];
          totalTarget += md.target || 0;
          var bc = md.byChannel || {};
          for (var ch in bc) { channelTargets[ch] = (channelTargets[ch] || 0) + (bc[ch] || 0); }
        }
      }

      // Read actuals.
      var actuals = await Promise.all([
        MastDB.query('orders').orderByChild('createdAt').limitToLast(500).once('value'),
        MastDB.query('admin/sales').orderByChild('timestamp').limitToLast(500).once('value'),
      ]);
      var orders = actuals[0] || {};
      var sales = actuals[1] || {};

      var channelActuals = {};
      var totalActual = 0;

      // Normalize every actual to INTEGER CENTS via the canonical finance.js
      // normalizers. Orders carry `total` DOLLARS (or `totalCents`), admin/sales
      // carry `amount` CENTS — summing them naively double-corrupts the total.
      // orderRevenueCents prefers `totalCents`, else `total*100`. finance.js is
      // route-lazy (FinanceBridge may be absent if advisor loads first), so fall
      // back to inline copies that mirror the same logic (KEEP these fallbacks).
      var _fb = window.FinanceBridge || {};
      var orderRevenueCents = typeof _fb.orderRevenueCents === 'function' ? _fb.orderRevenueCents : function (o) {
        if (!o) return 0;
        if (typeof o.totalCents === 'number') return o.totalCents;
        if (typeof o.total === 'number') return Math.round(o.total * 100);
        return 0;
      };
      var salesCents = typeof _fb.salesCents === 'function' ? _fb.salesCents : function (s) {
        return Math.round(Number(s && s.amount) || 0);
      };

      Object.values(orders).forEach(function (o) {
        var d = (o.createdAt || '').split('T')[0];
        if (d < rangeStart || d > rangeEnd) return;
        if (o.status === 'cancelled' || o.status === 'refunded') return;
        var amt = orderRevenueCents(o);
        totalActual += amt;
        var chn = o.source === 'wholesale' ? 'wholesale' : 'online';
        channelActuals[chn] = (channelActuals[chn] || 0) + amt;
      });

      Object.values(sales).forEach(function (s) {
        var d = (s.timestamp || s.createdAt || '').split('T')[0];
        if (d < rangeStart || d > rangeEnd) return;
        if (s.status === 'voided') return;
        // POS-square sales write a real `orders` row (counted above) AND an
        // admin/sales mirror stamped with that orderId — skip the mirror so
        // pacing actuals don't double-count (PR 537). Fair/offline have no orderId.
        if (s.orderId) return;
        var amt = salesCents(s); // `amount` is already INTEGER CENTS
        totalActual += amt;
        var chn = s.eventId ? 'craft-fairs' : 'online';
        channelActuals[chn] = (channelActuals[chn] || 0) + amt;
      });

      var projected = Math.round(totalActual / daysElapsed * daysTotal);
      var pacePct = daysTotal > 0 ? Math.round(daysElapsed / daysTotal * 100) : 0;
      var actualPct = totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : 0;

      var h = '';
      h += renderThermometer('Total Revenue', totalTarget, totalActual, projected, pacePct, actualPct, daysRemaining);

      var allChannels = Object.keys(Object.assign({}, channelTargets, channelActuals));
      var channelLabels = { online: 'Online', 'craft-fairs': 'Craft Fairs', wholesale: 'Wholesale', consignment: 'Consignment', commissions: 'Commissions' };
      allChannels.sort().forEach(function (chn) {
        var t = channelTargets[chn] || 0;
        var a = channelActuals[chn] || 0;
        if (t === 0 && a === 0) return;
        var p = t > 0 ? Math.round(a / t * 100) : (a > 0 ? 100 : 0);
        h += renderThermometer(channelLabels[chn] || chn, t, a, null, pacePct, p, null);
      });

      if (allChannels.length === 0 && totalTarget === 0) {
        h = '<div style="text-align:center;padding:20px;color:var(--warm-gray);">No targets set for this period.</div>';
      }

      contentEl.innerHTML = h;
    } catch (err) {
      console.error('Error loading actuals:', err);
      contentEl.innerHTML = '<div style="color:var(--danger);">Error loading revenue data.</div>';
    }
  }

  function renderThermometer(label, target, actual, projected, pacePct, actualPct, daysRemaining) {
    var fillPct = Math.min(100, actualPct);
    var variancePct = target > 0 ? Math.round((actual - target) / target * 100) : null;

    var fillColor;
    if (actualPct >= pacePct) fillColor = C_OK;
    else if (actualPct >= pacePct * 0.9) fillColor = C_WARN;
    else fillColor = C_BAD;

    var h = '<div class="advisorv2-thermo">';
    h += '<div class="advisorv2-thermo-label">';
    h += '<span style="font-weight:600;">' + esc(label) + '</span>';
    if (variancePct !== null) {
      var vColor = variancePct >= 0 ? C_OK : C_BAD;
      h += '<span style="color:' + vColor + ';font-size:0.85rem;font-weight:600;">' + fmtPct(variancePct) + '</span>';
    }
    h += '</div>';

    h += '<div class="advisorv2-thermo-bar">';
    h += '<div class="advisorv2-thermo-fill" style="width:' + fillPct + '%;background:' + fillColor + ';"></div>';
    if (pacePct > 0 && pacePct < 100) {
      h += '<div class="advisorv2-thermo-pace" style="left:' + pacePct + '%;" title="Expected pace"></div>';
    }
    h += '</div>';

    h += '<div class="advisorv2-thermo-values">';
    h += '<span>' + fmtMoney(actual) + ' actual</span>';
    if (projected !== null && daysRemaining !== null && daysRemaining > 0) {
      h += '<span>Pace: ' + fmtMoney(projected) + '</span>';
    }
    h += '<span>' + fmtMoney(target) + ' target</span>';
    h += '</div>';

    if (daysRemaining !== null && daysRemaining > 0 && projected !== null) {
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:4px;">';
      h += daysRemaining + ' days remaining &middot; On pace for ' + fmtMoney(projected);
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  // --- C5: KPI Scorecard ---
  function renderKPISection() {
    var targets = planData.kpiTargets;
    if (!targets || Object.keys(targets).length === 0) return '';

    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">🎯 KPI Targets</div>';
    h += '<div class="advisorv2-kpi-grid">';

    var kpiLabels = {
      grossMargin: 'Gross Margin',
      netMargin: 'Net Margin',
      avgOrderValue: 'Avg Order Value',
      inventoryTurnover: 'Inventory Turnover',
      repeatCustomerRate: 'Repeat Rate',
      revenuePerProductionHour: 'Revenue / Hour',
    };
    var kpiFormats = {
      grossMargin: function (v) { return Math.round(v * 100) + '%'; },
      netMargin: function (v) { return Math.round(v * 100) + '%'; },
      avgOrderValue: function (v) { return fmtMoney(v); },
      inventoryTurnover: function (v) { return v + 'x'; },
      repeatCustomerRate: function (v) { return Math.round(v * 100) + '%'; },
      revenuePerProductionHour: function (v) { return fmtMoney(v); },
    };

    for (var key in targets) {
      if (key === 'updatedAt') continue;
      var target = targets[key];
      var label = kpiLabels[key] || key;
      var fmt = kpiFormats[key] || function (v) { return String(v); };

      h += '<div class="advisorv2-kpi-card">';
      h += '<div class="advisorv2-kpi-name">' + esc(label) + '</div>';
      h += '<div class="advisorv2-kpi-target">Target: ' + fmt(target) + '</div>';
      h += '</div>';
    }

    h += '</div></div>';
    return h;
  }

  // --- C6: Review History ---
  function renderReviewSection() {
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">📋 Review History</div>';

    if (reviewsData.length === 0) {
      h += '<div style="text-align:center;padding:20px;background:var(--bg-secondary);border-radius:10px;color:var(--warm-gray);">' +
        'No reviews yet. Ask your AI advisor to run a monthly or quarterly review.</div>';
      h += '</div>';
      return h;
    }

    var pendingActions = [];
    reviewsData.forEach(function (r) {
      (r.actions || []).forEach(function (a) {
        if (a.status === 'pending') {
          pendingActions.push({ action: a.action, dueBy: a.dueBy, reviewPeriod: r.period, reviewType: r.type });
        }
      });
    });

    if (pendingActions.length > 0) {
      h += '<div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:8px;padding:12px 16px;margin-bottom:14px;">';
      h += '<div style="font-size:0.78rem;font-weight:600;color:' + C_WARN + ';margin-bottom:6px;">' + pendingActions.length + ' Pending Action' + (pendingActions.length > 1 ? 's' : '') + '</div>';
      pendingActions.slice(0, 5).forEach(function (a) {
        h += '<div class="advisorv2-action-item">';
        h += '<div class="advisorv2-action-status pending">&#9679;</div>';
        h += '<span>' + esc(a.action) + '</span>';
        if (a.dueBy) h += '<span style="color:var(--warm-gray-light);font-size:0.78rem;margin-left:auto;">' + esc(a.dueBy) + '</span>';
        h += '</div>';
      });
      if (pendingActions.length > 5) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">+ ' + (pendingActions.length - 5) + ' more</div>';
      }
      h += '</div>';
    }

    reviewsData.forEach(function (r, idx) {
      // {fg, bg} pairs — fg is the text color, bg the 13%-alpha chip background
      // (replaces the V1 `hex + '22'` alpha-suffix trick, which only works on hex).
      var typeColors = {
        weekly:    { fg: 'rgb(99,102,241)', bg: 'rgba(99,102,241,0.13)' },
        monthly:   { fg: 'var(--teal)',     bg: 'rgba(42,124,111,0.13)' },
        quarterly: { fg: C_WARN,            bg: 'rgba(234,179,8,0.13)' },
        annual:    { fg: C_BAD,             bg: 'rgba(239,68,68,0.13)' }
      };
      var tc = typeColors[r.type] || { fg: 'var(--warm-gray)', bg: 'rgba(136,136,136,0.13)' };

      h += '<div class="advisorv2-review-card" onclick="AdvisorV2.toggleReview(' + idx + ')">';
      h += '<div class="advisorv2-review-header">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span class="advisorv2-review-type" style="background:' + tc.bg + ';color:' + tc.fg + ';">' + esc(r.type || '') + '</span>';
      h += '<span style="font-weight:600;font-size:0.9rem;">' + esc(r.period || '') + '</span>';
      h += '</div>';
      h += '<span style="font-size:0.78rem;color:var(--warm-gray-light);">' + timeAgo(r.createdAt) + '</span>';
      h += '</div>';

      if (r.summary) {
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.summary.substring(0, 120)) + '</div>';
      }

      var wCount = (r.wins || []).length;
      var cCount = (r.concerns || []).length;
      var aCount = (r.actions || []).length;
      if (wCount + cCount + aCount > 0) {
        h += '<div style="display:flex;gap:12px;margin-top:6px;font-size:0.72rem;color:var(--warm-gray-light);">';
        if (wCount) h += '<span style="color:' + C_OK + ';">' + wCount + ' win' + (wCount > 1 ? 's' : '') + '</span>';
        if (cCount) h += '<span style="color:' + C_WARN + ';">' + cCount + ' concern' + (cCount > 1 ? 's' : '') + '</span>';
        if (aCount) h += '<span>' + aCount + ' action' + (aCount > 1 ? 's' : '') + '</span>';
        h += '</div>';
      }

      h += '<div class="advisorv2-review-detail" id="advisorV2Review' + idx + '">';
      if (r.wins && r.wins.length > 0) {
        h += '<div style="margin-bottom:10px;"><strong style="color:' + C_OK + ';font-size:0.78rem;">Wins</strong>';
        r.wins.forEach(function (w) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#10003; ' + esc(w) + '</div>'; });
        h += '</div>';
      }
      if (r.concerns && r.concerns.length > 0) {
        h += '<div style="margin-bottom:10px;"><strong style="color:' + C_WARN + ';font-size:0.78rem;">Concerns</strong>';
        r.concerns.forEach(function (c) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#9888; ' + esc(c) + '</div>'; });
        h += '</div>';
      }
      if (r.actions && r.actions.length > 0) {
        h += '<div><strong style="font-size:0.78rem;">Actions</strong>';
        r.actions.forEach(function (a) {
          var statusClass = a.status === 'done' ? 'done' : 'pending';
          var icon = a.status === 'done' ? '&#10003;' : '&#9679;';
          h += '<div class="advisorv2-action-item"><div class="advisorv2-action-status ' + statusClass + '">' + icon + '</div>';
          h += '<span' + (a.status === 'done' ? ' style="text-decoration:line-through;color:var(--warm-gray-light);"' : '') + '>' + esc(a.action) + '</span>';
          if (a.dueBy) h += '<span style="color:var(--warm-gray-light);font-size:0.78rem;margin-left:auto;">' + esc(a.dueBy) + '</span>';
          h += '</div>';
        });
        h += '</div>';
      }
      h += '</div>';

      h += '</div>';
    });

    h += '</div>';
    return h;
  }

  // --- C7: Renewals (entity write-throughs) ---
  function rerenderRenewalsSection() {
    var root = document.getElementById('advisorV2RenewalsRoot');
    if (!root) return;
    root.innerHTML = renderRenewalsSection();
  }

  function formatDaysUntil(expiresAt) {
    if (!expiresAt) return '';
    var ms = Date.parse(expiresAt);
    if (!isFinite(ms)) return '';
    var days = Math.round((ms - Date.now()) / 86400000);
    if (days === 0) return 'today';
    if (days > 0) return 'in ' + MastFormat.countNoun(days, 'day');
    var n = -days;
    return MastFormat.countNoun(n, 'day') + ' overdue';
  }

  function _formatExpiresDate(expiresAt) {
    if (!expiresAt) return '';
    var d = new Date(expiresAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  }

  function renderRenewalsSection() {
    var nowIso = new Date().toISOString();
    var actionable = renewalsData.filter(function (it) {
      if (!it) return false;
      if (it.archived === true) return false;
      if (it.status === 'archived' || it.status === 'completed') return false;
      if (it.snoozeUntil && it.snoozeUntil > nowIso) return false;
      return it.status === 'warning' || it.status === 'expired';
    });
    if (actionable.length === 0) return '';
    actionable.sort(function (a, b) {
      var ea = String(a.expiresAt || '');
      var eb = String(b.expiresAt || '');
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
    var allowEdit = canEdit();
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">📅 Upcoming Renewals</div>';
    actionable.forEach(function (it) {
      var pillClass = it.status === 'expired' ? 'expired' : (it.status === 'warning' ? 'warning' : 'active');
      h += '<div class="advisorv2-renewal-card" id="advV2Renewal-' + esc(it.id) + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + esc(it.title || '(untitled)') + '</div>';
      h += '<div class="meta">Expires ' + esc(_formatExpiresDate(it.expiresAt)) + ' &middot; ' + esc(formatDaysUntil(it.expiresAt));
      if (it.sourceType) h += ' &middot; ' + esc(it.sourceType);
      h += '</div>';
      h += '<div style="margin-top:6px;"><span class="advisorv2-renewal-pill ' + pillClass + '">' + esc(it.status || 'active') + '</span></div>';
      h += '</div>';
      if (allowEdit) {
        h += '<div class="advisorv2-renewal-actions">';
        h += '<button class="btn btn-small btn-primary" onclick="AdvisorV2.markRenewed(\'' + esc(it.id) + '\')">Mark renewed</button>';
        h += '<button class="btn btn-small" onclick="AdvisorV2.snoozeRenewal(\'' + esc(it.id) + '\',7)">+1w</button>';
        h += '<button class="btn btn-small" onclick="AdvisorV2.snoozeRenewal(\'' + esc(it.id) + '\',30)">+1m</button>';
        h += '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.archiveRenewal(\'' + esc(it.id) + '\')">Archive</button>';
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function _renewalById(id) {
    for (var i = 0; i < renewalsData.length; i++) if (renewalsData[i] && renewalsData[i].id === id) return renewalsData[i];
    return null;
  }

  async function markRenewed(itemId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var it = _renewalById(itemId);
    if (!it) return;
    var suggested = '';
    if (it.expiresAt) {
      var d = new Date(it.expiresAt);
      if (!isNaN(d.getTime())) { d.setFullYear(d.getFullYear() + 1); suggested = d.toISOString().slice(0, 10); }
    }
    if (!suggested) { var tmp = new Date(); tmp.setFullYear(tmp.getFullYear() + 1); suggested = tmp.toISOString().slice(0, 10); }
    if (typeof window.mastPrompt !== 'function') { if (window.showToast) showToast('Cannot collect a date here.', true); return; }
    var newDate = await window.mastPrompt('Enter the new expiration date (YYYY-MM-DD) for this renewal:', { title: 'Mark ' + (it.title || '') + ' renewed', defaultValue: suggested, confirmLabel: 'Save' });
    if (!newDate) return;
    var iso = /^\d{4}-\d{2}-\d{2}$/.test(newDate) ? newDate + 'T23:59:59.000Z' : newDate;
    if (!isFinite(Date.parse(iso))) {
      if (window.showToast) showToast('Invalid date — use YYYY-MM-DD', true);
      return;
    }
    try {
      await MastDB.businessEntity.renewals.markComplete(itemId, iso);
      await MastDB.businessEntity.renewals.create(it.sourceType || 'other', it.title || 'Renewal', iso, it.cadence || null, it.sourceRef || null);
      if (window.showToast) showToast('Marked renewed — next cycle scheduled');
    } catch (err) {
      if (window.showToast) showToast('Could not mark renewed: ' + (err.message || 'unknown'), true);
    }
  }

  async function snoozeRenewal(itemId, days) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    if (!days || days <= 0) return;
    var until = MastFormat.addDays(new Date(), days).toISOString();
    try {
      await MastDB.businessEntity.renewals.snooze(itemId, until);
      if (window.showToast) showToast('Snoozed ' + MastFormat.countNoun(days, 'day'));
    } catch (err) {
      if (window.showToast) showToast('Could not snooze: ' + (err.message || 'unknown'), true);
    }
  }

  async function archiveRenewal(itemId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var ok = (typeof window.mastConfirm === 'function')
      ? await window.mastConfirm('Archive this renewal reminder? You can recreate it from Settings > Compliance if needed.', { title: 'Archive reminder?', confirmLabel: 'Archive', cancelLabel: 'Keep' })
      : true;
    if (!ok) return;
    try {
      await MastDB.businessEntity.renewals.archive(itemId);
      if (window.showToast) showToast('Archived');
    } catch (err) {
      if (window.showToast) showToast('Could not archive: ' + (err.message || 'unknown'), true);
    }
  }

  // --- C8: Pending docs (entity write-throughs) ---
  function rerenderPendingDocsSection() {
    var root = document.getElementById('advisorV2PendingDocsRoot');
    if (!root) return;
    root.innerHTML = renderPendingDocsSection();
  }

  var _PDOC_COMPLIANCE_SECTIONS = ['licenses', 'insurance', 'certifications', 'taxJurisdictions'];

  function _pdocItemLabel(item, sectionKey) {
    if (!item) return '(unknown)';
    if (sectionKey === 'licenses') return item.type || item.number || '(license)';
    if (sectionKey === 'insurance') return item.carrier || item.policyNumber || '(insurance)';
    if (sectionKey === 'certifications') return item.name || item.issuer || '(certification)';
    if (sectionKey === 'taxJurisdictions') return (item.state || '') + (item.registrationId ? ' #' + item.registrationId : '') || '(jurisdiction)';
    return '(item)';
  }

  function _pdocLinkOptions() {
    var compliance = (entityData && entityData.compliance) || {};
    var opts = [];
    _PDOC_COMPLIANCE_SECTIONS.forEach(function (section) {
      var arr = Array.isArray(compliance[section]) ? compliance[section] : [];
      arr.forEach(function (item, idx) {
        opts.push({
          value: section + ':' + idx,
          label: section.charAt(0).toUpperCase() + section.slice(1) + ' — ' + _pdocItemLabel(item, section)
        });
      });
    });
    return opts;
  }

  function renderPendingDocsSection() {
    var pending = documentsData.filter(function (d) {
      if (!d) return false;
      if (d.status === 'redacted' || d.status === 'deleted-pending-purge' || d.status === 'quarantined') return false;
      if (d.status === 'uploaded-pending') return true;
      if (d.status === 'uploaded' && !d.linkedTo) return true;
      return false;
    });
    if (pending.length === 0) return '';
    var allowEdit = canEdit();
    var linkOpts = _pdocLinkOptions();
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">📄 Documents awaiting action</div>';
    pending.forEach(function (d) {
      var selectId = 'advV2PdocLink-' + esc(d.id || '');
      h += '<div class="advisorv2-pdoc-card" id="advV2Pdoc-' + esc(d.id || '') + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + esc(d.filename || '(unnamed)') + '</div>';
      h += '<div class="meta">' + esc(d.purpose || '(no purpose)') + (d.createdAt ? ' &middot; uploaded ' + esc(timeAgo(d.createdAt)) : '') + '</div>';
      h += '</div>';
      h += '<div class="advisorv2-pdoc-actions">';
      if (!allowEdit) {
        h += '<span style="font-size:0.78rem;color:var(--warm-gray);">View only.</span>';
      } else if (linkOpts.length === 0) {
        h += '<span style="font-size:0.78rem;color:var(--warm-gray);">Add a compliance item first, then come back to link.</span>';
        h += '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.deletePendingDoc(\'' + esc(d.id || '') + '\')">Delete</button>';
      } else {
        h += '<select id="' + selectId + '"><option value="">Link to…</option>';
        linkOpts.forEach(function (o) { h += '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; });
        h += '</select>';
        h += '<button class="btn btn-small btn-primary" onclick="AdvisorV2.linkPendingDoc(\'' + esc(d.id || '') + '\',\'' + selectId + '\')">Link</button>';
        h += '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.deletePendingDoc(\'' + esc(d.id || '') + '\')">Delete</button>';
      }
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  async function linkPendingDoc(documentId, selectId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var sel = document.getElementById(selectId);
    if (!sel || !sel.value) return;
    var parts = sel.value.split(':');
    var section = parts[0];
    var idx = parseInt(parts[1], 10);
    if (_PDOC_COMPLIANCE_SECTIONS.indexOf(section) === -1 || !isFinite(idx)) return;
    try {
      await MastDB.businessEntity.documents.link(documentId, 'compliance.' + section, idx, 'documentId');
      if (window.showToast) showToast('Document linked');
    } catch (err) {
      if (window.showToast) showToast('Could not link: ' + (err.message || 'unknown'), true);
    }
  }

  async function deletePendingDoc(documentId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var ok = (typeof window.mastConfirm === 'function')
      ? await window.mastConfirm('Delete this uploaded document? It will be purged within 6 hours.', { title: 'Delete document?', confirmLabel: 'Delete', cancelLabel: 'Keep' })
      : true;
    if (!ok) return;
    try {
      await MastDB.businessEntity.documents.delete(documentId);
      if (window.showToast) showToast('Document scheduled for purge');
    } catch (err) {
      if (window.showToast) showToast('Could not delete: ' + (err.message || 'unknown'), true);
    }
  }

  // --- C9: Pending Captures + diff modal (entity write-throughs) ---
  var _CAPTURE_SECTION_ICONS = {
    identity: '\u{1F3E2}',
    presence: '\u{1F310}',
    operations: '⚙️',
    people: '\u{1F464}',
    compliance: '✅',
    engagement: '\u{1F4CD}'
  };

  function _captureSectionIcon(section) {
    return _CAPTURE_SECTION_ICONS[section] || '\u{1F4DD}';
  }

  function _captureSectionLabel(section) {
    if (!section) return '';
    return section.charAt(0).toUpperCase() + section.slice(1);
  }

  function rerenderCapturesSection() {
    var root = document.getElementById('advisorV2CapturesRoot');
    if (!root) return;
    root.innerHTML = renderCapturesSection();
  }

  function renderCapturesSection() {
    var pending = (capturesData || []).filter(function (c) { return c && c.status === 'pending-review'; });
    if (pending.length === 0) return '';
    var allowEdit = canEdit();
    var h = '<div class="advisorv2-section">';
    h += '<div class="advisorv2-section-title">\u{1F4AC} Pending Reviews <span style="font-weight:400;color:var(--warm-gray-light);font-size:0.85rem;margin-left:4px;">(' + pending.length + ')</span></div>';
    pending.forEach(function (cap) {
      var isLowConf = typeof cap.confidence === 'number' && cap.confidence < 0.6;
      var pillClass = isLowConf ? 'advisorv2-capture-pill low-confidence' : 'advisorv2-capture-pill';
      var confStr = (typeof cap.confidence === 'number') ? (' • ' + Math.round(cap.confidence * 100) + '% confidence') : '';
      var expiresStr = cap.expiresAt ? ' • expires ' + esc(timeAgo(cap.expiresAt).replace(/^-\s*/, '')) : '';
      h += '<div class="advisorv2-capture-card" id="advV2Capture-' + esc(cap.id) + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + esc(_captureSectionIcon(cap.targetSection)) + ' Review ' + esc(_captureSectionLabel(cap.targetSection)) + ' capture</div>';
      h += '<div class="meta">via ' + esc(cap.skillName || 'unknown-skill') + ' • captured ' + esc(timeAgo(cap.createdAt)) + confStr + expiresStr + '</div>';
      h += '<div style="margin-top:6px;"><span class="' + pillClass + '">' + (isLowConf ? 'please double-check' : 'pending review') + '</span></div>';
      h += '</div>';
      if (allowEdit) {
        h += '<div class="advisorv2-capture-actions">';
        h += '<button class="btn btn-small btn-primary" onclick="AdvisorV2.reviewCapture(\'' + esc(cap.id) + '\')">Review</button>';
        h += '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.dismissCapture(\'' + esc(cap.id) + '\')">Dismiss</button>';
      }
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function _captureById(id) {
    for (var i = 0; i < capturesData.length; i++) if (capturesData[i] && capturesData[i].id === id) return capturesData[i];
    return null;
  }

  var _CAPTURE_TO_SETTINGS_VIEW = {
    identity: 'identity',
    presence: 'presence',
    operations: 'operations',
    people: 'people',
    compliance: 'compliance',
    engagement: 'engagement'
  };

  function _deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!_deepEqual(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      var ak = Object.keys(a), bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      for (var j = 0; j < ak.length; j++) {
        if (!Object.prototype.hasOwnProperty.call(b, ak[j])) return false;
        if (!_deepEqual(a[ak[j]], b[ak[j]])) return false;
      }
      return true;
    }
    return false;
  }

  function _formatDiffValue(v) {
    if (v === undefined || v === null) return '(not set)';
    if (v === 'unknown') return '(user deferred — will be skipped)';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v, null, 2); }
    catch (e) { return String(v); }
  }

  // The diff modal renders into the shared engine overlay via openModal() —
  // no module-level fixed-position backdrop (UX-standards 05/08).
  function _openCaptureModal(cap) {
    var currentEntity = (entityData && entityData[cap.targetSection]) || {};
    var proposed = cap.proposedData || {};
    var fieldKeys = Object.keys(proposed);
    var icon = _captureSectionIcon(cap.targetSection);
    var label = _captureSectionLabel(cap.targetSection);
    var skill = cap.skillName || 'unknown-skill';
    var confPct = (typeof cap.confidence === 'number') ? Math.round(cap.confidence * 100) + '%' : 'not reported';

    var bodyRows = fieldKeys.map(function (key) {
      var propVal = proposed[key];
      var curVal = currentEntity[key];
      var isUnknown = propVal === 'unknown';
      var isUnchanged = _deepEqual(propVal, curVal);
      var proposedClasses = ['diff-pane', 'proposed'];
      if (isUnknown) proposedClasses.push('unknown-sentinel');
      var rowClasses = ['diff-row'];
      if (isUnknown) rowClasses.push('unknown');
      var checkedAttr = (isUnknown || isUnchanged) ? '' : ' checked';
      var disabledAttr = isUnknown ? ' disabled' : '';
      return '<div class="' + rowClasses.join(' ') + '" data-field="' + esc(key) + '">' +
        '<div class="diff-row-header">' +
          '<span class="diff-row-field">' + esc(key) + '</span>' +
          '<label class="diff-row-checkbox">' +
            '<input type="checkbox" class="advv2-capture-field-check"' + checkedAttr + disabledAttr + ' data-field="' + esc(key) + '" />' +
            (isUnknown ? 'skip (unknown)' : (isUnchanged ? 'no change' : 'accept')) +
          '</label>' +
        '</div>' +
        '<div class="diff-pair">' +
          '<div>' +
            '<div class="diff-label">Current</div>' +
            '<div class="diff-pane current">' + esc(_formatDiffValue(curVal)) + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="diff-label">Proposed</div>' +
            '<div class="' + proposedClasses.join(' ') + '">' + esc(_formatDiffValue(propVal)) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var settingsTarget = _CAPTURE_TO_SETTINGS_VIEW[cap.targetSection] || 'identity';

    var html = '<div class="advisorv2-capture-modal" role="dialog" aria-label="Review capture">' +
        '<h2>' + esc(icon) + ' Review ' + esc(label) + ' capture</h2>' +
        '<div class="modal-sub">via ' + esc(skill) + ' • captured ' + esc(timeAgo(cap.createdAt)) + ' • confidence ' + esc(confPct) + '</div>' +
        '<div class="modal-escape">' +
          '<span>Prefer a form? Switch to Settings › ' + esc(label) + ' — we\'ll save this proposal for later.</span>' +
          '<a onclick="AdvisorV2.captureSwitchToForm(\'' + esc(cap.id) + '\', \'' + esc(settingsTarget) + '\')">Switch to form →</a>' +
        '</div>' +
        '<div class="modal-toggles">' +
          '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.captureAcceptAll()">Accept all</button>' +
          '<button class="btn btn-small btn-secondary" onclick="AdvisorV2.captureRejectAll()">Reject all fields</button>' +
        '</div>' +
        '<div id="advV2CaptureDiffRows">' + bodyRows + '</div>' +
        '<textarea id="advV2CaptureRejectReason" class="modal-reject-reason" placeholder="Why are you rejecting? (optional — helps improve the skill)"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn" style="background:rgba(239,68,68,0.15);color:rgb(239,68,68);border:1px solid rgba(239,68,68,0.35);" onclick="AdvisorV2.captureReject(\'' + esc(cap.id) + '\')">Reject</button>' +
          '<button class="btn btn-primary" onclick="AdvisorV2.captureRatify(\'' + esc(cap.id) + '\')">Accept selected</button>' +
        '</div>' +
      '</div>';

    if (typeof window.openModal === 'function') {
      window.openModal(html);
    }
  }

  async function reviewCapture(captureId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var cap = _captureById(captureId);
    if (!cap) {
      try { cap = await MastDB.businessEntity.capture.get(captureId); }
      catch (e) {
        if (window.showToast) showToast('Could not load capture: ' + (e.message || 'unknown'), true);
        return;
      }
    }
    if (!cap) return;
    if (!entityData && MastDB && MastDB.businessEntity && MastDB.businessEntity.get) {
      try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
    }
    _openCaptureModal(cap);
  }

  async function dismissCapture(captureId) {
    if (!canEdit()) { if (window.showToast) showToast('Edit access required.', true); return; }
    var ok = (typeof window.mastConfirm === 'function')
      ? await window.mastConfirm('Dismiss this capture without reviewing? You can always re-run the skill later.', { title: 'Dismiss capture?', confirmLabel: 'Dismiss', cancelLabel: 'Keep' })
      : true;
    if (!ok) return;
    try {
      await MastDB.businessEntity.capture.reject(captureId, null);
      if (window.showToast) showToast('Capture dismissed');
    } catch (err) {
      if (window.showToast) showToast('Could not dismiss: ' + (err.message || 'unknown'), true);
    }
  }

  function captureAcceptAll() {
    var boxes = document.querySelectorAll('#advV2CaptureDiffRows .advv2-capture-field-check');
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].disabled) boxes[i].checked = true;
    }
  }

  function captureRejectAll() {
    var boxes = document.querySelectorAll('#advV2CaptureDiffRows .advv2-capture-field-check');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
  }

  async function captureRatify(captureId) {
    var boxes = document.querySelectorAll('#advV2CaptureDiffRows .advv2-capture-field-check');
    var accepted = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked && !boxes[i].disabled) {
        var f = boxes[i].getAttribute('data-field');
        if (f) accepted.push(f);
      }
    }
    try {
      var res = await MastDB.businessEntity.capture.ratify(captureId, accepted);
      if (typeof window.closeModal === 'function') window.closeModal();
      if (window.showToast) {
        if (res && res.entityWriteSkipped) {
          showToast('Capture ratified (no fields were written).');
        } else if (res && res.writtenFields && res.writtenFields.length) {
          showToast('Accepted: ' + res.writtenFields.join(', '));
        } else {
          showToast('Capture ratified.');
        }
      }
    } catch (err) {
      if (window.showToast) showToast('Could not ratify: ' + (err.message || 'unknown'), true);
    }
  }

  async function captureReject(captureId) {
    var reasonEl = document.getElementById('advV2CaptureRejectReason');
    if (reasonEl && !reasonEl.classList.contains('open')) {
      reasonEl.classList.add('open');
      reasonEl.focus();
      if (window.showToast) showToast('Add a reason (optional) and click Reject again to confirm.');
      return;
    }
    var reason = reasonEl ? reasonEl.value.trim() : '';
    try {
      await MastDB.businessEntity.capture.reject(captureId, reason || null);
      if (typeof window.closeModal === 'function') window.closeModal();
      if (window.showToast) showToast('Capture rejected.');
    } catch (err) {
      if (window.showToast) showToast('Could not reject: ' + (err.message || 'unknown'), true);
    }
  }

  async function captureSwitchToForm(captureId, settingsView) {
    // Leave the capture pending so the user can ratify from Settings later.
    if (typeof window.closeModal === 'function') window.closeModal();
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('settings');
      setTimeout(function () {
        if (typeof window.switchSettingsSubView === 'function' && settingsView) {
          try { window.switchSettingsSubView(settingsView); } catch (_) {}
        }
      }, 80);
    }
    if (window.showToast) showToast('Switched to form. Capture still in pending review.');
  }

  // --- Window exports (namespaced) ---
  window.AdvisorV2 = {
    switchPeriod: function (period) {
      currentPeriod = period;
      document.querySelectorAll('.advisorv2-period-tab').forEach(function (btn) {
        btn.classList.toggle('active', btn.textContent.toLowerCase() === period);
      });
      loadAndRenderActuals(period);
    },
    toggleReview: function (idx) {
      var el = document.getElementById('advisorV2Review' + idx);
      if (el) el.classList.toggle('open');
    },
    markRenewed: markRenewed,
    snoozeRenewal: snoozeRenewal,
    archiveRenewal: archiveRenewal,
    linkPendingDoc: linkPendingDoc,
    deletePendingDoc: deletePendingDoc,
    reviewCapture: reviewCapture,
    dismissCapture: dismissCapture,
    captureAcceptAll: captureAcceptAll,
    captureRejectAll: captureRejectAll,
    captureRatify: captureRatify,
    captureReject: captureReject,
    captureSwitchToForm: captureSwitchToForm
  };

  // Register module
  // Shared route handler. The legacy 'advisor' route resolves here too: advisor.js
  // (V1) was retired (T6, Legacy-UI sunset); this is now the only Business Plan
  // admin UI for ALL users, regardless of the redesign flag.
  var _advV2Route = {
    tab: 'advisorV2Tab',
    setup: function () { ensureTab(); if (!advisorLoaded) loadAdvisor(); }
  };
  MastAdmin.registerModule('advisor-v2', {
    routes: {
      'advisor-v2': _advV2Route,
      'advisor': _advV2Route
    },
    detachListeners: function () {
      planData = null;
      healthScore = null;
      reviewsData = [];
      advisorLoaded = false;
      if (entitySubscription && typeof entitySubscription === 'function') {
        try { entitySubscription(); } catch (_) {}
      }
      entitySubscription = null;
      entityData = null;
      if (renewalsSubscription && typeof renewalsSubscription === 'function') {
        try { renewalsSubscription(); } catch (_) {}
      }
      renewalsSubscription = null;
      renewalsData = [];
      if (documentsSubscription && typeof documentsSubscription === 'function') {
        try { documentsSubscription(); } catch (_) {}
      }
      documentsSubscription = null;
      documentsData = [];
      if (capturesSubscription && typeof capturesSubscription === 'function') {
        try { capturesSubscription(); } catch (_) {}
      }
      capturesSubscription = null;
      capturesData = [];
      if (channelsSubscription && typeof channelsSubscription === 'function') {
        try { channelsSubscription(); } catch (_) {}
      }
      channelsSubscription = null;
      _channelsCache = null;
    }
  });
})();
