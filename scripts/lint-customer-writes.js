#!/usr/bin/env node
// Customer email-identity write guard. Run from repo root:
//   node scripts/lint-customer-writes.js
// Exits 0 if clean, 1 if violations found.
//
// Invariant being protected (see docs + the mast-customer-resolver package):
// a storefront-native customer's email is their identity — the same email
// (and any gmail dot/+tag variant of it) MUST resolve to ONE customer record.
// That invariant holds by construction ONLY if every customer-creating path
// goes through the shared resolver (`MastCustomerResolver.resolveCustomer`,
// bundled in shared/customer-resolver.js), which atomically claims the
// `admin/customerIndexes/byEmail/<key>` index before creating.
//
// This guard fails the build if app code (app/index.html or app/modules/*.js)
// writes the byEmail identity index, or creates a full customer record,
// DIRECTLY — bypassing the resolver and its race-safe claim. Such a write
// could re-introduce duplicate-email customers.
//
// The resolver itself lives in shared/customer-resolver.js (a build artifact of
// the @stewartdavidp-ship-it/mast-customer-resolver package) — that file is NOT
// scanned. Genuinely-sanctioned direct writes (e.g. the merge reindex that
// re-points a loser's keys to the winner) must carry an inline acknowledgement
// marker:  // lint-customer-writes-ok: <reason>
// on the same line. Adding a marker is a conscious decision, not an escape hatch.
//
// NOTE: a defense-in-depth Firestore Security Rules guard (reject a colliding
// byEmail key at the DB layer) was deliberately deferred — see the plan /
// diagnosis. This lint is the lighter-weight code-layer guard standing in for it.

const fs = require('fs');
const path = require('path');

const OK_MARKER = 'lint-customer-writes-ok';

// A write (assignment into a multiUpdate map, or .set/.update) to the byEmail
// identity index. The key is usually built by concatenation
// (`'admin/customerIndexes/byEmail/' + k`), so match a bracket-index assignment
// `[ ...byEmail... ] =` or a `.set/.update(` whose first arg is that path.
// Reads — `MastDB.get('...byEmail...')` — use `(` not `[ ] =`, so are not matched.
const BY_EMAIL_WRITE = /\[[^\]]*?customerIndexes\/byEmail[^\]]*\]\s*=/;
const BY_EMAIL_SETLIKE = /\.(set|update)\(\s*['"`][^'"`]*customerIndexes\/byEmail/;

// A full customer-RECORD create/replace: a write whose path ends at the
// customer id with no further subpath (i.e. not `.../emails`, `.../tags` field
// updates). Matches  ['admin/customers/' + id] =   (multiUpdate map assign) or
// .set('admin/customers/' + id) / .ref('admin/customers/' + id).set(...).
const CUSTOMER_RECORD_WRITE =
  /\[\s*['"`]admin\/customers\/['"`]\s*\+\s*[A-Za-z_$][\w$]*\s*\]\s*=/;
const CUSTOMER_RECORD_SETLIKE =
  /\.(set|ref)\(\s*['"`]admin\/customers\/['"`]\s*\+\s*[A-Za-z_$][\w$]*\s*\)/;

function listFiles() {
  const files = [];
  const idx = path.join('app', 'index.html');
  if (fs.existsSync(idx)) files.push(idx);
  const modDir = path.join('app', 'modules');
  if (fs.existsSync(modDir)) {
    for (const f of fs.readdirSync(modDir)) {
      if (f.endsWith('.js')) files.push(path.join(modDir, f));
    }
  }
  return files;
}

const violations = [];
for (const file of listFiles()) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(OK_MARKER)) return; // explicitly acknowledged
    let why = null;
    if (BY_EMAIL_WRITE.test(line) || BY_EMAIL_SETLIKE.test(line)) {
      why = 'writes the byEmail identity index directly';
    } else if (CUSTOMER_RECORD_WRITE.test(line) || CUSTOMER_RECORD_SETLIKE.test(line)) {
      why = 'creates a full customer record directly';
    }
    if (why) violations.push({ file, line: i + 1, why, src: line.trim() });
  });
}

console.log(`Customer-write guard — ${listFiles().length} files scanned`);
if (violations.length === 0) {
  console.log('  Direct customer/byEmail writes (blocking): 0');
  process.exit(0);
}
console.error(`\n✖ ${violations.length} direct customer-identity write(s) bypassing the resolver:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} — ${v.why}`);
  console.error(`    ${v.src}`);
}
console.error(
  `\nRoute customer creation through MastCustomers.resolveCustomer (shared resolver,` +
  `\nwhich atomically claims the byEmail key). If this write is genuinely` +
  `\nsanctioned (e.g. a merge reindex), append an inline marker:` +
  `\n    // ${OK_MARKER}: <reason>\n`
);
process.exit(1);
