/**
 * Setup Wizard — the first-login onboarding flow for tenants whose
 * tenantStatus === 'onboarding' (migrate-my-site → biz identity → modules →
 * integrations → settings → launch). ~4,700 lines, 100+ functions.
 *
 * Extracted VERBATIM from app/index.html's inline block (decomposition master
 * plan §14, Track 1 — recipe A). The wizard is invoked from a SINGLE eager call
 * site (auth funnel) gated behind tenantStatus === 'onboarding', so it never
 * loads for onboarded tenants. That call now routes through
 * MastAdmin.loadModule('setupWizard'). The static #setupWizardScreen markup and
 * the wizard's own generated-HTML onclick handlers reference these functions —
 * they only fire after the wizard is open (= this module loaded) — so every
 * wizard function is re-exported on window below.
 *
 * Reads eager shell globals (all defined before the wizard can render): MastDB,
 * MastAdmin, TENANT_CONFIG, esc, showToast, navigateTo, openModal/closeModal,
 * writeAudit, attachListeners, loadSettings, BusinessEntityConstants, and more.
 *
 * One behavior-preserving change vs the inline original: `_wizardAnalyzing` is
 * now `window._wizardAnalyzing` (it was a top-level inline `var`, i.e. already a
 * window property) so fireAutoReport()'s `window._wizardAnalyzing` guard in
 * index.html keeps suppressing auto-reports during wizard site analysis.
 */
(function () {
  'use strict';

// ============================================================
// Setup Wizard — First-login flow for onboarding tenants
// ============================================================
// Setup Wizard — 3-step auto-apply flow ("Three Clicks to Migration")
// Step 1: Migrate My Site (URL + auto-analysis + auto-apply brand/template/modules/nav/import)
// Step 2: Module Choice (conditional — only when tier requires a choice)
// Step 3: Watch Your Store (live progress placeholder + Launch Dashboard)
// ============================================================
var wizardCurrentStep = 1;
var wizardProgress = {};
var _wizardSiteAnalysis = null; // cached analysis results from step 1
var _wizardAutoApplied = {}; // record of what was auto-applied
var _wizardSelectedModules = []; // module selections for step 2

// Step ordering for progress bar. 0 = welcome screen (no progress dots shown).
// quick path: 0,1,2,3,4,fastDpa
// full path:  0,1,2,3,4,4b,5,6,7,8,9,fastDpa
// Step 4 has sub-steps 4A (engagement mode picker) and 4B (feature pages, non-storefront only).
// Like step 1's 1A-1D, sub-steps share the parent dot and use a letter row inside the pane.
// '4b' is intentionally excluded from the main order so it doesn't get its own progress dot.
// New flow order (single path; depth fork moved to end-of-Phase-1):
// 0 welcome → 3 site → 1 identity → 2 brand → matchq → 4 engagement (4A/4B) → fork → 7 integrations → 8 settings → fastDpa
// Bar dots (excluding 0, fork, fastDpa): site, identity, brand, matchq, engagement, integrations, settings = 7
var _wizardStepOrder = ['0','3','1','2','matchq','4','fork','7','8','fastDpa'];
var _wizardStepOrderFull = ['0','3','1','2','matchq','4','fork','7','8','fastDpa'];

function _wizardGetStepOrder() {
  return (window._wizardOnboardingDepth === 'full') ? _wizardStepOrderFull : _wizardStepOrder;
}

function _wizardLsKey() {
  try { return 'mast_wizard_' + (MastDB.tenantId ? MastDB.tenantId() : 'default'); } catch(e) { return 'mast_wizard_default'; }
}
function _wizardLsLoad() {
  try { return JSON.parse(localStorage.getItem(_wizardLsKey()) || 'null') || {}; } catch(e) { return {}; }
}
function _wizardLsSave(update) {
  try {
    var existing = _wizardLsLoad();
    Object.assign(existing, update);
    localStorage.setItem(_wizardLsKey(), JSON.stringify(existing));
  } catch(e) {}
}
function _wizardApplyProgress(progress) {
  // Step IDs were renumbered in schema v2. Old saves have no _schemaVersion or v1.
  // Reset them to the welcome screen so the user doesn't land on a missing step.
  if (!progress._schemaVersion || progress._schemaVersion < 2) {
    progress = {};
  }
  wizardProgress = progress;
  if (wizardProgress.onboardingDepth) window._wizardOnboardingDepth = wizardProgress.onboardingDepth;
  if (!window._wizardCrawlManifest && wizardProgress.crawlManifest) {
    window._wizardCrawlManifest = wizardProgress.crawlManifest;
    window._wizardAnalyzedUrl = wizardProgress.analyzedUrl || '';
    window._wizardSiteFingerprint = wizardProgress.siteFingerprint || null;
  }
  if (wizardProgress.autoApplied) _wizardAutoApplied = wizardProgress.autoApplied;
  if (wizardProgress._engagement) window._wizardEngagement = wizardProgress._engagement;
  if (wizardProgress._extracted) window._wizardExtracted = wizardProgress._extracted;
  if (wizardProgress._archetypeDefaults) window._wizardArchetypeDefaults = wizardProgress._archetypeDefaults;
  if (wizardProgress._siteIntent) window._wizardSiteIntent = wizardProgress._siteIntent;
  if (wizardProgress._selectedModules) window._wizardSelectedModules = wizardProgress._selectedModules;
  if (wizardProgress._bizSubStep) _wizardBizSubStep = wizardProgress._bizSubStep;
  showWizardStep(wizardProgress.currentStep || '0');
}
// Shopify App Store origin detection. A tenant that installed Mast from the
// Shopify App Store must NEVER be offered "Mast as your storefront" — Mast is a
// complementary back-office that works WITH Shopify, never a replacement. We read
// config/shopify.installSource early so the engagement-mode step (4) can suppress
// the storefront option before the user ever reaches it.
window.wizardIsShopifyOrigin = false;
function _wizardDetectShopifyOrigin() {
  try {
    return MastDB.get('config/shopify').then(function(cfg) {
      window.wizardIsShopifyOrigin = !!(cfg && cfg.installSource === 'shopify-app-store');
      return window.wizardIsShopifyOrigin;
    }).catch(function() { return false; });
  } catch (e) { return Promise.resolve(false); }
}

function initSetupWizard() {
  // Run exactly once per page load. The auth funnel (auth.onAuthStateChanged)
  // re-fires on every Firebase token refresh and during multi-step auto-login,
  // and each re-entry would call initSetupWizard → _wizardApplyProgress →
  // showWizardStep(lastSavedStep). Sub-step navigation (e.g. step 1's 1A-1D) and
  // live form input are NOT persisted to currentStep, so a re-apply silently
  // yanked the user back to the last *saved* step and tore down the visible pane
  // mid-interaction (the "wizardBizCategory select disappears / selections drop"
  // churn). Guarding to once keeps in-progress input alive across re-fires.
  if (window._wizardBooted) return;
  window._wizardBooted = true;
  window._wizardOnboardingDepth = window._wizardOnboardingDepth || 'quick';
  // Resolve Shopify-origin early (async); step 4 render reads window.wizardIsShopifyOrigin.
  _wizardDetectShopifyOrigin();
  // Carry the business name forward from signup. Checkout / free-provision write
  // the name the user typed at signup to config/brand.name (NOT to the BE record),
  // and the wizard otherwise only pre-fills from a website site-scan — so without
  // this a user who already named their business hits the brand step blank and
  // re-types it. Seed it into _wizardExtracted (the source the brand-step prefill
  // AND the skip-to-launch backfill both read) so every path carries it through.
  _wizardHydrateSignupName();
  // Try localStorage first — survives browser back/forward without a network round trip
  var lsProgress = _wizardLsLoad();
  if (lsProgress.currentStep) {
    _wizardApplyProgress(lsProgress);
    var _appliedStep = String(wizardCurrentStep);
    // Also sync from Firestore in background to pick up any cross-device changes.
    // Only re-apply if the user hasn't navigated since we applied the local copy —
    // otherwise a slow network read would yank them off the step they're editing.
    MastDB.config.get('setupProgress').then(function(snap) {
      var fsProgress = snap || {};
      if (fsProgress.currentStep && fsProgress.updatedAt > (lsProgress.updatedAt || '') &&
          String(wizardCurrentStep) === _appliedStep) {
        _wizardApplyProgress(fsProgress);
      }
    }).catch(function() {});
    return;
  }
  // No localStorage — load from Firestore
  MastDB.config.get('setupProgress').then(function(snap) {
    _wizardApplyProgress(snap || {});
  }).catch(function() {
    showWizardStep('0');
  });
}

// Seed the signup business name (config/brand.name, written at provisioning) into
// the wizard's prefill source so it's carried forward instead of re-typed. Only
// fills a blank — never clobbers a site-scan value or something the user typed.
// Best-effort + async; if config/brand has no name the wizard behaves as before.
// Guarantee the business name is never blank. The signup/Shopify handoff writes
// the name to config/brand.name, but it was never copied to the canonical
// businessEntity.identity.businessName that the launch validator + dashboard
// read — so a Shopify install (where the merchant never types a name; only the
// shop name lands in config/brand.name) showed "Business name still needed"
// forever. Resolve the best name we know — handoff name → owner email → generic
// — seed it into the wizard prefill, AND persist it to identity if that field is
// blank (never clobbering a real name the user already set). Best-effort/async.
function _wizardHydrateSignupName() {
  try {
    Promise.all([
      MastDB.config.get('brand').catch(function() { return null; }),
      MastDB.businessEntity.get().catch(function() { return null; })
    ]).then(function(res) {
      var brand = res[0] || {};
      var identity = (res[1] && res[1].identity) || {};
      var existing = (identity.businessName && String(identity.businessName).trim()) || '';
      // Best known name: handoff (config/brand.name) → owner email → generic.
      var nm = (brand && typeof brand.name === 'string' && brand.name.trim()) || '';
      if (!nm) {
        try { var u = firebase.auth().currentUser; nm = String((u && (u.displayName || u.email)) || '').trim(); } catch (e) {}
      }
      if (!nm) nm = 'My Business';
      // Seed the prefill source + fill a blank brand-step field so it shows.
      window._wizardExtracted = window._wizardExtracted || {};
      if (!window._wizardExtracted.businessName) window._wizardExtracted.businessName = nm;
      var el = document.getElementById('wizardBrandName');
      if (el && !el.value) el.value = window._wizardExtracted.businessName;
      // Persist to the canonical identity field iff it's currently blank — this
      // is the fix: the handoff name (or a known-value fallback) now reaches the
      // field the validator reads, so launch is never gated on Business name.
      if (!existing && typeof MastBrandSync !== 'undefined') {
        MastBrandSync.setName(nm).catch(function() {});
      }
    }).catch(function() {});
  } catch (e) { /* non-blocking */ }
}

// IDs of every primary "Continue/Confirm" button across the wizard.
// Each gets disabled on submit; we re-enable them all on every step entry so
// back-nav after a successful submit doesn't strand the user with a greyed-out button.
var _WIZARD_CONFIRM_BTN_IDS = [
  'wizardBizIdentityConfirmBtn',  // step 1D
  'wizardBrandConfirmBtn',         // step 2
  'wizardEngagementConfirmBtn',    // step 4
  'wizardFeaturePagesConfirmBtn',  // step 4b
  'wizardSettingsConfirmBtn',      // step 8
  'wizardAnalyzeBtn',              // step 3 analyze
  'wizardMigrateBtn8'              // step 9 import
];

// showWizardStep accepts string step IDs: '0','1','2','3','4','4b','7','8','9','fastDpa'
function showWizardStep(step) {
  var stepStr = String(step);
  wizardCurrentStep = stepStr;
  // Re-enable every primary submit button so a stale DOM-disabled state from a
  // prior submit doesn't carry over to the new step.
  for (var bi = 0; bi < _WIZARD_CONFIRM_BTN_IDS.length; bi++) {
    var _b = document.getElementById(_WIZARD_CONFIRM_BTN_IDS[bi]);
    if (_b) {
      _b.disabled = false;
      // Restore default text where the submit handler swapped it for "Saving…".
      if (_b.textContent === 'Saving…') _b.textContent = 'Continue';
    }
  }
  // Hide every wizard step pane
  var allSteps = document.querySelectorAll('#setupWizardScreen .wizard-step');
  for (var s = 0; s < allSteps.length; s++) allSteps[s].style.display = 'none';
  var elId = (stepStr === 'fastDpa') ? 'wizardStepFastDpa'
    : (stepStr === 'matchq')        ? 'wizardStepMatchq'
    : (stepStr === 'fork')          ? 'wizardStepFork'
    : 'wizardStep' + stepStr;
  var show = document.getElementById(elId);
  if (show) show.style.display = '';
  updateWizardProgress();

  if (stepStr === '1') {
    // Restore the last sub-step the user was on (e.g. '1D' after they completed
    // identity and are coming back from brand). The previous if-check never fired
    // because the in-memory default is '1A' (truthy), so any saved state was ignored.
    var savedSub = wizardProgress && wizardProgress._bizSubStep;
    if (savedSub) _wizardBizSubStep = savedSub;
    renderWizardBizIdentity();
  }
  if (stepStr === '2') {
    // Re-enable Continue (it gets disabled on submit; persists on back-nav).
    var brandBtn = document.getElementById('wizardBrandConfirmBtn');
    if (brandBtn) brandBtn.disabled = false;
    // Restore brand fields from saved extracted data or wizard progress
    var extracted = window._wizardExtracted || {};
    var brandNameEl = document.getElementById('wizardBrandName');
    var brandTaglineEl = document.getElementById('wizardBrandTagline');
    if (brandNameEl && !brandNameEl.value) brandNameEl.value = extracted.businessName || (wizardProgress && wizardProgress.businessName) || '';
    if (brandTaglineEl && !brandTaglineEl.value) brandTaglineEl.value = extracted.tagline || (wizardProgress && wizardProgress.tagline) || '';
    // Restore previously-uploaded logo preview from config/brand.logoUrl.
    // File inputs can't be programmatically refilled, so show the saved logo as a thumbnail
    // with text indicating an upload would replace it.
    (function() {
      var nameEl = document.getElementById('wizardLogoFileName');
      var wrapEl = document.getElementById('wizardLogoPreviewWrap');
      var previewEl = document.getElementById('wizardLogoPreviewImg');
      if (!wrapEl || !previewEl) return;
      // Skip if user has already picked a new file in this session
      var input = document.getElementById('wizardBrandLogo');
      if (input && input.files && input.files[0]) return;
      MastDB.config.get('brand').then(function(brand) {
        var url = brand && brand.logoUrl;
        if (!url) return;
        previewEl.src = url;
        wrapEl.style.display = '';
        if (nameEl) nameEl.textContent = 'Current logo (upload to replace)';
      }).catch(function(){});
    })();
  }
  if (stepStr === '4') {
    renderWizardEngagement();
    _renderEngagementLetterRow('A');
  }
  if (stepStr === '4b') {
    // Restore in-progress selections if user reloaded mid-step
    if ((!_wizardSelectedFeaturePages || _wizardSelectedFeaturePages.length === 0) &&
        wizardProgress && wizardProgress._featurePagesDraft) {
      _wizardSelectedFeaturePages = wizardProgress._featurePagesDraft.slice();
    }
    renderWizardFeaturePages();
    _renderEngagementLetterRow('B');
  }
  if (stepStr === '7') {
    if (wizardProgress && wizardProgress._intDraft && Object.keys(_wizardIntegrationState).length === 0) {
      try { Object.assign(_wizardIntegrationState, wizardProgress._intDraft); } catch(e) {}
    }
    renderWizardIntegrations();
  }
  if (stepStr === '8') {
    renderWizardSettingsSpotlight();
  }
  if (stepStr === '3') {
    // Don't auto-skip forward when the user has already analyzed/chosen — that
    // creates an infinite redirect loop with Back from dot 2 (identity → site →
    // auto-skip back to identity). _wizardApplyProgress already restores the
    // correct currentStep on reload, so step 3 is only reached by explicit nav.
    // Show the picker (no re-crawl) when a manifest exists; show the URL form otherwise.
    var savedManifest = window._wizardCrawlManifest || (wizardProgress && wizardProgress.crawlManifest);
    var siteAnalyzed = !!(wizardProgress && (wizardProgress.siteAnalyzed || wizardProgress.analyzedUrl)) || !!window._wizardAnalyzedUrl;
    var urlForm3 = document.getElementById('wizardStep3UrlForm');
    var picker3 = document.getElementById('wizardSitePathPicker');
    if ((savedManifest || siteAnalyzed) && typeof wizardShowSitePathPicker === 'function') {
      if (savedManifest) window._wizardCrawlManifest = savedManifest;
      wizardShowSitePathPicker({ crawlManifest: savedManifest || {} });
    } else {
      if (urlForm3) urlForm3.style.display = '';
      if (picker3) { picker3.style.display = 'none'; picker3.innerHTML = ''; }
    }
  }
  if (stepStr === '9') {
    // Skip this step if the user already imported from step 1
    if (window._wizardAnalyzedUrl || (typeof wizardProgress !== 'undefined' && wizardProgress.analyzedUrl)) {
      showWizardStep('fastDpa');
      return;
    }
    // Pre-fill URL if entered but not yet analyzed
    var url8El = document.getElementById('wizardSiteUrl8');
    var existingUrl = window._wizardAnalyzedUrl || (typeof wizardProgress !== 'undefined' && wizardProgress.analyzedUrl) || '';
    if (url8El && !url8El.value && existingUrl) url8El.value = existingUrl;
  }
  if (stepStr === 'fastDpa') {
    renderWizardFastSummary();
    renderWizardActivationGate();
    // Repeat-visit aware framing: if user has been here before, soften the urgency.
    var fastHeadingEl = document.getElementById('wizardFastDpaHeading');
    var fastSubheadEl = document.getElementById('wizardFastDpaSubhead');
    var alreadyVisited = !!(wizardProgress && wizardProgress.engagementConfirmed);
    if (fastHeadingEl && fastSubheadEl) {
      if (alreadyVisited) {
        fastHeadingEl.textContent = 'Ready when you are';
        fastSubheadEl.textContent = 'Your setup is saved. Accept the data agreement and launch your dashboard.';
      } else {
        fastHeadingEl.textContent = 'Ready to launch your store';
        fastSubheadEl.textContent = 'Review your setup, accept the data agreement, and you’re live.';
      }
    }
  }
  if (stepStr === 'matchq') {
    if (typeof renderWizardMatchQ === 'function') renderWizardMatchQ();
  }
  if (stepStr === 'fork') {
    if (typeof renderWizardFork === 'function') renderWizardFork();
  }
}

// Render the A-B letter row for step 4 (engagement) sub-steps.
// 4A = engagement mode picker, 4B = feature pages (non-storefront only).
// Storefront mode has no 4B, so the row is hidden entirely.
function _renderEngagementLetterRow(activeLetter) {
  var eng = window._wizardEngagement || (typeof wizardProgress !== 'undefined' && wizardProgress && wizardProgress._engagement) || {};
  var hasFeaturePages = eng.mode && eng.mode !== 'storefront';
  var rowAEl = document.getElementById('wizardStep4LetterRow');
  var rowBEl = document.getElementById('wizardStep4bLetterRow');
  var targetEl = (activeLetter === 'B') ? rowBEl : rowAEl;
  // Always hide the inactive row to avoid duplicate dots.
  if (rowAEl) rowAEl.style.display = 'none';
  if (rowBEl) rowBEl.style.display = 'none';
  if (!targetEl) return;
  // Storefront mode: no sub-steps to show.
  if (!hasFeaturePages) return;
  var letters = ['A', 'B'];
  var labels = { 'A': 'Engagement mode', 'B': 'Feature pages' };
  var idx = letters.indexOf(activeLetter);
  if (idx < 0) idx = 0;
  var html = '';
  for (var i = 0; i < letters.length; i++) {
    var dotCls = 'wizard-letter-dot';
    if (i < idx) dotCls += ' completed';
    else if (i === idx) dotCls += ' active';
    html += '<div class="' + dotCls + '" title="' + labels[letters[i]] + '">' + letters[i] + '</div>';
    if (i < letters.length - 1) {
      var lineCls = 'wizard-letter-line' + (i < idx ? ' completed' : '');
      html += '<div class="' + lineCls + '"></div>';
    }
  }
  targetEl.innerHTML = html;
  targetEl.style.display = 'flex';
}

// fastDpa Back: route to fork (where they decided whether to do optional setup).
function wizardFastDpaBack() {
  showWizardStep('fork');
}

// ----------------------------------------------------------------
// Matchq step: stage + bottleneck + volume (the 3 matching questions)
// ----------------------------------------------------------------

var _wizardMatchQState = { stage: null, bottleneck: null, volume: null };

var _WIZARD_MATCHQ_OPTIONS = {
  stage: [
    { value: 'idea',        label: 'Just an idea' },
    { value: 'launching',   label: 'Launching soon' },
    { value: 'established', label: 'Established' },
    { value: 'scaling',     label: 'Scaling up' }
  ],
  bottleneck: [
    { value: 'sales',       label: 'Selling more' },
    { value: 'operations',  label: 'Operations / chaos' },
    { value: 'inventory',   label: 'Inventory tracking' },
    { value: 'customers',   label: 'Customer management' },
    { value: 'books',       label: 'Books / finances' }
  ],
  volume: [
    { value: '1-10',   label: '1–10' },
    { value: '10-50',  label: '10–50' },
    { value: '50-200', label: '50–200' },
    { value: '200+',   label: '200+' }
  ]
};

function renderWizardMatchQ() {
  // Restore from saved draft if present
  if (wizardProgress && wizardProgress._matchqDraft) {
    var d = wizardProgress._matchqDraft;
    if (!_wizardMatchQState.stage && d.stage) _wizardMatchQState.stage = d.stage;
    if (!_wizardMatchQState.bottleneck && d.bottleneck) _wizardMatchQState.bottleneck = d.bottleneck;
    if (!_wizardMatchQState.volume && d.volume) _wizardMatchQState.volume = d.volume;
  }
  ['stage','bottleneck','volume'].forEach(function(field) {
    var el = document.getElementById('wizardMatchq' + field.charAt(0).toUpperCase() + field.slice(1));
    if (!el) return;
    el.innerHTML = '';
    _WIZARD_MATCHQ_OPTIONS[field].forEach(function(opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      var on = _wizardMatchQState[field] === opt.value;
      btn.style.cssText = 'padding:7px 14px;border-radius:999px;border:2px solid ' +
        (on ? 'var(--teal)' : 'var(--border,#ccc)') +
        ';background:' + (on ? 'var(--teal)' : 'var(--surface-card,#fff)') +
        ';font-size:0.85rem;cursor:pointer;color:' + (on ? '#fff' : 'var(--text,#2a2a2a)') +
        ';font-weight:' + (on ? '600' : '400') + ';transition:all 0.15s;';
      btn.onclick = function() {
        _wizardMatchQState[field] = opt.value;
        try { snapshotWizardField('_matchqDraft', Object.assign({}, _wizardMatchQState)); } catch(e) {}
        renderWizardMatchQ();
      };
      el.appendChild(btn);
    });
  });
}

async function wizardConfirmMatchQ() {
  // All optional but encourage all three picked. Continue regardless.
  var btn = document.getElementById('wizardMatchqConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    if (typeof MastDB !== 'undefined' && MastDB.businessEntity) {
      await MastDB.businessEntity.update('engagement', {
        matching: {
          stage:      _wizardMatchQState.stage || null,
          bottleneck: _wizardMatchQState.bottleneck || null,
          volume:     _wizardMatchQState.volume || null,
          capturedAt: new Date().toISOString()
        }
      }).catch(function(){});
    }
    logWizardEvent('matchq', 'matchq_captured', {
      stage: _wizardMatchQState.stage,
      bottleneck: _wizardMatchQState.bottleneck,
      volume: _wizardMatchQState.volume
    });
    showWizardStep('4');
    saveWizardProgress('4', { matchqCaptured: true });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save: ' + esc(err.message || ''), true);
  }
}

// ----------------------------------------------------------------
// Fork step: dashboard now vs. finish setup (integrations + settings)
// ----------------------------------------------------------------

function renderWizardFork() {
  // Nothing dynamic to render currently; placeholder for future personalization.
}

function wizardForkBack() {
  // Back to engagement step. For non-storefront mode, that's effectively 4B; both sit on dot 4.
  showWizardStep('4');
}

function wizardForkDashboard() {
  // Skip optional integrations + settings, jump to activation.
  saveWizardProgress('fastDpa', { forkChoice: 'dashboard' });
  showWizardStep('fastDpa');
}

function wizardForkContinue() {
  // Proceed to integrations + settings.
  saveWizardProgress('7', { forkChoice: 'continue' });
  showWizardStep('7');
}

// B3: render engagement-mode cards. In-memory selection state lives
// on window._wizardEngagement until confirm.
function renderWizardEngagement() {
  var BEC = window.BusinessEntityConstants || {};
  var cards = BEC.ENGAGEMENT_MODE_CARDS || [];
  var surfaceOptions = BEC.SURFACE_OPTIONS || [];
  var defaultSurfaceByMode = BEC.DEFAULT_SURFACE_BY_MODE || {};
  var goalLabels = BEC.GOAL_LABELS || {};
  var defaults = window._wizardArchetypeDefaults || MastDB.businessEntity.archetypeDefaults('other-maker') || { goalsAvailable: [] };

  // Ensure engagement pane visible, watch pane hidden (in case of back-nav).
  var engagePane = document.getElementById('wizardStep4Engagement');
  var watchPane = document.getElementById('wizardStep4Watch');
  if (engagePane) engagePane.style.display = '';
  if (watchPane) watchPane.style.display = 'none';

  // Reword heading to acknowledge the site-intent choice from step 3.
  var headingEl = document.getElementById('wizardStep4Heading');
  var subheadEl = document.getElementById('wizardStep4Subhead');
  var intent = window._wizardSiteIntent || (wizardProgress && wizardProgress.siteIntent);
  var platformLabel = '';
  try {
    var manifest = window._wizardCrawlManifest || (wizardProgress && wizardProgress.crawlManifest) || {};
    if (manifest.platform && manifest.platform !== 'unknown') {
      platformLabel = manifest.platform.charAt(0).toUpperCase() + manifest.platform.slice(1);
    }
  } catch (e) {}
  // Reframe step 4 around what's still unknown after step 3.
  // - migrate: mode is implied (storefront); only surface is unknown.
  // - integrate: mode is sync-channels OR back-office; surface is unknown.
  // - no intent: ask everything.
  var unlockMode = !!window._wizardUnlockMode;
  var shopifyOrigin = !!window.wizardIsShopifyOrigin;
  if (headingEl && subheadEl) {
    if (shopifyOrigin) {
      // Shopify App Store install: Mast is the back-office, not the storefront.
      headingEl.textContent = 'How should Mast work with your Shopify store?';
      subheadEl.textContent = 'Mast syncs your catalog and runs the back-office alongside Shopify. Pick the role it plays — you can change this later.';
    } else if (intent === 'migrate' && !unlockMode) {
      headingEl.textContent = 'How do you want to work with Mast day-to-day?';
      subheadEl.textContent = 'You’re moving' + (platformLabel ? ' from ' + platformLabel : '') + ' to Mast as your storefront. Pick how you’ll run things.';
    } else if (intent === 'integrate' && !unlockMode) {
      headingEl.textContent = 'What should Mast do behind the scenes?';
      subheadEl.textContent = 'You’re keeping ' + (platformLabel || 'your current site') + ' out front. Pick the back-office role Mast plays.';
    } else {
      headingEl.textContent = 'How will you use Mast?';
      subheadEl.textContent = 'Pick the mode that matches your business today. You can always change this later.';
    }
  }

  // Initialize in-memory selection state. Pre-select mode from site intent if not yet chosen.
  if (!window._wizardEngagement) {
    var _intentToMode = { 'migrate': 'storefront', 'integrate': 'sync-channels' };
    // Shopify-origin tenants never default to storefront — they default to channel sync.
    var _defaultMode = shopifyOrigin ? 'sync-channels' : (_intentToMode[window._wizardSiteIntent] || null);
    window._wizardEngagement = {
      mode: _defaultMode,
      surfaceByMode: {},   // { storefront: 'hybrid', ... } so switching modes remembers per-mode surface
      goals: []
    };
    if (_defaultMode) {
      window._wizardEngagement.surfaceByMode[_defaultMode] = (defaultSurfaceByMode[_defaultMode]) || cards.find(function(c){return c.value===_defaultMode;}).defaultSurface || 'hybrid';
    }
  }
  var state = window._wizardEngagement;

  // Shopify-origin guard: storefront is never a valid selection for an App-Store
  // install, so coerce any leftover storefront state (e.g. an intent default that
  // resolved before the async Shopify check) to channel sync.
  if (shopifyOrigin && state.mode === 'storefront') {
    state.mode = 'sync-channels';
    if (!state.surfaceByMode['sync-channels']) {
      state.surfaceByMode['sync-channels'] = defaultSurfaceByMode['sync-channels'] || 'ui-first';
    }
  }

  // Filter visible cards by intent (Option 1: tie steps 3 + 4 together).
  var visibleCards = cards;
  if (shopifyOrigin) {
    // Shopify App Store install: drop "Build a Mast storefront" entirely. They only
    // ever see channel-sync (recommended) and back-office.
    visibleCards = cards.filter(function(c) { return c.value !== 'storefront'; });
  } else if (intent === 'migrate' && !unlockMode) {
    visibleCards = []; // mode is fixed at storefront; render a compact badge instead
  } else if (intent === 'integrate' && !unlockMode) {
    visibleCards = cards.filter(function(c) { return c.value === 'sync-channels' || c.value === 'back-office'; });
  }

  // Helper: build the surface-chip row used in both the inline-card path and the migrate-only standalone path.
  function _renderSurfaceRow(modeValue) {
    var row = document.createElement('div');
    row.style.cssText = 'display:grid;gap:8px;margin-top:8px;';
    var modeCard = cards.find(function(c){ return c.value === modeValue; }) || {};
    var activeSurface = state.surfaceByMode[modeValue] || defaultSurfaceByMode[modeValue] || modeCard.defaultSurface || 'hybrid';
    state.surfaceByMode[modeValue] = activeSurface;
    surfaceOptions.forEach(function(surf) {
      var card = document.createElement('div');
      var on = activeSurface === surf.value;
      card.style.cssText = 'border:2px solid ' + (on ? 'var(--teal)' : 'var(--wiz-border,var(--border,#ddd))') +
        ';border-radius:8px;padding:10px 14px;cursor:pointer;background:' +
        (on ? 'rgba(42,124,111,0.08)' : 'var(--wiz-bg,var(--surface-card,#fff))') +
        ';transition:all 0.15s;';
      card.innerHTML =
        '<div style="font-weight:' + (on ? '700' : '600') + ';font-size:0.9rem;color:var(--wiz-text,var(--text,#2a2a2a));margin-bottom:2px;">' + esc(surf.label) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(surf.hint) + '</div>';
      card.onclick = function(ev) {
        ev.stopPropagation();
        state.surfaceByMode[modeValue] = surf.value;
        renderWizardEngagement();
      };
      row.appendChild(card);
    });
    return row;
  }

  var cardsEl = document.getElementById('wizardEngagementCards');
  if (cardsEl) {
    cardsEl.innerHTML = '';

    // Migrate-path: mode is fixed at storefront. Render compact badge + standalone surface picker.
    // Never taken for a Shopify-origin install (storefront is suppressed for them).
    if (intent === 'migrate' && !unlockMode && !shopifyOrigin) {
      // Make sure state.mode is locked in (for confirm).
      if (state.mode !== 'storefront') {
        state.mode = 'storefront';
        if (!state.surfaceByMode.storefront) state.surfaceByMode.storefront = defaultSurfaceByMode.storefront || 'hybrid';
      }
      var badge = document.createElement('div');
      badge.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(42,124,111,0.08);border:1px solid var(--teal);border-radius:8px;padding:12px 14px;margin-bottom:14px;';
      badge.innerHTML =
        '<div><div style="font-weight:600;font-size:0.9rem;color:var(--text,#2a2a2a);">Mode: Storefront</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">Mast is your public site — products, orders, and content all live here.</div></div>';
      var changeLink = document.createElement('a');
      changeLink.href = '#';
      changeLink.textContent = 'Change mode';
      changeLink.style.cssText = 'font-size:0.85rem;color:var(--teal);text-decoration:none;font-weight:600;flex-shrink:0;margin-left:12px;';
      changeLink.onclick = function(e) {
        e.preventDefault();
        window._wizardUnlockMode = true;
        renderWizardEngagement();
      };
      badge.appendChild(changeLink);
      cardsEl.appendChild(badge);

      var surfaceLabel = document.createElement('div');
      surfaceLabel.style.cssText = 'font-size:0.85rem;font-weight:600;color:var(--text,#2a2a2a);margin-bottom:6px;';
      surfaceLabel.textContent = 'How do you prefer to get things done?';
      cardsEl.appendChild(surfaceLabel);
      cardsEl.appendChild(_renderSurfaceRow('storefront'));
    }

    for (var i = 0; i < visibleCards.length; i++) {
      (function(card) {
        var wrap = document.createElement('div');
        wrap.className = 'wizard-feature-card';
        var selected = state.mode === card.value;
        if (selected) wrap.setAttribute('data-selected', 'true');
        wrap.style.cssText = 'border:2px solid ' + (selected ? 'var(--teal)' : 'var(--border,#ddd)') +
          ';border-radius:8px;padding:14px 16px;cursor:pointer;background:' +
          (selected ? 'var(--teal)' : 'var(--surface-card,#fff)') + ';transition:all 0.15s;margin-bottom:8px;';
        var title = document.createElement('div');
        title.style.cssText = 'font-weight:600;font-size:0.9rem;margin-bottom:4px;color:' + (selected ? '#fff' : 'var(--text,#2a2a2a)') + ';';
        title.textContent = card.title;
        var body = document.createElement('div');
        body.style.cssText = 'font-size:0.85rem;color:' + (selected ? 'rgba(255,255,255,0.8)' : 'var(--warm-gray)') + ';margin-bottom:' + (selected ? '10px' : '0') + ';';
        body.textContent = card.body;
        wrap.appendChild(title);
        wrap.appendChild(body);
        if (selected) wrap.appendChild(_renderSurfaceRow(card.value));
        wrap.onclick = function() {
          state.mode = card.value;
          if (!state.surfaceByMode[card.value]) {
            state.surfaceByMode[card.value] = defaultSurfaceByMode[card.value] || card.defaultSurface || 'hybrid';
          }
          renderWizardEngagement();
        };
        cardsEl.appendChild(wrap);
      })(visibleCards[i]);
    }
  }

  // Continue button disabled until a mode is picked.
  var btn = document.getElementById('wizardEngagementConfirmBtn');
  if (btn) btn.disabled = !state.mode;
}

// B3: on confirm — write engagement, create import job with mode, branch for storefront.
async function wizardConfirmEngagement() {
  var BEC = window.BusinessEntityConstants || {};
  var state = window._wizardEngagement || {};
  var mode = state.mode;
  // Shopify-origin tenants can never commit to storefront mode — coerce to channel
  // sync so the storefront branch (applyStorefrontConfig / full-storefront / fork)
  // is unreachable even if a stale selection slipped through.
  if (window.wizardIsShopifyOrigin && mode === 'storefront') {
    mode = 'sync-channels';
    state.mode = 'sync-channels';
  }
  if (!mode) { showToast('Pick a mode to continue.', true); return; }
  // Reset the "Change mode" override so future re-entries to step 4 re-lock to intent.
  window._wizardUnlockMode = false;
  var surface = (state.surfaceByMode && state.surfaceByMode[mode])
    || (BEC.DEFAULT_SURFACE_BY_MODE && BEC.DEFAULT_SURFACE_BY_MODE[mode])
    || 'hybrid';
  var goals = (state.goals || []).slice();
  // Show ALL modules by default — better discoverability than asking users to pick
  // before they know what's available. They can hide modules later in Settings.
  var modulesShown = ['products','sales','marketing','retention','events','classes','finance','operations','customer-service'];

  var btn = document.getElementById('wizardEngagementConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    await MastDB.businessEntity.update('engagement', {
      mode: mode,
      surface: surface,
      goals: goals,
      modulesShown: modulesShown,
      updatedAt: new Date().toISOString()
    });

    var modeToJob = (BEC.ENGAGEMENT_MODE_TO_JOB_MODE || {});
    var jobMode = modeToJob[mode] || 'storefront';

    if (mode === 'storefront') {
      var extracted = window._wizardExtracted || {};
      var detected = window._wizardDetectedModules || [];
      try { await applyStorefrontConfig(extracted, detected); }
      catch (e) { console.warn('[B3] applyStorefrontConfig failed:', e && e.message); }
      await wizardCreateImportJob({ mode: jobMode });
    } else if (mode === 'sync-channels') {
      await wizardCreateImportJob({ mode: jobMode });
      try { _registerChannelSuggestionCards(); } catch (e) { /* non-blocking */ }
    } else {
      // back-office
      await wizardCreateImportJob({ mode: jobMode });
    }

    logWizardEvent(4, 'engagement_chosen', {
      mode: mode, surface: surface, goalsCount: goals.length
    });

    if (mode === 'storefront') {
      // Set featureMode for storefront (import job already kicked off above).
      await MastDB.businessEntity.update('presence', { featureMode: 'full-storefront' }).catch(function() {});
    }
    // Always advance to the next step instead of swapping panes in-place. Avoids
    // the "progress dot stays on 4 but content changes" confusion. Quick-path
    // storefront → activation page; non-storefront → feature picker; full path → calibration.
    // New flow: storefront mode → fork (decide dashboard vs. continue setup).
    // Non-storefront → 4B feature pages (then on 4B confirm → fork).
    var nextStep = (mode === 'storefront') ? 'fork' : '4b';
    showWizardStep(nextStep);
    saveWizardProgress(nextStep, { engagementConfirmed: { mode: mode, surface: surface } });
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
    showToast('Could not save engagement: ' + esc(err.message || ''), true);
  }
}

