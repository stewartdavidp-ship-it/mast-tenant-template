(function() {
  'use strict';

  // Module state
  var planData = null;
  var healthScore = null;
  var reviewsData = [];
  var advisorLoaded = false;
  var currentPeriod = 'month';
  var actualsCache = {};

  // --- CSS (injected once) ---
  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.advisor-score-ring { width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:800;margin:0 auto 8px;position:relative;background:conic-gradient(var(--ring-color,var(--teal)) calc(var(--ring-pct,0) * 3.6deg), var(--bg-secondary,#2a2a2a) 0); }',
      '.advisor-score-ring-inner { width:90px;height:90px;border-radius:50%;background:var(--bg-primary,#1a1a1a);display:flex;align-items:center;justify-content:center;flex-direction:column; }',
      '.advisor-score-ring-num { font-size:2rem;font-weight:800;line-height:1; }',
      '.advisor-score-ring-label { font-size:0.65rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisor-dim-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px; }',
      '.advisor-dim-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:12px;text-align:center; }',
      '.advisor-dim-name { font-size:0.72rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px; }',
      '.advisor-dim-score { font-size:1.4rem;font-weight:700;line-height:1.2; }',
      '.advisor-dim-trend { font-size:0.8rem;margin-left:4px; }',
      '.advisor-dim-bar { height:4px;border-radius:2px;background:var(--hover-bg,#333);margin-top:6px;overflow:hidden; }',
      '.advisor-dim-bar-fill { height:100%;border-radius:2px;transition:width 0.4s ease; }',
      '.advisor-dim-note { font-size:0.7rem;color:var(--warm-gray-light,#666);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }',
      '.advisor-thermo { background:var(--bg-secondary,#232323);border-radius:10px;padding:16px;margin-bottom:12px; }',
      '.advisor-thermo-label { display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:0.85rem; }',
      '.advisor-thermo-bar { height:18px;border-radius:9px;background:var(--hover-bg,#333);position:relative;overflow:visible; }',
      '.advisor-thermo-fill { height:100%;border-radius:9px;transition:width 0.5s ease;min-width:2px; }',
      '.advisor-thermo-pace { position:absolute;top:-4px;width:2px;height:26px;background:var(--warm-gray,#888);border-radius:1px; }',
      '.advisor-thermo-values { display:flex;justify-content:space-between;font-size:0.75rem;color:var(--warm-gray,#888);margin-top:4px; }',
      '.advisor-period-tabs { display:flex;gap:4px;margin-bottom:16px; }',
      '.advisor-period-tab { padding:6px 16px;border-radius:6px;font-size:0.82rem;cursor:pointer;background:var(--bg-secondary,#232323);color:var(--warm-gray,#888);border:none;transition:all 0.15s; }',
      '.advisor-period-tab.active { background:var(--teal,#2a7c6f);color:#fff; }',
      '.advisor-kpi-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px; }',
      '.advisor-kpi-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:4px; }',
      '.advisor-kpi-name { font-size:0.75rem;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.5px; }',
      '.advisor-kpi-value { font-size:1.3rem;font-weight:700; }',
      '.advisor-kpi-target { font-size:0.75rem;color:var(--warm-gray-light,#666); }',
      '.advisor-kpi-badge { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase; }',
      '.advisor-kpi-badge.on-track { background:rgba(34,197,94,0.15);color:#22c55e; }',
      '.advisor-kpi-badge.at-risk { background:rgba(234,179,8,0.15);color:#eab308; }',
      '.advisor-kpi-badge.off-track { background:rgba(239,68,68,0.15);color:#ef4444; }',
      '.advisor-review-card { background:var(--bg-secondary,#232323);border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;transition:background 0.15s; }',
      '.advisor-review-card:hover { background:var(--hover-bg,#2a2a2a); }',
      '.advisor-review-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:4px; }',
      '.advisor-review-type { display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase;background:rgba(42,124,111,0.15);color:var(--teal,#2a7c6f); }',
      '.advisor-review-detail { display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--hover-bg,#333); }',
      '.advisor-review-detail.open { display:block; }',
      '.advisor-action-item { display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.85rem; }',
      '.advisor-action-status { width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;flex-shrink:0; }',
      '.advisor-action-status.pending { background:rgba(234,179,8,0.15);color:#eab308; }',
      '.advisor-action-status.done { background:rgba(34,197,94,0.15);color:#22c55e; }',
      '.advisor-empty { text-align:center;padding:60px 20px; }',
      '.advisor-empty h2 { font-size:1.5rem;margin-bottom:8px;color:var(--text,#fff); }',
      '.advisor-empty p { color:var(--warm-gray,#888);font-size:0.95rem;margin-bottom:24px;max-width:400px;margin-left:auto;margin-right:auto; }',
      '.advisor-empty-icon { font-size:4rem;margin-bottom:16px; }',
      '.advisor-section { margin-bottom:28px; }',
      '.advisor-section-title { font-size:1rem;font-weight:600;color:var(--text,#fff);margin-bottom:12px;display:flex;align-items:center;gap:8px; }',
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
        MastDB._ref('admin/businessPlan/planStatus').once('value'),
        MastDB._ref('admin/businessPlan/healthScore').once('value'),
        MastDB._ref('admin/businessPlan/profile').once('value'),
        MastDB._ref('admin/businessPlan/revenueTargets').once('value'),
        MastDB._ref('admin/businessPlan/marginTargets').once('value'),
        MastDB._ref('admin/businessPlan/kpis/targets').once('value'),
        MastDB._ref('admin/businessPlan/channelStrategy').once('value'),
        MastDB._ref('admin/businessPlan/seasonalCalendar').once('value'),
        MastDB._ref('admin/businessPlan/reviews').orderByChild('createdAt').limitToLast(20).once('value'),
      ]);

      planData = {
        planStatus: statusSnap.val() || 'none',
        healthScore: healthSnap.val() || null,
        profile: profileSnap.val() || null,
        revenueTargets: targetsSnap.val() || null,
        marginTargets: marginSnap.val() || null,
        kpiTargets: kpiSnap.val() || null,
        channelStrategy: channelSnap.val() || null,
        seasonalCalendar: calSnap.val() || null,
      };
      healthScore = planData.healthScore;

      var revData = reviewsSnap.val() || {};
      reviewsData = Object.values(revData).sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      advisorLoaded = true;

      if (planData.planStatus === 'none') {
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
      h += '<div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;font-size:0.88rem;">' +
        '<span style="font-size:1.2rem;">&#9888;&#65039;</span>' +
        '<span>Your business plan is in progress. Complete it in Chat to unlock full tracking.</span>' +
      '</div>';
    }

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

  // --- Section A: Health Score ---
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
        MastDB._ref('orders').orderByChild('createdAt').limitToLast(500).once('value'),
        MastDB._ref('admin/sales').orderByChild('timestamp').limitToLast(500).once('value'),
      ]);
      var orders = ordersSnap.val() || {};
      var sales = salesSnap.val() || {};

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
      h += '<span style="color:' + vColor + ';font-size:0.82rem;font-weight:600;">' + fmtPct(variancePct) + '</span>';
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
      h += '<div style="font-size:0.75rem;color:var(--warm-gray-light);margin-top:4px;">';
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
        if (a.dueBy) h += '<span style="color:var(--warm-gray-light);font-size:0.75rem;margin-left:auto;">' + esc(a.dueBy) + '</span>';
        h += '</div>';
      });
      if (pendingActions.length > 5) {
        h += '<div style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">+ ' + (pendingActions.length - 5) + ' more</div>';
      }
      h += '</div>';
    }

    // Review list
    reviewsData.forEach(function(r, idx) {
      var typeColors = { weekly: '#6366f1', monthly: '#2a7c6f', quarterly: '#eab308', annual: '#ef4444' };
      var typeColor = typeColors[r.type] || '#888';

      h += '<div class="advisor-review-card" onclick="toggleAdvisorReview(' + idx + ')">';
      h += '<div class="advisor-review-header">';
      h += '<div style="display:flex;align-items:center;gap:8px;">';
      h += '<span class="advisor-review-type" style="background:' + typeColor + '22;color:' + typeColor + ';">' + esc(r.type || '') + '</span>';
      h += '<span style="font-weight:600;font-size:0.9rem;">' + esc(r.period || '') + '</span>';
      h += '</div>';
      h += '<span style="font-size:0.75rem;color:var(--warm-gray-light);">' + timeAgo(r.createdAt) + '</span>';
      h += '</div>';

      if (r.summary) {
        h += '<div style="font-size:0.82rem;color:var(--warm-gray);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.summary.substring(0, 120)) + '</div>';
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
        h += '<div style="margin-bottom:10px;"><strong style="color:#22c55e;font-size:0.8rem;">Wins</strong>';
        r.wins.forEach(function(w) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#10003; ' + esc(w) + '</div>'; });
        h += '</div>';
      }
      if (r.concerns && r.concerns.length > 0) {
        h += '<div style="margin-bottom:10px;"><strong style="color:#eab308;font-size:0.8rem;">Concerns</strong>';
        r.concerns.forEach(function(c) { h += '<div style="font-size:0.85rem;padding:2px 0;">&#9888; ' + esc(c) + '</div>'; });
        h += '</div>';
      }
      if (r.actions && r.actions.length > 0) {
        h += '<div><strong style="font-size:0.8rem;">Actions</strong>';
        r.actions.forEach(function(a) {
          var statusClass = a.status === 'done' ? 'done' : 'pending';
          var icon = a.status === 'done' ? '&#10003;' : '&#9679;';
          h += '<div class="advisor-action-item"><div class="advisor-action-status ' + statusClass + '">' + icon + '</div>';
          h += '<span' + (a.status === 'done' ? ' style="text-decoration:line-through;color:var(--warm-gray-light);"' : '') + '>' + esc(a.action) + '</span>';
          if (a.dueBy) h += '<span style="color:var(--warm-gray-light);font-size:0.75rem;margin-left:auto;">' + esc(a.dueBy) + '</span>';
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
    }
  });
})();
