/**
 * Regression tests for shared/customer-filters.js — the single canonical
 * customer segment-filter predicate.
 *
 * Context (review finding D4-005): the Customer Service survey bulk-send flow
 * (customer-service.js `csCustomerMatches`) used a hand-synced "minimal mirror"
 * of customers.js' `customerMatchesFilters`. The mirror had DRIFTED — it
 * handled none of the `wholesale`, `search`, `newsletterOnly`, `leadsOnly`
 * persisted-segment keys, each a NARROWING constraint, so a segment saved with
 * any of them resolved a LARGER set and surveys were emailed to customers
 * OUTSIDE the intended segment.
 *
 * The fix replaced both copies with this shared predicate. These tests pin the
 * four previously-dropped keys (so the over-inclusion can't come back), the
 * dual minSpend shape (minSpendCents persisted vs minSpendDollars live-DOM),
 * and the wholesale fail-safe.
 *
 * Run: node test/customer-filters.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { matches, makeWholesaleResolver } = require('../shared/customer-filters.js');

// ── Fixtures ───────────────────────────────────────────────────────────────
const buyerOptedIn = {
  id: 'c1', displayName: 'Alice Buyer', primaryEmail: 'alice@example.com',
  source: 'order', tags: ['vip'],
  marketing: { newsletterOptIn: true },
  stats: { orderCount: 4, lifetimeSpendCents: 12000, lastOrderAt: '2026-01-10T00:00:00Z' }
};
const leadNoOptIn = {
  id: 'c2', displayName: 'Bob Lead', primaryEmail: 'bob@example.com',
  source: 'newsletter', tags: [],
  marketing: { newsletterOptIn: false },
  stats: { orderCount: 0, lifetimeSpendCents: 0 }
};
const wholesaleAcct = {
  id: 'c3', displayName: 'Carol Wholesale', primaryEmail: 'carol@shop.com',
  emails: ['carol@shop.com'], source: 'order',
  marketing: { newsletterOptIn: true },
  stats: { orderCount: 9, lifetimeSpendCents: 250000 }
};

// admin/wholesaleAuthorized is keyed by Firebase-escaped email (dots→commas).
const wholesaleAuthorized = { 'carol@shop,com': { wholesaleAccountId: 'WS-1' } };
const isWholesale = makeWholesaleResolver(wholesaleAuthorized);

// ── The four keys that had drifted (the D4-005 over-inclusion) ───────────────

test('newsletterOnly excludes a non-opted-in customer (was wrongly included)', () => {
  assert.strictEqual(matches(buyerOptedIn, { newsletterOnly: true }, {}), true);
  assert.strictEqual(matches(leadNoOptIn, { newsletterOnly: true }, {}), false,
    'a newsletter-only segment must NOT email customers who never opted in');
});

test('leadsOnly excludes customers with orders (was wrongly included)', () => {
  assert.strictEqual(matches(leadNoOptIn, { leadsOnly: true }, {}), true);
  assert.strictEqual(matches(buyerOptedIn, { leadsOnly: true }, {}), false);
});

test('search narrows by name/email substring (was ignored)', () => {
  assert.strictEqual(matches(buyerOptedIn, { search: 'alice' }, {}), true);
  assert.strictEqual(matches(buyerOptedIn, { search: 'zzz' }, {}), false);
});

test('wholesale/retail honored when a resolver is injected (was ignored)', () => {
  assert.strictEqual(matches(wholesaleAcct, { wholesale: 'wholesale' }, { isWholesale }), true);
  assert.strictEqual(matches(buyerOptedIn,  { wholesale: 'wholesale' }, { isWholesale }), false);
  assert.strictEqual(matches(buyerOptedIn,  { wholesale: 'retail' },    { isWholesale }), true);
  assert.strictEqual(matches(wholesaleAcct, { wholesale: 'retail' },    { isWholesale }), false);
});

test('wholesale fails SAFE (excludes) when no resolver is available', () => {
  // Better to email nobody than to email the wrong set — never over-include.
  assert.strictEqual(matches(wholesaleAcct, { wholesale: 'wholesale' }, {}), false);
  assert.strictEqual(matches(buyerOptedIn,  { wholesale: 'retail' },    {}), false);
});

// ── minSpend dual shape (the data-shape landmine a naive extraction would hit)─

test('minSpendCents (persisted segment shape) applies a cents floor', () => {
  assert.strictEqual(matches(buyerOptedIn, { minSpendCents: 10000 }, {}), true);  // 12000 >= 10000
  assert.strictEqual(matches(buyerOptedIn, { minSpendCents: 15000 }, {}), false); // 12000 < 15000
});

test('minSpendDollars (live filter-bar shape) applies the same floor', () => {
  assert.strictEqual(matches(buyerOptedIn, { minSpendDollars: '100' }, {}), true);  // $100 = 10000c
  assert.strictEqual(matches(buyerOptedIn, { minSpendDollars: '150' }, {}), false); // $150 = 15000c
});

test('minSpendCents wins over minSpendDollars when both present', () => {
  // 12000c passes the 10000c floor regardless of the dollars field.
  assert.strictEqual(matches(buyerOptedIn, { minSpendCents: 10000, minSpendDollars: '999' }, {}), true);
});

// ── Keys that already worked must be unchanged ───────────────────────────────

test('source / tag / lastOrderBefore unchanged', () => {
  assert.strictEqual(matches(buyerOptedIn, { source: 'order' }, {}), true);
  assert.strictEqual(matches(buyerOptedIn, { source: 'newsletter' }, {}), false);
  assert.strictEqual(matches(buyerOptedIn, { tag: 'vip' }, {}), true);
  assert.strictEqual(matches(buyerOptedIn, { tag: 'nope' }, {}), false);
  assert.strictEqual(matches(buyerOptedIn, { lastOrderBefore: '2026-02-01' }, {}), true);
  assert.strictEqual(matches(buyerOptedIn, { lastOrderBefore: '2026-01-01' }, {}), false);
});

// ── merged / archived status handling ────────────────────────────────────────

test('merged customers are always excluded', () => {
  const merged = Object.assign({}, buyerOptedIn, { status: 'merged' });
  assert.strictEqual(matches(merged, {}, {}), false);
  assert.strictEqual(matches(merged, {}, { excludeArchived: true }), false);
});

test('archived excluded only when excludeArchived is set (survey flow) — list keeps them', () => {
  const archived = Object.assign({}, buyerOptedIn, { status: 'archived' });
  // customers.js list path (no excludeArchived) keeps archived visible:
  assert.strictEqual(matches(archived, {}, {}), true);
  // survey-send path excludes them:
  assert.strictEqual(matches(archived, {}, { excludeArchived: true }), false);
  // ...unless the filter explicitly opts archived back in:
  assert.strictEqual(matches(archived, { includeArchived: true }, { excludeArchived: true }), true);
});

// ── End-to-end recipient-set check on a realistic segment ────────────────────

test('a "newsletter opt-ins" segment resolves only opted-in members', () => {
  const roster = [buyerOptedIn, leadNoOptIn, wholesaleAcct];
  const seg = { newsletterOnly: true };
  const recipients = roster.filter(c => matches(c, seg, { isWholesale, excludeArchived: true })).map(c => c.id);
  // leadNoOptIn (opt-in false) is correctly dropped; the drifted mirror would have kept it.
  assert.deepStrictEqual(recipients, ['c1', 'c3']);
});

console.log('customer-filters: all assertions passed');
