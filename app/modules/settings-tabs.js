/**
 * settings-tabs.js — the Settings page tab controllers: the switch*Tab() strip
 * switchers + refresh*TabStatus() status-dot updaters for every Settings section
 * (Integrations, General, Display, Email, Notifications, PIM, Payments, Shipping,
 * Operations, Tax, Compliance, Channels, Domains, Workshop, Trips, AI, QBO).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the inline <script> for the T1 decomposition.
 * Top-level scope preserved, so every switch-Tab / refresh-TabStatus stays a window global; all
 * are invoked POST-LOAD (onclick="switch*Tab(...)" in the settings markup + route
 * setup fns + loadPimSettings), so the deferred load order is safe. loadPimSettings
 * and the __pimActiveTab / __mastDriftQueue* state stay in index.html.
 */

// Settings → Integrations: tab-strip switcher (Google Maps / Etsy / Shopify / QuickBooks / Plaid)
function switchIntegrationsTab(tab) {
  window.__integrationsActiveTab = tab;
  var sections = {
    googleMaps: 'googleMapsIntegrationSection',
    etsy: 'etsyIntegrationSection',
    shopify: 'shopifyIntegrationSection',
    qbo: 'qboIntegrationSection',
    plaid: 'plaidBanksSection'
  };
  Object.keys(sections).forEach(function(t) {
    var el = document.getElementById(sections[t]);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#integrationsTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Lazy-hydrate the consolidated QBO inner panel when its tab becomes active.
  if (tab === 'qbo' && typeof switchQboInnerTab === 'function') {
    switchQboInnerTab(window.__qboInnerActiveTab || 'connection');
  }
}
window.switchIntegrationsTab = switchIntegrationsTab;

// ── Settings → Storefront → General: tabbed view (canonical view-tabs pattern).
// Each item in General is its own tab so the page can't become a long undifferentiated list.
var GENERAL_TABS = ['businessSetup','githubPat','siteVisibility','activePages','featurePages','homepageEvents','publicFeedback'];

function switchGeneralTab(tab) {
  window.__generalActiveTab = tab;
  GENERAL_TABS.forEach(function(t) {
    var body = document.getElementById('genTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#generalTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchGeneralTab = switchGeneralTab;

// Hide tabs that don't apply to this tenant (GitHub PAT, Feature pages).
// Called from settings init and whenever the underlying gating changes.
function applyGeneralTabGating() {
  // GitHub PAT tab — only when image storage backend is GitHub OR repo is configured.
  var patBtn = document.getElementById('genTabBtn-githubPat');
  if (patBtn) {
    var showPat = false;
    try {
      showPat = (typeof getImageStorageBackend === 'function' && getImageStorageBackend() === 'github')
        || !!(window.TENANT_CONFIG && TENANT_CONFIG.site && TENANT_CONFIG.site.github && TENANT_CONFIG.site.github.repo);
    } catch (e) {}
    patBtn.style.display = showPat ? '' : 'none';
  }
  // Feature pages tab — visibility mirrors the underlying #featurePagesTogglePanel (set by loadActiveMastPages).
  var fpBtn = document.getElementById('genTabBtn-featurePages');
  var fpPanel = document.getElementById('featurePagesTogglePanel');
  if (fpBtn && fpPanel) {
    fpBtn.style.display = (fpPanel.style.display === 'none' || !fpPanel.style.display) ? 'none' : '';
    // The panel itself lives inside the tab body — it should always render when the tab is shown.
    if (fpBtn.style.display !== 'none') fpPanel.style.display = '';
  }
  // If the currently active tab is now hidden, fall back to Business setup.
  var active = window.__generalActiveTab || 'businessSetup';
  var activeBtn = document.getElementById('genTabBtn-' + active);
  if (!activeBtn || activeBtn.style.display === 'none') switchGeneralTab('businessSetup');
}
window.applyGeneralTabGating = applyGeneralTabGating;

// Re-read state and update the dot + section pill for each General tab.
// Safe to call repeatedly; cheap.
function refreshGeneralTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('genTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('genStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }

  // businessSetup — always Active (tenant has a business type set).
  setDot('businessSetup', 'ok');

  // githubPat — green when a token is vaulted, red if not. The token no longer
  // lives in the browser; _githubVaultCollected is set by the MastIntake status
  // probe in updateGitHubTokenStatus(). Tab may be hidden via applyGeneralTabGating.
  var hasToken = !!(typeof _githubVaultCollected !== 'undefined' && _githubVaultCollected);
  setDot('githubPat', hasToken ? 'ok' : 'missing');
  setPill('githubPat', hasToken ? 'ok' : 'missing', hasToken ? 'Configured' : 'Not configured');

  // siteVisibility — reflect current value.
  var pubEl = document.getElementById('visibilityPublic');
  var isPublic = !!(pubEl && pubEl.checked);
  setDot('siteVisibility', 'ok');
  setPill('siteVisibility', 'ok', isPublic ? 'Public' : 'Private');

  // activePages — informational.
  setDot('activePages', 'info');

  // featurePages — green if any toggles are checked, amber otherwise. Tab may be hidden.
  var fpChecked = document.querySelectorAll('#featurePageToggles input[type="checkbox"]:checked').length;
  var fpTotal = document.querySelectorAll('#featurePageToggles input[type="checkbox"]').length;
  setDot('featurePages', fpChecked > 0 ? 'ok' : 'partial');
  setPill('featurePages', fpChecked > 0 ? 'ok' : 'partial', fpTotal ? (fpChecked + ' of ' + fpTotal + ' enabled') : 'Pick pages');

  // homepageEvents — value pill.
  var evInput = document.getElementById('eventsCountInput');
  var evVal = evInput && evInput.value ? parseInt(evInput.value, 10) : 3;
  setDot('homepageEvents', 'ok');
  setPill('homepageEvents', 'ok', evVal + (evVal === 1 ? ' event' : ' events'));

  // Boolean toggles — dot amber/none, pill On/Off.
  function syncToggle(tabKey, inputId) {
    var input = document.getElementById(inputId);
    var on = !!(input && input.checked);
    setDot(tabKey, on ? 'partial' : 'none');
    setPill(tabKey, on ? 'partial' : 'none', on ? 'On' : 'Off');
  }
  // Public-site toggle (the others — Dark mode / Error reporting / Testing mode —
  // moved to Settings → Admin Site → Preferences in commit 38ad85a follow-up).
  syncToggle('publicFeedback', 'publicFeedbackToggle');
}
window.refreshGeneralTabStatus = refreshGeneralTabStatus;

// ── Settings → Storefront → Display: tabbed view.
var DISPLAY_TABS = ['leadTime','commissionCta','badges','legal'];

function switchDisplayTab(tab) {
  window.__displayActiveTab = tab;
  DISPLAY_TABS.forEach(function(t) {
    var body = document.getElementById('displayTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#displayTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchDisplayTab = switchDisplayTab;

function refreshDisplayTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('displayTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('displayStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Lead time + Commission CTA — On/Off toggles.
  var leadOn = !!(document.getElementById('sdShowLeadTime') && document.getElementById('sdShowLeadTime').checked);
  setDot('leadTime', leadOn ? 'partial' : 'none');
  setPill('leadTime', leadOn ? 'partial' : 'none', leadOn ? 'On' : 'Off');
  var ctaOn = !!(document.getElementById('sdShowCommissionCTA') && document.getElementById('sdShowCommissionCTA').checked);
  setDot('commissionCta', ctaOn ? 'partial' : 'none');
  setPill('commissionCta', ctaOn ? 'partial' : 'none', ctaOn ? 'On' : 'Off');
  // Badges — customized if any badge input has a non-empty value.
  var badgeIds = ['sdBadgeDiscontinuedInStock','sdBadgeDiscontinuedSold','sdBadgeMadeToOrder','sdBadgeLowStock'];
  var badgeCustom = badgeIds.some(function(id) { var el = document.getElementById(id); return el && el.value && el.value.trim(); });
  setDot('badges', badgeCustom ? 'ok' : 'info');
  setPill('badges', badgeCustom ? 'ok' : 'info', badgeCustom ? 'Customized' : 'Defaults');
  // Legal — customized if any URL input non-empty.
  var legalIds = ['sdCustomPrivacyUrl','sdCustomTermsUrl','sdCustomSecurityUrl','sdCustomAiUrl'];
  var legalCount = legalIds.reduce(function(n, id) { var el = document.getElementById(id); return n + ((el && el.value && el.value.trim()) ? 1 : 0); }, 0);
  setDot('legal', legalCount > 0 ? 'ok' : 'info');
  setPill('legal', legalCount > 0 ? 'ok' : 'info', legalCount > 0 ? (legalCount + ' override' + (legalCount === 1 ? '' : 's')) : 'Mast defaults');
}
window.refreshDisplayTabStatus = refreshDisplayTabStatus;

// ── Settings → Email: provider + triggers status pills.
function refreshEmailTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('emailInnerTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('emailInnerStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Provider tab — configured if a provider is selected with required fields, or Mast-managed is the default.
  var provEl = document.getElementById('emailProvider');
  var prov = provEl ? (provEl.value || '') : '';
  var fromEl = document.getElementById('emailFromEmail');
  var hasFrom = !!(fromEl && fromEl.value && fromEl.value.trim());
  var providerState = 'info';
  var providerLabel = 'Mast-managed';
  if (prov === '') { providerState = 'ok'; providerLabel = 'Mast-managed'; }
  else if (prov === 'gmail') { providerState = hasFrom ? 'ok' : 'partial'; providerLabel = 'Gmail' + (hasFrom ? '' : ' — incomplete'); }
  else if (prov === 'sendgrid') { var ok = !!_sendgridVaultCollected; providerState = ok ? 'ok' : 'missing'; providerLabel = 'SendGrid' + (ok ? '' : ' — key missing'); }
  else if (prov === 'resend') { var re = document.getElementById('emailResendApiKey'); var ok2 = !!(re && re.value); providerState = ok2 ? 'ok' : 'partial'; providerLabel = 'Resend' + (ok2 ? '' : ' — key needed'); }
  else if (prov === 'custom') { var ce = document.getElementById('emailCustomEndpoint'); var ck = document.getElementById('emailCustomApiKey'); var okc = !!(ce && ce.value) && !!(ck && ck.value); providerState = okc ? 'ok' : 'partial'; providerLabel = 'Custom' + (okc ? '' : ' — incomplete'); }
  setDot('provider', providerState);
  setPill('provider', providerState, providerLabel);
  // Triggers tab — defaults unless preferences have been saved.
  var prefs = (typeof emailTriggerPrefs === 'object' && emailTriggerPrefs) ? emailTriggerPrefs : {};
  var customCount = Object.keys(prefs).length;
  setDot('triggers', customCount > 0 ? 'ok' : 'info');
  setPill('triggers', customCount > 0 ? 'ok' : 'info', customCount > 0 ? (customCount + ' customized') : 'Defaults');
}
window.refreshEmailTabStatus = refreshEmailTabStatus;

// ── Settings → Notifications: alerts / history / renewals / toasts.
function refreshNotifTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('notifInnerTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('notifInnerStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Alerts — informational/default.
  setDot('alerts', 'info');
  setPill('alerts', 'info', 'Configured');
  // History — read-only.
  setDot('history', 'info');
  setPill('history', 'info', 'Read-only');
  // Renewals — partial if any channel enabled.
  var emailCb = document.getElementById('renewalsChannelEmail');
  var inAppCb = document.getElementById('renewalsChannelInApp');
  var on = (emailCb && emailCb.checked) || (inAppCb && inAppCb.checked);
  setDot('renewals', on ? 'ok' : 'none');
  setPill('renewals', on ? 'ok' : 'none', on ? 'On' : 'Off');
  // Toasts — per device.
  setDot('toasts', 'info');
  setPill('toasts', 'info', 'Per device');
}
window.refreshNotifTabStatus = refreshNotifTabStatus;

// ── Settings → PIM: drift queue / sync log / testing / rules.
function refreshPimTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('pimTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('pimStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  setDot('drift', 'info');
  setPill('drift', 'info', 'Open queue');
  setDot('sync', 'info');
  setPill('sync', 'info', 'Read-only');
  setDot('testing', 'info');
  setPill('testing', 'info', 'Dev tools');
  setDot('rules', 'info');
  setPill('rules', 'info', 'Defaults');
}
window.refreshPimTabStatus = refreshPimTabStatus;

// ── Settings → Selling → Payments: single-page (selector-driven; section header + pill at top).
function refreshPaymentsTabStatus() {
  var pill = document.getElementById('paymentsStatusPill');
  if (!pill) return;
  var processor = 'Square';
  try {
    var badgeName = document.getElementById('ppBadgeName');
    if (badgeName && badgeName.textContent) processor = badgeName.textContent.trim() || 'Square';
  } catch (e) {}
  pill.setAttribute('data-state', 'ok');
  pill.textContent = 'Active: ' + processor;
  // Per-credential pills.
  function setPill(id, state, label) {
    var el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('data-state', state);
    el.textContent = label;
  }
  // Square access tokens live in the vault now — read the cached collected state
  // (either env), mirroring the Stripe secret-key pill below.
  var hasSquare = !!_squareVaultCollected;
  setPill('paymentsStatusSquare', hasSquare ? 'ok' : 'missing', hasSquare ? 'Configured' : 'Not configured');
  // Stripe secret key lives in the vault now — read its cached collected state.
  var hasStripe = !!_stripeVaultCollected;
  setPill('paymentsStatusStripe', hasStripe ? 'ok' : 'missing', hasStripe ? 'Configured' : 'Not configured');
}
window.refreshPaymentsTabStatus = refreshPaymentsTabStatus;

// ── Settings → Selling → Shipping: 2 tabs (Label provider + Rules).
var SHIPPING_TABS = ['provider','rules'];
function switchShippingTab(tab) {
  window.__shippingActiveTab = tab;
  SHIPPING_TABS.forEach(function(t) {
    var body = document.getElementById('shippingTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#shippingTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchShippingTab = switchShippingTab;

function refreshShippingTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('shippingTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('shippingStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Provider — green if a non-manual provider is selected (Shippo), gray if manual, red if Shippo selected without a key.
  var shippoRadio = document.getElementById('shipProviderShippo');
  var manualRadio = document.getElementById('shipProviderManual');
  var hasKey = !!_shippoVaultCollected; // vault-backed (key never lives in the DOM)
  if (shippoRadio && shippoRadio.checked) {
    setDot('provider', hasKey ? 'ok' : 'missing');
    setPill('provider', hasKey ? 'ok' : 'missing', hasKey ? 'Shippo' : 'Shippo (no key)');
  } else if (manualRadio && manualRadio.checked) {
    setDot('provider', 'info');
    setPill('provider', 'info', 'Manual');
  } else {
    setDot('provider', 'none');
    setPill('provider', 'info', 'Not set');
  }
  // Rules — informational.
  var retail = document.getElementById('shipRetailStrategy');
  var wholesale = document.getElementById('shipWholesaleStrategy');
  if (retail || wholesale) {
    setDot('rules', 'ok');
    setPill('rules', 'ok', 'Configured');
  } else {
    setDot('rules', 'info');
    setPill('rules', 'info', 'Defaults');
  }
}
window.refreshShippingTabStatus = refreshShippingTabStatus;

// ── Settings → Selling → Operations: 3 tabs (Fulfillment + Service area + Locale & time).
var OPERATIONS_TABS = ['fulfillment','serviceArea','locale'];
function switchOperationsTab(tab) {
  window.__operationsActiveTab = tab;
  OPERATIONS_TABS.forEach(function(t) {
    var body = document.getElementById('operationsTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#operationsTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchOperationsTab = switchOperationsTab;

function refreshOperationsTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('operationsTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('operationsStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Fulfillment — count rows rendered in the list.
  var fList = document.getElementById('operationsFulfillmentList');
  var fCount = fList ? fList.querySelectorAll('[data-fulfillment-row], .fulfillment-row, .op-row, tr, .form-row').length : 0;
  // Fallback: just child count if no row class matched.
  if (fList && !fCount) fCount = fList.children.length;
  if (fCount > 0) {
    setDot('fulfillment', 'ok');
    setPill('fulfillment', 'ok', fCount + (fCount === 1 ? ' mode' : ' modes'));
  } else {
    setDot('fulfillment', 'partial');
    setPill('fulfillment', 'partial', 'None set');
  }
  // Service area — green if a coverage type segment is selected.
  var saRow = document.getElementById('operationsServiceAreaTypeRow');
  var hasSa = !!(saRow && saRow.querySelector('.active, [aria-pressed="true"], .selected'));
  setDot('serviceArea', hasSa ? 'ok' : 'info');
  setPill('serviceArea', hasSa ? 'ok' : 'info', hasSa ? 'Configured' : 'Not set');
  // Locale & time — show timezone value if selected.
  var tz = document.getElementById('operationsTimezoneSelect');
  var tzVal = tz && tz.value;
  setDot('locale', tzVal ? 'ok' : 'info');
  setPill('locale', tzVal ? 'ok' : 'info', tzVal || 'Defaults');
}
window.refreshOperationsTabStatus = refreshOperationsTabStatus;

// ── Settings → Tax & Legal: 2 tabs (Identity & EIN + Sales tax).
var TAX_TABS = ['identity','salesTax'];
function switchTaxTab(tab) {
  window.__taxActiveTab = tab;
  TAX_TABS.forEach(function(t) {
    var body = document.getElementById('taxTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#taxTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchTaxTab = switchTaxTab;

function refreshTaxTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('taxTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('taxStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Identity & EIN — green if EIN or legal name set; gray otherwise.
  var nameEl = document.getElementById('taxLegalName');
  var einEl = document.getElementById('taxLegalEin');
  var hasName = !!(nameEl && nameEl.value && nameEl.value.trim());
  var hasEin = !!(einEl && einEl.value && einEl.value.trim());
  if (hasName && hasEin) {
    setDot('identity', 'ok');
    setPill('identity', 'ok', 'Configured');
  } else if (hasName || hasEin) {
    setDot('identity', 'partial');
    setPill('identity', 'partial', hasEin ? 'EIN set' : 'Name set');
  } else {
    setDot('identity', 'info');
    setPill('identity', 'info', 'Optional');
  }
  // Sales tax — count non-zero rate rows in the table; gray if defaults.
  var body = document.getElementById('taxRatesTableBody');
  var rows = body ? body.querySelectorAll('input[data-state]') : [];
  var count = 0;
  rows.forEach(function(inp) { var v = parseFloat(inp.value); if (!isNaN(v) && v > 0) count++; });
  if (count > 0) {
    setDot('salesTax', 'ok');
    setPill('salesTax', 'ok', count + (count === 1 ? ' state' : ' states'));
  } else {
    setDot('salesTax', 'info');
    setPill('salesTax', 'info', 'Defaults');
  }
}
window.refreshTaxTabStatus = refreshTaxTabStatus;

// ── Settings → Compliance: 4 tabs (Licenses + Insurance + Certifications + Tax jurisdictions).
var COMPLIANCE_TABS = ['licenses','insurance','certifications','taxJurisdictions'];
function switchComplianceTab(tab) {
  window.__complianceActiveTab = tab;
  COMPLIANCE_TABS.forEach(function(t) {
    var body = document.getElementById('complianceTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#complianceTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchComplianceTab = switchComplianceTab;

function refreshComplianceTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('complianceTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('complianceStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  function countRows(listId) {
    var list = document.getElementById(listId);
    if (!list) return 0;
    var n = list.querySelectorAll('[data-compliance-row], .compliance-row, .form-row').length;
    if (!n) n = list.children.length;
    return n;
  }
  COMPLIANCE_TABS.forEach(function(key) {
    var listId = 'compliance' + key.charAt(0).toUpperCase() + key.slice(1) + 'List';
    var n = countRows(listId);
    if (n > 0) {
      setDot(key, 'ok');
      setPill(key, 'ok', n + (n === 1 ? ' item' : ' items'));
    } else {
      setDot(key, 'info');
      setPill(key, 'info', 'None');
    }
  });
}
window.refreshComplianceTabStatus = refreshComplianceTabStatus;

// ── Settings → Selling → Channels: 2 tabs (Declared + Connected).
var CHANNELS_TABS = ['declared','connected'];
function switchChannelsTab(tab) {
  window.__channelsActiveTab = tab;
  CHANNELS_TABS.forEach(function(t) {
    var body = document.getElementById('channelsTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#channelsTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchChannelsTab = switchChannelsTab;

function refreshChannelsTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('channelsTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('channelsStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Declared — count checked toggles in the declared list.
  var dList = document.getElementById('channelsDeclaredList');
  var dCount = dList ? dList.querySelectorAll('input[type="checkbox"]:checked').length : 0;
  setDot('declared', dCount > 0 ? 'ok' : 'info');
  setPill('declared', dCount > 0 ? 'ok' : 'info', dCount > 0 ? (dCount + (dCount === 1 ? ' channel' : ' channels')) : 'None');
  // Connected — count cards rendered in the group.
  var cGroup = document.getElementById('channelsCardGroup');
  var cCount = cGroup ? cGroup.children.length : 0;
  setDot('connected', cCount > 0 ? 'ok' : 'info');
  setPill('connected', cCount > 0 ? 'ok' : 'info', cCount > 0 ? (cCount + (cCount === 1 ? ' card' : ' cards')) : 'None connected');
}
window.refreshChannelsTabStatus = refreshChannelsTabStatus;

// ── Settings → Storefront → Domains: single-page status pill (no tabs).
function refreshDomainsTabStatus() {
  var listEl = document.getElementById('domainsList');
  var pill = document.getElementById('domainsStatus');
  if (!listEl || !pill) return;
  var rows = listEl.querySelectorAll('.domain-row');
  var count = rows.length;
  if (!count) {
    var loading = listEl.textContent && /loading/i.test(listEl.textContent);
    if (!loading) count = listEl.children.length;
  }
  if (count > 0) {
    pill.setAttribute('data-state', 'ok');
    pill.textContent = count + (count === 1 ? ' domain' : ' domains');
  } else {
    pill.setAttribute('data-state', 'info');
    pill.textContent = (listEl.textContent && /loading/i.test(listEl.textContent)) ? 'Loading…' : 'None yet';
  }
}
window.refreshDomainsTabStatus = refreshDomainsTabStatus;

// ── Settings → Studio → Workshop: tabbed view (4 distinct management surfaces).
var WORKSHOP_TABS = ['operators','studioLocations','inventoryLocations','mediaStorage'];

function switchWorkshopTab(tab) {
  window.__workshopActiveTab = tab;
  WORKSHOP_TABS.forEach(function(t) {
    var body = document.getElementById('workshopTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#workshopTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchWorkshopTab = switchWorkshopTab;

function refreshWorkshopTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('workshopTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('workshopStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // Operators — count entries in the rendered list.
  var opEl = document.getElementById('operatorsList');
  var opCount = opEl ? opEl.querySelectorAll('.operator-row, [data-operator-id]').length : 0;
  if (!opCount && opEl) opCount = Math.max(0, opEl.children.length - (opEl.textContent && /no operators/i.test(opEl.textContent) ? 1 : 0));
  setDot('operators', opCount > 0 ? 'ok' : 'info');
  setPill('operators', opCount > 0 ? 'ok' : 'info', opCount > 0 ? (opCount + (opCount === 1 ? ' operator' : ' operators')) : 'None yet');

  // Studio locations — count rendered rows.
  var slEl = document.getElementById('studioLocationsList');
  var slCount = slEl ? slEl.querySelectorAll('.studio-location-row, [data-studio-loc-id]').length : 0;
  if (!slCount && slEl) slCount = Math.max(0, slEl.children.length - (slEl.textContent && /no studio/i.test(slEl.textContent) ? 1 : 0));
  setDot('studioLocations', slCount > 0 ? 'ok' : 'info');
  setPill('studioLocations', slCount > 0 ? 'ok' : 'info', slCount > 0 ? (slCount + (slCount === 1 ? ' location' : ' locations')) : 'None yet');

  // Inventory locations — count rendered rows.
  var ilEl = document.getElementById('inventoryLocationsList');
  var ilCount = ilEl ? ilEl.querySelectorAll('.location-row, [data-location-id]').length : 0;
  if (!ilCount && ilEl) ilCount = Math.max(0, ilEl.children.length);
  setDot('inventoryLocations', ilCount > 0 ? 'ok' : 'info');
  setPill('inventoryLocations', ilCount > 0 ? 'ok' : 'info', ilCount > 0 ? (ilCount + (ilCount === 1 ? ' location' : ' locations')) : 'None yet');

  // Media storage — always Firebase Storage (read-only). Dot stays info.
  setDot('mediaStorage', 'info');
}
window.refreshWorkshopTabStatus = refreshWorkshopTabStatus;

// ── Settings → Studio → Trips: 2 distinct surfaces (IRS rate table, trip address book).
var TRIPS_TABS = ['irsRates','locations'];

function switchTripsTab(tab) {
  window.__tripsActiveTab = tab;
  TRIPS_TABS.forEach(function(t) {
    var body = document.getElementById('tripsTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#tripsTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchTripsTab = switchTripsTab;

function refreshTripsTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('tripsTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('tripsStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // IRS rates — count rows rendered into #irsRatesList.
  var irsEl = document.getElementById('irsRatesList');
  var irsCount = irsEl ? irsEl.querySelectorAll('.irs-rate-row, [data-irs-year]').length : 0;
  if (!irsCount && irsEl) irsCount = Math.max(0, irsEl.children.length - (irsEl.textContent && /no rates/i.test(irsEl.textContent) ? 1 : 0));
  setDot('irsRates', irsCount > 0 ? 'ok' : 'info');
  setPill('irsRates', irsCount > 0 ? 'ok' : 'info', irsCount > 0 ? (irsCount + (irsCount === 1 ? ' year' : ' years')) : 'None yet');

  // Trip locations — count rows rendered into #tripLocationsList.
  var tlEl = document.getElementById('tripLocationsList');
  var tlCount = tlEl ? tlEl.querySelectorAll('.trip-location-row, [data-trip-loc-id]').length : 0;
  if (!tlCount && tlEl) tlCount = Math.max(0, tlEl.children.length - (tlEl.textContent && /no locations/i.test(tlEl.textContent) ? 1 : 0));
  setDot('locations', tlCount > 0 ? 'ok' : 'info');
  setPill('locations', tlCount > 0 ? 'ok' : 'info', tlCount > 0 ? (tlCount + (tlCount === 1 ? ' location' : ' locations')) : 'None yet');
}
window.refreshTripsTabStatus = refreshTripsTabStatus;

// ── Settings → Integrations → AI & API Keys: inbound (Ask AI inside Mast) vs outbound (external AI tools).
var AI_TABS = ['askProvider','integrations'];

function switchAiTab(tab) {
  window.__aiActiveTab = tab;
  AI_TABS.forEach(function(t) {
    var body = document.getElementById('aiTab-' + t);
    if (body) body.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('#aiTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}
window.switchAiTab = switchAiTab;

function refreshAiTabStatus() {
  function setDot(tabKey, state) {
    var btn = document.getElementById('aiTabBtn-' + tabKey);
    if (!btn) return;
    var dot = btn.querySelector('.tab-status-dot');
    if (dot) dot.setAttribute('data-state', state);
  }
  function setPill(tabKey, state, label) {
    var pill = document.getElementById('aiStatus-' + tabKey);
    if (!pill) return;
    pill.setAttribute('data-state', state);
    if (label != null) pill.textContent = label;
  }
  // askProvider — BYO vs Mast-managed. If the BYO "connected" panel is visible, status is "Your key (Anthropic)";
  // otherwise it's "Mast-managed" (always works, never a missing state).
  var byoConnected = document.getElementById('byoAnthropicConnected');
  var isByo = byoConnected && byoConnected.style.display !== 'none' && byoConnected.style.display !== '';
  // The pitch starts display:none too — only "connected" being explicitly shown signals BYO mode.
  isByo = !!(byoConnected && byoConnected.style.display === '');
  setDot('askProvider', isByo ? 'ok' : 'info');
  setPill('askProvider', isByo ? 'ok' : 'info', isByo ? 'Your key (Anthropic)' : 'Mast-managed');
  // integrations — count rendered API keys.
  var keysEl = document.getElementById('aiKeysList');
  var keyCount = keysEl ? keysEl.querySelectorAll('.ai-key-row, [data-ai-key-id]').length : 0;
  if (!keyCount && keysEl) {
    // Heuristic: any element that isn't the .loading placeholder.
    var loading = keysEl.querySelector('.loading');
    keyCount = Math.max(0, keysEl.children.length - (loading ? 1 : 0));
  }
  setDot('integrations', keyCount > 0 ? 'ok' : 'info');
  setPill('integrations', keyCount > 0 ? 'ok' : 'info', keyCount > 0 ? (keyCount + (keyCount === 1 ? ' key' : ' keys')) : 'No keys yet');
}
window.refreshAiTabStatus = refreshAiTabStatus;

// Consolidated QBO surfaces — inner tab switcher for Settings → Integrations → QuickBooks.
// Lazy-loads the accounting modules then renders the QuickBooks settings panel into
// #qboPanelBody.
//
// QBO-3 CUTOVER: accounting-v2 (renderQboPanelV2 — the 4 sub-views on the V2 engine)
// is now the DEFAULT QuickBooks settings surface for ALL users — the old `?ui=1`
// opt-in gate is gone. We still load V1 accounting.js EITHER WAY: the V2 twin
// delegates its write modals (backfill / retry / conflict-resolve / collision /
// default-sales-item / connect / disconnect) to the V1 action globals, and
// finance.js's FROZEN cross-module contract (__qboConflicts, openQboConflictModal,
// _qboFindConflict, _qboPreloadConflicts, triggerQboPush) is defined there. V1's
// read-only VIEW renderers are dead post-cutover; V2 owns the panel. V1 falls back
// only if the V2 twin failed to load (never a blank tab on a financial surface).
function switchQboInnerTab(tab) {
  window.__qboInnerActiveTab = tab;
  document.querySelectorAll('#qboInnerTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  var body = document.getElementById('qboPanelBody');
  if (body) body.innerHTML = '<div style="color:var(--warm-gray);font-size:0.9rem;padding:16px 0;">Loading…</div>';
  if (typeof MastAdmin !== 'undefined' && MastAdmin.loadModule) {
    // Always load V1 (frozen finance.js globals + the delegated write modals the V2
    // twin hands off to), then load the V2 twin and render it as the canonical panel.
    MastAdmin.loadModule('accounting').then(function() {
      MastAdmin.loadModule('accounting-v2').then(function() {
        if (typeof window.renderQboPanelV2 === 'function') window.renderQboPanelV2(tab);
        else if (typeof window.renderQboPanel === 'function') window.renderQboPanel(tab);
      }).catch(function() {
        // V2 twin failed to load — fall back to V1 so the financial surface is never blank.
        if (typeof window.renderQboPanel === 'function') window.renderQboPanel(tab);
      });
    });
  } else if (typeof window.renderQboPanelV2 === 'function') {
    window.renderQboPanelV2(tab);
  } else if (typeof window.renderQboPanel === 'function') {
    window.renderQboPanel(tab);
  }
}
window.switchQboInnerTab = switchQboInnerTab;

function switchPimTab(tab) {
  // Defense in depth: Testing tab is platform-admin-only. If a stale URL
  // state or programmatic call lands on it for a tenant admin, bounce
  // back to the default tab.
  if (tab === 'testing' && !isPlatformAdmin()) tab = 'drift';
  window.__pimActiveTab = tab;
  ['drift', 'sync', 'testing', 'rules'].forEach(function(t) {
    var el = document.getElementById('pimTab_' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#pimTabBar .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'drift') openDriftReviewQueue();
  if (tab === 'sync') openSyncLog();
  if (tab === 'rules') openSyncRules();
  if (typeof refreshPimTabStatus === 'function') refreshPimTabStatus();
}
window.switchPimTab = switchPimTab;

function togglePimTesting() {
  var el = document.getElementById('pimTestingTools');
  var btn = document.getElementById('pimShowTestingBtn');
  if (!el) return;
  var show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  if (btn) btn.textContent = show ? 'Hide Testing Tools' : 'Show Testing Tools';
}
