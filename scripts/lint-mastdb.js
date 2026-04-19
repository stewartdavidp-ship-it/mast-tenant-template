#!/usr/bin/env node
// MastDB lint — rejects direct Firebase RTDB access outside the MastDB module.
// Run from repo root:
//   node scripts/lint-mastdb.js
// Exits 0 if clean, 1 if violations found.
//
// Rule: every RTDB read/write must go through MastDB (tenant-scoped) or
// MastDB.platform (for mast-platform/... paths). Direct
// firebase.database().ref(...) outside the MastDB bootstrap (which needs
// firebase.database() once to pass to MastDB.init) is a violation.
//
// Allowed patterns (NOT violations):
//   MastDB.init({ db: firebase.database(), tenantId: TENANT_ID })
//     — legitimate one-call bootstrap
//   var db = window.TENANT_DB || (window.firebase && window.firebase.database())
//     — storefront-theme.js fallback chain used for the same bootstrap
//   firebase.app().database() inside MastDB.init-only context
//   (MastDB internals in shared/mastdb.js use firebase.database.ServerValue.*
//    which doesn't match this lint pattern)
//
// Everything else is a violation: `firebase.database().ref(...)`,
// `var db = firebase.database()` followed by `db.ref(...)`, etc.

const fs = require('fs');
const path = require('path');

const violations = [];
const ROOT = process.cwd();

// Files to scan — every .html and .js in the repo, excluding known infrastructure.
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '_site', 'docs', 'scripts']);
const EXCLUDE_FILES = new Set(['shared/mastdb.js']); // MastDB internals

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const rel = path.relative(ROOT, path.join(dir, entry.name));
      if (EXCLUDE_FILES.has(rel)) continue;
      if (rel.endsWith('.html') || rel.endsWith('.js')) out.push(rel);
    }
  }
}

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Rule 1: direct firebase.database().ref(...) — chained or standalone
    // Violation if the call isn't immediately inside a MastDB.init(...) argument.
    if (/firebase\s*\.\s*database\s*\(\s*\)\s*\.\s*ref\s*\(/.test(line) && !line.includes('mastdb-lint-allow')) {
      violations.push({ file, line: i + 1, msg: 'Direct firebase.database().ref(...) — use MastDB.* ops or MastDB.platform.*' });
    }

    // Rule 2: admin.database().ref(...) (Cloud Functions side, but safety net)
    if (/admin\s*\.\s*database\s*\(\s*\)\s*\.\s*ref\s*\(/.test(line)) {
      violations.push({ file, line: i + 1, msg: 'Direct admin.database().ref(...) — not expected in tenant template' });
    }

    // Rule 2b: {any}App.database().ref(...) / app.database().ref(...) —
    // checkout.js getDb() style helper. Matches `app.database().ref(`,
    // `firebaseApp.database().ref(`, etc. — but NOT MastDB.init calls
    // (those are firebase.database() without .ref chained on same line).
    if (/\w+App\s*\.\s*database\s*\(\s*\)\s*\.\s*ref\s*\(/.test(line)) {
      violations.push({ file, line: i + 1, msg: 'Direct <app>.database().ref(...) bypass — use MastDB.* ops' });
    }

    // Rule 3: `var|const|let db = firebase.database()` outside MastDB.init bootstrap
    // We allow this pattern ONLY when the same file uses `db` solely to pass into
    // MastDB.init. If any later `db.ref(` exists, that's a violation too (below).
    //
    // We skip rule 3 here because the bootstrap pattern is legitimate. Rule 4
    // catches abuse.

    // Rule 4: bare `db.ref(` calls outside MastDB source
    // Matches: `db.ref(`, ` db.ref(`, `\tdb.ref(`. Not matches: `MastDB._ref(`,
    // `baseRef.ref(`, `snap.ref`, `subRef.ref`, etc.
    if (/[^.\w]db\s*\.\s*ref\s*\(/.test(line) || /^\s*db\s*\.\s*ref\s*\(/.test(line)) {
      violations.push({ file, line: i + 1, msg: 'db.ref(...) bypasses MastDB — use MastDB.* operation methods' });
    }

    // Rule 4b: any `xxxDb.ref(` or `_db.ref(` call. Catches custDb, fireDb,
    // wsDb, commDb, _db, this._db, etc. Storage refs are excluded because they
    // come through `.storage().ref(`.
    if (!line.includes('mastdb-lint-allow') &&
        !/storage\(\)\s*\.\s*ref\(/.test(line) &&
        /(^|[^a-zA-Z0-9])(\w*[Dd]b)\s*\.\s*ref\s*\(/.test(line)) {
      var m = line.match(/(\w*[Dd]b)\s*\.\s*ref\s*\(/);
      // Skip plain `db.ref(` — already covered by rule 4
      if (m && m[1] !== 'db') {
        violations.push({ file, line: i + 1, msg: m[1] + '.ref(...) bypasses MastDB — use MastDB.* operation methods' });
      }
    }

    // Rule 2c: bare `app.database().ref(` — `app` is the variable returned
    // from `firebase.app()`. Rule 2b only catches the `\w+App` form.
    if (/\bapp\s*\.\s*database\s*\(\s*\)\s*\.\s*ref\s*\(/.test(line) && !line.includes('mastdb-lint-allow')) {
      violations.push({ file, line: i + 1, msg: 'app.database().ref(...) bypass — use MastDB.* ops' });
    }

    // Rule 5: MastDB escape hatch methods outside mastdb.js
    // These were the Phase A compat shims — Phase B.1 eliminated all external uses.
    if (/MastDB\._ref\(/.test(line) && !line.includes('mastdb-lint-allow')) {
      violations.push({ file, line: i + 1, msg: 'MastDB._ref() escape hatch — use MastDB.get/set/query/subscribe/etc.' });
    }
    if (/MastDB\._(rootRef|multiUpdate|prefixPaths|newKey|newRootKey)\(/.test(line) && !line.includes('mastdb-lint-allow')) {
      violations.push({ file, line: i + 1, msg: 'MastDB escape hatch — use MastDB operation API instead' });
    }

    // Rule 6: firebase.database.ServerValue — use MastDB.serverTimestamp()/serverIncrement()
    if (/firebase\.database\.ServerValue/.test(line) && !line.includes('mastdb-lint-allow')) {
      violations.push({ file, line: i + 1, msg: 'firebase.database.ServerValue — use MastDB.serverTimestamp() or MastDB.serverIncrement()' });
    }
  }
}

const files = [];
walk(ROOT, files);
files.forEach(checkFile);

if (violations.length === 0) {
  console.log('MastDB lint: clean ✓');
  console.log('  Scanned ' + files.length + ' .html/.js files.');
  process.exit(0);
}

console.error('MastDB lint: ' + violations.length + ' violation(s):');
for (const v of violations) {
  console.error('  ' + v.file + ':' + v.line + ' — ' + v.msg);
}
console.error('');
console.error('Every RTDB access must go through MastDB. Use MastDB.get/set/update/');
console.error('push/remove/multiUpdate/query/subscribe/transaction, or MastDB.platform.*');
console.error('for mast-platform/... paths. See ~/.claude/plans/mast-db-abstraction/');
console.error('phase-a-prework-4-storefront-ref-refactor.md for the full operation API.');
process.exit(1);
