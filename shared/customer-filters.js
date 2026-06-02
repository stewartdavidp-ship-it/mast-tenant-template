/**
 * Customer segment-filter predicate — the SINGLE canonical matcher.
 *
 * Background (review finding D4-005, cross-surface-dup): the same "does this
 * customer match this saved-segment filter?" logic had drifted across surfaces.
 * `customers.js` owns the authoritative `customerMatchesFilters`; the Customer
 * Service bulk-survey-send flow carried a hand-synced "minimal mirror"
 * (`csCustomerMatches`) that had silently fallen behind — it ignored the
 * `wholesale`, `search`, `newsletterOnly` and `leadsOnly` keys, each a NARROWING
 * constraint, so segments saved with those keys resolved a LARGER set and
 * surveys went to customers outside the intended segment.
 *
 * This module is that one predicate, shared by both surfaces so they cannot
 * drift again. (The MCP server's `matchesCustomerFilters` and newsletter.js's
 * `nlMatchSubscribersForSegment` are separate consumers of the same persisted
 * shape; unifying those is a coordinated cross-repo change tracked separately.)
 *
 * FILTER SHAPE NOTE — two shapes feed this predicate and BOTH are supported:
 *   - Live filter-bar DOM (customers.js list/export): spend as `minSpendDollars`.
 *   - Persisted saved segments (readFilterSnapshot → admin/customerSegments):
 *     spend as `minSpendCents`.
 * `minSpendCents` wins when present; otherwise `minSpendDollars` is parsed.
 * A naive shared extraction that read only one of these would silently break
 * the spend constraint on one surface — hence the explicit dual support.
 *
 * WHOLESALE NOTE — `f.wholesale` ('wholesale'|'retail') needs an email→account
 * lookup that lives outside the customer record (admin/wholesaleAuthorized).
 * Callers inject it via `opts.isWholesale(customer) => bool`. If a wholesale
 * filter is present but no resolver was supplied, the predicate FAILS SAFE
 * (excludes the customer) rather than silently over-including — never email a
 * survey to someone a wholesale/retail segment was meant to exclude.
 */
(function () {
  'use strict';

  // matches(customer, filters, opts) -> boolean
  //   opts.isWholesale     : (customer) => bool   — wholesale-account resolver.
  //   opts.excludeArchived : bool                 — when true, archived customers
  //                                                 are excluded unless the filter
  //                                                 sets includeArchived. (customers.js
  //                                                 list keeps archived visible, so it
  //                                                 leaves this false; the survey-send
  //                                                 flow sets it true.)
  function matches(c, f, opts) {
    f = f || {};
    opts = opts || {};
    if (!c) return false;

    if (c.status === 'merged') return false;
    if (opts.excludeArchived && c.status === 'archived' && !f.includeArchived) return false;

    if (f.source && f.source !== 'all' && c.source !== f.source) return false;

    if (f.wholesale === 'wholesale' || f.wholesale === 'retail') {
      // Fail safe: can't evaluate the wholesale boundary without a resolver —
      // exclude rather than over-include (the D4-005 bug class).
      if (typeof opts.isWholesale !== 'function') return false;
      var isW = !!opts.isWholesale(c);
      if (f.wholesale === 'wholesale' && !isW) return false;
      if (f.wholesale === 'retail' && isW) return false;
    }

    if (f.tag && (c.tags || []).indexOf(f.tag) === -1) return false;

    if (f.search) {
      var name = (c.displayName || '').toLowerCase();
      var email = (c.primaryEmail || '').toLowerCase();
      var emails = (c.emails || []).join(' ').toLowerCase();
      if (name.indexOf(f.search) === -1 && email.indexOf(f.search) === -1 && emails.indexOf(f.search) === -1) {
        return false;
      }
    }

    var stats = c.stats || {};

    if (f.lastOrderBefore) {
      // Inclusive of the chosen date — anything strictly after is excluded.
      var cutoff = f.lastOrderBefore + 'T23:59:59';
      if (!stats.lastOrderAt || stats.lastOrderAt > cutoff) return false;
    }

    // Spend floor — persisted (minSpendCents) wins, else live-DOM (minSpendDollars).
    var minCents = null;
    if (typeof f.minSpendCents === 'number') {
      minCents = f.minSpendCents;
    } else if (f.minSpendDollars !== '' && f.minSpendDollars != null) {
      var parsed = Math.round(parseFloat(f.minSpendDollars) * 100);
      if (!isNaN(parsed)) minCents = parsed;
    }
    if (minCents != null && (stats.lifetimeSpendCents || 0) < minCents) return false;

    // Orthogonal-signal toggles from the filter bar.
    if (f.newsletterOnly && !(c.marketing && c.marketing.newsletterOptIn)) return false;
    if (f.leadsOnly && (stats.orderCount || 0) > 0) return false;

    // Built-in segment flags (customers.js list only — not persisted to segments).
    if (f._newThisWeek) {
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      if (!c.createdAt || c.createdAt < weekAgo) return false;
    }
    if (f._noOrders && (stats.orderCount || 0) > 0) return false;
    if (f._lapseStatus) {
      var actual = stats.lapseStatus || 'unknown';
      if (actual !== f._lapseStatus) return false;
    }

    return true;
  }

  // Build an `isWholesale` resolver from a wholesale-authorized map, mirroring
  // customers.js: keys are Firebase-escaped emails (dots→commas) carrying a
  // `wholesaleAccountId`. Returns a (customer)=>bool closure.
  function makeWholesaleResolver(wholesaleAuthorized) {
    var emailMap = {};
    Object.keys(wholesaleAuthorized || {}).forEach(function (k) {
      var u = wholesaleAuthorized[k];
      if (u && u.wholesaleAccountId) {
        var email = k.replace(/,/g, '.').toLowerCase();
        if (email) emailMap[email] = u.wholesaleAccountId;
      }
    });
    return function isWholesale(c) {
      if (!c) return false;
      var candidates = [];
      if (c.primaryEmail) candidates.push(c.primaryEmail);
      if (Array.isArray(c.emails)) candidates = candidates.concat(c.emails);
      for (var i = 0; i < candidates.length; i++) {
        var e = (candidates[i] || '').toLowerCase().trim();
        if (e && emailMap[e]) return true;
      }
      return false;
    };
  }

  var api = { matches: matches, makeWholesaleResolver: makeWholesaleResolver };

  if (typeof window !== 'undefined') {
    window.MastCustomerFilters = api;
  }
  // CommonJS export for node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
