/**
 * Migration onboarding flow — the Migration Plan view, Historical Orders import
 * report, the cutover guidance panels (image-rehosting / integration / DNS /
 * payment), and the Data Import surfaces (subscriber + inventory CSV import).
 *
 * Extracted from app/index.html's inline block (decomposition master plan §1,
 * Track 1 — recipe B, a coherent route-reached cluster). The three entry points
 * (renderMigrationPlan / renderHistoricalOrders / renderMigrationImport) are
 * reached only through ROUTE_MAP setup callbacks (migration-plan / historical-
 * orders / migration-import routes); they are lazy-loaded via the eager
 * setup shims in index.html. The remaining functions are internal to this
 * cluster: renderImageRehostingProgress / renderIntegrationGuidance /
 * renderDNSGuidance / renderPaymentGuidance are synchronous HTML helpers called
 * only by renderMigrationPlan; renderSubscriberImport / renderInventoryImport
 * are driven by switchMigrationTab; completeMigration / triggerPostCutoverRerun /
 * switchMigrationTab are invoked from this module's own onclick markup. All logic
 * moved VERBATIM (behavior-preserving).
 *
 * Reads eager shell globals only (all defined before a user can route to a
 * migration surface): showMigrationSidebar, hideMigrationSidebar,
 * loadMigrationData, renderCSVImportUI, navigateTo, showToast, mastConfirm, esc,
 * MastDB, MastUI (Num money/moneyVal), firebase/auth, fetch. STEP_CATEGORY_ICONS
 * is cluster-internal.
 */
