// ============================================================
// MODE_MODULE_INFO schema validator
// ============================================================
// Pure function. Used by:
//   - app/data/mode-module-info.js   (runtime self-check, fails soft)
//   - scripts/lint-module-info.js    (CI/hook, exits non-zero on failure)
//
// Idea -OtEQoFvlPAu90ghkDXu (Enriched module cards). Schema versioned so
// future shape changes can be migrated without surprise.
//
// ─── TRUST BOUNDARY (E1-SEC-FIX-2, 2026-05-22) ──────────────
// This validator is a SHAPE CONTRACT. It is NOT an XSS defense.
//
// The actual safety boundary is `esc()` (HTML-entity escaping) at the
// rendering sink. The renderer in app/index.html escapes every
// owner-authored string before innerHTML interpolation, regardless of
// whether the entry passed validation. The URL regexes below (HELP_URL_RE,
// ASSET_URL_RE) are defense-in-depth — they reject `javascript:`/`data:`/
// `file:` schemes — but the renderer does not rely on them being correct.
//
// If you add a NEW SINK that interpolates one of these fields into the
// DOM (e.g. a Markdown preview, a tooltip helper, a fresh innerHTML
// build), you MUST `esc()` the value at the sink. Do not assume the
// validator caught everything. The runtime validator fails soft (warn-
// only) so a malformed entry does not crash the admin app; that means a
// bad entry CAN reach the renderer in prod. esc() is what keeps it safe.
//
// Schema changes that relax string-length caps or add free-form fields
// must be reviewed against this boundary.
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // Node — lint script consumes this
  }
  if (typeof window !== 'undefined') {
    window.validateModuleEntry = api.validateModuleEntry;
    window.MODULE_INFO_SCHEMA_VERSION = api.SCHEMA_VERSION;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  // Field caps — keep in sync with design doc §3.
  var CAPS = {
    label:        24,
    tagline:      90,
    outcome:      120,
    goodFitWhen:  140,
    notAFitWhen:  140,
    automatesEach: 60,
    listToolsEach: 40,
    prereqEach:    80,
    previewAlt:    140
  };

  var VALID_SETUP_DEPTH = ['quick', 'moderate', 'heavy'];

  var VALID_SECTIONS = ['products', 'sales', 'marketing', 'retention',
                        'events', 'classes', 'finance', 'operations',
                        'customer-service', 'admin'];

  // help.runmast.com only — runmast.com is the canonical domain.
  // Allow hash route or path; reject any mast.com URLs (typo guard).
  var HELP_URL_RE = /^https:\/\/help\.runmast\.com\/(#|[a-z0-9-])[a-z0-9\-#\/]*$/i;
  var ASSET_URL_RE = /^https:\/\/assets\.runmast\.com\/modes\/[a-z0-9\-]+\.(png|jpg|jpeg|webp|gif)$/i;

  function isStr(v) { return typeof v === 'string' && v.length > 0; }
  function isArr(v) { return Array.isArray(v); }

  function checkStringCap(errors, field, value, cap) {
    if (typeof value !== 'string') {
      errors.push(field + ': must be a string');
      return;
    }
    if (value.length === 0) {
      errors.push(field + ': cannot be empty');
      return;
    }
    if (value.length > cap) {
      errors.push(field + ': exceeds ' + cap + 'ch (got ' + value.length + ')');
    }
  }

  function checkStringList(errors, field, value, min, max, perItemCap) {
    if (!isArr(value)) {
      errors.push(field + ': must be an array');
      return;
    }
    if (value.length < min) {
      errors.push(field + ': must have at least ' + min + ' item(s)');
    }
    if (value.length > max) {
      errors.push(field + ': exceeds max of ' + max + ' items (got ' + value.length + ')');
    }
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string' || value[i].length === 0) {
        errors.push(field + '[' + i + ']: must be non-empty string');
      } else if (perItemCap && value[i].length > perItemCap) {
        errors.push(field + '[' + i + ']: exceeds ' + perItemCap + 'ch');
      }
    }
  }

  /**
   * Validate a single MODE_MODULE_INFO entry.
   * @param {string} routeId
   * @param {object} entry
   * @param {object} [opts] - { routeRegistry: MODE_ROUTE_VISIBILITY map for pairsWith resolution }
   * @returns {{ ok: boolean, errors: string[], enriched: boolean }}
   */
  function validateModuleEntry(routeId, entry, opts) {
    opts = opts || {};
    var errors = [];

    if (!entry || typeof entry !== 'object') {
      return { ok: false, errors: ['entry must be an object'], enriched: false };
    }

    // ── Required fields ─────────────────────────────────────
    checkStringCap(errors, 'label', entry.label, CAPS.label);

    if (!isStr(entry.section)) {
      errors.push('section: required string');
    } else if (VALID_SECTIONS.indexOf(entry.section) === -1) {
      errors.push('section: "' + entry.section + '" is not a known section');
    }

    // tagline is required; allow legacy `desc` as alias for back-compat.
    var taglineValue = isStr(entry.tagline) ? entry.tagline
                     : (isStr(entry.desc) ? entry.desc : null);
    if (taglineValue === null) {
      errors.push('tagline: required string (or legacy `desc`)');
    } else if (taglineValue.length > CAPS.tagline) {
      errors.push('tagline: exceeds ' + CAPS.tagline + 'ch (got ' + taglineValue.length + ')');
    }

    // ── Enriched-card optionals — only validated when present ──
    // An entry counts as "enriched" if it has `outcome` AND at least one
    // of automates, prerequisites, pairsWith. Renderer gates "▾ Details"
    // on `outcome` presence.
    var hasOutcome = entry.outcome !== undefined;

    if (hasOutcome) checkStringCap(errors, 'outcome', entry.outcome, CAPS.outcome);
    if (entry.goodFitWhen !== undefined) checkStringCap(errors, 'goodFitWhen', entry.goodFitWhen, CAPS.goodFitWhen);
    if (entry.notAFitWhen !== undefined) checkStringCap(errors, 'notAFitWhen', entry.notAFitWhen, CAPS.notAFitWhen);

    if (entry.automates !== undefined) {
      checkStringList(errors, 'automates', entry.automates, 1, 4, CAPS.automatesEach);
    }
    if (entry.replacesTools !== undefined) {
      checkStringList(errors, 'replacesTools', entry.replacesTools, 0, 4, CAPS.listToolsEach);
    }
    if (entry.complementsTools !== undefined) {
      checkStringList(errors, 'complementsTools', entry.complementsTools, 0, 4, CAPS.listToolsEach);
    }
    if (entry.prerequisites !== undefined) {
      checkStringList(errors, 'prerequisites', entry.prerequisites, 0, 4, CAPS.prereqEach);
    }

    if (entry.pairsWith !== undefined) {
      checkStringList(errors, 'pairsWith', entry.pairsWith, 0, 6, 60);
      if (isArr(entry.pairsWith) && opts.routeRegistry) {
        for (var pi = 0; pi < entry.pairsWith.length; pi++) {
          var pid = entry.pairsWith[pi];
          if (typeof pid === 'string' && !Object.prototype.hasOwnProperty.call(opts.routeRegistry, pid)) {
            errors.push('pairsWith[' + pi + ']: "' + pid + '" does not resolve to a known route');
          }
        }
      }
    }

    if (entry.setupDepth !== undefined) {
      if (VALID_SETUP_DEPTH.indexOf(entry.setupDepth) === -1) {
        errors.push('setupDepth: must be one of ' + VALID_SETUP_DEPTH.join('|'));
      }
    }

    if (entry.preview !== undefined) {
      if (!entry.preview || typeof entry.preview !== 'object') {
        errors.push('preview: must be { url, alt }');
      } else {
        if (!isStr(entry.preview.url)) {
          errors.push('preview.url: required string');
        } else if (!ASSET_URL_RE.test(entry.preview.url)) {
          errors.push('preview.url: must match https://assets.runmast.com/modes/<routeId>.(png|jpg|jpeg|webp|gif)');
        }
        if (!isStr(entry.preview.alt)) {
          errors.push('preview.alt: required string for accessibility');
        } else if (entry.preview.alt.length > CAPS.previewAlt) {
          errors.push('preview.alt: exceeds ' + CAPS.previewAlt + 'ch');
        }
      }
    }

    if (entry.learnMoreUrl !== undefined) {
      if (!isStr(entry.learnMoreUrl)) {
        errors.push('learnMoreUrl: must be a string');
      } else if (/mast\.com/i.test(entry.learnMoreUrl) && !/runmast\.com/i.test(entry.learnMoreUrl)) {
        errors.push('learnMoreUrl: must use runmast.com, not mast.com');
      } else if (!HELP_URL_RE.test(entry.learnMoreUrl)) {
        errors.push('learnMoreUrl: must match https://help.runmast.com/#<routeId>');
      }
    }

    var enriched = hasOutcome && (
      entry.automates !== undefined ||
      entry.prerequisites !== undefined ||
      entry.pairsWith !== undefined
    );

    return { ok: errors.length === 0, errors: errors, enriched: enriched };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    validateModuleEntry: validateModuleEntry,
    CAPS: CAPS,
    VALID_SETUP_DEPTH: VALID_SETUP_DEPTH,
    VALID_SECTIONS: VALID_SECTIONS
  };
});
