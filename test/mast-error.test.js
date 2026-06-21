/**
 * Tests for shared/mast-error.js — the diagnostics L1 scrubbing-capture core.
 *
 * The two load-bearing guarantees: (1) capture NEVER rethrows (it stands in for a
 * swallow — a throw would change control flow at every catch site), and (2) PII is
 * scrubbed before anything is ringed or forwarded to the persistence sink. Both pinned
 * here against the real module (vm sandbox; a fake `window` carries the late-bound sink).
 *
 * Run: node test/mast-error.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../shared/mast-error.js'), 'utf8');
const sandbox = { window: {}, Date }; // window = late-bound sink host; Date for _now()
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const ME = sandbox.MastError;
const rt = (x) => JSON.parse(JSON.stringify(x)); // normalize vm-realm objects before compare

function reset() { ME._reset(); sandbox.window.fireAutoReport = undefined; }

test('scrub: redacts emails, 7+ digit runs, URL query strings; length-bounds', () => {
  assert.strictEqual(ME.scrub('contact jane.doe@example.com now'), 'contact [email] now');
  assert.strictEqual(ME.scrub('card 4111111111111111 end'), 'card [num] end');
  assert.strictEqual(ME.scrub('order #12345 ok'), 'order #12345 ok'); // 5 digits — kept
  assert.strictEqual(ME.scrub('see https://x.co/p?token=abc&e=a@b.com'), 'see https://x.co/p?…');
  assert.ok(ME.scrub('x'.repeat(5000)).length <= 2001, 'length-bounded');
});

test('scrub (object): redacts PII-named keys, scrubs nested values, keeps safe keys + numbers', () => {
  const out = rt(ME.scrub({
    where: 'orders:load', recordId: 'abc123', count: 7,
    email: 'a@b.com', customerName: 'Jane Smith', apiKey: 'sk_live_x',
    nested: { note: 'call 5551234567', billingAddress: '1 Main St' }
  }));
  assert.strictEqual(out.where, 'orders:load');        // safe key kept verbatim
  assert.strictEqual(out.recordId, 'abc123');          // safe (id, not a digit run)
  assert.strictEqual(out.count, 7);                    // number passthrough
  assert.strictEqual(out.email, '[redacted]');         // PII key
  assert.strictEqual(out.customerName, '[redacted]');  // ends with "name"
  assert.strictEqual(out.apiKey, '[redacted]');        // ends with "key"
  assert.strictEqual(out.nested.note, 'call [num]');   // nested string value scrubbed
  assert.strictEqual(out.nested.billingAddress, '[redacted]'); // ends "address"
});

test('scrubReport: scrubs the existing sink report IN PLACE (desc/detail/userName + buffers)', () => {
  const report = {
    appId: 't1', userId: 'uid_xyz', userName: 'Jane <jane@x.com>',
    description: 'Error: failed for bob@y.com',
    detail: 'at https://api.co/v1?key=secret\nphone 5551239999',
    consoleBuffer: [{ t: 1, msg: 'leaked me@z.com' }],
    networkErrors: [{ t: 1, url: 'https://a.co/x?tok=1' }]
  };
  const r = ME.scrubReport(report);
  assert.strictEqual(r, report, 'mutates in place + returns it');
  assert.strictEqual(rt(r).userId, 'uid_xyz', 'opaque uid kept (pseudonymous, not an email/digit-run)');
  assert.match(r.userName, /\[email\]/);
  assert.match(r.description, /\[email\]/);
  assert.match(r.detail, /\?…/);     // url query stripped
  assert.match(r.detail, /\[num\]/); // phone digits redacted
  assert.strictEqual(rt(r).consoleBuffer[0].msg, 'leaked [email]');
  assert.match(rt(r).networkErrors[0].url, /\?…$/);
});

test('capture: never rethrows; rings a scrubbed record; forwards to the late-bound sink', () => {
  reset();
  const calls = [];
  sandbox.window.fireAutoReport = (type, msg, detail) => calls.push({ type, msg, detail });
  ME.capture(new Error('boom for x@y.com'), { where: 'orders:save', email: 'a@b.com' });
  const ring = rt(ME.recent());
  assert.strictEqual(ring.length, 1);
  assert.match(ring[0].message, /\[email\]/, 'ring message scrubbed');
  assert.strictEqual(ring[0].ctx.email, '[redacted]', 'ring ctx PII redacted');
  assert.strictEqual(ring[0].where, 'orders:save');
  assert.strictEqual(calls.length, 1, 'forwarded to sink');
  assert.match(calls[0].msg, /\[email\]/, 'sink message scrubbed too');
  assert.strictEqual(calls[0].type, 'handled:orders:save', 'type carries the site for per-site dedup');
});

test('capture: with NO sink bound, still rings + never throws (incl. a hostile error object)', () => {
  reset(); // fireAutoReport left undefined
  assert.doesNotThrow(() => ME.capture('plain string error', { where: 'boot' }));
  const hostile = {};
  Object.defineProperty(hostile, 'message', { get() { throw new Error('nope'); } });
  assert.doesNotThrow(() => ME.capture(hostile, { where: 'x' }), 'a throwing getter must not escape capture');
  assert.ok(ME.recent().length >= 1);
});

test('capture: null / odd inputs are safe', () => {
  reset();
  assert.doesNotThrow(() => ME.capture(null));
  assert.doesNotThrow(() => ME.capture(undefined, null));
  assert.doesNotThrow(() => ME.capture(42, 'not-an-object'));
});

test('breadcrumb: rings scrubbed crumbs; ring is capped', () => {
  reset();
  ME.breadcrumb('route', { to: 'orders', email: 'a@b.com' });
  const c = rt(ME.recentCrumbs());
  assert.strictEqual(c[0].kind, 'route');
  assert.strictEqual(c[0].data.email, '[redacted]');
  for (let i = 0; i < 80; i++) ME.breadcrumb('x', { i });
  assert.ok(ME.recentCrumbs().length <= 50, 'ring bounded at 50');
});

test('recent() returns a copy — a caller cannot mutate the internal ring', () => {
  reset();
  ME.capture(new Error('a'), { where: 'w' });
  const snap = ME.recent();
  snap.push('junk');
  assert.strictEqual(ME.recent().length, 1, 'internal ring unaffected by caller mutation');
});