(function () {
  'use strict';

var STEP_CATEGORY_ICONS = { 'data-import': '&#128230;', payments: '&#128179;', dns: '&#127760;', review: '&#128270;', testing: '&#128295;' };

function renderMigrationPlan() {
  var container = document.getElementById('migrationPlanTab');
  if (!container) return;
  showMigrationSidebar();

  loadMigrationData(function(data) {
    if (!data || !data.plan || !data.plan.steps) {
      container.innerHTML = '<div style="max-width:700px;">' +
        '<h1 style="margin-top:0;">Cutover Plan</h1>' +
        '<p style="color:var(--warm-gray);">No plan generated yet. Confirm all items first, then ask Claude to generate a cutover plan.</p>' +
      '</div>';
      return;
    }

    var plan = data.plan;
    var steps = plan.steps;
    var stepIds = Object.keys(steps).sort(function(a, b) { return (steps[a].order || 0) - (steps[b].order || 0); });

    var completed = 0, inProgress = 0, blocked = 0, pending = 0;
    stepIds.forEach(function(id) {
      var s = steps[id].status;
      if (s === 'complete' || s === 'skipped') completed++;
      else if (s === 'in-progress') inProgress++;
      else if (s === 'blocked') blocked++;
      else pending++;
    });

    var html = '<div style="max-width:850px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<h1 style="margin:0;">Cutover Plan</h1>' +
        (data.status === 'paused' ? '<span class="status-badge" style="background:#f59e0b;color:white;font-size:0.78rem;">PAUSED</span>' : '') +
      '</div>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:20px;">Cutover date: <strong>' + esc(plan.cutoverDate) + '</strong></p>';

    // Progress bar
    var pct = stepIds.length > 0 ? Math.round((completed / stepIds.length) * 100) : 0;
    html += '<div style="margin-bottom:20px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">' +
        '<span>' + completed + ' of ' + stepIds.length + ' steps complete</span>' +
        '<span>' + pct + '%</span>' +
      '</div>' +
      '<div style="background:var(--surface-card-border,#e0e0e0);border-radius:4px;height:10px;overflow:hidden;">' +
        '<div style="background:var(--primary);height:100%;width:' + pct + '%;transition:width 0.5s;border-radius:4px;"></div>' +
      '</div>' +
    '</div>';

    // Summary chips
    html += '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;font-size:0.78rem;">';
    if (inProgress) html += '<span style="background:rgba(37,99,235,0.15);color:#2563eb;padding:4px 10px;border-radius:12px;">&#9654; ' + inProgress + ' in progress</span>';
    if (blocked) html += '<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:4px 10px;border-radius:12px;">&#9888; ' + blocked + ' blocked</span>';
    if (pending) html += '<span style="background:rgba(156,163,175,0.15);color:#6b7280;padding:4px 10px;border-radius:12px;">&#9898; ' + pending + ' pending</span>';
    html += '</div>';

    // Step list
    stepIds.forEach(function(id) {
      var step = steps[id];
      var catIcon = STEP_CATEGORY_ICONS[step.category] || '&#128196;';
      var statusIcon = '&#9898;';
      var statusColor = 'var(--warm-gray)';
      if (step.status === 'complete') { statusIcon = '&#9989;'; statusColor = '#16a34a'; }
      else if (step.status === 'skipped') { statusIcon = '&#10060;'; statusColor = '#9ca3af'; }
      else if (step.status === 'in-progress') { statusIcon = '&#9654;'; statusColor = '#2563eb'; }
      else if (step.status === 'blocked') { statusIcon = '&#9888;'; statusColor = '#ef4444'; }

      var depNames = [];
      if (step.dependsOn && step.dependsOn.length) {
        step.dependsOn.forEach(function(depId) {
          if (steps[depId]) depNames.push(steps[depId].name);
        });
      }

      html += '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-left:3px solid ' + statusColor + ';background:var(--surface-card,#f5f5f5);border-radius:0 8px 8px 0;margin-bottom:8px;">' +
        '<div style="font-size:1.15rem;flex-shrink:0;margin-top:2px;">' + statusIcon + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">' +
            '<strong style="font-size:0.9rem;">' + esc(step.name) + '</strong>' +
            (step.isGateCheck ? '<span style="font-size:0.72rem;background:rgba(124,58,237,0.15);color:#7c3aed;padding:2px 6px;border-radius:4px;">GATE</span>' : '') +
          '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">' +
            catIcon + ' ' + esc(step.category) + ' &middot; Target: ' + esc(step.targetDate || '—') +
            (step.completedAt ? ' &middot; Done: ' + esc(step.completedAt.split('T')[0]) : '') +
          '</div>' +
          (depNames.length ? '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">Depends on: ' + depNames.map(esc).join(', ') + '</div>' : '') +
          (step.notes ? '<div style="font-size:0.78rem;color:var(--text,#2a2a2a);margin-top:4px;font-style:italic;">' + esc(step.notes) + '</div>' : '') +
        '</div>' +
      '</div>';
    });

    // Execution guidance sections (visible during execution/post-cutover)
    if (data.status === 'execution' || data.status === 'post-cutover') {
      html += '<h2 style="margin-top:24px;font-size:1.15rem;">Execution Details</h2>';
      html += renderImageRehostingProgress(data);
      html += renderIntegrationGuidance(data);
      html += renderDNSGuidance(data);
      html += renderPaymentGuidance(data);
    }

    // Post-cutover checklist if in post-cutover phase
    if (data.postCutover) {
      html += '<h2 style="margin-top:24px;font-size:1.15rem;">Post-Cutover Checklist</h2>';

      if (data.postCutover.automatedChecks) {
        html += '<h3 style="font-size:0.9rem;color:var(--warm-gray);">Automated Checks</h3>';
        var checks = data.postCutover.automatedChecks;
        Object.keys(checks).forEach(function(key) {
          var check = checks[key];
          var icon = check.passed === true ? '&#9989;' : check.passed === false ? '&#10060;' : '&#9898;';
          html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:0.85rem;">' +
            icon + ' <span>' + esc(key) + '</span>' +
            (check.note ? '<span style="color:var(--warm-gray);font-size:0.78rem;"> — ' + esc(check.note) + '</span>' : '') +
          '</div>';
        });
      }

      if (data.postCutover.manualChecklist) {
        html += '<h3 style="font-size:0.9rem;color:var(--warm-gray);margin-top:12px;">Manual Verification</h3>';
        var manual = data.postCutover.manualChecklist;
        var manualLabels = { testOrder: 'Place a test order', paymentDeposit: 'Verify payment deposit', emailReceived: 'Confirm email arrived', mobileLoads: 'Check mobile site', externalVisit: 'Ask someone else to visit' };
        Object.keys(manual).forEach(function(key) {
          var item = manual[key];
          var icon = item.confirmed ? '&#9989;' : '&#9898;';
          html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:0.85rem;">' +
            icon + ' <span>' + esc(manualLabels[key] || key) + '</span>' +
            (item.confirmedAt ? '<span style="color:var(--warm-gray);font-size:0.72rem;margin-left:8px;">' + esc(item.confirmedAt.split('T')[0]) + '</span>' : '') +
          '</div>';
        });

        // Check if all manual items confirmed
        var allManualDone = Object.values(manual).every(function(i) { return i.confirmed; });
        if (allManualDone) {
          html += '<div style="background:rgba(6,95,70,0.1);border:1px solid rgba(6,95,70,0.2);border-radius:8px;padding:12px;margin-top:12px;font-size:0.85rem;">' +
            '&#10003; All manual checks confirmed!</div>';
        }
      }

      // Action buttons for post-cutover
      html += '<div style="display:flex;gap:10px;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="triggerPostCutoverRerun()" style="font-size:0.85rem;">&#128260; Re-run Automated Checks</button>';

      // Show Complete button only when all checks pass
      var autoChecks = data.postCutover.automatedChecks || {};
      var manualChecks = data.postCutover.manualChecklist || {};
      var allAutoPassed = Object.values(autoChecks).every(function(c) { return c.passed === true; });
      var allManualConfirmed = Object.values(manualChecks).every(function(c) { return c.confirmed; });
      if (allAutoPassed && allManualConfirmed) {
        html += '<button class="btn btn-primary" onclick="completeMigration()" style="font-size:0.85rem;">&#127881; Complete Migration</button>';
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  });
}

window.triggerPostCutoverRerun = function() {
  showToast('Re-running automated checks... This may take a moment.');
  // Call the Cloud Function
  var tenantId = MastDB.tenantId();
  if (!tenantId) return;
  var cfBase = (window.TENANT_FIREBASE_CONFIG && TENANT_FIREBASE_CONFIG.cloudFunctionsBase) || 'https://us-central1-mast-platform-prod.cloudfunctions.net';
  // SEC (audit 2026-06-01): attach the admin's Firebase ID token so the CF can authorize the caller.
  var _u = firebase.auth().currentUser;
  if (!_u) { showToast('Not signed in', true); return; }
  _u.getIdToken().then(function(idToken) {
    return fetch(cfBase + '/runPostCutoverChecks?tenantId=' + encodeURIComponent(tenantId), {
      headers: { 'Authorization': 'Bearer ' + idToken }
    });
  })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.success) {
        showToast('Checks complete. Refreshing...');
        renderMigrationPlan(); // Re-render with updated data
      } else {
        showToast('Check failed: ' + (result.error || 'Unknown error'), true);
      }
    })
    .catch(function(err) { showToast('Failed to run checks: ' + err.message, true); });
};

window.completeMigration = async function() {
  if (!MastDB.tenantId()) return;

  if (!await mastConfirm('Complete the migration? This will hide the Migration section from the sidebar.', { title: 'Complete Migration' })) return;

  // Update migration status to complete in tenant RTDB
  MastDB.set('admin/migration/status', 'complete').then(function() {
    showToast('Migration complete! Welcome to your new site.');
    hideMigrationSidebar();
    navigateTo('dashboard');
  }).catch(function(err) {
    showToast('Failed to complete migration: ' + err.message, true);
  });
};

// ============================================================
// Historical Order Archive View
// ============================================================

function renderHistoricalOrders() {
  var container = document.getElementById('historicalOrdersTab');
  if (!container) return;
  showMigrationSidebar();

  if (!MastDB.tenantId()) {
    container.innerHTML = '<p>Tenant not loaded.</p>';
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--warm-gray);">Loading past orders...</div>';

  MastDB.query('admin/historicalOrders').limitToLast(100).once().then(function(data) {
    if (!data || Object.keys(data).length === 0) {
      container.innerHTML = '<div style="max-width:800px;">' +
        '<h1 style="margin-top:0;">Past Orders</h1>' +
        '<p style="color:var(--warm-gray);">No historical orders imported yet. Use the Import Data tool or Claude to import orders from your previous platform.</p>' +
      '</div>';
      return;
    }

    var orders = [];
    Object.keys(data).forEach(function(key) {
      var o = data[key];
      o._id = key;
      orders.push(o);
    });
    orders.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

    // Search filter
    var html = '<div style="max-width:900px;">' +
      '<h1 style="margin-top:0;margin-bottom:4px;">Past Orders</h1>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:16px;">' + MastFormat.countNoun(orders.length, 'order') + ' imported from your previous platform</p>' +
      '<div style="margin-bottom:16px;">' +
        '<input type="text" id="histOrderSearch" placeholder="Search by name or email..." style="width:100%;max-width:320px;padding:8px 12px;border:1px solid var(--surface-card-border,#e0e0e0);border-radius:6px;font-size:0.85rem;background:var(--bg);color:var(--text,#2a2a2a);">' +
      '</div>';

    // Table
    html += '<div class="events-table data-table" style="margin-bottom:16px;">' +
      '<table><thead><tr>' +
        '<th>Order #</th><th>Date</th><th>Customer</th><th>Email</th><th>Items</th><th>Total</th><th>Source</th>' +
      '</tr></thead><tbody id="histOrderBody">';

    orders.forEach(function(o) {
      var itemsSummary = '';
      if (o.items && o.items.length) {
        itemsSummary = o.items.map(function(i) { return (i.qty || 1) + 'x ' + (i.name || 'item'); }).join(', ');
        if (itemsSummary.length > 50) itemsSummary = itemsSummary.slice(0, 47) + '...';
      }
      html += '<tr class="hist-order-row" data-search="' + esc((o.customerName || '') + ' ' + (o.email || '')).toLowerCase() + '">' +
        '<td style="font-family:monospace;font-size:0.78rem;">' + esc(o.orderNumber || o._id) + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(o.date || '—') + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(o.customerName || '—') + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(o.email || '—') + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(itemsSummary || '—') + '</td>' +
        '<td style="font-weight:500;">' + (window.MastUI.Num.money(window.MastUI.Num.moneyVal(o, 'totalCents', 'total')) || '—') + '</td>' +
        '<td><span class="status-badge" style="background:#7c3aed;color:white;font-size:0.72rem;">IMPORTED</span></td>' +
      '</tr>';
    });

    html += '</tbody></table></div></div>';
    container.innerHTML = html;

    // Wire up search
    var searchInput = document.getElementById('histOrderSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var query = searchInput.value.toLowerCase();
        var rows = document.querySelectorAll('.hist-order-row');
        rows.forEach(function(row) {
          var match = !query || (row.getAttribute('data-search') || '').indexOf(query) !== -1;
          row.style.display = match ? '' : 'none';
        });
      });
    }
  }).catch(function(err) {
    container.innerHTML = '<p style="color:#ef4444;">Failed to load orders: ' + esc(err.message) + '</p>';
  });
}

