/**
 * migration-dashboard.js — the migration/import admin surface: the Migration
 * Dashboard view (phase tracker, discovery/confirmation/execution stat cards,
 * next-action cards) plus the confirmation/plan/historical-orders/import route
 * renders (the latter three delegate to the lazy migrationPlan module).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except born-clean ratchet fixes: hardcoded hex colors become
 * rgba() (identical color, hex-lint clean) and numeric HTML entities become the
 * literal emoji they encode. The inline block is top-level scope, so every symbol
 * stays a window global; the cluster's own state/constants (_migrationData,
 * _migrationListener, MIGRATION_PHASES, PHASE_LABELS, PHASE_ICONS,
 * CONFIRM_CATEGORY_META) and its bare deps (MastDB, MastAdmin, esc, navigateTo)
 * are window globals read only POST-LOAD (renderMigration* are the route setup
 * fns), so the deferred load is safe.
 */

var _migrationData = null;
var _migrationListener = null;

function loadMigrationData(callback) {
  var tenantId = MastDB.tenantId();
  if (!tenantId) return;

  if (_migrationListener) _migrationListener();
  _migrationListener = MastDB.subscribe('admin/migration', function(val) {
    _migrationData = val != null ? val : null;
    if (callback) callback(_migrationData);
  });
}

var MIGRATION_PHASES = ['discovery', 'confirmation', 'planning', 'execution', 'post-cutover', 'complete'];
var PHASE_LABELS = { discovery: 'Discovery', confirmation: 'Confirmation', planning: 'Planning', execution: 'Execution', 'post-cutover': 'Post-Cutover', complete: 'Complete' };
var PHASE_ICONS = { discovery: '🔍', confirmation: '✅', planning: '📅', execution: '⚙', 'post-cutover': '🔎', complete: '🎉' };

function renderMigrationDashboard() {
  var container = document.getElementById('migrationDashTab');
  if (!container) return;
  showMigrationSidebar();

  container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--warm-gray);">Loading migration data...</div>';

  loadMigrationData(function(data) {
    if (!data) {
      container.innerHTML = '<div style="max-width:700px;">' +
        '<h1 style="margin-top:0;">Migration</h1>' +
        '<div style="background:var(--surface-card,rgba(245,245,245,1));border-radius:12px;padding:2rem;text-align:center;">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">🔄</div>' +
          '<p style="color:var(--warm-gray);margin-bottom:16px;">No migration in progress. Start a migration via Claude to begin the cutover process.</p>' +
        '</div>' +
      '</div>';
      return;
    }

    var status = data.status || 'discovery';
    var currentIdx = MIGRATION_PHASES.indexOf(status);
    if (status === 'paused') currentIdx = MIGRATION_PHASES.indexOf(data.pausedFrom || 'discovery');

    // Phase indicator bar
    var phases = '<div style="display:flex;gap:4px;margin-bottom:24px;">';
    for (var i = 0; i < MIGRATION_PHASES.length; i++) {
      var phase = MIGRATION_PHASES[i];
      var isActive = i === currentIdx;
      var isDone = i < currentIdx;
      var bg = isDone ? 'var(--primary)' : isActive ? 'var(--primary-light, rgba(245,158,11,1))' : 'var(--surface-card-border, rgba(224,224,224,1))';
      var textColor = (isDone || isActive) ? 'rgba(255,255,255,1)' : 'var(--warm-gray)';
      phases += '<div style="flex:1;text-align:center;padding:10px 4px;background:' + bg + ';color:' + textColor + ';border-radius:6px;font-size:0.72rem;font-weight:500;transition:all 0.3s;">' +
        '<div style="font-size:1.15rem;margin-bottom:2px;">' + PHASE_ICONS[phase] + '</div>' +
        PHASE_LABELS[phase] +
      '</div>';
    }
    phases += '</div>';

    // Status banner
    var banner = '';
    if (status === 'paused') {
      banner = '<div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;">' +
        '⚠ Migration is <strong>paused</strong> (was in ' + PHASE_LABELS[data.pausedFrom || 'discovery'] + '). Resume via Claude when ready.</div>';
    } else if (status === 'complete') {
      banner = '<div style="background:rgba(6,95,70,0.15);border:1px solid rgba(6,95,70,0.25);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;">' +
        '🎉 Migration <strong>complete</strong>! Your site is live.</div>';
    }

    // Quick stats
    var stats = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;">';

    // Products discovered
    if (data.discovery && data.discovery.products) {
      stats += statCard('Products', data.discovery.products.found || 0, '🛒');
    }
    // Images
    if (data.discovery && data.discovery.images) {
      stats += statCard('Images', data.discovery.images.found || 0, '📷');
    }
    // Confirmation items
    if (data.confirmation && data.confirmation.items) {
      var items = data.confirmation.items;
      var confirmed = Object.values(items).filter(function(i) { return i.status === 'confirmed'; }).length;
      stats += statCard('Confirmed', confirmed + '/' + Object.keys(items).length, '✅');
    }
    // Plan steps
    if (data.plan && data.plan.steps) {
      var steps = data.plan.steps;
      var done = Object.values(steps).filter(function(s) { return s.status === 'complete'; }).length;
      stats += statCard('Steps Done', done + '/' + Object.keys(steps).length, '📋');
    }
    // Cutover date
    if (data.plan && data.plan.cutoverDate) {
      stats += statCard('Cutover', data.plan.cutoverDate, '📅');
    }
    // Source platform
    if (data.sourcePlatform) {
      stats += statCard('From', esc(data.sourcePlatform), '🚀');
    }

    stats += '</div>';

    // Next actions
    var actions = '';
    if (status === 'discovery') {
      actions = nextActionCard('Discovery in progress', 'Claude is analyzing your current website. Findings will appear here as they are recorded.', 'migration-confirm', 'Review Findings');
    } else if (status === 'confirmation') {
      actions = nextActionCard('Items need your review', 'Review discovered data and confirm what should be migrated.', 'migration-confirm', 'Review & Confirm');
    } else if (status === 'planning') {
      actions = nextActionCard('Plan your cutover', 'Review the migration plan and adjust dates as needed.', 'migration-plan', 'View Plan');
    } else if (status === 'execution') {
      actions = nextActionCard('Migration in progress', 'Data import, image re-hosting, and cutover steps are being executed.', 'migration-plan', 'Track Progress');
    } else if (status === 'post-cutover') {
      actions = nextActionCard('Verify your site', 'Complete the post-cutover checklist to confirm everything is working.', 'migration-plan', 'View Checklist');
    }

    container.innerHTML = '<div style="max-width:800px;">' +
      '<h1 style="margin-top:0;margin-bottom:4px;">Migration Dashboard</h1>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:20px;">Migrating from ' + esc(data.sourcePlatform || 'unknown') + (data.sourceUrl ? ' (' + esc(data.sourceUrl) + ')' : '') + '</p>' +
      banner + phases + stats + actions +
    '</div>';
  });
}

