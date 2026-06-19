/**
 * lazy-cdn.js — on-first-use loaders for the heavy import/export CDN libs (Track 3).
 *
 * Background (decomposition-master-plan.md §5, Track 3): `papaparse@5` and
 * `xlsx@0.18.5` (SheetJS) used to be eager render-blocking <script> tags in
 * app/index.html's <head>, loaded on EVERY admin boot — but they are only needed
 * on import/export code paths (a small minority of sessions), and xlsx@0.18.5 in
 * particular carries known CVEs. This tiny eager core replaces those two head tags
 * with promise-returning loaders that inject the CDN <script> on first call and
 * resolve once `window.Papa` / `window.XLSX` is available.
 *
 * Contract:
 *   - ensurePapa()  → Promise that resolves with window.Papa  (CSV parse + unparse)
 *   - ensureXlsx()  → Promise that resolves with window.XLSX   (SheetJS, .xlsx/.xls)
 * Both are idempotent: if the global is already present they resolve immediately;
 * concurrent callers share a single in-flight <script> injection.
 *
 * Vanilla ES5-ish (var/IIFE), no dependencies. Exposes window.ensurePapa /
 * window.ensureXlsx (and window.MastLazyCdn for namespaced access).
 */
(function () {
  'use strict';

  var PAPA_SRC = 'https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js';
  var XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  // Cache the in-flight/resolved promise per library so concurrent callers and
  // repeat calls share one injection.
  var loaders = {};

  function injectScript(key, src, globalName) {
    if (loaders[key]) return loaders[key];
    loaders[key] = new Promise(function (resolve, reject) {
      // Already present (e.g. a prior boot left it, or another loader injected it).
      if (typeof window !== 'undefined' && window[globalName]) { resolve(window[globalName]); return; }
      var existing = document.querySelector('script[data-lazy-cdn="' + key + '"]');
      var s = existing || document.createElement('script');
      s.setAttribute('data-lazy-cdn', key);
      s.onload = function () { resolve(window[globalName]); };
      s.onerror = function () {
        // Allow a later retry by clearing the cached rejected promise.
        loaders[key] = null;
        reject(new Error('Failed to load ' + globalName + ' from ' + src));
      };
      if (!existing) {
        s.src = src;
        document.head.appendChild(s);
      }
    });
    return loaders[key];
  }

  function ensurePapa() { return injectScript('papa', PAPA_SRC, 'Papa'); }
  function ensureXlsx() { return injectScript('xlsx', XLSX_SRC, 'XLSX'); }

  var api = { ensurePapa: ensurePapa, ensureXlsx: ensureXlsx };

  if (typeof window !== 'undefined') {
    window.ensurePapa = ensurePapa;
    window.ensureXlsx = ensureXlsx;
    window.MastLazyCdn = api;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
