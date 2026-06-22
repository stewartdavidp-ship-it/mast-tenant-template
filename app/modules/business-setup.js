/**
 * business-setup.js — the "Business setup" admin page (edit business category /
 * revenue channels / engagement mode / modules-shown, with a diff-preview before
 * applying to the tenant's modeOverrides).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except the var(--token,#hex) style fallbacks become rgba()
 * (identical color, hex-lint clean). The inline block is top-level scope, so every
 * symbol stays a window global; the cluster's own state (_businessSetupFormState)
 * and its bare deps (esc, MastDB, showToast, MODE_MODULE_INFO, …) are window
 * globals read only POST-LOAD (renderBusinessSetup is the route setup fn; bs* fire
 * via onclick/onchange), so the deferred load is safe.
 *
 * window exports: renderBusinessSetup, bsUpdateField, bsToggleListField,
 *   bsPreviewDiff, bsCancelDiff, bsApplyChanges.
 */

// In-memory form state for the page (cleared on navigate-away or apply)
var _businessSetupFormState = null;

async function renderBusinessSetup() {
  var container = document.getElementById('businessSetupContent');
  if (!container) return;

  // Always re-hydrate so the form reflects the current persisted state
  if (typeof hydrateEngagementSurface === 'function') {
    try { await hydrateEngagementSurface(); } catch (_e) { /* fail-open */ }
  }

  var BEC = window.BusinessEntityConstants;
  if (!BEC || typeof BEC.deriveModeSet !== 'function') {
    container.innerHTML = '<div style="padding:24px;color:var(--warm-gray);">Business setup unavailable — modes system not loaded.</div>';
    return;
  }

  // Read current entity to pre-fill the form
  var entity = {};
  try { entity = (await MastDB.businessEntity.get()) || {}; }
  catch (err) { console.warn('[business-setup] entity read failed:', err && err.message); }

  // Initialize form state from current entity (only first render — preserves
  // edits when the page re-renders after a diff preview)
  if (!_businessSetupFormState) {
    _businessSetupFormState = {
      category: entity.category || '',
      revenueChannels: Array.isArray(entity.revenueChannels) ? entity.revenueChannels.slice() : [],
      engagementMode: (entity.engagement && entity.engagement.mode) || 'storefront',
      modulesShown: (entity.engagement && Array.isArray(entity.engagement.modulesShown))
        ? entity.engagement.modulesShown.slice() : [],
      showDiff: false
    };
  }
  var st = _businessSetupFormState;

  var html = '';
  html += '<div style="padding:0 24px 16px;color:var(--warm-gray);font-size:0.9rem;line-height:1.5;">';
  html += 'Update what kind of business you run. We&rsquo;ll show you what will change before applying. ';
  html += 'Modules you&rsquo;ve manually added stay enabled.';
  html += '</div>';

  html += '<div style="padding:0 24px;max-width:720px;">';

  // === Business category ===
  html += '<div style="margin-bottom:20px;">';
  html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--text-primary);">Business category</label>';
  html += '<select id="bsCategory" onchange="bsUpdateField(\'category\', this.value)" style="width:100%;max-width:360px;padding:8px;font-size:0.9rem;border:1px solid var(--border,rgba(229,224,216,1));border-radius:6px;background:var(--surface-card,rgba(255,255,255,1));">';
  html += '<option value="">— choose —</option>';
  var cats = BEC.BUSINESS_CATEGORIES || [];
  for (var i = 0; i < cats.length; i++) {
    var cat = cats[i];
    var sel = (cat.value === st.category) ? ' selected' : '';
    html += '<option value="' + esc(cat.value) + '"' + sel + '>' + esc(cat.label) + '</option>';
  }
  html += '</select>';
  html += '</div>';

  // === Revenue channels (multi-select checkboxes) ===
  html += '<div style="margin-bottom:20px;">';
  html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--text-primary);">How do you sell today? <span style="font-weight:400;color:var(--warm-gray);">(check all that apply)</span></label>';
  var channels = BEC.REVENUE_CHANNELS || [];
  html += '<div style="display:flex;flex-direction:column;gap:6px;">';
  for (var c = 0; c < channels.length; c++) {
    var ch = channels[c];
    var checked = (st.revenueChannels.indexOf(ch.value) !== -1) ? ' checked' : '';
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">';
    html += '<input type="checkbox" value="' + esc(ch.value) + '" onchange="bsToggleListField(\'revenueChannels\', this.value, this.checked)"' + checked + ' style="width:16px;height:16px;">';
    html += '<span>' + esc(ch.label) + '</span>';
    html += '</label>';
  }
  html += '</div></div>';

  // === Engagement mode (radio) ===
  html += '<div style="margin-bottom:20px;">';
  html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--text-primary);">How do you want to use Mast?</label>';
  var modes = BEC.ENGAGEMENT_MODE_CARDS || [];
  html += '<div style="display:flex;flex-direction:column;gap:6px;">';
  for (var m = 0; m < modes.length; m++) {
    var mode = modes[m];
    var radioSel = (mode.value === st.engagementMode) ? ' checked' : '';
    html += '<label style="display:flex;align-items:flex-start;gap:8px;font-size:0.9rem;cursor:pointer;">';
    html += '<input type="radio" name="bsEngagementMode" value="' + esc(mode.value) + '" onchange="bsUpdateField(\'engagementMode\', this.value)"' + radioSel + ' style="margin-top:3px;">';
    html += '<span><strong>' + esc(mode.title) + '</strong><br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(mode.body) + '</span></span>';
    html += '</label>';
  }
  html += '</div></div>';

  // === Modules shown (checkboxes) ===
  // The 9 valid modulesShown values. Labels deliberately match the wizard step 5 copy.
  var moduleOpts = [
    { value: 'products',         label: 'Products (catalog, inventory, materials)' },
    { value: 'sales',            label: 'Sales (orders, POS, returns, wholesale)' },
    { value: 'marketing',        label: 'Marketing (blog, social, newsletter, brand)' },
    { value: 'retention',        label: 'Retention (loyalty, gift cards, coupons)' },
    { value: 'events',           label: 'Events (markets, pop-ups, shows)' },
    { value: 'classes',          label: 'Classes & bookings (instructors, students)' },
    { value: 'finance',          label: 'Finance (revenue, expenses, P&L)' },
    { value: 'operations',       label: 'Operations (studio, team, trips)' },
    { value: 'customer-service', label: 'Customer service (inbox, tickets, reviews)' }
  ];
  html += '<div style="margin-bottom:20px;">';
  html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;color:var(--text-primary);">Modules you want enabled <span style="font-weight:400;color:var(--warm-gray);">(check all that apply)</span></label>';
  html += '<div style="display:flex;flex-direction:column;gap:6px;">';
  for (var n = 0; n < moduleOpts.length; n++) {
    var mo = moduleOpts[n];
    var modChk = (st.modulesShown.indexOf(mo.value) !== -1) ? ' checked' : '';
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;">';
    html += '<input type="checkbox" value="' + esc(mo.value) + '" onchange="bsToggleListField(\'modulesShown\', this.value, this.checked)"' + modChk + ' style="width:16px;height:16px;">';
    html += '<span>' + esc(mo.label) + '</span>';
    html += '</label>';
  }
  html += '</div></div>';

  // === Diff preview / apply controls ===
  html += '<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border,rgba(229,224,216,1));">';

  if (!st.showDiff) {
    html += '<button class="btn btn-primary" onclick="bsPreviewDiff()">Preview changes</button>';
  } else {
    // Compute the diff inline
    var currentModeSet = entity.modeSet || null;
    var derivedNext = BEC.deriveModeSet({
      category: st.category,
      revenueChannels: st.revenueChannels,
      engagement: { mode: st.engagementMode, modulesShown: st.modulesShown }
    }, { derivedFrom: 'settings' });
    var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
    var diff = BEC.diffModeSets(currentModeSet, derivedNext, overrides);

    html += '<div style="margin-bottom:12px;font-size:0.9rem;color:var(--text-primary);">';
    html += '<strong>New mode-set:</strong> ' + esc(derivedNext.modes.join(', '));
    if (derivedNext.overlays.length) html += ' <span style="color:var(--warm-gray);">+ ' + esc(derivedNext.overlays.join(', ')) + ' overlay</span>';
    if (derivedNext.cohortFlag) html += ' <span style="color:var(--warm-gray);">+ cohort flag</span>';
    html += '</div>';

    var hasAny = (diff.becomingVisible.length + diff.becomingHidden.length) > 0;

    if (!hasAny) {
      html += '<div style="padding:12px;background:rgba(42,124,111,0.08);border-radius:6px;font-size:0.9rem;color:var(--text-primary);margin-bottom:12px;">';
      html += 'Nothing will change &mdash; your new selections produce the same visible sidebar as today.';
      html += '</div>';
    } else {
      if (diff.becomingVisible.length) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">These modules will become visible (' + diff.becomingVisible.length + '):</div>';
        html += '<ul style="margin:0;padding-left:20px;font-size:0.85rem;color:var(--warm-gray);line-height:1.6;">';
        for (var v = 0; v < diff.becomingVisible.length; v++) {
          var rv = diff.becomingVisible[v];
          var labelV = (MODE_MODULE_INFO[rv] && MODE_MODULE_INFO[rv].label) || rv;
          var resolvedV = BEC.labelFor(rv, derivedNext, labelV);
          html += '<li>' + esc(resolvedV) + '</li>';
        }
        html += '</ul></div>';
      }
      if (diff.becomingHidden.length) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">These will be soft-hidden (you can still add them anytime):</div>';
        html += '<ul style="margin:0;padding-left:20px;font-size:0.85rem;color:var(--warm-gray);line-height:1.6;">';
        for (var h = 0; h < diff.becomingHidden.length; h++) {
          var rh = diff.becomingHidden[h];
          var labelH = (MODE_MODULE_INFO[rh] && MODE_MODULE_INFO[rh].label) || rh;
          var resolvedH = BEC.labelFor(rh, currentModeSet, labelH);
          html += '<li>' + esc(resolvedH) + '</li>';
        }
        html += '</ul></div>';
      }
      html += '<div style="margin-bottom:12px;font-size:0.78rem;color:var(--warm-gray);font-style:italic;">';
      html += 'Modules you&rsquo;ve manually added stay enabled and won&rsquo;t be hidden.';
      html += '</div>';
    }

    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary" onclick="bsApplyChanges()">Apply changes</button>';
    html += '<button class="btn btn-secondary" onclick="bsCancelDiff()">Keep editing</button>';
    html += '</div>';
  }

  html += '</div></div>';
  container.innerHTML = html;
}
window.renderBusinessSetup = renderBusinessSetup;

