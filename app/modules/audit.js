/**
 * Audit Module — J13 (Mast Audit & Coaching Wedge V1).
 *
 * Action-first audit surface for tenant product health. Reads:
 *   tenants/{tid}/audit_results/{violationId}     ← J10 wedge runtime writes
 *   tenants/{tid}/rule_suppressions/{suppId}     ← J12 writer; suppression pre-filter
 *   tenants/{tid}/public/products                 ← product titles + photos
 *   tenants/{tid}/channel_config/{channel}        ← _tokenStatus + connectedAt
 *
 * Three-bucket action-first home (Quick wins / High impact / Worth a look),
 * first-screen budget 6 items (2 per bucket). Stateless rollups computed on
 * read: per-rule × product, per-rule × population. Per-product drill panel
 * caps at 5 issues + "Audit this listing" CTA that stubs out to J14.
 *
 * Within 72h of channel connect, drift findings render as a provisional
 * panel; on crossing the 72h boundary, drift items migrate into High Impact
 * and a one-time milestone toast fires.
 *
 * NOT to be confused with the transactional auditLog viewer at
 * app/index.html:~10551 (entity-CRUD audit, different collection).
 *
 * All feedback actions route through window.AuditFeedbackUI primitives
 * (rollup menus, 3-scope suppression, snooze duration picker, batchId).
 *
 * UX conformance (mast-ux-style-guide v10):
 *   - 7-step rem scale only (0.72/0.78/0.85/0.9/1.0/1.15/1.6) — enforced by
 *     scripts/lint-design-tokens.js PostToolUse hook
 *   - .section-header / .btn / .btn-primary / .btn-secondary / .loading
 *   - CSS vars only — no hardcoded hex
 *   - mastSlideOut for detail surfaces (right-side ~560px panel)
 *   - showToast() for transient feedback; no native alert/confirm
 *   - All user-derived strings interpolated through esc()
 *
 * Wedge spec: /Downloads/sessions/mast-audit-coaching-wedge-2026-05-27.md
 * Wireframe:  /Downloads/sessions/audit-ui-wireframe-v0.md
 */