function statCard(label, value, icon) {
  return '<div style="background:var(--surface-card,rgba(245,245,245,1));border-radius:8px;padding:14px 16px;text-align:center;">' +
    '<div style="font-size:1.15rem;margin-bottom:4px;">' + icon + '</div>' +
    '<div style="font-size:1.15rem;font-weight:600;color:var(--text,rgba(42,42,42,1));">' + value + '</div>' +
    '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</div>' +
  '</div>';
}

function nextActionCard(title, desc, route, btnLabel) {
  return '<div style="background:var(--surface-card,rgba(245,245,245,1));border:1px solid var(--surface-card-border,rgba(224,224,224,1));border-radius:10px;padding:20px;">' +
    '<h3 style="margin:0 0 6px;font-size:0.9rem;">' + esc(title) + '</h3>' +
    '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:12px;">' + esc(desc) + '</p>' +
    '<button class="btn btn-primary" onclick="navigateTo(\'' + route + '\')" style="font-size:0.85rem;">' + esc(btnLabel) + '</button>' +
  '</div>';
}

// ============================================================
// Migration Confirmation View
// ============================================================

var CONFIRM_CATEGORY_META = {
  products: { icon: '🛒', label: 'Products' },
  images: { icon: '📷', label: 'Images' },
  blog: { icon: '📝', label: 'Blog Posts' },
  inventory: { icon: '📦', label: 'Inventory' },
  subscribers: { icon: '📧', label: 'Email Subscribers' },
  giftCards: { icon: '🎁', label: 'Gift Cards' },
  customers: { icon: '👥', label: 'Customers' },
  orders: { icon: '💳', label: 'Historical Orders' },
  integrations: { icon: '🔌', label: 'Integrations' },
  domain: { icon: '🌐', label: 'Domain' },
  payments: { icon: '💳', label: 'Payments' }
};