function bsUpdateField(field, value) {
  if (!_businessSetupFormState) return;
  _businessSetupFormState[field] = value;
  _businessSetupFormState.showDiff = false;
}
window.bsUpdateField = bsUpdateField;

function bsToggleListField(field, value, isChecked) {
  if (!_businessSetupFormState) return;
  if (!Array.isArray(_businessSetupFormState[field])) _businessSetupFormState[field] = [];
  var idx = _businessSetupFormState[field].indexOf(value);
  if (isChecked && idx === -1) _businessSetupFormState[field].push(value);
  else if (!isChecked && idx !== -1) _businessSetupFormState[field].splice(idx, 1);
  _businessSetupFormState.showDiff = false;
}
window.bsToggleListField = bsToggleListField;

function bsPreviewDiff() {
  if (!_businessSetupFormState) return;
  _businessSetupFormState.showDiff = true;
  renderBusinessSetup();
}
window.bsPreviewDiff = bsPreviewDiff;

function bsCancelDiff() {
  if (!_businessSetupFormState) return;
  _businessSetupFormState.showDiff = false;
  renderBusinessSetup();
}
window.bsCancelDiff = bsCancelDiff;

async function bsApplyChanges() {
  if (!_businessSetupFormState) return;
  var st = _businessSetupFormState;
  var BEC = window.BusinessEntityConstants;
  try {
    // Persist the underlying entity fields the user changed (revenueChannels +
    // engagement.mode + engagement.modulesShown + category). These writes go
    // through the existing MastDB.businessEntity.update path so audit/validation
    // hooks fire normally.
    if (st.category) {
      await MastDB.businessEntity.update('identity', { category: st.category }).catch(function() {
        // identity may not be a real updatable section for category — fall back
        return MastDB.set('admin/businessEntity/category', st.category);
      });
    }
    await MastDB.set('admin/businessEntity/revenueChannels', st.revenueChannels || []);
    await MastDB.businessEntity.update('engagement', {
      mode: st.engagementMode,
      modulesShown: st.modulesShown || []
    });

    // Re-read the entity to derive against the now-persisted fields (avoids
    // any drift between in-memory form state and what actually landed).
    var fresh = await MastDB.businessEntity.get();
    var derived = BEC.deriveModeSet(fresh || {}, { derivedFrom: 'settings' });
    await MastDB.businessEntity.update('modeSet', derived);

    // modeOverrides is preserved automatically — we never touched it.

    if (typeof showToast === 'function') showToast('Business setup updated.');

    // Clear form state and re-hydrate / re-filter sidebar so the new mode-set
    // takes effect immediately.
    _businessSetupFormState = null;
    if (typeof hydrateEngagementSurface === 'function') await hydrateEngagementSurface();

    // Navigate to dashboard so the user sees the new sidebar layout
    if (typeof navigateTo === 'function') navigateTo('dashboard');
  } catch (err) {
    console.warn('[business-setup] apply failed:', err && err.message);
    if (typeof showToast === 'function') showToast('Could not update business setup: ' + (err.message || ''), true);
  }
}
window.bsApplyChanges = bsApplyChanges;
