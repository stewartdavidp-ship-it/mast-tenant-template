/**
 * Settings sub-panel loaders — the Engagement, Tax & Legal, and Plaid bank
 * connection panels in the admin Settings surface.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14–15,
 * Track 1 — coupled-cluster settings-panel batch). Each loader is reached lazily
 * from a `view === ...` branch of switchSettingsSubView (the dispatcher stays
 * eager in the shell and lazy-loads this module before calling the *Impl).
 *
 * Reads eager shell globals (all defined before a user can reach a settings
 * sub-panel): MastDB, esc, showToast, mastConfirm, firebase, BusinessEntityConstants,
 * hydrateEngagementSurface, getTenantSubscription, refreshComplianceTabStatus-style
 * status refreshers (none here), navigateTo. All logic moved VERBATIM
 * (behavior-preserving). The legacy-entity backfill banner trio
 * (renderLegacyEntityBannerIfNeeded / dismissLegacyEntityBanner /
 * onLegacyEntityBannerCta) is boot-called and STAYS eager in the shell.
 */
(function () {
  'use strict';

// ============================================================
// Engagement Settings (B6 — Entity Phase 1)
// ============================================================

var _engagementSettingsArchetype = null;

async function loadEngagementSettings() {
  var modeEl = document.getElementById('engagementModeDisplay');
  var surfaceOpts = document.getElementById('engagementSurfaceOptions');
  var bootstrapBanner = document.getElementById('engagementBootstrapBanner');
  var noEntityBanner = document.getElementById('engagementNoEntityBanner');
  var modulesGroup = document.getElementById('engagementModulesGroup');
  if (!modeEl || !surfaceOpts) return;

  var ent = null;
  try {
    ent = await MastDB.businessEntity.get();
  } catch (err) {
    console.warn('[engagement settings] get failed:', err && err.message);
  }
  var engagement = (ent && ent.engagement) || {};
  var identity = (ent && ent.identity) || {};
  var status = (ent && ent.entityStatus) || 'none';
  _engagementSettingsArchetype = identity.archetype || null;

  // Banners
  if (bootstrapBanner) bootstrapBanner.style.display = (status === 'draft' && engagement.bootstrappedFromBackfill) ? '' : 'none';
  if (noEntityBanner) noEntityBanner.style.display = status === 'none' ? '' : 'none';

  // Mode editor (S2) — dropdown + current-mode hint.
  var modeCards = (window.BusinessEntityConstants && BusinessEntityConstants.ENGAGEMENT_MODE_CARDS) || [];
  var modeLabel = engagement.mode || '';
  var selectEl = document.getElementById('engagementModeSelect');
  if (selectEl) {
    var optsHtml = '<option value="">Not set</option>' + modeCards.map(function(c) {
      return '<option value="' + esc(c.value) + '"' + (c.value === modeLabel ? ' selected' : '') + '>' + esc(c.title) + '</option>';
    }).join('');
    selectEl.innerHTML = optsHtml;
  }
  if (modeLabel) {
    var match = modeCards.filter(function(c) { return c.value === modeLabel; })[0];
    modeEl.innerHTML = match ? esc(match.body) : '';
  } else {
    modeEl.innerHTML = '<span style="color:var(--warm-gray);">Not set. Pick a mode below or complete the onboarding wizard.</span>';
  }

  // Surface radios
  var surfaceOptions = (window.BusinessEntityConstants && BusinessEntityConstants.SURFACE_OPTIONS) || [
    { value: 'ai-first', label: 'AI-first', hint: 'Dashboard + Advisor. Ask in plain English.' },
    { value: 'ui-first', label: 'UI-first', hint: 'Classic menus and forms.' },
    { value: 'hybrid', label: 'Hybrid', hint: 'Both \u2014 Advisor banner + full nav.' }
  ];
  var currentSurface = engagement.surface || (modeLabel && BusinessEntityConstants.DEFAULT_SURFACE_BY_MODE[modeLabel]) || 'ui-first';
  var surfaceHtml = surfaceOptions.map(function(opt) {
    var isChecked = opt.value === currentSurface;
    return '<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border:1px solid ' + (isChecked ? 'var(--teal,#2a9d8f)' : 'var(--border,rgba(255,255,255,0.08))') + ';border-radius:8px;cursor:pointer;">' +
      '<input type="radio" name="engagementSurface" value="' + esc(opt.value) + '" ' + (isChecked ? 'checked' : '') + ' onchange="saveEngagementSurface(this.value)">' +
      '<span><strong>' + esc(opt.label) + '</strong><br><span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(opt.hint) + '</span></span>' +
      '</label>';
  }).join('');
  surfaceOpts.innerHTML = surfaceHtml;

  // Modules checkboxes — ui-first only
  renderEngagementModulesCheckboxes(engagement.modulesShown || null);
  if (modulesGroup) modulesGroup.style.display = currentSurface === 'ui-first' ? '' : 'none';
}

function renderEngagementModulesCheckboxes(modulesShown) {
  var listEl = document.getElementById('engagementModulesList');
  if (!listEl) return;
  // List ONLY the top-level sidebar groups (one row per nav module), in nav
  // order, with their human label. The old union pulled in archetype defaults +
  // raw saved tokens, which leaked sub-route ids (e.g. "develop-products") and
  // kebab section keys into the list — confusing and not the top-level objects.
  // We standardize on section-name tokens here; the nav filter
  // (applyEngagementNavFiltering) matches section names directly.
  var labels = window.MODE_SECTION_LABELS || {};
  var current = Array.isArray(modulesShown) ? modulesShown : [];
  var sections = [];
  document.querySelectorAll('.sidebar-section[data-section]').forEach(function(el) {
    var name = el.getAttribute('data-section');
    // Skip system groups: admin is always visible; migration is a system flow.
    if (!name || name === 'admin' || name === 'migration') return;
    // Checked when the section name is selected OR — for back-compat with older
    // configs that stored sub-route ids — any route inside it is selected
    // (mirrors applyEngagementNavFiltering's dual-match).
    var checked = current.indexOf(name) !== -1;
    if (!checked) {
      var items = el.querySelectorAll('.sidebar-item[data-route]');
      for (var i = 0; i < items.length; i++) {
        if (current.indexOf(items[i].getAttribute('data-route')) !== -1) { checked = true; break; }
      }
    }
    sections.push({ name: name, label: labels[name] || name, checked: checked });
  });
  if (!sections.length) {
    listEl.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;">No modules available.</div>';
    return;
  }
  listEl.innerHTML = sections.map(function(s) {
    return '<label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">' +
      '<input type="checkbox" data-engagement-module="' + esc(s.name) + '" ' + (s.checked ? 'checked' : '') + '>' +
      '<span>' + esc(s.label) + '</span>' +
      '</label>';
  }).join('');
}

async function saveEngagementSurface(surface) {
  var statusEl = document.getElementById('engagementSurfaceStatus');
  var modulesGroup = document.getElementById('engagementModulesGroup');
  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('engagement', { surface: surface });
    await hydrateEngagementSurface();
    if (modulesGroup) modulesGroup.style.display = surface === 'ui-first' ? '' : 'none';
    if (statusEl) { statusEl.textContent = 'Saved. Sidebar updated.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    // Refresh radio styling (border color) without full reload
    var radios = document.querySelectorAll('#engagementSurfaceOptions input[type="radio"]');
    radios.forEach(function(r) {
      var label = r.closest('label');
      if (!label) return;
      label.style.borderColor = r.checked ? 'var(--teal,#2a9d8f)' : 'var(--border,rgba(255,255,255,0.08))';
    });
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown error'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
}

async function saveEngagementModulesShown() {
  var statusEl = document.getElementById('engagementModulesStatus');
  var btn = document.getElementById('engagementModulesSaveBtn');
  var checks = document.querySelectorAll('#engagementModulesList input[type="checkbox"][data-engagement-module]');
  var selected = [];
  checks.forEach(function(c) { if (c.checked) selected.push(c.getAttribute('data-engagement-module')); });
  if (btn) btn.disabled = true;
  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('engagement', { modulesShown: selected });
    await hydrateEngagementSurface();
    if (statusEl) { statusEl.textContent = 'Saved ' + selected.length + ' modules. Sidebar updated.'; statusEl.style.color = 'var(--success,#22c55e)'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown error'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function resetEngagementModulesToArchetype() {
  if (!_engagementSettingsArchetype) return;
  var defaults = MastDB.businessEntity.archetypeDefaults && MastDB.businessEntity.archetypeDefaults(_engagementSettingsArchetype);
  if (!defaults || !Array.isArray(defaults.modulesShown)) return;
  renderEngagementModulesCheckboxes(defaults.modulesShown.slice());
  var statusEl = document.getElementById('engagementModulesStatus');
  if (statusEl) { statusEl.textContent = 'Reset to archetype defaults. Click Save to apply.'; statusEl.style.color = 'var(--warm-gray)'; }
}

// ============================================================
// Engagement mode editor (S2 — Entity Phase 1)
// Switching mode re-applies DEFAULT_SURFACE_BY_MODE and surfaces a
// side-effect preview per spec §5 before committing.
// ============================================================

var _ENGAGEMENT_MODE_SIDE_EFFECTS = {
  'storefront':    'Your public storefront becomes the primary sales surface. New imports publish directly to it.',
  'sync-channels': 'Mast becomes the source-of-truth for your external channels (Etsy, Shopify, Square). New imports route to PIM, not your storefront.',
  'back-office':   'The public storefront stops publishing new products. POS / orders / inventory remain active. Existing products stay live \u2014 nothing is deleted.'
};

async function onEngagementModeChange(newMode) {
  var statusEl = document.getElementById('engagementModeStatus');
  var selectEl = document.getElementById('engagementModeSelect');
  if (!selectEl) return;
  if (!newMode) { if (statusEl) statusEl.textContent = ''; return; }

  var ent = null;
  try { ent = await MastDB.businessEntity.get(); } catch (e) {}
  var current = (ent && ent.engagement && ent.engagement.mode) || '';
  if (newMode === current) return;

  var sideEffect = _ENGAGEMENT_MODE_SIDE_EFFECTS[newMode] || '';
  var modeCards = (window.BusinessEntityConstants && BusinessEntityConstants.ENGAGEMENT_MODE_CARDS) || [];
  var nextMatch = modeCards.filter(function(c) { return c.value === newMode; })[0];
  var title = nextMatch ? nextMatch.title : newMode;
  var defaults = (window.BusinessEntityConstants && BusinessEntityConstants.DEFAULT_SURFACE_BY_MODE) || {};
  var nextSurface = defaults[newMode] || 'ui-first';

  var ok = await mastConfirm(
    'Switch to "' + title + '"?\n\n' + sideEffect +
    '\n\nYour default surface will reset to "' + nextSurface + '". You can fine-tune surface + modules below.',
    { title: 'Change engagement mode', confirmLabel: 'Switch mode', cancelLabel: 'Cancel' }
  );
  if (!ok) {
    selectEl.value = current || '';
    return;
  }

  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.update('engagement', { mode: newMode, surface: nextSurface });
    if (statusEl) { statusEl.textContent = 'Mode changed to "' + title + '". Surface reset to "' + nextSurface + '".'; statusEl.style.color = 'var(--success,#22c55e)'; }
    // Re-hydrate settings UI (refresh surface radios + modules) + sidebar gating.
    await loadEngagementSettings();
    if (typeof hydrateEngagementSurface === 'function') await hydrateEngagementSurface();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown error'); statusEl.style.color = 'var(--danger,#ef4444)'; }
    selectEl.value = current || '';
  }
}

// ============================================================
// Tax & Legal Settings (S1 — Entity Phase 1)
// Progressive-profiling UI for identity.legalName / dba[] / entityType /
// yearFounded / ein. EIN defensive copy + validator per spec §8.2.
// ============================================================

async function loadTaxLegalSettings() {
  var einLabel = document.getElementById('taxLegalEinLabel');
  var einFormat = document.getElementById('taxLegalEinFormat');
  var einWarning = document.getElementById('taxLegalEinWarning');
  var noticeEl = document.getElementById('taxLegalNoticeAtCollection');
  var einInput = document.getElementById('taxLegalEin');

  // Regulatory copy — must be rendered verbatim from BusinessEntityConstants.
  var C = window.BusinessEntityConstants || {};
  var EIN = C.EIN_COPY || {};
  var NOT = C.NOTICE_AT_COLLECTION_COPY || {};
  if (einLabel && EIN.label) einLabel.textContent = EIN.label;
  if (einFormat && EIN.format) einFormat.textContent = EIN.format;
  if (einWarning && EIN.warning) einWarning.textContent = EIN.warning;
  if (noticeEl) {
    var privacyHref = (C.PRIVACY_POLICY_URL) || '/privacy';
    var dpaHref = (C.DPA_URL) || '/dpa';
    var privacyLink = '<a href="' + privacyHref + '" target="_blank" rel="noopener" style="color:var(--teal);text-decoration:underline;">' + esc(NOT.privacyLinkText || 'Privacy Policy') + '</a>';
    var dpaLink = '<a href="' + dpaHref + '" target="_blank" rel="noopener" style="color:var(--teal);text-decoration:underline;">' + esc(NOT.dpaLinkText || 'Data Processing Addendum') + '</a>';
    noticeEl.innerHTML = '<strong>Notice at Collection</strong> &mdash; ' + esc(NOT.body || '') +
      ' Read our ' + privacyLink + ' and ' + dpaLink + '.';
  }

  // Wire the EIN validator onBlur (once — idempotent).
  if (einInput && !einInput._einValidatorBound) {
    einInput._einValidatorBound = true;
    einInput.addEventListener('blur', onTaxLegalEinBlur);
  }

  // Hydrate existing values.
  try {
    var res = await MastDB.businessEntity.get('identity');
    var ident = (res && res.data) || {};
    var nameEl = document.getElementById('taxLegalName');
    var dbaEl = document.getElementById('taxLegalDba');
    var typeEl = document.getElementById('taxLegalEntityType');
    var yearEl = document.getElementById('taxLegalYearFounded');
    if (nameEl) nameEl.value = ident.legalName || '';
    if (dbaEl) dbaEl.value = Array.isArray(ident.dba) ? ident.dba.join('\n') : '';
    if (typeEl) typeEl.value = ident.entityType || '';
    if (yearEl) yearEl.value = ident.yearFounded || '';
    if (einInput) einInput.value = ident.ein || '';
  } catch (err) {
    console.warn('[tax & legal] load failed:', err && err.message);
  }
  if (typeof refreshTaxTabStatus === 'function') refreshTaxTabStatus();
}

function onTaxLegalEinBlur() {
  var input = document.getElementById('taxLegalEin');
  var errEl = document.getElementById('taxLegalEinError');
  if (!input) return;
  var raw = input.value;
  var C = window.BusinessEntityConstants;
  if (!C || typeof C.validateEin !== 'function') return;
  var result = C.validateEin(raw);
  if (result.ok) {
    if (errEl) { errEl.textContent = ''; errEl.style.color = ''; }
    return;
  }
  var reason = result.reason;
  if (reason === 'ssn-shaped' || reason === 'bare-9-digits') {
    // SSN-risk — show regulatory modal per spec §8.2.
    var EIN = C.EIN_COPY || {};
    if (typeof mastAlert === 'function') {
      mastAlert(EIN.ssnModalBody || 'Mast only accepts EINs.', {
        title: EIN.ssnModalTitle || 'That looks like an SSN',
        confirmLabel: EIN.ssnModalCta || 'Clear the field'
      }).then(function() {
        input.value = '';
        if (errEl) { errEl.textContent = ''; errEl.style.color = ''; }
        input.focus();
      });
    } else {
      // Fallback if mastAlert unavailable.
      input.value = '';
    }
    if (errEl) { errEl.textContent = 'Cleared — SSN-shaped input rejected.'; errEl.style.color = 'var(--danger,#ef4444)'; }
  } else if (reason === 'malformed') {
    if (errEl) { errEl.textContent = 'Invalid format. Expected XX-XXXXXXX (2 digits, dash, 7 digits).'; errEl.style.color = 'var(--danger,#ef4444)'; }
  }
}

async function saveTaxLegalIdentity() {
  var statusEl = document.getElementById('taxLegalIdentityStatus');
  var nameEl = document.getElementById('taxLegalName');
  var dbaEl = document.getElementById('taxLegalDba');
  var typeEl = document.getElementById('taxLegalEntityType');
  var yearEl = document.getElementById('taxLegalYearFounded');
  if (!nameEl) return;
  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--warm-gray)'; }
  var data = {};
  var name = (nameEl.value || '').trim();
  if (name) data.legalName = name;
  var dbaRaw = (dbaEl && dbaEl.value) || '';
  var dbaList = dbaRaw.split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
  data.dba = dbaList;
  var entityType = (typeEl && typeEl.value) || '';
  if (entityType) data.entityType = entityType;
  var yearRaw = (yearEl && yearEl.value) || '';
  if (yearRaw) {
    var y = parseInt(yearRaw, 10);
    if (!isNaN(y) && y >= 1900 && y <= 2100) data.yearFounded = y;
    else {
      if (statusEl) { statusEl.textContent = 'Year Founded must be a 4-digit year between 1900 and 2100.'; statusEl.style.color = 'var(--danger,#ef4444)'; }
      return;
    }
  }
  try {
    await MastDB.businessEntity.update('identity', data);
    if (statusEl) { statusEl.textContent = 'Legal identity saved.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (typeof refreshTaxTabStatus === 'function') refreshTaxTabStatus();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown error'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
}

async function saveTaxLegalEin() {
  var statusEl = document.getElementById('taxLegalEinStatus');
  var input = document.getElementById('taxLegalEin');
  var errEl = document.getElementById('taxLegalEinError');
  if (!input) return;
  var raw = (input.value || '').trim();
  var C = window.BusinessEntityConstants;
  if (C && typeof C.validateEin === 'function') {
    var result = C.validateEin(raw);
    if (!result.ok) {
      if (result.reason === 'ssn-shaped' || result.reason === 'bare-9-digits') {
        // Re-fire the modal so the user clears before save.
        onTaxLegalEinBlur();
        if (statusEl) { statusEl.textContent = 'Please clear the SSN-shaped value before saving.'; statusEl.style.color = 'var(--danger,#ef4444)'; }
      } else {
        if (errEl) { errEl.textContent = 'Invalid format. Expected XX-XXXXXXX.'; errEl.style.color = 'var(--danger,#ef4444)'; }
        if (statusEl) { statusEl.textContent = 'Save blocked — fix the format.'; statusEl.style.color = 'var(--danger,#ef4444)'; }
      }
      return;
    }
  }
  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    // Empty string means "unset"; preserve as empty string so the user can clear.
    await MastDB.businessEntity.update('identity', { ein: raw });
    if (statusEl) { statusEl.textContent = raw ? 'EIN saved.' : 'EIN cleared.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (errEl) { errEl.textContent = ''; }
    if (typeof refreshTaxTabStatus === 'function') refreshTaxTabStatus();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown error'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
}

// ── Plaid Bank Connections (Settings → Integrations) ─────────────────────────
// V1 Plaid caps (free/starter/growth/scale). Legacy keys retained for tenants
// still mapped to the old tier names; resolveTierForPlan-style fallback below
// converts publish→free, launch→starter, operate→growth, command→scale, etc.
var _PLAID_BANK_LIMITS = {
  // V1 keys
  'free': 0, 'starter': 5, 'growth': 15, 'scale': 50,
  // Legacy keys (kept for tenants whose subscription doc still has these)
  'publish': 0, 'launch': 5, 'operate': 15, 'command': 50,
  'organizer': 15, 'professional': 50
};
var _plaidLinkLoaded = false;
var _plaidLastConnectAt = 0;

function getPlaidBankLimit() {
  var sub = typeof getTenantSubscription === 'function' ? getTenantSubscription() : {};
  var plan = sub.plan || sub.tier || (window.TENANT_CONFIG && window.TENANT_CONFIG.plan) || 'publish';
  return _PLAID_BANK_LIMITS[plan] !== undefined ? _PLAID_BANK_LIMITS[plan] : 1;
}

async function loadPlaidBanksForSettings() {
  var container = document.getElementById('plaidBanksList');
  if (!container) return;
  container.innerHTML = '<div style="font-size:0.85rem;color:var(--warm-gray);">Loading connected banks…</div>';

  try {
    var items = (await MastDB.plaidItems.list()) || {};
    var keys = Object.keys(items);
    var includedLimit = getPlaidBankLimit();

    // F-M1e: V1 Plaid model — hard cap per tier (caps enforced server-side by A-M4),
    // 200 tokens/month reserved per active account at reset time.
    var wallet = (typeof getTokenWallet === 'function') ? getTokenWallet() : null;
    var alloc = (wallet && wallet.monthlyAllocation) || 0;
    var PLAID_TOKEN_RATE = 200;

    if (keys.length === 0) {
      container.innerHTML = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 14px;font-size:0.85rem;color:var(--warm-gray);">' +
        '0 of ' + includedLimit + ' Plaid account' + (includedLimit !== 1 ? 's' : '') + ' connected' +
        (includedLimit > 0 ? '. Each connected account reserves ' + PLAID_TOKEN_RATE + ' tokens/month from your allocation at the next reset.' : ' (your tier does not include Plaid — upgrade to Starter or higher).') +
        '</div>';
      return;
    }

    var activeCount = keys.filter(function(k) { return items[k].status === 'active'; }).length;
    var reserved = activeCount * PLAID_TOKEN_RATE;
    var capExceeded = activeCount > includedLimit;
    var summary = activeCount + ' of ' + includedLimit + ' Plaid accounts connected';
    if (alloc > 0) {
      summary += ' · ' + reserved.toLocaleString() + ' of ' + alloc.toLocaleString() + ' tokens reserved for Plaid this month';
    } else {
      summary += ' · ' + reserved.toLocaleString() + ' tokens reserved for Plaid this month';
    }
    var h = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">' + summary +
      (capExceeded ? ' · <span style="color:#f59e0b;">over cap by ' + (activeCount - includedLimit) + '</span>' : '') +
      '</div>';

    keys.forEach(function(itemId) {
      var item = items[itemId];
      var statusBg = item.status === 'active' ? '#16a34a' : item.status === 'error' ? '#dc2626' : '#9ca3af';
      var acctCount = (item.accounts && item.accounts.length) || 0;

      h += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 14px;margin-bottom:8px;">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="togglePlaidBankCard(\'' + esc(itemId) + '\')">';
      h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
      h += '<span id="plaidBankArrow_' + esc(itemId) + '" style="font-size:0.72rem;transition:transform 0.2s;">&#9654;</span>';
      h += '<span style="font-weight:600;font-size:0.9rem;">' + esc(item.institutionName || 'Unknown Bank') + '</span>';
      h += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + acctCount + ' account' + (acctCount !== 1 ? 's' : '') + '</span>';
      h += '<span style="background:' + statusBg + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + esc(item.status || 'unknown') + '</span>';
      if (item.lastSyncAt) h += '<span style="font-size:0.78rem;color:var(--warm-gray-light);">Synced ' + new Date(item.lastSyncAt).toLocaleDateString() + '</span>';
      h += '</div>';

      h += '<div style="display:flex;gap:6px;" onclick="event.stopPropagation()">';
      if (item.status === 'active') {
        h += '<button class="btn btn-secondary btn-small" data-item-id="' + esc(itemId) + '" onclick="syncPlaidItem(this.dataset.itemId)">Sync</button>';
      }
      h += '<button class="btn btn-danger btn-small" data-item-id="' + esc(itemId) + '" onclick="disconnectPlaidItem(this.dataset.itemId)">Disconnect</button>';
      h += '</div>';
      h += '</div>';

      h += '<div id="plaidBankDetail_' + esc(itemId) + '" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--cream-dark);">';
      if (item.accounts && item.accounts.length) {
        item.accounts.forEach(function(acct) {
          h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">';
          h += esc(acct.name || acct.type) + ' ••' + esc(acct.mask || '????');
          h += ' <span style="text-transform:capitalize;font-size:0.78rem;">(' + esc(acct.subtype || acct.type) + ')</span>';
          h += '</div>';
        });
      }
      if (item.lastSyncAt) {
        h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:6px;">Last synced ' + new Date(item.lastSyncAt).toLocaleString() + '</div>';
      }
      if (item.lastError) {
        h += '<div style="font-size:0.78rem;color:#dc2626;margin-top:4px;">' + esc(item.lastError) + '</div>';
      }
      h += '</div></div>';
    });

    container.innerHTML = h;
  } catch (err) {
    container.innerHTML = '<div style="color:#dc2626;font-size:0.85rem;">' + esc(err.message) + '</div>';
  }
}

window.togglePlaidBankCard = function(itemId) {
  var detail = document.getElementById('plaidBankDetail_' + itemId);
  var arrow = document.getElementById('plaidBankArrow_' + itemId);
  if (!detail) return;
  var isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
};

async function connectPlaidAccount() {
  if (Date.now() - _plaidLastConnectAt < 10000) {
    showToast('Please wait before connecting another bank', true);
    return;
  }
  try {
    var allItems = (await MastDB.plaidItems.list()) || {};
    var activeCount = Object.values(allItems).filter(function(i) { return i.status === 'active'; }).length;
    var includedLimit = getPlaidBankLimit();

    if (includedLimit === 0) {
      showToast('Bank connections are not available on the free plan. Upgrade to connect a bank.', true);
      return;
    }

    if (activeCount >= includedLimit) {
      var EXTRA_COST = 100;
      var w = getTokenWallet();
      var availableTokens = (w.currentBalance || 0) + (w.coinTokenSurplus || 0) + ((w.coinBalance || 0) * 100);

      if (availableTokens < EXTRA_COST) {
        var shortfall = EXTRA_COST - availableTokens;
        mastConfirm(
          'You\'ve used your ' + includedLimit + ' included banks.\n\nAdding another costs ' + EXTRA_COST + ' tokens/month but you only have ' + availableTokens + ' tokens available (need ' + shortfall + ' more).',
          { title: 'Not enough tokens', confirmLabel: 'Purchase Tokens' }
        ).then(function(ok) {
          if (ok && typeof openCoinPurchaseModal === 'function') openCoinPurchaseModal('settings-integrations', 'connectBank');
        });
        return;
      }

      mastConfirm(
        'You\'ve used your ' + includedLimit + ' included banks.\n\nAdding another will cost ' + EXTRA_COST + ' tokens/month (' + availableTokens + ' tokens available). If you don\'t have enough tokens next month, this bank will be automatically disconnected.',
        { title: 'Extra bank connection', confirmLabel: 'Continue' }
      ).then(function(ok) { if (ok) startPlaidLink(); });
      return;
    }
  } catch (e) { /* server enforces too */ }

  startPlaidLink();
}

async function startPlaidLink() {
  var btn = document.getElementById('connectPlaidBtn');
  _plaidLastConnectAt = Date.now();
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

  try {
    if (!_plaidLinkLoaded) {
      await new Promise(function(resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.onload = function() { _plaidLinkLoaded = true; resolve(); };
        script.onerror = function() { reject(new Error('Failed to load Plaid Link SDK')); };
        document.head.appendChild(script);
      });
    }

    var createLinkToken = firebase.functions().httpsCallable('createPlaidLinkToken');
    var result = await createLinkToken({ tenantId: MastDB.tenantId() });
    var linkToken = result.data.link_token;

    var handler = Plaid.create({
      token: linkToken,
      onSuccess: async function(publicToken) {
        if (btn) btn.textContent = 'Exchanging token…';
        try {
          var exchangeToken = firebase.functions().httpsCallable('exchangePlaidToken');
          var exchangeResult = await exchangeToken({
            tenantId: MastDB.tenantId(),
            public_token: publicToken
          });
          showToast('Connected ' + esc(exchangeResult.data.institutionName || 'bank account') + ' (' + exchangeResult.data.accountCount + ' accounts)');
          loadPlaidBanksForSettings();
        } catch (err) {
          showToast('Failed to connect: ' + esc(err.message), true);
        }
        if (btn) { btn.disabled = false; btn.textContent = '+ Connect Bank'; }
      },
      onExit: function(err) {
        if (err) showToast('Plaid connection cancelled', true);
        if (btn) { btn.disabled = false; btn.textContent = '+ Connect Bank'; }
      }
    });
    handler.open();
  } catch (err) {
    showToast('Failed to start Plaid connection: ' + esc(err.message), true);
    if (btn) { btn.disabled = false; btn.textContent = '+ Connect Bank'; }
  }
}

async function syncPlaidItem(itemId) {
  showToast('Syncing transactions…');
  try {
    var syncFn = firebase.functions().httpsCallable('syncPlaidTransactions');
    var result = await syncFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    var d = result.data;
    showToast('Synced: ' + d.imported + ' new, ' + d.updated + ' updated, ' + d.removed + ' removed');
    loadPlaidBanksForSettings();
  } catch (err) {
    showToast('Sync failed: ' + esc(err.message), true);
    loadPlaidBanksForSettings();
  }
}

function disconnectPlaidItem(itemId) {
  mastConfirm('Disconnect this bank? Existing imported transactions will remain.', { title: 'Disconnect bank', confirmLabel: 'Disconnect', danger: true }).then(function(ok) {
    if (ok) doDisconnectPlaidItem(itemId);
  });
}

async function doDisconnectPlaidItem(itemId) {
  try {
    var disconnectFn = firebase.functions().httpsCallable('disconnectPlaidItem');
    await disconnectFn({ tenantId: MastDB.tenantId(), itemId: itemId });
    showToast('Bank disconnected');
    loadPlaidBanksForSettings();
  } catch (err) {
    showToast('Disconnect failed: ' + esc(err.message), true);
  }
}

window.connectPlaidAccount = connectPlaidAccount;
window.syncPlaidItem = syncPlaidItem;
window.disconnectPlaidItem = disconnectPlaidItem;


  // ── Exports for the eager dispatcher shims + the panels' onclick/onchange targets.
  window.loadEngagementSettingsImpl = loadEngagementSettings;
  window.saveEngagementSurface = saveEngagementSurface;
  window.saveEngagementModulesShown = saveEngagementModulesShown;
  window.resetEngagementModulesToArchetype = resetEngagementModulesToArchetype;
  window.onEngagementModeChange = onEngagementModeChange;

  window.loadTaxLegalSettingsImpl = loadTaxLegalSettings;
  window.saveTaxLegalIdentity = saveTaxLegalIdentity;
  window.saveTaxLegalEin = saveTaxLegalEin;

  window.loadPlaidBanksForSettingsImpl = loadPlaidBanksForSettings;
  window.connectPlaidAccountImpl = connectPlaidAccount;
  // togglePlaidBankCard / connectPlaidAccount / syncPlaidItem / disconnectPlaidItem
  // already self-assign window.* in the moved blocks below.

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('settingsPanels', {});
  }
})();