// B3: queue dashboard cards inviting user to connect detected external channels
// (Etsy, Shopify, etc.) for sync-channels mode. Reads discovery.inferredChannels[]
// from the latest import job (C8 output).
async function _registerChannelSuggestionCards() {
  if (typeof registerDashCard !== 'function') return;
  try {
    var view = await MastDB.businessEntity.get('discovery');
    var disc = view && view.data;
    var channels = (disc && disc.inferredChannels) || [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      registerDashCard({
        id: 'channel-suggestion-' + ch,
        title: 'We saw your ' + ch.charAt(0).toUpperCase() + ch.slice(1) + ' shop',
        body: 'Connect it so Mast can sync products and orders.',
        ctaLabel: 'Connect ' + ch,
        source: 'wizard-channel-suggestion'
      });
    }
  } catch (e) { /* non-blocking */ }
}

// Step 4: calibration form renderer. Populates revenue dropdown, placeholder, role + team size buttons.
function renderWizardCalibration() {
  var BEC = window.BusinessEntityConstants || {};
  var brackets = BEC.REVENUE_BRACKETS || [];
  var sel = document.getElementById('wizardRevenueBracket');
  var txt = document.getElementById('wizardWishStatement');
  var cnt = document.getElementById('wizardWishCount');
  if (sel && sel.options.length <= 1) {
    for (var i = 0; i < brackets.length; i++) {
      var o = document.createElement('option');
      o.value = brackets[i].value;
      o.textContent = brackets[i].label;
      sel.appendChild(o);
    }
  }
  if (txt) {
    txt.placeholder = BEC.WISH_STATEMENT_PLACEHOLDER || '';
    // Restore prior draft if user reloaded mid-step
    if (!txt.value && wizardProgress && wizardProgress._calibDraft && wizardProgress._calibDraft.wishStatement) {
      txt.value = wizardProgress._calibDraft.wishStatement;
    }
    txt.oninput = function() {
      if (cnt) cnt.textContent = (txt.value || '').length + ' / 500';
      try {
        var d = (wizardProgress && wizardProgress._calibDraft) || {};
        d.wishStatement = txt.value;
        snapshotWizardField('_calibDraft', d);
      } catch(e) {}
    };
    if (cnt) cnt.textContent = (txt.value || '').length + ' / 500';
  }
  if (sel) {
    if (!sel.value && wizardProgress && wizardProgress._calibDraft && wizardProgress._calibDraft.revenueBracket) {
      sel.value = wizardProgress._calibDraft.revenueBracket;
    }
    // Chain onto the existing inline onchange (projection updater) instead of replacing it.
    sel.addEventListener('change', function() {
      try {
        var d = (wizardProgress && wizardProgress._calibDraft) || {};
        d.revenueBracket = sel.value;
        snapshotWizardField('_calibDraft', d);
      } catch(e) {}
    });
  }
  _wizardUpdateBracketProjection('wizardRevenueBracket', 'wizardRevenueBracketProjection');

  // Role buttons (step 4 — unique IDs wizardRoleOptions4, wizardTeamSizeOptions4)
  var cal4State = window._wizardCalibrationPeopleState = window._wizardCalibrationPeopleState || {};
  // Restore role/team draft if user reloaded mid-step
  if ((!cal4State.role || !cal4State.teamSize) && wizardProgress && wizardProgress._calibDraft) {
    if (!cal4State.role && wizardProgress._calibDraft.role) cal4State.role = wizardProgress._calibDraft.role;
    if (!cal4State.teamSize && wizardProgress._calibDraft.teamSize) cal4State.teamSize = wizardProgress._calibDraft.teamSize;
  }
  var rolesEl = document.getElementById('wizardRoleOptions4');
  if (rolesEl && rolesEl.childNodes.length === 0) {
    var roles = BEC.PRIMARY_CONTACT_ROLES || [];
    roles.forEach(function(role) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = role.label;
      btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:2px solid var(--border,#ccc);background:var(--surface-card,#fff);font-size:0.78rem;cursor:pointer;color:var(--text,#2a2a2a);transition:all 0.15s;';
      btn.dataset.value = role.value;
      btn.onclick = function() {
        cal4State.role = role.value;
        Array.prototype.forEach.call(rolesEl.children, function(c) {
          var s = cal4State.role === c.dataset.value;
          c.style.border = '2px solid ' + (s ? 'var(--teal)' : 'var(--border,#ccc)');
          c.style.background = s ? 'var(--teal)' : 'var(--surface-card,#fff)';
          c.style.color = s ? '#fff' : 'var(--text,#2a2a2a)';
          c.style.fontWeight = s ? '600' : '400';
        });
        try {
          var d = (wizardProgress && wizardProgress._calibDraft) || {};
          d.role = cal4State.role;
          snapshotWizardField('_calibDraft', d);
        } catch(e) {}
      };
      rolesEl.appendChild(btn);
    });
  }
  var sizeEl = document.getElementById('wizardTeamSizeOptions4');
  if (sizeEl && sizeEl.childNodes.length === 0) {
    var bands = BEC.TEAM_SIZE_BANDS || [];
    bands.forEach(function(band) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = band.label;
      btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:2px solid var(--border,#ccc);background:var(--surface-card,#fff);font-size:0.78rem;cursor:pointer;color:var(--text,#2a2a2a);transition:all 0.15s;';
      btn.dataset.value = band.value;
      btn.onclick = function() {
        cal4State.teamSize = band.value;
        cal4State.hasEmployees = band.value !== 'solo';
        Array.prototype.forEach.call(sizeEl.children, function(c) {
          var s = cal4State.teamSize === c.dataset.value;
          c.style.border = '2px solid ' + (s ? 'var(--teal)' : 'var(--border,#ccc)');
          c.style.background = s ? 'var(--teal)' : 'var(--surface-card,#fff)';
          c.style.color = s ? '#fff' : 'var(--text,#2a2a2a)';
          c.style.fontWeight = s ? '600' : '400';
        });
        try {
          var d = (wizardProgress && wizardProgress._calibDraft) || {};
          d.teamSize = cal4State.teamSize;
          snapshotWizardField('_calibDraft', d);
        } catch(e) {}
      };
      sizeEl.appendChild(btn);
    });
  }
  // Apply restored selection styles after buttons are present (handles reload restore).
  function _applySel(parentEl, value) {
    if (!parentEl || !value) return;
    Array.prototype.forEach.call(parentEl.children, function(c) {
      var s = value === c.dataset.value;
      c.style.border = '2px solid ' + (s ? 'var(--teal)' : 'var(--border,#ccc)');
      c.style.background = s ? 'var(--teal)' : 'var(--surface-card,#fff)';
      c.style.color = s ? '#fff' : 'var(--text,#2a2a2a)';
      c.style.fontWeight = s ? '600' : '400';
    });
  }
  _applySel(rolesEl, cal4State.role);
  _applySel(sizeEl, cal4State.teamSize);
}

// Step 5 (calibration) back: storefront mode skipped 4b, so go straight to 4; otherwise 4b.
function wizardStep5Back() {
  var eng = window._wizardEngagement || {};
  showWizardStep(eng.mode === 'storefront' ? '4' : '4b');
}

// Step 4: write engagement.calibration + people, advance to step 5 (full) or 3 (quick fallback).
async function wizardConfirmCalibration() {
  var sel = document.getElementById('wizardRevenueBracket');
  var txt = document.getElementById('wizardWishStatement');
  var btn = document.getElementById('wizardCalibrationConfirmBtn');
  if (btn) btn.disabled = true;
  var bracket = sel ? (sel.value || '') : '';
  var wish = txt ? (txt.value || '').trim() : '';
  if (wish.length > 500) wish = wish.slice(0, 500);
  var calibration = { capturedAt: new Date().toISOString() };
  if (bracket) calibration.revenueBracket = bracket;
  if (wish) calibration.wishStatement = wish;
  window._wizardRevenueBracket = bracket || '';

  // Role / team size captured on step 4
  var cal4State = window._wizardCalibrationPeopleState || {};

  try {
    await MastDB.businessEntity.update('engagement', { calibration: calibration });
    if (cal4State.role || cal4State.teamSize) {
      var peoplePayload = {};
      if (cal4State.role) peoplePayload.primaryContact = { role: cal4State.role };
      if (cal4State.teamSize) {
        peoplePayload.teamSize = cal4State.teamSize;
        peoplePayload.hasEmployees = cal4State.teamSize !== 'solo';
      }
      await MastDB.businessEntity.update('people', peoplePayload);
    }
    logWizardEvent(5, 'calibration_saved', {
      revenueBracket: bracket || null,
      wishStatementLength: wish.length,
      role: cal4State.role || null,
      teamSize: cal4State.teamSize || null
    });
    // Calibration is full-path only; advance to module selector.
    showWizardStep('6');
    saveWizardProgress('6', { calibrationCaptured: true });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save calibration: ' + esc(err.message || ''), true);
  }
}

// Step 4 skip — records capturedAt and advances.
async function wizardSkipCalibration() {
  var btn = document.getElementById('wizardCalibrationConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    await MastDB.businessEntity.update('engagement', {
      calibration: { capturedAt: new Date().toISOString() }
    });
    logWizardEvent(5, 'calibration_skipped', {});
    showWizardStep('6');
    saveWizardProgress('6', { calibrationCaptured: false });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not advance: ' + esc(err.message || ''), true);
  }
}

// B1a: user can defer archetype — write 'other-maker' as escape hatch (spec §4 D1).
// ----------------------------------------------------------------
// Step 1.5: Brand Identity
// ----------------------------------------------------------------

async function wizardConfirmBrand() {
  var nameEl = document.getElementById('wizardBrandName');
  var taglineEl = document.getElementById('wizardBrandTagline');
  var logoEl = document.getElementById('wizardBrandLogo');
  var btn = document.getElementById('wizardBrandConfirmBtn');
  var nameErrEl = document.getElementById('wizardBrandNameError');

  var businessName = nameEl ? (nameEl.value || '').trim() : '';
  var tagline = taglineEl ? (taglineEl.value || '').trim() : '';

  // Validation
  if (!businessName) {
    if (nameErrEl) nameErrEl.style.display = '';
    if (nameEl) nameEl.focus();
    return;
  }
  if (nameErrEl) nameErrEl.style.display = 'none';
  if (btn) btn.disabled = true;

  try {
    // All brand writes go through MastBrandSync — single writer, fans out to
    // every legacy mirror path (storefront nav, newsletter, platform, etc.).
    await MastBrandSync.setName(businessName);
    await MastBrandSync.setTagline(tagline);

    // Logo upload (best-effort, non-blocking). Sync helper writes the canonical
    // Brand-module structure AND mirrors to all legacy paths in one call.
    if (logoEl && logoEl.files && logoEl.files[0]) {
      (function(file) {
        try {
          var storagePath = MastDB.tenantId() + '/brand/logo';
          var storageRef = firebase.storage().ref(storagePath);
          var fmt = (file.name && file.name.split('.').pop().toLowerCase()) || 'png';
          storageRef.put(file).then(function(snapshot) {
            return snapshot.ref.getDownloadURL();
          }).then(function(url) {
            MastBrandSync.setLogo({ url: url, storagePath: storagePath, format: fmt }).catch(function(e) {
              console.warn('[Wizard] BrandSync.setLogo failed:', e && e.message);
            });
            // Mark as user-set so applyStorefrontConfig/_applyPlatformRegistry skip overwriting.
            window._wizardUserSetLogo = true;
          }).catch(function(e) { console.warn('[Wizard] Logo upload failed:', e && e.message); });
        } catch (e) { /* non-fatal */ }
      })(logoEl.files[0]);
    }

    logWizardEvent(2, 'brand_confirmed', { hasTagline: !!tagline, hasLogo: !!(logoEl && logoEl.files && logoEl.files[0]) });
    // New flow: brand → matchq (stage + bottleneck + volume) → engagement
    showWizardStep('matchq');
    saveWizardProgress('matchq', { brandConfirmed: true, businessName: businessName });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save brand: ' + esc(err.message || ''), true);
  }
}

// ----------------------------------------------------------------
// Step 2: Business Identity (type + output + channels + tools)
// ----------------------------------------------------------------

var _wizardBizIdentityState = null;
var _wizardBizSubStep = '1A';

function renderWizardBizIdentity() {
  var BEC = window.BusinessEntityConstants || {};
  var state = _wizardBizIdentityState = _wizardBizIdentityState || {
    businessCategory: null,  // e.g. 'makers', 'food-bev', 'services'
    archetype: null,          // specific subtype within category
    businessType: null,       // derived: 'produce' | 'resell' | 'teach'
    revenueChannels: [],      // ordered priority array
    currentTools: [],         // payment tools (unordered)
    shippingTools: []         // shipping tools ordered by priority
  };
  // Restore from saved progress if in-memory state was lost (e.g. back-nav to step 0 then forward)
  if (!state.businessCategory && wizardProgress && wizardProgress._bizIdentity) {
    var _saved = wizardProgress._bizIdentity;
    if (_saved.businessCategory) state.businessCategory = _saved.businessCategory;
    if (_saved.archetype) state.archetype = _saved.archetype;
    if (_saved.businessType) state.businessType = _saved.businessType;
    if (_saved.revenueChannels) state.revenueChannels = _saved.revenueChannels.slice();
    if (_saved.shippingTools) state.shippingTools = _saved.shippingTools.slice();
    if (_saved.currentTools) state.currentTools = _saved.currentTools.slice();
  }
  // Pre-fill from site scan when nothing saved yet — user confirms/adjusts.
  if (!state.businessCategory || !state.archetype || state.revenueChannels.length === 0) {
    var _ext = window._wizardExtracted || {};
    var _cats = BEC.BUSINESS_CATEGORIES || [];
    // Map inferredArchetype back to its parent category + archetype.
    if (!state.businessCategory && _ext.inferredArchetype) {
      for (var _ci = 0; _ci < _cats.length; _ci++) {
        for (var _sj = 0; _sj < _cats[_ci].subtypes.length; _sj++) {
          if (_cats[_ci].subtypes[_sj].value === _ext.inferredArchetype) {
            state.businessCategory = _cats[_ci].value;
            state.archetype = _ext.inferredArchetype;
            state.businessType = _cats[_ci].businessType || null;
            break;
          }
        }
        if (state.businessCategory) break;
      }
    }
    // Pre-fill channel priority list from declared/inferred channels.
    if (state.revenueChannels.length === 0 && Array.isArray(_ext.declaredChannels) && _ext.declaredChannels.length) {
      state.revenueChannels = _ext.declaredChannels.slice();
    }
  }
  // Snapshot current step-1 state on every render so partial input survives a reload.
  try { snapshotWizardField('_bizIdentity', {
    businessCategory: state.businessCategory,
    archetype: state.archetype,
    businessType: state.businessType,
    revenueChannels: (state.revenueChannels || []).slice(),
    shippingTools: (state.shippingTools || []).slice(),
    currentTools: (state.currentTools || []).slice()
  }); } catch(e) {}
  var depth = window._wizardOnboardingDepth || 'quick';

  // Enforce which sub-step panel is visible (safe to call on every re-render)
  showWizardSubStep(_wizardBizSubStep || '1A');

  function solidChipCss(sel) {
    return sel
      ? 'padding:7px 14px;border-radius:999px;border:2px solid var(--teal);background:var(--teal);font-size:0.85rem;cursor:pointer;font-family:inherit;color:#fff;font-weight:600;transition:all 0.15s;'
      : 'padding:7px 14px;border-radius:999px;border:1px solid var(--border,#ccc);background:var(--surface-card,#fff);font-size:0.85rem;cursor:pointer;font-family:inherit;color:var(--text,#2a2a2a);transition:all 0.15s;';
  }
  function multiChipCss(chkd) {
    return 'display:inline-flex;align-items:center;padding:6px 12px;border-radius:999px;' +
      (chkd
        ? 'border:2px solid var(--teal);background:var(--teal);font-weight:600;color:#fff;'
        : 'border:1px solid var(--wiz-border,var(--border,#ccc));background:var(--wiz-bg,var(--surface-card,#fff));color:var(--wiz-text,var(--text,#2a2a2a));') +
      'cursor:pointer;font-size:0.78rem;transition:all 0.15s;';
  }

  // Part A: Category dropdown + archetype dropdown
  var catEl = document.getElementById('wizardBizCategory');
  if (catEl && catEl.options.length <= 1) {
    var cats = BEC.BUSINESS_CATEGORIES || [];
    cats.forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value = cat.value;
      opt.textContent = cat.label + ' — ' + cat.description;
      catEl.appendChild(opt);
    });
    catEl.value = state.businessCategory || '';
    catEl.onchange = function() {
      state.businessCategory = catEl.value || null;
      state.archetype = null;
      // Derive businessType from category
      var cats2 = BEC.BUSINESS_CATEGORIES || [];
      var catDef = null;
      for (var i = 0; i < cats2.length; i++) { if (cats2[i].value === state.businessCategory) { catDef = cats2[i]; break; } }
      state.businessType = catDef ? catDef.businessType : null;
      // Repopulate archetype dropdown
      var arcEl = document.getElementById('wizardBizArchetype');
      var arcRow = document.getElementById('wizardArchetypeRow');
      if (arcEl) {
        arcEl.innerHTML = '<option value="">Select a type…</option>';
        if (catDef) {
          catDef.subtypes.forEach(function(sub) {
            var o = document.createElement('option');
            o.value = sub.value;
            o.textContent = sub.label;
            arcEl.appendChild(o);
          });
        }
      }
      if (arcRow) arcRow.style.display = catDef ? '' : 'none';
      renderWizardBizIdentity();
      var _btn0 = document.getElementById('wizardSubStep1ABtn');
      if (_btn0) _btn0.disabled = !(state.businessCategory && state.archetype);
    };
  } else if (catEl) {
    catEl.value = state.businessCategory || '';
  }

  // Archetype dropdown — populate if category already set but archetype row needs refresh
  var arcRow = document.getElementById('wizardArchetypeRow');
  var arcEl = document.getElementById('wizardBizArchetype');
  if (arcRow) arcRow.style.display = state.businessCategory ? '' : 'none';
  if (arcEl && state.businessCategory && arcEl.options.length <= 1) {
    var cats3 = BEC.BUSINESS_CATEGORIES || [];
    for (var ci = 0; ci < cats3.length; ci++) {
      if (cats3[ci].value === state.businessCategory) {
        cats3[ci].subtypes.forEach(function(sub) {
          var o = document.createElement('option');
          o.value = sub.value;
          o.textContent = sub.label;
          arcEl.appendChild(o);
        });
        break;
      }
    }
  }
  if (arcEl) {
    arcEl.value = state.archetype || '';
    arcEl.onchange = function() {
      state.archetype = arcEl.value || null;
      var _btn1 = document.getElementById('wizardSubStep1ABtn');
      if (_btn1) _btn1.disabled = !(state.businessCategory && state.archetype);
      renderWizardBizIdentity();
    };
  }

  // Part C: Revenue channels — priority picker
  var revChannels = BEC.REVENUE_CHANNELS || [];
  var revChanMap = {};
  revChannels.forEach(function(ch) { revChanMap[ch.value] = ch; });

  var chanAvailEl = document.getElementById('wizardBizChannels');
  if (chanAvailEl) {
    chanAvailEl.innerHTML = '';
    var availCount = 0;
    revChannels.forEach(function(ch) {
      if (state.revenueChannels.indexOf(ch.value) >= 0) return;
      availCount++;
      var item = document.createElement('div');
      item.style.cssText = 'padding:6px 10px;border:1px solid var(--wiz-border,#ddd);border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:0.85rem;background:var(--wiz-input,#fff);color:var(--wiz-text,#2a2a2a);transition:border-color 0.12s;';
      var nameSpan = document.createElement('span');
      nameSpan.textContent = ch.label;
      var addSpan = document.createElement('span');
      addSpan.style.cssText = 'color:var(--teal);font-size:1rem;line-height:1;margin-left:6px;flex-shrink:0;';
      addSpan.textContent = '+';
      item.appendChild(nameSpan);
      item.appendChild(addSpan);
      item.onclick = function() {
        state.revenueChannels.push(ch.value);
        renderWizardBizIdentity();
      };
      chanAvailEl.appendChild(item);
    });
    if (availCount === 0) {
      chanAvailEl.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">All added</div>';
    }
  }

  var chanPrioEl = document.getElementById('wizardBizChannelsPriority');
  if (chanPrioEl) {
    chanPrioEl.innerHTML = '';
    if (state.revenueChannels.length === 0) {
      chanPrioEl.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">None yet — click to add</div>';
    }
    state.revenueChannels.forEach(function(val, idx) {
      var ch = revChanMap[val];
      if (!ch) return;
      var item = document.createElement('div');
      item.style.cssText = 'padding:5px 7px;background:var(--teal);color:#fff;border-radius:5px;display:flex;align-items:center;gap:3px;margin-bottom:4px;font-size:0.85rem;';
      var badge = document.createElement('span');
      badge.style.cssText = 'min-width:16px;font-size:0.72rem;font-weight:700;opacity:0.75;flex-shrink:0;';
      badge.textContent = (idx + 1) + '.';
      var lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      lbl.textContent = ch.label;
      function mkBtn(icon, disabled) {
        var b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'background:rgba(255,255,255,0.2);border:none;border-radius:3px;color:#fff;cursor:pointer;padding:1px 5px;font-size:0.72rem;line-height:1.4;flex-shrink:0;' + (disabled ? 'opacity:0.3;pointer-events:none;' : '');
        b.textContent = icon;
        return b;
      }
      var btnUp   = mkBtn('↑', idx === 0);
      var btnDown = mkBtn('↓', idx === state.revenueChannels.length - 1);
      var btnX    = mkBtn('×', false);
      btnX.style.cssText += 'font-size:0.85rem;';
      btnUp.onclick = function() { state.revenueChannels.splice(idx, 1); state.revenueChannels.splice(idx - 1, 0, val); renderWizardBizIdentity(); };
      btnDown.onclick = function() { state.revenueChannels.splice(idx, 1); state.revenueChannels.splice(idx + 1, 0, val); renderWizardBizIdentity(); };
      btnX.onclick = function() { state.revenueChannels.splice(idx, 1); renderWizardBizIdentity(); };
      item.appendChild(badge); item.appendChild(lbl); item.appendChild(btnUp); item.appendChild(btnDown); item.appendChild(btnX);
      chanPrioEl.appendChild(item);
    });
  }
  // Part D: Current tools — full path only (sub-steps 1C and 1D are only reachable on full path)
  if (depth === 'full') {
    var allTools = BEC.CURRENT_TOOLS || [];

    // Payment — chips (unordered)
    var payContainer = document.getElementById('wizardToolsPaymentChips');
    if (payContainer) {
      payContainer.innerHTML = '';
      allTools.filter(function(t) { return t.category === 'payment'; }).forEach(function(tool) {
        var chip = document.createElement('label');
        var chkd = state.currentTools.indexOf(tool.value) >= 0;
        chip.style.cssText = multiChipCss(chkd);
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
        cb.checked = chkd;
        cb.onchange = function() {
          var idx = state.currentTools.indexOf(tool.value);
          if (cb.checked && idx < 0) state.currentTools.push(tool.value);
          else if (!cb.checked && idx >= 0) state.currentTools.splice(idx, 1);
          chip.style.cssText = multiChipCss(cb.checked);
        };
        var span = document.createElement('span');
        span.textContent = tool.label;
        chip.appendChild(cb); chip.appendChild(span);
        payContainer.appendChild(chip);
      });
    }

    // Shipping — priority picker
    if (!state.shippingTools) state.shippingTools = [];
    var shipTools = allTools.filter(function(t) { return t.category === 'shipping'; });
    var shipMap = {};
    shipTools.forEach(function(t) { shipMap[t.value] = t; });

    var shipAvailEl = document.getElementById('wizardShippingToolsAvail');
    if (shipAvailEl) {
      shipAvailEl.innerHTML = '';
      var shipAvailCount = 0;
      shipTools.forEach(function(tool) {
        if (state.shippingTools.indexOf(tool.value) >= 0) return;
        shipAvailCount++;
        var item = document.createElement('div');
        item.style.cssText = 'padding:6px 10px;border:1px solid var(--wiz-border,#ddd);border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:0.85rem;background:var(--wiz-input,#fff);color:var(--wiz-text,#2a2a2a);';
        var ns = document.createElement('span'); ns.textContent = tool.label;
        var as = document.createElement('span'); as.style.cssText = 'color:var(--teal);font-size:1rem;line-height:1;margin-left:6px;flex-shrink:0;'; as.textContent = '+';
        item.appendChild(ns); item.appendChild(as);
        item.onclick = function() { state.shippingTools.push(tool.value); renderWizardBizIdentity(); };
        shipAvailEl.appendChild(item);
      });
      if (shipAvailCount === 0) {
        shipAvailEl.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">All added</div>';
      }
    }

    var shipPrioEl = document.getElementById('wizardShippingToolsPriority');
    if (shipPrioEl) {
      shipPrioEl.innerHTML = '';
      if (state.shippingTools.length === 0) {
        shipPrioEl.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">None yet — click to add</div>';
      }
      state.shippingTools.forEach(function(val, idx) {
        var tool = shipMap[val];
        if (!tool) return;
        var item = document.createElement('div');
        item.style.cssText = 'padding:5px 7px;background:var(--teal);color:#fff;border-radius:5px;display:flex;align-items:center;gap:3px;margin-bottom:4px;font-size:0.85rem;';
        var badge = document.createElement('span');
        badge.style.cssText = 'min-width:16px;font-size:0.72rem;font-weight:700;opacity:0.75;flex-shrink:0;';
        badge.textContent = (idx + 1) + '.';
        var lbl = document.createElement('span'); lbl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; lbl.textContent = tool.label;
        function mkSBtn(icon, disabled) {
          var b = document.createElement('button');
          b.type = 'button';
          b.style.cssText = 'background:rgba(255,255,255,0.2);border:none;border-radius:3px;color:#fff;cursor:pointer;padding:1px 5px;font-size:0.72rem;line-height:1.4;flex-shrink:0;' + (disabled ? 'opacity:0.3;pointer-events:none;' : '');
          b.textContent = icon; return b;
        }
        var bUp   = mkSBtn('↑', idx === 0);
        var bDown = mkSBtn('↓', idx === state.shippingTools.length - 1);
        var bX    = mkSBtn('×', false); bX.style.cssText += 'font-size:0.85rem;';
        bUp.onclick   = function() { state.shippingTools.splice(idx,1); state.shippingTools.splice(idx-1,0,val); renderWizardBizIdentity(); };
        bDown.onclick = function() { state.shippingTools.splice(idx,1); state.shippingTools.splice(idx+1,0,val); renderWizardBizIdentity(); };
        bX.onclick    = function() { state.shippingTools.splice(idx,1); renderWizardBizIdentity(); };
        item.appendChild(badge); item.appendChild(lbl); item.appendChild(bUp); item.appendChild(bDown); item.appendChild(bX);
        shipPrioEl.appendChild(item);
      });
    }
  }

  // Enable the 1A Continue button when category + archetype are both selected
  var confirmBtn = document.getElementById('wizardSubStep1ABtn');
  if (confirmBtn) {
    confirmBtn.disabled = !(state.businessCategory && state.archetype);
  }
}