// ============================================================
// Execution Guidance Sections (rendered within Plan view during execution)
// ============================================================

function renderImageRehostingProgress(data) {
  if (!data || !data.execution || !data.execution.imageRehosting) return '';
  var r = data.execution.imageRehosting;
  var total = r.total || 0;
  var uploaded = r.uploaded || 0;
  var failed = r.failed || 0;
  var pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  var statusLabel = r.status === 'complete' ? 'Complete' : r.status === 'processing' ? 'Processing...' : r.status === 'started' ? 'Starting...' : 'Not started';
  var statusColor = r.status === 'complete' ? '#16a34a' : r.status === 'processing' ? '#2563eb' : '#9ca3af';

  var html = '<div style="background:var(--surface-card,#f5f5f5);border:1px solid var(--surface-card-border,#e0e0e0);border-radius:10px;padding:18px;margin-bottom:16px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
      '<h3 style="margin:0;font-size:0.9rem;">&#128247; Image Re-hosting</h3>' +
      '<span style="font-size:0.78rem;color:' + statusColor + ';font-weight:500;">' + statusLabel + '</span>' +
    '</div>' +
    '<div style="background:var(--surface-card-border,#e0e0e0);border-radius:4px;height:12px;overflow:hidden;margin-bottom:8px;">' +
      '<div style="background:var(--primary);height:100%;width:' + pct + '%;transition:width 0.5s;border-radius:4px;"></div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--warm-gray);">' +
      '<span>' + uploaded + ' / ' + total + ' uploaded</span>' +
      (failed > 0 ? '<span style="color:#ef4444;">' + failed + ' failed</span>' : '') +
      '<span>' + pct + '%</span>' +
    '</div>';

  if (r.failedUrls && r.failedUrls.length > 0) {
    html += '<details style="margin-top:10px;font-size:0.78rem;"><summary style="cursor:pointer;color:var(--warm-gray);">Failed URLs (' + r.failedUrls.length + ')</summary>' +
      '<div style="margin-top:6px;max-height:120px;overflow-y:auto;">';
    r.failedUrls.forEach(function(url) {
      html += '<div style="font-family:monospace;font-size:0.72rem;color:#ef4444;padding:2px 0;word-break:break-all;">' + esc(url) + '</div>';
    });
    html += '</div></details>';
  }

  html += '</div>';
  return html;
}

