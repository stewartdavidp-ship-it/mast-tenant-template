#!/usr/bin/env node
/**
 * lint-no-hardcoded-ids.js — hardcoded-identifier RATCHET (Phase 2 guardrail).
 *
 * Closes the D3-005 / D3-021 finding class. This repo is the SINGLE source of
 * truth for every tenant site — tenant identity, hosting origin, and storage
 * bucket MUST resolve dynamically (storefront-tenant.js / tenant-brand.js /
 * TENANT_CONFIG / TENANT_FIREBASE_CONFIG), never be baked into app code. A
 * hardcoded `*.web.app` origin, `*.appspot.com` bucket, tenant id, or tenant
 * subdomain pins the shared bundle to one tenant and breaks every other.
 * (See CLAUDE.md RULE: "No hardcoded tenant IDs, Firebase configs, or domain
 * names in the template code.")
 *
 * Mechanism (ratchet — mirrors scripts/lint-ux-standards.js): we BASELINE the
 * current per-file violation counts and FAIL any change that INCREASES them.
 * New files are born at 0. `--update` re-locks a lower baseline; numbers can
 * only go down. Target end state (Phase 4): baseline all-zero, then hard-zero.
 *
 * Scope: every .js / .html under app/. Pure-comment lines are ignored (a comment
 * mentioning a domain is documentation, not a baked-in identifier).
 *
 * Metrics:
 *   webApp           foo.web.app                  → resolve origin dynamically
 *   appspotBucket    foo.appspot.com              → use TENANT_FIREBASE_CONFIG.storageBucket
 *   firebaseStorage  foo.firebasestorage.app      → use TENANT_FIREBASE_CONFIG.storageBucket
 *   tenantDomain     foo.runmast.com              → resolve from window.location / config
 *   tenantIdLiteral  tenantId:'foo' / TENANT_ID='foo'  → resolve from storefront-tenant.js
 *
 * Allowlist: platform-wide constants that are intentionally fixed (NOT tenant
 * identity) — help.runmast.com, assets.runmast.com.
 *
 * Usage:
 *   node scripts/lint-no-hardcoded-ids.js           # check (CI/hook) — exit 1 on drift
 *   node scripts/lint-no-hardcoded-ids.js --update  # re-baseline (only lowers)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const BASELINE = path.join(__dirname, 'no-hardcoded-ids-baseline.json');

// Platform-wide constants that are legitimately fixed (not tenant identity).
// Adding here is an acknowledgement that the host is platform-global, not tenant-scoped.
const ALLOWED_HOSTS = new Set([
  'help.runmast.com',
  'assets.runmast.com',
]);

function stripAllowed(line) {
  let s = line;
  for (const h of ALLOWED_HOSTS) s = s.split(h).join('');
  return s;
}

const METRICS = {
  webApp: line => (stripAllowed(line).match(/\b[a-z0-9-]+\.web\.app\b/g) || []).length,
  appspotBucket: line => (line.match(/\b[a-z0-9-]+\.appspot\.com\b/g) || []).length,
  firebaseStorage: line => (line.match(/\b[a-z0-9-]+\.firebasestorage\.app\b/g) || []).length,
  tenantDomain: line => (stripAllowed(line).match(/\b[a-z0-9-]+\.runmast\.com\b/g) || []).length,
  tenantIdLiteral: line =>
    (line.match(/\b(?:tenantId|TENANT_ID|tenant_id)\s*[:=]\s*['"][a-z0-9][a-z0-9_-]+['"]/g) || []).length,
};

// True for lines that are pure comments (single-line // , block-comment body *,
// HTML comment <!-- ) — domain references in prose are documentation, not code.
function isCommentLine(line) {
  const t = line.trim();
  return t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ||
    t.startsWith('<!--') || t.startsWith('*/');
}

function listAppFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(js|html)$/.test(entry.name)) out.push(full);
    }
  })(APP_DIR);
  return out.sort();
}

function countFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = {};
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    for (const [metric, count] of Object.entries(METRICS)) {
      const n = count(line);
      if (n) out[metric] = (out[metric] || 0) + n;
    }
  }
  return out;
}

function scan() {
  const result = {};
  if (!fs.existsSync(APP_DIR)) return result;
  for (const file of listAppFiles()) {
    const counts = countFile(file);
    if (Object.keys(counts).length) result[path.relative(ROOT, file)] = counts;
  }
  return result;
}

const current = scan();

if (process.argv.includes('--update') || !fs.existsSync(BASELINE)) {
  const existed = fs.existsSync(BASELINE);
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log((existed ? 'Re-baselined' : 'Baselined') + ' hardcoded-ids: ' +
    Object.keys(current).length + ' files, ' + total + ' tracked violations.');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const drifts = [];
const improvements = [];

for (const [file, counts] of Object.entries(current)) {
  const base = baseline[file] || {};            // unknown file ⇒ must be 0
  for (const metric of Object.keys(METRICS)) {
    const now = counts[metric] || 0;
    const was = base[metric] || 0;
    if (now > was) drifts.push({ file, metric, was, now });
    else if (now < was) improvements.push({ file, metric, was, now });
  }
}

if (improvements.length) {
  console.log('✓ improvements (run --update to lock in the lower baseline):');
  improvements.forEach(i => console.log('  ' + i.file + '  ' + i.metric + ': ' + i.was + ' → ' + i.now));
}

if (drifts.length) {
  console.error('\n✗ hardcoded-id DRIFT — these increase violations vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + '  ' + d.metric + ': ' + d.was + ' → ' + d.now +
    '   (' + hint(d.metric) + ')'));
  console.error('\nFix: resolve tenant identity, origin, and bucket dynamically — never hardcode.');
  console.error('See storefront-tenant.js / tenant-brand.js / TENANT_CONFIG / TENANT_FIREBASE_CONFIG.');
  process.exit(1);
}

console.log('✓ hardcoded-ids: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);

function hint(m) {
  return {
    webApp: 'resolve the hosting origin dynamically',
    appspotBucket: 'use TENANT_FIREBASE_CONFIG.storageBucket',
    firebaseStorage: 'use TENANT_FIREBASE_CONFIG.storageBucket',
    tenantDomain: 'resolve from window.location / tenant config',
    tenantIdLiteral: 'resolve the tenant id from storefront-tenant.js',
  }[m];
}