function showWizardSubStep(sub) {
  _wizardBizSubStep = sub;
  // Persist position so a reload mid-Step 1 returns to the same sub-step.
  try { _wizardLsSave({ _bizSubStep: sub }); } catch(e) {}
  ['1A','1B','1C','1D'].forEach(function(s) {
    var el = document.getElementById('wizardSubStep' + s);
    if (el) el.style.display = (s === sub) ? '' : 'none';
  });
  // Update breadcrumb track labels
  var depth = window._wizardOnboardingDepth || 'quick';
  var labels = {
    '1A': 'Business type',
    '1B': 'Sales channels',
    '1C': 'Payment tools',
    '1D': 'Shipping platforms'
  };
  var subOrder = depth === 'full' ? ['1A','1B','1C','1D'] : ['1A','1B'];
  var idx = subOrder.indexOf(sub);
  var trackEl = document.getElementById('wizardSubStepTrack' + sub);
  if (trackEl) trackEl.textContent = (labels[sub] || '') + ' · ' + (idx + 1) + ' of ' + subOrder.length;
  // Render A-B-C-D letter row using the wizard-letter-* classes (smaller dots,
  // fixed-width connector lines so spacing matches the numbered bar's 1—2 gap).
  var dotsEl = document.getElementById('wizardSubStepDots');
  if (dotsEl) {
    var html = '';
    for (var i = 0; i < subOrder.length; i++) {
      var letter = subOrder[i].charAt(1); // 'A','B','C','D'
      var cls = 'wizard-letter-dot';
      if (i < idx) cls += ' completed';
      else if (i === idx) cls += ' active';
      html += '<div class="' + cls + '" title="' + labels[subOrder[i]] + '">' + letter + '</div>';
      if (i < subOrder.length - 1) {
        var lineCls = 'wizard-letter-line' + (i < idx ? ' completed' : '');
        html += '<div class="' + lineCls + '"></div>';
      }
    }
    dotsEl.innerHTML = html;
  }
}

function wizardBizNext1A() {
  var state = _wizardBizIdentityState || {};
  if (!state.businessCategory || !state.archetype) {
    showToast('Please select your business category and type.', true);
    return;
  }
  showWizardSubStep('1B');
  renderWizardBizIdentity();
}

function wizardBizNext1B() {
  var depth = window._wizardOnboardingDepth || 'quick';
  if (depth === 'full') {
    showWizardSubStep('1C');
    renderWizardBizIdentity();
  } else {
    wizardConfirmBizIdentity();
  }
}

function wizardBizNext1C() {
  showWizardSubStep('1D');
  renderWizardBizIdentity();
}

async function wizardConfirmBizIdentity() {
  var state = _wizardBizIdentityState || {};
  if (!state.businessCategory || !state.archetype) {
    showToast('Please select your business category and type.', true);
    return;
  }

  // businessType is derived from category; use it directly as effectiveType
  var effectiveType = state.businessType || 'produce';
  var primaryOutput = effectiveType === 'teach' ? 'classes' : 'physical';

  var btn = document.getElementById('wizardBizIdentityConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    var identityUpdate = {
      businessCategory: state.businessCategory,
      archetype: state.archetype,
      businessType: state.businessType,
      effectiveBusinessType: effectiveType,
      primaryOutput: primaryOutput
    };
    await MastDB.businessEntity.update('identity', identityUpdate);
    var presenceUpdate = {};
    if (state.revenueChannels.length) presenceUpdate.revenueChannels = state.revenueChannels.slice();
    if (state.currentTools.length)    presenceUpdate.currentTools     = state.currentTools.slice();
    if (state.shippingTools && state.shippingTools.length) presenceUpdate.shippingTools = state.shippingTools.slice();
    if (Object.keys(presenceUpdate).length) {
      await MastDB.businessEntity.update('presence', presenceUpdate);
    }
    logWizardEvent(1, 'biz_identity_confirmed', {
      businessCategory: state.businessCategory,
      archetype: state.archetype,
      businessType: state.businessType,
      primaryOutput: primaryOutput,
      revenueChannelsCount: state.revenueChannels.length,
      toolsCount: state.currentTools.length,
      shippingToolsCount: (state.shippingTools || []).length
    });
    // Archetype collected in step 2 — go straight to brand.
    window._wizardArchetypeDefaults = MastDB.businessEntity.archetypeDefaults(state.archetype);
    var extracted = window._wizardExtracted || {};
    var brandNameEl = document.getElementById('wizardBrandName');
    if (brandNameEl && !brandNameEl.value && extracted.businessName) brandNameEl.value = extracted.businessName;
    var brandTaglineEl = document.getElementById('wizardBrandTagline');
    if (brandTaglineEl && !brandTaglineEl.value && extracted.tagline) brandTaglineEl.value = extracted.tagline;
    showWizardStep('2');
    saveWizardProgress('2', {
      bizIdentityConfirmed: true,
      archetypeConfirmed: state.archetype,
      _bizIdentity: {
        businessCategory: state.businessCategory,
        archetype: state.archetype,
        businessType: state.businessType,
        revenueChannels: state.revenueChannels.slice(),
        shippingTools: (state.shippingTools || []).slice(),
        currentTools: state.currentTools.slice()
      }
    });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save: ' + esc(err.message || ''), true);
  }
}

// ----------------------------------------------------------------
// Step 3b: Feature Pages (for sync-channels and back-office modes)
// ----------------------------------------------------------------

var _wizardSelectedFeaturePages = [];

function renderWizardFeaturePages() {
  var BEC = window.BusinessEntityConstants || {};
  var pages = BEC.FEATURE_PAGE_OPTIONS || [];
  var el = document.getElementById('wizardFeaturePageCards');
  if (!el) return;
  el.innerHTML = '';
  pages.forEach(function(page) {
    var card = document.createElement('div');
    card.className = 'wizard-feature-card';
    var sel = _wizardSelectedFeaturePages.indexOf(page.value) >= 0;
    if (sel) card.setAttribute('data-selected', 'true');
    else card.removeAttribute('data-selected');
    card.style.cssText = 'border:2px solid ' + (sel ? 'var(--teal)' : 'var(--border,#ddd)') +
      ';border-radius:8px;padding:12px 16px;cursor:pointer;background:' +
      (sel ? 'rgba(42,124,111,0.18)' : 'var(--surface-card,#fff)') +
      ';display:flex;align-items:flex-start;gap:10px;transition:all 0.15s;';
    var textDiv = document.createElement('div');
    textDiv.innerHTML = '<div style="font-weight:' + (sel ? '700' : '600') + ';font-size:0.9rem;margin-bottom:3px;color:var(--text,#2a2a2a);">' + esc(page.label) + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(page.description) + '</div>';
    card.appendChild(textDiv);
    card.onclick = function() { toggleFeaturePage(page.value); };
    el.appendChild(card);
  });
}

function toggleFeaturePage(value) {
  var idx = _wizardSelectedFeaturePages.indexOf(value);
  if (idx >= 0) _wizardSelectedFeaturePages.splice(idx, 1);
  else _wizardSelectedFeaturePages.push(value);
  try { snapshotWizardField('_featurePagesDraft', _wizardSelectedFeaturePages.slice()); } catch(e) {}
  renderWizardFeaturePages();
}

async function wizardConfirmFeaturePages() {
  var btn = document.getElementById('wizardFeaturePagesConfirmBtn');
  if (btn) btn.disabled = true;
  var selected = _wizardSelectedFeaturePages.slice();
  var engagement = window._wizardEngagement || {};
  var mode = engagement.mode || 'back-office';
  try {
    if (selected.length > 0) {
      await MastDB.businessEntity.applyFeaturesOnlyConfig(selected);
    } else {
      await MastDB.businessEntity.setFeatureMode('none');
    }
    logWizardEvent('4b', 'feature_pages_confirmed', {
      mode: mode, selectedPages: selected, count: selected.length
    });
  } catch (err) {
    // Saving features must NEVER strand the user — log it and continue. Any
    // resulting gap is backfilled / flagged at launch, not blocked here.
    console.warn('[Wizard] feature-pages save failed, continuing anyway:', err && err.message);
    logWizardEvent('4b', 'feature_pages_save_failed_nonblocking', { mode: mode, message: (err && err.message) || 'unknown' });
  }
  // After 4B feature pages, route everyone to fork (decide dashboard vs. continue
  // setup) — unconditionally, whether or not the save above succeeded.
  showWizardStep('fork');
  saveWizardProgress('fork', { featurePagesConfirmed: true, featurePages: selected });
}

// ----------------------------------------------------------------
// Full-path steps 5-8
// ----------------------------------------------------------------

// Maps the activation-validator's raw field paths (shared/mastdb.js
// REQUIRED_AT_ACTIVATE.label) to a human label + the wizard step that collects
// them, so a blocked launch shows plain language with a "go fix it" deep-link
// instead of internal dotted paths.
var _WIZARD_REQUIRED_FIELD_META = {
  'identity.archetype':                  { label: 'Business type', step: '1' },
  'identity.businessName':               { label: 'Business name', step: '2' },
  'people.primaryContact.name':          { label: 'Your name', step: null },
  'people.primaryContact.email':         { label: 'Your email', step: null },
  'people.primaryContact.dpaAcceptedAt': { label: 'Accepting the data agreement', step: null },
  'engagement.mode':                     { label: 'How you’ll use Mast', step: '4' },
  'engagement.surface':                  { label: 'Your preferred way to work', step: '4' },
  'operations.localization.currency':            { label: 'Currency', step: '8' },
  'operations.localization.timezone':            { label: 'Time zone', step: '8' },
  'operations.localization.language':            { label: 'Language', step: '8' },
  'operations.localization.fiscalYearStartMonth':{ label: 'Fiscal-year start month', step: '8' }
};

// Render the "missing required fields" block with human labels + deep-links back
// to the collecting step. Shared by both launch paths (fast + full).
function _wizardRenderMissingFields(errorsEl, missing) {
  if (!errorsEl) return;
  errorsEl.style.display = '';
  var rows = (missing || []).map(function(path) {
    return _WIZARD_REQUIRED_FIELD_META[path] || { label: path, step: null };
  });
  var html = '<strong>A few details are still needed before launch:</strong>' +
    '<ul style="margin:6px 0 0 18px;line-height:1.7;">';
  rows.forEach(function(meta) {
    html += '<li>' + esc(meta.label) +
      (meta.step ? ' &middot; <a href="#" data-wizard-goto="' + esc(meta.step) +
        '" style="color:var(--teal);font-weight:600;text-decoration:none;">Add this &rarr;</a>' : '') +
      '</li>';
  });
  html += '</ul>';
  errorsEl.innerHTML = html;
  Array.prototype.forEach.call(errorsEl.querySelectorAll('[data-wizard-goto]'), function(a) {
    a.onclick = function(e) { e.preventDefault(); showWizardStep(a.getAttribute('data-wizard-goto')); };
  });
}

// Persist the business-profile fields that are STILL blank at launch so the
// dashboard setup checklist can surface them as non-blocking flagged to-dos
// (the "finish-business-profile" NEXT_STEP item reads this). `missing` is the
// array of spec-§3 field paths returned by businessEntity.activate(). Writing an
// empty array clears the flag once the gaps are filled. Best-effort: never
// throws into the launch flow.
async function _wizardRecordLaunchGaps(missing) {
  try {
    var gaps = (missing || []).map(function(path) {
      var meta = _WIZARD_REQUIRED_FIELD_META[path] || { label: path, step: null };
      return { path: path, label: meta.label, step: meta.step || null };
    });
    await MastDB.set('webPresence/config/launchGaps', gaps);
    if (window._nextStepsCache) window._nextStepsCache.launchGaps = gaps;
  } catch (e) { /* non-blocking — the checklist just won't list specifics */ }
}

// Before a skip-to-launch, backfill safe defaults for every activation-required
// field that is still blank — so "Skip to launch" can't strand the user on a
// launch page blocked by fields the skipped steps would have set. Only fills
// BLANKS; never overwrites a real choice the user already made. Business name is
// the one genuinely user-specific field — pulled from the brand input or site
// scan if available, otherwise left for the (now actionable) launch validation.
async function wizardBackfillRequiredDefaults() {
  try {
    var ent = (await MastDB.businessEntity.get()) || {};
    var identity = ent.identity || {};
    var engagement = ent.engagement || {};
    var loc = (ent.operations && ent.operations.localization) || {};

    if (!identity.businessName || !String(identity.businessName).trim()) {
      // Resolve a name from anything we know, and NEVER leave it blank at launch
      // (a blank name is the only thing that still gets flagged). Order: typed
      // input → wizard prefill / signup handoff → owner email → generic. The
      // email fallback is deliberately a visible placeholder so the dashboard
      // nudge prompts the user to set their real name.
      var nameEl = document.getElementById('wizardBrandName');
      var brandCfg = null;
      try { brandCfg = await MastDB.config.get('brand'); } catch (e) {}
      var authUser = null;
      try { authUser = firebase.auth().currentUser; } catch (e) {}
      var nm = (nameEl && nameEl.value && nameEl.value.trim()) ||
        (window._wizardExtracted && window._wizardExtracted.businessName) ||
        (brandCfg && typeof brandCfg.name === 'string' && brandCfg.name.trim()) ||
        String((authUser && (authUser.displayName || authUser.email)) || '').trim() ||
        'My Business';
      if (nm && typeof MastBrandSync !== 'undefined') {
        try { await MastBrandSync.setName(nm); } catch (e) {}
      }
    }
    if (!identity.archetype) {
      await MastDB.businessEntity.update('identity', {
        archetype: 'other-maker',
        businessType: identity.businessType || 'produce',
        effectiveBusinessType: identity.effectiveBusinessType || identity.businessType || 'produce',
        primaryOutput: identity.primaryOutput || 'physical'
      }).catch(function() {});
    }
    if (!engagement.mode || !engagement.surface) {
      await MastDB.businessEntity.update('engagement', {
        mode: engagement.mode || 'storefront',
        surface: engagement.surface || 'hybrid',
        updatedAt: new Date().toISOString()
      }).catch(function() {});
    }
    if (!loc.currency || !loc.timezone || !loc.language || !loc.fiscalYearStartMonth) {
      await _applyEntityOperationsLocalization().catch(function() {});
    }
  } catch (e) { /* best-effort — launch validation still guards */ }
}

// "Skip remaining setup" — available on every full-path step (4-8).
async function wizardSkipToLaunch() {
  logWizardEvent('full-skip', 'skip_to_launch', { fromStep: wizardCurrentStep });
  await wizardBackfillRequiredDefaults();
  showWizardStep('fastDpa');
}

// ---- Step 5: Module Selector ----

var _wizardSelectedModulesStep5 = null; // null = not yet initialized

var _wizardModuleDefs = [
  { id: 'products',         label: 'Products',         desc: 'Catalog, develop, materials, inventory' },
  { id: 'sales',            label: 'Sales',             desc: 'Orders, POS, returns, wholesale' },
  { id: 'marketing',        label: 'Marketing',         desc: 'Blog, social, newsletter, brand' },
  { id: 'retention',        label: 'Retention',         desc: 'Loyalty, gift cards, coupons, customers' },
  { id: 'events',           label: 'Events',            desc: 'Find, apply to, and run market events' },
  { id: 'classes',          label: 'Classes',           desc: 'Classes, instructors, booking, passes' },
  { id: 'finance',          label: 'Finance',           desc: 'Revenue, expenses, P&L, cash flow' },
  { id: 'operations',       label: 'Operations',        desc: 'Studio, team, trips, contacts' },
  { id: 'customer-service', label: 'Customer Service',  desc: 'Inbox, tickets, surveys, reviews' }
];

function _wizardModulePreselect() {
  var always = ['products', 'sales', 'finance', 'customer-service'];
  var state = _wizardBizIdentityState || {};
  var engagement = window._wizardEngagement || {};
  var goals = (engagement.goals || []);
  var revenueChannels = (state.revenueChannels || []);
  var effectiveType = state.businessType || '';
  var selected = always.slice();
  if (effectiveType === 'teach') { ['classes','events'].forEach(function(m){ if(selected.indexOf(m)<0) selected.push(m); }); }
  if (effectiveType === 'produce') { if(selected.indexOf('operations')<0) selected.push('operations'); }
  if (revenueChannels.indexOf('bm-wholesale') >= 0) { if(selected.indexOf('retention')<0) selected.push('retention'); }
  if (goals.indexOf('get-online-shop') >= 0) { if(selected.indexOf('marketing')<0) selected.push('marketing'); }
  if (goals.indexOf('class-registration') >= 0) { if(selected.indexOf('classes')<0) selected.push('classes'); }
  return selected;
}

function renderWizardModuleSelector() {
  if (_wizardSelectedModulesStep5 === null) {
    _wizardSelectedModulesStep5 = _wizardModulePreselect();
  }
  var el = document.getElementById('wizardModuleGrid');
  if (!el) return;
  el.innerHTML = '';
  _wizardModuleDefs.forEach(function(mod) {
    var sel = _wizardSelectedModulesStep5.indexOf(mod.id) >= 0;
    var card = document.createElement('div');
    card.style.cssText = 'border:' + (sel ? '2px solid var(--teal)' : '1px solid var(--wiz-border,#ddd)') +
      ';border-radius:8px;padding:10px 12px;cursor:pointer;background:' +
      (sel ? 'rgba(42,124,111,0.12)' : 'var(--wiz-bg,#fff)') + ';display:flex;align-items:flex-start;gap:8px;color:var(--wiz-text,inherit);';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel;
    cb.style.cssText = 'margin-top:2px;flex-shrink:0;accent-color:var(--teal);';
    cb.onchange = function(ev) { ev.stopPropagation(); _wizardToggleModule(mod.id); };
    var text = document.createElement('div');
    text.innerHTML = '<div style="font-weight:600;font-size:0.85rem;margin-bottom:2px;">' + esc(mod.label) + '</div>' +
      '<div style="font-size:0.72rem;color:var(--warm-gray);line-height:1.3;">' + esc(mod.desc) + '</div>';
    card.appendChild(cb);
    card.appendChild(text);
    card.onclick = function() { _wizardToggleModule(mod.id); };
    el.appendChild(card);
  });
}

function _wizardToggleModule(id) {
  if (!_wizardSelectedModulesStep5) _wizardSelectedModulesStep5 = [];
  var idx = _wizardSelectedModulesStep5.indexOf(id);
  if (idx >= 0) _wizardSelectedModulesStep5.splice(idx, 1);
  else _wizardSelectedModulesStep5.push(id);
  try { snapshotWizardField('_modulesDraft', _wizardSelectedModulesStep5.slice()); } catch(e) {}
  renderWizardModuleSelector();
}

async function wizardConfirmModuleSelector() {
  var btn = document.getElementById('wizardModulesConfirmBtn');
  if (btn) btn.disabled = true;
  var selected = (_wizardSelectedModulesStep5 || _wizardModulePreselect()).slice();
  try {
    await MastDB.businessEntity.update('engagement', { modulesShown: selected });
    logWizardEvent(6, 'modules_confirmed', { modules: selected, count: selected.length });
    showWizardStep('7');
    saveWizardProgress('7', { modulesConfirmed: true, modules: selected });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save modules: ' + esc(err.message || ''), true);
  }
}

// ---- Step 6: Integrations ----

var _wizardIntegrationState = {};

var _wizardIntegrationDefs = [
  { id: 'square', label: 'Square',
    instructions: 'Go to <strong>developer.squareup.com/apps</strong> → select or create your app → click <em>Credentials</em>. Start with Sandbox while setting up; switch to Production when you’re ready to accept real payments.',
    helpUrl: 'https://developer.squareup.com/apps',
    fields: [
      { id: 'clientId',    label: 'Application ID',     type: 'text',     placeholder: 'sq0idp-...' },
      { id: 'apiSecret',   label: 'Application Secret', type: 'password', placeholder: 'sq0csp-...' },
      { id: 'environment', label: 'Environment',        type: 'radio',    options: ['sandbox','production'] }
    ]},
  { id: 'stripe', label: 'Stripe',
    instructions: 'Go to <strong>dashboard.stripe.com/apikeys</strong>. Use test keys while setting up; switch to live keys when ready to accept payments.',
    helpUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [
      { id: 'secretKey',      label: 'Secret key',       type: 'password', placeholder: 'sk_live_... or sk_test_...' },
      { id: 'publishableKey', label: 'Publishable key',  type: 'text',     placeholder: 'pk_live_... or pk_test_...' }
    ]},
  { id: 'shopify', label: 'Shopify',
    instructions: 'In your Shopify admin, go to <strong>Settings → Apps and sales channels → Develop apps</strong> → create a custom app. Your subdomain is the part before <em>.myshopify.com</em>.',
    helpUrl: 'https://admin.shopify.com/settings/apps/development',
    fields: [
      { id: 'shopSubdomain', label: 'Shop subdomain',  type: 'text',     placeholder: 'your-shop (from your-shop.myshopify.com)' },
      { id: 'clientId',      label: 'API key',         type: 'text',     placeholder: '' },
      { id: 'clientSecret',  label: 'API secret key',  type: 'password', placeholder: '' }
    ]},
  { id: 'etsy', label: 'Etsy',
    instructions: 'Go to <strong>etsy.com/developers/your-apps</strong> → select your app (or create one) → your API key is listed in the app details.',
    helpUrl: 'https://www.etsy.com/developers/your-apps',
    fields: [{ id: 'apiKey', label: 'API Key', type: 'text', placeholder: '' }]},
  { id: 'pirateship', label: 'Pirate Ship',
    instructions: 'Log into <strong>pirateship.com</strong> → click your name in the top right → <em>Account Settings → API</em> → reveal your key.',
    helpUrl: 'https://www.pirateship.com/settings',
    fields: [{ id: 'apiKey', label: 'API Key', type: 'password', placeholder: '' }]},
  { id: 'shippo', label: 'Shippo',
    instructions: 'Log into <strong>goshippo.com</strong> → Settings → API → copy your Live token.',
    helpUrl: 'https://apps.goshippo.com/settings/api',
    fields: [{ id: 'apiKey', label: 'API Token', type: 'password', placeholder: 'shippo_live_...' }]}
];

