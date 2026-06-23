/**
 * mast-format.js — the centralized money/date formatter core (Track 5).
 *
 * Background (decomposition-master-plan.md §7, Track 5): the canonical money and
 * date formatters today live inside the MastUI *UI engine* (shared/mast-ui.js →
 * `MastUI.Num`) and are only reachable as `MastUI.Num.*` in the browser. That
 * coupling is why modules keep hand-rolling their own `dateStr()` / cents-vs-
 * dollars coercion — and why the recurring "$1,020 line renders as $102,000" and
 * "createdAt is a Firestore Timestamp object" bug classes keep re-appearing.
 *
 * This module is a small, pure, dependency-free home for those formatters so any
 * module (UI or not) can depend on them without pulling in the UI engine. The
 * money/date logic is COPIED VERBATIM from `MastUI.Num` (the characterization
 * goldens in test/format-goldens.test.js pin that behavior), with these intended
 * additions:
 *   - `coerceDate(tsOrStr)` — the Firestore-Timestamp defuser that closes the
 *     goldens-pinned gap where `date(<Timestamp object>)` returned '' today.
 *     `date()` / `dateRaw()` route through `coerceDate`, so a Timestamp now renders.
 *   - `dateShort()` / `dateLong()` — no-year ("Jun 1") and long-month-with-year
 *     ("June 30, 2026") variants that SHARE date()'s calendar-date local-midnight
 *     handling, so modules can drop their own off-by-one `toLocaleDateString` calls
 *     (the same UTC-midnight-renders-a-day-early bug, in date-only labels + emails).
 *
 * Adoption (repointing modules off `MastUI.Num` onto `MastFormat`) is a separate
 * later step — this module just lands the standalone core + tests.
 *
 * Exposes window.MastFormat (browser) + module.exports (node tests), exactly like
 * the other shared/*.js cores. Vanilla ES5-ish (var/IIFE), no dependencies.
 */
