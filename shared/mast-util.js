/**
 * mast-util.js — small, pure, dependency-free cross-cutting utilities that don't
 * belong to a domain engine (format/ui/io/export/sanitize/entity/db). The home for
 * the micro-helpers that were otherwise copy-pasted inline dozens of times.
 *
 * Currently:
 *   - genId(prefix)  — short, time-sortable unique id (record keys, DOM ids)
 *   - slugify(str)   — lowercase hyphen slug ([a-z0-9-], trimmed, de-duped)
 *
 * Exposes window.MastUtil (browser) + module.exports (node tests), exactly like
 * the other shared/*.js cores. Vanilla ES5-ish (var/IIFE), no dependencies.
 */
(function () {
  'use strict';

  // genId([prefix]) -> "<prefix><base36-ms>_<8 random base36 chars>". Centralizes
  // the ~30 hand-rolled `prefix + Date.now() + '_' + Math.random().toString(36)
  // .slice(2,N)` idioms (which vary: raw-ms vs base36, 5-8 random chars). The
  // base36 timestamp keeps ids roughly time-sortable; ~41 bits of randomness make
  // a within-millisecond collision vanishingly unlikely. The prefix is used
  // VERBATIM (callers pass their own trailing separator, e.g. 'cert_').
  function genId(prefix) {
    var rand = Math.random().toString(36).slice(2, 10);
    return (prefix == null ? '' : String(prefix)) + Date.now().toString(36) + '_' + rand;
  }

  // slugify(str) -> lowercase, hyphen-separated, [a-z0-9-] only, with no leading/
  // trailing or repeated hyphens. The one true version of the ~8 hand-rolled
  // `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')` chains.
  // Non-alphanumerics (incl. accented letters) collapse to a single '-'; '' for
  // null/garbage. ASCII-only by design, matching the idiom it replaces.
  function slugify(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  var api = { genId: genId, slugify: slugify };

  if (typeof window !== 'undefined') {
    window.MastUtil = api;
  }
  // CommonJS export for node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