function renderWizardIntegrations() {
  var el = document.getElementById('wizardIntegrationCards');
  if (!el) return;
  var state = _wizardBizIdentityState || {};
  var selectedTools = state.currentTools || [];
  var defsMap = {};
  _wizardIntegrationDefs.forEach(function(d) { defsMap[d.id] = d; });

  // Filter to only tools with known defs
  var knownTools = selectedTools.filter(function(id) { return !!defsMap[id]; });

  if (knownTools.length === 0) {
    el.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;padding:16px 0;">No tools selected — you can connect them later in <strong>Settings → Integrations</strong>.</p>';
    return;
  }

  el.innerHTML = '';
  knownTools.forEach(function(toolId) {
    var def = defsMap[toolId];
    if (!_wizardIntegrationState[toolId]) _wizardIntegrationState[toolId] = { _connected: false, _skipped: false };
    var ts = _wizardIntegrationState[toolId];

    var card = document.createElement('div');
    card.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-radius:8px;margin-bottom:8px;border:1px solid ' +
      (ts._connected ? 'var(--teal)' : 'var(--wiz-border,#ddd)') +
      ';background:' + (ts._connected ? 'rgba(42,124,111,0.08)' : 'var(--wiz-bg,#fff)') + ';';

    var statusLine = ts._connected
      ? '<span style="font-size:0.78rem;color:var(--teal);font-weight:600;">&#10003; Connected</span>'
      : ts._skipped
        ? '<span style="font-size:0.78rem;color:var(--warm-gray);">Set up later in Settings</span>'
        : '<span style="font-size:0.78rem;color:var(--warm-gray);">Not yet connected</span>';

    var btns = ts._connected
      ? '<button class="btn btn-secondary btn-small" onclick="showWizardCredentialEntry(\'' + toolId + '\')">Edit</button>'
      : ts._skipped
        ? '<button class="btn btn-secondary btn-small" onclick="showWizardCredentialEntry(\'' + toolId + '\')">Connect now</button>'
        : '<button class="btn btn-primary btn-small" onclick="showWizardCredentialEntry(\'' + toolId + '\')">Connect now</button>' +
          '<button class="btn btn-secondary btn-small" style="margin-left:6px;" onclick="_wizardSkipTool(\'' + toolId + '\')">Set up later</button>';

    card.innerHTML =
      '<div><strong style="font-size:0.9rem;color:var(--wiz-text,inherit);">' + esc(def.label) + '</strong>' +
      '<br>' + statusLine + '</div>' +
      '<div style="white-space:nowrap;">' + btns + '</div>';
    el.appendChild(card);
  });
}

function showWizardCredentialEntry(toolId) {
  var def = _wizardIntegrationDefs.filter(function(d){ return d.id === toolId; })[0];
  if (!def) return;

  var cardList = document.getElementById('wizardIntegrationCards');
  var header   = document.getElementById('wizardStep7Header');
  var pane     = document.getElementById('wizardCredentialEntryPane');
  var navBtns  = document.getElementById('wizardStep7NavButtons');
  var skipLink = document.getElementById('wizardStep7SkipLink');
  if (cardList) cardList.style.display = 'none';
  if (header)   header.style.display   = 'none';
  if (navBtns)  navBtns.style.display  = 'none';
  if (skipLink) skipLink.style.display = 'none';
  if (!pane) return;
  pane.style.display = 'block';

  var fieldsHtml = '';
  def.fields.forEach(function(f) {
    fieldsHtml += '<div style="margin-bottom:12px;">';
    fieldsHtml += '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:3px;color:var(--wiz-text,inherit);">' + esc(f.label) + '</label>';
    if (f.type === 'radio') {
      f.options.forEach(function(opt) {
        fieldsHtml += '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:0.85rem;cursor:pointer;color:var(--wiz-text,inherit);">' +
          '<input type="radio" name="wizardInt_' + toolId + '_' + f.id + '" value="' + esc(opt) + '"' +
          (opt === 'sandbox' ? ' checked' : '') + ' style="accent-color:var(--teal);">' +
          esc(opt.charAt(0).toUpperCase() + opt.slice(1)) + '</label>';
      });
    } else {
      fieldsHtml += '<input type="' + (f.type === 'password' ? 'password' : 'text') + '" ' +
        'id="wizardInt_' + toolId + '_' + f.id + '" placeholder="' + esc(f.placeholder || '') + '" ' +
        'style="width:100%;padding:8px 10px;border:1px solid var(--wiz-border,#ddd);border-radius:5px;' +
        'font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;' +
        'background:var(--wiz-input,#fff);color:var(--wiz-text,inherit);" />';
    }
    fieldsHtml += '</div>';
  });

  var instructionsHtml = '';
  if (def.instructions) {
    instructionsHtml =
      '<div style="background:var(--wiz-input,rgba(0,0,0,0.04));border-radius:6px;padding:12px 14px;margin-bottom:18px;">' +
      '<p style="margin:0 0 6px;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6;color:var(--wiz-text,inherit);">Where to find your credentials</p>' +
      '<p style="margin:0 0 8px;font-size:0.85rem;color:var(--wiz-text,inherit);line-height:1.5;">' + def.instructions + '</p>' +
      (def.helpUrl ? '<a href="' + esc(def.helpUrl) + '" target="_blank" rel="noopener" style="font-size:0.85rem;color:var(--teal);">Open ' + esc(def.label) + ' settings &rarr;</a>' : '') +
      '</div>';
  }

  pane.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">' +
    '<button onclick="hideWizardCredentialEntry()" style="background:none;border:none;cursor:pointer;padding:0;font-size:1.15rem;color:var(--wiz-text,inherit);line-height:1;" title="Back">&#8592;</button>' +
    '<h3 style="margin:0;font-size:1.15rem;color:var(--wiz-text,inherit);">' + esc(def.label) + '</h3>' +
    '</div>' +
    instructionsHtml +
    fieldsHtml +
    '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">' +
    '<button class="btn btn-primary" onclick="_wizardConnectTool(\'' + toolId + '\')">Save &amp; connect</button>' +
    '<button class="btn btn-secondary" onclick="_wizardSkipTool(\'' + toolId + '\')">I\'ll do this later</button>' +
    '</div>' +
    '<p style="margin-top:10px;font-size:0.78rem;color:var(--warm-gray);">You can always connect this in <strong>Settings → Integrations</strong>.</p>';
}

function hideWizardCredentialEntry() {
  var cardList = document.getElementById('wizardIntegrationCards');
  var header   = document.getElementById('wizardStep7Header');
  var pane     = document.getElementById('wizardCredentialEntryPane');
  var navBtns  = document.getElementById('wizardStep7NavButtons');
  var skipLink = document.getElementById('wizardStep7SkipLink');
  if (cardList) cardList.style.display = '';
  if (header)   header.style.display   = '';
  if (navBtns)  navBtns.style.display  = '';
  if (skipLink) skipLink.style.display = '';
  if (pane)     { pane.style.display = 'none'; pane.innerHTML = ''; }
  renderWizardIntegrations();
}

function _wizardConnectTool(toolId) {
  var def = _wizardIntegrationDefs.filter(function(d){ return d.id === toolId; })[0];
  if (!def) return;
  var creds = {};
  def.fields.forEach(function(f) {
    if (f.type === 'radio') {
      var radios = document.querySelectorAll('input[name="wizardInt_' + toolId + '_' + f.id + '"]');
      for (var r = 0; r < radios.length; r++) { if (radios[r].checked) { creds[f.id] = radios[r].value; break; } }
    } else {
      var inp = document.getElementById('wizardInt_' + toolId + '_' + f.id);
      if (inp) creds[f.id] = inp.value.trim();
    }
  });
  // Write only non-secret fields to Firebase (secrets go server-side via Settings → Integrations).
  var safe = {};
  Object.keys(creds).forEach(function(k) {
    if (k !== 'apiSecret' && k !== 'secretKey' && k !== 'clientSecret' && k !== 'apiKey') safe[k] = creds[k];
  });
  safe.connectedAt = new Date().toISOString();
  MastDB.config.update('integrations/' + toolId, safe).catch(function(){});
  _wizardIntegrationState[toolId] = { _connected: true, _skipped: false };
  logWizardEvent(7, 'tool_connected', { tool: toolId });
  try { snapshotWizardField('_intDraft', _wizardIntegrationState); } catch(e) {}
  hideWizardCredentialEntry();
}

function _wizardSkipTool(toolId) {
  _wizardIntegrationState[toolId] = { _connected: false, _skipped: true };
  logWizardEvent(7, 'tool_skipped', { tool: toolId });
  try { snapshotWizardField('_intDraft', _wizardIntegrationState); } catch(e) {}
  hideWizardCredentialEntry();
}

function wizardStep7Continue() {
  showWizardStep('8');
  saveWizardProgress('8', { integrationsStepDone: true });
}

// Step 7 (integrations) Back: go to the fork (where the user opted into Phase 2).
function wizardStep7Back() {
  showWizardStep('fork');
}

// ---- Step 7: Settings Spotlight ----

function renderWizardSettingsSpotlight() {
  var el = document.getElementById('wizardSettingsSections');
  if (!el) return;
  var modules = _wizardSelectedModulesStep5 || _wizardModulePreselect();
  var engagement = window._wizardEngagement || {};
  var showSiteVis = engagement.mode === 'storefront';
  var showPricing = modules.indexOf('products') >= 0;
  var html = '';

  // Tax & Legal
  html += _wizardSettingsSection('tax', 'Tax &amp; Legal', 'Business state and sales tax',
    '<div class="form-group" style="margin-bottom:12px;">' +
    '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:4px;">Business state</label>' +
    '<select id="wizardTaxState" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:5px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;background:#fff;">' +
    '<option value="">&#8212; Select state &#8212;</option>' +
    (function(){
      var states=[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']];
      return states.map(function(s){ return '<option value="'+s[0]+'">'+s[1]+'</option>'; }).join('');
    })() +
    '</select></div>' +
    '<div class="form-group" style="margin-bottom:4px;">' +
    '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:6px;">Collect sales tax?</label>' +
    '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="wizardCollectTax" value="yes" style="accent-color:var(--teal);"> Yes</label>' +
    '<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="wizardCollectTax" value="no" checked style="accent-color:var(--teal);"> No</label>' +
    '</div>');

  // Email
  html += _wizardSettingsSection('email', 'Email', 'From address for outgoing emails',
    '<div class="form-group" style="margin-bottom:12px;">' +
    '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:4px;">From email</label>' +
    '<input type="email" id="wizardEmailFrom" placeholder="hello@yourbusiness.com" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:5px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;">' +
    '</div>' +
    '<div class="form-group" style="margin-bottom:4px;">' +
    '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:4px;">Reply-to</label>' +
    '<input type="email" id="wizardEmailReplyTo" placeholder="Same as From" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:5px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;">' +
    '</div>');

  // Pricing Defaults
  if (showPricing) {
    html += _wizardSettingsSection('pricing', 'Pricing Defaults', 'Default markup applied to products',
      '<div class="form-group" style="margin-bottom:4px;">' +
      '<label style="font-size:0.78rem;font-weight:600;display:block;margin-bottom:4px;">Default markup %</label>' +
      '<input type="number" id="wizardDefaultMarkup" min="0" max="999" step="1" placeholder="e.g. 100" style="width:120px;padding:8px 10px;border:1px solid #ddd;border-radius:5px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;">' +
      '<p style="font-size:0.78rem;color:var(--warm-gray);margin:4px 0 0;">100% markup = 2× cost = 50% margin</p>' +
      '</div>');
  }

  // Site Visibility
  if (showSiteVis) {
    html += _wizardSettingsSection('visibility', 'Site Visibility', 'Public or private while you set up',
      '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="wizardSiteVis" value="private" checked style="accent-color:var(--teal);"> Private</label>' +
      '<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="wizardSiteVis" value="public" style="accent-color:var(--teal);"> Public</label>' +
      '<p style="font-size:0.78rem;color:var(--warm-gray);margin:6px 0 0;">You can change this anytime in Settings → Website.</p>');
  }

  el.innerHTML = html;

  // Restore + snapshot wiring for all settings inputs.
  var draft = (wizardProgress && wizardProgress._settingsDraft) || {};
  var taxStateEl = document.getElementById('wizardTaxState');
  var emailFromEl = document.getElementById('wizardEmailFrom');
  var emailReplyEl = document.getElementById('wizardEmailReplyTo');
  var markupEl = document.getElementById('wizardDefaultMarkup');
  if (taxStateEl) {
    if (draft.taxState) taxStateEl.value = draft.taxState;
    taxStateEl.addEventListener('change', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.taxState = taxStateEl.value;
      snapshotWizardField('_settingsDraft', d);
    });
  }
  document.querySelectorAll('input[name="wizardCollectTax"]').forEach(function(r) {
    if (draft.collectTax && r.value === draft.collectTax) r.checked = true;
    r.addEventListener('change', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.collectTax = r.value;
      snapshotWizardField('_settingsDraft', d);
    });
  });
  if (emailFromEl) {
    if (draft.emailFrom) emailFromEl.value = draft.emailFrom;
    emailFromEl.addEventListener('input', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.emailFrom = emailFromEl.value;
      snapshotWizardField('_settingsDraft', d);
    });
  }
  if (emailReplyEl) {
    if (draft.emailReplyTo) emailReplyEl.value = draft.emailReplyTo;
    emailReplyEl.addEventListener('input', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.emailReplyTo = emailReplyEl.value;
      snapshotWizardField('_settingsDraft', d);
    });
  }
  if (markupEl) {
    if (draft.defaultMarkup != null) markupEl.value = draft.defaultMarkup;
    markupEl.addEventListener('input', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.defaultMarkup = markupEl.value;
      snapshotWizardField('_settingsDraft', d);
    });
  }
  document.querySelectorAll('input[name="wizardSiteVis"]').forEach(function(r) {
    if (draft.siteVisibility && r.value === draft.siteVisibility) r.checked = true;
    r.addEventListener('change', function() {
      var d = (wizardProgress && wizardProgress._settingsDraft) || {};
      d.siteVisibility = r.value;
      snapshotWizardField('_settingsDraft', d);
    });
  });
}

function _wizardSettingsSection(key, title, subtitle, bodyHtml) {
  var cap = key.charAt(0).toUpperCase() + key.slice(1);
  return '<div id="wizardSettings_' + key + '" style="border:1px solid #ddd;border-radius:8px;margin-bottom:10px;overflow:hidden;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;background:var(--cream-dark);" onclick="_wizardToggleSettingsSection(\'' + key + '\')">' +
    '<div><strong style="font-size:0.9rem;">' + title + '</strong><p style="font-size:0.78rem;color:var(--warm-gray);margin:2px 0 0;">' + subtitle + '</p></div>' +
    '<span id="wizardSettings' + cap + 'Toggle" style="font-size:0.85rem;color:var(--teal);">&#9660;</span></div>' +
    '<div id="wizardSettings' + cap + 'Body" style="padding:14px 16px;">' +
    bodyHtml +
    '<div style="text-align:right;margin-top:10px;"><button class="btn btn-secondary btn-small" onclick="_wizardCollapseSettingsSection(\'' + key + '\')">Skip</button></div>' +
    '</div></div>';
}

function _wizardToggleSettingsSection(key) {
  var cap = key.charAt(0).toUpperCase() + key.slice(1);
  var body = document.getElementById('wizardSettings' + cap + 'Body');
  var toggle = document.getElementById('wizardSettings' + cap + 'Toggle');
  if (!body) return;
  var collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (toggle) toggle.innerHTML = collapsed ? '&#9660;' : '&#9654;';
}

function _wizardCollapseSettingsSection(key) {
  var cap = key.charAt(0).toUpperCase() + key.slice(1);
  var body = document.getElementById('wizardSettings' + cap + 'Body');
  var toggle = document.getElementById('wizardSettings' + cap + 'Toggle');
  if (body) body.style.display = 'none';
  if (toggle) toggle.innerHTML = '&#9654;';
}

async function wizardConfirmSettings() {
  var btn = document.getElementById('wizardSettingsConfirmBtn');
  if (btn) btn.disabled = true;
  var writes = [];

  var taxStateEl = document.getElementById('wizardTaxState');
  var taxState = taxStateEl ? taxStateEl.value : '';
  var collectTaxRadios = document.querySelectorAll('input[name="wizardCollectTax"]');
  var collectTax = false;
  for (var ti = 0; ti < collectTaxRadios.length; ti++) {
    if (collectTaxRadios[ti].checked) { collectTax = collectTaxRadios[ti].value === 'yes'; break; }
  }
  if (taxState) writes.push(MastDB.config.update('tax', { state: taxState, collectSalesTax: collectTax }).catch(function(){}));

  var fromEmail = ((document.getElementById('wizardEmailFrom') || {}).value || '').trim();
  var replyTo   = ((document.getElementById('wizardEmailReplyTo') || {}).value || '').trim();
  if (fromEmail) {
    var emailMeta = { fromEmail: fromEmail, updatedAt: new Date().toISOString() };
    if (replyTo) emailMeta.replyTo = replyTo;
    writes.push(MastDB.config.update('admin/communications', emailMeta).catch(function(){}));
  }

  var markupEl = document.getElementById('wizardDefaultMarkup');
  var markupVal = markupEl ? parseInt(markupEl.value, 10) : NaN;
  if (!isNaN(markupVal) && markupVal >= 0) {
    writes.push(MastDB.config.update('pricingDefaults', { defaultMarkupPct: markupVal, updatedAt: new Date().toISOString() }).catch(function(){}));
  }

  var visRadios = document.querySelectorAll('input[name="wizardSiteVis"]');
  var isPublic = false;
  for (var vi = 0; vi < visRadios.length; vi++) {
    if (visRadios[vi].checked) { isPublic = visRadios[vi].value === 'public'; break; }
  }
  var tenantId = MastDB.tenantId ? MastDB.tenantId() : null;
  if (tenantId) writes.push(MastDB.platform.set('mast-platform/tenants/' + tenantId + '/publicConfig/searchable', isPublic).catch(function(){}));

  try {
    await Promise.all(writes);
    logWizardEvent(8, 'settings_saved', { taxState: taxState || null, fromEmail: fromEmail || null, markupPct: isNaN(markupVal) ? null : markupVal });
    // Settings is the last optional step in Phase 2 — advance to activation.
    showWizardStep('fastDpa');
    saveWizardProgress('fastDpa', { settingsSaved: true });
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Could not save settings: ' + esc(err.message || ''), true);
  }
}

// ---- Step 8: Site Migration ----

async function wizardAnalyzeSiteStep8() {
  var urlEl = document.getElementById('wizardSiteUrl8');
  var statusEl = document.getElementById('wizardAnalysisStatus8');
  var btn = document.getElementById('wizardMigrateBtn8');
  var url = urlEl ? urlEl.value.trim() : '';
  if (!url) { if (statusEl) statusEl.textContent = 'Please enter your website URL.'; return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) { url = 'https://' + url; if (urlEl) urlEl.value = url; }

  // Sync to main wizard URL field so existing wizardAnalyzeSite() logic works.
  var mainUrlEl = document.getElementById('wizardSiteUrl');
  if (mainUrlEl) mainUrlEl.value = url;

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Analyzing your site…</span>';

  // Delegate to existing wizardAnalyzeSite(). Flag tells downstream to go to fastDpa when done.
  window._wizardStep9PostAnalyze = true;
  if (typeof wizardAnalyzeSite === 'function') {
    wizardAnalyzeSite();
  } else {
    if (statusEl) statusEl.textContent = 'Import not available. Use Website → Import after setup.';
    if (btn) btn.disabled = false;
  }
}

// ----------------------------------------------------------------
// Fast-exit path
// ----------------------------------------------------------------

async function wizardFastExit() {
  window._wizardFastExit = true;
  logWizardEvent('fast-exit', 'fast_exit_triggered', { fromStep: wizardCurrentStep });
  await wizardBackfillRequiredDefaults();
  showWizardStep('fastDpa');
}

function renderWizardFastSummary() {
  var el = document.getElementById('wizardFastSummaryCard');
  if (!el) return;
  var BEC = window.BusinessEntityConstants || {};
  var state = _wizardBizIdentityState || {};
  var engagement = window._wizardEngagement || {};
  var extracted = window._wizardExtracted || {};

  // Archetype label
  var archetypes = BEC.ARCHETYPES || [];
  var archetypeLabel = '';
  var archetypeVal = (extracted.inferredArchetype) || '';
  for (var i = 0; i < archetypes.length; i++) {
    if (archetypes[i].value === archetypeVal) { archetypeLabel = archetypes[i].label; break; }
  }

  // Business name
  var brandNameEl = document.getElementById('wizardBrandName');
  var businessName = (brandNameEl && brandNameEl.value) || extracted.businessName || '';

  // Business type label
  var cats4 = BEC.BUSINESS_CATEGORIES || [];
  var typeLabel = '';
  for (var j = 0; j < cats4.length; j++) {
    if (cats4[j].value === state.businessCategory) {
      typeLabel = cats4[j].label;
      if (state.archetype) {
        for (var k = 0; k < cats4[j].subtypes.length; k++) {
          if (cats4[j].subtypes[k].value === state.archetype) {
            typeLabel += ' — ' + cats4[j].subtypes[k].label;
            break;
          }
        }
      }
      break;
    }
  }

  // Revenue channels
  var revChannelDefs = BEC.REVENUE_CHANNELS || [];
  var chanLabels = (state.revenueChannels || []).map(function(v) {
    for (var k = 0; k < revChannelDefs.length; k++) { if (revChannelDefs[k].value === v) return revChannelDefs[k].label; }
    return v;
  });

  // Engagement mode label
  var modeCards = BEC.ENGAGEMENT_MODE_CARDS || [];
  var modeLabel = '';
  for (var m = 0; m < modeCards.length; m++) {
    if (modeCards[m].value === engagement.mode) { modeLabel = modeCards[m].title; break; }
  }

  var rows = [];
  if (archetypeLabel || businessName) rows.push('Business: ' + [archetypeLabel, businessName].filter(Boolean).join(' — '));
  if (typeLabel) rows.push('Type: ' + typeLabel);
  if (chanLabels.length) rows.push('Selling via: ' + chanLabels.join(', '));
  else rows.push('Selling via: not set yet');
  if (modeLabel) rows.push('Mode: ' + modeLabel);

  el.innerHTML = '<p style="font-weight:600;margin:0 0 10px;">Here&#39;s your workspace setup so far:</p>' +
    '<ul style="margin:0;padding-left:18px;line-height:1.8;">' +
    rows.map(function(r) { return '<li>' + esc(r) + '</li>'; }).join('') +
    '</ul>' +
    '<p style="margin:10px 0 0;font-size:0.85rem;color:var(--warm-gray);">Your dashboard setup checklist will guide you through the rest.</p>';

  // Populate fast-path DPA elements (mirroring renderWizardActivationGate for the -Fast IDs)
  var dpaCopy = BEC.DPA_COPY || {};
  var noc = BEC.NOTICE_AT_COLLECTION_COPY || {};
  var privacyUrl = BEC.PRIVACY_POLICY_URL || '/privacy';

  var labelEl = document.getElementById('wizardDpaLabelFast');
  if (labelEl) {
    labelEl.innerHTML =
      esc(dpaCopy.checkbox || '') + ' ' +
      '<a href="' + esc(dpaCopy.linkUrl || '/dpa') + '" target="_blank" rel="noopener">' +
      esc(dpaCopy.linkText || 'Data Processing Addendum') + '</a> ' +
      '<span style="color:var(--danger);font-weight:600;">' + esc(dpaCopy.requiredLabel || '(Required.)') + '</span>';
  }
  // Wire fast DPA checkbox → gate highlight + button enable/disable
  var dpaCheckFastEl = document.getElementById('wizardDpaCheckboxFast');
  if (dpaCheckFastEl && !dpaCheckFastEl._dpaGateWired) {
    dpaCheckFastEl._dpaGateWired = true;
    dpaCheckFastEl.onchange = function() { _wizardDpaGateUpdate(true); };
  }
  _wizardDpaGateUpdate(true);
  var nocEl = document.getElementById('wizardNoticeAtCollectionFast');
  if (nocEl) {
    nocEl.innerHTML =
      esc(noc.body || '') + ' ' +
      '<a href="' + esc(privacyUrl) + '" target="_blank" rel="noopener">' + esc(noc.privacyLinkText || 'Privacy Policy') + '</a> · ' +
      '<a href="' + esc(dpaCopy.linkUrl || '/dpa') + '" target="_blank" rel="noopener">' + esc(noc.dpaLinkText || 'Data Processing Addendum') + '</a>';
  }

  var fastPeopleState = window._wizardPeopleSelectionFast = window._wizardPeopleSelectionFast || {};
  var rolesElFast = document.getElementById('wizardRoleOptionsFast');
  if (rolesElFast && rolesElFast.childNodes.length === 0) {
    var roles = BEC.PRIMARY_CONTACT_ROLES || [];
    roles.forEach(function(role) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = role.label;
      btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:1px solid var(--wiz-border,#ccc);background:var(--wiz-bg,#fff);color:var(--wiz-text,inherit);font-size:0.78rem;cursor:pointer;';
      btn.dataset.value = role.value;
      btn.onclick = function() {
        fastPeopleState.role = role.value;
        Array.prototype.forEach.call(rolesElFast.children, function(c) {
          var s = fastPeopleState.role === c.dataset.value;
          c.style.borderColor = s ? 'var(--teal)' : 'var(--wiz-border,#ccc)';
          c.style.background = s ? 'var(--teal)' : 'var(--wiz-bg,#fff)';
          c.style.color = s ? '#fff' : 'var(--wiz-text,inherit)';
        });
      };
      rolesElFast.appendChild(btn);
    });
  }
  var sizeElFast = document.getElementById('wizardTeamSizeOptionsFast');
  if (sizeElFast && sizeElFast.childNodes.length === 0) {
    var bands = BEC.TEAM_SIZE_BANDS || [];
    bands.forEach(function(band) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = band.label;
      btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:1px solid var(--wiz-border,#ccc);background:var(--wiz-bg,#fff);color:var(--wiz-text,inherit);font-size:0.78rem;cursor:pointer;';
      btn.dataset.value = band.value;
      btn.onclick = function() {
        fastPeopleState.teamSize = band.value;
        fastPeopleState.hasEmployees = band.value !== 'solo';
        Array.prototype.forEach.call(sizeElFast.children, function(c) {
          var s = fastPeopleState.teamSize === c.dataset.value;
          c.style.borderColor = s ? 'var(--teal)' : 'var(--wiz-border,#ccc)';
          c.style.background = s ? 'var(--teal)' : 'var(--wiz-bg,#fff)';
          c.style.color = s ? '#fff' : 'var(--wiz-text,inherit)';
        });
      };
      sizeElFast.appendChild(btn);
    });
  }
}

// _wizardActivateTenant: flip the tenant onboarding→active via the
// completeOnboarding CF. The registry doc platform_tenants/{id} is
// platform-admin-only under Firestore rules, so a real tenant owner cannot
// write status/tenantStatus directly (it failed with "Missing or insufficient
// permissions"). The CF does it server-side after verifying the caller is this
// tenant's admin. See mast-architecture exports.completeOnboarding.
async function _wizardActivateTenant() {
  var cfBase = (typeof TENANT_FIREBASE_CONFIG !== 'undefined' && TENANT_FIREBASE_CONFIG && TENANT_FIREBASE_CONFIG.cloudFunctionsBase) || '';
  if (!cfBase) throw new Error('Cloud Functions base not configured');
  var token = await auth.currentUser.getIdToken();
  var resp = await fetch(cfBase + '/completeOnboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ tenantId: MastDB.tenantId() })
  });
  if (!resp.ok) {
    var d = {};
    try { d = await resp.json(); } catch (e) { /* non-JSON error body */ }
    throw new Error((d && d.error) || ('Activation failed (' + resp.status + ')'));
  }
  return resp.json();
}