(function () {
  'use strict';

  var _nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── coerceDate — the Firestore-Timestamp defuser (NEW; closes the goldens gap) ─
  // Normalize the several shapes a stored date arrives in to a JS Date, or null:
  //   - a Date            → itself (when valid)
  //   - an ISO/date string→ parsed (caller-side; date() keeps the calendar-midnight
  //                         handling itself, so coerceDate just hands strings back
  //                         as-is for the formatters to parse)
  //   - {seconds,nanoseconds} Firestore Timestamp → epoch-seconds(+nanos) → Date
  //   - an object with a .toDate() method (Firestore Timestamp class) → .toDate()
  // Returns null for anything it cannot normalize (so callers render an em-dash,
  // never the Unix epoch). Strings are returned UNCHANGED so the calendar-date
  // (local-midnight) handling in date()/dateRaw() still applies to them.
  function coerceDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    // Firestore Timestamp class instance → its own canonical conversion.
    if (typeof v.toDate === 'function') {
      try {
        var td = v.toDate();
        return (td instanceof Date && !isNaN(td.getTime())) ? td : null;
      } catch (e) { return null; }
    }
    // Raw {seconds, nanoseconds} (a Timestamp that crossed JSON / RTDB and lost
    // its prototype) — the common "createdAt is a plain object" shape.
    if (typeof v.seconds === 'number' && !isNaN(v.seconds)) {
      var ms = v.seconds * 1000 + (typeof v.nanoseconds === 'number' ? Math.floor(v.nanoseconds / 1e6) : 0);
      var d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    // A raw epoch number — treated as MILLISECONDS, matching the original
    // MastUI.Num.date(`new Date(d)`) behavior (faithful drop-in; without this a
    // numeric timestamp would regress to '').
    if (typeof v === 'number' && isFinite(v)) {
      var dn = new Date(v);
      return isNaN(dn.getTime()) ? null : dn;
    }
    // Strings flow straight through (date()/dateRaw() own calendar-date parsing).
    if (typeof v === 'string') return v;
    return null;
  }

  // money display: (102000) -> "$102,000.00"; opts.cents:true treats input as integer cents
  function money(n, opts) {
    if (n == null || isNaN(n)) return '';
    opts = opts || {};
    var v = opts.cents ? n / 100 : n;
    return '$' + _nf2.format(v);
  }

  // money raw for export: -> "102000.00" (no symbol/separators)
  function moneyRaw(n, opts) {
    if (n == null || isNaN(n)) return '';
    var v = (opts && opts.cents) ? n / 100 : n;
    return v.toFixed(2);
  }

  // Canonical dollar amount from a record that stores EITHER integer cents
  // (centsField) OR a dollar number (dollarField). Cents wins when present +
  // numeric; else the dollar field; else null.
  function moneyVal(rec, centsField, dollarField) {
    if (!rec) return null;
    var c = centsField ? rec[centsField] : undefined;
    if (c != null && c !== '' && !isNaN(c)) return Number(c) / 100;
    var d = dollarField ? rec[dollarField] : undefined;
    if (d != null && d !== '' && !isNaN(d)) return Number(d);
    return null;
  }

  // Canonical LINE-ITEM total in DOLLARS — cents-explicit fields win:
  //   lineTotal (cents) → priceCents×qty (cents) → total (dollars) → price×qty
  //   (dollars, per-unit on an order line). qty = quantity ?? qty ?? 1.
  // Reading any single field raw miscounts (the "$1,020 line → $102,000" class).
  function lineTotalVal(it) {
    if (!it) return null;
    var qty = (it.quantity != null && !isNaN(it.quantity)) ? Number(it.quantity)
      : (it.qty != null && !isNaN(it.qty)) ? Number(it.qty) : 1;
    if (it.lineTotal != null && it.lineTotal !== '' && !isNaN(it.lineTotal)) return Number(it.lineTotal) / 100;
    if (it.priceCents != null && it.priceCents !== '' && !isNaN(it.priceCents)) return Number(it.priceCents) * qty / 100;
    if (it.total != null && it.total !== '' && !isNaN(it.total)) return Number(it.total);
    if (it.price != null && it.price !== '' && !isNaN(it.price)) return Number(it.price) * qty;
    return null;
  }

  // ── _toLocalDate — calendar-aware coercion to a JS Date (SHARED by all the date
  // formatters below, so they apply the off-by-one fix identically). Routes through
  // coerceDate so a Firestore Timestamp (raw {seconds,nanoseconds} or .toDate())
  // resolves instead of failing. Returns null for anything unparseable (callers
  // render '' / an em-dash, never the Unix epoch or "Invalid Date").
  function _toLocalDate(d) {
    var c = coerceDate(d);
    if (c == null) return null;
    var dt, m;
    if (c instanceof Date) {
      dt = c;
    } else if (typeof c === 'string' && (m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00(?::00)?(?:\.000)?Z?)?$/.exec(c))) {
      // A bare calendar date ('2026-06-07') OR a date stored as midnight-UTC
      // ('2026-06-07T00:00:00.000Z') represents a CALENDAR date. Build it as LOCAL
      // midnight so it renders the same day in behind-UTC timezones. Strings with a
      // real time component fall through to native (local) parsing, unchanged.
      dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      dt = new Date(c);
    }
    return isNaN(dt.getTime()) ? null : dt;
  }

  // date display: ISO/Date/Timestamp -> "May 1, 2026" (short month, WITH year).
  function date(d) {
    var dt = _toLocalDate(d);
    return dt == null ? '' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // dateShort: ISO/Date/Timestamp -> "Jun 1" (short month, NO year). Same calendar-
  // date local-midnight handling as date(); for compact range labels ("Jun 1 – Jun 30").
  function dateShort(d) {
    var dt = _toLocalDate(d);
    return dt == null ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // dateLong: ISO/Date/Timestamp -> "June 30, 2026" (LONG month, WITH year). Same
  // calendar-date local-midnight handling as date(); for prose like reminder emails,
  // where rendering a day early is customer-visible.
  function dateLong(d) {
    var dt = _toLocalDate(d);
    return dt == null ? '' : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // dateRaw: ISO/Date/Timestamp -> "2026-05-01" (canonical for files/export).
  function dateRaw(d) {
    var c = coerceDate(d);
    if (c == null) return '';
    var dt = (c instanceof Date) ? c : new Date(c);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  }

  // ── _toInstant — coerce to a JS Date for the TIME-bearing formatters. Unlike
  // _toLocalDate (which rewrites a bare calendar date to LOCAL midnight for the
  // off-by-one fix), the datetime/time renderers want the actual instant, so a
  // string flows through native (local) parsing. Routes through coerceDate, so a
  // Firestore Timestamp (raw {seconds,nanoseconds} or .toDate()) resolves instead
  // of throwing — the recurring "toLocaleString on a Timestamp object" crash class.
  function _toInstant(d) {
    var c = coerceDate(d);
    if (c == null) return null;
    var dt = (c instanceof Date) ? c : new Date(c);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // dateTime: ISO/Date/Timestamp -> "Jun 23, 2026, 3:45 PM" (date() format + 12h
  // wall-clock time). Timestamp-safe via coerceDate. For audit/event timestamps
  // and any "when did this happen" readout where the time of day matters; the
  // centralized, crash-proof replacement for hand-rolled `.toLocaleString()`.
  function dateTime(d) {
    var dt = _toInstant(d);
    return dt == null ? '' : dt.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  // time: ISO/Date/Timestamp -> "3:45 PM" (12h wall-clock, no date). Timestamp-safe.
  // The centralized replacement for hand-rolled `.toLocaleTimeString()`.
  function time(d) {
    var dt = _toInstant(d);
    return dt == null ? '' : dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ── Day math — the centralized replacement for the `/ 86400000` magic number
  // copy-pasted ~80× (idle-days, age-days, days-overdue, expiry windows). Raw
  // `(Date.now() - ms) / 86400000` is DST-fragile (a spring-forward day is 23h, so
  // a true 24h span rounds down) and Timestamp-unsafe. These compute CALENDAR-day
  // differences off local-midnight-normalized dates, so "days between Mar 8 and
  // Mar 9" is 1 across a DST boundary, not 0.96.
  var MS_PER_DAY = 86400000;

  // Local-midnight floor of any date-ish input (shares date()'s calendar handling).
  function _midnight(d) {
    var dt = _toLocalDate(d);
    if (dt == null) return null;
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  // daysBetween(from, to) -> signed whole CALENDAR days from `from` to `to`
  // (to - from). Positive = `to` is later. null if either side is unparseable.
  // Rounding absorbs the ±1h DST drift between the two local midnights.
  function daysBetween(from, to) {
    var a = _midnight(from), b = _midnight(to);
    if (a == null || b == null) return null;
    return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
  }

  // daysSince(d) -> whole calendar days from d until today (>=0 for past dates).
  function daysSince(d) { return daysBetween(d, new Date()); }
  // daysUntil(d) -> whole calendar days from today until d (>=0 for future dates).
  function daysUntil(d) { return daysBetween(new Date(), d); }

  // addDays(d, n) -> a new Date n calendar days after d (n may be negative). Built
  // on local date parts (not raw ms) so it stays on the same wall-clock across DST.
  // Routes through _toLocalDate so a bare calendar string ('2026-06-07') advances by
  // calendar day (not a UTC-midnight instant); a Date/timestamp keeps its time of
  // day. Returns null if d is unparseable. Pair with dateRaw()/date() to render.
  function addDays(d, n) {
    var dt = _toLocalDate(d);
    if (dt == null) return null;
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + (Number(n) || 0),
      dt.getHours(), dt.getMinutes(), dt.getSeconds(), dt.getMilliseconds());
  }

  // relative(d[, opts]) -> human calendar-relative label vs now: "today",
  // "yesterday", "tomorrow", "3 days ago", "in 2 days". Beyond +/-opts.maxDays
  // (default 30) it falls back to date() ("Jun 7, 2026") so distant dates stay
  // legible. '' for null/garbage. The centralized replacement for hand-rolled
  // "<n> day<s> ago" / "in <n> days" strings.
  function relative(d, opts) {
    var n = daysUntil(d);
    if (n == null) return '';
    var maxDays = (opts && opts.maxDays != null) ? opts.maxDays : 30;
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (Math.abs(n) > maxDays) return date(d);
    return n > 0 ? ('in ' + n + ' days') : (Math.abs(n) + ' days ago');
  }

  var api = {
    money: money,
    moneyRaw: moneyRaw,
    moneyVal: moneyVal,
    lineTotalVal: lineTotalVal,
    date: date,
    dateShort: dateShort,
    dateLong: dateLong,
    dateRaw: dateRaw,
    dateTime: dateTime,
    time: time,
    daysBetween: daysBetween,
    daysSince: daysSince,
    daysUntil: daysUntil,
    addDays: addDays,
    relative: relative,
    MS_PER_DAY: MS_PER_DAY,
    coerceDate: coerceDate
  };

  if (typeof window !== 'undefined') {
    window.MastFormat = api;
  }
  // CommonJS export for node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
