(function() {
  'use strict';

  // ============================================================================
  // AI catalog-import wizard — relocated VERBATIM out of website.js (T6 website
  // rip-and-replace, PR2). website-v2 has full builder parity EXCEPT this import
  // pipeline; rather than force it onto MastEntity (a list/record engine that does
  // not fit an async multi-step job flow), it lives here as a dedicated lazy
  // module with its own route ('website-import'). The wizard's bodies are
  // byte-identical to website.js — the only adaptations are the render-entry name
  // (renderWebsite -> renderImportPage) and a REAL listener detach (the V1
  // startImportJobsListener leaked across nav because stopImportJobsListener was
  // never called). Backend Cloud Functions (analyzeExistingSite / runEnrichment /
  // the server-side processImportJob) are unchanged and stay in mast-architecture.
  //
  // Cross-module write helpers it calls (window.markUnpublished) are sourced from
  // the lazy website-core.js (PR1 keystone) — loaded in this route's setup().
  // ============================================================================

  // ── State (import-only subset of website.js) ──
  var websiteLoaded = false;
  var websiteConfig = null;
  var themeConfig = null; // public/config/theme — refreshed after draft-template save
  var importJobs = null;
  var importedProducts = null;
  var draftTemplates = null; // draft templates generated from import analysis
  var importReviewTab = 'products';
  var importJobsListener = null;
  var cherryPickSelections = {}; // jobId -> { products: {url: bool}, images: {url: bool}, ... }
  var expandedJobId = null; // for import history detail view
  // NOTE: selectedProductIds is declared inside the render block below (verbatim
  // from website.js:1733) — do not redeclare it here.


  // ── Shared URL normalizer (verbatim) ──
  function normalizeInputUrl(raw) {
    var url = raw.trim();
    if (!url) return '';
    // Strip leading/trailing quotes or angle brackets
    url = url.replace(/^["'<]+|["'>]+$/g, '');
    // Fix semicolons instead of colons (https;// → https://)
    url = url.replace(/^(https?);\/\//i, '$1://');
    // Fix single slash (https:/ → https://)
    url = url.replace(/^(https?):\/([^/])/i, '$1://$2');
    // Fix missing slashes (https:example.com → https://example.com)
    url = url.replace(/^(https?):(?!\/\/)/i, '$1://');
    // Fix http;// or htp:// or htps:// common typos
    url = url.replace(/^htp:\/\//i, 'http://');
    url = url.replace(/^htps:\/\//i, 'https://');
    // Remove accidental spaces
    url = url.replace(/\s+/g, '');
    // Fix commas used as dots
    url = url.replace(/,/g, '.');
    // Fix double dots
    url = url.replace(/\.{2,}/g, '.');
    // Prepend https:// if no protocol
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    // Validate structure
    try { new URL(url); } catch (e) { return ''; }
    // Must have at least one dot in the hostname (reject bare words like "asdfgh")
    try { var host = new URL(url).hostname; if (host.indexOf('.') === -1) return ''; } catch (e) { return ''; }
    return url;
  }

  // ── HTML escape (verbatim) ──
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Fallback style defs (verbatim — wpSelectStyle dependency) ──
  var STYLE_DEFS = [
    { id: 'artisan-warm', name: 'Artisan Warm', icon: '&#127798;', desc: 'Earthy tones, handcrafted feel', font: 'playfair-lato' },
    { id: 'studio-dark', name: 'Studio Dark', icon: '&#127769;', desc: 'Bold contrast, modern gallery', font: 'inter-inter' },
    { id: 'market-fresh', name: 'Market Fresh', icon: '&#127793;', desc: 'Bright, colorful, energetic', font: 'poppins-roboto' },
    { id: 'clean-commerce', name: 'Clean Commerce', icon: '&#128722;', desc: 'Minimal, product-focused', font: 'raleway-opensans' },
    { id: 'story-first', name: 'Story First', icon: '&#128214;', desc: 'Editorial, narrative flow', font: 'merriweather-sourcesans' },
    { id: 'minimal-pro', name: 'Minimal Pro', icon: '&#9679;', desc: 'Ultra-clean, monochrome', font: 'cormorant-montserrat' }
  ];

  // ── Loaders (verbatim) ──
  async function loadWebsiteConfig() {
    try {
      websiteConfig = (await MastDB.get('webPresence/config')) || {};
      // Also load last analyzed URL
      websiteConfig._lastAnalyzedUrl = (await MastDB.get('webPresence/siteAnalysis/url')) || '';
    } catch (err) {
      console.warn('[Website] Failed to load config:', err.message);
      websiteConfig = {};
    }
  }

  async function loadImportJobs() {
    try {
      var snap = await MastDB.query('webPresence/importJobs').orderByChild('createdAt').limitToLast(10).once('value');
      var raw = snap.val() || {};
      importJobs = Object.values(raw).sort(function(a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
    } catch (err) {
      console.warn('[Website] Failed to load import jobs:', err.message);
      importJobs = [];
    }
  }

  async function loadImportedProducts() {
    try {
      var raw = (await MastDB.get('public/products')) || {};
      importedProducts = Object.keys(raw).map(function(k) {
        var p = raw[k]; p.id = k; return p;
      }).filter(function(p) { return p.importedFrom; });
    } catch (err) {
      console.warn('[Website] Failed to load products:', err.message);
      importedProducts = [];
    }
  }

  async function loadDraftTemplates() {
    try {
      var snap = await MastDB.query('webPresence/draftTemplates').orderByChild('createdAt').limitToLast(5).once('value');
      var raw = snap.val() || {};
      draftTemplates = Object.keys(raw).map(function(k) {
        var d = raw[k]; d.id = k; return d;
      }).filter(function(d) { return d.status === 'draft'; })
        .sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    } catch (err) {
      console.warn('[Website] Failed to load draft templates:', err.message);
      draftTemplates = [];
    }
  }

  async function loadThemeConfig() {
    try {
      themeConfig = (await MastDB.get('public/config/theme')) || {};
    } catch (err) {
      console.warn('[Website] Failed to load theme config:', err.message);
      themeConfig = {};
    }
    // Also load nav section enabled states for section toggles
    try {
      themeConfig._navSections = (await MastDB.get('public/config/nav/sections')) || {};
    } catch (err) {
      themeConfig._navSections = {};
    }
    // Share with other modules (e.g., homepage)
    MastAdmin.setData('themeConfig', themeConfig);
  }

  // ── Render entry (new — mirrors website.js's importOnly branch + first-run
  //    loaders, minus the legacy-tab loaders the import surface never reads:
  //    loadTemplateManifest/loadTemplateRegistry/loadCategories) ──
  async function renderImportPage() {
    var root = document.getElementById('websiteImportRoot');
    if (!root) return;

    if (!websiteLoaded) {
      root.innerHTML = '<div class="loading">Loading import...</div>';
      await loadWebsiteConfig();
      await loadThemeConfig();
      await loadImportJobs();
      await loadImportedProducts();
      await loadDraftTemplates();
      startImportJobsListener();
      websiteLoaded = true;
    }

    var html = '';
    html += '<button class="detail-back" onclick="navigateTo(\'website\')" title="Back to Your Website">\u2190 Back to Your Website</button>';
    html += '<div class="section-header"><h2>Import your catalog</h2></div>';
    html += '<div id="wpTabContent">';
    html += renderImportTab();
    html += '</div>';
    root.innerHTML = html;
  }

  // ── Import-jobs live listener — WITH A REAL DETACH (V1 leak fix) ──
  function startImportJobsListener() {
    if (importJobsListener) return;
    try {
      importJobsListener = MastDB.subscribe('webPresence/importJobs', function(raw) {
        // Self-detach on nav-away: applyRoute() hides our tab (display:none) when
        // the user leaves. V1 kept this RTDB subscription alive forever (its
        // stopImportJobsListener was never wired), churning reads + dead renders.
        // Tear it down here; the route setup re-arms it on return (idempotent).
        var tabEl = document.getElementById('websiteImportTab');
        if (!tabEl || tabEl.style.display === 'none') { stopImportJobsListener(); return; }
        raw = raw || {};
        importJobs = Object.values(raw).sort(function(a, b) {
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
        renderImportPage();
      });
    } catch (err) {
      console.warn('[WebsiteImport] Failed to start import listener:', err.message);
    }
  }

  // ── stopImportJobsListener (verbatim — now actually called) ──
  function stopImportJobsListener() {
    if (importJobsListener) {
      try { importJobsListener(); } catch (e) {}
      importJobsListener = null;
    }
  }

  // ── Render block (verbatim from website.js 1083-1843; selectedProductIds @1733;
  //    wpRunEnrichment's post-enrich re-render adapted to renderImportPage) ──
  function renderDraftTemplateBanner() {
    if (!draftTemplates || draftTemplates.length === 0) return '';
    var draft = draftTemplates[0]; // most recent draft
    var sectionCount = (draft.homepageFlow || []).length;
    var html = '';
    html += '<div style="background:var(--cream-dark);border:1px solid var(--teal);border-radius:8px;padding:16px;margin-bottom:20px;">';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;">';
    html += '<div style="font-size:1.6rem;line-height:1;">&#127912;</div>';
    html += '<div style="flex:1;">';
    html += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:4px;color:var(--text-primary);">Template Generated from Your Site</div>';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:10px;">';
    html += 'We analyzed your site and created a draft template with ' + sectionCount + ' sections';
    if (draft.businessName) html += ' for <strong>' + esc(draft.businessName) + '</strong>';
    html += '. Review the layout, colors, and fonts, then save it as your template.</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button class="btn btn-primary btn-small" onclick="wpReviewDraft(\'' + esc(draft.id) + '\')">Review Template</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="wpDismissDraft(\'' + esc(draft.id) + '\')">Dismiss</button>';
    html += '</div>';

    // Section flow preview
    if (draft.homepageFlow && draft.homepageFlow.length > 0) {
      html += '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px;">';
      for (var i = 0; i < draft.homepageFlow.length; i++) {
        var s = draft.homepageFlow[i];
        html += '<span style="display:inline-block;background:var(--cream-dark,#e8e0d4);border-radius:12px;padding:2px 10px;font-size:0.78rem;color:var(--text-primary);">' + esc(s) + '</span>';
        if (i < draft.homepageFlow.length - 1) html += '<span style="color:var(--warm-gray-light);font-size:0.78rem;">&#8594;</span>';
      }
      html += '</div>';
    }

    html += '</div></div></div>';
    return html;
  }

  // ── Import Tab ──
  function renderImportTab() {
    var html = '';

    // Draft template notification
    html += renderDraftTemplateBanner();

    // Re-scan / New Import section
    html += renderRescanSection();

    // Active import jobs (pending, processing, crawled, importing)
    html += renderActiveImportJobs();

    // Cherry-pick section (for crawled jobs awaiting import)
    html += renderCherryPickSection();

    // Collection report (gap analysis with actionable next steps)
    html += renderCollectionReportSection();

    // Review imported content (if any complete jobs exist)
    var hasComplete = importJobs && importJobs.some(function(j) { return j.status === 'complete'; });
    if (hasComplete) {
      html += renderReviewSection();
    }

    // Import History
    html += renderImportHistory();

    // Analyze section (style/branding import — separate from product import)
    html += '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Analyze a Website</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Extract branding, colors, and content from any website.</p>';
    html += '<div class="wp-field-group">';
    html += '<label>Website URL</label>';
    html += '<div style="display:flex;gap:8px;">';
    var lastUrl = (websiteConfig && websiteConfig._lastAnalyzedUrl) || '';
    html += '<input type="text" id="wpImportUrl" placeholder="www.yourbusiness.com" value="' + esc(lastUrl) + '" style="flex:1;">';
    html += '<button class="btn btn-primary" onclick="wpAnalyze()" id="wpAnalyzeBtn" title="Uses tokens">Analyze</button>';
    html += '</div></div>';
    html += '<div id="wpAnalyzeStatus" style="font-size:0.85rem;margin-bottom:16px;"></div>';
    html += '<div id="wpAnalyzeResults"></div>';
    html += '</div>';

    return html;
  }

  // ── Re-scan / New Import ──
  function renderRescanSection() {
    var html = '<div style="margin-bottom:24px;">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Import Products &amp; Content</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Scan a website to import products, images, blog posts, and events.</p>';

    // Check for recent imports to warn about duplicates
    var recentDupWarning = '';
    if (importJobs && importJobs.length > 0) {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      var recentUrls = {};
      importJobs.forEach(function(j) {
        if (j.createdAt > sevenDaysAgo && j.url) {
          recentUrls[j.url] = (recentUrls[j.url] || 0) + 1;
        }
      });
      // Store for duplicate check
      window._wpRecentImportUrls = recentUrls;
    }

    // Active jobs check
    var hasActiveJob = importJobs && importJobs.some(function(j) {
      return j.status === 'pending' || j.status === 'processing' || j.status === 'crawled' || j.status === 'importing';
    });

    html += '<div class="wp-field-group">';
    html += '<label>Website URL</label>';
    html += '<div style="display:flex;gap:8px;">';
    var lastImportUrl = '';
    if (importJobs && importJobs.length > 0) { lastImportUrl = importJobs[0].url || ''; }
    if (!lastImportUrl && websiteConfig && websiteConfig.siteAnalysis) { lastImportUrl = websiteConfig.siteAnalysis.url || ''; }
    html += '<input type="text" id="wpRescanUrl" placeholder="www.yourbusiness.com" value="' + esc(lastImportUrl) + '" style="flex:1;">';
    html += '<button class="btn btn-primary" onclick="wpStartImport()" id="wpRescanBtn"' + (hasActiveJob ? ' disabled' : '') + '>';
    html += hasActiveJob ? 'Import Running...' : 'Scan &amp; Import';
    html += '</button>';
    html += '</div>';
    html += '</div>';
    html += '<div id="wpRescanStatus" style="font-size:0.85rem;margin-top:-8px;margin-bottom:8px;"></div>';

    if (hasActiveJob) {
      html += '<div style="font-size:0.78rem;color:var(--amber);margin-bottom:8px;">An import is already in progress. Wait for it to complete before starting a new one.</div>';
    }

    html += '</div>';
    return html;
  }

  // ── Active Import Jobs (non-historical) ──
  function renderActiveImportJobs() {
    if (!importJobs || importJobs.length === 0) return '';

    var activeJobs = importJobs.filter(function(j) {
      return j.status === 'pending' || j.status === 'processing' || j.status === 'importing';
    });
    if (activeJobs.length === 0) return '';

    var html = '<div style="margin-bottom:24px;">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Active Imports</h3>';

    activeJobs.forEach(function(job) {
      html += renderJobCard(job, false);
    });

    html += '</div>';
    return html;
  }

  // ── Cherry-Pick Section (for crawled jobs) ──
  function renderCherryPickSection() {
    if (!importJobs) return '';

    var crawledJobs = importJobs.filter(function(j) { return j.status === 'crawled'; });
    if (crawledJobs.length === 0) return '';

    var html = '<div style="margin-bottom:24px;padding:16px;background:var(--cream);border-radius:12px;border:2px solid var(--teal);">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Content Found — Ready to Import</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Review what was found on your website. Toggle items on/off before importing.</p>';

    crawledJobs.forEach(function(job) {
      var disc = job.discovered || {};

      // Products
      if (disc.products && disc.products.count > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<strong style="font-size:0.9rem;">Products (' + disc.products.count + ')</strong>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button class="btn btn-secondary" onclick="wpCherryPickAll(\'' + esc(job.id) + '\', \'products\', true)" style="font-size:0.78rem;padding:3px 8px;">Select All</button>';
        html += '<button class="btn btn-secondary" onclick="wpCherryPickAll(\'' + esc(job.id) + '\', \'products\', false)" style="font-size:0.78rem;padding:3px 8px;">Deselect All</button>';
        html += '</div></div>';

        if (disc.products.pages && disc.products.pages.length > 0) {
          disc.products.pages.forEach(function(p, idx) {
            var sel = getCherryPick(job.id, 'products', p.url || idx);
            html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--cream-dark);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:0.85rem;">';
            html += '<input type="checkbox"' + (sel ? ' checked' : '') + ' onchange="wpToggleCherryPick(\'' + esc(job.id) + '\', \'products\', \'' + esc(p.url || String(idx)) + '\', this.checked)">';
            html += '<span style="flex:1;">' + esc(p.title || 'Unknown Product');
            if (typeof p.priceCents === 'number' && p.priceCents > 0 && window.formatCents) html += ' &mdash; ' + window.formatCents(p.priceCents);
            html += '</span>';
            html += '</label>';
          });
        }
        html += '</div>';
      }

      // Summary counts for other types
      var otherTypes = [];
      if (disc.images && disc.images.count > 0) otherTypes.push(disc.images.count + ' images');
      if (disc.blogs && disc.blogs.count > 0) otherTypes.push(disc.blogs.count + ' blog posts');
      if (disc.events && disc.events.count > 0) otherTypes.push(disc.events.count + ' events');
      if (otherTypes.length > 0) {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Also found: ' + otherTypes.join(', ') + '</div>';
      }

      // JS-rendered warning
      if (job.crawlFeedback && job.crawlFeedback.jsRendered) {
        html += '<div style="font-size:0.85rem;color:var(--amber);background:rgba(255,152,0,0.15);padding:8px 12px;border-radius:6px;margin-bottom:12px;">';
        html += '&#9888; This site uses JavaScript rendering. Some content may not have been captured. ';
        html += 'For best results, consider importing from Square, Etsy, or Shopify directly.';
        html += '</div>';
      }

      // Import button
      html += '<div style="display:flex;gap:8px;margin-top:12px;">';
      html += '<button class="btn btn-primary" onclick="wpImportCherryPicked(\'' + esc(job.id) + '\')">Import Selected</button>';
      html += '<button class="btn btn-secondary" onclick="wpImportAll(\'' + esc(job.id) + '\')">Import All</button>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // ── Import History ──
  function renderImportHistory() {
    if (!importJobs || importJobs.length === 0) return '';

    var historyJobs = importJobs.filter(function(j) {
      return j.status === 'complete' || j.status === 'failed';
    });
    if (historyJobs.length === 0) return '';

    var html = '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:12px;">Import History</h3>';

    historyJobs.forEach(function(job) {
      var statusInfo = getJobStatusInfo(job.status);
      var isExpanded = expandedJobId === job.id;
      var dateStr = job.createdAt ? new Date(job.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      html += '<div style="background:var(--cream);border-radius:8px;padding:12px 16px;margin-bottom:8px;border-left:4px solid ' + statusInfo.color + ';cursor:pointer;" onclick="wpToggleHistoryDetail(\'' + esc(job.id) + '\')">';

      // Summary row
      html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + dateStr + '</span>';
      html += '<span style="font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;">' + esc(job.url || 'Unknown URL') + '</span>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += renderImportedCountsBadges(job.imported);
      html += '<span style="font-size:0.78rem;padding:3px 10px;border-radius:12px;background:' + statusInfo.bg + ';color:' + statusInfo.color + ';font-weight:600;">' + statusInfo.label + '</span>';
      html += '<span style="color:var(--warm-gray);font-size:0.78rem;">' + (isExpanded ? '&#9650;' : '&#9660;') + '</span>';
      html += '</div></div>';

      // Expanded detail
      if (isExpanded) {
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--cream-dark);font-size:0.85rem;">';

        if (job.status === 'complete' && job.imported) {
          html += renderDetailedImportResults(job.imported);
        }
        if (job.status === 'failed') {
          html += '<div style="color:var(--danger);margin-bottom:8px;">' + esc(job.error || 'Unknown error') + '</div>';
          html += '<button class="btn btn-secondary" onclick="event.stopPropagation(); wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.78rem;">Re-scan &amp; Import</button>';
        }

        // Timing
        if (job.createdAt && job.completedAt) {
          var dur = Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 60000);
          html += '<div style="color:var(--warm-gray);margin-top:8px;">Duration: ' + dur + ' min</div>';
        }

        // JS warning note
        if (job.crawlFeedback && job.crawlFeedback.jsRendered) {
          html += '<div style="color:var(--amber);margin-top:4px;">&#9888; JS-rendered site — some content may have been missed.</div>';
        }

        html += '</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function renderImportedCountsBadges(imported) {
    if (!imported) return '';
    var html = '';
    if (imported.products && imported.products.done) {
      html += '<span style="font-size:0.78rem;background:var(--teal);color:white;padding:2px 6px;border-radius:4px;">' + imported.products.done + 'P</span>';
    }
    if (imported.images && imported.images.done) {
      html += '<span style="font-size:0.78rem;background:var(--teal);color:white;padding:2px 6px;border-radius:4px;">' + imported.images.done + 'I</span>';
    }
    return html;
  }

  function renderDetailedImportResults(imported) {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:8px;">';
    ['products', 'images', 'blogs', 'events'].forEach(function(type) {
      var d = imported[type];
      if (!d) return;
      var label = type.charAt(0).toUpperCase() + type.slice(1);
      html += '<div style="background:var(--cream-dark);padding:8px;border-radius:6px;">';
      html += '<div style="font-weight:600;">' + label + '</div>';
      html += '<div style="color:var(--teal);">' + (d.done || 0) + ' imported</div>';
      if (d.failed) html += '<div style="color:var(--danger);">' + d.failed + ' failed</div>';
      if (d.skipped) html += '<div style="color:var(--warm-gray);">' + d.skipped + ' skipped (duplicates)</div>';
      html += '</div>';
    });
    html += '</div>';

    // Show failed items if any
    if (imported.products && imported.products.failedItems && imported.products.failedItems.length > 0) {
      html += '<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--danger);font-size:0.78rem;">Failed items</summary>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">';
      imported.products.failedItems.forEach(function(item) {
        html += '<div>' + esc(item) + '</div>';
      });
      html += '</div></details>';
    }

    return html;
  }

  // ── Job Card (reusable for active and history) ──
  function renderJobCard(job, compact) {
    var statusInfo = getJobStatusInfo(job.status);
    var timeAgo = formatTimeAgo(job.createdAt);

    var html = '<div style="background:var(--cream);border-radius:8px;padding:' + (compact ? '12px' : '16px') + ';margin-bottom:' + (compact ? '8px' : '12px') + ';border-left:4px solid ' + statusInfo.color + ';">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">';
    html += '<div>';
    html += '<div style="font-weight:600;font-size:0.9rem;">' + esc(job.url) + '</div>';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + timeAgo + '</div>';
    html += '</div>';
    html += '<span style="font-size:0.78rem;padding:3px 10px;border-radius:12px;background:' + statusInfo.bg + ';color:' + statusInfo.color + ';font-weight:600;white-space:nowrap;">';
    html += statusInfo.icon + ' ' + statusInfo.label;
    html += '</span>';
    html += '</div>';

    // Status-specific details
    if (job.status === 'pending') {
      // Timeout detection: if pending for > 2 hours, show warning
      var pendingMs = Date.now() - new Date(job.createdAt).getTime();
      if (pendingMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-bottom:4px;">&#9888; This job has been queued for over 2 hours. It may be stuck.</div>';
        html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.78rem;">Re-scan</button>';
      } else {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);">Queued for processing. The import runs every 30 minutes.</div>';
      }
    } else if (job.status === 'processing') {
      // Timeout detection: if processing for > 2 hours, show warning
      var processMs = Date.now() - new Date(job.claimedAt || job.createdAt).getTime();
      if (processMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-bottom:4px;">&#9888; Scan has been running for over 2 hours. It may be stuck.</div>';
        html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="font-size:0.78rem;">Re-scan &amp; Retry</button>';
      } else {
        html += '<div style="font-size:0.85rem;color:var(--warm-gray);">Scanning your website for products, images, and content...</div>';
        html += renderProgressBar(30);
      }
    } else if (job.status === 'importing') {
      html += renderDiscoveredCounts(job.discovered);
      html += renderImportProgress(job.imported);
      // Timeout detection
      var importMs = Date.now() - new Date(job.claimedAt || job.createdAt).getTime();
      if (importMs > 2 * 60 * 60 * 1000) {
        html += '<div style="font-size:0.85rem;color:var(--danger);margin-top:4px;">&#9888; Import has been running for over 2 hours.</div>';
      }
    } else if (job.status === 'failed') {
      html += '<div style="font-size:0.85rem;color:var(--danger);margin-top:4px;">' + esc(job.error || 'Import encountered an error.') + '</div>';
      html += '<button class="btn btn-secondary" onclick="wpRetryImport(\'' + esc(job.id) + '\')" style="margin-top:8px;font-size:0.78rem;">Re-scan &amp; Import</button>';
    }

    html += '</div>';
    return html;
  }

  function getJobStatusInfo(status) {
    var map = {
      pending: { label: 'Queued', icon: '&#9203;', color: 'var(--warm-gray)', bg: 'var(--cream-dark)' },
      processing: { label: 'Scanning', icon: '&#128269;', color: 'var(--amber)', bg: 'rgba(255,152,0,0.15)' },
      crawled: { label: 'Found Content', icon: '&#10003;', color: 'var(--teal)', bg: 'rgba(0,150,136,0.15)' },
      importing: { label: 'Importing', icon: '&#8635;', color: 'var(--amber)', bg: 'rgba(255,152,0,0.15)' },
      complete: { label: 'Complete', icon: '&#10003;', color: 'var(--teal)', bg: 'rgba(0,150,136,0.15)' },
      failed: { label: 'Failed', icon: '&#10007;', color: 'var(--danger)', bg: 'rgba(244,67,54,0.15)' }
    };
    return map[status] || map.pending;
  }

  function renderProgressBar(pct) {
    return '<div style="margin-top:8px;background:var(--cream-dark);border-radius:4px;height:6px;overflow:hidden;">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--amber);border-radius:4px;transition:width 0.5s;"></div></div>';
  }

  function renderDiscoveredCounts(discovered) {
    if (!discovered) return '';
    var items = [];
    if (discovered.products && discovered.products.count) items.push(discovered.products.count + ' products');
    if (discovered.images && discovered.images.count) items.push(discovered.images.count + ' images');
    if (discovered.blogs && discovered.blogs.count) items.push(discovered.blogs.count + ' blog posts');
    if (discovered.events && discovered.events.count) items.push(discovered.events.count + ' events');
    if (items.length === 0) return '';
    return '<div style="font-size:0.85rem;color:var(--text-primary);margin-top:4px;">Found: ' + items.join(', ') + '</div>';
  }

  function renderImportProgress(imported) {
    if (!imported) return renderProgressBar(50);
    var total = 0, done = 0;
    ['products', 'images', 'blogs', 'events'].forEach(function(t) {
      if (imported[t]) { total += (imported[t].total || 0); done += (imported[t].done || 0); }
    });
    var pct = total > 0 ? Math.round((done / total) * 100) : 50;
    var html = '<div style="font-size:0.85rem;color:var(--text-primary);margin-top:4px;">Importing: ' + done + ' of ' + total + ' items</div>';
    html += renderProgressBar(pct);
    return html;
  }

  function renderImportedCounts(imported) {
    if (!imported) return '';
    var html = '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px;">';
    if (imported.products && imported.products.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.products.done + ' products</span>';
    }
    if (imported.images && imported.images.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.images.done + ' images</span>';
    }
    if (imported.blogs && imported.blogs.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.blogs.done + ' blog posts</span>';
    }
    if (imported.events && imported.events.done) {
      html += '<span style="font-size:0.85rem;color:var(--teal);">&#10003; ' + imported.events.done + ' events</span>';
    }
    html += '</div>';
    return html;
  }

  // ── Review Imports Section ──
  // ── Collection Report — Gap analysis with actionable next steps ──
  function renderCollectionReportSection() {
    // Find the most recent completed job with a collection report
    var report = null;
    var jobId = null;
    if (importJobs) {
      for (var i = 0; i < importJobs.length; i++) {
        if (importJobs[i].status === 'complete' && importJobs[i].collectionReport) {
          report = importJobs[i].collectionReport;
          jobId = importJobs[i].id;
          break;
        }
      }
    }
    if (!report) return '';

    var s = report.summary || {};
    var g = report.gathered || {};
    var gaps = report.gaps || [];
    var cost = report.costSummary || {};
    var total = g.total || 1;
    var gapRows = report.gapAnalysis || [];

    var html = '<div id="importGapReport" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';

    // Header with quality score
    var scoreColor = s.qualityScore >= 80 ? 'var(--teal)' : s.qualityScore >= 60 ? 'var(--amber)' : 'var(--danger)';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<div>';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Import Report</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);">' + esc(String(s.productsFound || 0)) + ' products imported from ' + esc(s.platform || 'your site') + '</p>';
    html += '</div>';
    html += '<span class="status-badge" style="background:' + scoreColor + ';color:white;font-size:0.78rem;">' + esc(String(s.qualityScore || 0)) + '% ' + esc(s.qualityLabel || '') + '</span>';
    html += '</div>';

    // Gap analysis table — "Your site has → We matched → Gap → Plan"
    if (gapRows.length > 0) {
      html += renderGapAnalysisTable(gapRows, jobId, cost);
    }

    // Collapsible field-level detail
    html += '<details style="margin-top:16px;">';
    html += '<summary style="font-size:0.85rem;font-weight:600;cursor:pointer;color:var(--warm-gray);margin-bottom:8px;">Field-level detail</summary>';

    // What we gathered (existing grid)
    var fieldLabels = { name: 'Names', price: 'Prices', description: 'Descriptions', images: 'Images', category: 'Categories', variants: 'Variants/Options', sku: 'SKUs', weight: 'Weight', tags: 'Search Tags' };
    html += '<div style="background:var(--cream);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<p style="font-weight:600;font-size:0.85rem;margin-bottom:8px;">What we gathered</p>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;">';
    Object.keys(fieldLabels).forEach(function(field) {
      var count = g[field] || 0;
      var icon = count >= total ? '<span style="color:var(--teal);">&#10003;</span>' : count > 0 ? '<span style="color:var(--amber);">&#9679;</span>' : '<span style="color:var(--warm-gray);">&#9675;</span>';
      html += '<div style="font-size:0.85rem;">' + icon + ' ' + esc(fieldLabels[field]) + ' <span style="color:var(--warm-gray);">(' + count + '/' + total + ')</span></div>';
    });
    html += '</div></div>';

    // Legacy gaps detail
    if (gaps.length > 0) {
      html += '<div style="background:var(--cream);border-radius:8px;padding:16px;margin-bottom:16px;">';
      html += '<p style="font-weight:600;font-size:0.85rem;margin-bottom:12px;">What\'s missing &mdash; your options</p>';

      var freeGaps = gaps.filter(function(g) { return g.cost === 'free'; });
      var paidGaps = gaps.filter(function(g) { return g.cost === 'paid'; });
      var manualGaps = gaps.filter(function(g) { return g.cost === 'manual'; });

      if (freeGaps.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:6px;">&#10003; Can be filled automatically (free)</div>';
        freeGaps.forEach(function(gap) {
          html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;padding-left:16px;">' + esc(gap.description) + '</div>';
        });
        html += '</div>';
      }

      if (paidGaps.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-size:0.85rem;font-weight:600;color:var(--amber);margin-bottom:6px;">&#10024; AI enrichment available (' + esc(cost.estimatedCost || 'varies') + ')</div>';
        paidGaps.forEach(function(gap) {
          html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;padding-left:16px;">' + esc(gap.description) + '</div>';
        });
        html += '<button class="btn btn-primary btn-small" style="margin-top:8px;margin-left:16px;" onclick="wpRunEnrichment(\'' + esc(jobId) + '\')" title="Uses tokens">Enrich with AI</button>';
        html += '</div>';
      }

      if (manualGaps.length > 0) {
        html += '<div style="margin-bottom:4px;">';
        html += '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray);margin-bottom:6px;">&#9998; Best added manually</div>';
        manualGaps.forEach(function(gap) {
          html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;padding-left:16px;">' + esc(gap.description) + '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</details>';
    html += '</div>';
    return html;
  }

  // ── Gap Analysis Table — "Your site → We matched → Gap → Plan" ──
  function renderGapAnalysisTable(rows, jobId, costSummary) {
    var statusIcons = {
      'complete': '<span style="color:var(--teal);">&#10003;</span>',
      'partial': '<span style="color:var(--amber);">&#9679;</span>',
      'action-needed': '<span style="color:var(--amber);">&#9888;</span>',
      'missing': '<span style="color:var(--danger);">&#10007;</span>',
      'info': '<span style="color:var(--warm-gray);">&#8505;</span>'
    };

    var hasPaidGaps = rows.some(function(r) { return r.plan && r.plan.indexOf('Paid:') === 0; });

    var html = '<div style="background:var(--cream);border-radius:8px;padding:16px;margin-bottom:16px;">';

    // Table rows
    rows.forEach(function(row) {
      var icon = statusIcons[row.status] || statusIcons['info'];
      var borderColor = row.status === 'complete' ? 'var(--teal)' : row.status === 'action-needed' ? 'var(--amber)' : row.status === 'partial' ? 'var(--amber)' : row.status === 'missing' ? 'var(--danger)' : 'var(--cream-dark)';

      html += '<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--cream-dark);">';

      // Status icon
      html += '<div style="flex-shrink:0;font-size:1rem;margin-top:2px;">' + icon + '</div>';

      // Content
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:0.9rem;font-weight:600;margin-bottom:2px;">' + esc(row.capability) + '</div>';

      // Detected → Matched
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">';
      html += esc(row.detectedLabel);
      if (row.matchedLabel) html += ' &rarr; ' + esc(row.matchedLabel);
      html += '</div>';

      // Gap + Plan
      if (row.gap) {
        html += '<div style="font-size:0.78rem;margin-top:4px;">';
        html += '<span style="color:var(--amber);">' + esc(row.gap) + '</span>';
        if (row.plan && row.plan !== 'Complete') {
          html += ' &mdash; <span style="color:var(--warm-gray-dark,#666);">' + esc(row.plan) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';

    // Summary action bar
    var completeCount = rows.filter(function(r) { return r.status === 'complete'; }).length;
    var actionCount = rows.filter(function(r) { return r.status === 'action-needed' || r.status === 'partial'; }).length;

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);">';
    html += '<span style="color:var(--teal);">' + completeCount + '</span> complete';
    if (actionCount > 0) html += ' &middot; <span style="color:var(--amber);">' + actionCount + '</span> need attention';
    html += '</div>';

    if (hasPaidGaps && jobId) {
      html += '<button class="btn btn-primary btn-small" onclick="wpRunEnrichment(\'' + esc(jobId) + '\')" title="Uses tokens">';
      html += 'Enrich with AI';
      if (costSummary && costSummary.estimatedCost) html += ' (' + esc(costSummary.estimatedCost) + ')';
      html += '</button>';
    }
    html += '</div>';

    return html;
  }

  // Enrichment action from collection report
  window.wpRunEnrichment = async function(importJobId) {
    if (!importJobId) { showToast('No import job found.', true); return; }
    var btn = event.target;
    btn.disabled = true;
    btn.textContent = 'Enriching...';
    try {
      var result = await firebase.functions().httpsCallable('runEnrichment')({
        tenantId: MastDB.tenantId(),
        importJobId: importJobId,
        fields: ['tags', 'description']
      });
      var data = result.data || {};
      showToast(data.enriched + ' products enriched with AI.');
      btn.textContent = 'Done!';
      // Refresh the import tab to show updated report
      setTimeout(function() { renderImportPage(); }, 1500);
    } catch (err) {
      showToast('Enrichment failed: ' + esc(err.message), true);
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  };

  function renderReviewSection() {
    var html = '<div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--cream-dark);">';
    html += '<h3 style="font-size:1rem;margin-bottom:4px;">Review Imported Content</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Imported items are live on your site. Review and customize them below.</p>';

    // Review sub-tabs
    html += '<div class="view-tabs">';
    ['products', 'images', 'blog', 'events'].forEach(function(t) {
      var active = importReviewTab === t;
      var label = t.charAt(0).toUpperCase() + t.slice(1);
      html += '<button class="view-tab' + (active ? ' active' : '') + '" onclick="wpReviewTab(\'' + t + '\')">' + label + '</button>';
    });
    html += '</div>';

    html += '<div id="wpReviewContent">';
    if (importReviewTab === 'products') html += renderReviewProducts();
    else if (importReviewTab === 'images') html += renderReviewImages();
    else if (importReviewTab === 'blog') html += renderReviewBlog();
    else if (importReviewTab === 'events') html += renderReviewEvents();
    html += '</div>';

    html += '</div>';
    return html;
  }

  var selectedProductIds = new Set();

  function renderReviewProducts() {
    if (!importedProducts || importedProducts.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported products found.</div>';
    }

    var draftProducts = importedProducts.filter(function(p) { return p.status === 'draft' && p.importedFrom; });
    var publishedProducts = importedProducts.filter(function(p) { return p.status === 'active' && p.importedFrom; });
    var allProducts = draftProducts.concat(publishedProducts);

    var html = '';

    // Bulk action bar
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<input type="checkbox" id="wp-select-all-products" onchange="wpToggleSelectAll(this.checked)" style="width:18px;height:18px;cursor:pointer;"' + (selectedProductIds.size === allProducts.length && allProducts.length > 0 ? ' checked' : '') + '>';
    html += '<label for="wp-select-all-products" style="font-size:0.85rem;color:var(--warm-gray);cursor:pointer;">';
    if (selectedProductIds.size > 0) {
      html += selectedProductIds.size + ' selected';
    } else {
      html += allProducts.length + ' product' + (allProducts.length !== 1 ? 's' : '');
    }
    html += '</label>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;">';
    if (draftProducts.length > 0) {
      html += '<button class="btn btn-primary" onclick="wpPublishAllProducts()" style="font-size:0.78rem;">Publish All Drafts</button>';
    }
    if (selectedProductIds.size > 0) {
      html += '<button class="btn btn-secondary" onclick="wpDeleteSelectedProducts()" style="font-size:0.78rem;color:var(--danger);">Delete Selected (' + selectedProductIds.size + ')</button>';
    }
    html += '</div>';
    html += '</div>';

    allProducts.forEach(function(p) {
      var isDraft = p.status === 'draft';
      var isSelected = selectedProductIds.has(p.id);
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--cream);border-radius:8px;margin-bottom:8px;' + (isDraft ? 'border-left:3px solid var(--amber);' : 'border-left:3px solid var(--teal);') + (isSelected ? 'outline:2px solid var(--danger);' : '') + '">';

      // Checkbox
      html += '<input type="checkbox" onchange="wpToggleProductSelect(\'' + esc(p.id) + '\', this.checked)" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;"' + (isSelected ? ' checked' : '') + '>';

      // Thumbnail
      var img = (p.images && p.images.length > 0) ? p.images[0].url || p.images[0] : '';
      if (img) {
        html += '<img src="' + esc(typeof img === 'string' ? img : img.url || '') + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;" alt="">';
      } else {
        html += '<div style="width:48px;height:48px;background:var(--cream-dark);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;color:var(--warm-gray);">&#128247;</div>';
      }

      // Info
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name || 'Untitled') + '</div>';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">';
      if (p.priceCents) html += '$' + (p.priceCents / 100).toFixed(2);
      if (isDraft) html += ' &middot; <span style="color:var(--amber);">Draft</span>';
      else html += ' &middot; <span style="color:var(--teal);">Published</span>';
      html += '</div>';
      html += '</div>';

      // Actions (publish only — delete is now bulk)
      if (isDraft) {
        html += '<button class="btn btn-primary" onclick="wpPublishProduct(\'' + esc(p.id) + '\')" style="font-size:0.78rem;padding:4px 10px;">Publish</button>';
      }

      html += '</div>';
    });

    return html;
  }

  function renderReviewImages() {
    // Images are part of products — show product images from imported products
    if (!importedProducts || importedProducts.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported images found.</div>';
    }

    var images = [];
    importedProducts.forEach(function(p) {
      if (p.importedFrom && p.images) {
        (Array.isArray(p.images) ? p.images : Object.values(p.images)).forEach(function(img) {
          var url = typeof img === 'string' ? img : (img.url || '');
          if (url) images.push({ url: url, productName: p.name, productId: p.id });
        });
      }
    });

    if (images.length === 0) {
      return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">No imported images found.</div>';
    }

    var html = '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' + images.length + ' image' + (images.length !== 1 ? 's' : '') + ' from imported products</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">';
    images.forEach(function(img) {
      html += '<div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;">';
      html += '<img src="' + esc(img.url) + '" style="width:100%;height:100%;object-fit:cover;" alt="' + esc(img.productName || '') + '">';
      html += '</div>';
    });
    html += '</div>';

    return html;
  }

  function renderReviewBlog() {
    return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">Blog post import coming soon.</div>';
  }

  function renderReviewEvents() {
    return '<div style="font-size:0.85rem;color:var(--warm-gray);padding:16px 0;">Event import coming soon.</div>';
  }

  // ── wpSelectStyle (verbatim from website.js 2074-2085 — analyze "Apply
  //    Recommended Style"; re-render adapted to renderImportPage) ──
  window.wpSelectStyle = async function(styleId) {
    websiteConfig.style = styleId;
    STYLE_DEFS.forEach(function(s) {
      if (s.id === styleId) websiteConfig.fontPair = s.font;
    });
    // Style ID still lives under webPresence/config/style (consumed elsewhere in builder).
    // Font pair routes through MastBrandSync to the canonical public/config/theme.fontPair.
    await MastDB.set('webPresence/config/style', styleId);
    if (window.MastBrandSync) await window.MastBrandSync.setFontPair(websiteConfig.fontPair);
    markUnpublished();
    renderImportPage();
  };

  // ── Handlers (verbatim from website.js 2106-2849; formatTimeAgo @2639;
  //    re-render calls adapted to renderImportPage) ──
  window.wpAnalyze = async function() {
    var url = document.getElementById('wpImportUrl').value.trim();
    if (!url) { showToast('Please enter a URL.', true); return; }
    // Normalize URL: fix common typos and ensure protocol
    url = normalizeInputUrl(url);
    if (!url) { showToast('That doesn\'t look like a valid URL.', true); return; }

    var btn = document.getElementById('wpAnalyzeBtn');
    var statusEl = document.getElementById('wpAnalyzeStatus');
    var resultsEl = document.getElementById('wpAnalyzeResults');

    if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Analyzing site... This may take 30-60 seconds.</span>';
    if (resultsEl) resultsEl.innerHTML = '';

    try {
      var result = await firebase.functions().httpsCallable('analyzeExistingSite', { timeout: 120000 })({
        url: url, tenantId: MastDB.tenantId()
      });
      var data = result.data;
      var analysis = data.analysis || {};

      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Analysis complete!</span>';

      // Show results with apply buttons
      var rhtml = '';
      if (analysis.businessName) {
        rhtml += '<div class="wp-import-result"><strong>Business:</strong> ' + esc(analysis.businessName);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyImport(\'meta.siteTitle\', \'' + esc(analysis.businessName).replace(/'/g, "\\'") + '\')">Apply</button></div>';
      }
      if (analysis.styleRecommendation) {
        rhtml += '<div class="wp-import-result"><strong>Recommended Style:</strong> ' + esc(analysis.styleRecommendation);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpSelectStyle(\'' + esc(analysis.styleRecommendation) + '\')">Apply</button></div>';
      }
      if (analysis.colors) {
        rhtml += '<div class="wp-import-result"><strong>Colors:</strong> ';
        if (analysis.colors.primary) rhtml += '<span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:' + esc(analysis.colors.primary) + ';vertical-align:middle;margin-right:4px;"></span>' + esc(analysis.colors.primary) + ' ';
        if (analysis.colors.accent) rhtml += '<span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:' + esc(analysis.colors.accent) + ';vertical-align:middle;margin-right:4px;"></span>' + esc(analysis.colors.accent);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyColors(\'' + esc(analysis.colors.primary || '') + '\', \'' + esc(analysis.colors.accent || '') + '\')">Apply</button></div>';
      }
      if (analysis.hero && analysis.hero.headline) {
        rhtml += '<div class="wp-import-result"><strong>Hero:</strong> ' + esc(analysis.hero.headline);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyHero()">Apply</button></div>';
        // Store for apply
        window._wpImportHero = analysis.hero;
      }
      if (analysis.aboutText) {
        rhtml += '<div class="wp-import-result"><strong>About:</strong> ' + esc(analysis.aboutText.substring(0, 150)) + '...';
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyAbout()">Apply</button></div>';
        window._wpImportAbout = analysis.aboutText;
      }
      if (analysis.contactInfo && (analysis.contactInfo.email || analysis.contactInfo.phone)) {
        rhtml += '<div class="wp-import-result"><strong>Contact:</strong> ';
        if (analysis.contactInfo.email) rhtml += esc(analysis.contactInfo.email) + ' ';
        if (analysis.contactInfo.phone) rhtml += esc(analysis.contactInfo.phone);
        rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplyContact()">Apply</button></div>';
        window._wpImportContact = analysis.contactInfo;
      }
      if (analysis.socialLinks) {
        var socialCount = Object.values(analysis.socialLinks).filter(function(v) { return v; }).length;
        if (socialCount > 0) {
          rhtml += '<div class="wp-import-result"><strong>Social Links:</strong> ' + socialCount + ' found';
          rhtml += ' <button class="btn btn-secondary apply-btn" onclick="wpApplySocial()">Apply</button></div>';
          window._wpImportSocial = analysis.socialLinks;
        }
      }

      // ── Site Fingerprint Card ──
      var fp = data.siteFingerprint;
      if (fp) {
        var pill = function(text) {
          return '<span style="display:inline-block;background:var(--cream-dark,#e8e0d4);border-radius:12px;padding:2px 10px;font-size:0.78rem;margin:2px 4px 2px 0;color:var(--text-primary);">' + esc(String(text)) + '</span>';
        };
        var fpLabel = function(label) {
          return '<span style="color:var(--warm-gray,#888);font-size:0.78rem;min-width:90px;display:inline-block;">' + label + '</span>';
        };

        rhtml += '<div class="wp-import-result" style="margin-top:12px;">';
        rhtml += '<strong style="display:block;margin-bottom:8px;">Site Profile</strong>';
        rhtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;">';

        if (fp.archetype) rhtml += '<div>' + fpLabel('Archetype') + pill(fp.archetype) + '</div>';
        if (fp.productCount) rhtml += '<div>' + fpLabel('Products') + pill(fp.productCount) + '</div>';
        if (fp.productPlacement) rhtml += '<div>' + fpLabel('Placement') + pill(fp.productPlacement) + '</div>';
        if (fp.productDensity) rhtml += '<div>' + fpLabel('Density') + pill(fp.productDensity) + '</div>';
        if (fp.categoryCount) rhtml += '<div>' + fpLabel('Categories') + pill(fp.categoryCount) + '</div>';
        if (fp.pageCount) rhtml += '<div>' + fpLabel('Pages') + pill(fp.pageCount) + '</div>';
        if (fp.heroStyle) rhtml += '<div>' + fpLabel('Hero') + pill(fp.heroStyle) + '</div>';
        if (typeof fp.aboutOnHomepage === 'boolean') rhtml += '<div>' + fpLabel('About') + pill(fp.aboutOnHomepage ? 'on homepage' : 'subpage') + '</div>';
        if (fp.platform) rhtml += '<div>' + fpLabel('Platform') + pill(fp.platform) + '</div>';
        if (fp.paymentProvider) rhtml += '<div>' + fpLabel('Payments') + pill(fp.paymentProvider) + '</div>';

        rhtml += '</div>';

        if (fp.homepageSections && fp.homepageSections.length > 0) {
          rhtml += '<div style="margin-top:8px;">' + fpLabel('Homepage') + fp.homepageSections.map(function(s) { return pill(s); }).join('') + '</div>';
        }
        if (fp.contentTypes && fp.contentTypes.length > 0) {
          rhtml += '<div style="margin-top:4px;">' + fpLabel('Content') + fp.contentTypes.map(function(s) { return pill(s); }).join('') + '</div>';
        }

        rhtml += '</div>';
      }

      // ── Template Match Card ──
      var tm = data.templateMatch;
      if (tm && tm.scores && tm.scores.length > 0) {
        var confLevel = tm.confidenceLevel || (tm.confidence >= 0.6 ? 'high' : 'low');
        var confColor = confLevel === 'high' ? 'var(--teal,#2a9d8f)' : confLevel === 'medium' ? 'var(--amber,#e9c46a)' : 'var(--warm-gray,#888)';

        rhtml += '<div class="wp-import-result" style="margin-top:12px;">';
        rhtml += '<strong style="display:block;margin-bottom:8px;">Template Match</strong>';

        if (tm.bestMatch) {
          rhtml += '<div style="margin-bottom:10px;font-size:0.9rem;">';
          rhtml += 'Best Match: <strong>' + esc(tm.bestMatch.templateId) + '</strong>';
          rhtml += ' &middot; Score: <strong>' + Math.round(tm.bestMatch.score * 100) + '%</strong>';
          rhtml += ' &middot; <span style="background:' + confColor + ';color:#fff;border-radius:12px;padding:2px 10px;font-size:0.78rem;">' + esc(confLevel) + '</span>';
          rhtml += '</div>';
        }

        tm.scores.forEach(function(entry) {
          var isBest = tm.bestMatch && entry.templateId === tm.bestMatch.templateId;
          var barColor = isBest ? 'var(--teal,#2a9d8f)' : 'var(--warm-gray,#ccc)';
          var borderStyle = isBest ? 'border-left:3px solid var(--teal,#2a9d8f);padding-left:10px;' : 'padding-left:13px;';
          var pct = Math.round(entry.score * 100);

          rhtml += '<div style="margin-bottom:8px;' + borderStyle + '">';
          rhtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
          rhtml += '<span style="font-size:0.85rem;font-weight:600;min-width:80px;">' + esc(entry.templateId) + '</span>';
          rhtml += '<div style="flex:1;background:var(--cream-dark,#e8e0d4);border-radius:4px;height:8px;overflow:hidden;">';
          rhtml += '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:4px;transition:width 0.3s;"></div>';
          rhtml += '</div>';
          rhtml += '<span style="font-size:0.78rem;color:var(--warm-gray,#888);min-width:35px;text-align:right;">' + pct + '%</span>';
          rhtml += '</div>';

          // Signal breakdown
          if (entry.signals) {
            rhtml += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);">';
            var signalNames = { archetype: 'archetype', productCount: 'products', aboutOnHomepage: 'about', homepageSections: 'sections', productPlacement: 'placement', contentTypes: 'content', heroStyle: 'hero' };
            Object.keys(signalNames).forEach(function(key) {
              if (entry.signals[key] !== undefined) {
                var matched = entry.signals[key] > 0;
                rhtml += '<span style="margin-right:8px;">' + (matched ? '&#10003;' : '&#10007;') + ' ' + signalNames[key] + '</span>';
              }
            });
            rhtml += '</div>';
          }

          rhtml += '</div>';
        });

        rhtml += '</div>';
      }

      // ── Draft Template Generated Card ──
      if (data.draftTemplateId) {
        rhtml += '<div class="wp-import-result" style="margin-top:12px;background:linear-gradient(135deg, rgba(42,124,111,0.08), rgba(196,133,60,0.08));border:1px solid var(--teal);border-radius:8px;padding:14px;">';
        rhtml += '<strong style="display:block;margin-bottom:6px;">&#127912; Draft Template Created</strong>';
        rhtml += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:10px;">A template has been generated from your site\'s layout. Review and customize the section order, colors, and fonts.</div>';
        rhtml += '<button class="btn btn-primary btn-small" onclick="wpReviewDraft(\'' + esc(data.draftTemplateId) + '\')">Review Template</button>';
        rhtml += '</div>';
      }

      if (resultsEl) resultsEl.innerHTML = rhtml;
      // Reload config and drafts since analysis also seeds them
      await loadWebsiteConfig();
      await loadDraftTemplates();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze'; }
  };

  // ── Import apply handlers ──

  window.wpApplyImport = function(path, value) {
    var parts = path.split('.');
    if (parts.length === 2) {
      if (!websiteConfig[parts[0]]) websiteConfig[parts[0]] = {};
      websiteConfig[parts[0]][parts[1]] = value;
      MastDB.set('webPresence/config/' + parts[0] + '/' + parts[1], value);
    } else {
      websiteConfig[path] = value;
      MastDB.set('webPresence/config/' + path, value);
    }
    markUnpublished();
    showToast('Applied!');
  };

  window.wpApplyColors = function(primary, accent) {
    var update = {};
    if (primary) { websiteConfig.primaryColor = primary; update.primaryColor = primary; }
    if (accent)  { websiteConfig.accentColor  = accent;  update.accentColor  = accent; }
    if (Object.keys(update).length && window.MastBrandSync) window.MastBrandSync.setColors(update);
    markUnpublished();
    showToast('Colors applied!');
  };

  window.wpApplyHero = function() {
    var hero = window._wpImportHero;
    if (!hero) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.hero) websiteConfig.sections.hero = {};
    if (hero.headline) { websiteConfig.sections.hero.headline = hero.headline; MastDB.set('webPresence/config/sections/hero/headline', hero.headline); }
    if (hero.subheadline) { websiteConfig.sections.hero.subheadline = hero.subheadline; MastDB.set('webPresence/config/sections/hero/subheadline', hero.subheadline); }
    if (hero.ctaText) { websiteConfig.sections.hero.ctaText = hero.ctaText; MastDB.set('webPresence/config/sections/hero/ctaText', hero.ctaText); }
    markUnpublished();
    showToast('Hero content applied!');
  };

  window.wpApplyAbout = function() {
    var text = window._wpImportAbout;
    if (!text) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.about) websiteConfig.sections.about = {};
    websiteConfig.sections.about.body = text;
    MastDB.set('webPresence/config/sections/about/body', text);
    markUnpublished();
    showToast('About content applied!');
  };

  window.wpApplyContact = function() {
    var contact = window._wpImportContact;
    if (!contact) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    ['email', 'phone', 'address'].forEach(function(f) {
      if (contact[f]) {
        websiteConfig.sections.contact[f] = contact[f];
        MastDB.set('webPresence/config/sections/contact/' + f, contact[f]);
      }
    });
    markUnpublished();
    showToast('Contact info applied!');
  };

  window.wpApplySocial = function() {
    var social = window._wpImportSocial;
    if (!social) return;
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    if (!websiteConfig.sections.contact.socialLinks) websiteConfig.sections.contact.socialLinks = {};
    Object.keys(social).forEach(function(p) {
      if (social[p]) {
        websiteConfig.sections.contact.socialLinks[p] = social[p];
        MastDB.set('webPresence/config/sections/contact/socialLinks/' + p, social[p]);
      }
    });
    markUnpublished();
    showToast('Social links applied!');
  };

  // ── Import review handlers ──

  window.wpReviewTab = function(tab) {
    importReviewTab = tab;
    renderImportPage();
  };

  window.wpPublishProduct = async function(pid) {
    try {
      await MastDB.set('public/products/' + pid + '/status', 'active');
      writeAudit('update', 'products', pid);
      showToast('Product published!');
      await loadImportedProducts();
      renderImportPage();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpPublishAllProducts = async function() {
    if (!importedProducts) return;
    var drafts = importedProducts.filter(function(p) { return p.status === 'draft' && p.importedFrom; });
    if (drafts.length === 0) return;
    try {
      var updates = {};
      drafts.forEach(function(p) { updates['public/products/' + p.id + '/status'] = 'active'; });
      await MastDB.multiUpdate(updates);
      drafts.forEach(function(p) { writeAudit('update', 'products', p.id); });
      showToast(drafts.length + ' product' + (drafts.length !== 1 ? 's' : '') + ' published!');
      await loadImportedProducts();
      renderImportPage();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpDeleteProduct = function(pid) {
    showConfirmDialog('Delete Product', 'Delete this product? This cannot be undone.', async function() {
      try {
        await MastDB.remove('public/products/' + pid);
        writeAudit('delete', 'products', pid);
        showToast('Product deleted.');
        selectedProductIds.delete(pid);
        await loadImportedProducts();
        renderImportPage();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      }
    }, { confirmLabel: 'Delete', cancelLabel: 'Cancel' });
  };

  window.wpToggleSelectAll = function(checked) {
    if (!importedProducts) return;
    selectedProductIds.clear();
    if (checked) {
      var draftProducts = importedProducts.filter(function(p) { return p.status === 'draft' && p.importedFrom; });
      var publishedProducts = importedProducts.filter(function(p) { return p.status === 'active' && p.importedFrom; });
      draftProducts.concat(publishedProducts).forEach(function(p) { selectedProductIds.add(p.id); });
    }
    renderImportPage();
  };

  window.wpToggleProductSelect = function(pid, checked) {
    if (checked) selectedProductIds.add(pid);
    else selectedProductIds.delete(pid);
    renderImportPage();
  };

  window.wpDeleteSelectedProducts = function() {
    var count = selectedProductIds.size;
    if (count === 0) return;
    showConfirmDialog('Delete ' + count + ' Product' + (count !== 1 ? 's' : ''), 'Delete ' + count + ' selected product' + (count !== 1 ? 's' : '') + '? This cannot be undone.', async function() {
      try {
        var pids = Array.from(selectedProductIds);
        console.log('[wpDeleteSelectedProducts] Deleting', pids.length, 'products:', pids);
        // Delete each product individually to ensure Firebase processes all
        for (var i = 0; i < pids.length; i++) {
          await MastDB.remove('public/products/' + pids[i]);
          writeAudit('delete', 'products', pids[i]);
        }
        console.log('[wpDeleteSelectedProducts] All deletes complete');
        showToast(count + ' product' + (count !== 1 ? 's' : '') + ' deleted.');
        selectedProductIds.clear();
        // Force fresh read
        importedProducts = [];
        await loadImportedProducts();
        renderImportPage();
      } catch (err) {
        console.error('[wpDeleteSelectedProducts] Error:', err);
        showToast('Error: ' + err.message, true);
      }
    }, { confirmLabel: 'Delete', cancelLabel: 'Cancel' });
  };

  window.wpRetryImport = async function(jobId) {
    try {
      var job = importJobs && importJobs.find(function(j) { return j.id === jobId; });
      if (!job) { try { job = await MastDB.get('webPresence/importJobs/' + jobId); } catch (e) {} }
      if (!job || !job.url) { showToast('Could not find that import job to retry.', true); return; }

      // A plain status flip never re-runs the import: processImportJob is an
      // onDocumentCreated trigger, and even when it does run it replays the FROZEN
      // webPresence/siteAnalysis/importPlan — so a customer who fixed their site (or
      // whose first import dropped categories) gets the identical stale result.
      // Re-scan properly by creating a NEW job carrying forceRescan:true, which makes
      // processImportJob ignore the stored plan and re-run live discovery via the
      // legacy crawl path. The bypass is server-guarded by crawlManifest presence
      // (without it, forceRescan would no-op on the stale plan), so re-derive a manifest
      // when the original job lacks one.
      var manifest = job.crawlManifest || null;
      if (!manifest) {
        showToast('Re-analyzing your site…');
        try {
          await firebase.functions().httpsCallable('analyzeExistingSite', { timeout: 120000 })({
            url: job.url, tenantId: MastDB.tenantId()
          });
          manifest = await MastDB.get('webPresence/siteAnalysis/crawlManifest');
        } catch (e) { /* fall through — backend may still hold a usable importPlan */ }
      }

      var newId = MastDB.newKey('webPresence/importJobs');
      var now = new Date().toISOString();
      var jobData = {
        id: newId,
        url: job.url,
        tenantId: MastDB.tenantId(),
        status: 'pending',
        forceRescan: true,
        createdAt: now,
        claimedAt: null,
        completedAt: null,
        error: null,
        notifyPhone: job.notifyPhone || null,
        crawlManifest: manifest || null,
        discovered: null,
        imported: null
      };
      if (job.mode) jobData.mode = job.mode; // preserve engagement mode (storefront | pim-only | draft-only)
      await MastDB.set('webPresence/importJobs/' + newId, jobData);

      showToast('Re-scan queued — re-discovering your site and re-importing.');
      await loadImportJobs();
      renderImportPage();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  // ── New Import (Re-scan) ──
  async function doStartImport(url) {
    var btn = document.getElementById('wpRescanBtn');
    var statusEl = document.getElementById('wpRescanStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating import...'; }

    try {
      // First, run analyzeExistingSite to get the crawl manifest
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Analyzing site to build crawl plan...</span>';
      var result = await firebase.functions().httpsCallable('analyzeExistingSite', { timeout: 120000 })({
        url: url, tenantId: MastDB.tenantId()
      });

      // Get the crawl manifest from site analysis
      var manifest = await MastDB.get('webPresence/siteAnalysis/crawlManifest');

      // Create the import job in Firebase directly
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--warm-gray);">Queuing import job...</span>';
      var jobId = MastDB.newKey('webPresence/importJobs');
      var now = new Date().toISOString();
      await MastDB.set('webPresence/importJobs/' + jobId, {
        id: jobId,
        url: url,
        tenantId: MastDB.tenantId(),
        status: 'pending',
        createdAt: now,
        claimedAt: null,
        completedAt: null,
        error: null,
        notifyPhone: null,
        crawlManifest: manifest || null,
        discovered: null,
        imported: null
      });

      if (statusEl) statusEl.innerHTML = '<span style="color:var(--teal);">&#10003; Import queued! It will be processed within 30 minutes.</span>';
      showToast('Import job created successfully.');
      await loadImportJobs();
      renderImportPage();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger);">Error: ' + esc(err.message) + '</span>';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Scan & Import'; }
  }

  window.wpStartImport = function() {
    var url = document.getElementById('wpRescanUrl').value.trim();
    if (!url) { showToast('Please enter a URL.', true); return; }
    // Normalize URL
    url = normalizeInputUrl(url);
    if (!url) { showToast('That doesn\'t look like a valid URL.', true); return; }

    // Check for duplicate within 7 days
    var recentUrls = window._wpRecentImportUrls || {};
    if (recentUrls[url]) {
      showConfirmDialog('Re-import URL', 'This URL was imported in the last 7 days. Import again?', function() {
        doStartImport(url);
      }, { confirmLabel: 'Import Again', cancelLabel: 'Cancel' });
    } else {
      doStartImport(url);
    }
  };

  // ── Cherry-pick helpers ──
  function getCherryPick(jobId, type, key) {
    if (!cherryPickSelections[jobId]) return true; // default: all selected
    if (!cherryPickSelections[jobId][type]) return true;
    return cherryPickSelections[jobId][type][key] !== false;
  }

  window.wpToggleCherryPick = function(jobId, type, key, checked) {
    if (!cherryPickSelections[jobId]) cherryPickSelections[jobId] = {};
    if (!cherryPickSelections[jobId][type]) cherryPickSelections[jobId][type] = {};
    cherryPickSelections[jobId][type][key] = checked;
  };

  window.wpCherryPickAll = function(jobId, type, selectAll) {
    if (!cherryPickSelections[jobId]) cherryPickSelections[jobId] = {};
    cherryPickSelections[jobId][type] = {};
    // Find all items and set them
    var job = importJobs && importJobs.find(function(j) { return j.id === jobId; });
    if (job && job.discovered && job.discovered[type] && job.discovered[type].pages) {
      job.discovered[type].pages.forEach(function(p, idx) {
        cherryPickSelections[jobId][type][p.url || String(idx)] = selectAll;
      });
    }
    renderImportPage();
  };

  window.wpImportAll = async function(jobId) {
    // Set status to importing — the scheduled task will pick it up
    try {
      await MastDB.set('webPresence/importJobs/' + jobId + '/status', 'importing');
      showToast('Import started for all items.');
      await loadImportJobs();
      renderImportPage();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  window.wpImportCherryPicked = async function(jobId) {
    // Save cherry-pick selections to the job, then set status to importing
    var selections = cherryPickSelections[jobId] || {};
    try {
      // Write the selection filter to the job
      var excludeUrls = [];
      if (selections.products) {
        Object.keys(selections.products).forEach(function(key) {
          if (selections.products[key] === false) excludeUrls.push(key);
        });
      }
      if (excludeUrls.length > 0) {
        await MastDB.set('webPresence/importJobs/' + jobId + '/cherryPickExclude', excludeUrls);
      }
      await MastDB.set('webPresence/importJobs/' + jobId + '/status', 'importing');
      showToast('Importing selected items.');
      await loadImportJobs();
      renderImportPage();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  };

  // ── History detail toggle ──
  window.wpToggleHistoryDetail = function(jobId) {
    expandedJobId = expandedJobId === jobId ? null : jobId;
    renderImportPage();
  };

  // ── Helpers ──

  function formatTimeAgo(isoStr) {
    if (!isoStr) return '';
    var diff = Date.now() - new Date(isoStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  // ── Draft Template Actions ──
  window.wpReviewDraft = async function(draftId) {
    if (!draftTemplates) return;
    var draft = draftTemplates.find(function(d) { return d.id === draftId; });
    if (!draft) { showToast('Draft template not found.', true); return; }

    // Switch to template tab and show the draft info
    // For now, show details in a modal-style view
    var flow = (draft.homepageFlow || []).join(' → ');
    var scheme = draft.colorSchemes && draft.colorSchemes[0];
    var colors = scheme ? scheme.colors : {};

    var html = '<div style="padding:20px;">';
    html += '<h3 style="font-size:1.15rem;margin-bottom:16px;">Draft Template Review</h3>';

    // Section Flow
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Homepage Section Flow</label>';
    html += '<div id="wpDraftFlow" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
    var sections = draft.homepageFlow || [];
    for (var i = 0; i < sections.length; i++) {
      html += '<div draggable="true" data-idx="' + i + '" style="display:inline-flex;align-items:center;gap:6px;background:var(--cream-dark,#e8e0d4);border-radius:8px;padding:6px 12px;font-size:0.85rem;cursor:grab;">';
      html += '<span>' + esc(sections[i]) + '</span>';
      html += '<button class="btn-icon" style="width:20px;height:20px;font-size:0.72rem;border:none;" onclick="wpDraftMoveSection(\'' + esc(draftId) + '\',' + i + ',-1)" title="Move up">&#9650;</button>';
      html += '<button class="btn-icon" style="width:20px;height:20px;font-size:0.72rem;border:none;" onclick="wpDraftMoveSection(\'' + esc(draftId) + '\',' + i + ',1)" title="Move down">&#9660;</button>';
      html += '<button class="btn-icon" style="width:20px;height:20px;font-size:0.72rem;border:none;color:var(--danger);" onclick="wpDraftRemoveSection(\'' + esc(draftId) + '\',' + i + ')" title="Remove">&#10005;</button>';
      html += '</div>';
      if (i < sections.length - 1) html += '<span style="color:var(--warm-gray-light);">&#8594;</span>';
    }
    html += '</div></div>';

    // Color Scheme
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Color Scheme</label>';
    html += '<div style="display:flex;gap:12px;align-items:center;">';
    if (colors.primaryColor) {
      html += '<div style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:24px;height:24px;border-radius:4px;background:' + esc(colors.primaryColor) + ';border:1px solid #ddd;"></span><span style="font-size:0.85rem;">Primary: ' + esc(colors.primaryColor) + '</span></div>';
    }
    if (colors.accentColor) {
      html += '<div style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:24px;height:24px;border-radius:4px;background:' + esc(colors.accentColor) + ';border:1px solid #ddd;"></span><span style="font-size:0.85rem;">Accent: ' + esc(colors.accentColor) + '</span></div>';
    }
    html += '</div></div>';

    // Font Pair
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Font Pair</label>';
    html += '<span style="font-size:0.85rem;">' + esc(draft.fontPairId || 'classic') + '</span>';
    html += '</div>';

    // Base Template
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Based On</label>';
    html += '<span style="font-size:0.85rem;">' + esc(draft.baseTemplateId || 'the-studio') + '</span>';
    html += '</div>';

    // Section Variants (placeholder — deferred to future phase)
    html += '<div style="margin-bottom:16px;opacity:0.5;">';
    html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Section Variants</label>';
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">Variant selection coming soon — each section will support layout variants (e.g., gallery grid, masonry, carousel).</span>';
    html += '</div>';

    // Section classification details (if available)
    if (draft.classifiedSections && draft.classifiedSections.length > 0) {
      html += '<div style="margin-bottom:16px;">';
      html += '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Classification Details</label>';
      html += '<div style="font-size:0.85rem;color:var(--warm-gray);">';
      for (var j = 0; j < draft.classifiedSections.length; j++) {
        var cs = draft.classifiedSections[j];
        var confColor = cs.confidence === 'high' ? 'var(--teal)' : cs.confidence === 'medium' ? 'var(--amber)' : 'var(--warm-gray-light)';
        html += '<div style="margin-bottom:4px;"><strong>' + esc(cs.observedLabel) + '</strong> → ' + esc(cs.catalogId);
        html += ' <span style="color:' + confColor + ';">(' + esc(cs.confidence) + ')</span>';
        if (cs.reason) html += ' — ' + esc(cs.reason);
        html += '</div>';
      }
      html += '</div></div>';
    }

    // Live preview button
    var baseTemplate = draft.baseTemplateId || 'the-studio';
    html += '<div style="margin-bottom:16px;">';
    html += '<button class="btn btn-outline btn-small" onclick="wpPreviewDraft(\'' + esc(draftId) + '\')">Preview on Storefront</button>';
    html += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:8px;">Opens base template preview (custom flow applied after deploy)</span>';
    html += '</div>';

    // Actions
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark);">';
    html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
    html += '<button class="btn btn-secondary" disabled title="Coming soon — promote saved templates to the shared library for other tenants" style="cursor:not-allowed;opacity:0.5;">Promote to Library</button>';
    html += '<button class="btn btn-primary" onclick="wpSaveDraftAsTemplate(\'' + esc(draftId) + '\')">Save as My Template</button>';
    html += '</div>';

    html += '</div>';
    openModal(html, { width: '600px' });
  };

  window.wpPreviewDraft = function(draftId) {
    var draft = draftTemplates && draftTemplates.find(function(d) { return d.id === draftId; });
    if (!draft) return;
    var baseTemplate = draft.baseTemplateId || 'the-studio';
    // Open the storefront in a new tab with the base template preview param
    var tenantDomain = window.TENANT_CONFIG && window.TENANT_CONFIG.domain;
    var previewUrl;
    if (tenantDomain) {
      previewUrl = 'https://' + tenantDomain + '/?preview_template=' + encodeURIComponent(baseTemplate);
    } else {
      // Fallback to current site
      previewUrl = window.location.origin + '/?preview_template=' + encodeURIComponent(baseTemplate);
    }
    window.open(previewUrl, '_blank');
  };

  window.wpDismissDraft = function(draftId) {
    showConfirmDialog('Dismiss Draft', 'Dismiss this draft template? You can re-generate it by analyzing your site again.', async function() {
      try {
        await MastDB.set('webPresence/draftTemplates/' + draftId + '/status', 'dismissed');
        draftTemplates = draftTemplates.filter(function(d) { return d.id !== draftId; });
        renderImportPage();
        showToast('Draft dismissed.');
      } catch (err) {
        showToast('Failed to dismiss: ' + err.message, true);
      }
    }, { confirmLabel: 'Dismiss', cancelLabel: 'Cancel' });
  };

  window.wpDraftMoveSection = async function(draftId, idx, direction) {
    var draft = draftTemplates && draftTemplates.find(function(d) { return d.id === draftId; });
    if (!draft || !draft.homepageFlow) return;
    var flow = draft.homepageFlow.slice();
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= flow.length) return;
    var temp = flow[idx];
    flow[idx] = flow[newIdx];
    flow[newIdx] = temp;
    draft.homepageFlow = flow;
    await MastDB.set('webPresence/draftTemplates/' + draftId + '/homepageFlow', flow);
    window.wpReviewDraft(draftId);
  };

  window.wpDraftRemoveSection = async function(draftId, idx) {
    var draft = draftTemplates && draftTemplates.find(function(d) { return d.id === draftId; });
    if (!draft || !draft.homepageFlow) return;
    var flow = draft.homepageFlow.slice();
    flow.splice(idx, 1);
    draft.homepageFlow = flow;
    await MastDB.set('webPresence/draftTemplates/' + draftId + '/homepageFlow', flow);
    window.wpReviewDraft(draftId);
  };

  window.wpSaveDraftAsTemplate = async function(draftId) {
    var draft = draftTemplates && draftTemplates.find(function(d) { return d.id === draftId; });
    if (!draft) { showToast('Draft not found.', true); return; }

    try {
      // Write non-brand theme fields directly; brand fields go through MastBrandSync.
      var nonBrandUpdate = { templateId: draft.baseTemplateId || 'the-studio' };
      var fontPairId = draft.fontPairId || 'classic';
      var scheme = draft.colorSchemes && draft.colorSchemes[0];
      var customColors = null;
      if (scheme && scheme.colors) {
        customColors = {};
        if (scheme.colors.primaryColor) customColors.primaryColor = scheme.colors.primaryColor;
        if (scheme.colors.accentColor) customColors.accentColor = scheme.colors.accentColor;
        nonBrandUpdate.colorSchemeId = null; // custom colors, no preset
      }

      await MastDB.update('public/config/theme', nonBrandUpdate);
      if (window.MastBrandSync) {
        await window.MastBrandSync.setFontPair(fontPairId);
        if (customColors && Object.keys(customColors).length) {
          await window.MastBrandSync.setColors(customColors);
        }
      } else {
        var fallback = { fontPair: fontPairId };
        if (customColors) Object.assign(fallback, customColors);
        await MastDB.update('public/config/theme', fallback);
      }

      // Store the custom homepage flow as a draft template override
      await MastDB.set('webPresence/draftTemplates/' + draftId + '/status', 'saved');
      await MastDB.set('public/config/draftTemplate', {
        homepageFlow: draft.homepageFlow,
        baseTemplateId: draft.baseTemplateId,
        savedAt: new Date().toISOString(),
        draftId: draftId
      });

      // Remove from active drafts
      draftTemplates = draftTemplates.filter(function(d) { return d.id !== draftId; });

      closeModal();
      showToast('Template saved! Deploy your site to apply changes.');

      // Reload theme config and re-render
      await loadThemeConfig();
      renderImportPage();
    } catch (err) {
      showToast('Failed to save template: ' + err.message, true);
    }
  };

  // ── Register module ──
  MastAdmin.registerModule('website-import', {
    routes: {
      'website-import': { tab: 'websiteImportTab', setup: function() {
        // markUnpublished (called by the wpApply*/wpSelectStyle appliers) lives in
        // the lazy website-core.js (PR1). Ensure it's loaded so onclick globals
        // resolve. Non-routed no-op core.
        if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('website-core');
        // Re-arm the live import-jobs listener on every entry (idempotent — guarded
        // by importJobsListener). It self-detaches on nav-away, so returning here
        // restarts it.
        startImportJobsListener();
        renderImportPage();
      } }
    },
    // Lifecycle: stop the RTDB subscription on sign-out (the documented hook).
    detachListeners: function() { stopImportJobsListener(); }
  });
})();
