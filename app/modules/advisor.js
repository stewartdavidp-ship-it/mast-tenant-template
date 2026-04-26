(function() {
  'use strict';

  // Module state
  var planData = null;
  var healthScore = null;
  var reviewsData = [];
  var advisorLoaded = false;
  var currentPeriod = 'month';
  var actualsCache = {};
  // B7 (Entity Phase 1): cached entity read-view + subscription handle.
  var entityData = null;
  var entitySubscription = null;
  // PA-7 (Entity Phase 2): renewals + pending-docs caches + subscription handles.
  var renewalsData = [];
  var renewalsSubscription = null;
  var documentsData = [];
  var documentsSubscription = null;
  var channelsSubscription = null;
  // P2D-S1 (Entity Phase 2): pending-review conversational captures.
  var capturesData = [];
  var capturesSubscription = null;

  // --- CSS (injected once) ---
  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.advisor-score-ring { width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;margin:0 auto 8px;position:relative;background:conic-gradient(var(--ring-color,var(--teal)) calc(var(--ring-pct,0) * 3.6deg), var(--bg-secondary,#2a2a2a) 0); }',
      '.advisor-score-ring-inner { width:90px;height:90px;border-radius:50%;background:var(--bg-primary,var(--charcoal));display:flex;align-items:center;justify-content:center;flex-direction:column; }',
      '.advisor-score-ring-num { font-size:1.6rem;font-weight:800;line-height:1; }',
      '.advisor-score-ring-label { font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisor-dim-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px; }',
      '.advisor-dim-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:12px;text-align:center; }',
      '.advisor-dim-name { font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px; }',
      '.advisor-dim-score { font-size:1.6rem;font-weight:700;line-height:1.2; }',
      '.advisor-dim-trend { font-size:0.78rem;margin-left:4px; }',
      '.advisor-dim-bar { height:4px;border-radius:2px;background:var(--hover-bg,#333);margin-top:6px;overflow:hidden; }',
      '.advisor-dim-bar-fill { height:100%;border-radius:2px;transition:width 0.4s ease; }',
      '.advisor-dim-note { font-size:0.72rem;color:var(--warm-gray-light,#666);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
      '.advisor-thermo { background:var(--bg-secondary,#232323);border-radius:10px;padding:16px;margin-bottom:12px; }',
      '.advisor-thermo-label { display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:0.85rem; }',
      '.advisor-thermo-bar { height:18px;border-radius:9px;background:var(--hover-bg,#333);position:relative;overflow:visible; }',
      '.advisor-thermo-fill { height:100%;border-radius:9px;transition:width 0.5s ease;min-width:2px; }',
      '.advisor-thermo-pace { position:absolute;top:-4px;width:2px;height:26px;background:var(--warm-gray,#888);border-radius:1px; }',
      '.advisor-thermo-values { display:flex;justify-content:space-between;font-size:0.78rem;color:var(--warm-gray,#888);margin-top:4px; }',
      '.advisor-period-tabs { display:flex;gap:4px;margin-bottom:16px; }',
      '.advisor-period-tab { padding:6px 16px;border-radius:6px;font-size:0.85rem;cursor:pointer;background:var(--bg-secondary,#232323);color:var(--warm-gray,#888);border:none;transition:all 0.15s; }',
      '.advisor-period-tab.active { background:var(--teal,var(--teal));color:#fff; }',
      '.advisor-kpi-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px; }',
      '.advisor-kpi-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:4px; }',
      '.advisor-kpi-name { font-size:0.78rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisor-kpi-value { font-size:1.15rem;font-weight:700; }',
      '.advisor-kpi-target { font-size:0.78rem;color:var(--warm-gray-light,#666); }',
      '.advisor-kpi-badge { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;text-transform:uppercase; }',
      '.advisor-kpi-badge.on-track { background:rgba(34,197,94,0.15);color:#22c55e; }',
      '.advisor-kpi-badge.at-risk { background:rgba(234,179,8,0.15);color:#eab308; }',
      '.advisor-kpi-badge.off-track { background:rgba(239,68,68,0.15);color:#ef4444; }',
      '.advisor-review-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;transition:background 0.15s; }',
      '.advisor-review-card:hover { background:var(--hover-bg,#2a2a2a); }',
      '.advisor-review-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:4px; }',
      '.advisor-review-type { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;text-transform:uppercase;background:rgba(42,124,111,0.15);color:var(--teal,var(--teal)); }',
      '.advisor-review-detail { display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--hover-bg,#333); }',
      '.advisor-review-detail.open { display:block; }',
      '.advisor-action-item { display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.85rem; }',
      '.advisor-action-status { width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0; }',
      '.advisor-action-status.pending { background:rgba(234,179,8,0.15);color:#eab308; }',
      '.advisor-action-status.done { background:rgba(34,197,94,0.15);color:#22c55e; }',
      '.advisor-empty { text-align:center;padding:60px 20px; }',
      '.advisor-empty h2 { font-size:1.6rem;margin-bottom:8px;color:var(--text,#fff); }',
      '.advisor-empty p { color:var(--warm-gray,#888);font-size:0.9rem;margin-bottom:24px;max-width:400px;margin-left:auto;margin-right:auto; }',
      '.advisor-empty-icon { font-size:1.6rem;margin-bottom:16px; }',
      '.advisor-section { margin-bottom:28px; }',
      '.advisor-section-title { font-size:1rem;font-weight:600;color:var(--text,#fff);margin-bottom:12px;display:flex;align-items:center;gap:8px; }',
      // PA-7 (Entity Phase 2): renewals + pending-docs card styling
      '.advisor-renewal-card, .advisor-pdoc-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap; }',
      '.advisor-renewal-card .title, .advisor-pdoc-card .title { font-size:0.9rem;font-weight:600;margin-bottom:2px; }',
      '.advisor-renewal-card .meta, .advisor-pdoc-card .meta { font-size:0.78rem;color:var(--warm-gray,#888); }',
      '.advisor-renewal-pill { display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase; }',
      '.advisor-renewal-pill.active  { background:rgba(42,157,143,0.15);color:var(--teal,#2a9d8f); }',
      '.advisor-renewal-pill.warning { background:rgba(234,179,8,0.15);color:#eab308; }',
      '.advisor-renewal-pill.expired { background:rgba(239,68,68,0.15);color:#ef4444; }',
      '.advisor-renewal-actions, .advisor-pdoc-actions { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }',
      '.advisor-renewal-actions button, .advisor-pdoc-actions button, .advisor-pdoc-actions select { font-size:0.72rem;padding:4px 8px; }',
      '.advisor-renewal-card .inline-date { font-size:0.78rem;padding:4px 6px;background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);border:1px solid var(--teal,#2a9d8f);border-radius:4px; }',
      '.advisor-pdoc-card select { background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px 6px; }',
      // P2D-S1 (Entity Phase 2): conversational capture pending-review cards
      '.advisor-capture-card { background:var(--bg-secondary,#232323);border:1px solid rgba(129,140,248,0.25);border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap; }',
      '.advisor-capture-card .title { font-size:0.9rem;font-weight:600;margin-bottom:2px; }',
      '.advisor-capture-card .meta { font-size:0.78rem;color:var(--warm-gray,#888); }',
      '.advisor-capture-pill { display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:600;text-transform:uppercase;background:rgba(129,140,248,0.15);color:#818cf8; }',
      '.advisor-capture-pill.low-confidence { background:rgba(239,68,68,0.15);color:#ef4444; }',
      '.advisor-capture-actions { display:flex;gap:6px;flex-wrap:wrap;align-items:center; }',
      '.advisor-capture-actions button { font-size:0.72rem;padding:4px 8px; }',
      // Diff-review modal (opens when user clicks Review)
      '.capture-modal-backdrop { position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px; }',
      '.capture-modal { background:var(--bg-primary,#1a1a1a);border:1px solid rgba(255,255,255,0.1);border-radius:14px;max-width:720px;width:100%;max-height:85vh;overflow:auto;padding:24px;color:var(--text,#fff);box-shadow:0 20px 60px rgba(0,0,0,0.5); }',
      '.capture-modal h2 { margin:0 0 4px 0;font-size:1.2rem;display:flex;align-items:center;gap:8px; }',
      '.capture-modal .modal-sub { font-size:0.82rem;color:var(--warm-gray,#888);margin-bottom:16px; }',
      '.capture-modal .modal-escape { margin-bottom:16px;padding:10px 12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:8px;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center;gap:12px; }',
      '.capture-modal .modal-escape a { color:#eab308;text-decoration:underline;cursor:pointer; }',
      '.capture-modal .diff-row { border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-secondary,#232323); }',
      '.capture-modal .diff-row.unknown { opacity:0.55; }',
      '.capture-modal .diff-row-header { display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px; }',
      '.capture-modal .diff-row-field { font-family:var(--mono, monospace);font-size:0.82rem;font-weight:600;color:var(--teal,#2a9d8f); }',
      '.capture-modal .diff-row-checkbox { display:flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--warm-gray,#888);cursor:pointer; }',
      '.capture-modal .diff-row-checkbox input[type="checkbox"] { width:16px;height:16px;cursor:pointer; }',
      '.capture-modal .diff-pair { display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem; }',
      '.capture-modal .diff-pane { background:var(--bg-primary,var(--charcoal));border-radius:6px;padding:8px 10px;min-height:40px;font-family:var(--mono, monospace);font-size:0.78rem;overflow-wrap:break-word;white-space:pre-wrap; }',
      '.capture-modal .diff-pane.current { color:var(--warm-gray,#888); }',
      '.capture-modal .diff-pane.proposed { color:var(--text,#fff);border:1px solid rgba(42,157,143,0.4); }',
      '.capture-modal .diff-pane.proposed.removed { border-color:rgba(239,68,68,0.4);color:#ef4444; }',
      '.capture-modal .diff-pane.unknown-sentinel { color:#eab308;font-style:italic; }',
      '.capture-modal .diff-label { font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--warm-gray-light,#666);margin-bottom:4px; }',
      '.capture-modal .modal-toggles { display:flex;gap:8px;margin-bottom:14px; }',
      '.capture-modal .modal-actions { display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06); }',
      '.capture-modal .modal-reject-reason { width:100%;box-sizing:border-box;background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:0.82rem;font-family:inherit;margin-top:8px;display:none; }',
      '.capture-modal .modal-reject-reason.open { display:block; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // --- Helpers ---
  function scoreColor(score) {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#eab308';
    return '#ef4444';
  }
  function trendArrow(trend) {
    if (trend === 'up') return '<span style="color:#22c55e;">&#9650;</span>';
    if (trend === 'down') return '<span style="color:#ef4444;">&#9660;</span>';
    return '<span style="color:var(--warm-gray);">&#9654;</span>';
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

  // --- Data Loading ---
  async function loadAdvisor() {
    injectCSS();
    var container = document.getElementById('advisorTab');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Loading advisor...</div>';

    try {
      // Parallel reads
      var [statusSnap, healthSnap, profileSnap, targetsSnap, marginSnap, kpiSnap, channelSnap, calSnap, reviewsSnap] = await Promise.all([
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
      reviewsData = Object.values(revData).sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      advisorLoaded = true;

      // B7 (Entity Phase 1): subscribe once to entity changes. The callback
      // updates cached entityData and re-renders just the entity section, so
      // edits roundtrip without reloading the advisor view. Per plan Build A1
      // risk flag: use .subscribe() (single onSnapshot) not .get() per click.
      if (!entitySubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.subscribe) {
        try {
          entitySubscription = MastDB.businessEntity.subscribe(function(ent) {
            entityData = ent;
            // Pending-docs card references compliance arrays to populate the
            // Link-to dropdown — re-render when entity data changes.
            rerenderPendingDocsSection();
          });
        } catch (subErr) {
          console.warn('[advisor] entity subscribe failed, falling back to get():', subErr && subErr.message);
          try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
        }
      } else if (!entityData && window.MastDB && MastDB.businessEntity) {
        try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
      }

      // PA-7 (Entity Phase 2): single subscription per stream; mirror B7 cost
      // discipline — constant reads per tab click, no per-render `.get()`.
      if (!renewalsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.renewals) {
        try {
          renewalsSubscription = MastDB.businessEntity.renewals.subscribeItems(function(items) {
            renewalsData = Array.isArray(items) ? items : [];
            rerenderRenewalsSection();
          });
        } catch (subErr) {
          console.warn('[advisor] renewals subscribe failed:', subErr && subErr.message);
        }
      }
      if (!documentsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.documents) {
        try {
          documentsSubscription = MastDB.businessEntity.documents.subscribe(function(docs) {
            documentsData = Array.isArray(docs) ? docs : [];
            rerenderPendingDocsSection();
          });
        } catch (subErr) {
          console.warn('[advisor] documents subscribe failed:', subErr && subErr.message);
        }
      }

      // P2D-S1 (Phase 2 P2D): pending-review conversational captures. Single
      // subscription per stream. Renders a Review CTA per capture; click opens
      // the diff-review modal. Mirrors PA-7's constant-cost pattern.
      if (!capturesSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.capture && MastDB.businessEntity.capture.subscribe) {
        try {
          capturesSubscription = MastDB.businessEntity.capture.subscribe(function(items) {
            capturesData = Array.isArray(items) ? items : [];
            rerenderCapturesSection();
          });
        } catch (subErr) {
          console.warn('[advisor] captures subscribe failed:', subErr && subErr.message);
        }
      }

      // PB-3 (Phase 2 P2B): channels-oauth live subscription. `.list()` returns
      // masked records; the card reflects status + shop + webhook count.
      if (!channelsSubscription && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.channels && MastDB.businessEntity.channels.subscribe) {
        try {
          channelsSubscription = MastDB.businessEntity.channels.subscribe(function(items) {
            _channelsCache = Array.isArray(items) ? items : [];
            rerenderChannelsSection();
          });
        } catch (subErr) {
          console.warn('[advisor] channels subscribe failed:', subErr && subErr.message);
          // Fall through to a one-shot list() so the card isn't permanently empty.
          loadChannelsForAdvisor();
        }
      } else {
        loadChannelsForAdvisor();
      }

      if (planData.planStatus === 'none' && (!entityData || entityData.entityStatus === 'none' || !entityData.entityStatus)) {
        // No plan AND no entity data → keep legacy empty state, which already
        // directs the user to start planning.
        renderEmptyState(container);
      } else {
        await renderAdvisor(container);
      }
    } catch (err) {
      console.error('Error loading advisor:', err);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger,#ef4444);">Error loading advisor data.</div>';
    }
  }

  // --- Empty State ---
  function renderEmptyState(container) {
    container.innerHTML =
      '<div class="advisor-empty">' +
        '<div class="advisor-empty-icon">&#128202;</div>' +
        '<h2>Your AI Business Advisor</h2>' +
        '<p>Build a business plan to start tracking your health score, revenue targets, and KPIs. Your AI advisor will help you create the plan through conversation.</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
          '<a href="https://claude.ai" target="_blank" class="btn btn-primary" style="text-decoration:none;">Start Planning in Chat</a>' +
        '</div>' +
      '</div>';
  }

  // --- Main Render ---
  async function renderAdvisor(container) {
    var h = '';

    // Draft banner
    if (planData.planStatus === 'draft') {
      h += '<div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;font-size:0.9rem;">' +
        '<span style="font-size:1.15rem;">&#9888;&#65039;</span>' +
        '<span>Your business plan is in progress. Complete it in Chat to unlock full tracking.</span>' +
      '</div>';
    }

    // D-22: About Your Business block superseded by unified Business page.
    // Keep a compact link-out so the advisor still points at entity context.
    h += '<div class="advisor-section" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--bg-secondary,#232323);border-radius:10px;margin-bottom:20px;">' +
      '<div>' +
        '<div style="font-weight:600;margin-bottom:2px;">&#127970; Your business at a glance</div>' +
        '<div style="font-size:0.82rem;color:var(--warm-gray,#888);">Identity, channels, compliance, renewals, people, and more \u2014 all in one place.</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-small" onclick="navigateTo(\'business\')">View full Business profile &rarr;</button>' +
    '</div>';

    // P2D-S1 (Entity Phase 2): pending-review conversational captures surface
    // above renewals since ratification is a blocking decision — the user
    // should see these before working on other entity chores. High visual
    // priority matches Intercom Fin's unresolved-cluster pattern (research §5.2).
    h += '<div id="advisorCapturesRoot">' + renderCapturesSection() + '</div>';

    // PA-7 (Entity Phase 2): renewals + pending-docs cards between About Your
    // Business and Health Score. Each wrapped in its own id'd root so the
    // corresponding subscription can target innerHTML.
    h += '<div id="advisorRenewalsRoot">' + renderRenewalsSection() + '</div>';
    h += '<div id="advisorPendingDocsRoot">' + renderPendingDocsSection() + '</div>';

    // PB-3 (Phase 2 P2B): OAuth channel connection health (Shopify for now;
    // Etsy/Square land in PB-4/5). Wrapped in its own root so the channels
    // subscription can target innerHTML without full re-render.
    h += '<div id="advisorChannelsRoot">' + renderChannelsHealthSection() + '</div>';

    // Section A: Health Score
    h += renderHealthSection();

    // Section B: Plan vs Actuals
    h += '<div id="advisorActualsSection">' + renderPeriodTabs() + '<div id="advisorActualsContent">Loading...</div></div>';

    // Section C: KPI Scorecard
    h += renderKPISection();

    // Section D: Reviews
    h += renderReviewSection();

    container.innerHTML = h;

    // Load actuals for default period
    await loadAndRenderActuals('month');
  }

  // --- Shared helpers (previously under About Your Business section) ---
  function escText(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }

  function archetypeLabel(val) {
    var list = (window.BusinessEntityConstants && BusinessEntityConstants.ARCHETYPES) || [];
    var m = list.filter(function(a) { return a.value === val; })[0];
    return m ? m.label : (val || '');
  }

  function goalLabel(val) {
    var map = (window.BusinessEntityConstants && BusinessEntityConstants.GOAL_LABELS) || {};
    return map[val] || val;
  }

  function channelLabel(val) {
    var list = (window.BusinessEntityConstants && BusinessEntityConstants.DECLARED_CHANNELS) || [];
    var m = list.filter(function(c) { return c.value === val; })[0];
    return m ? m.label : val;
  }

  function modeLabel(val) {
    var list = (window.BusinessEntityConstants && BusinessEntityConstants.ENGAGEMENT_MODE_CARDS) || [];
    var m = list.filter(function(c) { return c.value === val; })[0];
    return m ? m.title : (val || '');
  }


  // --- Section A: Health Score ---
  // --- Section: Connected Channels (Phase 2 P2B PB-3) ---
  // Caches MastDB.businessEntity.channels.list() so re-render is cheap.
  var _channelsCache = null;

  function renderChannelsHealthSection() {
    var items = Array.isArray(_channelsCache) ? _channelsCache : [];
    // Only show once we have data OR a pending load has returned an empty list.
    // Start lean: hide until first load attempt completes.
    if (_channelsCache === null) {
      return ''; // nothing until first load
    }
    if (items.length === 0) {
      return ''; // no connected integrations → do not occupy space
    }
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#128279; Connected Channels</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px;">';
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var platform = c.platform || c.channelId;
      var status = c.status || 'unknown';
      var statusColor = status === 'connected' ? 'var(--success,#22c55e)'
        : status === 'expired' ? 'var(--warning,#f59e0b)'
        : status === 'error' || status === 'revoked' ? 'var(--danger,#ef4444)'
        : 'var(--warm-gray)';
      var icon = platform === 'shopify' ? '&#128722;' : platform === 'etsy' ? '&#127970;' : platform === 'square' ? '&#9633;' : '&#128279;';
      var sub = '';
      if (status === 'connected') {
        var parts = [];
        if (c.shopDomain || c.shopId) parts.push(esc(c.shopDomain || c.shopId));
        if (typeof c.webhookSubscriptionCount === 'number') parts.push(c.webhookSubscriptionCount + ' hook' + (c.webhookSubscriptionCount === 1 ? '' : 's'));
        if (c.lastSyncAt) parts.push('Synced ' + timeAgo(c.lastSyncAt));
        sub = parts.join(' \u2022 ');
      } else if (c.lastErrorMessage) {
        sub = esc(c.lastErrorMessage);
      }
      h += '<div class="advisor-dim-card" style="text-align:left;">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span style="font-size:1.1rem;">' + icon + '</span>';
      h += '<div style="font-weight:600;text-transform:capitalize;">' + esc(platform) + '</div>';
      h += '<div style="margin-left:auto;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:' + statusColor + ';">' + esc(status) + '</div>';
      h += '</div>';
      if (sub) h += '<div style="font-size:0.72rem;color:var(--warm-gray-light,#666);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>';
      h += '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function rerenderChannelsSection() {
    var root = document.getElementById('advisorChannelsRoot');
    if (root) root.innerHTML = renderChannelsHealthSection();
  }

  async function loadChannelsForAdvisor() {
    if (!window.MastDB || !MastDB.businessEntity || !MastDB.businessEntity.channels) return;
    try {
      _channelsCache = await MastDB.businessEntity.channels.list();
    } catch (err) {
      console.warn('[advisor] channels.list failed:', err && err.message);
      _channelsCache = [];
    }
    rerenderChannelsSection();
  }

  function renderHealthSection() {
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#128200; Business Health</div>';

    if (!healthScore) {
      h += '<div style="text-align:center;padding:24px;background:var(--bg-secondary,#232323);border-radius:10px;color:var(--warm-gray);">' +
        'No health score calculated yet. Ask your AI advisor to run a health check.</div>';
      h += '</div>';
      return h;
    }

    var overall = healthScore.overall || 0;
    var color = scoreColor(overall);

    // Score ring
    h += '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">';
    h += '<div style="text-align:center;">';
    h += '<div class="advisor-score-ring" style="--ring-pct:' + overall + ';--ring-color:' + color + ';">';
    h += '<div class="advisor-score-ring-inner">';
    h += '<div class="advisor-score-ring-num" style="color:' + color + ';">' + overall + '</div>';
    h += '<div class="advisor-score-ring-label">Health</div>';
    h += '</div></div>';
    if (healthScore.calculatedAt) {
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light,#666);">Updated ' + timeAgo(healthScore.calculatedAt) + '</div>';
    }
    h += '</div>';

    // Dimension cards
    h += '<div style="flex:1;min-width:300px;">';
    h += '<div class="advisor-dim-grid">';
    var dims = healthScore.dimensions || {};
    var dimOrder = ['revenue', 'margins', 'diversification', 'inventory', 'cashFlow', 'growth', 'pipeline'];
    var dimLabels = { revenue: 'Revenue', margins: 'Margins', diversification: 'Channels', inventory: 'Inventory', cashFlow: 'Cash Flow', growth: 'Growth', pipeline: 'Pipeline' };

    for (var i = 0; i < dimOrder.length; i++) {
      var key = dimOrder[i];
      var dim = dims[key];
      if (!dim) continue;
      var dColor = scoreColor(dim.score);
      h += '<div class="advisor-dim-card">';
      h += '<div class="advisor-dim-name">' + esc(dimLabels[key] || key) + '</div>';
      h += '<div class="advisor-dim-score" style="color:' + dColor + ';">' + dim.score + ' ' + trendArrow(dim.trend) + '</div>';
      h += '<div class="advisor-dim-bar"><div class="advisor-dim-bar-fill" style="width:' + dim.score + '%;background:' + dColor + ';"></div></div>';
      h += '<div class="advisor-dim-note">' + esc(dim.note || '') + '</div>';
      h += '</div>';
    }
    h += '</div></div></div>';
    h += '</div>';
    return h;
  }

  // --- Section B: Plan vs Actuals ---
  function renderPeriodTabs() {
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#127919; Plan vs Actuals</div>';
    h += '<div class="advisor-period-tabs">';
    ['month', 'quarter', 'year'].forEach(function(p) {
      var label = p === 'month' ? 'Month' : p === 'quarter' ? 'Quarter' : 'Year';
      h += '<button class="advisor-period-tab' + (p === currentPeriod ? ' active' : '') + '" onclick="switchAdvisorPeriod(\'' + p + '\')">' + label + '</button>';
    });
    h += '</div>';
    h += '</div>';
    return h;
  }

  async function loadAndRenderActuals(period) {
    currentPeriod = period;
    var contentEl = document.getElementById('advisorActualsContent');
    if (!contentEl) return;
    contentEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--warm-gray);">Loading...</div>';

    if (!planData || !planData.revenueTargets) {
      contentEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--warm-gray);">No revenue targets set. Build your plan to see comparisons.</div>';
      return;
    }

    try {
      // Get current period dates
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

      // Aggregate plan targets for period
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

      // Read actuals
      var [ordersSnap, salesSnap] = await Promise.all([
        MastDB.query('orders').orderByChild('createdAt').limitToLast(500).once('value'),
        MastDB.query('admin/sales').orderByChild('timestamp').limitToLast(500).once('value'),
      ]);
      var orders = ordersSnap || {};
      var sales = salesSnap || {};

      var channelActuals = {};
      var totalActual = 0;

      Object.values(orders).forEach(function(o) {
        var d = (o.createdAt || '').split('T')[0];
        if (d < rangeStart || d > rangeEnd) return;
        if (o.status === 'cancelled' || o.status === 'refunded') return;
        var amt = o.total || 0;
        totalActual += amt;
        var ch = o.source === 'wholesale' ? 'wholesale' : 'online';
        channelActuals[ch] = (channelActuals[ch] || 0) + amt;
      });

      Object.values(sales).forEach(function(s) {
        var d = (s.timestamp || s.createdAt || '').split('T')[0];
        if (d < rangeStart || d > rangeEnd) return;
        if (s.status === 'voided') return;
        var amt = s.amount || 0;
        totalActual += amt;
        var ch = s.eventId ? 'craft-fairs' : 'online';
        channelActuals[ch] = (channelActuals[ch] || 0) + amt;
      });

      var projected = Math.round(totalActual / daysElapsed * daysTotal);
      var pacePct = daysTotal > 0 ? Math.round(daysElapsed / daysTotal * 100) : 0;
      var actualPct = totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : 0;

      // Render
      var h = '';

      // Total thermometer
      h += renderThermometer('Total Revenue', totalTarget, totalActual, projected, pacePct, actualPct, daysRemaining);

      // Per-channel thermometers
      var allChannels = Object.keys(Object.assign({}, channelTargets, channelActuals));
      var channelLabels = { online: 'Online', 'craft-fairs': 'Craft Fairs', wholesale: 'Wholesale', consignment: 'Consignment', commissions: 'Commissions' };
      allChannels.sort().forEach(function(ch) {
        var t = channelTargets[ch] || 0;
        var a = channelActuals[ch] || 0;
        if (t === 0 && a === 0) return;
        var p = t > 0 ? Math.round(a / t * 100) : (a > 0 ? 100 : 0);
        h += renderThermometer(channelLabels[ch] || ch, t, a, null, pacePct, p, null);
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
    var variance = target > 0 ? actual - target : 0;
    var variancePct = target > 0 ? Math.round((actual - target) / target * 100) : null;

    // Color: compare actual % to pace %
    var fillColor;
    if (actualPct >= pacePct) fillColor = '#22c55e'; // ahead of pace
    else if (actualPct >= pacePct * 0.9) fillColor = '#eab308'; // within 10%
    else fillColor = '#ef4444'; // behind pace

    var h = '<div class="advisor-thermo">';
    h += '<div class="advisor-thermo-label">';
    h += '<span style="font-weight:600;">' + esc(label) + '</span>';
    if (variancePct !== null) {
      var vColor = variancePct >= 0 ? '#22c55e' : '#ef4444';
      h += '<span style="color:' + vColor + ';font-size:0.85rem;font-weight:600;">' + fmtPct(variancePct) + '</span>';
    }
    h += '</div>';

    h += '<div class="advisor-thermo-bar">';
    h += '<div class="advisor-thermo-fill" style="width:' + fillPct + '%;background:' + fillColor + ';"></div>';
    if (pacePct > 0 && pacePct < 100) {
      h += '<div class="advisor-thermo-pace" style="left:' + pacePct + '%;" title="Expected pace"></div>';
    }
    h += '</div>';

    h += '<div class="advisor-thermo-values">';
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

  // --- Section C: KPI Scorecard ---
  function renderKPISection() {
    var targets = planData.kpiTargets;
    if (!targets || Object.keys(targets).length === 0) return '';

    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#127919; KPI Targets</div>';
    h += '<div class="advisor-kpi-grid">';

    var kpiLabels = {
      grossMargin: 'Gross Margin',
      netMargin: 'Net Margin',
      avgOrderValue: 'Avg Order Value',
      inventoryTurnover: 'Inventory Turnover',
      repeatCustomerRate: 'Repeat Rate',
      revenuePerProductionHour: 'Revenue / Hour',
    };
    var kpiFormats = {
      grossMargin: function(v) { return Math.round(v * 100) + '%'; },
      netMargin: function(v) { return Math.round(v * 100) + '%'; },
      avgOrderValue: function(v) { return fmtMoney(v); },
      inventoryTurnover: function(v) { return v + 'x'; },
      repeatCustomerRate: function(v) { return Math.round(v * 100) + '%'; },
      revenuePerProductionHour: function(v) { return fmtMoney(v); },
    };

    for (var key in targets) {
      if (key === 'updatedAt') continue;
      var target = targets[key];
      var label = kpiLabels[key] || key;
      var fmt = kpiFormats[key] || function(v) { return String(v); };

      h += '<div class="advisor-kpi-card">';
      h += '<div class="advisor-kpi-name">' + esc(label) + '</div>';
      h += '<div class="advisor-kpi-target">Target: ' + fmt(target) + '</div>';
      // Actual values would require additional data loading — show target for now
      // The monthly review skill calculates and presents actuals
      h += '</div>';
    }

    h += '</div></div>';
    return h;
  }

  // --- Section D: Review History ---
  function renderReviewSection() {
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#128203; Review History</div>';

    if (reviewsData.length === 0) {
      h += '<div style="text-align:center;padding:20px;background:var(--bg-secondary,#232323);border-radius:10px;color:var(--warm-gray);">' +
        'No reviews yet. Ask your AI advisor to run a monthly or quarterly review.</div>';
      h += '</div>';
      return h;
    }

    // Pending actions highlight
    var pendingActions = [];
    reviewsData.forEach(function(r) {
      (r.actions || []).forEach(function(a) {
        if (a.status === 'pending') {
          pendingActions.push({ action: a.action, dueBy: a.dueBy, reviewPeriod: r.period, reviewType: r.type });
        }
      });
    });

    if (pendingActions.length > 0) {
      h += '<div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:8px;padding:12px 16px;margin-bottom:14px;">';
      h += '<div style="font-size:0.78rem;font-weight:600;color:#eab308;margin-bottom:6px;">' + pendingActions.length + ' Pending Action' + (pendingActions.length > 1 ? 's' : '') + '</div>';
      pendingActions.slice(0, 5).forEach(function(a) {
        h += '<div class="advisor-action-item">';
        h += '<div class="advisor-action-status pending">&#9679;</div>';
        h += '<span>' + esc(a.action) + '</span>';
        if (a.dueBy) h += '<span style="color:var(--warm-gray-light);font-size:0.78rem;margin-left:auto;">' + esc(a.dueBy) + '</span>';
        h += '</div>';
      });
      if (pendingActions.length > 5) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">+ ' + (pendingActions.length - 5) + ' more</div>';
      }
      h += '</div>';
    }

    // Review list
    reviewsData.forEach(function(r, idx) {
      var typeColors = { weekly: '#6366f1', monthly: 'var(--teal)', quarterly: '#eab308', annual: '#ef4444' };
      var typeColor = typeColors[r.type] || '#888';

      h += '<div class="advisor-review-card" onclick="toggleAdvisorReview(' + idx + ')">';
      h += '<div class="advisor-review-header">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span class="advisor-review-type" style="background:' + typeColor + '22;color:' + typeColor + ';">' + esc(r.type || '') + '</span>';
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
        if (wCount) h += '<span style="color:#22c55e;">' + wCount + ' win' + (wCount > 1 ? 's' : '') + '</span>';
        if (cCount) h += '<span style="color:#eab308;">' + cCount + ' concern' + (cCount > 1 ? 's' : '') + '</span>';
        if (aCount) h += '<span>' + aCount + ' action' + (aCount > 1 ? 's' : '') + '</span>';
        h += '</div>';
      }

      // Expandable detail
      h += '<div class="advisor-review-detail" id="advisorReview' + idx + '">';
      if (r.wins && r.wins.length > 0) {
        h += '<div style="margin-bottom:10px;"><strong style="color:#22c55e;font-size:0.78rem;">Wins</strong>';
        r.wins.forEach(function(w) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#10003; ' + esc(w) + '</div>'; });
        h += '</div>';
      }
      if (r.concerns && r.concerns.length > 0) {
        h += '<div style="margin-bottom:10px;"><strong style="color:#eab308;font-size:0.78rem;">Concerns</strong>';
        r.concerns.forEach(function(c) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#9888; ' + esc(c) + '</div>'; });
        h += '</div>';
      }
      if (r.actions && r.actions.length > 0) {
        h += '<div><strong style="font-size:0.78rem;">Actions</strong>';
        r.actions.forEach(function(a) {
          var statusClass = a.status === 'done' ? 'done' : 'pending';
          var icon = a.status === 'done' ? '&#10003;' : '&#9679;';
          h += '<div class="advisor-action-item"><div class="advisor-action-status ' + statusClass + '">' + icon + '</div>';
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

  // --- Section: Renewals (PA-7 — Entity Phase 2) ---
  function rerenderRenewalsSection() {
    var root = document.getElementById('advisorRenewalsRoot');
    if (!root) return;
    root.innerHTML = renderRenewalsSection();
  }

  function formatDaysUntil(expiresAt) {
    if (!expiresAt) return '';
    var ms = Date.parse(expiresAt);
    if (!isFinite(ms)) return '';
    var days = Math.round((ms - Date.now()) / 86400000);
    if (days === 0) return 'today';
    if (days > 0) return 'in ' + days + ' day' + (days === 1 ? '' : 's');
    var n = -days;
    return n + ' day' + (n === 1 ? '' : 's') + ' overdue';
  }

  function _formatExpiresDate(expiresAt) {
    if (!expiresAt) return '';
    var d = new Date(expiresAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  }

  function renderRenewalsSection() {
    var nowIso = new Date().toISOString();
    var actionable = renewalsData.filter(function(it) {
      if (!it) return false;
      if (it.archived === true) return false;
      if (it.status === 'archived' || it.status === 'completed') return false;
      if (it.snoozeUntil && it.snoozeUntil > nowIso) return false;
      return it.status === 'warning' || it.status === 'expired';
    });
    if (actionable.length === 0) return '';
    actionable.sort(function(a, b) {
      var ea = String(a.expiresAt || '');
      var eb = String(b.expiresAt || '');
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#128197; Upcoming Renewals</div>';
    actionable.forEach(function(it) {
      var pillClass = it.status === 'expired' ? 'expired' : (it.status === 'warning' ? 'warning' : 'active');
      h += '<div class="advisor-renewal-card" id="advRenewal-' + escText(it.id) + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + escText(it.title || '(untitled)') + '</div>';
      h += '<div class="meta">Expires ' + escText(_formatExpiresDate(it.expiresAt)) + ' &middot; ' + escText(formatDaysUntil(it.expiresAt));
      if (it.sourceType) h += ' &middot; ' + escText(it.sourceType);
      h += '</div>';
      h += '<div style="margin-top:6px;"><span class="advisor-renewal-pill ' + pillClass + '">' + escText(it.status || 'active') + '</span></div>';
      h += '</div>';
      h += '<div class="advisor-renewal-actions">';
      h += '<button class="btn btn-small btn-primary" onclick="advisorMarkRenewed(\'' + escText(it.id) + '\')">Mark renewed</button>';
      h += '<button class="btn btn-small" onclick="advisorSnoozeRenewal(\'' + escText(it.id) + '\',7)">+1w</button>';
      h += '<button class="btn btn-small" onclick="advisorSnoozeRenewal(\'' + escText(it.id) + '\',30)">+1m</button>';
      h += '<button class="btn btn-small btn-secondary" onclick="advisorArchiveRenewal(\'' + escText(it.id) + '\')">Archive</button>';
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function _advisorRenewalById(id) {
    for (var i = 0; i < renewalsData.length; i++) if (renewalsData[i] && renewalsData[i].id === id) return renewalsData[i];
    return null;
  }

  async function advisorMarkRenewed(itemId) {
    var it = _advisorRenewalById(itemId);
    if (!it) return;
    var suggested = '';
    if (it.expiresAt) {
      var d = new Date(it.expiresAt);
      if (!isNaN(d.getTime())) { d.setFullYear(d.getFullYear() + 1); suggested = d.toISOString().slice(0, 10); }
    }
    if (!suggested) { var tmp = new Date(); tmp.setFullYear(tmp.getFullYear() + 1); suggested = tmp.toISOString().slice(0, 10); }
    var newDate = null;
    if (typeof window.mastPrompt === 'function') {
      newDate = await window.mastPrompt('Enter the new expiration date (YYYY-MM-DD) for this renewal:', { title: 'Mark ' + (it.title || '') + ' renewed', defaultValue: suggested, confirmLabel: 'Save' });
    } else {
      newDate = window.prompt('New expiration date (YYYY-MM-DD):', suggested);
    }
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

  async function advisorSnoozeRenewal(itemId, days) {
    if (!days || days <= 0) return;
    var until = new Date(Date.now() + days * 86400000).toISOString();
    try {
      await MastDB.businessEntity.renewals.snooze(itemId, until);
      if (window.showToast) showToast('Snoozed ' + days + ' day' + (days === 1 ? '' : 's'));
    } catch (err) {
      if (window.showToast) showToast('Could not snooze: ' + (err.message || 'unknown'), true);
    }
  }

  async function advisorArchiveRenewal(itemId) {
    var ok = typeof window.mastConfirm === 'function'
      ? await window.mastConfirm('Archive this renewal reminder? You can recreate it from Settings > Compliance if needed.', { title: 'Archive reminder?', confirmLabel: 'Archive', cancelLabel: 'Keep' })
      : window.confirm('Archive this renewal reminder?');
    if (!ok) return;
    try {
      await MastDB.businessEntity.renewals.archive(itemId);
      if (window.showToast) showToast('Archived');
    } catch (err) {
      if (window.showToast) showToast('Could not archive: ' + (err.message || 'unknown'), true);
    }
  }

  // --- Section: Pending docs (PA-7 — Entity Phase 2) ---
  function rerenderPendingDocsSection() {
    var root = document.getElementById('advisorPendingDocsRoot');
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
    _PDOC_COMPLIANCE_SECTIONS.forEach(function(section) {
      var arr = Array.isArray(compliance[section]) ? compliance[section] : [];
      arr.forEach(function(item, idx) {
        opts.push({
          value: section + ':' + idx,
          label: section.charAt(0).toUpperCase() + section.slice(1) + ' — ' + _pdocItemLabel(item, section)
        });
      });
    });
    return opts;
  }

  function renderPendingDocsSection() {
    var pending = documentsData.filter(function(d) {
      if (!d) return false;
      if (d.status === 'redacted' || d.status === 'deleted-pending-purge' || d.status === 'quarantined') return false;
      if (d.status === 'uploaded-pending') return true;
      if (d.status === 'uploaded' && !d.linkedTo) return true;
      return false;
    });
    if (pending.length === 0) return '';
    var linkOpts = _pdocLinkOptions();
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#128196; Documents awaiting action</div>';
    pending.forEach(function(d) {
      var selectId = 'advPdocLink-' + escText(d.id || '');
      h += '<div class="advisor-pdoc-card" id="advPdoc-' + escText(d.id || '') + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + escText(d.filename || '(unnamed)') + '</div>';
      h += '<div class="meta">' + escText(d.purpose || '(no purpose)') + (d.createdAt ? ' &middot; uploaded ' + escText(timeAgo(d.createdAt)) : '') + '</div>';
      h += '</div>';
      h += '<div class="advisor-pdoc-actions">';
      if (linkOpts.length === 0) {
        h += '<span style="font-size:0.78rem;color:var(--warm-gray);">Add a compliance item first, then come back to link.</span>';
      } else {
        h += '<select id="' + selectId + '"><option value="">Link to…</option>';
        linkOpts.forEach(function(o) { h += '<option value="' + escText(o.value) + '">' + escText(o.label) + '</option>'; });
        h += '</select>';
        h += '<button class="btn btn-small btn-primary" onclick="advisorLinkPendingDoc(\'' + escText(d.id || '') + '\',\'' + selectId + '\')">Link</button>';
      }
      h += '<button class="btn btn-small btn-secondary" onclick="advisorDeletePendingDoc(\'' + escText(d.id || '') + '\')">Delete</button>';
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  async function advisorLinkPendingDoc(documentId, selectId) {
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

  async function advisorDeletePendingDoc(documentId) {
    var ok = typeof window.mastConfirm === 'function'
      ? await window.mastConfirm('Delete this uploaded document? It will be purged within 6 hours.', { title: 'Delete document?', confirmLabel: 'Delete', cancelLabel: 'Keep' })
      : window.confirm('Delete this uploaded document?');
    if (!ok) return;
    try {
      await MastDB.businessEntity.documents.delete(documentId);
      if (window.showToast) showToast('Document scheduled for purge');
    } catch (err) {
      if (window.showToast) showToast('Could not delete: ' + (err.message || 'unknown'), true);
    }
  }

  window.advisorMarkRenewed = advisorMarkRenewed;
  window.advisorSnoozeRenewal = advisorSnoozeRenewal;
  window.advisorArchiveRenewal = advisorArchiveRenewal;
  window.advisorLinkPendingDoc = advisorLinkPendingDoc;
  window.advisorDeletePendingDoc = advisorDeletePendingDoc;

  // ──────────────────────────────────────────────────────────
  // Section: Pending Captures (P2D-S1 — Entity Phase 2)
  //
  // Surfaces capture.pending/* items awaiting user ratification. Each card
  // shows the target section + skill name + confidence + time-ago. Clicking
  // "Review" opens the diff-review modal (proposed vs current, per-field
  // accept/reject, always-visible Switch-to-Form escape hatch). Clicking
  // "Dismiss" calls reject without a reason.
  //
  // The capture stream writes are MCP-only — skills submit via
  // capture_conversational and land in admin/businessEntity_capturePending
  // with status='pending-review'. The advisor surfaces those for user
  // ratification. Once ratified, MastDB.businessEntity.capture.ratify()
  // delegates to MastDB.businessEntity.update for the actual entity write.
  // ──────────────────────────────────────────────────────────
  var _CAPTURE_SECTION_ICONS = {
    identity: '\u{1F3E2}',     // office building
    presence: '\u{1F310}',     // globe
    operations: '\u2699\uFE0F', // gear
    people: '\u{1F464}',       // bust
    compliance: '\u2705',       // check
    engagement: '\u{1F4CD}'    // pin
  };

  function _captureSectionIcon(section) {
    return _CAPTURE_SECTION_ICONS[section] || '\u{1F4DD}';
  }

  function _captureSectionLabel(section) {
    if (!section) return '';
    return section.charAt(0).toUpperCase() + section.slice(1);
  }

  function rerenderCapturesSection() {
    var root = document.getElementById('advisorCapturesRoot');
    if (!root) return;
    root.innerHTML = renderCapturesSection();
  }

  function renderCapturesSection() {
    var pending = (capturesData || []).filter(function(c) { return c && c.status === 'pending-review'; });
    if (pending.length === 0) return '';
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">\u{1F4AC} Pending Reviews <span style="font-weight:400;color:var(--warm-gray-light);font-size:0.82rem;margin-left:4px;">(' + pending.length + ')</span></div>';
    pending.forEach(function(cap) {
      var isLowConf = typeof cap.confidence === 'number' && cap.confidence < 0.6;
      var pillClass = isLowConf ? 'advisor-capture-pill low-confidence' : 'advisor-capture-pill';
      var confStr = (typeof cap.confidence === 'number') ? (' \u2022 ' + Math.round(cap.confidence * 100) + '% confidence') : '';
      var expiresStr = cap.expiresAt ? ' \u2022 expires ' + escText(timeAgo(cap.expiresAt).replace(/^-\s*/, '')) : '';
      h += '<div class="advisor-capture-card" id="advCapture-' + escText(cap.id) + '">';
      h += '<div style="flex:1;min-width:220px;">';
      h += '<div class="title">' + escText(_captureSectionIcon(cap.targetSection)) + ' Review ' + escText(_captureSectionLabel(cap.targetSection)) + ' capture</div>';
      h += '<div class="meta">via ' + escText(cap.skillName || 'unknown-skill') + ' \u2022 captured ' + escText(timeAgo(cap.createdAt)) + confStr + expiresStr + '</div>';
      h += '<div style="margin-top:6px;"><span class="' + pillClass + '">' + (isLowConf ? 'please double-check' : 'pending review') + '</span></div>';
      h += '</div>';
      h += '<div class="advisor-capture-actions">';
      h += '<button class="btn btn-small btn-primary" onclick="advisorReviewCapture(\'' + escText(cap.id) + '\')">Review</button>';
      h += '<button class="btn btn-small btn-secondary" onclick="advisorDismissCapture(\'' + escText(cap.id) + '\')">Dismiss</button>';
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

  // Section-name → route target in Settings. Used by Switch-to-Form.
  var _CAPTURE_TO_SETTINGS_VIEW = {
    identity: 'identity',
    presence: 'presence',
    operations: 'operations',
    people: 'people',
    compliance: 'compliance',
    engagement: 'engagement'
  };

  // Deep-equality check for diff display. Handles primitives + arrays + objects.
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

  function _openCaptureModal(cap) {
    // Guard against duplicate modals.
    var existing = document.getElementById('captureDiffModalBackdrop');
    if (existing) existing.parentNode.removeChild(existing);

    var currentEntity = (entityData && entityData[cap.targetSection]) || {};
    var proposed = cap.proposedData || {};
    var fieldKeys = Object.keys(proposed);
    var icon = _captureSectionIcon(cap.targetSection);
    var label = _captureSectionLabel(cap.targetSection);
    var skill = cap.skillName || 'unknown-skill';
    var confPct = (typeof cap.confidence === 'number') ? Math.round(cap.confidence * 100) + '%' : 'not reported';

    var bodyRows = fieldKeys.map(function(key, i) {
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
      return '<div class="' + rowClasses.join(' ') + '" data-field="' + escText(key) + '">' +
        '<div class="diff-row-header">' +
          '<span class="diff-row-field">' + escText(key) + '</span>' +
          '<label class="diff-row-checkbox">' +
            '<input type="checkbox" class="capture-field-check"' + checkedAttr + disabledAttr + ' data-field="' + escText(key) + '" />' +
            (isUnknown ? 'skip (unknown)' : (isUnchanged ? 'no change' : 'accept')) +
          '</label>' +
        '</div>' +
        '<div class="diff-pair">' +
          '<div>' +
            '<div class="diff-label">Current</div>' +
            '<div class="diff-pane current">' + escText(_formatDiffValue(curVal)) + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="diff-label">Proposed</div>' +
            '<div class="' + proposedClasses.join(' ') + '">' + escText(_formatDiffValue(propVal)) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var settingsTarget = _CAPTURE_TO_SETTINGS_VIEW[cap.targetSection] || 'identity';

    var html = '<div id="captureDiffModalBackdrop" class="capture-modal-backdrop" onclick="if(event.target===this) advisorCloseCaptureModal();">' +
      '<div class="capture-modal" role="dialog" aria-label="Review capture">' +
        '<h2>' + escText(icon) + ' Review ' + escText(label) + ' capture</h2>' +
        '<div class="modal-sub">via ' + escText(skill) + ' \u2022 captured ' + escText(timeAgo(cap.createdAt)) + ' \u2022 confidence ' + escText(confPct) + '</div>' +
        '<div class="modal-escape">' +
          '<span>Prefer a form? Switch to Settings \u203A ' + escText(label) + ' — we\'ll save this proposal for later.</span>' +
          '<a onclick="advisorCaptureSwitchToForm(\'' + escText(cap.id) + '\', \'' + escText(settingsTarget) + '\')">Switch to form \u2192</a>' +
        '</div>' +
        '<div class="modal-toggles">' +
          '<button class="btn btn-small btn-secondary" onclick="advisorCaptureAcceptAll()">Accept all</button>' +
          '<button class="btn btn-small btn-secondary" onclick="advisorCaptureRejectAll()">Reject all fields</button>' +
        '</div>' +
        '<div id="captureDiffRows">' + bodyRows + '</div>' +
        '<textarea id="captureRejectReason" class="modal-reject-reason" placeholder="Why are you rejecting? (optional — helps improve the skill)"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" onclick="advisorCloseCaptureModal()">Cancel</button>' +
          '<button class="btn" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.35);" onclick="advisorCaptureReject(\'' + escText(cap.id) + '\')">Reject</button>' +
          '<button class="btn btn-primary" onclick="advisorCaptureRatify(\'' + escText(cap.id) + '\')">Accept selected</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstChild);
  }

  async function advisorReviewCapture(captureId) {
    var cap = _captureById(captureId);
    if (!cap) {
      // Might not be in cache yet — try a direct fetch.
      try { cap = await MastDB.businessEntity.capture.get(captureId); }
      catch (e) {
        if (window.showToast) showToast('Could not load capture: ' + (e.message || 'unknown'), true);
        return;
      }
    }
    if (!cap) return;
    // Ensure current entityData is loaded — modal reads from it for the diff.
    if (!entityData && MastDB && MastDB.businessEntity && MastDB.businessEntity.get) {
      try { entityData = await MastDB.businessEntity.get(); } catch (_) { entityData = null; }
    }
    _openCaptureModal(cap);
  }

  async function advisorDismissCapture(captureId) {
    var ok = typeof window.mastConfirm === 'function'
      ? await window.mastConfirm('Dismiss this capture without reviewing? You can always re-run the skill later.', { title: 'Dismiss capture?', confirmLabel: 'Dismiss', cancelLabel: 'Keep' })
      : window.confirm('Dismiss this capture?');
    if (!ok) return;
    try {
      await MastDB.businessEntity.capture.reject(captureId, null);
      if (window.showToast) showToast('Capture dismissed');
    } catch (err) {
      if (window.showToast) showToast('Could not dismiss: ' + (err.message || 'unknown'), true);
    }
  }

  function advisorCloseCaptureModal() {
    var el = document.getElementById('captureDiffModalBackdrop');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function advisorCaptureAcceptAll() {
    var boxes = document.querySelectorAll('#captureDiffRows .capture-field-check');
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].disabled) boxes[i].checked = true;
    }
  }

  function advisorCaptureRejectAll() {
    var boxes = document.querySelectorAll('#captureDiffRows .capture-field-check');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
  }

  async function advisorCaptureRatify(captureId) {
    var boxes = document.querySelectorAll('#captureDiffRows .capture-field-check');
    var accepted = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked && !boxes[i].disabled) {
        var f = boxes[i].getAttribute('data-field');
        if (f) accepted.push(f);
      }
    }
    try {
      var res = await MastDB.businessEntity.capture.ratify(captureId, accepted);
      advisorCloseCaptureModal();
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

  async function advisorCaptureReject(captureId) {
    var reasonEl = document.getElementById('captureRejectReason');
    // Surface the reason textarea if hidden and user hasn't typed yet.
    if (reasonEl && !reasonEl.classList.contains('open')) {
      reasonEl.classList.add('open');
      reasonEl.focus();
      if (window.showToast) showToast('Add a reason (optional) and click Reject again to confirm.');
      return;
    }
    var reason = reasonEl ? reasonEl.value.trim() : '';
    try {
      await MastDB.businessEntity.capture.reject(captureId, reason || null);
      advisorCloseCaptureModal();
      if (window.showToast) showToast('Capture rejected.');
    } catch (err) {
      if (window.showToast) showToast('Could not reject: ' + (err.message || 'unknown'), true);
    }
  }

  async function advisorCaptureSwitchToForm(captureId, settingsView) {
    // Leave the capture in pending-review so user can come back and ratify
    // from Settings if the skill already collected useful data. Route to the
    // relevant Settings > <section> view. Per spec §4.4: escape hatch always
    // visible + preserves in-progress capture.
    advisorCloseCaptureModal();
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('settings');
      setTimeout(function() {
        if (typeof window.switchSettingsSubView === 'function' && settingsView) {
          try { window.switchSettingsSubView(settingsView); } catch (_) {}
        }
      }, 80);
    }
    if (window.showToast) showToast('Switched to form. Capture still in pending review.');
  }

  window.advisorReviewCapture = advisorReviewCapture;
  window.advisorDismissCapture = advisorDismissCapture;
  window.advisorCloseCaptureModal = advisorCloseCaptureModal;
  window.advisorCaptureAcceptAll = advisorCaptureAcceptAll;
  window.advisorCaptureRejectAll = advisorCaptureRejectAll;
  window.advisorCaptureRatify = advisorCaptureRatify;
  window.advisorCaptureReject = advisorCaptureReject;
  window.advisorCaptureSwitchToForm = advisorCaptureSwitchToForm;

  // --- Window exports ---
  window.loadAdvisor = loadAdvisor;
  window.switchAdvisorPeriod = function(period) {
    currentPeriod = period;
    // Update tab styles
    document.querySelectorAll('.advisor-period-tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.textContent.toLowerCase() === period);
    });
    loadAndRenderActuals(period);
  };
  window.toggleAdvisorReview = function(idx) {
    var el = document.getElementById('advisorReview' + idx);
    if (el) el.classList.toggle('open');
  };
  // Register module
  MastAdmin.registerModule('advisor', {
    routes: {
      'advisor': {
        tab: 'advisorTab',
        setup: function() { if (!advisorLoaded) loadAdvisor(); }
      }
    },
    detachListeners: function() {
      planData = null;
      healthScore = null;
      reviewsData = [];
      advisorLoaded = false;
      actualsCache = {};
      // B7 (Entity Phase 1): tear down entity subscription so we don't leak
      // an onSnapshot listener across navigations.
      if (entitySubscription && typeof entitySubscription === 'function') {
        try { entitySubscription(); } catch (_) {}
      }
      entitySubscription = null;
      entityData = null;
      // PA-7 (Entity Phase 2): tear down renewals + documents subscriptions.
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
      // P2D-S1 (Entity Phase 2): tear down captures subscription.
      if (capturesSubscription && typeof capturesSubscription === 'function') {
        try { capturesSubscription(); } catch (_) {}
      }
      capturesSubscription = null;
      capturesData = [];
    }
  });
})();
