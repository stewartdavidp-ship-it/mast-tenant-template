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
      // B7 (Entity Phase 1): About Your Business section styling
      '.advisor-entity-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px; }',
      '.advisor-entity-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:14px; }',
      '.advisor-entity-card-title { font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px; }',
      '.advisor-entity-field { display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:0.9rem;color:var(--text,#fff); }',
      '.advisor-entity-field .label { color:var(--warm-gray,#888);font-size:0.78rem;min-width:90px; }',
      '.advisor-entity-field .val { flex:1;word-break:break-word; }',
      '.advisor-entity-field .pencil { opacity:0.4;cursor:pointer;font-size:0.78rem;padding:2px 6px;border-radius:4px;transition:opacity 0.15s, background 0.15s; }',
      '.advisor-entity-field .pencil:hover { opacity:1;background:rgba(255,255,255,0.06); }',
      '.advisor-entity-chip { display:inline-block;padding:2px 8px;border-radius:12px;background:rgba(42,157,143,0.15);color:var(--teal,#2a9d8f);font-size:0.78rem;margin-right:4px;margin-bottom:4px; }',
      '.advisor-entity-empty { color:var(--warm-gray-light,#666);font-style:italic;font-size:0.85rem; }',
      '.advisor-entity-cta { background:rgba(42,157,143,0.1);border:1px solid rgba(42,157,143,0.3);border-radius:10px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap; }',
      '.advisor-entity-subbanner { background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.85rem;color:var(--text,#fff); }',
      '.advisor-entity-edit-input { width:100%;padding:6px 8px;background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);border:1px solid var(--teal,#2a9d8f);border-radius:6px;font-size:0.9rem;font-family:inherit; }',
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
            rerenderEntitySection();
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

    // B7 (Entity Phase 1): About Your Business — injected between draft banner
    // and Health Score per plan Build B7. Wrapped in an id'd div so the
    // subscription callback can target its innerHTML without full re-render.
    h += '<div id="advisorEntityRoot">' + renderEntitySection() + '</div>';

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

  // --- Section: About Your Business (B7 — Entity Phase 1) ---
  function escText(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }

  function rerenderEntitySection() {
    var root = document.getElementById('advisorEntityRoot');
    if (!root) return;
    root.innerHTML = renderEntitySection();
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

  function renderEntitySection() {
    var h = '<div class="advisor-section">';
    h += '<div class="advisor-section-title">&#127970; About Your Business</div>';

    var status = (entityData && entityData.entityStatus) || 'none';

    // Empty-state — spec §3
    if (status === 'none' || !entityData) {
      h += '<div class="advisor-entity-cta">' +
        '<div><div style="font-weight:600;margin-bottom:4px;">Let\'s set up your business</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">Takes about 2 minutes. We\'ll tailor Mast to how you actually work.</div></div>' +
        '<button class="btn btn-primary" onclick="navigateTo(\'wizard\')">Start setup</button>' +
      '</div>';
      h += '</div>';
      return h;
    }

    // Draft sub-banner — spec §3
    if (status === 'draft') {
      h += '<div class="advisor-entity-subbanner">' +
        '<strong>&#9999;&#65039; Setup in progress.</strong> ' +
        '<a href="#" onclick="event.preventDefault(); navigateTo(\'settings\'); setTimeout(function(){ switchSettingsSubView(\'engagement\'); }, 80); return false;" style="color:var(--teal,#2a9d8f);">Complete your business setup in Settings</a>' +
      '</div>';
    }

    var identity = entityData.identity || {};
    var engagement = entityData.engagement || {};
    var presence = entityData.presence || {};
    var operations = entityData.operations || {};
    var discovery = entityData.discovery || {};

    h += '<div class="advisor-entity-grid">';

    // Identity card
    h += '<div class="advisor-entity-card">';
    h += '<div class="advisor-entity-card-title">Identity</div>';
    h += entityField('businessName', 'Business', identity.businessName || '', {editable: true, type: 'text'});
    h += entityField('archetype', 'Archetype', archetypeLabel(identity.archetype) || '', {editable: true, type: 'archetype', rawValue: identity.archetype || ''});
    h += entityField('yearsInBusiness', 'Years', identity.yearsInBusiness != null ? String(identity.yearsInBusiness) : '', {editable: true, type: 'number'});
    h += '</div>';

    // Engagement card
    h += '<div class="advisor-entity-card">';
    h += '<div class="advisor-entity-card-title">Engagement</div>';
    var modeSurface = engagement.mode ? (modeLabel(engagement.mode) + (engagement.surface ? ' \u00b7 ' + engagement.surface : '')) : '';
    h += entityField('mode', 'Mode', modeSurface, {editable: false});
    h += '<div class="advisor-entity-field"><span class="label">Goals</span><span class="val">';
    var goals = Array.isArray(engagement.goals) ? engagement.goals : [];
    if (goals.length === 0) {
      h += '<span class="advisor-entity-empty">Not set \u2014 <a href="#" onclick="event.preventDefault(); window.advisorStartEditEntity(\'goals\'); return false;" style="color:var(--teal,#2a9d8f);">add goals</a></span>';
    } else {
      goals.forEach(function(g) { h += '<span class="advisor-entity-chip">' + escText(goalLabel(g)) + '</span>'; });
    }
    h += '</span>';
    h += '<span class="pencil" onclick="window.advisorStartEditEntity(\'goals\')" title="Edit goals">&#9998;</span>';
    h += '</div>';
    if (engagement.calibration) {
      if (engagement.calibration.revenueBracket) {
        h += entityField('revenueBracket', 'Revenue', engagement.calibration.revenueBracket, {editable: false});
      }
      if (engagement.calibration.wishStatement) {
        var wish = engagement.calibration.wishStatement;
        if (wish.length > 80) wish = wish.substring(0, 77) + '...';
        h += entityField('wishStatement', 'Wish', wish, {editable: false});
      }
    }
    h += '</div>';

    // Reach card
    h += '<div class="advisor-entity-card">';
    h += '<div class="advisor-entity-card-title">Reach</div>';
    h += '<div class="advisor-entity-field"><span class="label">Channels</span><span class="val">';
    var channels = Array.isArray(presence.declaredChannels) ? presence.declaredChannels : [];
    if (channels.length === 0) {
      h += '<span class="advisor-entity-empty">None declared</span>';
    } else {
      channels.forEach(function(c) { h += '<span class="advisor-entity-chip">' + escText(channelLabel(c)) + '</span>'; });
    }
    h += '</span>';
    h += '<span class="pencil" onclick="window.advisorStartEditEntity(\'declaredChannels\')" title="Edit channels">&#9998;</span>';
    h += '</div>';
    if (presence.primaryDomain) {
      h += entityField('primaryDomain', 'Domain', presence.primaryDomain, {editable: false});
    }
    h += '</div>';

    // Operations card
    h += '<div class="advisor-entity-card">';
    h += '<div class="advisor-entity-card-title">Operations</div>';
    var loc = operations.localization || {};
    var locParts = [];
    if (loc.currency) locParts.push(loc.currency);
    if (loc.timezone) locParts.push(loc.timezone);
    if (loc.language) locParts.push(loc.language);
    if (loc.fiscalYearStartMonth) locParts.push('FY ' + loc.fiscalYearStartMonth);
    h += entityField('localization', 'Locale', locParts.join(' \u00b7 '), {editable: false});
    if (operations.businessModel) {
      h += entityField('businessModel', 'Model', operations.businessModel, {editable: false});
    } else {
      h += '<div class="advisor-entity-field"><span class="label">Model</span><span class="val advisor-entity-empty">Not set</span></div>';
    }
    h += '</div>';

    h += '</div>'; // grid

    if (discovery && discovery.lastScrapeAt) {
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light,#666);margin-top:10px;">Last site scrape: ' + escText(timeAgo(discovery.lastScrapeAt)) + (discovery.scrapeUrl ? ' \u2014 ' + escText(discovery.scrapeUrl) : '') + '</div>';
    }

    h += '</div>'; // advisor-section
    return h;
  }

  function entityField(key, label, value, opts) {
    opts = opts || {};
    var displayVal = value || '';
    var h = '<div class="advisor-entity-field" data-entity-field="' + escText(key) + '">';
    h += '<span class="label">' + escText(label) + '</span>';
    h += '<span class="val">' + (displayVal === '' ? '<span class="advisor-entity-empty">Not set</span>' : escText(displayVal)) + '</span>';
    if (opts.editable) {
      h += '<span class="pencil" onclick="window.advisorStartEditEntity(\'' + escText(key) + '\')" title="Edit ' + escText(label) + '">&#9998;</span>';
    }
    h += '</div>';
    return h;
  }

  // Map field key → {section, path on entity, input type, label}
  var ENTITY_EDITABLE = {
    businessName:     { section: 'identity',   path: 'businessName',             type: 'text',       label: 'Business name' },
    archetype:        { section: 'identity',   path: 'archetype',                type: 'archetype',  label: 'Archetype' },
    yearsInBusiness:  { section: 'identity',   path: 'yearsInBusiness',          type: 'number',     label: 'Years in business' },
    goals:            { section: 'engagement', path: 'goals',                    type: 'goals',      label: 'Goals' },
    declaredChannels: { section: 'presence',   path: 'declaredChannels',         type: 'channels',   label: 'Channels' }
  };

  function currentEntityValue(key) {
    if (!entityData) return null;
    if (key === 'businessName') return (entityData.identity && entityData.identity.businessName) || '';
    if (key === 'archetype') return (entityData.identity && entityData.identity.archetype) || '';
    if (key === 'yearsInBusiness') return (entityData.identity && entityData.identity.yearsInBusiness != null) ? entityData.identity.yearsInBusiness : '';
    if (key === 'goals') return (entityData.engagement && Array.isArray(entityData.engagement.goals)) ? entityData.engagement.goals : [];
    if (key === 'declaredChannels') return (entityData.presence && Array.isArray(entityData.presence.declaredChannels)) ? entityData.presence.declaredChannels : [];
    return null;
  }

  function startEditEntity(key) {
    var cfg = ENTITY_EDITABLE[key];
    if (!cfg) return;
    var fieldEl = document.querySelector('.advisor-entity-field[data-entity-field="' + key + '"]');
    if (!fieldEl) return;
    if (fieldEl.dataset.editing === '1') return;
    fieldEl.dataset.editing = '1';
    var valEl = fieldEl.querySelector('.val');
    var pencil = fieldEl.querySelector('.pencil');
    if (pencil) pencil.style.display = 'none';
    var current = currentEntityValue(key);

    if (cfg.type === 'text' || cfg.type === 'number') {
      var inputType = cfg.type === 'number' ? 'number' : 'text';
      valEl.innerHTML = '<input type="' + inputType + '" class="advisor-entity-edit-input" value="' + escText(current) + '" data-entity-edit-input>';
      var inputEl = valEl.querySelector('input');
      inputEl.focus();
      inputEl.select && inputEl.select();
      var commit = function() {
        var v = inputEl.value;
        if (cfg.type === 'number') {
          v = v === '' ? null : Number(v);
          if (v !== null && (isNaN(v) || v < 0)) { cancelEditEntity(key); return; }
        }
        saveEntityEdit(key, v);
      };
      inputEl.addEventListener('blur', commit);
      inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { inputEl.blur(); }
        else if (e.key === 'Escape') { inputEl.removeEventListener('blur', commit); cancelEditEntity(key); }
      });
    } else if (cfg.type === 'archetype') {
      var archetypes = (window.BusinessEntityConstants && BusinessEntityConstants.ARCHETYPES) || [];
      var opts = archetypes.map(function(a) {
        return '<option value="' + escText(a.value) + '"' + (a.value === current ? ' selected' : '') + '>' + escText(a.label) + '</option>';
      }).join('');
      valEl.innerHTML = '<select class="advisor-entity-edit-input"><option value="">(pick one)</option>' + opts + '</select>';
      var sel = valEl.querySelector('select');
      sel.focus();
      sel.addEventListener('change', function() {
        var newVal = sel.value;
        if (!newVal || newVal === current) { cancelEditEntity(key); return; }
        if (!confirm('Changing your archetype will reset module recommendations and goal defaults. Continue?')) {
          cancelEditEntity(key);
          return;
        }
        saveEntityEdit(key, newVal);
      });
      sel.addEventListener('blur', function() {
        // If user tabs out without picking a different value, restore
        setTimeout(function() {
          if (fieldEl.dataset.editing === '1') cancelEditEntity(key);
        }, 100);
      });
    } else if (cfg.type === 'goals' || cfg.type === 'channels') {
      // Multi-select checkbox list.
      var source, labelFn;
      if (cfg.type === 'goals') {
        var arch = (entityData.identity && entityData.identity.archetype) || null;
        var defaults = arch && MastDB.businessEntity.archetypeDefaults && MastDB.businessEntity.archetypeDefaults(arch);
        var available = (defaults && Array.isArray(defaults.goalsAvailable)) ? defaults.goalsAvailable : Object.keys((window.BusinessEntityConstants && BusinessEntityConstants.GOAL_LABELS) || {});
        source = available;
        labelFn = goalLabel;
      } else {
        source = ((window.BusinessEntityConstants && BusinessEntityConstants.DECLARED_CHANNELS) || []).map(function(c) { return c.value; });
        labelFn = channelLabel;
      }
      var currentArr = Array.isArray(current) ? current : [];
      // Union so pre-existing values not in the source set are still editable
      source = source.concat(currentArr.filter(function(v) { return source.indexOf(v) === -1; }));
      var checks = source.map(function(v) {
        var isChecked = currentArr.indexOf(v) !== -1;
        return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 6px 2px 0;font-size:0.85rem;">' +
          '<input type="checkbox" value="' + escText(v) + '" ' + (isChecked ? 'checked' : '') + '>' +
          '<span>' + escText(labelFn(v)) + '</span>' +
          '</label>';
      }).join('');
      valEl.innerHTML = '<div>' + checks + '<div style="margin-top:6px;"><button class="btn btn-primary btn-small" type="button" data-entity-save>Save</button> <button class="btn btn-secondary btn-small" type="button" data-entity-cancel>Cancel</button></div></div>';
      valEl.querySelector('[data-entity-save]').addEventListener('click', function() {
        var picked = [];
        valEl.querySelectorAll('input[type="checkbox"]').forEach(function(c) { if (c.checked) picked.push(c.value); });
        saveEntityEdit(key, picked);
      });
      valEl.querySelector('[data-entity-cancel]').addEventListener('click', function() { cancelEditEntity(key); });
    }
  }

  function cancelEditEntity(key) {
    var fieldEl = document.querySelector('.advisor-entity-field[data-entity-field="' + key + '"]');
    if (!fieldEl) return;
    delete fieldEl.dataset.editing;
    rerenderEntitySection();
  }

  async function saveEntityEdit(key, newValue) {
    var cfg = ENTITY_EDITABLE[key];
    if (!cfg) return;
    var fieldEl = document.querySelector('.advisor-entity-field[data-entity-field="' + key + '"]');
    if (fieldEl) {
      var valEl = fieldEl.querySelector('.val');
      if (valEl) valEl.innerHTML = '<span class="advisor-entity-empty">Saving...</span>';
    }
    try {
      var payload = {};
      payload[cfg.path] = newValue;
      await MastDB.businessEntity.update(cfg.section, payload);
      // Subscribe will fire and rerender. Belt + suspenders: refetch + rerender
      // if subscribe didn't fire within a tick.
      setTimeout(async function() {
        if (entitySubscription) return; // subscribe path already handled
        try {
          entityData = await MastDB.businessEntity.get();
          rerenderEntitySection();
        } catch (_) { /* noop */ }
      }, 400);
    } catch (err) {
      console.error('[advisor entity edit] save failed:', err);
      alert('Couldn\'t save: ' + (err && err.message ? err.message : 'unknown error'));
      rerenderEntitySection();
    }
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
  window.advisorStartEditEntity = startEditEntity;

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
    }
  });
})();
