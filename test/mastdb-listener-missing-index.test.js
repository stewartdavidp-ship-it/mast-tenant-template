/**
 * Regression test for the LISTENER-path missing-index surfacing in shared/mastdb.js.
 *
 * Companion to mastdb-missing-index.test.js (which covers the one-shot READ path via
 * _fsGet). A Firestore listener (subscribe/onSnapshot) on an un-indexed query
 * SILENTLY NEVER FIRES — the error arrives on the snapshot error handler, not the
 * read promise. The active listener handlers used to be a plain `console.warn(e.message)`
 * that buried the "create it here: https://console.firebase.google.com/…" URL.
 *
 * (Context: the #764 fix added this branch to shared/mastdb-firestore.js — which turned
 * out to be DEAD Phase-B code, never loaded. This pins it on the ACTIVE handler in
 * mastdb.js, now routed through the shared `_listenerErr` helper.)
 *
 * Run: node test/mastdb-listener-missing-index.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Fake Firestore whose onSnapshot immediately invokes the error handler with `err`.
function makeListenerHarness(err) {
  const errors = [];
  const warns = [];
  function mkRef(p) {
    const ref = {
      path: p,
      get: function () { return Promise.resolve({ exists: false, data: function () { return undefined; }, forEach: function () {} }); },
      onSnapshot: function (cb, errHandler) { if (typeof errHandler === 'function') errHandler(err); return function () {}; }
    };
    ref.doc = function (d) { return mkRef(p + '/' + d); };
    ref.collection = function (c) { return mkRef(p + '/' + c); };
    ref.where = function () { return mkRef(p); };
    ref.orderBy = function () { return mkRef(p); };
    ref.limit = function () { return mkRef(p); };
    return ref;
  }
  const fakeFs = { doc: function (p) { return mkRef(p); }, collection: function (p) { return mkRef(p); } };
  const firebase = {
    firestore: Object.assign(function () { return fakeFs; }, {
      FieldValue: { increment: function (n) { return { __inc: n }; }, serverTimestamp: function () { return {}; }, delete: function () { return {}; } },
      FieldPath: function () {}
    })
  };
  const src = fs.readFileSync(path.join(__dirname, '../shared/mastdb.js'), 'utf8');
  const sandboxConsole = Object.assign({}, console, {
    error: function () { errors.push(Array.prototype.join.call(arguments, ' ')); },
    warn: function () { warns.push(Array.prototype.join.call(arguments, ' ')); }
  });
  const sandbox = { firebase: firebase, window: {}, console: sandboxConsole, Promise: Promise, setTimeout: function (fn) { fn(); return 0; } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const MastDB = sandbox.MastDB;
  MastDB.init({ firestore: fakeFs, tenantId: 't1' });
  return { MastDB: MastDB, errors: errors, warns: warns };
}

const INDEX_URL = 'https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=ClBwcm9q';

test('subscribe: missing-index listener error surfaces the create-index URL (not buried in a warn)', () => {
  const err = { code: 'failed-precondition', message: 'The query requires an index. You can create it here: ' + INDEX_URL };
  const h = makeListenerHarness(err);
  try { h.MastDB.subscribe('admin/foo', function () {}); } catch (e) { /* path-build variations are fine; we only assert logging */ }
  assert.ok(
    h.errors.some(function (e) { return e.indexOf('console.firebase.google.com') !== -1 && e.indexOf('create_composite') !== -1; }),
    'missing-index listener error must console.error the create-index URL; errors=' + JSON.stringify(h.errors) + ' warns=' + JSON.stringify(h.warns)
  );
});

test('subscribe: a generic listener error stays a plain warn (not escalated to error)', () => {
  const err = { code: 'internal', message: 'transient listener glitch' };
  const h = makeListenerHarness(err);
  try { h.MastDB.subscribe('admin/foo', function () {}); } catch (e) {}
  assert.strictEqual(h.errors.length, 0, 'a non-index listener error must NOT console.error');
  assert.ok(h.warns.some(function (w) { return w.indexOf('transient listener glitch') !== -1; }), 'a generic listener error is a plain warn');
});