function renderDNSGuidance(data) {
  if (!data || !data.discovery || !data.discovery.domain) return '';
  var domain = data.discovery.domain;
  var name = domain.name || '';
  if (!name) return '';

  var html = '<div style="background:var(--surface-card,#f5f5f5);border:1px solid var(--surface-card-border,#e0e0e0);border-radius:10px;padding:18px;margin-bottom:16px;">' +
    '<h3 style="margin:0 0 10px;font-size:0.9rem;">&#127760; DNS Cutover — ' + esc(name) + '</h3>';

  if (domain.platformHosted) {
    html += '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:6px;padding:10px;font-size:0.85rem;margin-bottom:12px;">' +
      '&#9888; This domain appears to be hosted by your current platform. You may need to transfer the domain or update nameservers. Allow 5-7 days for DNS propagation.</div>';
  }

  html += '<div style="font-size:0.85rem;">' +
    '<p style="margin:0 0 8px;"><strong>Step 1:</strong> Lower your DNS TTL to 300 seconds (5 minutes) at least 3 days before cutover.</p>' +
    '<p style="margin:0 0 8px;"><strong>Step 2:</strong> Update your DNS records to point to Firebase Hosting:</p>' +
    '<div style="background:var(--bg);border:1px solid var(--surface-card-border,#e0e0e0);border-radius:6px;padding:10px;font-family:monospace;font-size:0.78rem;margin-bottom:8px;">' +
      'A record: ' + esc(name) + ' → 199.36.158.100<br>' +
      'TXT record: ' + esc(name) + ' → hosting-site=mast-{tenantId}<br>' +
      (domain.mxRecords ? '<div style="margin-top:6px;color:#f59e0b;">&#9888; MX records detected — do NOT change MX records or email will break.</div>' : '') +
    '</div>' +
    '<p style="margin:0 0 8px;"><strong>Step 3:</strong> After DNS propagates, register the domain in Mast via Settings > Domain.</p>' +
    '<p style="margin:0;"><strong>Step 4:</strong> Verify SSL certificate is active (may take up to 24 hours).</p>' +
  '</div></div>';

  return html;
}

