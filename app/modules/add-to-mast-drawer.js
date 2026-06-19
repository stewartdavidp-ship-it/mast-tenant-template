/**
 * Add-to-Mast detail drawer — the slide-out shown when a user clicks "details"
 * on a module card in the Add-to-Mast / engagement surface.
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1 — first leaf extraction). Lazy-loaded on demand via
 * MastAdmin.loadModule('addToMastDrawer') from the delegated [data-amt-action]
 * dispatch; it has no route and no listeners.
 *
 * Reads only eager globals (esc, window.MODE_MODULE_INFO,
 * window.BusinessEntityConstants, getModeSet/getModeOverrides — both typeof-
 * guarded), all defined before any user can open the drawer. Exposes its entry
 * points on window so the eager dispatch + the drawer's own inline onclick
 * handlers resolve them.
 */
(function () {
  'use strict';

  function renderAddToMastDrawerBody(info) {
    var BASE_TXT = 'font-size:0.85rem;color:var(--text-primary);line-height:1.5;';
    var LABEL    = 'font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-top:18px;margin-bottom:6px;';
    var CHIP     = 'display:inline-block;font-size:0.78rem;color:var(--text-primary);background:var(--bg-soft,rgba(0,0,0,0.06));border-radius:999px;padding:4px 10px;margin-right:6px;margin-bottom:6px;';

    var out = '';

    // Screenshot — graceful fallback on 404 (CDN bucket may not exist yet).
    if (info.preview && info.preview.url) {
      var altText = info.preview.alt || ((info.label || '') + ' preview');
      out += '<div style="margin-bottom:8px;border-radius:8px;overflow:hidden;background:var(--bg-soft,rgba(0,0,0,0.06));aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;">';
      out += '<img src="' + esc(info.preview.url) + '" alt="' + esc(altText) + '" onerror="this.outerHTML=&quot;<div style=\\&quot;font-size:0.78rem;color:var(--warm-gray);padding:32px;text-align:center;\\&quot;>Preview coming soon</div>&quot;" style="max-width:100%;height:auto;display:block;" />';
      out += '</div>';
    }

    if (info.outcome) {
      out += '<div style="' + LABEL + 'margin-top:8px;">What you&rsquo;ll get</div>';
      out += '<div style="' + BASE_TXT + '">' + esc(info.outcome) + '</div>';
    }
    if (info.goodFitWhen) {
      out += '<div style="' + LABEL + '">Good fit if&hellip;</div>';
      out += '<div style="' + BASE_TXT + '">' + esc(info.goodFitWhen) + '</div>';
    }
    if (info.notAFitWhen) {
      out += '<div style="' + LABEL + '">Skip if&hellip;</div>';
      out += '<div style="' + BASE_TXT + '">' + esc(info.notAFitWhen) + '</div>';
    }
    if (Array.isArray(info.automates) && info.automates.length > 0) {
      out += '<div style="' + LABEL + '">Replaces</div>';
      out += '<ul style="' + BASE_TXT + 'padding-left:20px;margin:0;">';
      for (var ai = 0; ai < info.automates.length; ai++) {
        out += '<li style="margin-bottom:3px;">' + esc(info.automates[ai]) + '</li>';
      }
      out += '</ul>';
    }
    if (Array.isArray(info.complementsTools) && info.complementsTools.length > 0) {
      out += '<div style="' + LABEL + '">Works alongside</div><div>';
      for (var ci = 0; ci < info.complementsTools.length; ci++) {
        out += '<span style="' + CHIP + '">' + esc(info.complementsTools[ci]) + '</span>';
      }
      out += '</div>';
    }
    if (Array.isArray(info.replacesTools) && info.replacesTools.length > 0) {
      out += '<div style="' + LABEL + '">Replaces tools</div><div>';
      for (var ri = 0; ri < info.replacesTools.length; ri++) {
        out += '<span style="' + CHIP + '">' + esc(info.replacesTools[ri]) + '</span>';
      }
      out += '</div>';
    }
    if (Array.isArray(info.prerequisites) && info.prerequisites.length > 0) {
      out += '<div style="' + LABEL + '">You&rsquo;ll need first</div>';
      out += '<ul style="' + BASE_TXT + 'list-style:none;padding-left:0;margin:0;">';
      for (var pi = 0; pi < info.prerequisites.length; pi++) {
        out += '<li style="padding:3px 0;">&#9744; ' + esc(info.prerequisites[pi]) + '</li>';
      }
      out += '</ul>';
    }
    if (Array.isArray(info.pairsWith) && info.pairsWith.length > 0) {
      out += '<div style="' + LABEL + '">Pairs with</div><div>';
      var MMI = window.MODE_MODULE_INFO || {};
      for (var wi = 0; wi < info.pairsWith.length; wi++) {
        var pwId = info.pairsWith[wi];
        var pwLabel = (MMI[pwId] && MMI[pwId].label) || pwId;
        out += '<span style="' + CHIP + '">' + esc(pwLabel) + '</span>';
      }
      out += '</div>';
    }
    if (info.learnMoreUrl) {
      out += '<div style="margin-top:18px;font-size:0.85rem;">';
      out += '<a href="' + esc(info.learnMoreUrl) + '" target="_blank" rel="noopener noreferrer" style="color:var(--teal,#2a7c6f);text-decoration:none;font-weight:600;">Learn more &rarr;</a>';
      out += '</div>';
    }

    return out;
  }
  window.renderAddToMastDrawerBody = renderAddToMastDrawerBody;

  // Drawer state — tracks last-focused element so we can restore focus on close.
  var _addToMastDrawerLastFocus = null;
  var _addToMastDrawerKeyHandler = null;

  // Lazily create the drawer DOM. Returns the root element.
  function ensureAddToMastDrawer() {
    var existing = document.getElementById('addToMastDrawer');
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'addToMastDrawer';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'display:none;position:fixed;inset:0;z-index:9000;';

    root.innerHTML =
      '<div id="addToMastDrawerScrim" onclick="closeAddToMastDetails()" ' +
          'style="position:absolute;inset:0;background:rgba(0,0,0,0.5);opacity:0;transition:opacity 180ms ease;"></div>' +
      '<aside id="addToMastDrawerPanel" role="dialog" aria-modal="true" aria-labelledby="addToMastDrawerTitle" ' +
             'style="position:absolute;top:0;right:0;height:100%;width:min(520px,100%);background:var(--surface-card,#1a1a1a);' +
             'box-shadow:-12px 0 32px rgba(0,0,0,0.35);display:flex;flex-direction:column;transform:translateX(100%);' +
             'transition:transform 220ms ease;">' +
        '<header style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 14px;' +
                'border-bottom:1px solid var(--border,rgba(255,255,255,0.08));flex-shrink:0;">' +
          '<div style="flex:1;min-width:0;">' +
            '<h2 id="addToMastDrawerTitle" style="font-size:1.15rem;margin:0 0 4px;color:var(--text-primary);font-weight:600;"></h2>' +
            '<div id="addToMastDrawerTagline" style="font-size:0.85rem;color:var(--warm-gray);line-height:1.4;"></div>' +
            '<div id="addToMastDrawerChips" style="margin-top:8px;"></div>' +
          '</div>' +
          '<button type="button" onclick="closeAddToMastDetails()" aria-label="Close details" ' +
                  'style="background:transparent;border:0;color:var(--warm-gray);font-size:1.6rem;line-height:1;cursor:pointer;padding:0 4px;flex-shrink:0;">&times;</button>' +
        '</header>' +
        '<div id="addToMastDrawerBody" tabindex="0" style="flex:1;overflow-y:auto;padding:18px 20px 20px;"></div>' +
        '<footer id="addToMastDrawerFooter" style="padding:14px 20px;border-top:1px solid var(--border,rgba(255,255,255,0.08));' +
                'display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-shrink:0;"></footer>' +
      '</aside>';

    document.body.appendChild(root);
    return root;
  }

  // Open the drawer for a routeId. Populates header/body/footer from the
  // MODE_MODULE_INFO entry + current visibility state.
  function openAddToMastDetails(routeId) {
    try {
      var MMI = window.MODE_MODULE_INFO || {};
      var info = MMI[routeId];
      if (!info) return;

      var root  = ensureAddToMastDrawer();
      var panel = document.getElementById('addToMastDrawerPanel');
      var scrim = document.getElementById('addToMastDrawerScrim');
      var titleEl   = document.getElementById('addToMastDrawerTitle');
      var taglineEl = document.getElementById('addToMastDrawerTagline');
      var chipsEl   = document.getElementById('addToMastDrawerChips');
      var bodyEl    = document.getElementById('addToMastDrawerBody');
      var footerEl  = document.getElementById('addToMastDrawerFooter');

      // Mode-aware label override (consistent with the card label).
      var modeSet = (typeof getModeSet === 'function') ? getModeSet() : null;
      var displayLabel = (window.BusinessEntityConstants && typeof BusinessEntityConstants.labelFor === 'function')
        ? BusinessEntityConstants.labelFor(routeId, modeSet, info.label)
        : info.label;

      titleEl.textContent = displayLabel || routeId;
      taglineEl.textContent = info.tagline || info.desc || '';

      // Setup-depth chip + (future) adoption chip in the header.
      var chipsHtml = '';
      if (info.setupDepth) {
        var depthLabel = ({ quick: 'Quick setup', moderate: 'Moderate setup', heavy: 'Heavier setup' })[info.setupDepth] || info.setupDepth;
        chipsHtml += '<span style="display:inline-block;font-size:0.72rem;color:var(--warm-gray);background:var(--bg-soft,rgba(0,0,0,0.06));border-radius:999px;padding:2px 10px;margin-right:6px;">' + esc(depthLabel) + '</span>';
      }
      chipsEl.innerHTML = chipsHtml;

      bodyEl.innerHTML = renderAddToMastDrawerBody(info);

      // Footer Add/Remove button mirrors the card-level action so the drawer
      // is a complete unit of work — no need to close before deciding.
      var BEC = window.BusinessEntityConstants;
      var rule = (BEC && BEC.MODE_ROUTE_VISIBILITY && BEC.MODE_ROUTE_VISIBILITY[routeId]) || {};
      var overrides = (typeof getModeOverrides === 'function') ? getModeOverrides() : { enabledRoutes: [], disabledRoutes: [] };
      var isAnchor = !!rule.anchor;
      var isVisible  = isAnchor || (BEC && BEC.isRouteVisible ? BEC.isRouteVisible(routeId, modeSet, overrides) : false);

      var footerHtml = '';
      if (isAnchor) {
        footerHtml += '<span style="font-size:0.78rem;color:var(--warm-gray);margin-right:auto;">Always available &mdash; this is how you re-add modules.</span>';
        footerHtml += '<button type="button" class="btn btn-secondary btn-small" onclick="closeAddToMastDetails()">Close</button>';
      } else if (isVisible) {
        footerHtml += '<button type="button" class="btn btn-secondary btn-small" onclick="closeAddToMastDetails()">Close</button>';
        // W1-followup OPEN -OtEkpFjIRwH_z-1CJuB: data-attrs + delegated dispatch
        // instead of inline onclick with esc(routeId) interpolated into JS.
        footerHtml += '<button type="button" class="btn btn-secondary btn-small" data-amt-action="remove" data-amt-route="' + esc(routeId) + '" data-amt-close-drawer="1">Remove from my Mast</button>';
      } else {
        footerHtml += '<button type="button" class="btn btn-secondary btn-small" onclick="closeAddToMastDetails()">Maybe later</button>';
        footerHtml += '<button type="button" class="btn btn-primary btn-small" data-amt-action="add" data-amt-route="' + esc(routeId) + '" data-amt-close-drawer="1">+ Add to my Mast</button>';
      }
      footerEl.innerHTML = footerHtml;

      // Remember the originator so we can restore focus on close.
      _addToMastDrawerLastFocus = document.activeElement;

      // Show with animation.
      root.style.display = 'block';
      root.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // Force reflow so the transition actually runs.
      void panel.offsetWidth;
      panel.style.transform = 'translateX(0)';
      scrim.style.opacity = '1';

      // Move focus into the drawer.
      var closeBtn = panel.querySelector('button[aria-label="Close details"]');
      if (closeBtn) closeBtn.focus();

      // Esc-to-close + Tab focus trap (E1-SEC-FIX-1, WCAG 2.4.3).
      // Without the trap, Tab from inside the drawer escapes to the cards
      // behind the scrim — confusing for keyboard + AT users.
      _addToMastDrawerKeyHandler = function (e) {
        if (e.key === 'Escape') { closeAddToMastDetails(); return; }
        if (e.key !== 'Tab') return;
        var trapPanel = document.getElementById('addToMastDrawerPanel');
        if (!trapPanel) return;
        var nodes = trapPanel.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (nodes.length === 0) return;
        var first  = nodes[0];
        var last   = nodes[nodes.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && (active === first || !trapPanel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !trapPanel.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', _addToMastDrawerKeyHandler);
    } catch (err) {
      console.warn('[openAddToMastDetails] failed:', err && err.message);
    }
  }
  window.openAddToMastDetails = openAddToMastDetails;

  function closeAddToMastDetails() {
    try {
      var root  = document.getElementById('addToMastDrawer');
      var panel = document.getElementById('addToMastDrawerPanel');
      var scrim = document.getElementById('addToMastDrawerScrim');
      if (!root || !panel || !scrim) return;

      panel.style.transform = 'translateX(100%)';
      scrim.style.opacity = '0';
      root.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';

      if (_addToMastDrawerKeyHandler) {
        document.removeEventListener('keydown', _addToMastDrawerKeyHandler);
        _addToMastDrawerKeyHandler = null;
      }

      // Wait for transition before hiding entirely (preserves smooth close).
      setTimeout(function () {
        if (root.getAttribute('aria-hidden') === 'true') {
          root.style.display = 'none';
        }
      }, 240);

      // Restore focus to whoever opened it.
      if (_addToMastDrawerLastFocus && typeof _addToMastDrawerLastFocus.focus === 'function') {
        try { _addToMastDrawerLastFocus.focus(); } catch (_e) {}
      }
      _addToMastDrawerLastFocus = null;
    } catch (err) {
      console.warn('[closeAddToMastDetails] failed:', err && err.message);
    }
  }
  window.closeAddToMastDetails = closeAddToMastDetails;

  // Back-compat alias — older event handlers may still call this name.
  window.toggleAddToMastDetails = openAddToMastDetails;

  // No route, no listeners — register only so loadModule() short-circuits on
  // repeat opens instead of re-fetching the script.
  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('addToMastDrawer', {});
  }
})();