// wizardCompleteFast: DPA activation for fast-path (non-storefront + fast-exit).
// Shares all Firebase write logic with wizardComplete but reads -Fast DPA elements.
async function wizardCompleteFast() {
  var BEC = window.BusinessEntityConstants || {};
  var dpaCopy = BEC.DPA_COPY || {};
  var errorsEl = document.getElementById('wizardActivateErrorsFast');
  if (errorsEl) { errorsEl.style.display = 'none'; errorsEl.textContent = ''; }

  var dpaCheckbox = document.getElementById('wizardDpaCheckboxFast');
  if (!dpaCheckbox || !dpaCheckbox.checked) {
    if (errorsEl) {
      errorsEl.style.display = '';
      errorsEl.textContent = dpaCopy.missingError || 'You must accept the Data Processing Addendum to continue.';
    }
    showToast(dpaCopy.missingError || 'You must accept the DPA to continue.', true);
    return;
  }

  try {
    var user = firebase.auth().currentUser;
    var displayName = (user && user.displayName) || '';
    var email = (user && user.email) || '';
    var sel = window._wizardPeopleSelectionFast || {};
    var peoplePayload = {
      primaryContact: {
        name: displayName,
        email: email,
        dpaAcceptedAt: new Date().toISOString(),
        dpaVersion: BEC.DPA_VERSION || '2026-05-v1'
      }
    };
    if (sel.role) peoplePayload.primaryContact.role = sel.role;
    if (sel.teamSize) peoplePayload.teamSize = sel.teamSize;
    if (typeof sel.hasEmployees === 'boolean') peoplePayload.hasEmployees = sel.hasEmployees;

    await MastDB.businessEntity.update('people', peoplePayload);

    // Fill safe defaults for anything the user skipped, then activate WITHOUT
    // blocking. A fresh tenant (incl. a Shopify App Store reviewer) must always
    // reach the dashboard — any field still blank after backfill is recorded as
    // a non-blocking nudge on the dashboard setup checklist, never a wall.
    await wizardBackfillRequiredDefaults();
    try {
      var actRes = await MastDB.businessEntity.activate({ force: true });
      await _wizardRecordLaunchGaps((actRes && actRes.missingFields) || []);
      logWizardEvent(5, 'wizard_activated', { missingFields: (actRes && actRes.missingFields) || [], path: 'fast', blocked: false });
    } catch (activateErr) {
      // Activation itself failed (e.g. a write error) — still let the user in.
      console.warn('[Wizard] force-activate failed, proceeding to dashboard anyway:', activateErr && activateErr.message);
      logWizardEvent(5, 'activate_error_nonblocking', { message: (activateErr && activateErr.message) || 'unknown', path: 'fast' });
    }

    // Write onboardingDepth to presence now that wizard is complete
    var depth = window._wizardOnboardingDepth || 'quick';
    await MastDB.businessEntity.update('presence', { onboardingDepth: depth }).catch(function() {});

    await _wizardActivateTenant();
    await MastDB.config.set('setupProgress/completed', true);
    await MastDB.config.set('setupProgress/completedAt', new Date().toISOString());
    await updateConfigChecklist('brand', true);

    await stampRevenueSubscriptionModel();

    try {
      var planStatus = await MastDB.get('admin/businessPlan/planStatus');
      if (!planStatus || planStatus === 'none') await MastDB.set('admin/businessPlan/planStatus', 'draft');
    } catch (planErr) { /* best-effort */ }

    // Per-tenant Firebase Hosting deploy was removed 2026-05-10 — tenant
    // sites now serve from the Cloudflare-wildcard shared site
    // (mast-tenant-shared.web.app), so wizard-complete no longer triggers
    // a per-tenant deploy.
    var engView = await MastDB.businessEntity.get('engagement');
    var engMode = ((engView && engView.data) || {}).mode || 'back-office';

    // Mast Modes (Idea -OtADygKA_JhRmk1wUqN): same derivation as wizardComplete
    // — fast-path users also get a modeSet so M2's sidebar filter has signal.
    // Non-blocking; defaults to standard mode on any error.
    try {
      var fullEntityFast = await MastDB.businessEntity.get();
      if (BEC && typeof BEC.deriveModeSet === 'function') {
        var derivedModeSetFast = BEC.deriveModeSet(fullEntityFast || {}, { derivedFrom: 'wizard' });
        await MastDB.businessEntity.update('modeSet', derivedModeSetFast);
        logWizardEvent(5, 'modeSet_derived', {
          modes: derivedModeSetFast.modes,
          overlays: derivedModeSetFast.overlays,
          cohortFlag: derivedModeSetFast.cohortFlag,
          modeVersion: derivedModeSetFast.modeVersion,
          path: 'fast'
        });
      }
    } catch (modeErrFast) {
      console.warn('[Wizard] Failed to derive/persist modeSet (fast path):', modeErrFast && modeErrFast.message);
    }

    logWizardEvent(5, 'wizard_complete', {
      entityStatus: 'active', engagementMode: engMode,
      dpaVersion: BEC.DPA_VERSION || '2026-05-v1',
      path: window._wizardFastExit ? 'fast-exit' : 'fast-dpa',
      onboardingDepth: depth
    });
    showToast('Setup complete! Welcome to your dashboard.');

    await loadTenantSubscription();
    document.getElementById('setupWizardScreen').style.display = 'none';
    document.getElementById('header').style.display = 'flex';
    showSidebar();
    productsLoaded = false;
    productsData = [];
    navigateTo('dashboard');
    Promise.all([loadNextStepsCache(), loadDismissedSteps(), loadMatchingPrefs()]).then(function() { renderDashCardSetupShop(); });
    attachListeners();
    loadSettings();
  } catch (err) {
    if (errorsEl) {
      errorsEl.style.display = '';
      errorsEl.textContent = 'Error completing setup: ' + (err.message || 'unknown');
    }
    showToast('Error completing setup: ' + esc(err.message || ''), true);
  }
}

function updateWizardProgress() {
  var progressEl = document.getElementById('wizardProgress');
  if (!progressEl) return;
  var currentStep = String(wizardCurrentStep || '0');

  // Screen 0 (welcome): hide progress bar entirely
  if (currentStep === '0') {
    progressEl.style.display = 'none';
    return;
  }
  progressEl.style.display = 'flex';

  var order = _wizardGetStepOrder();
  // Filter to steps that show in the progress bar (exclude welcome + interstitial decisions)
  var barSteps = order.filter(function(s) { return s !== '0' && s !== 'fastDpa' && s !== 'fork'; });
  // Sub-step → parent dot mapping (sub-steps don't appear in the bar; they highlight the parent).
  var SUB_STEP_PARENT = { '4b': '4' };
  var lookupStep = SUB_STEP_PARENT[currentStep] || currentStep;
  var currentIdx = barSteps.indexOf(lookupStep);
  // For interstitial steps not in barSteps, find nearest
  if (currentIdx < 0) {
    // Use the full order to find position
    var fullIdx = order.indexOf(lookupStep);
    // Walk backwards to find last bar step
    for (var fi = fullIdx - 1; fi >= 0; fi--) {
      var ci = barSteps.indexOf(order[fi]);
      if (ci >= 0) { currentIdx = ci; break; }
    }
  }

  // Rebuild dots + lines. Completed (already-visited) dots are clickable so the
  // user can jump back to a prior step to revise an answer; the active and future
  // dots are not (you can't skip ahead past required steps).
  var html = '';
  for (var i = 0; i < barSteps.length; i++) {
    var cls = 'wizard-step-dot';
    var clickable = i < currentIdx;
    if (clickable) cls += ' completed';
    else if (i === currentIdx) cls += ' active';
    html += '<div class="' + cls + '" data-step="' + barSteps[i] + '"' +
      (clickable ? ' role="button" tabindex="0" title="Go back to this step" style="cursor:pointer;"' : '') +
      '>' + (i + 1) + '</div>';
    if (i < barSteps.length - 1) {
      var lineCls = 'wizard-step-line' + (i < currentIdx ? ' completed' : '');
      html += '<div class="' + lineCls + '"></div>';
    }
  }
  progressEl.innerHTML = html;
  // Wire back-navigation on the completed dots.
  Array.prototype.forEach.call(progressEl.querySelectorAll('.wizard-step-dot.completed'), function(dot) {
    dot.onclick = function() { showWizardStep(dot.getAttribute('data-step')); };
    dot.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showWizardStep(dot.getAttribute('data-step')); }
    };
  });
}

function wizardNext(fromStep) {
  var order = _wizardGetStepOrder();
  var idx = order.indexOf(String(fromStep));
  if (idx < 0 || idx >= order.length - 1) return;
  showWizardStep(order[idx + 1]);
  saveWizardProgress(order[idx + 1]);
}

function wizardPrev(fromStep) {
  var order = _wizardGetStepOrder();
  var idx = order.indexOf(String(fromStep));
  if (idx <= 0) return;
  showWizardStep(order[idx - 1]);
}

// Screen 0: user selects quick or full depth
function wizardSelectDepth(depth) {
  window._wizardOnboardingDepth = depth;
  // Update card UI
  var quickCard = document.getElementById('wizardDepthQuick');
  var fullCard = document.getElementById('wizardDepthFull');
  if (quickCard) {
    quickCard.style.border = depth === 'quick' ? '2px solid var(--teal)' : '1px solid #ddd';
    quickCard.style.background = depth === 'quick' ? 'rgba(42,124,111,0.05)' : '#fff';
  }
  if (fullCard) {
    fullCard.style.border = depth === 'full' ? '2px solid var(--teal)' : '1px solid #ddd';
    fullCard.style.background = depth === 'full' ? 'rgba(42,124,111,0.05)' : '#fff';
  }
}

async function wizardConfirmDepth() {
  // No more quick/full picker — depth decision moves to the fork at end of Phase 1.
  // Default to 'full' so the order arrays include the integrations/settings dots;
  // the fork handler decides whether to traverse them.
  window._wizardOnboardingDepth = 'full';
  logWizardEvent(0, 'wizard_started', {});
  showWizardStep('3');
  saveWizardProgress('3', { onboardingDepth: 'full' });
}

// Step 4 (engagement) back — go to matchq, the immediate prior step in the new flow.
// Don't clear engagement state; user may just want to glance back without losing input.
function wizardStep4Back() {
  showWizardStep('matchq');
}

// Snapshot a single field of in-progress wizard state without changing currentStep.
// Writes to localStorage synchronously (survives reload immediately) and Firestore
// best-effort. Use for live form input — does NOT advance the wizard.
var _wizardSnapshotTimers = {};
function snapshotWizardField(key, value) {
  if (!key) return;
  try {
    var update = {};
    update[key] = value;
    update._schemaVersion = 2;
    update.updatedAt = new Date().toISOString();
    _wizardLsSave(update);
    // Mirror into in-memory wizardProgress so other code paths that read it see fresh data.
    if (typeof wizardProgress === 'object' && wizardProgress) wizardProgress[key] = value;
    // Debounced Firestore write (per-key) — never blocks UI.
    if (key.charAt(0) === '_') return; // skip private snapshots from Firestore
    if (_wizardSnapshotTimers[key]) clearTimeout(_wizardSnapshotTimers[key]);
    _wizardSnapshotTimers[key] = setTimeout(function() {
      try {
        MastDB.config.set('setupProgress/' + key, value).catch(function(e) {
          console.warn('Snapshot save (' + key + ') failed:', e && e.message);
        });
      } catch(e) {}
    }, 800);
  } catch(e) {}
}

function saveWizardProgress(step, extras) {
  var update = { currentStep: step, updatedAt: new Date().toISOString(), _schemaVersion: 2 };
  if (extras) Object.assign(update, extras);
  // Snapshot key in-memory wizard state so it survives back/forward navigation
  if (window._wizardEngagement) update._engagement = window._wizardEngagement;
  if (window._wizardExtracted) update._extracted = window._wizardExtracted;
  if (window._wizardArchetypeDefaults) update._archetypeDefaults = window._wizardArchetypeDefaults;
  if (window._wizardSiteIntent) update._siteIntent = window._wizardSiteIntent;
  if (window._wizardSelectedModules) update._selectedModules = window._wizardSelectedModules;
  // Write to localStorage immediately — survives back/forward without a network round trip
  _wizardLsSave(update);
  // Per-field set uses Firestore mergeFields: creates the parent doc if missing
  // (fresh tenants) and preserves siblings written by other setupProgress/*
  // paths. Previous single .update() threw 5 NOT_FOUND on first wizard step
  // for any tenant without a pre-seeded config doc.
  Object.keys(update).forEach(function(k) {
    if (k.charAt(0) !== '_') { // skip private in-memory state snapshots from Firestore
      MastDB.config.set('setupProgress/' + k, update[k]).catch(function(e) {
        console.warn('Failed to save wizard progress (' + k + '):', e.message);
      });
    }
  });
}

// User has no existing site — skip URL step and go straight to engagement.
function wizardSkipSite() {
  _wizardSiteAnalysis = null;
  window._wizardCrawlManifest = null;
  window._wizardAnalyzedUrl = null;
  window._wizardHasWebsite = false;
  window._wizardExtracted = {
    businessName: '',
    tagline: '',
    oneLineDescription: '',
    primaryDomain: '',
    logoUrl: '',
    primaryColor: 'var(--amber)',
    accentColor: 'var(--teal)',
    styleRecommendation: 'artisan-warm',
    inferredArchetype: null,
    archetypeConfidence: null,
    declaredChannels: [],
    externalChannels: [],
    socialProfiles: []
  };
  window._wizardDetectedModules = [];
  logWizardEvent(0.5, 'site_skipped', {});
  // New flow: site → identity (no scan, manual fill)
  showWizardStep('1');
}

// ----------------------------------------------------------------
// Step 1: Site path picker (migrate vs integrate)
// ----------------------------------------------------------------

function wizardShowSitePathPicker(data) {
  var manifest = (data && data.crawlManifest) || {};
  var platform = manifest.platform || '';
  var productCount = (manifest.products && manifest.products.length) || 0;
  var brandName = manifest.businessName || '';

  // Hide URL form, show picker
  var urlForm = document.getElementById('wizardStep3UrlForm');
  if (urlForm) urlForm.style.display = 'none';

  var platformLabel = (platform && platform !== 'unknown')
    ? platform.charAt(0).toUpperCase() + platform.slice(1)
    : 'your site';
  var keepLabel = (platform && platform !== 'unknown')
    ? 'Keep ' + platformLabel + ', use Mast for ops'
    : 'Keep my current site, use Mast for ops';

  var foundHtml = '';
  if (productCount > 0 || brandName) {
    var parts = [];
    if (productCount > 0) parts.push(productCount + ' product' + (productCount !== 1 ? 's' : ''));
    if (brandName) parts.push('brand info for <strong>' + esc(brandName) + '</strong>');
    foundHtml = '<div style="background:rgba(42,124,111,0.08);border:1px solid var(--teal);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:0.9rem;color:var(--text-primary);">' +
      '&#10003; Found ' + parts.join(' and ') + ' — ready to import.' +
      '</div>';
  }

  var picker = document.getElementById('wizardSitePathPicker');
  if (!picker) return;

  // Shopify App Store install: Mast is the complementary back-office, never a
  // storefront replacement — so don't offer the "Move to Mast / Mast becomes your
  // storefront" path at all. Keep Shopify out front; Mast runs ops behind it.
  var shopifyOrigin = !!window.wizardIsShopifyOrigin;
  var migrateCardHtml = shopifyOrigin ? '' :
    '<div class="wizard-feature-card" style="border:1px solid var(--wiz-border,#ddd);border-radius:10px;padding:18px;cursor:pointer;background:var(--wiz-input,#fff);" onclick="wizardChooseSiteIntent(\'migrate\')">' +
      '<div style="font-weight:700;font-size:1rem;margin-bottom:4px;">Move to Mast</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">Import your products and content. Mast becomes your storefront.</div>' +
    '</div>';
  var integrateLabel = shopifyOrigin ? 'Keep Shopify, use Mast for ops' : keepLabel;
  var pickerHeading = shopifyOrigin
    ? 'How should Mast work with Shopify?'
    : 'What do you want to do with ' + esc(platformLabel) + '?';
  var pickerSubhead = shopifyOrigin
    ? 'Mast runs the back-office alongside your Shopify store. Confirm and we’ll sync your catalog in.'
    : 'We scanned your site — now tell us how Mast fits in.';

  picker.style.display = '';
  picker.innerHTML =
    '<h2 style="font-size:1.6rem;margin-bottom:6px;">' + esc(pickerHeading) + '</h2>' +
    '<p style="color:var(--warm-gray);margin-bottom:16px;font-size:0.9rem;">' + esc(pickerSubhead) + '</p>' +
    foundHtml +
    '<div style="display:grid;gap:10px;margin-bottom:20px;">' +
      migrateCardHtml +
      '<div class="wizard-feature-card" style="border:1px solid var(--wiz-border,#ddd);border-radius:10px;padding:18px;cursor:pointer;background:var(--wiz-input,#fff);" onclick="wizardChooseSiteIntent(\'integrate\')">' +
        '<div style="font-weight:700;font-size:1rem;margin-bottom:4px;">' + esc(integrateLabel) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">Stay on your current storefront. Mast syncs products and handles orders, inventory, and production behind the scenes.</div>' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-secondary" onclick="wizardResetSiteStep()">&#8592; Back</button>';
}

function wizardChooseSiteIntent(intent) {
  window._wizardSiteIntent = intent;
  var picker = document.getElementById('wizardSitePathPicker');
  if (picker) {
    var cards = picker.querySelectorAll('.wizard-feature-card');
    cards.forEach(function(c, i) {
      var chosen = (i === 0 && intent === 'migrate') || (i === 1 && intent === 'integrate');
      c.style.borderColor = chosen ? 'var(--teal)' : 'var(--wiz-border,#ddd)';
      c.style.background = chosen ? 'rgba(42,124,111,0.06)' : 'var(--wiz-input,#fff)';
    });
  }
  MastDB.config.set('setupProgress/siteIntent', intent).catch(function() {});
  logWizardEvent(3, 'site_intent_chosen', { intent: intent });
  // New flow: site → identity (pre-filled by scan) → brand → matchq → engagement
  showWizardStep('1');
  saveWizardProgress('1', { siteAnalyzed: true, siteIntent: intent, autoApplied: _wizardAutoApplied });
  window._wizardAnalyzing = false;
}

function wizardResetSiteStep() {
  var picker = document.getElementById('wizardSitePathPicker');
  if (picker) { picker.style.display = 'none'; picker.innerHTML = ''; }
  var urlForm = document.getElementById('wizardStep3UrlForm');
  if (urlForm) urlForm.style.display = '';
  var btn = document.getElementById('wizardAnalyzeBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Analyze My Site'; }
  var skipBtn = document.getElementById('wizardSkipSiteBtn');
  if (skipBtn) skipBtn.style.display = '';
  var statusEl = document.getElementById('wizardAnalysisStatus');
  if (statusEl) statusEl.innerHTML = '';
  window._wizardAnalyzing = false;
}

// ----------------------------------------------------------------
// Step 1.5: Logo upload preview
// ----------------------------------------------------------------

function wizardPreviewLogo(input) {
  var nameEl = document.getElementById('wizardLogoFileName');
  var wrapEl = document.getElementById('wizardLogoPreviewWrap');
  var previewEl = document.getElementById('wizardLogoPreviewImg');
  if (!input || !input.files || !input.files[0]) return;
  var file = input.files[0];
  if (nameEl) nameEl.textContent = file.name;
  var reader = new FileReader();
  reader.onload = function(e) {
    if (previewEl) previewEl.src = e.target.result;
    if (wrapEl) wrapEl.style.display = '';
  };
  reader.readAsDataURL(file);
}

function wizardClearLogo() {
  var input = document.getElementById('wizardBrandLogo');
  if (input) input.value = '';
  var nameEl = document.getElementById('wizardLogoFileName');
  if (nameEl) nameEl.textContent = 'No file chosen';
  var wrapEl = document.getElementById('wizardLogoPreviewWrap');
  if (wrapEl) wrapEl.style.display = 'none';
  var previewEl = document.getElementById('wizardLogoPreviewImg');
  if (previewEl) previewEl.src = '';
}

// B9: lightweight keyword matcher. Maps free-text "what do you sell" to an
// archetype ID if a word unambiguously matches; else null (B1a blank-dropdown).
// Wizard event logging — writes to {tenantId}/admin/setupLog for diagnostics
function logWizardEvent(step, event, detail) {
  try {
    if (typeof MastDB !== 'undefined' && MastDB.push) {
      MastDB.push('admin/setupLog', {
        step: step, event: event, detail: detail || null,
        at: new Date().toISOString()
      });
    }
  } catch (e) { /* best-effort logging */ }
}

window._wizardAnalyzing = false;