function renderMigrationConfirmation() {
  var container = document.getElementById('migrationConfirmTab');
  if (!container) return;
  showMigrationSidebar();

  loadMigrationData(function(data) {
    if (!data || !data.confirmation || !data.confirmation.items) {
      container.innerHTML = '<div style="max-width:700px;">' +
        '<h1 style="margin-top:0;">Confirmation</h1>' +
        '<p style="color:var(--warm-gray);">No confirmation items yet. Discovery must complete first.</p>' +
      '</div>';
      return;
    }

    var items = data.confirmation.items;
    var itemIds = Object.keys(items);

    var html = '<div style="max-width:800px;">' +
      '<h1 style="margin-top:0;margin-bottom:4px;">Confirm Migration Items</h1>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:20px;">Review what was discovered on your current site. Confirm items to include in the migration or skip items you don\'t need.</p>';

    // Summary bar
    var confirmed = 0, skipped = 0, remaining = 0;
    itemIds.forEach(function(id) { var s = items[id].status; if (s === 'confirmed') confirmed++; else if (s === 'skipped') skipped++; else remaining++; });
    html += '<div style="display:flex;gap:12px;margin-bottom:20px;font-size:0.85rem;">' +
      '<span style="color:var(--primary);font-weight:500;">✅ ' + confirmed + ' confirmed</span>' +
      '<span style="color:var(--warm-gray);">⚪ ' + remaining + ' remaining</span>' +
      '<span style="color:var(--warm-gray);">❌ ' + skipped + ' skipped</span>' +
    '</div>';

    // Category cards
    itemIds.forEach(function(id) {
      var item = items[id];
      var cat = item.category || 'unknown';
      var meta = CONFIRM_CATEGORY_META[cat] || { icon: '📄', label: cat };
      var statusBadge = '';
      if (item.status === 'confirmed') statusBadge = '<span class="status-badge" style="background:rgba(22,163,74,1);color:white;">CONFIRMED</span>';
      else if (item.status === 'skipped') statusBadge = '<span class="status-badge" style="background:rgba(156,163,175,1);color:white;">SKIPPED</span>';
      else if (item.status === 'needs-input') statusBadge = '<span class="status-badge" style="background:rgba(245,158,11,1);color:white;">NEEDS INPUT</span>';
      else statusBadge = '<span class="status-badge" style="background:rgba(37,99,235,1);color:white;">DISCOVERED</span>';

      var discoveredSummary = '';
      if (item.discoveredValue) {
        var dv = item.discoveredValue;
        if (typeof dv === 'object') {
          if (dv.found !== undefined) discoveredSummary = dv.found + ' found';
          else if (dv.detected !== undefined) discoveredSummary = dv.detected ? 'Detected' : 'Not detected';
          else if (dv.name) discoveredSummary = dv.name;
          else if (dv.count !== undefined) discoveredSummary = dv.count + ' found';
          else discoveredSummary = JSON.stringify(dv).slice(0, 80);
        } else {
          discoveredSummary = String(dv).slice(0, 80);
        }
      }

      html += '<div style="background:var(--surface-card,rgba(245,245,245,1));border:1px solid var(--surface-card-border,rgba(224,224,224,1));border-radius:8px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:center;gap:14px;">' +
        '<div style="font-size:1.6rem;flex-shrink:0;">' + meta.icon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<strong style="font-size:0.9rem;">' + esc(meta.label) + '</strong>' +
            statusBadge +
            (item.required ? '<span style="font-size:0.72rem;color:var(--warm-gray);">Required</span>' : '') +
          '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(discoveredSummary) + '</div>' +
        '</div>' +
      '</div>';
    });

    // Progress note
    if (remaining === 0 && confirmed > 0) {
      html += '<div style="background:rgba(6,95,70,0.1);border:1px solid rgba(6,95,70,0.2);border-radius:8px;padding:14px;margin-top:16px;font-size:0.85rem;">' +
        '✓ All items reviewed. Ask Claude to generate a cutover plan.</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  });
}

// ============================================================
// Migration Plan View
// ============================================================

// The migration onboarding flow (renderMigrationPlan / renderHistoricalOrders /
// renderMigrationImport + their guidance panels, CSV-import surfaces, and the
// completeMigration / triggerPostCutoverRerun / switchMigrationTab actions) is a
// coherent route-reached cluster extracted to app/modules/migration-plan.js
// (decomposition master plan §1, Track 1 — recipe B). It is lazy-loaded via the
// three eager route-setup shims below (ROUTE_MAP migration-plan / historical-
// orders / migration-import); the in-flow buttons are rendered by the module.
function renderMigrationPlan() {
  MastAdmin.loadModule('migrationPlan').then(function() {
    if (typeof window.renderMigrationPlanImpl === 'function') window.renderMigrationPlanImpl();
  }).catch(function() {});
}
function renderHistoricalOrders() {
  MastAdmin.loadModule('migrationPlan').then(function() {
    if (typeof window.renderHistoricalOrdersImpl === 'function') window.renderHistoricalOrdersImpl();
  }).catch(function() {});
}
function renderMigrationImport() {
  MastAdmin.loadModule('migrationPlan').then(function() {
    if (typeof window.renderMigrationImportImpl === 'function') window.renderMigrationImportImpl();
  }).catch(function() {});
}