var INTEGRATION_GUIDANCE = {
  square: { name: 'Square', supported: true, route: 'settings', settingsLabel: 'Payments', steps: 'Get your production access token from Square Developer Dashboard and paste it in Settings > Payments.' },
  resend: { name: 'Resend', supported: true, route: 'settings', settingsLabel: 'Email', steps: 'Generate an API key in your Resend dashboard and add it under Settings > Email.' },
  gmail: { name: 'Gmail', supported: true, route: 'settings', settingsLabel: 'Email', steps: 'Use the OAuth flow in Settings > Email to connect your Gmail account.' },
  sendgrid: { name: 'SendGrid', supported: true, route: 'settings', settingsLabel: 'Email', steps: 'Get your API key from SendGrid and paste it in Settings > Email.' },
  pirateship: { name: 'Pirate Ship', supported: true, route: 'settings', settingsLabel: 'Shipping', steps: 'Connect your Pirate Ship account in Settings > Shipping for label printing.' },
  shippo: { name: 'Shippo', supported: true, route: 'settings', settingsLabel: 'Shipping', steps: 'Generate a Shippo API token and add it in Settings > Shipping.' },
  mailchimp: { name: 'Mailchimp', supported: false, message: 'Mailchimp is not directly supported. Export your subscribers as CSV and use the Import Data tool.' },
  shipstation: { name: 'ShipStation', supported: false, message: 'ShipStation is not directly supported. Use Pirate Ship or Shippo for shipping label management.' },
  klaviyo: { name: 'Klaviyo', supported: false, message: 'Klaviyo is not directly supported. Export subscribers as CSV and use the Import Data tool.' }
};