(function() {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================

  // 72h drift provisional window — wedge §7 day-one activation
  var PROVISIONAL_MS = 72 * 60 * 60 * 1000;

  // Render budgets — wireframe screen 1
  var HOME_BUCKET_BUDGET = 2;    // items per bucket on home
  var HOME_TOTAL_BUDGET  = 6;    // total items on home
  var CATEGORY_PAGE_SIZE = 10;   // first show on category deep-dive
  var PRODUCT_DRILL_CAP  = 5;    // wedge §J13 — max 5 issues per product

  // Bucket ids
  var BUCKET_QUICK  = 'quick';
  var BUCKET_HIGH   = 'high';
  var BUCKET_CLOSER = 'closer';

  // Category ids — primary axis grouping. Severity → bucket; ruleId prefix
  // is the deterministic mapping when the rule doc doesn't carry an explicit
  // category. The full rule catalog lives in J09 playbooks + J10 evaluator
  // registry; this module is a presenter and does not reproduce them.
  var CATEGORY_LQ      = 'lq';      // Listing quality
  var CATEGORY_DRIFT   = 'drift';   // Cross-channel drift
  var CATEGORY_PRICING = 'pricing'; // Pricing & positioning (informational)

  var CATEGORY_LABEL = {};
  CATEGORY_LABEL[CATEGORY_LQ]      = 'Listing quality';
  CATEGORY_LABEL[CATEGORY_DRIFT]   = 'Cross-channel drift';
  CATEGORY_LABEL[CATEGORY_PRICING] = 'Pricing & positioning';

  // Channel display labels — kept local to avoid coupling to channels module
  var CHANNEL_LABEL = {
    shopify:     'Shopify',
    etsy:        'Etsy',
    square:      'Square',
    squarespace: 'Squarespace',
    wix:         'Wix'
  };

  // Module state path — separate from any other admin/audit collection.
  var STATE_PATH = 'admin/auditUiState';

  // ============================================================
  // Module-private state
  // ============================================================

  var auditsLoaded     = false;
  var auditsLoading    = null;          // in-flight Promise dedupe
  var violationsData   = [];            // raw audit_results rows
  var suppressionsData = [];            // active rule_suppressions rows
  var productsById     = Object.create(null);
  var channelConfigs   = Object.create(null); // channel → { _tokenStatus, connectedAt, ... }
  var uiState          = { driftMilestoneShownAt: null };

  var currentView   = 'home';   // home | category | rule-population | suppressed
  var categoryView  = null;     // active category id when currentView === 'category'
  var rulePopView   = null;     // { ruleId, category } when currentView === 'rule-population'
  var categoryShowAll = Object.create(null); // category → bool

  // ============================================================
  // Helpers
  // ============================================================

  function esc(s) {
    if (s === null || s === undefined) return '';
    if (typeof window !== 'undefined' && window.MastAdmin && typeof window.MastAdmin.esc === 'function') {
      return window.MastAdmin.esc(s);
    }
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, isError) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, !!isError);
    } else {
      console[isError ? 'error' : 'log']('[Audit] ' + msg);
    }
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var delta = Date.now() - t;
    var sec = Math.round(delta / 1000);
    if (sec < 60)   return sec + 's ago';
    var min = Math.round(sec / 60);
    if (min < 60)   return min + ' min ago';
    var hr  = Math.round(min / 60);
    if (hr  < 24)   return hr  + ' h ago';
    var day = Math.round(hr / 24);
    if (day < 30)   return day + ' day' + (day === 1 ? '' : 's') + ' ago';
    var mo = Math.round(day / 30);
    if (mo < 12)    return mo + ' mo ago';
    return Math.round(mo / 12) + ' yr ago';
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'now';
    var hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 1) return '< 1 hour';
    var days = Math.floor(hours / 24);
    var rem  = hours - (days * 24);
    if (days < 1) return hours + ' hour' + (hours === 1 ? '' : 's');
    return days + ' day' + (days === 1 ? '' : 's') + ', ' + rem + ' hour' + (rem === 1 ? '' : 's');
  }

  // Map a violation to category. Prefers explicit `category` field; falls
  // back to ruleId prefix; informational tier always lands in 'closer'.
  function violationCategory(v) {
    if (v && v.category && CATEGORY_LABEL[v.category]) return v.category;
    var rid = (v && v.ruleId) ? String(v.ruleId) : '';
    if (rid.indexOf('LQ') === 0 || rid.indexOf('lq') === 0) return CATEGORY_LQ;
    if (rid.indexOf('DR') === 0 || rid.indexOf('dr') === 0) return CATEGORY_DRIFT;
    if (rid.indexOf('PP') === 0 || rid.indexOf('pp') === 0) return CATEGORY_PRICING;
    return CATEGORY_LQ;
  }

  // Map a violation to home bucket. Tier 'informational' always → closer.
  // Drift (DR) → high. LQ → quick. PP non-informational (rare) → closer.
  // High-severity overrides push from quick → high.
  function violationBucket(v) {
    var cat = violationCategory(v);
    var tier = (v && v.tier) ? String(v.tier).toLowerCase() : '';
    var sev  = (v && v.severity) ? String(v.severity).toLowerCase() : 'medium';
    if (tier === 'informational') return BUCKET_CLOSER;
    if (cat === CATEGORY_PRICING) return BUCKET_CLOSER;
    if (cat === CATEGORY_DRIFT)   return BUCKET_HIGH;
    if (sev === 'high')           return BUCKET_HIGH;
    return BUCKET_QUICK;
  }

  // Suppression pre-filter — wedge §8 + audit-feedback writer.
  // A violation is suppressed when any active rule_suppression doc matches
  // (ruleId AND (scope === 'tenant' OR (scope === 'product' AND scopeId === productId)
  //                                 OR (scope === 'category' AND scopeId === violationCategory)))
  function buildSuppressionIndex(rows) {
    var byRule = Object.create(null);
    rows.forEach(function(s) {
      if (!s || !s.ruleId) return;
      if (!byRule[s.ruleId]) byRule[s.ruleId] = [];
      byRule[s.ruleId].push(s);
    });
    return byRule;
  }

  function isSuppressed(v, idx) {
    if (!v || !v.ruleId) return false;
    var rules = idx[v.ruleId];
    if (!rules || !rules.length) return false;
    var cat = violationCategory(v);
    for (var i = 0; i < rules.length; i++) {
      var s = rules[i];
      if (s.scope === 'tenant') return true;
      if (s.scope === 'product'  && s.scopeId === v.productId) return true;
      if (s.scope === 'category' && s.scopeId === cat) return true;
    }
    return false;
  }

  // Drift-rule + within-72h check — wedge §7. We treat any DR-* finding as
  // "drift" for bucket-routing purposes. The 72h gate triggers per-channel
  // based on channel_config[channel].connectedAt; if every channel touching
  // a drift item is fresh, the item is provisional. If any is steady-state,
  // the item ships normally.
  function isProvisionalDrift(v) {
    if (violationCategory(v) !== CATEGORY_DRIFT) return false;
    var channels = Array.isArray(v.channels) ? v.channels : [];
    if (!channels.length) return false;
    var oldest = Infinity;
    for (var i = 0; i < channels.length; i++) {
      var cfg = channelConfigs[channels[i]];
      if (!cfg || !cfg.connectedAt) {
        // No connectedAt recorded — treat as long-stabilized (steady-state),
        // since a missing timestamp on a connected channel most likely means
        // legacy connect (pre-J06).
        return false;
      }
      var t = Date.parse(cfg.connectedAt);
      if (!isFinite(t)) return false;
      if (t < oldest) oldest = t;
    }
    return (Date.now() - oldest) < PROVISIONAL_MS;
  }

  // Compute the earliest "provisional ends at" timestamp across drift channels.
  function provisionalDriftMsRemaining() {
    var earliest = -Infinity;
    Object.keys(channelConfigs).forEach(function(ch) {
      var cfg = channelConfigs[ch];
      if (!cfg || cfg._tokenStatus !== 'ok' || !cfg.connectedAt) return;
      var t = Date.parse(cfg.connectedAt);
      if (!isFinite(t)) return;
      if (t > earliest) earliest = t;
    });
    if (earliest === -Infinity) return 0;
    return Math.max(0, (earliest + PROVISIONAL_MS) - Date.now());
  }

  function getProductTitle(productId) {
    if (!productId) return '(unknown product)';
    var p = productsById[productId];
    if (p && (p.title || p.name)) return String(p.title || p.name);
    return productId;
  }

  function getProductPhotoUrl(productId) {
    var p = productsById[productId];
    if (!p) return '';
    if (Array.isArray(p.photos) && p.photos.length) {
      var ph = p.photos[0];
      if (ph && typeof ph === 'object' && typeof ph.url === 'string') return ph.url;
      if (typeof ph === 'string') return ph;
    }
    if (typeof p.image === 'string') return p.image;
    if (typeof p.imageUrl === 'string') return p.imageUrl;
    return '';
  }

  // ============================================================
  // Data loaders
  // ============================================================

  function loadAudits(force) {
    if (auditsLoaded && !force) return Promise.resolve();
    if (auditsLoading) return auditsLoading;
    auditsLoading = Promise.all([
      _loadViolations(),
      _loadSuppressions(),
      _loadProducts(),
      _loadChannelConfigs(),
      _loadUiState()
    ]).then(function() {
      auditsLoaded = true;
      auditsLoading = null;
    }).catch(function(err) {
      auditsLoading = null;
      throw err;
    });
    return auditsLoading;
  }

  function _loadViolations() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      violationsData = [];
      return Promise.resolve();
    }
    return window.MastDB.get('audit_results').then(function(raw) {
      var out = [];
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(id) {
          var d = raw[id] || {};
          if (!d || typeof d !== 'object') return;
          // Skip resolved-pending-recheck and snoozed-active (snoozed counts
          // as not-currently-shown). Drop expired snoozes back to active.
          var state = d.state || 'active';
          if (state === 'snoozed' && d.snoozeUntil) {
            var t = Date.parse(d.snoozeUntil);
            if (isFinite(t) && t <= Date.now()) state = 'active';
          }
          out.push({
            id: id,
            ruleId:     d.ruleId    || '',
            productId:  d.productId || '',
            listingId:  d.listingId || '',
            channels:   Array.isArray(d.channels) ? d.channels.slice() : [],
            severity:   d.severity  || 'medium',
            tier:       d.tier      || 'push',
            category:   d.category  || '',
            title:      d.title     || d.message || '',
            detail:     d.detail    || d.description || '',
            suggestion: d.suggestion || '',
            createdAt:  d.createdAt || '',
            lastSeenAt: d.lastSeenAt || '',
            state:      state,
            snoozeUntil:  d.snoozeUntil || null,
            dismissCount: d.dismissCount || 0,
            subjectIds:   Array.isArray(d.subjectIds) ? d.subjectIds.slice() : []
          });
        });
      }
      violationsData = out;
    }).catch(function(err) {
      console.warn('[Audit] loadViolations failed:', err);
      violationsData = [];
    });
  }

  function _loadSuppressions() {
    if (window.AuditFeedback && typeof window.AuditFeedback.listSuppressions === 'function') {
      return window.AuditFeedback.listSuppressions().then(function(rows) {
        suppressionsData = Array.isArray(rows) ? rows : [];
      }).catch(function() { suppressionsData = []; });
    }
    return Promise.resolve();
  }

  function _loadProducts() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') return Promise.resolve();
    return window.MastDB.get('public/products').then(function(raw) {
      var byId = Object.create(null);
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(id) {
          var p = raw[id];
          if (p && typeof p === 'object') byId[id] = p;
        });
      }
      productsById = byId;
    }).catch(function(err) {
      console.warn('[Audit] loadProducts failed:', err);
      productsById = Object.create(null);
    });
  }

  function _loadChannelConfigs() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') return Promise.resolve();
    return window.MastDB.get('channel_config').then(function(raw) {
      var out = Object.create(null);
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function(ch) {
          if (raw[ch] && typeof raw[ch] === 'object') out[ch] = raw[ch];
        });
      }
      channelConfigs = out;
    }).catch(function() { channelConfigs = Object.create(null); });
  }

  function _loadUiState() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') return Promise.resolve();
    return window.MastDB.get(STATE_PATH).then(function(raw) {
      uiState = (raw && typeof raw === 'object') ? raw : {};
    }).catch(function() { uiState = {}; });
  }

  function persistUiState() {
    if (!window.MastDB || typeof window.MastDB.set !== 'function') return Promise.resolve();
    return window.MastDB.set(STATE_PATH, uiState).catch(function() {/* best-effort */});
  }

  // ============================================================
  // Derivations (computed on every render — stateless rollups)
  // ============================================================

  // Returns only violations the user should currently see: state=active and
  // not suppressed.
  function visibleViolations() {
    var idx = buildSuppressionIndex(suppressionsData);
    return violationsData.filter(function(v) {
      if (v.state !== 'active') return false;
      if (isSuppressed(v, idx)) return false;
      return true;
    });
  }

  // Roll-up by (ruleId, productId) — collapses N "photo 3 missing alt text"
  // peer items into one parent on the per-product view. Returns
  // array of { ruleId, productId, violations[] }.
  function rollupByRuleAndProduct(vios) {
    var by = Object.create(null);
    vios.forEach(function(v) {
      var k = v.ruleId + '||' + v.productId;
      if (!by[k]) by[k] = { ruleId: v.ruleId, productId: v.productId, violations: [] };
      by[k].violations.push(v);
    });
    return Object.keys(by).map(function(k) { return by[k]; });
  }

  // Roll-up by ruleId across the population. Returns
  // array of { ruleId, productIds[], violationIds[], firstSeenAt, severity, category, tier, title, suggestion }.
  function rollupByRule(vios) {
    var by = Object.create(null);
    vios.forEach(function(v) {
      var k = v.ruleId;
      if (!by[k]) {
        by[k] = {
          ruleId:     v.ruleId,
          category:   violationCategory(v),
          severity:   v.severity,
          tier:       v.tier,
          title:      v.title,
          suggestion: v.suggestion,
          productIds:    [],
          violationIds:  [],
          violations:    []
        };
      }
      var grp = by[k];
      grp.violations.push(v);
      grp.violationIds.push(v.id);
      if (grp.productIds.indexOf(v.productId) < 0) grp.productIds.push(v.productId);
      // Promote severity to the worst seen
      if (v.severity === 'high') grp.severity = 'high';
    });
    return Object.keys(by).map(function(k) { return by[k]; });
  }

  // Pick the top N items for the home bucket budget. Sort key: severity
  // (high > medium > low) then productCount desc then ruleId asc.
  function rankForHome(ruleGroups) {
    var sevWeight = { high: 3, medium: 2, low: 1, informational: 0 };
    return ruleGroups.slice().sort(function(a, b) {
      var w = (sevWeight[b.severity] || 0) - (sevWeight[a.severity] || 0);
      if (w !== 0) return w;
      var c = b.productIds.length - a.productIds.length;
      if (c !== 0) return c;
      return String(a.ruleId).localeCompare(String(b.ruleId));
    });
  }

  // ============================================================
  // Render — top-level dispatcher
  // ============================================================

  function render() {
    var host = document.getElementById('auditTabContent');
    if (!host) return;

    if (!auditsLoaded) {
      host.innerHTML = '<div class="loading">Loading audit…</div>';
      return;
    }

    if (currentView === 'category')        return renderCategory(host);
    if (currentView === 'rule-population') return renderRulePopulation(host);
    return renderHome(host);
  }

  // ============================================================
  // Home view (Screens 1 + 2 + 8)
  // ============================================================

  function renderHome(host) {
    var vios = visibleViolations();
    var ruleGroups = rollupByRule(vios);

    var allConnected = connectedPlatformList();
    var disconnected = disconnectedPlatformList();
    var provisionalMs = provisionalDriftMsRemaining();
    var inProvisional = vios.some(isProvisionalDrift) && provisionalMs > 0;

    var lastScanLabel = computeLastScanLabel(vios);

    // Header section
    var headerHtml = renderHomeHeader(allConnected, disconnected, lastScanLabel);

    // Disconnected banner (Screen 8 — first-class state, persists)
    var disconnectedBannerHtml = renderDisconnectedBanner(disconnected);

    // Bucket assignment, with provisional drift held aside
    var bucketed = { quick: [], high: [], closer: [] };
    var provisional = [];

    ruleGroups.forEach(function(g) {
      // A rule group's "provisional" state is true if every underlying
      // violation is provisional. Mixed groups ship normally.
      var allProvisional = g.violations.every(isProvisionalDrift);
      if (allProvisional && g.violations.length) {
        provisional.push(g);
        return;
      }
      var b = violationBucket(g.violations[0]);
      bucketed[b].push(g);
    });

    // Rank within each bucket
    bucketed.quick  = rankForHome(bucketed.quick);
    bucketed.high   = rankForHome(bucketed.high);
    bucketed.closer = rankForHome(bucketed.closer);

    // Fire drift-stabilization milestone toast once when the gate clears
    maybeFireDriftMilestone(provisionalMs, vios);

    // Compose
    var html = [];
    html.push(headerHtml);
    if (disconnectedBannerHtml) html.push(disconnectedBannerHtml);

    if (inProvisional) {
      html.push(renderProvisionalDriftPanel(provisional, provisionalMs));
    }

    html.push(renderBucketRow(bucketed));
    html.push(renderCategoryNav(ruleGroups));
    html.push(renderHomeFooter());

    host.innerHTML = html.join('');

    wireHomeHandlers(host, bucketed);
  }

  function renderHomeHeader(connected, disconnected, lastScanLabel) {
    var chips = '';
    connected.forEach(function(ch) {
      chips += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;'
            + 'background:rgba(34,197,94,0.18);color:var(--accent,#34d399);font-size:0.78rem;margin-right:6px;">'
            + '<span aria-hidden="true">✓</span>' + esc(channelLabel(ch)) + '</span>';
    });
    disconnected.forEach(function(ch) {
      chips += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;'
            + 'background:rgba(220,38,38,0.18);color:var(--danger,#f87171);font-size:0.78rem;margin-right:6px;">'
            + '<span aria-hidden="true">⚠</span>' + esc(channelLabel(ch)) + ' disconnected</span>';
    });
    if (!chips) {
      chips = '<span style="color:var(--warm-gray);font-size:0.78rem;">No channels connected — connect a channel to start auditing.</span>';
    }
    return [
      '<div class="section-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">',
      '  <div>',
      '    <h2 style="margin:0;">Audit</h2>',
      '    <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">' + esc(lastScanLabel) + '</div>',
      '  </div>',
      '  <div style="text-align:right;">',
      '    <div style="margin-bottom:8px;">' + chips + '</div>',
      '    <button type="button" class="btn btn-secondary" id="auditRefreshBtn" aria-label="Refresh audit">↻ Refresh</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function computeLastScanLabel(vios) {
    var latest = '';
    vios.forEach(function(v) {
      if (v.lastSeenAt && v.lastSeenAt > latest) latest = v.lastSeenAt;
    });
    if (!latest) return 'No audit runs yet';
    return 'Last full scan: ' + relativeTime(latest);
  }

  function connectedPlatformList() {
    var out = [];
    Object.keys(channelConfigs).forEach(function(ch) {
      var cfg = channelConfigs[ch];
      if (cfg && (cfg._tokenStatus === 'ok' || cfg._tokenStatus === undefined)) out.push(ch);
    });
    return out;
  }

  function disconnectedPlatformList() {
    var out = [];
    Object.keys(channelConfigs).forEach(function(ch) {
      var cfg = channelConfigs[ch];
      if (cfg && (cfg._tokenStatus === 'revoked' || cfg._tokenStatus === 'expired')) out.push(ch);
    });
    return out;
  }

  function channelLabel(ch) {
    return CHANNEL_LABEL[ch] || ch;
  }

  function renderDisconnectedBanner(disconnected) {
    if (!disconnected.length) return '';
    var rows = '';
    disconnected.forEach(function(ch) {
      var cfg = channelConfigs[ch] || {};
      var statusText = cfg._tokenStatus === 'revoked'
        ? 'connection needs attention'
        : 'token expired — automatic refresh in progress';
      rows += [
        '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;',
        '            background:rgba(220,38,38,0.10);border:1px solid rgba(220,38,38,0.45);border-radius:8px;">',
        '  <span aria-hidden="true" style="font-size:1.15rem;">⚠</span>',
        '  <div style="flex:1;min-width:0;">',
        '    <div style="font-weight:500;color:var(--danger,#f87171);font-size:0.9rem;">',
        '      ' + esc(channelLabel(ch)) + ' ' + esc(statusText),
        '    </div>',
        '    <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">',
        '      Drift checks involving this channel are paused until you reconnect.',
        '    </div>',
        '  </div>',
        '  <button type="button" class="btn btn-secondary" data-audit-action="reconnect" data-channel="' + esc(ch) + '">',
        '    Reconnect',
        '  </button>',
        '</div>'
      ].join('');
    });
    return '<div style="padding:0 24px;margin-top:8px;">' + rows + '</div>';
  }

  // ============================================================
  // Provisional drift panel (Screen 2)
  // ============================================================

  function renderProvisionalDriftPanel(provisional, msRemaining) {
    var inv = 0, price = 0, other = 0;
    provisional.forEach(function(g) {
      var cat = g.category;
      var rid = String(g.ruleId || '').toLowerCase();
      if (rid.indexOf('inventory') >= 0 || rid.indexOf('stock') >= 0) inv += g.productIds.length;
      else if (rid.indexOf('price') >= 0)                              price += g.productIds.length;
      else if (cat === CATEGORY_DRIFT)                                  other += g.productIds.length;
    });
    return [
      '<div style="margin:16px 24px;padding:20px;background:rgba(245,158,11,0.10);',
      '            border:1px solid rgba(245,158,11,0.4);border-radius:10px;">',
      '  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">',
      '    <span aria-hidden="true" style="font-size:1.15rem;">⏳</span>',
      '    <h3 style="margin:0;font-size:1.0rem;color:var(--text-primary);">We’re still confirming your channels</h3>',
      '  </div>',
      '  <p style="margin:0 0 12px;color:var(--warm-gray);font-size:0.9rem;">',
      '    Drift detection is running but findings are provisional for the first 72 hours ',
      '    while initial sync stabilizes. We’re tracking them but won’t flag them as urgent yet.',
      '  </p>',
      '  <div style="font-size:0.85rem;color:var(--text-primary);margin-bottom:10px;">',
      '    <strong>Drift report ready in:</strong> ' + esc(formatCountdown(msRemaining)),
      '  </div>',
      '  <div style="font-size:0.85rem;color:var(--text-primary);">',
      '    <div style="margin-bottom:4px;font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">',
      '      Provisional findings so far',
      '    </div>',
            (inv   ? '<div>🟡 ' + inv   + ' possible inventory mismatch'  + (inv   === 1 ? '' : 'es') + '</div>' : ''),
            (price ? '<div>🟡 ' + price + ' possible price mismatch'      + (price === 1 ? '' : 'es') + '</div>' : ''),
            (other ? '<div>🟡 ' + other + ' possible cross-channel issue' + (other === 1 ? '' : 's')  + '</div>' : ''),
            (!inv && !price && !other ? '<div style="color:var(--warm-gray);">No provisional drift detected yet.</div>' : ''),
      '  </div>',
      '</div>'
    ].join('');
  }

  function maybeFireDriftMilestone(msRemaining, vios) {
    if (msRemaining > 0) return; // still provisional
    if (uiState && uiState.driftMilestoneShownAt) return; // already fired
    // Only fire if at least one channel actually has a connectedAt (otherwise
    // we never were provisional — no milestone to announce).
    var anyConnectedAt = Object.keys(channelConfigs).some(function(ch) {
      var cfg = channelConfigs[ch];
      return !!(cfg && cfg.connectedAt);
    });
    if (!anyConnectedAt) return;
    // And at least one drift finding has to exist; otherwise the toast is noise.
    var hasDrift = vios.some(function(v) { return violationCategory(v) === CATEGORY_DRIFT; });
    if (!hasDrift) return;
    uiState.driftMilestoneShownAt = new Date().toISOString();
    persistUiState();
    toast('Drift Report ready — channels have stabilized.', false);
  }

  // ============================================================
  // Bucket row (Screen 1)
  // ============================================================

  function renderBucketRow(bucketed) {
    // Compute first-screen budget: 2 per bucket, capped at HOME_TOTAL_BUDGET total
    var pickedQ = bucketed.quick.slice(0,  HOME_BUCKET_BUDGET);
    var pickedH = bucketed.high.slice(0,   HOME_BUCKET_BUDGET);
    var pickedC = bucketed.closer.slice(0, HOME_BUCKET_BUDGET);

    var total = pickedQ.length + pickedH.length + pickedC.length;
    var heading = total === 0
      ? 'You’re all caught up.'
      : total + ' thing' + (total === 1 ? '' : 's') + ' to consider this week';

    var bucketCol = function(label, icon, groups, bucketId) {
      var inner = '';
      if (!groups.length) {
        inner = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:8px 0;">Nothing here right now.</div>';
      } else {
        groups.forEach(function(g) {
          inner += renderRuleGroupCard(g, bucketId);
        });
      }
      var more = (bucketed[bucketId].length > groups.length)
        ? '<button type="button" class="btn btn-secondary" data-audit-action="bucket-show-all" data-bucket="' + esc(bucketId) + '" '
          + 'style="margin-top:8px;font-size:0.85rem;">Show ' + (bucketed[bucketId].length - groups.length) + ' more</button>'
        : '';
      return [
        '<div style="background:var(--surface-card,var(--cream));border:1px solid var(--cream-dark);border-radius:10px;padding:14px;">',
        '  <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text-primary);margin-bottom:10px;font-size:0.9rem;">',
        '    <span aria-hidden="true">' + icon + '</span>',
        '    <span>' + esc(label) + '</span>',
        '    <span style="color:var(--warm-gray);font-weight:400;">(' + bucketed[bucketId].length + ')</span>',
        '  </div>',
        inner,
        more,
        '</div>'
      ].join('');
    };

    return [
      '<div style="padding:0 24px;margin-top:16px;">',
      '  <h3 style="margin:8px 0 16px;font-size:1.0rem;color:var(--text-primary);">' + esc(heading) + '</h3>',
      '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">',
           bucketCol('Quick wins',          '⚡', pickedQ, BUCKET_QUICK),
           bucketCol('High impact',         '🔴', pickedH, BUCKET_HIGH),
           bucketCol('Worth a closer look', '👁',  pickedC, BUCKET_CLOSER),
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderRuleGroupCard(g, bucketId) {
    var n = g.productIds.length;
    var title = g.title || ruleTitleFromId(g.ruleId);
    var ctaLabel = ctaLabelForCategory(g.category);
    return [
      '<div style="padding:10px 0;border-bottom:1px solid var(--cream-dark);">',
      '  <div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:6px;">',
      '    <strong>' + n + '</strong> ' + esc(productNoun(g, n)) + ' &middot; ' + esc(title),
      '  </div>',
      '  <button type="button" class="btn btn-secondary" data-audit-action="open-rule-pop" '
       + 'data-ruleid="' + esc(g.ruleId) + '" data-bucket="' + esc(bucketId) + '" '
       + 'style="font-size:0.85rem;padding:4px 10px;">' + esc(ctaLabel) + ' →</button>',
      '</div>'
    ].join('');
  }

  function ruleTitleFromId(ruleId) {
    if (!ruleId) return 'Audit finding';
    // Best-effort humanization for unknown rules — strip prefix and slugify.
    var stripped = String(ruleId).replace(/^[a-zA-Z]+-?/, '').replace(/[-_]+/g, ' ').trim();
    if (!stripped) return ruleId;
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }

  function ctaLabelForCategory(cat) {
    if (cat === CATEGORY_DRIFT)   return 'Reconcile';
    if (cat === CATEGORY_PRICING) return 'View';
    return 'Fix list';
  }

  function productNoun(g, n) {
    if (g.category === CATEGORY_DRIFT) return n === 1 ? 'product affected' : 'products affected';
    return n === 1 ? 'product' : 'products';
  }

  // ============================================================
  // Browse-by-category nav (Screen 1 footer)
  // ============================================================

  function renderCategoryNav(ruleGroups) {
    var counts = { lq: 0, drift: 0, pricing: 0 };
    var productCounts = { lq: 0, drift: 0, pricing: 0 };
    ruleGroups.forEach(function(g) {
      counts[g.category]        = (counts[g.category] || 0) + 1;
      productCounts[g.category] = (productCounts[g.category] || 0) + g.productIds.length;
    });
    return [
      '<div style="padding:24px;margin-top:8px;">',
      '  <h3 style="margin:0 0 12px;font-size:0.9rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">',
      '    Browse by category',
      '  </h3>',
      '  <div style="display:flex;flex-direction:column;gap:8px;">',
           renderCategoryRow(CATEGORY_LQ,      productCounts.lq,      counts.lq),
           renderCategoryRow(CATEGORY_DRIFT,   productCounts.drift,   counts.drift),
           renderCategoryRow(CATEGORY_PRICING, productCounts.pricing, counts.pricing),
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderCategoryRow(catId, productCount, ruleCount) {
    if (!ruleCount) {
      return '<div style="color:var(--warm-gray);font-size:0.85rem;">'
           + '&bull; ' + esc(CATEGORY_LABEL[catId]) + ' (no findings)</div>';
    }
    var noun = catId === CATEGORY_PRICING ? 'informational findings' : 'rule' + (ruleCount === 1 ? '' : 's');
    return [
      '<button type="button" class="audit-cat-row" data-audit-action="open-category" data-catid="' + esc(catId) + '"',
      '        style="text-align:left;background:transparent;border:0;padding:8px 0;cursor:pointer;color:var(--text-primary);font-size:0.9rem;">',
      '  &bull; ' + esc(CATEGORY_LABEL[catId]) + ' (' + ruleCount + ' ' + esc(noun) + ')',
      '  <span style="color:var(--warm-gray);"> &rarr;</span>',
      '</button>'
    ].join('');
  }

  function renderHomeFooter() {
    return [
      '<div style="padding:0 24px 24px;display:flex;gap:12px;flex-wrap:wrap;">',
      '  <button type="button" class="btn btn-secondary" data-audit-action="open-suppressions">Suppressed rules</button>',
      '  <button type="button" class="btn btn-secondary" data-audit-action="open-digest-prefs">Digest preferences</button>',
      '</div>'
    ].join('');
  }

  // ============================================================
  // Home handlers
  // ============================================================

  function wireHomeHandlers(host, bucketed) {
    var refresh = host.querySelector('#auditRefreshBtn');
    if (refresh) refresh.addEventListener('click', function() {
      auditsLoaded = false;
      render();
      loadAudits(true).then(render).catch(function(err) {
        toast('Refresh failed: ' + (err && err.message || err), true);
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('[data-audit-action]'), function(el) {
      var action = el.getAttribute('data-audit-action');
      el.addEventListener('click', function(e) {
        e.preventDefault();
        if (action === 'open-category') {
          categoryView = el.getAttribute('data-catid');
          currentView  = 'category';
          render();
        } else if (action === 'open-rule-pop') {
          var rid = el.getAttribute('data-ruleid');
          rulePopView = { ruleId: rid };
          currentView = 'rule-population';
          render();
        } else if (action === 'bucket-show-all') {
          var bid = el.getAttribute('data-bucket');
          // Find the first category that fits this bucket — open the
          // matching category browse for the deeper list.
          var cat = bucketed[bid] && bucketed[bid].length ? bucketed[bid][0].category : null;
          if (cat) {
            categoryView = cat;
            currentView  = 'category';
            render();
          }
        } else if (action === 'open-suppressions') {
          if (typeof window.navigateTo === 'function') window.navigateTo('suppressions');
        } else if (action === 'open-digest-prefs') {
          openDigestPrefsSlideout();
        } else if (action === 'reconnect') {
          var ch = el.getAttribute('data-channel');
          if (typeof window.channelReconnect === 'function') {
            window.channelReconnect(ch);
          } else if (typeof window.navigateTo === 'function') {
            window.navigateTo('channels');
          }
        }
      });
    });
  }

  // ============================================================
  // J14 — on-ask audit modal
  // ============================================================
  //
  // POSTs to the askListingAi CF with a bearer Firebase ID token. Renders
  // a modal with question textarea → strengths / issues / generalGuidance.
  // All model-generated text is interpolated via esc() because the response
  // body can echo the user's untrusted question or upstream listing copy.

  var ASK_AI_CF_BASE = (window.TENANT_FIREBASE_CONFIG && window.TENANT_FIREBASE_CONFIG.cloudFunctionsBase)
                    || 'https://us-central1-mast-platform-prod.cloudfunctions.net';

  function _askAiUrl() { return ASK_AI_CF_BASE + '/askListingAi'; }

  function _renderAskAiModalShell(productId) {
    var productTitle = getProductTitle(productId);
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'onAskAuditOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onAskAuditTitle');
    overlay.style.zIndex = '220';
    overlay.innerHTML = [
      '<div class="modal" style="max-width:640px;width:92%;padding:0;">',
      '  <div style="padding:18px 20px 12px;border-bottom:1px solid var(--cream-dark);">',
      '    <h2 id="onAskAuditTitle" style="margin:0;font-size:1.15rem;color:var(--text-primary);">Ask Mast to audit this listing</h2>',
      '    <div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(productTitle) + '</div>',
      '  </div>',
      '  <div style="padding:18px 20px;">',
      '    <label for="onAskAuditQuestion" style="display:block;font-size:0.85rem;color:var(--text-primary);margin-bottom:6px;">Your question</label>',
      '    <textarea id="onAskAuditQuestion" rows="3" maxlength="1000"',
      '              style="width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;',
      '                     font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--cream);color:inherit;resize:vertical;"',
      '              placeholder="Ask about this listing… e.g. how do I rank higher on Etsy?"></textarea>',
      '    <div id="onAskAuditError" role="alert" aria-live="polite" style="display:none;margin-top:10px;padding:10px 12px;border-radius:6px;font-size:0.85rem;background:rgba(220,38,38,0.10);border:1px solid rgba(220,38,38,0.4);color:var(--danger,#f87171);"></div>',
      '    <div id="onAskAuditResult" style="display:none;margin-top:14px;"></div>',
      '  </div>',
      '  <div style="padding:12px 20px 18px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--cream-dark);">',
      '    <button type="button" class="btn btn-secondary" id="onAskAuditCancel">Close</button>',
      '    <button type="button" class="btn btn-primary" id="onAskAuditSubmit">Submit</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);
    return overlay;
  }

  function _renderAskAiResult(container, payload) {
    var html = [];
    var strengths = Array.isArray(payload.strengths) ? payload.strengths : [];
    var issues = Array.isArray(payload.issues) ? payload.issues : [];
    var guidance = typeof payload.generalGuidance === 'string' ? payload.generalGuidance : '';

    if (strengths.length) {
      html.push('<div style="margin-bottom:14px;">');
      html.push('  <h3 style="margin:0 0 6px;font-size:0.9rem;color:var(--text-primary);">Strengths</h3>');
      html.push('  <ul style="margin:0;padding-left:18px;color:var(--text-primary);font-size:0.85rem;">');
      strengths.forEach(function(s) {
        html.push('    <li style="margin-bottom:4px;">' + esc(s) + '</li>');
      });
      html.push('  </ul>');
      html.push('</div>');
    }

    if (issues.length) {
      html.push('<div style="margin-bottom:14px;">');
      html.push('  <h3 style="margin:0 0 6px;font-size:0.9rem;color:var(--text-primary);">Issues</h3>');
      html.push('  <div style="display:flex;flex-direction:column;gap:8px;">');
      issues.forEach(function(iss) {
        if (!iss || typeof iss !== 'object') return;
        var sev = (iss.severity === 'high' || iss.severity === 'medium' || iss.severity === 'low') ? iss.severity : 'medium';
        var dot = severityDot(sev);
        html.push('<div style="border:1px solid var(--cream-dark);border-radius:6px;padding:10px 12px;">');
        html.push('  <div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text-primary);">');
        html.push('    ' + dot);
        html.push('    <span>' + esc(iss.description || '') + '</span>');
        html.push('  </div>');
        if (iss.suggestedAction) {
          html.push('  <div style="margin-top:6px;padding:6px 8px;background:rgba(0,0,0,0.04);border-radius:4px;font-size:0.85rem;color:var(--text-primary);">');
          html.push('    <span style="font-weight:600;">Suggested: </span>' + esc(iss.suggestedAction));
          html.push('  </div>');
        }
        if (iss.ruleId) {
          html.push('  <div style="margin-top:4px;font-size:0.78rem;color:var(--warm-gray);">Rule ' + esc(iss.ruleId) + '</div>');
        }
        html.push('</div>');
      });
      html.push('  </div>');
      html.push('</div>');
    }

    if (guidance) {
      html.push('<div>');
      html.push('  <h3 style="margin:0 0 6px;font-size:0.9rem;color:var(--text-primary);">General guidance</h3>');
      html.push('  <p style="margin:0;color:var(--text-primary);font-size:0.85rem;white-space:pre-wrap;">' + esc(guidance) + '</p>');
      html.push('</div>');
    }

    if (!strengths.length && !issues.length && !guidance) {
      html.push('<div style="color:var(--warm-gray);font-size:0.85rem;">No findings returned.</div>');
    }

    container.innerHTML = html.join('');
    container.style.display = '';
  }

  function _showAskAiError(errEl, message) {
    errEl.textContent = message;
    errEl.style.display = '';
  }

  function _hideAskAiError(errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  async function _askListingAi(productId, question) {
    var auth = window.firebase && window.firebase.auth && window.firebase.auth();
    var user = auth && auth.currentUser;
    if (!user) {
      var err = new Error('Not signed in.');
      err._status = 401;
      throw err;
    }
    var idToken = await user.getIdToken();
    var resp = await fetch(_askAiUrl(), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productId: productId, question: question })
    });
    var body = null;
    try { body = await resp.json(); } catch (e) { /* leave null */ }
    if (!resp.ok) {
      var e = new Error((body && body.error) || ('Request failed (' + resp.status + ')'));
      e._status = resp.status;
      throw e;
    }
    return body;
  }

  function _closeAskAiModal() {
    var ov = document.getElementById('onAskAuditOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  window.openOnAskAudit = function(productId) {
    if (!productId) { toast('No product selected.', true); return; }
    // Idempotent open — close any prior instance first.
    _closeAskAiModal();
    var overlay = _renderAskAiModalShell(productId);

    var questionEl = overlay.querySelector('#onAskAuditQuestion');
    var submitBtn = overlay.querySelector('#onAskAuditSubmit');
    var cancelBtn = overlay.querySelector('#onAskAuditCancel');
    var errEl = overlay.querySelector('#onAskAuditError');
    var resultEl = overlay.querySelector('#onAskAuditResult');

    cancelBtn.addEventListener('click', _closeAskAiModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) _closeAskAiModal();
    });

    submitBtn.addEventListener('click', async function() {
      var q = (questionEl.value || '').trim();
      if (!q) { _showAskAiError(errEl, 'Enter a question first.'); return; }
      _hideAskAiError(errEl);
      resultEl.style.display = 'none';
      resultEl.innerHTML = '';
      submitBtn.disabled = true;
      var origLabel = submitBtn.textContent;
      submitBtn.textContent = 'Asking…';
      try {
        var data = await _askListingAi(productId, q);
        _renderAskAiResult(resultEl, (data && data.response) || {});
      } catch (err) {
        var status = err._status || 0;
        if (status === 402) {
          _showAskAiError(errEl, (err.message || 'Out of tokens.') + ' Upgrade your plan or top up to continue.');
        } else if (status === 429) {
          _showAskAiError(errEl, 'Too many requests. Try again in a minute.');
        } else if (status === 401) {
          _showAskAiError(errEl, 'Session expired — sign in again.');
        } else if (status === 404) {
          _showAskAiError(errEl, 'Listing not found for this product.');
        } else if (status === 400) {
          _showAskAiError(errEl, err.message || 'Invalid request.');
        } else {
          // Transient / upstream — keep modal open, suggest retry.
          _showAskAiError(errEl, (err.message || 'Request failed.') + ' Try again.');
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = origLabel;
      }
    });

    setTimeout(function() { questionEl.focus(); }, 0);
  };

  // ============================================================
  // Category browse view (secondary axis)
  // ============================================================

  function renderCategory(host) {
    var cat = categoryView || CATEGORY_LQ;
    var vios = visibleViolations().filter(function(v) { return violationCategory(v) === cat; });
    var ruleGroups = rollupByRule(vios);
    ruleGroups = rankForHome(ruleGroups);

    var showAll = !!categoryShowAll[cat];
    var visible = showAll ? ruleGroups : ruleGroups.slice(0, CATEGORY_PAGE_SIZE);

    var rows = '';
    if (!visible.length) {
      rows = '<div style="padding:24px;color:var(--warm-gray);font-size:0.9rem;">No findings in this category.</div>';
    } else {
      visible.forEach(function(g) {
        rows += renderCategoryRuleCard(g);
      });
    }

    var showAllBtn = (!showAll && ruleGroups.length > CATEGORY_PAGE_SIZE)
      ? '<div style="padding:12px 24px;">'
        + '<button type="button" class="btn btn-secondary" data-audit-action="cat-show-all">'
        + 'Show all (' + ruleGroups.length + ')</button>'
        + '</div>'
      : '';

    host.innerHTML = [
      '<div style="padding:24px 24px 0;">',
      '  <button type="button" class="btn btn-secondary" data-audit-action="back-home" style="font-size:0.85rem;margin-bottom:12px;">&larr; Audit</button>',
      '  <h2 style="margin:0 0 4px;">' + esc(CATEGORY_LABEL[cat]) + '</h2>',
      '  <div style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:16px;">',
            ruleGroups.length + ' active rule' + (ruleGroups.length === 1 ? '' : 's'),
      '  </div>',
      '</div>',
      '<div style="padding:0 24px;">' + rows + '</div>',
      showAllBtn
    ].join('');

    wireBackHandlers(host);
    wireCategoryHandlers(host);
  }

  function renderCategoryRuleCard(g) {
    var n = g.productIds.length;
    var title = g.title || ruleTitleFromId(g.ruleId);
    var sevDot = severityDot(g.severity);
    return [
      '<div style="background:var(--surface-card,var(--cream));border:1px solid var(--cream-dark);',
      '           border-radius:8px;padding:14px 16px;margin-bottom:10px;',
      '           display:flex;align-items:center;gap:12px;">',
      sevDot,
      '  <div style="flex:1;min-width:0;">',
      '    <div style="font-weight:500;color:var(--text-primary);font-size:0.9rem;">' + esc(title) + '</div>',
      '    <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">',
      '      Rule ' + esc(g.ruleId) + ' &middot; ' + n + ' product' + (n === 1 ? '' : 's') + ' affected',
      '    </div>',
      '  </div>',
      '  <button type="button" class="btn btn-secondary" data-audit-action="open-rule-pop" ',
      '          data-ruleid="' + esc(g.ruleId) + '" style="font-size:0.85rem;">Review &rarr;</button>',
      '</div>'
    ].join('');
  }

  function severityDot(sev) {
    var color = 'var(--warm-gray)';
    if (sev === 'high')   color = 'var(--danger,#f87171)';
    if (sev === 'medium') color = 'var(--amber,#fbbf24)';
    if (sev === 'low')    color = 'var(--accent,#34d399)';
    return '<span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'
         + color + ';flex-shrink:0;"></span>';
  }

  function wireCategoryHandlers(host) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-audit-action]'), function(el) {
      var action = el.getAttribute('data-audit-action');
      el.addEventListener('click', function(e) {
        e.preventDefault();
        if (action === 'open-rule-pop') {
          rulePopView = { ruleId: el.getAttribute('data-ruleid') };
          currentView = 'rule-population';
          render();
        } else if (action === 'cat-show-all') {
          categoryShowAll[categoryView] = true;
          render();
        }
      });
    });
  }

  function wireBackHandlers(host) {
    var back = host.querySelector('[data-audit-action="back-home"]');
    if (back) back.addEventListener('click', function(e) {
      e.preventDefault();
      currentView = 'home';
      render();
    });
  }

  // ============================================================
  // Rule-population view (Screen 4)
  // ============================================================

  function renderRulePopulation(host) {
    if (!rulePopView || !rulePopView.ruleId) {
      currentView = 'home';
      return render();
    }
    var ruleId = rulePopView.ruleId;
    var vios = visibleViolations().filter(function(v) { return v.ruleId === ruleId; });
    if (!vios.length) {
      // Everything cleared while we were here — bounce home with a toast.
      currentView = 'home';
      toast('All ' + esc(ruleId) + ' findings resolved.', false);
      return render();
    }

    var groups = rollupByRuleAndProduct(vios);
    // Sort by productCount desc within the group
    groups.sort(function(a, b) { return b.violations.length - a.violations.length; });

    var rule = vios[0];
    var title = rule.title || ruleTitleFromId(ruleId);
    var detail = rule.detail || '';
    var n = groups.length;

    var rows = '';
    groups.forEach(function(g) {
      var pid = g.productId;
      var pTitle = getProductTitle(pid);
      var sub = g.violations.length > 1
        ? g.violations.length + ' instance' + (g.violations.length === 1 ? '' : 's')
        : '';
      rows += [
        '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--cream-dark);">',
        '  <div style="flex:1;min-width:0;">',
        '    <div style="font-size:0.9rem;color:var(--text-primary);">' + esc(pTitle) + '</div>',
            (sub ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(sub) + '</div>' : ''),
        '  </div>',
        '  <button type="button" class="btn btn-secondary" data-audit-action="open-product" ',
        '          data-productid="' + esc(pid) + '" style="font-size:0.85rem;">Fix &rarr;</button>',
        '</div>'
      ].join('');
    });

    host.innerHTML = [
      '<div style="padding:24px 24px 0;">',
      '  <button type="button" class="btn btn-secondary" data-audit-action="back-home" style="font-size:0.85rem;margin-bottom:12px;">&larr; Audit</button>',
      '  <h2 style="margin:0 0 4px;">' + esc(title) + '</h2>',
      '  <div style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:8px;">',
      '    Rule ' + esc(ruleId) + ' &middot; ' + n + ' product' + (n === 1 ? '' : 's') + ' affected',
      '  </div>',
            (detail ? '<p style="color:var(--text-primary);font-size:0.9rem;margin:0 0 16px;max-width:760px;">' + esc(detail) + '</p>' : ''),
      '  <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">',
      '    <button type="button" class="btn btn-secondary" data-audit-action="rp-mark-all-reviewed">Mark all reviewed</button>',
      '    <button type="button" class="btn btn-secondary" data-audit-action="rp-suppress">⋯ Suppress rule</button>',
      '    <button type="button" class="btn btn-secondary" data-audit-action="rp-snooze">Snooze…</button>',
      '  </div>',
      '</div>',
      '<div style="padding:0 24px 24px;background:var(--surface-card,var(--cream));border:1px solid var(--cream-dark);',
      '            border-radius:8px;margin:0 24px;">',
           rows,
      '</div>'
    ].join('');

    wireBackHandlers(host);
    wireRulePopulationHandlers(host, ruleId, groups);
  }

  function wireRulePopulationHandlers(host, ruleId, groups) {
    var allViolationIds = [];
    var allProductIds   = [];
    groups.forEach(function(g) {
      allProductIds.push(g.productId);
      g.violations.forEach(function(v) { allViolationIds.push(v.id); });
    });

    var afUi = window.AuditFeedbackUI || {};
    var changeCb = function() {
      auditsLoaded = false;
      loadAudits(true).then(render);
    };

    Array.prototype.forEach.call(host.querySelectorAll('[data-audit-action]'), function(el) {
      var action = el.getAttribute('data-audit-action');
      el.addEventListener('click', function(e) {
        e.preventDefault();
        if (action === 'open-product') {
          openProductDrillSlideout(el.getAttribute('data-productid'));
          return;
        }
        if (action === 'rp-mark-all-reviewed' && typeof afUi.openRulePopulationMenu === 'function') {
          // We use the rollup menu primitive directly — invoke its primary
          // action via the same path so the toast wording stays consistent.
          afUi.openRulePopulationMenu(el, {
            ruleId:           ruleId,
            productIds:       allProductIds,
            violationDocIds:  allViolationIds,
            onChange:         changeCb
          });
        } else if (action === 'rp-suppress' && typeof afUi.openRulePopulationMenu === 'function') {
          afUi.openRulePopulationMenu(el, {
            ruleId:           ruleId,
            productIds:       allProductIds,
            violationDocIds:  allViolationIds,
            onChange:         changeCb
          });
        } else if (action === 'rp-snooze' && typeof afUi.openSnoozeDialog === 'function') {
          afUi.openSnoozeDialog(el, function(dur) {
            return Promise.all(allViolationIds.map(function(id) {
              return window.AuditFeedback.snooze(id, dur);
            })).then(changeCb);
          });
        }
      });
    });
  }

  // ============================================================
  // J15 — Digest preferences slideout
  // ============================================================
  //
  // Reads/writes tenants/{tid}/admin/digestPref. The CF scheduler
  // (digestEmailScheduler) consumes this doc per-tenant per hourly
  // tick. Shape:
  //   { cadence: 'weekly'|'monthly'|'quarterly'|'off',
  //     dayOfWeek: 0..6, hourLocal: 0..23, timezone: string,
  //     unsubscribed: bool, lastSentAt: ISO, recipients?: string[] }

  var DIGEST_PREF_PATH = 'admin/digestPref';
  var DIGEST_DEFAULTS = {
    cadence:     'weekly',
    dayOfWeek:   1,
    hourLocal:   7,
    timezone:    'America/New_York',
    unsubscribed: false
  };

  function loadDigestPref() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      return Promise.resolve(Object.assign({}, DIGEST_DEFAULTS));
    }
    return window.MastDB.get(DIGEST_PREF_PATH).then(function(raw) {
      return Object.assign({}, DIGEST_DEFAULTS, raw || {});
    }).catch(function() { return Object.assign({}, DIGEST_DEFAULTS); });
  }

  function saveDigestPref(pref) {
    if (!window.MastDB || typeof window.MastDB.set !== 'function') return Promise.resolve();
    return window.MastDB.set(DIGEST_PREF_PATH, pref);
  }

  function browserTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DIGEST_DEFAULTS.timezone; }
    catch (_e) { return DIGEST_DEFAULTS.timezone; }
  }

  function renderDigestPrefsBody(pref) {
    var DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var cadenceOpts = [
      ['weekly',    'Weekly'],
      ['monthly',   'Monthly'],
      ['quarterly', 'Quarterly'],
      ['off',       'Off (no digest)']
    ];
    var html = [];
    html.push('<div style="padding:20px 24px;display:flex;flex-direction:column;gap:18px;">');

    html.push('<div>');
    html.push('  <label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Cadence</label>');
    html.push('  <select id="digestPrefCadence" class="form-control" style="width:100%;">');
    cadenceOpts.forEach(function(opt) {
      var sel = (pref.cadence === opt[0]) ? ' selected' : '';
      html.push('    <option value="' + esc(opt[0]) + '"' + sel + '>' + esc(opt[1]) + '</option>');
    });
    html.push('  </select>');
    html.push('  <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Off honors at the cadence boundary AND inside the aggregator — defense in depth.</div>');
    html.push('</div>');

    html.push('<div id="digestPrefWeeklyRow">');
    html.push('  <label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Send on</label>');
    html.push('  <select id="digestPrefDow" class="form-control" style="width:100%;">');
    for (var i = 0; i < 7; i++) {
      var s = (pref.dayOfWeek === i) ? ' selected' : '';
      html.push('    <option value="' + i + '"' + s + '>' + esc(DOW[i]) + '</option>');
    }
    html.push('  </select>');
    html.push('</div>');

    html.push('<div>');
    html.push('  <label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Timezone</label>');
    html.push('  <input id="digestPrefTz" type="text" class="form-control" style="width:100%;" value="' + esc(pref.timezone || browserTimezone()) + '" />');
    html.push('  <div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Digests fire only inside your local 06:00&ndash;09:00 window.</div>');
    html.push('</div>');

    var lastSent = pref.lastSentAt
      ? 'Last digest queued: ' + esc(new Date(pref.lastSentAt).toLocaleString())
      : 'No digest sent yet.';
    html.push('<div style="font-size:0.78rem;color:var(--warm-gray);">' + lastSent + '</div>');

    html.push('</div>');
    return html.join('');
  }

  function renderDigestPrefsFooter() {
    return [
      '<div style="padding:14px 24px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--cream-dark);">',
      '  <button type="button" class="btn btn-secondary" data-digest-action="cancel">Cancel</button>',
      '  <button type="button" class="btn btn-primary" data-digest-action="save">Save</button>',
      '</div>'
    ].join('');
  }

  function wireDigestPrefsHandlers(current) {
    // Hide/show weekly DoW row when cadence != weekly.
    function syncWeeklyRow() {
      var sel = document.getElementById('digestPrefCadence');
      var row = document.getElementById('digestPrefWeeklyRow');
      if (sel && row) row.style.display = (sel.value === 'weekly') ? '' : 'none';
    }
    var sel = document.getElementById('digestPrefCadence');
    if (sel) sel.addEventListener('change', syncWeeklyRow);
    syncWeeklyRow();

    Array.prototype.forEach.call(document.querySelectorAll('[data-digest-action]'), function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-digest-action');
        if (action === 'cancel') {
          if (window.mastSlideOut && typeof window.mastSlideOut.close === 'function') window.mastSlideOut.close();
          return;
        }
        if (action === 'save') {
          var cadenceEl = document.getElementById('digestPrefCadence');
          var dowEl     = document.getElementById('digestPrefDow');
          var tzEl      = document.getElementById('digestPrefTz');
          var cadence = cadenceEl ? cadenceEl.value : 'weekly';
          var pref = Object.assign({}, current, {
            cadence:     cadence,
            dayOfWeek:   dowEl ? parseInt(dowEl.value, 10) : 1,
            timezone:    (tzEl && tzEl.value && tzEl.value.trim()) || browserTimezone(),
            unsubscribed: cadence === 'off'  // 'off' implies unsubscribed; lets the CF honor both gates uniformly
          });
          saveDigestPref(pref).then(function() {
            toast('Digest preferences saved');
            if (window.mastSlideOut && typeof window.mastSlideOut.close === 'function') window.mastSlideOut.close();
          }).catch(function(err) {
            toast('Save failed: ' + (err && err.message || err), true);
          });
        }
      });
    });
  }

  function openDigestPrefsSlideout() {
    loadDigestPref().then(function(pref) {
      var bodyHtml   = renderDigestPrefsBody(pref);
      var footerHtml = renderDigestPrefsFooter();
      if (window.mastSlideOut && typeof window.mastSlideOut.open === 'function') {
        window.mastSlideOut.open({
          title:    'Digest preferences',
          subtitle: 'Cadence and timing for the listing-health digest email',
          bodyHtml: bodyHtml,
          footerHtml: footerHtml,
          onClose:  function() { /* no-op */ }
        });
        setTimeout(function() { wireDigestPrefsHandlers(pref); }, 0);
      } else {
        toast('Slide-out helper missing — digest preferences UI unavailable', true);
      }
    });
  }

  // ============================================================
  // Per-product drill (Screen 3) — uses mastSlideOut right-side panel
  // ============================================================

  function openProductDrillSlideout(productId) {
    if (!productId) return;
    var vios = visibleViolations().filter(function(v) { return v.productId === productId; });
    var groups = rollupByRuleAndProduct(vios);
    // Sort: high severity first, then by group size
    var sevWeight = { high: 3, medium: 2, low: 1, informational: 0 };
    groups.sort(function(a, b) {
      var sa = (a.violations[0] && a.violations[0].severity) || 'medium';
      var sb = (b.violations[0] && b.violations[0].severity) || 'medium';
      var w = (sevWeight[sb] || 0) - (sevWeight[sa] || 0);
      if (w !== 0) return w;
      return b.violations.length - a.violations.length;
    });

    var capped = groups.slice(0, PRODUCT_DRILL_CAP);
    var overflow = groups.length - capped.length;

    var title = getProductTitle(productId);
    var photoUrl = getProductPhotoUrl(productId);
    var subtitle = 'Product · ' + (vios.length ? channelsSummary(vios) : '');

    var bodyHtml = renderProductDrillBody(productId, title, photoUrl, capped, overflow);
    var footerHtml = renderProductDrillFooter(productId);

    if (window.mastSlideOut && typeof window.mastSlideOut.open === 'function') {
      window.mastSlideOut.open({
        title:    title,
        subtitle: subtitle,
        bodyHtml: bodyHtml,
        footerHtml: footerHtml,
        onClose:  function() { /* no-op */ }
      });
      // The slide-out body is appended as innerHTML — we need to wire up
      // handlers after the next tick. mastSlideOut docs do not promise a
      // specific selector; we re-query the document.
      setTimeout(function() { wireProductDrillHandlers(productId, capped); }, 0);
    } else {
      // Fallback: inline modal-style overlay. This is defensive — the helper
      // is shipped admin-wide, so we should never hit it in practice.
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.style.zIndex = '210';
      overlay.innerHTML = '<div class="modal" style="max-width:600px;">' + bodyHtml
                       + '<div style="padding:16px;">' + footerHtml + '</div></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.parentNode.removeChild(overlay);
      });
      setTimeout(function() { wireProductDrillHandlers(productId, capped); }, 0);
    }
  }

  function channelsSummary(vios) {
    var set = Object.create(null);
    vios.forEach(function(v) { (v.channels || []).forEach(function(c) { set[c] = true; }); });
    var keys = Object.keys(set);
    if (!keys.length) return '';
    return keys.map(channelLabel).join(' + ');
  }

  function renderProductDrillBody(productId, title, photoUrl, groups, overflow) {
    var head = '';
    if (photoUrl) {
      head = '<div style="display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--cream-dark);">'
           + '<img src="' + esc(photoUrl) + '" alt="" style="width:56px;height:56px;border-radius:6px;object-fit:cover;" />'
           + '<div style="font-size:0.9rem;color:var(--text-primary);">' + esc(title) + '</div>'
           + '</div>';
    }
    var cards = '';
    if (!groups.length) {
      cards = '<div style="padding:20px;color:var(--warm-gray);font-size:0.9rem;">No active findings on this product.</div>';
    } else {
      groups.forEach(function(g) {
        cards += renderProductDrillCard(g);
      });
    }
    var overflowMsg = overflow > 0
      ? '<div style="padding:8px 16px;font-size:0.85rem;color:var(--warm-gray);font-style:italic;">'
        + '+ ' + overflow + ' more finding' + (overflow === 1 ? '' : 's') + ' — addressed via "Audit this listing" below.'
        + '</div>'
      : '';
    return head + cards + overflowMsg;
  }

  function renderProductDrillCard(g) {
    var v = g.violations[0];
    var sevIcon = (v.severity === 'high') ? '🔴' : (v.severity === 'low' || v.tier === 'informational' ? '👁' : '⚡');
    var title = v.title || ruleTitleFromId(v.ruleId);
    var detail = v.detail || '';
    var suggestion = v.suggestion || '';
    var instCount = g.violations.length;
    var instLine = instCount > 1
      ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">' + instCount + ' instances on this product</div>'
      : '';
    var sugBlock = suggestion
      ? '<div style="margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:6px;font-size:0.85rem;color:var(--text-primary);">'
        + '<span style="font-weight:600;">Suggested: </span>' + esc(suggestion) + '</div>'
      : '';
    return [
      '<div style="border:1px solid var(--cream-dark);border-radius:8px;padding:12px 14px;margin:10px 16px;">',
      '  <div style="display:flex;align-items:flex-start;gap:8px;">',
      '    <span aria-hidden="true" style="font-size:1.0rem;">' + sevIcon + '</span>',
      '    <div style="flex:1;min-width:0;">',
      '      <div style="font-weight:500;color:var(--text-primary);font-size:0.9rem;">' + esc(title) + '</div>',
              (detail ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(detail) + '</div>' : ''),
              sugBlock,
              instLine,
      '    </div>',
      '  </div>',
      '  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">',
      '    <button type="button" class="btn btn-secondary" data-audit-action="pd-resolve" ',
      '            data-vid="' + esc(v.id) + '" style="font-size:0.85rem;">Mark resolved</button>',
      '    <button type="button" class="btn btn-secondary" data-audit-action="pd-snooze" ',
      '            data-vid="' + esc(v.id) + '" style="font-size:0.85rem;">Snooze…</button>',
      '    <button type="button" class="btn btn-secondary" data-audit-action="pd-suppress" ',
      '            data-ruleid="' + esc(v.ruleId) + '" data-productid="' + esc(v.productId) + '" ',
      '            data-vid="' + esc(v.id) + '" data-category="' + esc(violationCategory(v)) + '" ',
      '            style="font-size:0.85rem;">⋯ Suppress</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderProductDrillFooter(productId) {
    return [
      '<div style="display:flex;justify-content:flex-end;gap:8px;">',
      '  <button type="button" class="btn btn-primary" data-audit-action="pd-askai" data-productid="' + esc(productId) + '">',
      '    Ask Mast to audit this listing &rarr;',
      '  </button>',
      '</div>'
    ].join('');
  }

  function wireProductDrillHandlers(productId, groups) {
    var afUi = window.AuditFeedbackUI || {};
    var af   = window.AuditFeedback   || {};
    var changeCb = function() {
      auditsLoaded = false;
      loadAudits(true).then(render);
    };
    // Scope query to the document — slide-out content lives outside #auditTabContent
    Array.prototype.forEach.call(document.querySelectorAll('[data-audit-action]'), function(el) {
      // Only wire ones inside the slide-out (not our home/category renders).
      if (el.closest && el.closest('#auditTabContent')) return;
      if (el._auditWired) return;
      el._auditWired = true;
      var action = el.getAttribute('data-audit-action');
      el.addEventListener('click', function(e) {
        e.preventDefault();
        if (action === 'pd-resolve' && typeof af.markResolved === 'function') {
          af.markResolved(el.getAttribute('data-vid')).then(function() {
            toast('Marked resolved (pending recheck).');
            // Close the slide-out so it re-opens fresh next click.
            if (window.mastSlideOut && typeof window.mastSlideOut.close === 'function') window.mastSlideOut.close();
            changeCb();
          }).catch(function(err) { toast('Failed: ' + (err.message || err), true); });
        } else if (action === 'pd-snooze' && typeof afUi.openSnoozeDialog === 'function') {
          var vid = el.getAttribute('data-vid');
          afUi.openSnoozeDialog(el, function(dur) {
            return af.snooze(vid, dur).then(function() {
              toast('Snoozed for ' + dur + '.');
              if (window.mastSlideOut && typeof window.mastSlideOut.close === 'function') window.mastSlideOut.close();
              changeCb();
            });
          });
        } else if (action === 'pd-suppress' && typeof afUi.openSuppressDialog === 'function') {
          var ruleId = el.getAttribute('data-ruleid');
          var pid    = el.getAttribute('data-productid');
          var cat    = el.getAttribute('data-category');
          var pTitle = getProductTitle(pid);
          afUi.openSuppressDialog({
            title:        'Suppress rule for ' + pTitle,
            defaultScope: 'product',
            onConfirm:    function(form) {
              return af.suppressRule({
                ruleId:     ruleId,
                scope:      form.scope,
                scopeId:    form.scope === 'product'  ? pid
                          : form.scope === 'category' ? (cat || pid)
                          : '*',
                reason:     form.reason,
                reasonText: form.reasonText
              }).then(function() {
                if (window.mastSlideOut && typeof window.mastSlideOut.close === 'function') window.mastSlideOut.close();
                changeCb();
              });
            }
          });
        } else if (action === 'pd-askai') {
          if (typeof window.openOnAskAudit === 'function') {
            window.openOnAskAudit(el.getAttribute('data-productid'));
          }
        }
      });
    });
  }

  // ============================================================
  // Module registration
  // ============================================================

  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('audit', {
      routes: {
        'audit': {
          tab: 'auditTab',
          setup: function() {
            currentView = 'home';
            categoryView = null;
            rulePopView = null;
            // J12 feedback primitives may not be loaded yet (separate
            // lazy-loaded module). Ensure them before first render so
            // rollup menus + slide-out + suppression dialog all exist.
            ensureAuditFeedbackLoaded().then(function() {
              return loadAudits(false);
            }).then(render).catch(function(err) {
              console.error('[Audit] setup failed:', err);
              var host = document.getElementById('auditTabContent');
              if (host) host.innerHTML = '<div style="padding:24px;color:var(--danger);">Failed to load audit: ' + esc(err.message || err) + '</div>';
            });
          }
        }
      },
      detachListeners: function() {
        auditsLoaded = false;
        violationsData = [];
        suppressionsData = [];
        productsById = Object.create(null);
        channelConfigs = Object.create(null);
        currentView = 'home';
        categoryView = null;
        rulePopView = null;
        categoryShowAll = Object.create(null);
      }
    });
  }

  function ensureAuditFeedbackLoaded() {
    if (window.AuditFeedback && window.AuditFeedbackUI) return Promise.resolve();
    if (window.MastAdmin && typeof window.MastAdmin.loadModule === 'function') {
      return window.MastAdmin.loadModule('auditFeedback').catch(function(err) {
        console.warn('[Audit] auditFeedback load failed:', err);
      });
    }
    return Promise.resolve();
  }

  // Expose a small surface so other code can drive the home from outside
  // (e.g. dashboard cards linking deep into a category).
  window.AuditModule = {
    openHome: function() {
      currentView = 'home';
      render();
    },
    openCategory: function(cat) {
      categoryView = cat;
      currentView = 'category';
      render();
    },
    openProductDrill: openProductDrillSlideout,
    refresh: function() {
      auditsLoaded = false;
      return loadAudits(true).then(render);
    }
  };

})();
