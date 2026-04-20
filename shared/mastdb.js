// ============================================================
// MastDB — Phase B.5 Hybrid Data Access Abstraction Layer
// ------------------------------------------------------------
// Tenant operations → Firestore (tenants/{tenantId}/{collection})
// Platform operations → RTDB (mast-platform/...)
//
// Public API unchanged from Phase A. Only internals swapped.
// See ~/.claude/plans/mast-db-abstraction/phase-b-firestore-detailed.md
// ============================================================
var MastDB = (function() {
  var _fs = null;       // Firestore instance (tenant + platform operations)
  var _tenantId = null;

  function init(config) {
    _tenantId = config.tenantId;
    if (config.firestore) {
      _fs = config.firestore;
    } else if (config.db) {
      // Legacy callers still pass config.db (RTDB). Pull Firestore from same app.
      try {
        var app = config.db.app || config.app;
        if (app && app.firestore) _fs = app.firestore();
      } catch (e) { /* fall through */ }
    }
    if (!_fs && typeof firebase !== 'undefined' && firebase.firestore) {
      _fs = firebase.firestore();
    }
    _ensureStores();
  }

  // --- Backward-compat: wrap subscribe data with .val() for legacy snap.val() callers ---
  function _wrapSnap(data) {
    if (data == null) return { val: function() { return null; } };
    if (typeof data !== 'object') return { val: function() { return data; } };
    // Clone-ish: add .val() as non-enumerable so it doesn't pollute Object.keys/values
    Object.defineProperty(data, 'val', {
      value: function() { return data; },
      enumerable: false, configurable: true, writable: true
    });
    return data;
  }

  // --- Backward-compat: make Promises from get() behave like Firebase refs ---
  // Allows legacy patterns: MastDB.config.square().once('value').then(snap => snap.val())
  function _wrapPromise(promise, basePath) {
    // .once('value') — just return the promise with wrapped result
    promise.once = function() { return promise.then(_wrapSnap); };
    // .child(key) — return a new wrapped promise that drills into the result
    promise.child = function(key) {
      return _wrapPromise(promise.then(function(data) {
        if (data == null) return null;
        return (typeof data === 'object' && key in data) ? data[key] : null;
      }), basePath ? basePath + '/' + key : key);
    };
    // .on('value', cb) — one-shot listener compat (not real-time, but prevents crash)
    promise.on = function(event, cb) { promise.then(function(d) { cb(_wrapSnap(d)); }); return promise; };
    return promise;
  }

  // --- Sentinels ---
  var SERVER_TIMESTAMP = Object.freeze({ __sentinel: 'serverTimestamp' });
  function serverTimestamp() { return SERVER_TIMESTAMP; }
  function serverIncrement(n) {
    return Object.freeze({ __sentinel: 'serverIncrement', n: n });
  }
  function _isSentinel(v) {
    return v && typeof v === 'object' &&
      (v.__sentinel === 'serverTimestamp' || v.__sentinel === 'serverIncrement');
  }

  // Resolve sentinels for Firestore
  function _translateFs(value) {
    if (value === null || value === undefined) return value;
    if (_isSentinel(value)) {
      if (value.__sentinel === 'serverTimestamp') return firebase.firestore.FieldValue.serverTimestamp();
      return firebase.firestore.FieldValue.increment(value.n);
    }
    if (Array.isArray(value)) return value.map(_translateFs);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = _translateFs(value[k]);
      return out;
    }
    return value;
  }

  // --- Path translation tables ---

  var TENANT_COLLECTION_MAP = {
    'admin/contacts': 'contacts',
    'admin/customers': 'customers',
    'admin/customerIndexes': 'customer_indexes',
    'admin/customerDuplicates': 'customer_duplicates',
    'admin/enrollments': 'enrollments',
    'admin/inventory': 'inventory',
    'admin/materials': 'materials',
    'admin/recipes': 'recipes',
    'admin/users': 'admin_users',
    'admin/coupons': 'coupons',
    'admin/commissions': 'commissions',
    'admin/expenses': 'expenses',
    'admin/giftCards': 'gift_cards',
    'admin/historicalOrders': 'historical_orders',
    'admin/lookbooks': 'lookbooks',
    'admin/consignments': 'consignments',
    'admin/subscription': 'admin_subscription',
    'admin/auditLog': 'audit_log',
    'admin/auditIndex': 'audit_index',
    'public/products': 'products',
    'public/gallery': 'gallery',
    'public/classes': 'classes',
    'public/classSessions': 'class_sessions',
    'public/sales-promotions': 'sales_promotions',
    'public/config': 'config',
    'blog/posts': 'blog_posts',
    'blog/published': 'blog_published',
    'blog/ideas': 'blog_ideas',
    'newsletter/subscribers': 'newsletter_subscribers',
    'newsletter/issues': 'newsletter_issues',
    'newsletter/published': 'newsletter_published',
    'events/shows': 'events_shows',
    'events/booths': 'events_booths',
    'events/vendors': 'events_vendors',
    'events/submissions': 'events_submissions',
    'analytics/hits': 'analytics_hits',
    'tokenWallet': 'token_wallet',
    'tokenLog': 'token_log',
    'alertState': 'alert_state',
    'alertHistory': 'alert_history',
    'feedbackReports': 'feedback_reports',
    'webPresence': 'web_presence',
    'webPresence/importJobs': 'web_presence_importJobs',
    'quickActions': 'quick_actions',
    'tripLocations': 'trip_locations',
    'tripSettings': 'trip_settings',
    'orders': 'orders',
    'emails': 'emails',
    'images': 'images',
    'students': 'students',
    'users': 'users',
    'config': 'config',
    'settings': 'settings',
    'workflows': 'workflows',
    'inquiries': 'inquiries',
    'trips': 'trips'
  };

  var PLATFORM_COLLECTION_MAP = {
    'auth/oauth/clients': 'platform_auth_oauth_clients',
    'auth/oauth/tokenIndex': 'platform_auth_oauth_tokenIndex',
    'auth/oauth/userTokens': 'platform_auth_oauth_userTokens',
    'auth/oauth/auditLog': 'platform_auth_oauth_auditLog',
    'auth/oauth/refreshTokenIndex': 'platform_auth_oauth_refreshTokenIndex',
    'auth/oauth/userRefreshTokens': 'platform_auth_oauth_userRefreshTokens',
    'auth/apiKeys': 'platform_auth_apiKeys',
    'auth/tenantApiKeys': 'platform_auth_tenantApiKeys',
    'tenants': 'platform_tenants',
    'tenantsByDomain': 'platform_tenantsByDomain',
    'platformAdmins': 'platform_platformAdmins',
    'userTenantMap': 'platform_userTenantMap',
    'dashboardCards': 'platform_dashboardCards',
    'alertDefinitions': 'platform_alertDefinitions',
    'alertRuns': 'platform_alertRuns',
    'driftSeverityDefaults': 'platform_driftSeverityDefaults',
    'showIndex': 'platform_showIndex',
    'showSlugs': 'platform_showSlugs',
    'testingMissions': 'platform_testingMissions',
    'eventsInviteTokens': 'platform_eventsInviteTokens',
    'importJobs': 'platform_importJobs',
    'importCapabilities': 'platform_importCapabilities',
    'importPatterns': 'platform_importPatterns',
    'driftScans': 'platform_driftScans',
    'etsyPendingAuth': 'platform_etsyPendingAuth',
    'googleContactsPendingAuth': 'platform_googleContactsPendingAuth',
    'shopifyPendingAuth': 'platform_shopifyPendingAuth',
    'webhookRouting': 'platform_webhookRouting',
    'backfills': 'platform_backfills',
    'spotPrices': 'platform_spotPrices',
    'config': 'platform_config',
    'provisioning': 'platform_provisioning',
    'pendingOwners': 'platform_pendingOwners'
  };

  var SINGLETON_COLLECTIONS = {
    'token_wallet': true, 'alert_state': true,
    'trip_settings': true, 'newsletter_meta': true,
    'admin_subscription': true,
    'platform_driftSeverityDefaults': true
  };
  var SINGLETON_DOC_ID = '_data';

  function _lookupCollection(segs, map) {
    for (var i = 3; i >= 1; i--) {
      if (segs.length >= i) {
        var prefix = segs.slice(0, i).join('/');
        var mapped = map[prefix];
        if (mapped) return { collection: mapped, remaining: segs.slice(i) };
      }
    }
    return null;
  }

  var NAMESPACE_PREFIXES = { 'admin': true, 'public': true, 'newsletter': true, 'blog': true, 'events': true, 'analytics': true };

  function _buildResult(coll, rem) {
    if (SINGLETON_COLLECTIONS[coll]) {
      return { collection: coll, docId: SINGLETON_DOC_ID, fieldPath: rem.length > 0 ? rem.join('.') : null };
    }
    if (rem.length === 0) return { collection: coll, docId: null, fieldPath: null };
    if (rem.length === 1) return { collection: coll, docId: rem[0], fieldPath: null };
    return { collection: coll, docId: rem[0], fieldPath: rem.slice(1).join('.') };
  }

  function _translateTenantPath(path) {
    var segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return { collection: '_root', docId: null, fieldPath: null };

    // 1. Try static map (handles known renames like giftCards → gift_cards)
    var match = _lookupCollection(segs, TENANT_COLLECTION_MAP);
    if (match) return _buildResult(match.collection, match.remaining);

    // 2. Namespace-aware fallback for unmapped paths
    if (segs.length >= 2 && NAMESPACE_PREFIXES[segs[0]]) {
      var ns = segs[0];
      var rest = segs.slice(1);
      // admin/* → admin_{collection} to avoid collision with root paths
      // public/* → {collection} (public is the public-facing namespace, safe to strip)
      var coll = (ns === 'admin') ? 'admin_' + rest[0] : rest[0];
      return _buildResult(coll, rest.slice(1));
    }

    // 3. Root-level fallback
    return _buildResult(segs[0], segs.slice(1));
  }

  function _translatePlatformPath(fullPath) {
    var stripped = fullPath.indexOf('mast-platform/') === 0
      ? fullPath.slice('mast-platform/'.length)
      : fullPath;
    var segs = stripped.split('/').filter(Boolean);
    if (segs.length === 0) return { collection: 'platform', docId: null, fieldPath: null };

    var match = _lookupCollection(segs, PLATFORM_COLLECTION_MAP);
    if (match) {
      var coll = match.collection;
      var rem = match.remaining;
      if (SINGLETON_COLLECTIONS[coll]) {
        return { collection: coll, docId: SINGLETON_DOC_ID, fieldPath: rem.length > 0 ? rem.join('.') : null };
      }
      if (rem.length === 0) return { collection: coll, docId: null, fieldPath: null };
      if (rem.length === 1) return { collection: coll, docId: rem[0], fieldPath: null };
      return { collection: coll, docId: rem[0], fieldPath: rem.slice(1).join('.') };
    }

    // Fallback: platform_{firstSegment}
    var fallbackColl = 'platform_' + segs[0];
    if (segs.length === 1) return { collection: fallbackColl, docId: null, fieldPath: null };
    if (segs.length === 2) return { collection: fallbackColl, docId: segs[1], fieldPath: null };
    return { collection: fallbackColl, docId: segs[1], fieldPath: segs.slice(2).join('.') };
  }

  function _tenantRoot() {
    return _fs.collection('tenants').doc(_tenantId);
  }

  function _collRef(parsed) {
    return _tenantRoot().collection(parsed.collection);
  }

  function _docRef(parsed) {
    if (!parsed.docId) throw new Error('MastDB: path requires doc ID: ' + parsed.collection);
    return _collRef(parsed).doc(parsed.docId);
  }

  function _platformCollRef(parsed) {
    return _fs.collection(parsed.collection);
  }

  function _platformDocRef(parsed) {
    if (!parsed.docId) throw new Error('MastDB: platform path requires doc ID: ' + parsed.collection);
    return _platformCollRef(parsed).doc(parsed.docId);
  }

  // --- Firestore query builder ---
  function _makeQuery(collectionRef, spec) {
    spec = spec || {};
    function extend(patch) {
      var next = {};
      for (var k in spec) next[k] = spec[k];
      for (var k2 in patch) next[k2] = patch[k2];
      return _makeQuery(collectionRef, next);
    }
    function _apply() {
      var q = collectionRef;
      if (spec.orderBy === 'child') {
        if (spec.equalTo !== undefined) {
          q = q.where(spec.orderByField, '==', spec.equalTo);
        } else {
          q = q.orderBy(spec.orderByField);
          if (spec.startAt !== undefined) q = q.startAt(spec.startAt);
          if (spec.startAfter !== undefined) q = q.startAfter(spec.startAfter);
          if (spec.endAt !== undefined) q = q.endAt(spec.endAt);
          if (spec.endBefore !== undefined) q = q.endBefore(spec.endBefore);
        }
      } else if (spec.orderBy === 'key') {
        q = q.orderBy(firebase.firestore.FieldPath.documentId());
      }
      if (spec.limitToFirst !== undefined) q = q.limit(spec.limitToFirst);
      if (spec.limitToLast !== undefined) {
        // Firestore limitToLast requires orderBy — fall back to limit() if none set
        if (!spec.orderBy) {
          q = q.limit(spec.limitToLast);
        } else {
          q = q.limitToLast(spec.limitToLast);
        }
      }
      return q;
    }
    function _snapToObj(snap) {
      var result = {};
      snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
      return result;
    }
    return {
      orderByChild: function(field) { return extend({ orderBy: 'child', orderByField: field }); },
      orderByKey: function() { return extend({ orderBy: 'key' }); },
      orderByValue: function() { return extend({ orderBy: 'value' }); },
      equalTo: function(v) { return extend({ equalTo: v }); },
      startAt: function(v) { return extend({ startAt: v }); },
      startAfter: function(v) { return extend({ startAfter: v }); },
      endAt: function(v) { return extend({ endAt: v }); },
      endBefore: function(v) { return extend({ endBefore: v }); },
      limitToFirst: function(n) { return extend({ limitToFirst: n }); },
      limitToLast: function(n) { return extend({ limitToLast: n }); },
      once: function() { return _fsGet(_apply(), { source: 'server' }).then(_snapToObj).then(_wrapSnap); },
      subscribe: function(cb) {
        return _apply().onSnapshot(function(snap) { cb(_wrapSnap(_snapToObj(snap))); });
      }
    };
  }

  // --- Firestore retry helper (handles cold-start connection failures) ---
  function _fsGet(ref, opts, attempt) {
    attempt = attempt || 0;
    return ref.get(opts).catch(function(err) {
      var isConnErr = err.code === 'unavailable' || err.code === 'failed-precondition' ||
        (err.message && (err.message.indexOf('offline') !== -1 || err.message.indexOf('unavailable') !== -1));
      if (isConnErr && attempt < 3) {
        var delay = [500, 1500, 3000][attempt];
        return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(function() {
          return _fsGet(ref, opts, attempt + 1);
        });
      }
      throw err;
    });
  }

  // --- Build a nested object from a dotted fieldPath so set({merge:true}) writes
  //     into nested maps rather than a literal dotted-key field. ---
  function _buildNestedSet(fieldPath, value) {
    var segs = fieldPath.split('.');
    var root = {};
    var cur = root;
    for (var i = 0; i < segs.length - 1; i++) {
      cur[segs[i]] = {};
      cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
    return root;
  }

  // --- Convert dotted-keyed field map into nested-object form (for multiUpdate). ---
  function _nestFields(fields) {
    var out = {};
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      if (k.indexOf('.') === -1) { out[k] = fields[k]; continue; }
      var segs = k.split('.');
      var cur = out;
      for (var i = 0; i < segs.length - 1; i++) {
        var seg = segs[i];
        if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
          cur[seg] = {};
        }
        cur = cur[seg];
      }
      cur[segs[segs.length - 1]] = fields[k];
    }
    return out;
  }

  // --- Unwrap _v sentinel used when storing primitives/arrays as Firestore docs ---
  function _unwrapV(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) &&
        data._v !== undefined && Object.keys(data).length === 1) {
      return data._v;
    }
    return data;
  }

  // --- Firestore tenant store ---
  function _makeFirestoreStore() {
    return {
      get: function(path) {
        var parsed = _translateTenantPath(path);
        if (!parsed.docId) {
          return _wrapPromise(_fsGet(_collRef(parsed), { source: 'server' }).then(function(snap) {
            if (snap.empty) return null;
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            return result;
          }), path);
        }
        return _wrapPromise(_fsGet(_docRef(parsed), { source: 'server' }).then(function(doc) {
          if (!doc.exists) return null;
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            return val !== undefined ? val : null;
          }
          return data;
        }), path);
      },
      list: function(path, opts) {
        opts = opts || {};
        var parsed = _translateTenantPath(path);
        var q = _collRef(parsed);
        if (opts.limit) q = q.limit(opts.limit);
        return _fsGet(q, { source: 'server' }).then(function(snap) {
          var result = {};
          snap.forEach(function(doc) {
            result[doc.id] = opts.shallow ? true : _unwrapV(doc.data());
          });
          return result;
        });
      },
      set: function(path, value) {
        var parsed = _translateTenantPath(path);
        var resolved = _translateFs(value);
        if (parsed.fieldPath) {
          // mergeFields scopes the write to exactly parsed.fieldPath: that
          // field is replaced wholesale while sibling fields on the doc are
          // preserved. This matches RTDB's ref.set() semantics (set replaces
          // the targeted subtree) — plain {merge:true} recursively merges
          // into maps and leaks stale keys on removal.
          return _docRef(parsed).set(
            _buildNestedSet(parsed.fieldPath, resolved),
            { mergeFields: [parsed.fieldPath] }
          );
        }
        if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
          return _docRef(parsed).set(resolved);
        }
        return _docRef(parsed).set({ _v: resolved });
      },
      update: function(path, partial) {
        var parsed = _translateTenantPath(path);
        var resolved = _translateFs(partial);
        if (parsed.fieldPath) {
          var prefixed = {};
          for (var k in resolved) {
            if (Object.prototype.hasOwnProperty.call(resolved, k)) {
              prefixed[parsed.fieldPath + '.' + k] = resolved[k];
            }
          }
          return _docRef(parsed).update(prefixed);
        }
        return _docRef(parsed).update(resolved);
      },
      push: function(path, value) {
        var parsed = _translateTenantPath(path);
        var ref = _collRef(parsed).doc();
        var key = ref.id;
        return ref.set(_translateFs(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) {
        var parsed = _translateTenantPath(path);
        return _collRef(parsed).doc().id;
      },
      remove: function(path) {
        var parsed = _translateTenantPath(path);
        if (parsed.fieldPath) {
          var upd = {};
          upd[parsed.fieldPath] = firebase.firestore.FieldValue.delete();
          return _docRef(parsed).update(upd);
        }
        if (parsed.docId) return _docRef(parsed).delete();
        return _collRef(parsed).get().then(function(snap) {
          var batch = _fs.batch();
          snap.forEach(function(doc) { batch.delete(doc.ref); });
          return batch.commit();
        });
      },
      multiUpdate: function(updates) {
        var batch = _fs.batch();
        var docUpdates = {};
        for (var p in updates) {
          if (!Object.prototype.hasOwnProperty.call(updates, p)) continue;
          var parsed = _translateTenantPath(p);
          if (!parsed.docId) continue;
          var ref = _docRef(parsed);
          var refPath = ref.path;
          if (!docUpdates[refPath]) docUpdates[refPath] = { ref: ref, fields: {} };
          var resolved = _translateFs(updates[p]);
          if (parsed.fieldPath) {
            docUpdates[refPath].fields[parsed.fieldPath] = resolved;
          } else if (resolved === null) {
            batch.delete(ref);
            delete docUpdates[refPath];
          } else if (typeof resolved === 'object' && !Array.isArray(resolved)) {
            docUpdates[refPath].fullReplace = resolved;
          } else {
            docUpdates[refPath].fullReplace = { _v: resolved };
          }
        }
        for (var rp in docUpdates) {
          var entry = docUpdates[rp];
          var nested = _nestFields(entry.fields);
          var fieldPaths = Object.keys(entry.fields);
          if (entry.fullReplace) {
            var merged = Object.assign({}, entry.fullReplace, nested);
            // Each top-level key of fullReplace is a full-replace target, and
            // each nested fieldPath is a scoped-replace target. Listing them
            // all in mergeFields preserves any sibling fields not touched.
            var mergeFields = Object.keys(entry.fullReplace).concat(fieldPaths);
            batch.set(entry.ref, merged, { mergeFields: mergeFields });
          } else if (fieldPaths.length > 0) {
            batch.set(entry.ref, nested, { mergeFields: fieldPaths });
          }
        }
        return batch.commit();
      },
      query: function(path) {
        var parsed = _translateTenantPath(path);
        return _makeQuery(_collRef(parsed), {});
      },
      subscribe: function(path, cb) {
        var parsed = _translateTenantPath(path);
        if (!parsed.docId) {
          return _collRef(parsed).onSnapshot(function(snap) {
            if (snap.empty) { cb(_wrapSnap(null)); return; }
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            cb(_wrapSnap(result));
          });
        }
        return _docRef(parsed).onSnapshot(function(doc) {
          if (!doc.exists) { cb(_wrapSnap(null)); return; }
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            cb(_wrapSnap(val !== undefined ? val : null));
          } else {
            cb(_wrapSnap(data));
          }
        });
      },
      subscribeChild: function(path, event, cb) {
        var parsed = _translateTenantPath(path);
        var seen = {};
        if (parsed.fieldPath) {
          return _docRef(parsed).onSnapshot(function(doc) {
            if (!doc.exists) return;
            var data = _unwrapV(doc.data());
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            if (!val || typeof val !== 'object') return;
            Object.keys(val).forEach(function(k) {
              var entry = val[k];
              if (event === 'child_added' && !seen[k]) { seen[k] = true; cb(entry, k); }
              else if (event === 'child_changed' && seen[k]) { cb(entry, k); }
              seen[k] = true;
            });
          });
        }
        return _collRef(parsed).onSnapshot(function(snap) {
          snap.forEach(function(doc) {
            var d = _unwrapV(doc.data());
            if (event === 'child_added' && !seen[doc.id]) {
              seen[doc.id] = true;
              cb(d, doc.id);
            } else if (event === 'child_changed' && seen[doc.id]) {
              cb(d, doc.id);
            }
            seen[doc.id] = true;
          });
        });
      },
      transaction: function(path, fn) {
        var parsed = _translateTenantPath(path);
        var ref = _docRef(parsed);
        return _fs.runTransaction(function(tx) {
          return tx.get(ref).then(function(doc) {
            var current = doc.exists ? doc.data() : null;
            var next = fn(current);
            if (next === undefined) return { committed: false, value: current };
            var resolved = _translateFs(next);
            if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
              tx.set(ref, resolved);
            } else {
              tx.set(ref, { _v: resolved });
            }
            return { committed: true, value: next };
          });
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Firestore platform store (mast-platform/* → top-level platform_* collections) ---
  function _makeFirestorePlatformStore() {
    function _platformQuery(collectionRef, spec) {
      spec = spec || {};
      function extend(patch) {
        var next = {};
        for (var k in spec) next[k] = spec[k];
        for (var k2 in patch) next[k2] = patch[k2];
        return _platformQuery(collectionRef, next);
      }
      function _apply() {
        var q = collectionRef;
        if (spec.orderBy === 'child') {
          if (spec.equalTo !== undefined) {
            q = q.where(spec.orderByField, '==', spec.equalTo);
          } else {
            q = q.orderBy(spec.orderByField);
          }
        } else if (spec.orderBy === 'key') {
          q = q.orderBy(firebase.firestore.FieldPath.documentId());
        }
        if (spec.limitToFirst !== undefined) q = q.limit(spec.limitToFirst);
        if (spec.limitToLast !== undefined) {
          if (!spec.orderBy) q = q.limit(spec.limitToLast);
          else q = q.limitToLast(spec.limitToLast);
        }
        return q;
      }
      function _snapToObj(snap) {
        var result = {};
        snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
        return result;
      }
      return {
        orderByChild: function(field) { return extend({ orderBy: 'child', orderByField: field }); },
        orderByKey: function() { return extend({ orderBy: 'key' }); },
        equalTo: function(v) { return extend({ equalTo: v }); },
        limitToFirst: function(n) { return extend({ limitToFirst: n }); },
        limitToLast: function(n) { return extend({ limitToLast: n }); },
        once: function() { return _fsGet(_apply(), { source: 'server' }).then(_snapToObj).then(_wrapSnap); },
        subscribe: function(cb) {
          return _apply().onSnapshot(function(snap) { cb(_wrapSnap(_snapToObj(snap))); });
        }
      };
    }

    return {
      get: function(path) {
        var parsed = _translatePlatformPath(path);
        if (!parsed.docId) {
          return _wrapPromise(_fsGet(_platformCollRef(parsed), { source: 'server' }).then(function(snap) {
            if (snap.empty) return null;
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            return result;
          }), path);
        }
        return _wrapPromise(_fsGet(_platformDocRef(parsed), { source: 'server' }).then(function(doc) {
          if (!doc.exists) return null;
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            return val !== undefined ? val : null;
          }
          return data;
        }), path);
      },
      list: function(path, opts) {
        opts = opts || {};
        var parsed = _translatePlatformPath(path);
        var q = _platformCollRef(parsed);
        if (opts.limit) q = q.limit(opts.limit);
        return _fsGet(q, { source: 'server' }).then(function(snap) {
          var result = {};
          snap.forEach(function(doc) {
            result[doc.id] = opts.shallow ? true : _unwrapV(doc.data());
          });
          return result;
        });
      },
      set: function(path, value) {
        var parsed = _translatePlatformPath(path);
        var resolved = _translateFs(value);
        if (parsed.fieldPath) {
          return _platformDocRef(parsed).set(
            _buildNestedSet(parsed.fieldPath, resolved),
            { mergeFields: [parsed.fieldPath] }
          );
        }
        if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
          return _platformDocRef(parsed).set(resolved);
        }
        return _platformDocRef(parsed).set({ _v: resolved });
      },
      update: function(path, partial) {
        var parsed = _translatePlatformPath(path);
        var resolved = _translateFs(partial);
        if (parsed.fieldPath) {
          var prefixed = {};
          for (var k in resolved) {
            if (Object.prototype.hasOwnProperty.call(resolved, k)) {
              prefixed[parsed.fieldPath + '.' + k] = resolved[k];
            }
          }
          return _platformDocRef(parsed).update(prefixed);
        }
        return _platformDocRef(parsed).set(resolved, { merge: true });
      },
      push: function(path, value) {
        var parsed = _translatePlatformPath(path);
        var ref = _platformCollRef(parsed).doc();
        var key = ref.id;
        return ref.set(_translateFs(value)).then(function() { return { key: key }; });
      },
      newKey: function(path) {
        var parsed = _translatePlatformPath(path);
        return _platformCollRef(parsed).doc().id;
      },
      remove: function(path) {
        var parsed = _translatePlatformPath(path);
        if (parsed.fieldPath) {
          var upd = {};
          upd[parsed.fieldPath] = firebase.firestore.FieldValue.delete();
          return _platformDocRef(parsed).update(upd);
        }
        if (parsed.docId) return _platformDocRef(parsed).delete();
        return _platformCollRef(parsed).get().then(function(snap) {
          var batch = _fs.batch();
          snap.forEach(function(doc) { batch.delete(doc.ref); });
          return batch.commit();
        });
      },
      multiUpdate: function(updates) {
        var batch = _fs.batch();
        for (var p in updates) {
          if (!Object.prototype.hasOwnProperty.call(updates, p)) continue;
          var parsed = _translatePlatformPath(p);
          if (!parsed.docId) continue;
          var ref = _platformDocRef(parsed);
          var resolved = _translateFs(updates[p]);
          if (resolved === null) {
            batch.delete(ref);
          } else if (parsed.fieldPath) {
            var upd = {};
            upd[parsed.fieldPath] = resolved;
            batch.set(ref, _buildNestedSet(parsed.fieldPath, resolved), { mergeFields: [parsed.fieldPath] });
          } else if (typeof resolved === 'object' && !Array.isArray(resolved)) {
            batch.set(ref, resolved);
          } else {
            batch.set(ref, { _v: resolved });
          }
        }
        return batch.commit();
      },
      query: function(path) {
        var parsed = _translatePlatformPath(path);
        return _platformQuery(_platformCollRef(parsed), {});
      },
      subscribe: function(path, cb) {
        var parsed = _translatePlatformPath(path);
        if (!parsed.docId) {
          return _platformCollRef(parsed).onSnapshot(function(snap) {
            if (snap.empty) { cb(_wrapSnap(null)); return; }
            var result = {};
            snap.forEach(function(doc) { result[doc.id] = _unwrapV(doc.data()); });
            cb(_wrapSnap(result));
          });
        }
        return _platformDocRef(parsed).onSnapshot(function(doc) {
          if (!doc.exists) { cb(_wrapSnap(null)); return; }
          var data = _unwrapV(doc.data());
          if (parsed.fieldPath) {
            var segs = parsed.fieldPath.split('.');
            var val = data;
            for (var i = 0; i < segs.length && val != null; i++) val = val[segs[i]];
            cb(_wrapSnap(val !== undefined ? val : null));
          } else {
            cb(_wrapSnap(data));
          }
        });
      },
      transaction: function(path, fn) {
        var parsed = _translatePlatformPath(path);
        var ref = _platformDocRef(parsed);
        return _fs.runTransaction(function(tx) {
          return tx.get(ref).then(function(doc) {
            var current = doc.exists ? _unwrapV(doc.data()) : null;
            var next = fn(current);
            if (next === undefined) return { committed: false, value: current };
            var resolved = _translateFs(next);
            if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
              tx.set(ref, resolved);
            } else {
              tx.set(ref, { _v: resolved });
            }
            return { committed: true, value: next };
          });
        });
      },
      serverTimestamp: serverTimestamp,
      serverIncrement: serverIncrement
    };
  }

  // --- Escape hatches (deprecated — throw so misuse is caught at call site) ---
  function _ref() {
    throw new Error('[MastDB] _ref() escape hatch removed. Use MastDB.get/set/query/subscribe/etc.');
  }
  function _rootRef() {
    throw new Error('[MastDB] _rootRef() escape hatch removed. Use MastDB.get/set/query/subscribe/etc.');
  }
  function _newKey(path) {
    var parsed = _translateTenantPath(path);
    return _collRef(parsed).doc().id;
  }
  function _newRootKey() { return _fs.collection('_keys').doc().id; }
  function _prefixPaths(updates) { return updates; }
  async function _multiUpdate(updates) {
    // Delegate to the tenant store's multiUpdate
    return tenantStore.multiUpdate(updates);
  }

  // --- Public MastDB object ---
  var tenantStore = null;
  var platformStore = null;
  function _ensureStores() {
    if (!tenantStore && _fs) tenantStore = _makeFirestoreStore();
    if (!platformStore && _fs) platformStore = _makeFirestorePlatformStore();
  }

  return {
    init: function(config) {
      init(config);
    },
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
    subscribeChild: function(p, e, cb) { return tenantStore.subscribeChild(p, e, cb); },
    transaction: function(p, fn) { return tenantStore.transaction(p, fn); },
    serverTimestamp: serverTimestamp,
    serverIncrement: serverIncrement,
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

if (typeof window !== 'undefined') window.MastDB = MastDB;
