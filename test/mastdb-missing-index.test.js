/**
 * Regression test for MastDB._fsGet missing-composite-index handling.
 *
 * Context: _fsGet (shared/mastdb.js) is the universal one-shot READ chokepoint —
 * get / list / query().once() all route through it. It retried `unavailable`
 * (transient cold-start) errors up to 3× with [500,1500,3000]ms backoff. The bug:
 * it also lumped `failed-precondition` into that retry branch — but a missing
 * composite index is PERMANENT, so a missing-index read burned ~5s of pointless
 * backoff and then threw the error with its "create it here:
 * https://console.firebase.google.com/…" URL buried and never surfaced.
 *
 * The fix: a missing-index `failed-precondition` (identified by the console.firebase
 * URL in the message) is rethrown IMMEDIATELY — no retry — with the create-index
 * URL logged via console.error. Other `failed-precondition` causes (no URL) and
 * `unavailable` still retry, unchanged.
 *
 * This pins (1) missing index → exactly ONE read + URL surfaced (no 5s stall), and
 * (2) transient unavailable → still retries (the retry path is intact).
 *
 * Run: node test/mastdb-missing-index.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the real shared/mastdb.js against a fake Firestore whose every ref.get()
// rejects with `rejectErr`, counting the calls. setTimeout is made instant so the
// retry path resolves synchronously (no real 5s wait in the transient test).
function makeRejectingHarness(rejectErr) {
  let getCalls = 0;
  const errors = [];
  function mkRef(p) {
    return {
      path: p,
      get: function () { getCalls++; return Promise.reject(rejectErr); },
      doc: function (d) { return mkRef(p + '/' + d); },
      collection: function (c) { return mkRef(p + '/' + c); },
      where: function () { return mkRef(p); },
      orderBy: function () { return mkRef(p); },
      limit: function () { return mkRef(p); }
    };
  }
  const fakeFs = { doc: function (p) { return mkRef(p); }, collection: function (p) { return mkRef(p); } };
  const firebase = {
    firestore: Object.assign(function () { return fakeFs; }, {
      FieldValue: { increment: function (n) { return { __increment: n }; }, serverTimestamp: function () { return { __ts: 1 }; }, delete: function () { return { __del: 1 }; } },
      FieldPath: function () {}
    })
  };
  const src = fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8');
  const sandboxConsole = Object.assign({}, console, {
    error: function () { errors.push(Array.prototype.join.call(arguments, ' ')); }
  });
  const sandbox = {
    firebase: firebase, window: {}, console: sandboxConsole, Promise: Promise,
    setTimeout: function (fn) { fn(); return 0; }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });
  return { MastDB: MastDB, getCalls: function () { return getCalls; }, errors: errors };
}

const INDEX_URL = 'https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=ClBwcm9q';

test('missing-index failed-precondition: ONE read (no 5s retry stall) + surfaces the create-index URL', async () => {
  const err = { code: 'failed-precondition', message: 'The query requires an index. You can create it here: ' + INDEX_URL };
  const h = makeRejectingHarness(err);
  await assert.rejects(function () { return h.MastDB.get('admin/settings'); });
  assert.strictEqual(h.getCalls(), 1, 'missing index must NOT retry — expected 1 read, got ' + h.getCalls());
  assert.ok(
    h.errors.some(function (e) { return e.indexOf('console.firebase.google.com') !== -1 && e.indexOf('create_composite') !== -1; }),
    'must console.error the create-index URL; captured: ' + JSON.stringify(h.errors)
  );
});

test('transient unavailable: still retries 3× (4 total reads) — the retry path is intact', async () => {
  const err = { code: 'unavailable', message: 'backend unavailable' };
  const h = makeRejectingHarness(err);
  await assert.rejects(function () { return h.MastDB.get('admin/settings'); });
  assert.strictEqual(h.getCalls(), 4, 'transient must retry 3× — expected 4 reads, got ' + h.getCalls());
  assert.strictEqual(h.errors.length, 0, 'transient must not log a missing-index URL');
});

test('failed-precondition WITHOUT an index URL (e.g. cold-start persistence): still retries', async () => {
  const err = { code: 'failed-precondition', message: 'Failed to obtain exclusive access to the persistence layer' };
  const h = makeRejectingHarness(err);
  await assert.rejects(function () { return h.MastDB.get('admin/settings'); });
  assert.strictEqual(h.getCalls(), 4, 'non-index failed-precondition must retry — expected 4 reads, got ' + h.getCalls());
});
