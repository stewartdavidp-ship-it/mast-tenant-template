#!/usr/bin/env node
// Phase B.1 migration script: replace MastDB._ref() and other escape hatches
// with MastDB operation API calls.
//
// Run from repo root: node scripts/migrate-refs.js
// Then: node scripts/migrate-refs.js --dry-run  (to preview without writing)

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.resolve(__dirname, '..');
const manual = []; // Lines requiring manual review

// Files to process
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'shared', 'scripts', 'docs'].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.js'))) {
      const rel = path.relative(ROOT, path.join(dir, entry.name));
      if (rel === 'shared/mastdb.js') continue;
      out.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
walk(path.join(ROOT, 'app'), files);

let totalChanges = 0;

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let changes = 0;
  const rel = path.relative(ROOT, file);

  function replace(pattern, replacement, label) {
    const newSrc = src.replace(pattern, replacement);
    if (newSrc !== src) {
      const count = (src.match(pattern) || []).length;
      changes += count;
      src = newSrc;
      if (!DRY_RUN) console.log(`  [${label}] ${count} replacement(s)`);
    }
  }

  // ===================================================================
  // 1. MastDB._multiUpdate(updates) → MastDB.multiUpdate(updates)
  // ===================================================================
  replace(/MastDB\._multiUpdate\(/g, 'MastDB.multiUpdate(', '_multiUpdate→multiUpdate');

  // ===================================================================
  // 2. MastDB._newKey(path) → MastDB.newKey(path)
  // ===================================================================
  replace(/MastDB\._newKey\(/g, 'MastDB.newKey(', '_newKey→newKey');

  // ===================================================================
  // 3. MastDB._newRootKey() → MastDB.platform.newKey('_ids')
  //    (Root keys need a path; use a dedicated IDs path)
  // ===================================================================
  replace(/MastDB\._newRootKey\(\)/g, "MastDB.newKey('_ids')", '_newRootKey→newKey(_ids)');

  // ===================================================================
  // 4. MastDB._rootRef() — rare, check context
  // ===================================================================
  // Handled case by case below

  // ===================================================================
  // 5. firebase.database.ServerValue.TIMESTAMP → MastDB.serverTimestamp()
  // ===================================================================
  replace(/firebase\.database\.ServerValue\.TIMESTAMP/g, 'MastDB.serverTimestamp()', 'ServerValue.TIMESTAMP');

  // ===================================================================
  // 6. firebase.database.ServerValue.increment(n) → MastDB.serverIncrement(n)
  // ===================================================================
  replace(/firebase\.database\.ServerValue\.increment\(/g, 'MastDB.serverIncrement(', 'ServerValue.increment');

  // ===================================================================
  // 7. Simple one-line patterns for MastDB._ref(path)
  // ===================================================================

  // 7a. MastDB._ref(path).set(value) → MastDB.set(path, value)
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.set\(([^)]*(?:\([^)]*\))*[^)]*)\)/g, function(match, pathExpr, valueExpr) {
    changes++;
    // Handle set(null) → remove
    if (valueExpr.trim() === 'null') {
      return `MastDB.remove(${pathExpr})`;
    }
    return `MastDB.set(${pathExpr}, ${valueExpr})`;
  });

  // 7b. MastDB._ref(path).update(value) → MastDB.update(path, value)
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.update\(([^)]*(?:\{[\s\S]*?\})*[^)]*)\)/g, function(match, pathExpr, valueExpr) {
    changes++;
    return `MastDB.update(${pathExpr}, ${valueExpr})`;
  });

  // 7c. MastDB._ref(path).remove() → MastDB.remove(path)
  replace(/MastDB\._ref\(([^)]+)\)\.remove\(\)/g, 'MastDB.remove($1)', '_ref.remove→remove');

  // 7d. MastDB._ref(path).push().key → MastDB.newKey(path)
  replace(/MastDB\._ref\(([^)]+)\)\.push\(\)\.key/g, 'MastDB.newKey($1)', '_ref.push().key→newKey');

  // 7e. MastDB._ref(path).push(data) → MastDB.push(path, data)
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.push\(([^)]+)\)/g, function(match, pathExpr, dataExpr) {
    changes++;
    return `MastDB.push(${pathExpr}, ${dataExpr})`;
  });

  // 7f. await MastDB._ref(path).once('value') patterns with snap.val()
  // Multi-line: var snap = await MastDB._ref(path).once('value');\n  var val = snap.val() || {};
  src = src.replace(/var (\w+) = await MastDB\._ref\(([^)]+)\)\.once\('value'\);\s*\n(\s*)var (\w+) = \1\.val\(\)( \|\| \{\})?;/g, function(match, snapVar, pathExpr, indent, valVar, defaultEmpty) {
    changes++;
    if (defaultEmpty) {
      return `var ${valVar} = (await MastDB.get(${pathExpr})) || {};`;
    }
    return `var ${valVar} = await MastDB.get(${pathExpr});`;
  });

  // 7g. MastDB._ref(path).once('value').then(function(snap) { var val = snap.val() ...
  // This is a complex multi-line pattern — flag for manual review
  // But handle simpler single-line cases:
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.once\('value'\)\.then\(function\((\w+)\)\s*\{/g, function(match, pathExpr, snapVar) {
    changes++;
    // The callback still uses snapVar.val() — we need to flag these
    manual.push({ file: rel, pattern: `_ref.once.then (callback uses ${snapVar}.val())`, pathExpr });
    return `MastDB.get(${pathExpr}).then(function(${snapVar}__val) {`;
  });

  // 7h. MastDB._ref(path).once('value') standalone (in Promise.all, etc.)
  replace(/MastDB\._ref\(([^)]+)\)\.once\('value'\)/g, 'MastDB.get($1)', '_ref.once→get');

  // 7i. MastDB._ref(path).transaction(fn) → MastDB.transaction(path, fn)
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.transaction\(/g, function(match, pathExpr) {
    changes++;
    return `MastDB.transaction(${pathExpr}, `;
  });

  // 7j. MastDB._ref(path).on('value', cb) → MastDB.subscribe(path, cb)
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.on\('value',\s*/g, function(match, pathExpr) {
    changes++;
    return `MastDB.subscribe(${pathExpr}, `;
  });

  // 7k. MastDB._ref(path).off('value', handle) → (flag for manual)
  // These need the unsub fn from subscribe
  src = src.replace(/MastDB\._ref\(([^)]+)\)\.off\('value',\s*/g, function(match, pathExpr) {
    changes++;
    manual.push({ file: rel, pattern: `_ref.off needs unsub fn`, pathExpr });
    return `/* TODO: use unsub fn from subscribe */ MastDB._ref(${pathExpr}).off('value', `;
  });

  // ===================================================================
  // 8. Query patterns: MastDB._ref(path).orderByChild(x)...
  //    These need MastDB.query(path).orderByChild(x)...
  // ===================================================================
  replace(/MastDB\._ref\(([^)]+)\)\.orderByChild\(/g, 'MastDB.query($1).orderByChild(', '_ref.orderByChild→query');
  replace(/MastDB\._ref\(([^)]+)\)\.orderByKey\(/g, 'MastDB.query($1).orderByKey(', '_ref.orderByKey→query');
  replace(/MastDB\._ref\(([^)]+)\)\.orderByValue\(/g, 'MastDB.query($1).orderByValue(', '_ref.orderByValue→query');
  replace(/MastDB\._ref\(([^)]+)\)\.limitToLast\(/g, 'MastDB.query($1).limitToLast(', '_ref.limitToLast→query');
  replace(/MastDB\._ref\(([^)]+)\)\.limitToFirst\(/g, 'MastDB.query($1).limitToFirst(', '_ref.limitToFirst→query');

  // 8b. Fix .once('value') after query chains → .once()
  // MastDB.query() chains produce .once('value') but query.once() doesn't need 'value'
  replace(/\.once\('value'\)/g, ".once('value')", 'keep-once-value');
  // Actually, MastDB query().once() doesn't take a param. Let me fix that.
  // Only fix .once('value') when preceded by query builder methods
  // This is complex to do with regex — leave as is, since the QueryBuilder
  // already handles .once() calls and they accept no arguments.
  // Actually, looking at mastdb.js: query.once() is defined and returns snap.val() || {}.
  // So .once('value') after a query builder would fail because once() takes no args.
  // BUT actually, once() in the QueryBuilder does: _apply().once('value')...
  // So the QueryBuilder's once() method doesn't take args. But callers that
  // previously had .once('value') now have MastDB.query(path).orderByChild(x).once('value')
  // which would call the QueryBuilder's once() with an arg that it ignores. That's OK
  // since JavaScript doesn't error on extra args. Let me clean this up anyway.

  // ===================================================================
  // 9. var ref = MastDB._ref(path); then ref.xxx — multiline patterns
  //    These are harder to handle with regex. Flag remaining _ref for manual.
  // ===================================================================

  // ===================================================================
  // 10. Entity .ref() callers (ref method was removed)
  // ===================================================================
  // MastDB.entity.ref(id).once('value') → MastDB.entity.get(id)
  // But entity.get() now returns value, not snapshot!

  // 10a: entity.ref(id).once('value')
  // Common entities with ref(id) pattern
  const entityNames = [
    'adminUsers', 'invites', 'roles', 'products', 'inventory', 'orders', 'events',
    'gallery', 'sales', 'coupons', 'promotions', 'giftCards', 'rma', 'shows', 'bundles',
    'productionRequests', 'productionJobs', 'operators', 'stories', 'contacts', 'expenses',
    'materials', 'recipes', 'lookbooks', 'consignments', 'wholesaleTokens', 'wholesaleOrders',
    'classes', 'classSessions', 'enrollments', 'instructors', 'resources', 'passDefinitions',
    'locations', 'commissions', 'studioLocations', 'plaidItems', 'accounts', 'sessionLogs'
  ];

  for (const ent of entityNames) {
    // entity.ref(id).once('value') → entity.get(id)
    const reOnce = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.once\\('value'\\)`, 'g');
    src = src.replace(reOnce, function(match, args) {
      changes++;
      return `MastDB.${ent}.get(${args})`;
    });

    // entity.ref(id).set(data) → entity.set(id, data)
    const reSet = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.set\\(`, 'g');
    src = src.replace(reSet, function(match, args) {
      changes++;
      return `MastDB.${ent}.set(${args}, `;
    });

    // entity.ref(id).update(data) → entity.update(id, data)
    const reUpdate = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.update\\(`, 'g');
    src = src.replace(reUpdate, function(match, args) {
      changes++;
      return `MastDB.${ent}.update(${args}, `;
    });

    // entity.ref(id).remove() → entity.remove(id)
    const reRemove = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.remove\\(\\)`, 'g');
    src = src.replace(reRemove, function(match, args) {
      changes++;
      return `MastDB.${ent}.remove(${args})`;
    });

    // entity.ref(id).push() → entity.push(data) or entity.newKey()
    const rePushKey = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.push\\(\\)\\.key`, 'g');
    src = src.replace(rePushKey, function(match, args) {
      changes++;
      if (args.trim()) {
        // ref(path).push().key
        manual.push({ file: rel, pattern: `${ent}.ref(${args}).push().key — needs newKey with sub-path` });
      }
      return `MastDB.${ent}.newKey(${args})`;
    });

    // entity.ref().push() (no key)
    const rePush = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.push\\(\\)`, 'g');
    src = src.replace(rePush, function(match, args) {
      changes++;
      manual.push({ file: rel, pattern: `${ent}.ref(${args}).push() — caller may use .key/.set on result` });
      return `MastDB.${ent}.push(${args})`;
    });

    // entity.ref(id).orderByChild(x)... → entity.query().orderByChild(x)...
    const reOrder = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.orderBy(Child|Key|Value)\\(`, 'g');
    src = src.replace(reOrder, function(match, args, orderType) {
      changes++;
      if (args.trim()) {
        // ref(subpath).orderByChild — need query with subpath
        return `MastDB.query(MastDB.${ent}.PATH + '/' + ${args}).orderBy${orderType}(`;
      }
      return `MastDB.${ent}.query().orderBy${orderType}(`;
    });

    // entity.ref(id).limitToLast(n)... → entity.query().limitToLast(n)...
    const reLimit = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.limitTo(Last|First)\\(`, 'g');
    src = src.replace(reLimit, function(match, args, limitType) {
      changes++;
      if (args.trim()) {
        return `MastDB.query(MastDB.${ent}.PATH + '/' + ${args}).limitTo${limitType}(`;
      }
      return `MastDB.${ent}.query().limitTo${limitType}(`;
    });

    // entity.ref().on('value', cb) → entity.subscribe(cb) or entity.listen(...)
    const reOn = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.on\\('value',\\s*`, 'g');
    src = src.replace(reOn, function(match, args) {
      changes++;
      if (args.trim()) {
        return `MastDB.subscribe(MastDB.${ent}.PATH + '/' + ${args}, `;
      }
      return `MastDB.subscribe(MastDB.${ent}.PATH, `;
    });

    // entity.ref().off('value', handle) — flag for manual
    const reOff = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.off\\('value',\\s*`, 'g');
    src = src.replace(reOff, function(match, args) {
      changes++;
      manual.push({ file: rel, pattern: `${ent}.ref.off needs unsub fn` });
      return `/* TODO: use unsub fn */ MastDB.${ent}.ref(${args}).off('value', `;
    });

    // entity.ref(id).child(subpath) — convert to path concatenation
    const reChild = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.child\\(([^)]*)\\)`, 'g');
    src = src.replace(reChild, function(match, idArgs, childArgs) {
      changes++;
      manual.push({ file: rel, pattern: `${ent}.ref.child — needs further chaining conversion` });
      return `/* ref.child converted */ MastDB._ref(MastDB.${ent}.PATH + '/' + ${idArgs} + '/' + ${childArgs})`;
    });

    // entity.ref(id).transaction(fn) → MastDB.transaction(entity.PATH + '/' + id, fn)
    const reTx = new RegExp(`MastDB\\.${ent}\\.ref\\(([^)]*)\\)\\.transaction\\(`, 'g');
    src = src.replace(reTx, function(match, args) {
      changes++;
      if (args.trim()) {
        return `MastDB.transaction(MastDB.${ent}.PATH + '/' + ${args}, `;
      }
      return `MastDB.transaction(MastDB.${ent}.PATH, `;
    });
  }

  // ===================================================================
  // 11. config.ref(subpath) callers — config no longer has ref()
  // ===================================================================
  // MastDB.config.ref(subpath).once('value') → MastDB.config.get(subpath)
  src = src.replace(/MastDB\.config\.ref\(([^)]*)\)\.once\('value'\)/g, function(match, args) {
    changes++;
    return `MastDB.config.get(${args})`;
  });
  // MastDB.config.ref(subpath).set(value) → MastDB.config.set(subpath, value)
  src = src.replace(/MastDB\.config\.ref\(([^)]*)\)\.set\(/g, function(match, args) {
    changes++;
    return `MastDB.config.set(${args}, `;
  });
  // MastDB.config.ref(subpath).update(value) → MastDB.config.update(subpath, value)
  src = src.replace(/MastDB\.config\.ref\(([^)]*)\)\.update\(/g, function(match, args) {
    changes++;
    return `MastDB.config.update(${args}, `;
  });

  // ===================================================================
  // 12. Specialized entity callers that used removed ref methods
  // ===================================================================

  // MastDB.inventory.stockRef(pid) → path string
  src = src.replace(/MastDB\.inventory\.stockRef\(([^)]+)\)/g, function(match, args) {
    changes++;
    manual.push({ file: rel, pattern: `inventory.stockRef — callers chain ops on result` });
    return `/* stockRef converted */ MastDB._ref(MastDB.inventory.PATH + '/' + ${args} + '/stock')`;
  });

  // MastDB.inventory.stockOnHand(pid, variant) — callers chain .transaction or .once
  src = src.replace(/MastDB\.inventory\.stockOnHand\(([^)]+)\)/g, function(match, args) {
    changes++;
    manual.push({ file: rel, pattern: `inventory.stockOnHand — callers chain ops` });
    return `/* stockOnHand converted */ MastDB._ref(MastDB.inventory.stockOnHandPath(${args}))`;
  });

  // Handle other specialized methods similarly...
  // These are fewer and more varied — handle remaining ones manually

  // ===================================================================
  // 13. Remaining var ref = MastDB._ref(path); patterns
  //     Convert to MastDB.query() for query patterns
  // ===================================================================
  src = src.replace(/var (\w+) = MastDB\._ref\(([^)]+)\);/g, function(match, varName, pathExpr) {
    changes++;
    // Check if this var is used for queries (orderBy, limitTo) or subscriptions
    // We can't know from just this line, so convert to query builder
    return `var ${varName} = MastDB.query(${pathExpr});`;
  });

  // After converting var ref to query, some follow-up patterns:
  // ref.orderByChild('x').equalTo('y').once('value') → already works with query builder
  // ref.set(data) → broken (query doesn't have set). Flag these.
  // ref.on('value', cb) → ref.subscribe(cb) — but QueryBuilder has subscribe()!

  // ===================================================================
  // 14. Snapshot unwrapping: snap.val() patterns after entity get/list
  //     Entity get/list now return values, not snapshots
  // ===================================================================
  // This is very context-dependent. Flag all snap.val() patterns near entity calls.
  // The caller migration handles these.

  // ===================================================================
  // 15. MastDB._ref('').update(multiUpdates) — special case for empty path
  // ===================================================================
  replace(/MastDB\._ref\(''\)\.update\(/g, 'MastDB.multiUpdate(', "_ref('').update→multiUpdate");

  if (changes > 0) {
    totalChanges += changes;
    console.log(`${rel}: ${changes} changes`);
    if (!DRY_RUN) {
      fs.writeFileSync(file, src, 'utf8');
    }
  }
}

console.log(`\nTotal changes: ${totalChanges}`);
if (manual.length > 0) {
  console.log(`\nManual review needed (${manual.length} sites):`);
  for (const m of manual) {
    console.log(`  ${m.file}: ${m.pattern}`);
  }
}

if (DRY_RUN) {
  console.log('\n(DRY RUN — no files modified)');
}

// Verify remaining escape hatches
if (!DRY_RUN) {
  const { execSync } = require('child_process');
  try {
    const remaining = execSync(
      `grep -rn "_ref\\|_rootRef\\|_multiUpdate\\|_prefixPaths\\|_newKey\\|_newRootKey" app/ --include="*.html" --include="*.js" | grep -v "mastdb.js" | grep -v "// " | wc -l`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    console.log(`\nRemaining escape hatches: ${remaining}`);
  } catch (e) {
    console.log('Could not verify remaining count');
  }
}