function renderIntegrationGuidance(data) {
  if (!data || !data.discovery || !data.discovery.integrations) return '';
  var detected = data.discovery.integrations.detected;
  if (!Array.isArray(detected) || detected.length === 0) return '';

  var html = '<div style="background:var(--surface-card,#f5f5f5);border:1px solid var(--surface-card-border,#e0e0e0);border-radius:10px;padding:18px;margin-bottom:16px;">' +
    '<h3 style="margin:0 0 10px;font-size:0.9rem;">&#128268; Integration Reconnection</h3>' +
    '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">We detected these integrations on your old site. Reconnect each one in your Mast settings.</p>';

  detected.forEach(function(intKey) {
    var key = String(intKey).toLowerCase();
    var info = INTEGRATION_GUIDANCE[key] || { name: intKey, supported: false, message: 'No automated reconnection available — you may need to set this up manually.' };

    if (info.supported) {
      html += '<div style="border-left:3px solid #16a34a;padding:10px 14px;background:var(--bg);border-radius:0 6px 6px 0;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
          '<strong style="font-size:0.9rem;">' + esc(info.name) + '</strong>' +
          '<span class="status-badge" style="background:#16a34a;color:white;font-size:0.72rem;">SUPPORTED</span>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">' + esc(info.steps) + '</div>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="navigateTo(\'' + esc(info.route) + '\')">Open ' + esc(info.settingsLabel) + ' Settings</button>' +
      '</div>';
    } else {
      html += '<div style="border-left:3px solid #f59e0b;padding:10px 14px;background:var(--bg);border-radius:0 6px 6px 0;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
          '<strong style="font-size:0.9rem;">' + esc(info.name) + '</strong>' +
          '<span class="status-badge" style="background:#f59e0b;color:white;font-size:0.72rem;">MANUAL</span>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(info.message) + '</div>' +
      '</div>';
    }
  });

  html += '</div>';
  return html;
}

function renderPaymentGuidance(data) {
  if (!data || !data.discovery || !data.discovery.payments) return '';
  var payments = data.discovery.payments;
  if (!payments.detected) return '';

  var provider = payments.provider || 'your payment processor';

  var html = '<div style="background:var(--surface-card,#f5f5f5);border:1px solid var(--surface-card-border,#e0e0e0);border-radius:10px;padding:18px;margin-bottom:16px;">' +
    '<h3 style="margin:0 0 10px;font-size:0.9rem;">&#128179; Payment Activation</h3>' +
    '<div style="font-size:0.85rem;">' +
      '<p style="margin:0 0 8px;"><strong>Current processor:</strong> ' + esc(provider) + '</p>' +
      '<p style="margin:0 0 8px;"><strong>Step 1:</strong> Go to <a href="#" onclick="navigateTo(\'settings\');return false;" style="color:var(--primary);">Settings</a> > Payments and enter your production API keys.</p>' +
      '<p style="margin:0 0 8px;"><strong>Step 2:</strong> Enable payments in your Mast admin.</p>' +
      '<p style="margin:0 0 8px;"><strong>Step 3:</strong> Place a small test order and verify:</p>' +
      '<ul style="margin:0 0 8px;padding-left:20px;font-size:0.85rem;">' +
        '<li>Order appears in your Mast admin</li>' +
        '<li>Payment shows in your ' + esc(provider) + ' dashboard</li>' +
        '<li>Confirmation email is sent</li>' +
        '<li>Refund the test order</li>' +
      '</ul>' +
      '<p style="margin:0;color:var(--warm-gray);font-size:0.78rem;">This test transaction must succeed before DNS cutover.</p>' +
    '</div></div>';

  return html;
}

