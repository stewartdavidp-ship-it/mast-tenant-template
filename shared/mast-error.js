/* MastError — diagnostics L1: scrubbing capture core.
 *
 * The app already has an auto-report sink (window.onerror / unhandledrejection →
 * fireAutoReport → feedbackReports/). What it lacked, until this module:
 *   1. an explicit capture API — so a HANDLED-but-swallowed error (the ~470 silent
 *      `catch (e) {}` sites) can be made visible without changing whether it's fatal;
 *   2. PII scrubbing — the sink persisted emails / long digit runs / URL query
 *      strings raw. Scrub is built in here and ALSO applied to the existing sink's
 *      report (see scrubReport), retro-fixing that leak.
 *
 * Design (see docs/diagnostics/diagnostics-plan.md §5 L1):
 *   - MastError.capture(err, ctx)  — scrub, push to an in-memory ring, forward to the
 *       existing sink (late-bound window.fireAutoReport). NEVER rethrows — drop-in for
 *       `catch (e) { MastError.capture(e, {where:'…'}); }`.
 *   - MastError.scrub(v)           — pure scrubber (string or object); the testable core.
 *   - MastError.scrubReport(rep)   — scrub the existing sink's report object in place.
 *   - MastError.breadcrumb(k, d)   — scrubbed trail ring (L2/L3 consume it).
 *   - MastError.recent()/recentCrumbs() — ring snapshots for the L3 self-diagnosis surface.
 *
 * Loaded as the FIRST eager <script> in index.html <head> so engines that load before
 * the sink (mastdb.js et al.) can already call capture; persistence late-binds once
 * fireAutoReport exists (the first few ms are still covered by window.onerror).
 *
 * Classic-script-safe ES5 IIFE (no import/export). Assigns window.MastError.
 */
(function (root) {
  'use strict';

  var RING_CAP = 50;     // captures kept in memory for the L3 surface
  var MAX_STR = 2000;    // length bound on any scrubbed string
  var MAX_DEPTH = 4;     // object-scrub recursion bound (cycle/runaway guard)

  // --- scrub primitives -----------------------------------------------------
  // Value-level: the primary defense — catches PII regardless of the key it sits under.
  var EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  var DIGITS_RE = /\d{7,}/g;                                   // card/account/phone/SSN-like runs
  var URLQ_RE = /(https?:\/\/[^\s)"'<>]+?)[?#][^\s)"'<>]*/gi;  // strip query/fragment (may carry tokens)
  // Key-level backstop: redact a value whose KEY names PII (catches plain names the
  // value regexes can't). Conservative by design — over-redaction is the safe failure.
  var PII_SUB = /(email|phone|ssn|secret|token|password|apikey|accountnumber|cardnumber|taxid)/i;
  var PII_END = /(name|address|key)$/i;

  function _isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function _isPiiKey(k) { return !!k && (PII_SUB.test(k) || PII_END.test(k)); }

  function _scrubStr(s) {
    if (s == null) return s;
    s = String(s);
    s = s.replace(URLQ_RE, '$1?…'); // before the digit pass (preserve URL shape)
    s = s.replace(EMAIL_RE, '[email]');
    s = s.replace(DIGITS_RE, '[num]');
    if (s.length > MAX_STR) s = s.slice(0, MAX_STR) + '…';
    return s;
  }

  function _scrubVal(v, depth) {
    if (typeof v === 'string') return _scrubStr(v);
    if (v && typeof v === 'object') return _scrubObj(v, depth || 0);
    return v; // number / boolean / null / undefined pass through
  }

  function _scrubObj(o, depth) {
    if (o == null || typeof o !== 'object') return _scrubVal(o, depth);
    if (depth > MAX_DEPTH) return '[deep]';
    var i, k, out;
    if (_isArray(o)) {
      out = [];
      for (i = 0; i < o.length && i < RING_CAP; i++) out.push(_scrubVal(o[i], depth + 1));
      return out;
    }
    out = {};
    for (k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      out[k] = _isPiiKey(k) ? '[redacted]' : _scrubVal(o[k], depth + 1);
    }
    return out;
  }

  // --- helpers --------------------------------------------------------------
  function _now() { return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0; }
  function _errMessage(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (err.message != null) return String(err.message);
    try { return String(err); } catch (e) { return '[unstringifiable error]'; }
  }
  function _errStack(err) { return (err && err.stack != null) ? String(err.stack) : ''; }
  function _safeJson(o) { try { return JSON.stringify(o); } catch (e) { return ''; } }
  function _push(ring, item, cap) { ring.push(item); while (ring.length > cap) ring.shift(); }

  var _ring = [];   // recent captures
  var _crumbs = []; // recent breadcrumbs

  // --- public API -----------------------------------------------------------
  // Scrub a string or (recursively) an object. The testable core.
  function scrub(v) { return _scrubVal(v, 0); }

  // Scrub the existing sink's report object IN PLACE (description/detail/userName +
  // the trailing breadcrumb buffers). Called from _submitAutoReport before the push.
  function scrubReport(report) {
    if (!report || typeof report !== 'object') return report;
    try {
      if (report.description != null) report.description = _scrubStr(report.description);
      if (report.detail != null) report.detail = _scrubStr(report.detail);
      if (report.userName != null) report.userName = _scrubStr(report.userName);
      if (_isArray(report.consoleBuffer)) report.consoleBuffer = _scrubVal(report.consoleBuffer, 0);
      if (_isArray(report.toastBuffer)) report.toastBuffer = _scrubVal(report.toastBuffer, 0);
      if (_isArray(report.networkErrors)) report.networkErrors = _scrubVal(report.networkErrors, 0);
    } catch (e) { /* scrub must never break the report */ }
    return report;
  }

  // Capture a handled error. NEVER rethrows — safe inside any catch block.
  function capture(err, ctx) {
    try {
      ctx = (ctx && typeof ctx === 'object') ? ctx : {};
      var where = String(ctx.where || ctx.module || '');
      var rec = {
        t: _now(),
        where: _scrubStr(where),
        message: _scrubStr(_errMessage(err)),
        stack: _scrubStr(_errStack(err)),
        ctx: _scrubObj(ctx, 0)
      };
      _push(_ring, rec, RING_CAP);
      var w = (typeof window !== 'undefined') ? window : null;
      if (w && typeof w.fireAutoReport === 'function') {
        var detail = (rec.stack || '') + (rec.ctx ? ('\nctx: ' + _safeJson(rec.ctx)) : '');
        try { w.fireAutoReport('handled:' + (rec.where || '?'), rec.message, detail); } catch (e2) { /* sink failure is non-fatal */ }
      }
    } catch (e) { /* capture must NEVER throw — it stands in for a swallow */ }
  }

  // Record a scrubbed breadcrumb (route nav, user action, …) for the trail ring.
  function breadcrumb(kind, data) {
    try { _push(_crumbs, { t: _now(), kind: String(kind || ''), data: _scrubVal(data, 0) }, RING_CAP); } catch (e) {}
  }

  function recent() { return _ring.slice(); }
  function recentCrumbs() { return _crumbs.slice(); }
  function _reset() { _ring.length = 0; _crumbs.length = 0; } // test hook

  root.MastError = {
    capture: capture,
    breadcrumb: breadcrumb,
    scrub: scrub,
    scrubReport: scrubReport,
    recent: recent,
    recentCrumbs: recentCrumbs,
    _reset: _reset
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
