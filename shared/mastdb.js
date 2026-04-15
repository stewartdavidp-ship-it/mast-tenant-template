// ============================================================
// MastDB — Phase A Data Access Abstraction Layer
// ------------------------------------------------------------
// Contract matches the Phase A POC DataStore
// (~/.claude/plans/mast-db-abstraction/poc-worktree/src/shared/
//  data-store/types.ts). When Phase B swaps RTDB for Firestore,
// only this module's internals change; call sites stay put.
//
// Public operation API (tenant-scoped; path is under {tenantId}/):
//   get(path)                → Promise<value|null>
//   list(path, opts?)        → Promise<Record<string,value>>
//   set(path, value)         → Promise<void>
//   update(path, partial)    → Promise<void>
//   push(path, value)        → Promise<{key}>
//   newKey(path)             → string
//   remove(path)             → Promise<void>
//   multiUpdate(updates)     → Promise<void>  (atomic)
//   query(path)              → chainable QueryBuilder
//   subscribe(path, cb)      → unsubscribe()
//   transaction(path, fn)    → Promise<{committed,value}>
//   serverTimestamp()        → sentinel {__sentinel:'serverTimestamp'}
//   serverIncrement(n)       → sentinel {__sentinel:'serverIncrement',n}
//   tenantId()               → string
//   storagePath(subpath)     → string  (for Firebase Storage refs)
//
// Platform-scoped (absolute paths, no tenant prefix):
//   MastDB.platform.*        — same surface; use for mast-platform/...
//
// Init (called by every consumer after tenant + Firebase are ready):
//   MastDB.init({ db: firebase.database(), tenantId: 'acme' })
//
// Escape hatches (retained; lint warns on new external uses):
//   _ref, _rootRef, _newKey, _newRootKey, _prefixPaths, _multiUpdate
//   — raw Firebase access; prefer operation methods.
// ============================================================
var MastDB = (function() {
  var _db = null;
  var _tenantId = null;

  function init(config) {
    _db = config.db;
    _tenantId = config.tenantId;
  }

  // --- Sentinels (shape matches POC types.ts) ---
  var SERVER_TIMESTAMP = Object.freeze({ __sentinel: 'serverTimestamp' });
  function serverTimestamp() { return SERVER_TIMESTAMP; }
  function serverIncrement(n) {
    return Object.freeze({ __sentinel: 'serverIncrement', n: n });
  }
  function _isSentinel(v) {
    return v && typeof v === 'object' &&
      (v.__sentinel === 'serverTimestamp' || v.__sentinel === 'serverIncrement');
  }
  // Walk object graph, replace sentinels with Firebase native ServerValue. Leaves primitives/arrays alone.
  function _translate(value) {
    if (value === null || value === undefined) return value;
    if (_isSentinel(value)) {
      if (value.__sentinel === 'serverTimestamp') return firebase.database.ServerValue.TIMESTAMP;
      return firebase.database.ServerValue.increment(value.n);
    }
    if (Array.isArray(value)) return value.map(_translate);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = _translate(value[k]);
      return out;
    }
    return value;
  }

  // --- Legacy prefix-wrapper API (escape hatch; still used by ~467 sites) ---
  function _ref(path) { return _db.ref(_tenantId + '/' + path); }
  function _rootRef() { return _db.ref(); }
  function _newKey(path) { return _ref(path).push().key; }
  function _newRootKey() { return _db.ref().push().key; }
  function _prefixPaths(updates) {
    var prefixed = {};
    Object.keys(updates).forEach(function(key) { prefixed[_tenantId + '/' + key] = updates[key]; });
    return prefixed;
  }
  async function _multiUpdate(updates) { return _rootRef().update(_prefixPaths(updates)); }

  // --- Query builder (immutable; mirrors POC AdaptedQueryBuilder) ---
  function _makeQuery(rootRef, spec) {
    spec = spec || {};
    function extend(patch) {
      var next = {};
      for (var k in spec) next[k] = spec[k];
      for (var k in patch) next[k] = patch[k];
      return _makeQuery(rootRef, next);
    }
    function _apply() {
      var q = rootRef;
      if (spec.orderBy === 'child') q = q.orderByChild(spec.orderByField);
      else if (spec.orderBy === 'key') q = q.orderByKey();
      else if (spec.orderBy === 'value') q = q.orderByValue();
      if (spec.equalTo !== undefined) q = q.equalTo(spec.equalTo);
      if (spec.startAt !== undefined) q = q.startAt(spec.startAt);
      if (spec.endAt !== undefined) q = q.endAt(spec.endAt);
      if (spec.limitToFirst !== undefined) q = q.limitToFirst(spec.limitToFirst);
      if (spec.limitToLast !== undefined) q = q.limitToLast(spec.limitToLast);
      return q;
    }
    return {
      orderByChild: function(field) { return extend({ orderBy: 'child', orderByField: field }); },
      orderByKey: function() { return extend({ orderBy: 'key' }); },
      orderByValue: function() { return extend({ orderBy: 'value' }); },
      equalTo: function(v) { return extend({ equalTo: v }); },
      startAt: function(v) { return extend({ startAt: v }); },
      endAt: function(v) { return extend({ endAt: v }); },
      limitToFirst: function(n) { return extend({ limitToFirst: n }); },
      limitToLast: function(n) { return extend({ limitToLast: n }); },
      once: function() {
        return _apply().once('value').then(function(snap) { return snap.val() || {}; });
      },
      subscribe: function(cb) {
        var q = _apply();
        var handler = function(snap) { cb(snap.val() || {}); };
        q.on('value', handler);
        return function() { q.off('value', handler); };
      }
    };
  }

  // --- DataStore factory (shared by tenant + platform scopes) ---
  function _makeStore(scope) {
    function resolve(path) {
      return scope.platform ? path : _tenantId + '/' + path;
    }
    function resolveUpdates(updates) {
      var out = {};
      for (var k in updates) if (Object.prototype.hasOwnProperty.call(updates, k)) {
        out[resolve(k)] = _translate(updates[k]);
      }
      return out;
    }
    return {
      get: function(path) {
        return _db.ref(resolve(path)).once('value').then(function(s) { return s.val(); });
      },
      list: function(path, opts) {
        opts = opts || {};
        var q = _db.ref(resolve(path));
        if (opts.shallow) return q.once('value').then(function(s) {
          var v = s.val() || {}; var keys = {};
          for (var k in v) keys[k] = true;
          return keys;
        });
        if (opts.limit) q = q.limitToFirst(opts.limit);
        return q.once('value').then(function(s) { return s.val() || {}; });
      },
      set: function(path, value) {
        return _db.ref(resolve(path)).set(_translate(value));
      },
      update: function(path, partial) {
        return _db.ref(resolve(path)).update(_translate(partial));
      },
      push: function(path, value) {
        var baseRef = _db.ref(resolve(path));
        var key = baseRef.push().key;
        return baseRef.child(key).set(_translate(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) { return _db.ref(resolve(path)).push().key; },
      remove: function(path) { return _db.ref(resolve(path)).remove(); },
      multiUpdate: function(updates) {
        return _db.ref().update(resolveUpdates(updates));
      },
      query: function(path) { return _makeQuery(_db.ref(resolve(path)), {}); },
      subscribe: function(path, cb) {
        var ref = _db.ref(resolve(path));
        var handler = function(snap) { cb(snap.val()); };
        ref.on('value', handler);
        return function() { ref.off('value', handler); };
      },
      transaction: function(path, fn) {
        return _db.ref(resolve(path)).transaction(fn).then(function(r) {
          return { committed: r.committed, value: r.snapshot ? r.snapshot.val() : null };
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Public MastDB object ---
  var tenantStore = null;
  var platformStore = null;
  function _ensureStores() {
    if (!tenantStore) tenantStore = _makeStore({ tenantId: true });
    if (!platformStore) platformStore = _makeStore({ platform: true });
  }

  return {
    init: function(config) {
      init(config);
      _ensureStores();
    },
    // Operation API (tenant-scoped) — lazy-bound so they work post-init
    get: function(p) { return tenantStore.get(p); },
    list: function(p, o) { return tenantStore.list(p, o); },
    set: function(p, v) { return tenantStore.set(p, v); },
    update: function(p, x) { return tenantStore.update(p, x); },
    push: function(p, v) { return tenantStore.push(p, v); },
    newKey: function(p) { return tenantStore.newKey(p); },
    remove: function(p) { return tenantStore.remove(p); },
    multiUpdate: function(u) { return tenantStore.multiUpdate(u); },
    query: function(p) { return tenantStore.query(p); },
    subscribe: function(p, cb) { return tenantStore.subscribe(p, cb); },
    transaction: function(p, fn) { return tenantStore.transaction(p, fn); },
    serverTimestamp: serverTimestamp,
    serverIncrement: serverIncrement,
    // Platform-scoped secondary store
    platform: {
      get: function(p) { return platformStore.get(p); },
      list: function(p, o) { return platformStore.list(p, o); },
      set: function(p, v) { return platformStore.set(p, v); },
      update: function(p, x) { return platformStore.update(p, x); },
      push: function(p, v) { return platformStore.push(p, v); },
      newKey: function(p) { return platformStore.newKey(p); },
      remove: function(p) { return platformStore.remove(p); },
      multiUpdate: function(u) { return platformStore.multiUpdate(u); },
      query: function(p) { return platformStore.query(p); },
      subscribe: function(p, cb) { return platformStore.subscribe(p, cb); },
      transaction: function(p, fn) { return platformStore.transaction(p, fn); },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    },
    // Retained escape hatches — prefer operation API; lint warns on new uses
    _ref: _ref,
    _rootRef: _rootRef,
    _newKey: _newKey,
    _newRootKey: _newRootKey,
    _prefixPaths: _prefixPaths,
    _multiUpdate: _multiUpdate,
    tenantId: function() { return _tenantId; },
    storagePath: function(subpath) { return _tenantId + '/' + subpath; }
  };
})();

// Expose on window for non-module consumers (matches existing pattern)
if (typeof window !== 'undefined') window.MastDB = MastDB;