// ============================================================
// Migration Import View (from Session 2)
// ============================================================

function renderMigrationImport() {
  var container = document.getElementById('migrationImportTab');
  if (!container) return;

  showMigrationSidebar();

  var tenantId = MastDB.tenantId();
  if (!tenantId) {
    container.innerHTML = '<p>Tenant not loaded.</p>';
    return;
  }

  container.innerHTML = '<div style="max-width:960px;">' +
    '<h1 style="margin-top:0;margin-bottom:4px;">Data Import</h1>' +
    '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:24px;">Import data from your previous platform into Mast. Upload CSV or TSV files exported from Squarespace, Shopify, or other platforms.</p>' +

    // Tab switcher
    '<div style="display:flex;gap:8px;margin-bottom:24px;">' +
      '<button class="btn btn-secondary" id="migTabSubscribers" onclick="switchMigrationTab(\'subscribers\')" style="font-size:0.85rem;">Email Subscribers</button>' +
      '<button class="btn btn-secondary" id="migTabInventory" onclick="switchMigrationTab(\'inventory\')" style="font-size:0.85rem;">Inventory</button>' +
    '</div>' +

    '<div id="migrationSubscribersPane"></div>' +
    '<div id="migrationInventoryPane" style="display:none;"></div>' +
  '</div>';

  switchMigrationTab('subscribers');
}

window.switchMigrationTab = function(tab) {
  var subsPane = document.getElementById('migrationSubscribersPane');
  var invPane = document.getElementById('migrationInventoryPane');
  var subsBtn = document.getElementById('migTabSubscribers');
  var invBtn = document.getElementById('migTabInventory');

  if (subsPane) subsPane.style.display = tab === 'subscribers' ? 'block' : 'none';
  if (invPane) invPane.style.display = tab === 'inventory' ? 'block' : 'none';
  if (subsBtn) { subsBtn.className = tab === 'subscribers' ? 'btn btn-primary' : 'btn btn-secondary'; }
  if (invBtn) { invBtn.className = tab === 'inventory' ? 'btn btn-primary' : 'btn btn-secondary'; }

  if (tab === 'subscribers') renderSubscriberImport();
  if (tab === 'inventory') renderInventoryImport();
};

function renderSubscriberImport() {
  var tenantId = MastDB.tenantId();
  renderCSVImportUI({
    containerId: 'migrationSubscribersPane',
    title: 'Import Email Subscribers',
    description: 'Upload a CSV of email subscribers from your previous platform. Duplicates (matching email) will be skipped.',
    columnPatterns: {
      'email': [/^e-?mail$/i, /^email.?address$/i, /^subscriber.?email$/i],
      'name': [/^name$/i, /^full.?name$/i, /^subscriber.?name$/i, /^first.?name$/i],
      'firstName': [/^first.?name$/i, /^given.?name$/i],
      'lastName': [/^last.?name$/i, /^surname$/i, /^family.?name$/i]
    },
    requiredFields: ['email'],
    onImport: function(rows) {
      return new Promise(function(resolve, reject) {
        if (!MastDB.tenantId()) return reject(new Error('Database not available'));

        // Read existing subscribers to dedup
        MastDB.get('newsletter/subscribers').then(function(subsMap) {
          var existing = new Set();
          if (subsMap) {
            Object.values(subsMap).forEach(function(sub) {
              if (sub.email) existing.add(sub.email.toLowerCase());
            });
          }

          var updates = {};
          var imported = 0;
          var skipped = 0;
          var now = new Date().toISOString();

          rows.forEach(function(row) {
            var email = (row.email || '').trim().toLowerCase();
            if (!email || !/\S+@\S+\.\S+/.test(email)) { skipped++; return; }
            if (existing.has(email)) { skipped++; return; }

            var name = row.name || '';
            if (!name && (row.firstName || row.lastName)) {
              name = ((row.firstName || '') + ' ' + (row.lastName || '')).trim();
            }

            var key = MastDB.newKey('newsletter/subscribers');
            updates['newsletter/subscribers/' + key] = {
              email: email,
              name: name || null,
              source: 'migrated',
              subscribedAt: now
            };
            existing.add(email);
            imported++;
          });

          if (Object.keys(updates).length === 0) {
            return resolve({ imported: 0, skipped: skipped, message: 'No new subscribers to import.' });
          }

          MastDB.multiUpdate(updates).then(function() {
            resolve({ imported: imported, skipped: skipped });
          }).catch(reject);
        }).catch(reject);
      });
    }
  });
}