// Step 1: Analyze existing site and AUTO-APPLY everything
async function wizardAnalyzeSite() {
  if (window._wizardAnalyzing) return;
  var url = document.getElementById('wizardSiteUrl').value.trim();
  if (!url) { showToast('Please enter a URL.', true); return; }

  // Normalize URL: fix common typos
  url = url.replace(/^["'<]+|["'>]+$/g, '').replace(/^(https?);\/\//i, '$1://').replace(/^(https?):\/([^/])/i, '$1://$2').replace(/^(https?):(?!\/\/)/i, '$1://').replace(/^htp:\/\//i, 'http://').replace(/^htps:\/\//i, 'https://').replace(/\s+/g, '').replace(/,/g, '.').replace(/\.{2,}/g, '.');
  if (!url.match(/^https?:\/\//i)) url = 'https://' + url;
  var corrected = url;
  var corrections = [];
  try {
    if (corrected.indexOf(',') >= 0) { corrected = corrected.replace(/,/g, '.'); corrections.push('comma \u2192 dot'); }
    if (corrected.indexOf(' ') >= 0) { corrected = corrected.replace(/ /g, ''); corrections.push('removed spaces'); }
    corrected = corrected.replace(/\.{2,}/g, '.');
    var tldMatch = corrected.match(/([a-z0-9])(?:https?:\/\/)?([a-z0-9]+)(com|net|org|io|co|shop|store|art|studio)$/i);
    if (tldMatch && corrected.indexOf('.' + tldMatch[3]) < 0) {
      corrected = corrected.replace(new RegExp(tldMatch[3] + '$'), '.' + tldMatch[3]);
      corrections.push('added dot before .' + tldMatch[3]);
    }
    var parsed = new URL(corrected);
    if (parsed.hostname.indexOf('.') < 0) { showToast("That doesn\'t look like a valid URL. Check for typos.", true); return; }
    if (corrections.length > 0 && corrected !== url) {
      var statusEl = document.getElementById('wizardAnalysisStatus');
      statusEl.innerHTML = '<div style="background:var(--cream);border:1px solid var(--amber);border-radius:8px;padding:16px;margin-top:12px;">' +
        '<p style="margin:0 0 8px;font-weight:600;color:var(--text-primary);">Did you mean?</p>' +
        '<p style="margin:0 0 12px;font-size:0.9rem;color:var(--warm-gray);">We noticed a typo (' + esc(corrections.join(', ')) + ')</p>' +
        '<div style="display:flex;gap:10px;align-items:center;">' +
        '<code style="flex:1;background:var(--cream-dark);padding:8px 12px;border-radius:6px;font-size:0.9rem;">' + esc(corrected) + '</code>' +
        '<button class="btn btn-primary" data-corrected="' + esc(corrected) + '" onclick="document.getElementById(\'wizardSiteUrl\').value=this.dataset.corrected;document.getElementById(\'wizardAnalysisStatus\').innerHTML=\'\';wizardAnalyzeSite();">Use this</button>' +
        '</div></div>';
      return;
    }
    url = corrected;
  } catch (e) {
    showToast('Please enter a valid URL (e.g., https://mysite.com).', true); return;
  }

  var statusEl = document.getElementById('wizardAnalysisStatus');
  var btn = document.getElementById('wizardAnalyzeBtn');

  // Animated progress messages
  var progressMessages = [
    'Finding your site...',
    'Detecting your platform...',
    'Scanning for products...',
    'Grabbing your colors and logo...',
    'Setting up your template...'
  ];
  var msgIdx = 0;
  function updateProgressMsg() {
    if (msgIdx < progressMessages.length) {
      statusEl.innerHTML = '<div style="display:flex;align-items:center;gap:12px;justify-content:center;padding:16px 0;">' +
        '<div style="width:24px;height:24px;border:3px solid var(--cream-dark);border-top-color:var(--teal);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></div>' +
        '<span style="color:var(--warm-gray);">' + esc(progressMessages[msgIdx]) + '</span></div>';
      msgIdx++;
    }
  }
  updateProgressMsg();
  var progressTimer = setInterval(function() { updateProgressMsg(); }, 4000);

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  window._wizardAnalyzing = true;
  logWizardEvent(3, 'analyze_start', { url: url });

  try {
    var result = await firebase.functions().httpsCallable('analyzeExistingSite', { timeout: 120000 })({
      url: url, tenantId: MastDB.tenantId()
    });
    clearInterval(progressTimer);

    var data = result.data;
    var analysis = data.analysis || {};
    var crawlManifest = data.crawlManifest || null;
    _wizardSiteAnalysis = analysis;
    window._wizardCrawlManifest = crawlManifest;
    window._wizardAnalyzedUrl = url;
    window._wizardSiteFingerprint = data.siteFingerprint || null;
    window._wizardDraftTemplateId = data.draftTemplateId || null;
    window._wizardTemplateConfidence = (data.templateMatch && data.templateMatch.confidenceLevel) || 'low';
    window._wizardCapabilityMatrix = data.capabilityMatrix || null;

    // Show "applying..." status
    statusEl.innerHTML = '<div style="display:flex;align-items:center;gap:12px;justify-content:center;padding:16px 0;">' +
      '<div style="width:24px;height:24px;border:3px solid var(--cream-dark);border-top-color:var(--amber);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></div>' +
      '<span style="color:var(--warm-gray);">Applying your brand and setting up your store...</span></div>';

    // Persist crawl manifest to Firebase (survives page reloads).
    // Stamp _schemaVersion alongside so _wizardApplyProgress's v2 guard doesn't wipe these.
    var persistPromises = [
      MastDB.config.set('setupProgress/analyzedUrl', url).catch(function() {}),
      MastDB.config.set('setupProgress/siteAnalyzed', true).catch(function() {}),
      MastDB.config.set('setupProgress/_schemaVersion', 2).catch(function() {})
    ];
    if (crawlManifest) persistPromises.push(MastDB.config.set('setupProgress/crawlManifest', crawlManifest).catch(function() {}));
    if (data.siteFingerprint) persistPromises.push(MastDB.config.set('setupProgress/siteFingerprint', data.siteFingerprint).catch(function() {}));
    // Mirror to localStorage immediately so a reload before Firestore round-trips still skips re-analyze.
    try {
      _wizardLsSave({
        analyzedUrl: url,
        siteAnalyzed: true,
        crawlManifest: crawlManifest || null,
        siteFingerprint: data.siteFingerprint || null,
        _schemaVersion: 2,
        updatedAt: new Date().toISOString()
      });
    } catch(e) {}
    if (data.draftTemplateId) persistPromises.push(MastDB.config.set('setupProgress/draftTemplateId', data.draftTemplateId).catch(function() {}));

    // === AUTO-APPLY EVERYTHING ===
    await wizardAutoApplyAll(analysis, data);

    // B0: Import-job creation deferred to wizardConfirmEngagement (B3) so
    // job.mode can be set per engagement choice (storefront | pim-only | draft-only).
    // processImportJob reads job.mode and defaults to 'storefront' for legacy jobs.

    await Promise.all(persistPromises);

    // Determine next step based on tier
    var sub = getTenantSubscription();
    var tierConfig = TIER_CONFIG[sub.tier] || {};
    var needsModuleChoice = tierConfig.moduleLimit > 0 && tierConfig.moduleLimit < 7 && (sub.selectableModules || []).length > 0;

    logWizardEvent(3, 'analyze_complete', {
      crawlTier: data.crawlTier,
      platform: (data.crawlManifest && data.crawlManifest.platform) || 'unknown',
      templateId: data.draftTemplateId || null,
      templateConfidence: window._wizardTemplateConfidence
    });

    window._wizardHasWebsite = true;
    // If coming from Step 8 (post-wizard late import), skip path picker and finish.
    if (window._wizardStep9PostAnalyze) {
      window._wizardStep9PostAnalyze = false;
      showWizardStep('fastDpa');
      saveWizardProgress('fastDpa', { siteAnalyzed: true, autoApplied: _wizardAutoApplied });
      window._wizardAnalyzing = false;
    } else {
      wizardShowSitePathPicker(data);
    }
  } catch (err) {
    clearInterval(progressTimer);
    window._wizardAnalyzing = false;
    logWizardEvent(3, 'analyze_error', { code: err.code || '', message: err.message || '' });

    var userMsg = 'We hit a snag analyzing your site.';
    var code = err.code || '';
    var msg = err.message || '';
    if (code === 'deadline-exceeded' || msg.includes('timeout') || msg.includes('DEADLINE')) {
      userMsg = 'Your site took too long to analyze. This can happen with complex sites.';
    } else if (msg.includes('Could not fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      userMsg = 'We couldn\'t reach your site. Make sure the URL is correct and publicly accessible.';
    } else if (msg.includes('not configured')) {
      userMsg = 'There was a configuration issue on our end. Please try again.';
    } else if (msg.includes('No HTML') || msg.includes('does not return HTML')) {
      userMsg = 'That URL doesn\'t appear to be a website. Check the address and try again.';
    }

    statusEl.innerHTML = '<div style="background:rgba(220,38,38,0.08);border:1px solid var(--danger);border-radius:8px;padding:16px;text-align:center;">' +
      '<p style="color:var(--danger);font-weight:600;margin:0 0 4px;">' + esc(userMsg) + '</p>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0;">Click Retry to try again, or skip this step.</p></div>';
    btn.disabled = false;
    btn.textContent = 'Retry';
    btn.onclick = wizardAnalyzeSite;
  }
}

// === B1: wizardAutoApplyAll refactored into composable helpers =============
// Orchestrator writes the entity tree (identity, presence, operations.localization)
// plus the brand pointer + platform registry on every wizard run.
// Storefront-specific writes (public/config/theme, public/config/nav,
// webPresence/config/features, webPresence/config) are deferred to
// applyStorefrontConfig, which B3 calls only when engagement.mode === 'storefront'.
// Sync-channels / back-office modes skip them entirely.

// Pure function: normalize scrape output into a flat shape used by entity writers.
function _wizardExtractAnalysisFields(analysis, data) {
  analysis = analysis || {};
  data = data || {};
  var discovered = data.discovered
    || analysis.discovered
    || (data.crawlManifest && data.crawlManifest.discovered)
    || {};
  var primary = (analysis.colors && analysis.colors.primary && /^#[0-9A-Fa-f]{6}$/.test(analysis.colors.primary)) ? analysis.colors.primary : 'var(--amber)';
  var accent = (analysis.colors && analysis.colors.accent && /^#[0-9A-Fa-f]{6}$/.test(analysis.colors.accent)) ? analysis.colors.accent : 'var(--teal)';
  var tagline = (analysis.hero && analysis.hero.subheadline) || '';
  return {
    businessName: analysis.businessName || '',
    tagline: tagline,
    oneLineDescription: analysis.description || '',
    primaryDomain: window._wizardAnalyzedUrl || analysis.primaryDomain || '',
    logoUrl: analysis.logo || '',
    primaryColor: primary,
    accentColor: accent,
    styleRecommendation: analysis.styleRecommendation || 'artisan-warm',
    inferredArchetype: discovered.inferredArchetype || analysis.inferredArchetype || null,
    archetypeConfidence: (typeof discovered.archetypeConfidence === 'number')
      ? discovered.archetypeConfidence
      : (typeof analysis.archetypeConfidence === 'number' ? analysis.archetypeConfidence : null),
    declaredChannels: (discovered.inferredChannels || analysis.inferredChannels || []).slice(),
    externalChannels: (discovered.externalChannels || []).slice(),
    socialProfiles: (analysis.socialProfiles || []).slice()
  };
}

// Pure function: detect wizard content modules from crawl manifest.
function _detectModulesFromManifest(manifest) {
  var ct = (manifest && manifest.contentTypes) || {};
  var out = [];
  if (ct.products && ct.products.found) out.push('sell');
  if (ct.blog && ct.blog.found) out.push('market');
  if (ct.events && ct.events.found) out.push('show');
  return out;
}

// B1: write entity identity (excluding archetype — that's B1a).
async function _applyEntityIdentity(extracted) {
  var payload = { businessName: extracted.businessName };
  if (extracted.tagline) payload.tagline = extracted.tagline;
  if (extracted.oneLineDescription) payload.oneLineDescription = extracted.oneLineDescription;
  if (typeof extracted.archetypeConfidence === 'number') payload.archetypeConfidence = extracted.archetypeConfidence;
  return MastDB.businessEntity.update('identity', payload);
}

// B1: write entity presence. Arrays pass through untouched; missing fields omitted.
async function _applyEntityPresence(extracted) {
  var payload = {};
  if (extracted.primaryDomain) payload.primaryDomain = extracted.primaryDomain;
  if (extracted.declaredChannels && extracted.declaredChannels.length) {
    payload.declaredChannels = extracted.declaredChannels;
  }
  if (extracted.socialProfiles && extracted.socialProfiles.length) {
    payload.socialProfiles = extracted.socialProfiles;
  }
  if (!Object.keys(payload).length) return null;
  return MastDB.businessEntity.update('presence', payload);
}

// B1: silent-inferred browser defaults per spec D2. Always called, never asked.
async function _applyEntityOperationsLocalization() {
  var tz = 'America/New_York';
  try {
    var resolved = Intl.DateTimeFormat().resolvedOptions();
    if (resolved && resolved.timeZone) tz = resolved.timeZone;
  } catch (e) { /* fall through to default */ }
  var lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US';
  return MastDB.businessEntity.update('operations', {
    localization: { currency: 'USD', timezone: tz, language: lang, fiscalYearStartMonth: 1 }
  });
}

// B1: brand pointer (config/brand is the canonical visual source; entity.visual
// reads through to it per spec §2.3). Preserves the existing logo-processing step.
// Does NOT overwrite a logoUrl the user already set (e.g. via the brand-step upload).
//
// All brand-field writes go through MastBrandSync (single writer, see
// shared/brand-sync.js — introduced in 2d9faa2). MastBrandSync writes the
// canonical paths (config/brand/logo/primary, config/brand.name|tagline,
// public/config/theme.{primaryColor,accentColor}) and fans out to legacy mirrors
// (public/config/nav/logoUrl, config/brand.logoUrl, businessEntity/identity,
// platform publicConfig). NEVER write those paths directly here.
async function _applyBrandPointer(extracted) {
  // Read existing brand to check what the user has already set explicitly.
  var existing = await MastDB.config.get('brand').catch(function() { return null; });
  var existingLogo = existing && (existing.logoUrl || (existing.logo && existing.logo.primary && existing.logo.primary.url));
  var existingName = existing && existing.name;
  var existingTagline = existing && existing.tagline;

  var logoUrl = extracted.logoUrl;
  if (logoUrl) {
    try { logoUrl = await processAndUploadLogo(logoUrl); } catch (e) { /* use original */ }
  }
  extracted.logoUrl = logoUrl;

  // Description is not yet a first-class MastBrandSync field; write it directly
  // to config/brand (alongside the updatedAt stamp) as a legacy field.
  if (extracted.oneLineDescription) {
    await MastDB.config.update('brand', {
      description: extracted.oneLineDescription,
      updatedAt: new Date().toISOString()
    });
  }

  // Route all canonical brand writes through MastBrandSync.
  // Only fill name/tagline/logo from the scan when the user hasn't set them.
  if (!existingName && extracted.businessName && window.MastBrandSync) {
    await window.MastBrandSync.setName(extracted.businessName);
  }
  if (!existingTagline && extracted.tagline && window.MastBrandSync) {
    await window.MastBrandSync.setTagline(extracted.tagline);
  }
  if (!existingLogo && logoUrl && window.MastBrandSync) {
    await window.MastBrandSync.setLogo({
      url: logoUrl,
      storagePath: MastDB.tenantId() + '/brand/logo-processed.png',
      format: 'png'
    });
  }
  if (window.MastBrandSync && (extracted.primaryColor || extracted.accentColor)) {
    await window.MastBrandSync.setColors({
      primaryColor: extracted.primaryColor,
      accentColor: extracted.accentColor
    });
  }
}

// B1: platform registry + publicConfig writes.
// Brand fields (name, tagline, logo, colors) are mirrored to platform publicConfig
// by MastBrandSync — _applyBrandPointer already invoked it for those fields above.
// This function only writes the non-brand fields (brandDescription) to avoid
// double-writing and to keep MastBrandSync as the single writer for brand data.
async function _applyPlatformRegistry(extracted) {
  if (!extracted.businessName) return null;
  // brandDescription is not yet a first-class MastBrandSync field; mirror it directly.
  if (extracted.oneLineDescription) {
    return MastDB.platform.update('mast-platform/tenants/' + MastDB.tenantId() + '/publicConfig', {
      brandDescription: extracted.oneLineDescription
    });
  }
  return null;
}

// B1: storefront-only writes. Called by B3 when engagement.mode === 'storefront'.
// This is the old wizardAutoApplyAll steps 2, 4, 5.
//
// Brand-related theme fields (primaryColor, accentColor, fontPair) go through
// MastBrandSync. templateId/colorSchemeId are storefront-only fields (not brand)
// and stay as direct theme writes.
async function applyStorefrontConfig(extracted, detectedModules) {
  var errors = [];
  var templateMapping = STYLE_TO_TEMPLATE[extracted.styleRecommendation] || STYLE_TO_TEMPLATE['artisan-warm'];

  // Read canonical brand fields. `_applyBrandPointer` runs before this function
  // and preserves any user-set name/tagline (only filling them when blank). The
  // canonical config/brand is therefore the source of truth for the hero
  // headline + site title — NOT the raw scan output `extracted.businessName`,
  // which can be a generic page <title> like "Example Domain" when the user
  // is just exploring with a placeholder URL. Fall back to scan output only
  // when the canonical field is empty.
  var canonicalBrand = await MastDB.config.get('brand').catch(function() { return null; });
  var canonicalName = (canonicalBrand && canonicalBrand.name) || extracted.businessName || '';
  var canonicalTagline = (canonicalBrand && canonicalBrand.tagline) || extracted.tagline || '';
  var canonicalDescription = (canonicalBrand && canonicalBrand.description) || extracted.oneLineDescription || '';

  // Non-brand theme fields (templateId, colorSchemeId) — direct write.
  var themeUpdate = {
    templateId: templateMapping.templateId,
    colorSchemeId: templateMapping.schemeId || null
  };
  await MastDB.update('public/config/theme', themeUpdate).catch(function(e) { errors.push('theme: ' + e.message); });
  // Brand theme fields — route through MastBrandSync (writes canonical
  // public/config/theme + mirrors to platform publicConfig).
  if (window.MastBrandSync) {
    if (templateMapping.fontPair) {
      await window.MastBrandSync.setFontPair(templateMapping.fontPair).catch(function(e) { errors.push('fontPair: ' + e.message); });
    }
    if (!templateMapping.schemeId && (extracted.primaryColor || extracted.accentColor)) {
      await window.MastBrandSync.setColors({
        primaryColor: extracted.primaryColor,
        accentColor: extracted.accentColor
      }).catch(function(e) { errors.push('colors: ' + e.message); });
    }
  }

  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  var mods = (tierConfig.moduleLimit >= 7) ? (sub.modules || []) : (sub.baseModules || ['web']).concat(detectedModules || []);
  var hasSell = mods.indexOf('sell') >= 0;
  var hasMarket = mods.indexOf('market') >= 0;
  var hasShow = mods.indexOf('show') >= 0;

  var features = {
    shop: hasSell, blog: hasMarket, events: hasShow, members: false,
    newsletter: hasMarket, commissions: hasSell, stories: false, social: hasMarket, wholesale: hasSell
  };
  await MastDB.set('webPresence/config/features', features).catch(function(e) { errors.push('features: ' + e.message); });

  var navSections = { about: { enabled: true, order: 1 } };
  if (features.events) navSections.schedule = { enabled: true, order: 2 };
  if (features.blog) navSections.blog = { enabled: true, order: 3 };
  if (features.shop) {
    navSections.orders = { enabled: true, order: 10 };
    navSections.wholesale = { enabled: features.wholesale, order: 11 };
    navSections.commission = { enabled: features.commissions, order: 12 };
    navSections.shop = { enabled: true, highlight: true, order: 50 };
  }
  if (features.newsletter) navSections.newsletter = { enabled: true, order: 60 };
  navSections.contact = { enabled: true, order: 99 };
  await MastDB.set('public/config/nav/sections', navSections).catch(function(e) { errors.push('nav: ' + e.message); });
  // Logo mirror to public/config/nav/logoUrl is handled by MastBrandSync.setLogo
  // (called from _applyBrandPointer above when the scanned logo wins). Direct
  // writes to that path are intentionally omitted to keep MastBrandSync the
  // single writer for brand data.

  var wpConfig = {
    style: extracted.styleRecommendation,
    primaryColor: extracted.primaryColor,
    accentColor: extracted.accentColor,
    fontPair: templateMapping.fontPair,
    sections: {
      hero: { headline: canonicalName, subheadline: canonicalTagline, ctaText: 'Shop Now', ctaUrl: '', backgroundType: 'color', backgroundAsset: '', overlayOpacity: 40 },
      gallery: { enabled: true, heading: 'Our Work', layout: 'grid', columns: 3 },
      about: { enabled: true, heading: 'About', body: canonicalDescription, imageUrl: '' },
      contact: { enabled: true, heading: 'Contact', email: '', phone: '', address: '', showForm: true, socialLinks: {} },
      newsletter: { enabled: false, heading: 'Stay in touch', subheadline: '', buttonLabel: 'Subscribe' },
      members: { enabled: false, accessModel: 'passcode', passcode: '', allowedEmails: [], gatedContent: '' }
    },
    nav: { items: ['Work', 'About', 'Contact'], showShopLink: hasSell, shopUrl: '' },
    meta: { siteTitle: canonicalName, tagline: canonicalTagline, favicon: '' },
    status: 'draft',
    publishedAt: null,
    updatedAt: new Date().toISOString()
  };
  await MastDB.update('webPresence/config', wpConfig).catch(function(e) { errors.push('webPresence: ' + e.message); });

  return { templateId: templateMapping.templateId, features: features, errors: errors };
}

// B1 orchestrator. Does NOT write storefront config — B3 does that for storefront mode.
async function wizardAutoApplyAll(analysis, data) {
  var extracted = _wizardExtractAnalysisFields(analysis, data);
  var detectedModules = _detectModulesFromManifest(window._wizardCrawlManifest || {});
  window._wizardExtracted = extracted;
  window._wizardDetectedModules = detectedModules;

  var autoApplied = { brand: false, registry: false, entity: false };
  var writeErrors = [];

  // Universal writes — fire for every engagement mode.
  await _applyBrandPointer(extracted).then(function() { autoApplied.brand = true; })
    .catch(function(e) { writeErrors.push('brand: ' + e.message); });

  if (extracted.businessName) {
    await _applyPlatformRegistry(extracted).then(function() { autoApplied.registry = true; })
      .catch(function(e) { writeErrors.push('registry: ' + e.message); });
  }

  await _applyEntityIdentity(extracted)
    .catch(function(e) { writeErrors.push('entity.identity: ' + e.message); });
  await _applyEntityPresence(extracted)
    .catch(function(e) { writeErrors.push('entity.presence: ' + e.message); });
  await _applyEntityOperationsLocalization()
    .catch(function(e) { writeErrors.push('entity.operations: ' + e.message); });
  autoApplied.entity = true;

  // Tier-derived subscription bookkeeping (retained for legacy nav/gating code).
  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  if (tierConfig.moduleLimit >= 7) {
    autoApplied.modules = sub.modules || [];
  } else if (tierConfig.moduleLimit === 0) {
    autoApplied.modules = sub.baseModules || ['web'];
  } else {
    var autoSelected = detectedModules.slice(0, tierConfig.moduleLimit);
    _wizardSelectedModules = autoSelected;
    autoApplied.detectedModules = detectedModules;
    autoApplied.autoSelectedModules = autoSelected;
  }

  _wizardAutoApplied = autoApplied;
  await MastDB.config.set('setupProgress/autoApplied', autoApplied).catch(function() {});

  if (writeErrors.length > 0) {
    logWizardEvent(3, 'auto_apply_partial', { errors: writeErrors });
    showToast('Some settings could not be saved. You can update them in Settings.', true);
  } else {
    logWizardEvent(3, 'auto_apply_complete', autoApplied);
  }
}

// Step 2: Render inline module cards (reuses MODULE_REGISTRY pattern)
function wizardRenderModuleCards() {
  var container = document.getElementById('wizardModuleCards');
  if (!container) return;

  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  var limit = tierConfig.moduleLimit || 0;
  var selectable = sub.selectableModules || [];
  if (selectable.length === 0) return;

  // Detect which modules were found on the site
  var manifest = window._wizardCrawlManifest || {};
  var ct = manifest.contentTypes || {};
  var detectedMap = {};
  if (ct.products && ct.products.found) detectedMap.sell = true;
  if (ct.blog && ct.blog.found) detectedMap.market = true;
  if (ct.events && ct.events.found) detectedMap.show = true;

  // Pre-select detected modules (up to limit)
  if (_wizardSelectedModules.length === 0) {
    selectable.forEach(function(modId) {
      if (detectedMap[modId] && _wizardSelectedModules.length < limit) {
        _wizardSelectedModules.push(modId);
      }
    });
  }

  // Update subtitle
  var subtitleEl = document.getElementById('wizardModuleSubtext');
  var tierName = tierConfig.name || sub.tier;
  if (subtitleEl) {
    subtitleEl.textContent = 'Your ' + tierName + ' plan lets you pick ' + limit + ' module' + (limit !== 1 ? 's' : '') + '. Detected tools are pre-selected.';
  }

  var atLimit = _wizardSelectedModules.length >= limit;
  var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">';

  selectable.forEach(function(moduleId) {
    var mod = MODULE_REGISTRY[moduleId];
    if (!mod || mod.status === 'coming-soon') return;

    var isSelected = _wizardSelectedModules.indexOf(moduleId) >= 0;
    var isDetected = !!detectedMap[moduleId];
    var canClick = !atLimit || isSelected;
    var border = isSelected ? '2px solid var(--amber)' : '1px solid var(--cream-dark)';
    var bg = isSelected ? 'var(--cream-dark)' : 'var(--cream)';
    var opacity = (atLimit && !isSelected) ? '0.45' : '1';
    var shadow = isSelected ? '0 2px 12px rgba(196, 133, 60, 0.25)' : '0 1px 3px rgba(0,0,0,0.08)';
    var cursor = canClick ? 'pointer' : 'default';
    var onclick = canClick ? 'onclick="wizardToggleModule(\'' + esc(moduleId) + '\')"' : '';

    h += '<div data-module="' + esc(moduleId) + '" ' + onclick + ' style="background:' + bg + ';border:' + border + ';border-radius:8px;padding:18px;cursor:' + cursor + ';opacity:' + opacity + ';box-shadow:' + shadow + ';transition:all 0.2s;position:relative;">';

    if (isSelected) {
      h += '<span style="position:absolute;top:10px;right:10px;background:var(--amber);color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700;">&#10003;</span>';
    }

    h += '<div style="font-size:1.6rem;margin-bottom:4px;">' + mod.icon + '</div>';
    h += '<div style="font-size:1.0rem;font-weight:700;font-family:\'Cormorant Garamond\', serif;margin-bottom:3px;">' + esc(mod.name) + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.4;">' + esc(mod.description) + '</div>';

    if (isDetected) {
      h += '<div style="margin-top:8px;font-size:0.78rem;color:var(--teal);font-weight:600;">&#10003; Found on your site</div>';
    }

    h += '</div>';
  });

  h += '</div>';
  container.innerHTML = h;

  // Update confirm button
  wizardUpdateModuleBtn();
}

function wizardToggleModule(moduleId) {
  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  var limit = tierConfig.moduleLimit || 0;

  var idx = _wizardSelectedModules.indexOf(moduleId);
  if (idx >= 0) {
    _wizardSelectedModules.splice(idx, 1);
  } else if (_wizardSelectedModules.length < limit) {
    _wizardSelectedModules.push(moduleId);
  }
  wizardRenderModuleCards();
}

function wizardUpdateModuleBtn() {
  var btn = document.getElementById('wizardModuleConfirmBtn');
  if (!btn) return;
  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  var limit = tierConfig.moduleLimit || 0;
  var ready = _wizardSelectedModules.length === limit;
  btn.disabled = !ready;
  btn.textContent = ready
    ? 'Activate ' + _wizardSelectedModules.length + ' Module' + (_wizardSelectedModules.length !== 1 ? 's' : '')
    : 'Select ' + (limit - _wizardSelectedModules.length) + ' more';
  btn.style.opacity = ready ? '1' : '0.6';
}

// Step 2: Confirm module selection and advance to step 3
async function wizardConfirmModules() {
  var sub = getTenantSubscription();
  var tierConfig = TIER_CONFIG[sub.tier] || {};
  var limit = tierConfig.moduleLimit || 0;
  if (_wizardSelectedModules.length !== limit) return;

  var btn = document.getElementById('wizardModuleConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Activating...'; }

  try {
    var baseModules = sub.baseModules || ['web'];
    var newModules = baseModules.concat(_wizardSelectedModules);

    await MastDB.subscription.update({
      selectedModules: _wizardSelectedModules,
      modules: newModules,
      needsModuleSelection: false,
      updatedAt: new Date().toISOString()
    });

    // Update nav sections for newly selected modules
    var hasSell = newModules.indexOf('sell') >= 0;
    var hasMarket = newModules.indexOf('market') >= 0;
    var hasShow = newModules.indexOf('show') >= 0;

    var features = {
      shop: hasSell, blog: hasMarket, events: hasShow, members: false,
      newsletter: hasMarket, commissions: hasSell, stories: false, social: hasMarket, wholesale: hasSell
    };
    await MastDB.set('webPresence/config/features', features);

    // Nav order: Shop always last in both contexts (matches wizardAutoApplyAll)
    var navSections = { about: { enabled: true, order: 1 } };
    if (features.events) navSections.schedule = { enabled: true, order: 2 };
    if (features.blog) navSections.blog = { enabled: true, order: 3 };
    if (features.shop) {
      navSections.orders = { enabled: true, order: 10 };
      navSections.wholesale = { enabled: features.wholesale, order: 11 };
      navSections.commission = { enabled: features.commissions, order: 12 };
      navSections.shop = { enabled: true, highlight: true, order: 50 };
    }
    if (features.newsletter) navSections.newsletter = { enabled: true, order: 60 };
    navSections.contact = { enabled: true, order: 99 };
    await MastDB.set('public/config/nav/sections', navSections);

    logWizardEvent(6, 'modules_confirmed', { modules: _wizardSelectedModules });
    showWizardStep('4');
    saveWizardProgress('4', { modulesSelected: _wizardSelectedModules });
  } catch (err) {
    logWizardEvent(6, 'modules_error', { message: err.message });
    showToast('Failed to save module selection: ' + esc(err.message), true);
    if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
  }
}

// B0: import-job creation accepts a `mode` option so B3 can set the job's
// engagement mode (storefront | pim-only | draft-only) per spec §5.
// processImportJob branches on job.mode; default 'storefront' keeps legacy jobs safe.
async function wizardCreateImportJob(opts) {
  opts = opts || {};
  var jobMode = opts.mode || 'storefront';
  if (!window._wizardCrawlManifest) return null;
  var ct = window._wizardCrawlManifest.contentTypes || {};
  var hasContent = (ct.products && ct.products.found) || (ct.blog && ct.blog.found) || (ct.events && ct.events.found);
  if (!hasContent) return null;
  try {
    var jobData = {
      id: MastDB.newKey('webPresence/importJobs'),
      url: window._wizardAnalyzedUrl,
      tenantId: MastDB.tenantId(),
      status: 'pending',
      mode: jobMode,
      createdAt: new Date().toISOString(),
      claimedAt: null, completedAt: null, error: null,
      crawlManifest: window._wizardCrawlManifest,
      discovered: null, imported: null
    };
    await MastDB.set('webPresence/importJobs/' + jobData.id, jobData);
    return jobData.id;
  } catch (e) {
    console.error('Failed to create import job:', e);
    return null;
  }
}

// (Payment processor selection moved to dashboard guided steps — no longer a wizard step)
// (Legacy feature selection removed — modules auto-selected from content detection)

var _wizardImportListener = null;
var _wizardProgressFeedListener = null;

function showWizardImportTimeline() {
  var timeline = document.getElementById('wizardImportTimeline');
  var feed = document.getElementById('wizardImportFeed');
  var progressBar = document.getElementById('wizardImportProgressBar');
  if (!timeline || !feed) return;

  // Find the most recent import job (guard against missing Firebase context)
  if (!MastDB.tenantId()) { timeline.style.display = 'none'; return; }
  MastDB.query('webPresence/importJobs').orderByChild('createdAt').limitToLast(1).once('value').then(function(snap) {
    var jobs = snap.val();
    if (!jobs) { timeline.style.display = 'none'; return; }

    var jobId = Object.keys(jobs)[0];
    var job = jobs[jobId];
    if (!job) { timeline.style.display = 'none'; return; }

    timeline.style.display = '';
    if (progressBar) progressBar.style.display = '';

    // Seed the feed with auto-applied items
    var seedLines = [
      wizardFeedLine('done', 'Applied your brand colors and logo'),
      wizardFeedLine('done', 'Set up your template and navigation')
    ];
    feed.innerHTML = seedLines.join('');

    // If already complete, render final state immediately
    if (job.status === 'complete' || job.status === 'failed') {
      job.id = jobId;
      wizardRenderImportFinalState(job, feed, progressBar);
      return;
    }

    // Import is still running — show tutorial videos while they wait
    wizardShowVideoCarousel();

    // Disable Launch Dashboard while import runs
    wizardSetLaunchEnabled(false);

    // Show indeterminate progress until estimate arrives
    var fill0 = document.getElementById('wizardImportProgressFill');
    var label0 = document.getElementById('wizardImportProgressLabel');
    var pctEl0 = document.getElementById('wizardImportProgressPct');
    if (fill0) { fill0.style.width = '5%'; fill0.style.animation = 'wizardPulse 2s ease-in-out infinite'; }
    if (label0) label0.textContent = 'Starting import...';
    if (pctEl0) pctEl0.textContent = '';

    // Countdown timer state
    var _countdownEstimate = 0;
    var _countdownStart = 0;
    var _countdownTimer = null;
    var _countdownDone = false;

    function startCountdown(estimatedSeconds, estimatedAt) {
      if (_countdownTimer || _countdownDone) return;
      _countdownEstimate = estimatedSeconds;
      _countdownStart = estimatedAt ? new Date(estimatedAt).getTime() : Date.now();
      var fill = document.getElementById('wizardImportProgressFill');
      if (fill) fill.style.animation = 'none';

      _countdownTimer = setInterval(function() {
        var elapsed = (Date.now() - _countdownStart) / 1000;
        var remaining = Math.max(0, _countdownEstimate - elapsed);
        var pct = Math.min(Math.round((elapsed / _countdownEstimate) * 100), 95); // cap at 95% until done

        var fillEl = document.getElementById('wizardImportProgressFill');
        var labelEl = document.getElementById('wizardImportProgressLabel');
        var pctElC = document.getElementById('wizardImportProgressPct');

        if (fillEl) fillEl.style.width = pct + '%';
        if (pctElC) pctElC.textContent = pct + '%';

        if (remaining > 60) {
          var mins = Math.ceil(remaining / 60);
          if (labelEl) labelEl.textContent = '~' + mins + ' minute' + (mins !== 1 ? 's' : '') + ' remaining...';
        } else if (remaining > 0) {
          if (labelEl) labelEl.textContent = '~' + Math.ceil(remaining) + 's remaining...';
        } else {
          if (labelEl) labelEl.textContent = 'Finishing up...';
        }
      }, 1000);
    }

    function stopCountdown() {
      if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
      _countdownDone = true;
    }

    // --- Real-time listener on the job ---
    if (_wizardImportListener) { _wizardImportListener(); _wizardImportListener = null; }
    _wizardImportListener = MastDB.subscribe('webPresence/importJobs/' + jobId, function(liveJob) {
      if (!liveJob) return;

      // Start countdown when estimate arrives
      if (liveJob.estimatedSeconds && !_countdownTimer && !_countdownDone) {
        startCountdown(liveJob.estimatedSeconds, liveJob.estimatedAt);
      }

      if (liveJob.status === 'complete' || liveJob.status === 'failed') {
        // Stop countdown and job status listener
        stopCountdown();
        if (_wizardImportListener) { _wizardImportListener(); _wizardImportListener = null; }
        // Delay detaching progressFeed listener — Firebase may deliver status=complete
        // before all progressFeed children have arrived at the client
        setTimeout(function() {
          if (_wizardProgressFeedListener) { _wizardProgressFeedListener(); _wizardProgressFeedListener = null; }
          // Mark any remaining in-progress lines as done
          var remaining = feed.querySelectorAll('.wiz-feed-line[data-status="progress"]');
          for (var r = 0; r < remaining.length; r++) {
            remaining[r].setAttribute('data-status', 'done');
            var ic = remaining[r].querySelector('.wiz-feed-icon');
            if (ic) { ic.style.color = 'var(--teal)'; ic.innerHTML = '&#10003;'; }
          }
        }, 2000);
        var fillDone = document.getElementById('wizardImportProgressFill');
        var labelDone = document.getElementById('wizardImportProgressLabel');
        var pctDone = document.getElementById('wizardImportProgressPct');
        if (fillDone) { fillDone.style.width = '100%'; fillDone.style.animation = 'none'; }
        if (labelDone) labelDone.textContent = liveJob.status === 'complete' ? 'Import complete!' : 'Import failed';
        if (pctDone) pctDone.textContent = '100%';
        liveJob.id = jobId;
        wizardSetLaunchEnabled(true);
        wizardRenderImportFinalState(liveJob, feed, progressBar);
      }
    });

    // --- Real-time listener on progressFeed children ---
    if (_wizardProgressFeedListener) { _wizardProgressFeedListener(); _wizardProgressFeedListener = null; }
    _wizardProgressFeedListener = MastDB.subscribeChild('webPresence/importJobs/' + jobId + '/progressFeed', 'child_added', function(evt) {
      if (!evt || !evt.message) return;
      var icon = evt.level === 'error' ? 'error' : (evt.level === 'warn' ? 'warn' : 'progress');
      // Mark previous progress line as done (swap gear → check)
      var prevLines = feed.querySelectorAll('.wiz-feed-line[data-status="progress"]');
      if (prevLines.length > 0) {
        var last = prevLines[prevLines.length - 1];
        last.setAttribute('data-status', 'done');
        var iconEl = last.querySelector('.wiz-feed-icon');
        if (iconEl) { iconEl.style.color = 'var(--teal)'; iconEl.innerHTML = '&#10003;'; }
      }
      feed.innerHTML += wizardFeedLine(icon, evt.message);
      feed.scrollTop = feed.scrollHeight;
    });

  }).catch(function(e) {
    console.warn('showWizardImportTimeline error:', e);
    timeline.style.display = 'none';
  });
}

function wizardFeedLine(icon, text) {
  var iconHtml = '';
  if (icon === 'done') iconHtml = '<span class="wiz-feed-icon" style="color:var(--teal);flex-shrink:0;">&#10003;</span>';
  else if (icon === 'progress') iconHtml = '<span class="wiz-feed-icon" style="color:var(--amber);flex-shrink:0;">&#9898;</span>';
  else if (icon === 'error') iconHtml = '<span class="wiz-feed-icon" style="color:var(--danger);flex-shrink:0;">&#10007;</span>';
  else if (icon === 'warn') iconHtml = '<span style="color:var(--amber);flex-shrink:0;">&#9888;</span>';
  return '<div class="wiz-feed-line" data-status="' + icon + '" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">' + iconHtml + ' ' + esc(text) + '</div>';
}

function wizardRenderImportFinalState(job, feed, progressBar) {
  // Update progress bar to 100%
  if (progressBar && job.status === 'complete') {
    var fill = document.getElementById('wizardImportProgressFill');
    var label = document.getElementById('wizardImportProgressLabel');
    var pctEl = document.getElementById('wizardImportProgressPct');
    if (fill) fill.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (label) label.textContent = 'Import complete!';
  } else if (progressBar && job.status === 'failed') {
    var fill2 = document.getElementById('wizardImportProgressFill');
    var label2 = document.getElementById('wizardImportProgressLabel');
    if (fill2) { fill2.style.width = '100%'; fill2.style.background = 'var(--danger)'; }
    if (label2) label2.textContent = 'Import failed';
  }

  // Add final feed lines
  var imp = job.imported || {};
  if (job.status === 'complete') {
    if (imp.products && imp.products.done) {
      feed.innerHTML += wizardFeedLine('done', 'Imported ' + imp.products.done + ' products');
    }
    if (imp.images && imp.images.done) {
      feed.innerHTML += wizardFeedLine('done', 'Imported ' + imp.images.done + ' images');
    }
    if (imp.events && imp.events.done) {
      feed.innerHTML += wizardFeedLine('done', 'Imported ' + imp.events.done + ' events');
    }
    feed.innerHTML += wizardFeedLine('done', 'Import complete! Review in your dashboard.');
  } else if (job.status === 'failed') {
    feed.innerHTML += wizardFeedLine('error', 'Import error: ' + (job.error || 'Something went wrong. You can retry from Website > Import.'));
  }

  // Show gap analysis walkthrough if available, otherwise fall back to legacy report
  if (job.collectionReport && job.collectionReport.gapAnalysis && job.collectionReport.gapAnalysis.length > 0) {
    // Give the feed a moment to render before transitioning
    setTimeout(function() { wizardTransitionToWalkthrough(job); }, 800);
  } else if (job.collectionReport) {
    wizardRenderCollectionReport(job.collectionReport);
  }
}

// Render the collection report inline below the feed
function wizardRenderCollectionReport(report) {
  var container = document.getElementById('wizardCollectionReport');
  var body = document.getElementById('wizardCollectionReportBody');
  if (!container || !body) return;

  var s = report.summary || {};
  var g = report.gathered || {};
  var gaps = report.gaps || [];
  var cost = report.costSummary || {};
  var gapRows = report.gapAnalysis || [];

  var h = '';

  // Quality score badge
  var scoreColor = s.qualityScore >= 80 ? 'var(--teal)' : s.qualityScore >= 60 ? 'var(--amber)' : 'var(--danger)';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  h += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(String(s.productsFound || 0)) + ' products from ' + esc(s.platform || 'your site') + '</span>';
  h += '<span style="background:' + scoreColor + ';color:white;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;text-transform:uppercase;">' + esc(String(s.qualityScore || 0)) + '% ' + esc(s.qualityLabel || '') + '</span>';
  h += '</div>';

  // Gap analysis rows (if available from enhanced backend)
  if (gapRows.length > 0) {
    var statusIcons = {
      'complete': '<span style="color:var(--teal);">&#10003;</span>',
      'partial': '<span style="color:var(--amber);">&#9679;</span>',
      'action-needed': '<span style="color:var(--amber);">&#9888;</span>',
      'missing': '<span style="color:var(--danger);">&#10007;</span>',
      'info': '<span style="color:var(--warm-gray);">&#8505;</span>'
    };

    gapRows.forEach(function(row) {
      var icon = statusIcons[row.status] || statusIcons['info'];
      h += '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--cream-dark,#e8e0d4);">';
      h += '<div style="flex-shrink:0;margin-top:1px;">' + icon + '</div>';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:0.85rem;font-weight:600;">' + esc(row.capability) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(row.detectedLabel);
      if (row.matchedLabel) h += ' &rarr; ' + esc(row.matchedLabel);
      h += '</div>';
      if (row.gap) {
        h += '<div style="font-size:0.78rem;color:var(--amber);margin-top:2px;">' + esc(row.gap);
        if (row.plan && row.plan !== 'Complete') h += ' &mdash; ' + esc(row.plan);
        h += '</div>';
      }
      h += '</div></div>';
    });

    // Show enrichment offer if paid gaps exist
    var paidGaps = gaps.filter(function(g) { return g.cost === 'paid'; });
    if (paidGaps.length > 0) {
      wizardShowEnrichmentOffer(paidGaps, cost);
    }
  } else {
    // Fallback: legacy field-level view
    var fieldLabels = { name: 'Names', price: 'Prices', description: 'Descriptions', images: 'Images', category: 'Categories', variants: 'Variants', sku: 'SKUs', weight: 'Weight', tags: 'Tags' };
    var total = g.total || 1;
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:12px;">';
    Object.keys(fieldLabels).forEach(function(field) {
      var count = g[field] || 0;
      var icon = count >= total ? '<span style="color:var(--teal);">&#10003;</span>' : count > 0 ? '<span style="color:var(--amber);">&#9679;</span>' : '<span style="color:var(--warm-gray);">&#9675;</span>';
      h += '<div style="font-size:0.85rem;">' + icon + ' ' + esc(fieldLabels[field]) + ' <span style="color:var(--warm-gray);">(' + count + '/' + total + ')</span></div>';
    });
    h += '</div>';

    // Gaps summary
    if (gaps.length > 0) {
      var freeGaps = gaps.filter(function(g) { return g.cost === 'free'; });
      var paidGaps = gaps.filter(function(g) { return g.cost === 'paid'; });
      var manualGaps = gaps.filter(function(g) { return g.cost === 'manual'; });

      if (freeGaps.length > 0) {
        h += '<div style="font-size:0.85rem;color:var(--teal);margin-bottom:4px;">&#10003; ' + freeGaps.length + ' field' + (freeGaps.length !== 1 ? 's' : '') + ' can be enriched for free (' + freeGaps.map(function(g) { return g.field; }).join(', ') + ')</div>';
      }
      if (paidGaps.length > 0) {
        h += '<div style="font-size:0.85rem;color:var(--amber);margin-bottom:4px;">&#10024; ' + paidGaps.length + ' field' + (paidGaps.length !== 1 ? 's' : '') + ' available with AI enrichment (' + paidGaps.map(function(g) { return g.field; }).join(', ') + ')</div>';
        wizardShowEnrichmentOffer(paidGaps, cost);
      }
      if (manualGaps.length > 0) {
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;">&#9675; ' + manualGaps.length + ' field' + (manualGaps.length !== 1 ? 's' : '') + ' best added manually (' + manualGaps.map(function(g) { return g.field; }).join(', ') + ')</div>';
      }
    }
  }

  body.innerHTML = h;
  container.style.display = '';
}

var _wizardEnrichmentFields = [];
var _wizardImportJobId = null;

function wizardShowEnrichmentOffer(paidGaps, cost) {
  var offer = document.getElementById('wizardEnrichmentOffer');
  var desc = document.getElementById('wizardEnrichmentDesc');
  var costEl = document.getElementById('wizardEnrichCost');
  if (!offer || !desc) return;

  _wizardEnrichmentFields = paidGaps.map(function(g) { return g.field; });
  var fields = _wizardEnrichmentFields.join(', ');
  var tokens = cost.estimatedTokens || 0;
  var coins = Math.ceil(tokens / 100);

  desc.textContent = 'AI can fill in ' + fields + ' for your products. This uses your token balance.';
  if (costEl) costEl.textContent = '~' + coins + ' coins';

  // Load token balance to show alongside
  try {
    var tid = MastDB.tenantId();
    MastDB.platform.get('mast-platform/tenants/' + tid + '/tokenWallet').then(function(wallet) {
      wallet = wallet || {};
      var balance = (wallet.currentBalance || 0) + (wallet.coinTokenSurplus || 0);
      var balanceCoins = wallet.coinBalance || 0;
      if (costEl) costEl.textContent = '~' + coins + ' coins (balance: ' + balance + ' tokens, ' + balanceCoins + ' coins)';
    }).catch(function() {});
  } catch (e) { /* no Firebase context */ }

  // Find the import job ID for the enrichment call
  try {
    MastDB.query('webPresence/importJobs').orderByChild('createdAt').limitToLast(1).once('value').then(function(snap) {
      var jobs = snap.val();
      if (jobs) _wizardImportJobId = Object.keys(jobs)[0];
    }).catch(function() {});
  } catch (e) { /* no Firebase context */ }

  offer.style.display = '';
}

// Call runEnrichment Cloud Function
async function wizardRequestEnrichment() {
  var btn = document.getElementById('wizardEnrichBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enriching...'; }

  if (!_wizardImportJobId) {
    showToast('No import job found. Enrich products from the dashboard.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Enrich Now'; }
    return;
  }

  try {
    var result = await firebase.functions().httpsCallable('runEnrichment')({
      tenantId: MastDB.tenantId(),
      importJobId: _wizardImportJobId,
      fields: _wizardEnrichmentFields
    });

    var data = result.data || {};
    showToast(data.enriched + ' products enriched! ' + data.claudeCalls + ' AI calls used.');

    // Update the collection report display if we got an updated score
    if (data.updatedReport) {
      // Re-fetch and re-render the report
      try {
        MastDB.get('webPresence/importJobs/' + _wizardImportJobId + '/collectionReport').then(function(report) {
          if (report) wizardRenderCollectionReport(report);
        });
      } catch (e) { /* non-critical */ }
    }

    // Hide the enrichment offer
    var offer = document.getElementById('wizardEnrichmentOffer');
    if (offer) offer.style.display = 'none';

    if (btn) { btn.disabled = false; btn.textContent = 'Done!'; }
  } catch (err) {
    showToast('Enrichment failed: ' + esc(err.message), true);
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
}

// ─── Wizard Launch Button Control ────────────────────────────

function wizardSetLaunchEnabled(enabled) {
  var actions = document.getElementById('wizardStep4Actions');
  if (!actions) return;
  var btn = actions.querySelector('.btn-primary');
  if (btn) {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.5';
    btn.style.pointerEvents = enabled ? '' : 'none';
  }
}

// ─── Post-Import Guided Walkthrough ──────────────────────────
// Video carousel while import runs, then interactive gap analysis when done.

var _wizardVideoTimer = null;
var _wizardCurrentVideo = 0;
var _wizardGapSelections = {};  // capability -> { selected: bool, field: string, tokens: number }
var _wizardGapJobId = null;
var _wizardGapEnriching = false;
var _wizardGapProgressListener = null;

var WIZARD_VIDEOS = [
  {
    title: 'Managing Your Products',
    description: 'Learn how to edit products, set prices, manage inventory, and publish items to your shop.',
    icon: '&#128722;',
    duration: '1:30',
    placeholder: true  // Will be replaced with real video embed
  },
  {
    title: 'Setting Up Payments',
    description: 'Connect Square or Stripe so you can accept payments online and in person.',
    icon: '&#128179;',
    duration: '1:30',
    placeholder: true
  },
  {
    title: 'Customizing Your Look',
    description: 'Choose templates, adjust colors, rearrange sections, and make your site your own.',
    icon: '&#127912;',
    duration: '1:30',
    placeholder: true
  }
];

function wizardShowVideoCarousel() {
  var carousel = document.getElementById('wizardVideoCarousel');
  if (!carousel) return;
  carousel.style.display = '';
  _wizardCurrentVideo = 0;
  wizardRenderVideoCard(_wizardCurrentVideo);
  wizardRenderVideoDots();
  // Auto-advance every 30 seconds (placeholder — will be video duration when real)
  clearInterval(_wizardVideoTimer);
  _wizardVideoTimer = setInterval(function() {
    _wizardCurrentVideo = (_wizardCurrentVideo + 1) % WIZARD_VIDEOS.length;
    wizardRenderVideoCard(_wizardCurrentVideo);
    wizardRenderVideoDots();
  }, 30000);
}

function wizardRenderVideoCard(index) {
  var container = document.getElementById('wizardVideoContent');
  if (!container) return;
  var v = WIZARD_VIDEOS[index];
  if (!v) return;

  var h = '';
  if (v.placeholder) {
    // Placeholder card until real videos are added
    h += '<div style="padding:32px 24px;text-align:center;">';
    h += '<div style="font-size:1.6rem;margin-bottom:12px;">' + v.icon + '</div>';
    h += '<h3 style="font-size:1.15rem;margin-bottom:8px;">' + esc(v.title) + '</h3>';
    h += '<p style="font-size:0.9rem;color:var(--warm-gray);margin-bottom:16px;max-width:400px;margin-left:auto;margin-right:auto;">' + esc(v.description) + '</p>';
    h += '<div style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--warm-gray-light);">';
    h += '<span>&#9654;</span> <span>' + esc(v.duration) + '</span>';
    h += '</div>';
    h += '</div>';
  } else {
    // Real video embed (YouTube/Vimeo iframe)
    h += '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">';
    h += '<iframe src="' + esc(v.embedUrl) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe>';
    h += '</div>';
  }
  container.innerHTML = h;
}

function wizardRenderVideoDots() {
  var dots = document.getElementById('wizardVideoDots');
  if (!dots) return;
  var h = '';
  for (var i = 0; i < WIZARD_VIDEOS.length; i++) {
    var active = i === _wizardCurrentVideo;
    h += '<button onclick="wizardGoToVideo(' + i + ')" style="width:8px;height:8px;border-radius:50%;border:none;cursor:pointer;padding:0;';
    h += active ? 'background:var(--teal);' : 'background:var(--cream-dark);';
    h += '"></button>';
  }
  // Next button
  h += '<button onclick="wizardNextVideo()" style="background:none;border:none;cursor:pointer;font-size:0.78rem;color:var(--teal);padding:0 4px;margin-left:8px;">Next &rarr;</button>';
  dots.innerHTML = h;
}

function wizardGoToVideo(index) {
  _wizardCurrentVideo = index;
  wizardRenderVideoCard(index);
  wizardRenderVideoDots();
  // Reset auto-advance timer
  clearInterval(_wizardVideoTimer);
  _wizardVideoTimer = setInterval(function() {
    _wizardCurrentVideo = (_wizardCurrentVideo + 1) % WIZARD_VIDEOS.length;
    wizardRenderVideoCard(_wizardCurrentVideo);
    wizardRenderVideoDots();
  }, 30000);
}

function wizardNextVideo() {
  wizardGoToVideo((_wizardCurrentVideo + 1) % WIZARD_VIDEOS.length);
}

// ── Transition: Videos → Gap Walkthrough ──

function wizardTransitionToWalkthrough(job) {
  // Stop video carousel
  clearInterval(_wizardVideoTimer);
  var carousel = document.getElementById('wizardVideoCarousel');
  if (carousel) carousel.style.display = 'none';

  // Update header
  var subtitle = document.getElementById('wizardStep4Subtitle');
  if (subtitle) subtitle.textContent = 'Here\'s what we imported and what you can do next.';

  // Hide legacy report/enrichment (we replace them with the walkthrough)
  var legacyReport = document.getElementById('wizardCollectionReport');
  var legacyEnrich = document.getElementById('wizardEnrichmentOffer');
  if (legacyReport) legacyReport.style.display = 'none';
  if (legacyEnrich) legacyEnrich.style.display = 'none';

  // Show walkthrough
  var walkthrough = document.getElementById('wizardGapWalkthrough');
  if (walkthrough) { walkthrough.style.display = ''; walkthrough.style.animation = 'wizardFadeIn 0.4s ease'; }

  _wizardGapJobId = job.id || (job._id);
  _wizardGapSelections = {};

  var report = job.collectionReport || {};
  var gapRows = report.gapAnalysis || [];
  var gaps = report.gaps || [];

  // Render summary
  wizardRenderGapSummary(job, report);

  // Render interactive gap rows
  wizardRenderGapRows(gapRows, gaps);

  // Load token wallet for cost bar
  loadTokenWallet();

  // Update action buttons — full path continues to step 4, quick path completes.
  var actions = document.getElementById('wizardStep4Actions');
  if (actions) {
    var _depth = window._wizardOnboardingDepth || 'quick';
    var h = '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">';
    if (_depth === 'full') {
      h += '<button class="btn btn-primary" style="font-size:1rem;padding:12px 32px;" onclick="showWizardStep(\'4\')">Continue</button>';
    } else {
      h += '<button class="btn btn-primary" style="font-size:1rem;padding:12px 32px;" onclick="wizardComplete()">Continue to Dashboard</button>';
    }
    h += '</div>';
    h += '<div style="text-align:center;margin-top:8px;">';
    if (_depth === 'full') {
      h += '<a href="#" onclick="event.preventDefault();wizardSkipToLaunch();" style="font-size:0.85rem;color:var(--warm-gray);">Skip remaining setup &rarr;</a>';
    } else {
      h += '<a href="#" onclick="event.preventDefault(); wizardComplete();" style="font-size:0.85rem;color:var(--warm-gray);">Skip for now &mdash; I\'ll do this later</a>';
    }
    h += '</div>';
    actions.innerHTML = h;
    // Re-apply DPA gate state — the new button starts enabled; lock it if DPA not yet checked.
    _wizardDpaGateUpdate(false);
  }
}

function wizardRenderGapSummary(job, report) {
  var el = document.getElementById('wizardGapSummary');
  if (!el) return;
  var s = report.summary || {};
  var imp = job.imported || {};
  var items = [];
  if (imp.products && imp.products.done) items.push(imp.products.done + ' product' + (imp.products.done !== 1 ? 's' : ''));
  if (imp.images && imp.images.done) items.push(imp.images.done + ' image' + (imp.images.done !== 1 ? 's' : ''));
  if (imp.events && imp.events.done) items.push(imp.events.done + ' event' + (imp.events.done !== 1 ? 's' : ''));

  var scoreColor = s.qualityScore >= 80 ? 'var(--teal)' : s.qualityScore >= 60 ? 'var(--amber)' : 'var(--danger)';

  var h = '<div style="display:flex;justify-content:space-between;align-items:center;">';
  h += '<div>';
  h += '<p style="font-weight:700;font-size:1rem;margin-bottom:4px;">&#10003; Import Complete!</p>';
  h += '<p style="font-size:0.9rem;color:var(--warm-gray);">Imported ' + (items.length > 0 ? items.join(', ') : 'your content') + ' from ' + esc(s.platform || 'your site') + '</p>';
  h += '</div>';
  h += '<span style="background:' + scoreColor + ';color:white;padding:4px 10px;border-radius:6px;font-size:0.78rem;font-weight:600;">' + esc(String(s.qualityScore || 0)) + '%</span>';
  h += '</div>';
  el.innerHTML = h;
}

function wizardRenderGapRows(gapRows, gaps) {
  var el = document.getElementById('wizardGapRows');
  if (!el) return;
  if (!gapRows || gapRows.length === 0) {
    el.innerHTML = '<p style="color:var(--warm-gray);font-size:0.9rem;text-align:center;padding:16px;">Everything looks great! No gaps found.</p>';
    return;
  }

  var statusIcons = {
    'complete': '<span style="color:var(--teal);">&#10003;</span>',
    'partial': '<span style="color:var(--amber);">&#9679;</span>',
    'action-needed': '<span style="color:var(--amber);">&#9888;</span>',
    'missing': '<span style="color:var(--danger);">&#10007;</span>',
    'info': '<span style="color:var(--warm-gray);">&#8505;</span>'
  };

  var h = '';
  gapRows.forEach(function(row) {
    var icon = statusIcons[row.status] || statusIcons['info'];
    var gapEntry = null;
    // Map capability to gaps entry for cost data
    var fieldMap = { 'Search Tags': 'tags', 'Descriptions': 'description', 'Options & Variants': 'variants', 'Products': 'category' };
    var mappedField = fieldMap[row.capability];
    if (mappedField) {
      gapEntry = gaps.find(function(g) { return g.field === mappedField; });
    }

    var isPaid = row.plan && row.plan.indexOf('Paid:') === 0 && gapEntry && gapEntry.cost === 'paid';
    var isFree = row.plan && row.plan.indexOf('Free:') === 0;
    var isManual = row.plan && row.plan.indexOf('Manual:') === 0;

    h += '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;background:var(--cream-dark);border-radius:8px;margin-bottom:8px;">';

    // Checkbox or status icon
    if (isPaid) {
      var capKey = row.capability.replace(/[^a-zA-Z]/g, '');
      var tokens = gapEntry ? gapEntry.estimatedTokens : 0;
      var coins = Math.ceil(tokens / 100);
      _wizardGapSelections[capKey] = { selected: false, field: gapEntry.field, tokens: tokens, coins: coins, capability: row.capability };
      h += '<div style="flex-shrink:0;margin-top:2px;">';
      h += '<input type="checkbox" id="wtCheck_' + capKey + '" onchange="wizardToggleGapAction(\'' + capKey + '\')" style="width:18px;height:18px;cursor:pointer;accent-color:var(--teal);">';
      h += '</div>';
    } else {
      h += '<div style="flex-shrink:0;font-size:1rem;margin-top:2px;">' + icon + '</div>';
    }

    // Content
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-size:0.9rem;font-weight:600;margin-bottom:2px;">' + esc(row.capability) + '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(row.detectedLabel);
    if (row.matchedLabel) h += ' &rarr; ' + esc(row.matchedLabel);
    h += '</div>';

    if (row.gap) {
      h += '<div style="font-size:0.85rem;margin-top:4px;color:var(--amber);">' + esc(row.gap) + '</div>';
    }

    // Action area
    if (isPaid) {
      var tokens2 = gapEntry ? gapEntry.estimatedTokens : 0;
      var coins2 = Math.ceil(tokens2 / 100);
      h += '<div style="font-size:0.78rem;margin-top:4px;color:var(--warm-gray-dark,#666);">';
      h += '&#10024; AI enrichment &mdash; ~' + tokens2.toLocaleString() + ' tokens';
      h += '</div>';
    } else if (isManual) {
      var linkTarget = row.actionLink || '';
      var linkLabel = row.plan.replace('Manual: ', '');
      if (linkTarget === 'settings-payments') {
        h += '<div style="margin-top:6px;"><a href="#" onclick="event.preventDefault(); wizardComplete(); setTimeout(function(){ navigateTo(\'settings\'); }, 300);" style="font-size:0.85rem;color:var(--teal);text-decoration:none;">' + esc(linkLabel) + ' &rarr;</a></div>';
      } else if (linkLabel) {
        h += '<div style="margin-top:6px;"><a href="#" onclick="event.preventDefault(); wizardComplete(); setTimeout(function(){ navigateToClassic(\'website\', { tab: \'import\', importOnly: \'1\' }); }, 300);" style="font-size:0.85rem;color:var(--teal);text-decoration:none;">' + esc(linkLabel) + ' &rarr;</a></div>';
      }
    } else if (isFree && row.status !== 'complete') {
      h += '<div style="font-size:0.78rem;margin-top:4px;color:var(--teal);">&#10003; ' + esc(row.plan.replace('Free: ', '')) + '</div>';
    }

    h += '</div></div>';
  });

  el.innerHTML = h;

  // Show cost bar if any paid options exist
  if (Object.keys(_wizardGapSelections).length > 0) {
    wizardUpdateCostBar();
  }
}

function wizardToggleGapAction(capKey) {
  var sel = _wizardGapSelections[capKey];
  if (!sel) return;
  var checkbox = document.getElementById('wtCheck_' + capKey);
  sel.selected = checkbox ? checkbox.checked : !sel.selected;
  wizardUpdateCostBar();
}

function wizardUpdateCostBar() {
  var costBar = document.getElementById('wizardGapCostBar');
  if (!costBar) return;

  // If the wallet listener hasn't fired yet (e.g. permission error on boot),
  // do a one-shot read and re-render once it resolves.
  if (!_tokenWallet) {
    MastDB.tokenWallet.get().then(function(data) {
      if (data) { _tokenWallet = data; wizardUpdateCostBar(); }
    }).catch(function() {});
  }

  var selectedCount = 0;
  var totalTokens = 0;
  var fields = [];
  Object.keys(_wizardGapSelections).forEach(function(key) {
    var sel = _wizardGapSelections[key];
    if (sel.selected) {
      selectedCount++;
      totalTokens += sel.tokens;
      fields.push(sel.field);
    }
  });

  var totalCoins = Math.ceil(totalTokens / 100);
  var wallet = getTokenWallet();
  var availableTokens = (wallet.currentBalance || 0) + (wallet.coinTokenSurplus || 0) + ((wallet.coinBalance || 0) * 100);
  var availableCoins = wallet.coinBalance || 0;
  var sufficient = totalTokens <= availableTokens;

  var h = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
  h += '<div>';
  if (selectedCount > 0) {
    h += '<span style="font-weight:600;">' + selectedCount + ' selected</span>';
    h += ' &mdash; <span style="color:var(--amber);font-weight:600;">~' + totalTokens.toLocaleString() + ' tokens</span>';
    h += '<span style="color:var(--warm-gray);"> (you have ' + availableTokens.toLocaleString() + ' tokens)</span>';
    if (!sufficient) {
      h += '<div style="color:var(--danger);font-size:0.78rem;margin-top:4px;">Insufficient balance. Need ' + totalTokens.toLocaleString() + ' tokens — buy coins to top up.</div>';
    }
  } else {
    h += '<span style="color:var(--warm-gray);">Select items above to enrich with AI</span>';
  }
  h += '</div>';

  if (selectedCount > 0) {
    h += '<button class="btn btn-primary btn-small" id="wizardGapEnrichBtn" onclick="wizardExecuteEnrichment()" title="Uses tokens"';
    if (!sufficient || _wizardGapEnriching) h += ' disabled';
    h += '>';
    h += _wizardGapEnriching ? 'Enriching...' : 'Enrich Selected (~' + totalTokens.toLocaleString() + ' tokens)';
    h += '</button>';
  }

  h += '</div>';
  costBar.innerHTML = h;
  costBar.style.display = '';
}

function wizardExecuteEnrichment() {
  if (_wizardGapEnriching) return;

  var fields = [];
  Object.keys(_wizardGapSelections).forEach(function(key) {
    var sel = _wizardGapSelections[key];
    if (sel.selected && sel.field) fields.push(sel.field);
  });

  if (fields.length === 0) { showToast('Select at least one item to enrich.', true); return; }
  if (!_wizardGapJobId) { showToast('No import job found.', true); return; }

  _wizardGapEnriching = true;
  wizardUpdateCostBar();

  // Show progress feed
  var progressDiv = document.getElementById('wizardGapProgress');
  var progressFeed = document.getElementById('wizardGapProgressFeed');
  if (progressDiv) progressDiv.style.display = '';
  if (progressFeed) progressFeed.innerHTML = wizardFeedLine('progress', 'Starting AI enrichment for ' + fields.join(', ') + '...');

  // Listen for progress events
  if (_wizardGapProgressListener) {
    _wizardGapProgressListener();
    _wizardGapProgressListener = null;
  }
  _wizardGapProgressListener = MastDB.subscribeChild('webPresence/importJobs/' + _wizardGapJobId + '/progressFeed', 'child_added', function(evt) {
    if (!evt || !evt.message) return;
    if (progressFeed) {
      progressFeed.innerHTML += wizardFeedLine('progress', evt.message);
      progressFeed.scrollTop = progressFeed.scrollHeight;
    }
  });

  // Call enrichment
  firebase.functions().httpsCallable('runEnrichment')({
    tenantId: MastDB.tenantId(),
    importJobId: _wizardGapJobId,
    fields: fields
  }).then(function(result) {
    var data = result.data || {};
    _wizardGapEnriching = false;

    // Detach progress listener
    if (_wizardGapProgressListener) {
      _wizardGapProgressListener();
      _wizardGapProgressListener = null;
    }

    // Show success
    if (progressFeed) {
      progressFeed.innerHTML += wizardFeedLine('done', 'Enriched ' + data.enriched + ' products! ' + data.claudeCalls + ' AI calls, ' + (data.tokensUsed || 0) + ' tokens used.');
    }
    showToast(data.enriched + ' products enriched!');

    // Update wallet display
    if (data.newTokenBalance !== undefined && _tokenWallet) {
      _tokenWallet.currentBalance = data.newTokenBalance;
      if (data.coinBalance !== undefined) _tokenWallet.coinBalance = data.coinBalance;
    }

    // Re-fetch updated collection report and re-render gap rows
    MastDB.get('webPresence/importJobs/' + _wizardGapJobId + '/collectionReport').then(function(report) {
      if (report && report.gapAnalysis) {
        _wizardGapSelections = {};
        wizardRenderGapRows(report.gapAnalysis, report.gaps || []);
      }
    }).catch(function() {});

    // Update cost bar to reflect completion
    wizardUpdateCostBar();

  }).catch(function(err) {
    _wizardGapEnriching = false;
    showToast('Enrichment failed: ' + esc(err.message), true);
    if (progressFeed) {
      progressFeed.innerHTML += wizardFeedLine('error', 'Failed: ' + esc(err.message));
    }
    wizardUpdateCostBar();
  });
}

function renderWizardSummary() {
  var el = document.getElementById('wizardSummary');
  if (!el) return;
  var items = [];
  var aa = _wizardAutoApplied || {};
  if (aa.brand) {
    var brandName = (_wizardSiteAnalysis && _wizardSiteAnalysis.businessName) || '';
    items.push('<div style="margin-bottom:6px;"><span style="color:var(--teal);">&#10003;</span> <strong>Brand applied</strong>' + (brandName ? ' &mdash; ' + esc(brandName) : '') + '</div>');
  }
  if (aa.template) {
    items.push('<div style="margin-bottom:6px;"><span style="color:var(--teal);">&#10003;</span> <strong>Template:</strong> ' + esc(aa.template) + '</div>');
  }
  if (aa.nav) {
    items.push('<div style="margin-bottom:6px;"><span style="color:var(--teal);">&#10003;</span> <strong>Navigation configured</strong></div>');
  }
  if (!aa.brand && !aa.template) {
    items.push('<div style="margin-bottom:6px;">No website analyzed &mdash; set up your brand in Settings.</div>');
  }
  // Show context-appropriate next step based on import state
  var importRunning = document.getElementById('wizardImportTimeline') && document.getElementById('wizardImportTimeline').style.display !== 'none';
  var gapVisible = document.getElementById('wizardGapWalkthrough') && document.getElementById('wizardGapWalkthrough').style.display !== 'none';
  if (gapVisible) {
    items.push('<div style="margin-top:8px;color:var(--warm-gray);font-size:0.85rem;"><strong>Next steps:</strong> Review your import results below.</div>');
  } else if (importRunning) {
    items.push('<div style="margin-top:8px;color:var(--warm-gray);font-size:0.85rem;"><strong>Importing:</strong> Loading your products, images, and events...</div>');
  } else {
    items.push('<div style="margin-top:8px;color:var(--warm-gray);font-size:0.85rem;"><strong>Next steps:</strong> Connect payments and email in Settings.</div>');
  }
  el.innerHTML = items.join('');
}

function renderCapabilityPreview() {
  var el = document.getElementById('wizardCapabilityPreview');
  if (!el) return;
  var matrix = window._wizardCapabilityMatrix;
  if (!matrix || !matrix.capabilities) { el.style.display = 'none'; return; }

  var caps = matrix.capabilities;
  var capIds = Object.keys(caps).filter(function(k) { return k.charAt(0) !== '_'; });
  // Sort by priority
  capIds.sort(function(a, b) { return (caps[a].priority || 99) - (caps[b].priority || 99); });

  // Icon map (feather-style → emoji fallback for no-build env)
  var icons = { 'shopping-bag': '\ud83d\udecd\ufe0f', 'edit': '\u270d\ufe0f', 'calendar': '\ud83d\udcc5', 'link': '\ud83d\udd17', 'layers': '\ud83c\udf9b\ufe0f', 'folder': '\ud83d\udcc2', 'tag': '\ud83c\udff7\ufe0f', 'image': '\ud83d\uddbc\ufe0f', 'file-text': '\ud83d\udcdd', 'hash': '#\ufe0f\u20e3', 'dollar-sign': '\ud83d\udcb2' };

  var html = '<div style="margin-bottom:8px;"><strong>What we can import from ' + esc(matrix.platformName || 'your site') + '</strong></div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';

  var freeCount = 0;
  var paidCount = 0;

  for (var i = 0; i < capIds.length; i++) {
    var capId = capIds[i];
    var cap = caps[capId];
    if (!cap.supported) continue;

    var method = (cap.methods && cap.methods[0]) || {};
    // Check for runtime override (probe found free method on a paid-default platform)
    var override = cap._runtimeOverride;
    var isFree = override ? override.cost === 'free' : method.cost === 'free';
    var icon = icons[cap.icon] || '\u2022';

    if (isFree) freeCount++; else paidCount++;

    var bgColor = isFree ? 'rgba(42,124,111,0.08)' : 'rgba(196,133,60,0.08)';
    var borderColor = isFree ? 'rgba(42,124,111,0.2)' : 'rgba(196,133,60,0.2)';
    var badge = isFree
      ? '<span style="font-size:0.72rem;color:var(--teal);font-weight:600;">INCLUDED</span>'
      : '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;">AI</span>';

    // Confidence indicator from import stats
    var confidence = '';
    if (cap.stats && cap.stats.successRate > 80 && cap.stats.totalAttempts >= 2) {
      confidence = '<span style="font-size:0.72rem;color:var(--warm-gray);margin-left:2px;" title="Based on ' + cap.stats.totalAttempts + ' imports">' + cap.stats.successRate + '%</span>';
    }

    html += '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:6px;padding:6px 10px;display:flex;align-items:center;gap:6px;font-size:0.85rem;">';
    html += '<span>' + icon + '</span>';
    html += '<span>' + esc(cap.label) + '</span>';
    html += badge;
    html += confidence;
    html += '</div>';
  }
  html += '</div>';

  // Summary line
  html += '<div style="font-size:0.78rem;color:var(--warm-gray);">';
  if (freeCount > 0) html += '<span style="color:var(--teal);font-weight:600;">' + freeCount + ' included free</span>';
  if (freeCount > 0 && paidCount > 0) html += ' &middot; ';
  if (paidCount > 0) html += '<span style="color:var(--amber);">' + paidCount + ' available with AI enrichment</span>';
  html += '</div>';

  el.innerHTML = html;
  el.style.display = '';
}

// WS6: Style recommendation → template + color scheme mapping
var STYLE_TO_TEMPLATE = {
  'artisan-warm':    { templateId: 'the-studio', schemeId: 'amber-teal', fontPair: 'classic' },
  'studio-dark':     { templateId: 'the-studio', schemeId: 'slate-rose', fontPair: 'editorial' },
  'story-first':     { templateId: 'the-studio', schemeId: null, fontPair: 'artisan' },
  'clean-commerce':  { templateId: 'the-shop',   schemeId: 'clean-white', fontPair: 'clean' },
  'market-fresh':    { templateId: 'the-shop',   schemeId: 'moss-clay', fontPair: 'modern' },
  'minimal-pro':     { templateId: 'the-shop',   schemeId: 'warm-sand', fontPair: 'geometric' }
};

/**
 * Client-side white-background detection and removal for logos.
 * Uses Canvas 2D API with iterative flood-fill from corners.
 * Returns a Blob (PNG) if white bg detected, or null if no processing needed.
 */
function processLogoWhiteBackground(imageUrl) {
  return new Promise(function(resolve) {
    if (!imageUrl || !imageUrl.startsWith('http')) { resolve(null); return; }
    // Skip SVGs
    if (/\.svg(\?|$)/i.test(imageUrl)) { resolve(null); return; }

    // Hard timeout: if the source server is slow, returns CORS-blocked content,
    // or stalls the connection without responding, neither onload nor onerror
    // fires and the Promise hangs forever — which freezes the wizard's
    // "Applying your brand..." step (observed 2026-05-13 on prodtest15 +
    // prodtest16, both pointed at shirglassworks.com whose logo endpoint
    // returns 403 to server fetches and CORS-stalls in the browser).
    var settled = false;
    function done(value) { if (settled) return; settled = true; resolve(value); }
    setTimeout(function() { done(null); }, 15000);

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var data = imageData.data;
      var w = canvas.width, h = canvas.height;
      var NEAR_WHITE = 240;

      // Sample 8 points: 4 corners + 4 edge midpoints
      var samples = [
        [0, 0], [w-1, 0], [0, h-1], [w-1, h-1],
        [Math.floor(w/2), 0], [Math.floor(w/2), h-1],
        [0, Math.floor(h/2)], [w-1, Math.floor(h/2)]
      ];
      var whiteCount = 0;
      for (var s = 0; s < samples.length; s++) {
        var idx = (samples[s][1] * w + samples[s][0]) * 4;
        if (data[idx] > NEAR_WHITE && data[idx+1] > NEAR_WHITE && data[idx+2] > NEAR_WHITE && data[idx+3] > 200) {
          whiteCount++;
        }
      }
      if (whiteCount < 6) { done(null); return; }

      // Iterative flood-fill from corners
      var visited = new Uint8Array(w * h);
      var DIST_THRESHOLD = 30;

      function floodFill(sx, sy) {
        var si = (sy * w + sx) * 4;
        if (data[si] <= NEAR_WHITE || data[si+1] <= NEAR_WHITE || data[si+2] <= NEAR_WHITE || data[si+3] <= 200) return;
        var key = sy * w + sx;
        if (visited[key]) return;
        visited[key] = 1;
        var queue = [[sx, sy]];
        while (queue.length > 0) {
          var pt = queue.shift();
          var cx = pt[0], cy = pt[1];
          var ci = (cy * w + cx) * 4;
          var cr = data[ci], cg = data[ci+1], cb = data[ci+2];
          var neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
          for (var n = 0; n < neighbors.length; n++) {
            var nx = neighbors[n][0], ny = neighbors[n][1];
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            var nk = ny * w + nx;
            if (visited[nk]) continue;
            var ni = nk * 4;
            if (data[ni+3] < 10) { visited[nk] = 1; continue; }
            var dr = cr - data[ni], dg = cg - data[ni+1], db = cb - data[ni+2];
            if (Math.sqrt(dr*dr + dg*dg + db*db) < DIST_THRESHOLD) {
              visited[nk] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }

      // Flood-fill from all near-white edge pixels (catches white between logo elements)
      for (var ex = 0; ex < w; ex++) { floodFill(ex, 0); floodFill(ex, h-1); }
      for (var ey = 1; ey < h-1; ey++) { floodFill(0, ey); floodFill(w-1, ey); }

      // Zero out alpha for background pixels
      var removed = 0;
      for (var i = 0; i < w * h; i++) {
        if (visited[i]) { data[i*4+3] = 0; removed++; }
      }
      if (removed === 0) { done(null); return; }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob(function(blob) { done(blob); }, 'image/png');
    };
    img.onerror = function() { done(null); };
    img.src = imageUrl;
  });
}

/**
 * Process logo and upload to Firebase Storage if white background detected.
 * Returns the new URL or the original if no processing needed.
 */
async function processAndUploadLogo(logoUrl) {
  try {
    var blob = await processLogoWhiteBackground(logoUrl);
    if (!blob) return logoUrl; // No white bg detected

    // Upload processed PNG to Firebase Storage
    var tenantId = MastDB.tenantId();
    var storageBucket = window.TENANT_FIREBASE_CONFIG && window.TENANT_FIREBASE_CONFIG.storageBucket;
    if (!storageBucket) {
      console.warn('[processLogo] No storage bucket configured, using original logo');
      return logoUrl;
    }
    var storageRef = firebase.storage().ref(tenantId + '/brand/logo-processed.png');
    await storageRef.put(blob, { contentType: 'image/png' });
    var processedUrl = await storageRef.getDownloadURL();
    console.log('[processLogo] Uploaded processed logo:', processedUrl);
    return processedUrl;
  } catch (err) {
    console.warn('[processLogo] Client-side processing failed, using original:', err.message || err);
    return logoUrl;
  }
}

// Update DPA gate visual state and enable/disable the adjacent launch button.
// isFast=true targets the fastDpa step elements; false targets step 3 watch pane.
function _wizardDpaGateUpdate(isFast) {
  var cbId    = isFast ? 'wizardDpaCheckboxFast' : 'wizardDpaCheckbox';
  var gateId  = isFast ? 'wizardDpaGateFast'    : 'wizardDpaGate';
  var actId   = isFast ? 'wizardActivateErrorsFast' : 'wizardActivateErrors';
  var cb      = document.getElementById(cbId);
  var gate    = document.getElementById(gateId);
  var checked = cb && cb.checked;
  if (gate) {
    gate.style.borderColor  = checked ? 'var(--teal)' : 'var(--amber,#c4853c)';
    gate.style.background   = checked ? 'rgba(42,124,111,0.06)' : 'rgba(196,133,60,0.06)';
  }
  // Find the launch button in the sibling actions container and toggle disabled
  var actionsId = isFast ? 'wizardStep4Actions' : 'wizardStep4Actions';
  // For fast path, the button is directly in wizardStepFastDpa; use a data attribute to find it
  var launchBtn = isFast
    ? document.querySelector('#wizardStepFastDpa .btn-primary:not([data-skip])')
    : document.querySelector('#wizardStep4Actions .btn-primary, #wizardStep4Actions button.btn-primary');
  if (launchBtn) launchBtn.disabled = !checked;
  // Clear inline error if box is now checked
  if (checked) {
    var errEl = document.getElementById(actId);
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }
}

// B4: render DPA label + role/team-size radios + Notice at Collection.
// Idempotent — safe to call repeatedly as the user re-enters Step 3 watch pane.
function renderWizardActivationGate() {
  var BEC = window.BusinessEntityConstants || {};
  var dpaCopy = BEC.DPA_COPY || {};
  var noc = BEC.NOTICE_AT_COLLECTION_COPY || {};
  var privacyUrl = BEC.PRIVACY_POLICY_URL || '/privacy';

  var labelEl = document.getElementById('wizardDpaLabel');
  if (labelEl) {
    // Construct DPA label with anchor + required marker. innerHTML is safe here —
    // source strings live in the constants file under counsel-approval lock.
    labelEl.innerHTML =
      esc(dpaCopy.checkbox || '') + ' ' +
      '<a href="' + esc(dpaCopy.linkUrl || '/dpa') + '" target="_blank" rel="noopener">' +
      esc(dpaCopy.linkText || 'Data Processing Addendum') + '</a> ' +
      '<span style="color:var(--danger);font-weight:600;">' + esc(dpaCopy.requiredLabel || '(Required.)') + '</span>';
  }
  // Wire checkbox → gate highlight + button enable/disable
  var dpaGateEl = document.getElementById('wizardDpaGate');
  var dpaCheckEl = document.getElementById('wizardDpaCheckbox');
  if (dpaCheckEl && !dpaCheckEl._dpaGateWired) {
    dpaCheckEl._dpaGateWired = true;
    dpaCheckEl.onchange = function() { _wizardDpaGateUpdate(false); };
  }
  _wizardDpaGateUpdate(false);
  var nocEl = document.getElementById('wizardNoticeAtCollection');
  if (nocEl) {
    nocEl.innerHTML =
      esc(noc.body || '') + ' ' +
      '<a href="' + esc(privacyUrl) + '" target="_blank" rel="noopener">' + esc(noc.privacyLinkText || 'Privacy Policy') + '</a> · ' +
      '<a href="' + esc((dpaCopy.linkUrl || '/dpa')) + '" target="_blank" rel="noopener">' + esc(noc.dpaLinkText || 'Data Processing Addendum') + '</a>';
  }

  var state = window._wizardPeopleSelection = window._wizardPeopleSelection || {};
  var rolesEl = document.getElementById('wizardRoleOptions');
  if (rolesEl && rolesEl.childNodes.length === 0) {
    var roles = BEC.PRIMARY_CONTACT_ROLES || [];
    for (var i = 0; i < roles.length; i++) {
      (function(role) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = role.label;
        btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:1px solid var(--wiz-border,#ccc);background:var(--wiz-bg,#fff);color:var(--wiz-text,inherit);font-size:0.78rem;cursor:pointer;';
        btn.onclick = function() {
          state.role = role.value;
          // repaint
          Array.prototype.forEach.call(rolesEl.children, function(c) {
            var sel = state.role === c.dataset.value;
            c.style.borderColor = sel ? 'var(--teal)' : 'var(--wiz-border,#ccc)';
            c.style.background = sel ? 'var(--teal)' : 'var(--wiz-bg,#fff)';
            c.style.color = sel ? '#fff' : 'var(--wiz-text,inherit)';
          });
        };
        btn.dataset.value = role.value;
        rolesEl.appendChild(btn);
      })(roles[i]);
    }
  }
  var sizeEl = document.getElementById('wizardTeamSizeOptions');
  if (sizeEl && sizeEl.childNodes.length === 0) {
    var bands = BEC.TEAM_SIZE_BANDS || [];
    for (var j = 0; j < bands.length; j++) {
      (function(band) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = band.label;
        btn.style.cssText = 'padding:6px 10px;border-radius:999px;border:1px solid var(--wiz-border,#ccc);background:var(--wiz-bg,#fff);color:var(--wiz-text,inherit);font-size:0.78rem;cursor:pointer;';
        btn.onclick = function() {
          state.teamSize = band.value;
          state.hasEmployees = band.value !== 'solo';
          Array.prototype.forEach.call(sizeEl.children, function(c) {
            var sel = state.teamSize === c.dataset.value;
            c.style.borderColor = sel ? 'var(--teal)' : 'var(--wiz-border,#ccc)';
            c.style.background = sel ? 'var(--teal)' : 'var(--wiz-bg,#fff)';
            c.style.color = sel ? '#fff' : 'var(--wiz-text,inherit)';
          });
        };
        btn.dataset.value = band.value;
        sizeEl.appendChild(btn);
      })(bands[j]);
    }
  }
}

async function wizardComplete() {
  var BEC = window.BusinessEntityConstants || {};
  var dpaCopy = BEC.DPA_COPY || {};
  renderWizardActivationGate();

  var errorsEl = document.getElementById('wizardActivateErrors');
  if (errorsEl) { errorsEl.style.display = 'none'; errorsEl.textContent = ''; }

  // Gate 1: DPA checkbox must be ticked (regulatory non-negotiable #14).
  var dpaCheckbox = document.getElementById('wizardDpaCheckbox');
  if (!dpaCheckbox || !dpaCheckbox.checked) {
    if (errorsEl) {
      errorsEl.style.display = '';
      errorsEl.textContent = dpaCopy.missingError || 'You must accept the Data Processing Addendum to continue.';
    }
    showToast(dpaCopy.missingError || 'You must accept the DPA to continue.', true);
    return;
  }

  // Capture primary-contact details from Firebase Auth + optional selections.
  try {
    var user = firebase.auth().currentUser;
    var displayName = (user && user.displayName) || '';
    var email = (user && user.email) || '';
    var sel = window._wizardPeopleSelection || {};
    var peoplePayload = {
      primaryContact: {
        name: displayName,
        email: email,
        dpaAcceptedAt: new Date().toISOString(),
        dpaVersion: BEC.DPA_VERSION || '2026-05-v1'
      }
    };
    if (sel.role) peoplePayload.primaryContact.role = sel.role;
    if (sel.teamSize) peoplePayload.teamSize = sel.teamSize;
    if (typeof sel.hasEmployees === 'boolean') peoplePayload.hasEmployees = sel.hasEmployees;
    if (typeof sel.hasContractors === 'boolean') peoplePayload.hasContractors = sel.hasContractors;

    await MastDB.businessEntity.update('people', peoplePayload);

    // Spec §3 activation is now NON-BLOCKING. Backfill safe defaults for any
    // skipped field, then force-activate so the user always reaches the
    // dashboard; residual blanks become flagged to-dos on the dashboard setup
    // checklist instead of a launch wall.
    await wizardBackfillRequiredDefaults();
    try {
      var actRes = await MastDB.businessEntity.activate({ force: true });
      await _wizardRecordLaunchGaps((actRes && actRes.missingFields) || []);
      logWizardEvent(5, 'wizard_activated', { missingFields: (actRes && actRes.missingFields) || [], blocked: false });
    } catch (activateErr) {
      console.warn('[Wizard] force-activate failed, proceeding to dashboard anyway:', activateErr && activateErr.message);
      logWizardEvent(5, 'activate_error_nonblocking', { message: (activateErr && activateErr.message) || 'unknown' });
    }

    // engagement.mode no longer drives a deploy POST (triggerTenantDeploy
    // was removed 2026-05-10 — Cloudflare-wildcard hosting). Mode is still
    // logged below for wizard analytics.
    var engagementView = await MastDB.businessEntity.get('engagement');
    var engagement = (engagementView && engagementView.data) || {};
    var engagementMode = engagement.mode || 'storefront';

    // Mast Modes (Idea -OtADygKA_JhRmk1wUqN): derive and persist the tenant's
    // modeSet from existing wizard fields. Visibility defaults only — not an
    // entitlement gate. M2 (sidebar mode-filter) will read this. Non-blocking:
    // if derivation/write fails, the existing engagement-surface filter still
    // applies and the wizard completes normally.
    try {
      var fullEntity = await MastDB.businessEntity.get();
      var BEC_modes = window.BusinessEntityConstants;
      if (BEC_modes && typeof BEC_modes.deriveModeSet === 'function') {
        var derivedModeSet = BEC_modes.deriveModeSet(fullEntity || {}, { derivedFrom: 'wizard' });
        await MastDB.businessEntity.update('modeSet', derivedModeSet);
        logWizardEvent(5, 'modeSet_derived', {
          modes: derivedModeSet.modes,
          overlays: derivedModeSet.overlays,
          cohortFlag: derivedModeSet.cohortFlag,
          modeVersion: derivedModeSet.modeVersion
        });
      }
    } catch (modeErr) {
      console.warn('[Wizard] Failed to derive/persist modeSet:', modeErr && modeErr.message);
    }

    // Legacy registry bookkeeping retained for backward compat with non-entity consumers.
    await _wizardActivateTenant();
    await MastDB.config.set('setupProgress/completed', true);
    await MastDB.config.set('setupProgress/completedAt', new Date().toISOString());
    await updateConfigChecklist('brand', true);

    // Revenue-based pricing (Checkpoint 4a): stamp the subscription model and
    // clear any legacy tier fields so the subscription tab routes to the
    // revenue meter unconditionally after cutover. Resilient stamp (update→set,
    // surfaces failures) so a denial can't silently leave the tenant gated.
    await stampRevenueSubscriptionModel();

    // Legacy planStatus guard: per v1 risk #3, only promote 'none' → 'draft'; never
    // touch an 'active' plan from the wizard.
    try {
      var planStatus = await MastDB.get('admin/businessPlan/planStatus');
      if (!planStatus || planStatus === 'none') {
        await MastDB.set('admin/businessPlan/planStatus', 'draft');
      }
    } catch (planErr) { /* best-effort */ }

    logWizardEvent(5, 'wizard_complete', {
      entityStatus: 'active',
      engagementMode: engagementMode,
      dpaVersion: BEC.DPA_VERSION || '2026-05-v1'
    });
    showToast('Setup complete! Welcome to your dashboard.');

    await loadTenantSubscription();
    document.getElementById('setupWizardScreen').style.display = 'none';
    document.getElementById('header').style.display = 'flex';
    showSidebar();

    productsLoaded = false;
    productsData = [];

    navigateTo('dashboard');

    Promise.all([loadNextStepsCache(), loadDismissedSteps(), loadMatchingPrefs()]).then(function() { renderDashCardSetupShop(); });
    attachListeners();
    loadSettings();
  } catch (err) {
    if (errorsEl) {
      errorsEl.style.display = '';
      errorsEl.textContent = 'Error completing setup: ' + (err.message || 'unknown');
    }
    showToast('Error completing setup: ' + esc(err.message || ''), true);
  }
}


  // Re-export every wizard function on window — the static #setupWizardScreen
  // markup + the wizard's generated-HTML onclick handlers call these (they only
  // fire after the wizard is open = this module loaded).
  window._applyBrandPointer = _applyBrandPointer;
  window._applyEntityIdentity = _applyEntityIdentity;
  window._applyEntityOperationsLocalization = _applyEntityOperationsLocalization;
  window._applyEntityPresence = _applyEntityPresence;
  window._applyPlatformRegistry = _applyPlatformRegistry;
  window._detectModulesFromManifest = _detectModulesFromManifest;
  window._registerChannelSuggestionCards = _registerChannelSuggestionCards;
  window._renderEngagementLetterRow = _renderEngagementLetterRow;
  window._wizardActivateTenant = _wizardActivateTenant;
  window._wizardApplyProgress = _wizardApplyProgress;
  window._wizardCollapseSettingsSection = _wizardCollapseSettingsSection;
  window._wizardConnectTool = _wizardConnectTool;
  window._wizardDetectShopifyOrigin = _wizardDetectShopifyOrigin;
  window._wizardDpaGateUpdate = _wizardDpaGateUpdate;
  window._wizardExtractAnalysisFields = _wizardExtractAnalysisFields;
  window._wizardGetStepOrder = _wizardGetStepOrder;
  window._wizardHydrateSignupName = _wizardHydrateSignupName;
  window._wizardLsKey = _wizardLsKey;
  window._wizardLsLoad = _wizardLsLoad;
  window._wizardLsSave = _wizardLsSave;
  window._wizardModulePreselect = _wizardModulePreselect;
  window._wizardRecordLaunchGaps = _wizardRecordLaunchGaps;
  window._wizardRenderMissingFields = _wizardRenderMissingFields;
  window._wizardSettingsSection = _wizardSettingsSection;
  window._wizardSkipTool = _wizardSkipTool;
  window._wizardToggleModule = _wizardToggleModule;
  window._wizardToggleSettingsSection = _wizardToggleSettingsSection;
  window.applyStorefrontConfig = applyStorefrontConfig;
  window.hideWizardCredentialEntry = hideWizardCredentialEntry;
  window.initSetupWizard = initSetupWizard;
  window.logWizardEvent = logWizardEvent;
  window.processAndUploadLogo = processAndUploadLogo;
  window.processLogoWhiteBackground = processLogoWhiteBackground;
  window.renderCapabilityPreview = renderCapabilityPreview;
  window.renderWizardActivationGate = renderWizardActivationGate;
  window.renderWizardBizIdentity = renderWizardBizIdentity;
  window.renderWizardCalibration = renderWizardCalibration;
  window.renderWizardEngagement = renderWizardEngagement;
  window.renderWizardFastSummary = renderWizardFastSummary;
  window.renderWizardFeaturePages = renderWizardFeaturePages;
  window.renderWizardFork = renderWizardFork;
  window.renderWizardIntegrations = renderWizardIntegrations;
  window.renderWizardMatchQ = renderWizardMatchQ;
  window.renderWizardModuleSelector = renderWizardModuleSelector;
  window.renderWizardSettingsSpotlight = renderWizardSettingsSpotlight;
  window.renderWizardSummary = renderWizardSummary;
  window.saveWizardProgress = saveWizardProgress;
  window.showWizardCredentialEntry = showWizardCredentialEntry;
  window.showWizardImportTimeline = showWizardImportTimeline;
  window.showWizardStep = showWizardStep;
  window.showWizardSubStep = showWizardSubStep;
  window.snapshotWizardField = snapshotWizardField;
  window.toggleFeaturePage = toggleFeaturePage;
  window.updateWizardProgress = updateWizardProgress;
  window.wizardAnalyzeSite = wizardAnalyzeSite;
  window.wizardAnalyzeSiteStep8 = wizardAnalyzeSiteStep8;
  window.wizardAutoApplyAll = wizardAutoApplyAll;
  window.wizardBackfillRequiredDefaults = wizardBackfillRequiredDefaults;
  window.wizardBizNext1A = wizardBizNext1A;
  window.wizardBizNext1B = wizardBizNext1B;
  window.wizardBizNext1C = wizardBizNext1C;
  window.wizardChooseSiteIntent = wizardChooseSiteIntent;
  window.wizardClearLogo = wizardClearLogo;
  window.wizardComplete = wizardComplete;
  window.wizardCompleteFast = wizardCompleteFast;
  window.wizardConfirmBizIdentity = wizardConfirmBizIdentity;
  window.wizardConfirmBrand = wizardConfirmBrand;
  window.wizardConfirmCalibration = wizardConfirmCalibration;
  window.wizardConfirmDepth = wizardConfirmDepth;
  window.wizardConfirmEngagement = wizardConfirmEngagement;
  window.wizardConfirmFeaturePages = wizardConfirmFeaturePages;
  window.wizardConfirmMatchQ = wizardConfirmMatchQ;
  window.wizardConfirmModuleSelector = wizardConfirmModuleSelector;
  window.wizardConfirmModules = wizardConfirmModules;
  window.wizardConfirmSettings = wizardConfirmSettings;
  window.wizardCreateImportJob = wizardCreateImportJob;
  window.wizardExecuteEnrichment = wizardExecuteEnrichment;
  window.wizardFastDpaBack = wizardFastDpaBack;
  window.wizardFastExit = wizardFastExit;
  window.wizardFeedLine = wizardFeedLine;
  window.wizardForkBack = wizardForkBack;
  window.wizardForkContinue = wizardForkContinue;
  window.wizardForkDashboard = wizardForkDashboard;
  window.wizardGoToVideo = wizardGoToVideo;
  window.wizardNext = wizardNext;
  window.wizardNextVideo = wizardNextVideo;
  window.wizardPrev = wizardPrev;
  window.wizardPreviewLogo = wizardPreviewLogo;
  window.wizardRenderCollectionReport = wizardRenderCollectionReport;
  window.wizardRenderGapRows = wizardRenderGapRows;
  window.wizardRenderGapSummary = wizardRenderGapSummary;
  window.wizardRenderImportFinalState = wizardRenderImportFinalState;
  window.wizardRenderModuleCards = wizardRenderModuleCards;
  window.wizardRenderVideoCard = wizardRenderVideoCard;
  window.wizardRenderVideoDots = wizardRenderVideoDots;
  window.wizardRequestEnrichment = wizardRequestEnrichment;
  window.wizardResetSiteStep = wizardResetSiteStep;
  window.wizardSelectDepth = wizardSelectDepth;
  window.wizardSetLaunchEnabled = wizardSetLaunchEnabled;
  window.wizardShowEnrichmentOffer = wizardShowEnrichmentOffer;
  window.wizardShowSitePathPicker = wizardShowSitePathPicker;
  window.wizardShowVideoCarousel = wizardShowVideoCarousel;
  window.wizardSkipCalibration = wizardSkipCalibration;
  window.wizardSkipSite = wizardSkipSite;
  window.wizardSkipToLaunch = wizardSkipToLaunch;
  window.wizardStep4Back = wizardStep4Back;
  window.wizardStep5Back = wizardStep5Back;
  window.wizardStep7Back = wizardStep7Back;
  window.wizardStep7Continue = wizardStep7Continue;
  window.wizardToggleGapAction = wizardToggleGapAction;
  window.wizardToggleModule = wizardToggleModule;
  window.wizardTransitionToWalkthrough = wizardTransitionToWalkthrough;
  window.wizardUpdateCostBar = wizardUpdateCostBar;
  window.wizardUpdateModuleBtn = wizardUpdateModuleBtn;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('setupWizard', {});
  }
})();