function renderInventoryImport() {
  var tenantId = MastDB.tenantId();
  renderCSVImportUI({
    containerId: 'migrationInventoryPane',
    title: 'Import Inventory Counts',
    description: 'Upload a CSV with product names or SKUs and stock quantities. Products will be matched by name or SKU and inventory updated.',
    columnPatterns: {
      'name': [/^product.?name$/i, /^name$/i, /^title$/i, /^item$/i],
      'sku': [/^sku$/i, /^product.?sku$/i, /^item.?sku$/i, /^variant.?sku$/i],
      'quantity': [/^qty$/i, /^quantity$/i, /^stock$/i, /^on.?hand$/i, /^count$/i, /^inventory$/i, /^available$/i]
    },
    requiredFields: ['quantity'],
    onImport: function(rows) {
      return new Promise(function(resolve, reject) {
        if (!MastDB.tenantId()) return reject(new Error('Database not available'));

        // Load all products for matching
        MastDB.get('products').then(function(products) {
          if (!products) return resolve({ imported: 0, errors: 0, message: 'No products found to match against.' });

          // Build lookup maps
          var byName = {};
          var bySku = {};
          Object.keys(products).forEach(function(pid) {
            var p = products[pid];
            if (p.name) byName[p.name.toLowerCase().trim()] = pid;
            if (p.sku) bySku[p.sku.toLowerCase().trim()] = pid;
          });

          var updates = {};
          var imported = 0;
          var errors = 0;
          var now = new Date().toISOString();

          rows.forEach(function(row) {
            var qty = parseInt(row.quantity, 10);
            if (isNaN(qty) || qty < 0) { errors++; return; }

            // Try to match by SKU first, then by name
            var pid = null;
            if (row.sku) pid = bySku[row.sku.toLowerCase().trim()];
            if (!pid && row.name) pid = byName[row.name.toLowerCase().trim()];

            if (!pid) { errors++; return; }

            // Update inventory — set onHand count
            updates['admin/inventory/' + pid + '/onHand'] = qty;
            updates['admin/inventory/' + pid + '/lastUpdated'] = now;
            updates['admin/inventory/' + pid + '/lastUpdateSource'] = 'csv-import';
            imported++;
          });

          if (Object.keys(updates).length === 0) {
            return resolve({ imported: 0, errors: errors, message: errors ? errors + ' rows could not be matched to products.' : 'Nothing to import.' });
          }

          MastDB.multiUpdate(updates).then(function() {
            resolve({ imported: imported, errors: errors });
          }).catch(reject);
        }).catch(reject);
      });
    }
  });
}

  // Impls for the eager route-setup shims (ROUTE_MAP migration-plan /
  // historical-orders / migration-import) — *Impl suffix so the shim name and
  // the export never collide.
  window.renderMigrationPlanImpl = renderMigrationPlan;
  window.renderHistoricalOrdersImpl = renderHistoricalOrders;
  window.renderMigrationImportImpl = renderMigrationImport;

  // switchMigrationTab / completeMigration / triggerPostCutoverRerun are already
  // assigned to window.* in the verbatim body above (they were `window.X =
  // function(){}` in the shell), so the onclick markup this module renders
  // resolves them directly — no re-export needed here.

  // Cluster-internal helpers (window-exported for cross-references within the
  // module / the onclick targets it renders).
  window.renderSubscriberImport = renderSubscriberImport;
  window.renderInventoryImport = renderInventoryImport;
  window.renderImageRehostingProgress = renderImageRehostingProgress;
  window.renderIntegrationGuidance = renderIntegrationGuidance;
  window.renderDNSGuidance = renderDNSGuidance;
  window.renderPaymentGuidance = renderPaymentGuidance;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('migrationPlan', {});
  }
})();
