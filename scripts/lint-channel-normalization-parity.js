#!/usr/bin/env node
// Revenue channel-normalization parity lint. Run from repo root:
//   node scripts/lint-channel-normalization-parity.js
// Exits 0 if clean, 1 on drift.
//
// shared/channel-normalization.core.js is the CANONICAL revenue channel
// taxonomy and MUST be byte-identical to src/shared/channel-normalization.core.js
// in mast-mcp-server. Both repos commit this same BLESSED_SHA and verify their
// own copy against it (the MCP does so via a vitest test). That makes the
// finance UI breakdown and the MCP finance_get_revenue / finance_get_pnl
// aggregators impossible to diverge — they collapse the same `source` synonyms
// onto the same canonical channel key.
//
// If this fails because you intentionally changed the taxonomy:
//   1. make the SAME edit to BOTH repos' channel-normalization.core.js,
//   2. recompute the hash (`shasum -a 256 shared/channel-normalization.core.js`),
//   3. update BLESSED_SHA here AND in the MCP's channel-normalization.test.ts,
//   4. re-run scripts/gen-cache-bust.mjs (re-stamps the <head> tag's ?v= hash).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// sha256 of the canonical core. Re-bless in BOTH repos when the taxonomy changes.
const BLESSED_SHA = 'df5b81d60c5c902265fc080ce3cf9d0dd78cb0fd5c961dff8637a5bae767f44c';

const CORE_PATH = path.join(process.cwd(), 'shared', 'channel-normalization.core.js');

if (!fs.existsSync(CORE_PATH)) {
  console.error(`lint-channel-normalization-parity: missing ${CORE_PATH}`);
  process.exit(1);
}

const sha = crypto.createHash('sha256').update(fs.readFileSync(CORE_PATH)).digest('hex');

if (sha !== BLESSED_SHA) {
  console.error('lint-channel-normalization-parity: shared/channel-normalization.core.js drifted from the blessed cross-repo SHA.');
  console.error(`  expected: ${BLESSED_SHA}`);
  console.error(`  actual:   ${sha}`);
  console.error('  This file must stay byte-identical to mast-mcp-server/src/shared/channel-normalization.core.js.');
  console.error('  If the change is intentional, update BOTH repos + re-bless the SHA in both parity checks.');
  process.exit(1);
}

// Behavioral pin — load the canonical core and assert the contract the SHA is
// guarding. Catches the case where a future edit changes the bytes AND the SHA
// together but breaks the map (the SHA alone can't see semantics).
require(CORE_PATH);
const C = globalThis.MastChannels;
if (!C || typeof C.normalize !== 'function') {
  console.error('lint-channel-normalization-parity: core loaded but globalThis.MastChannels.normalize is missing.');
  process.exit(1);
}

const CASES = [
  ['online', 'dtc_online'],
  ['Online Store', 'dtc_online'],   // raw Shopify channel label
  ['pos', 'in_person'],
  ['direct-pos', 'in_person'],      // legacy POS default
  ['direct', 'in_person'],
  ['phone', 'phone'],
  ['manual', 'manual'],
  ['etsy', 'marketplace'],
  ['consignment', 'wholesale'],
  ['instagram', 'social'],
  ['', 'other'],
];

const failures = CASES.filter(function (c) { return C.normalize(c[0]) !== c[1]; });
if (failures.length) {
  console.error('lint-channel-normalization-parity: normalize() map drifted from the pinned contract:');
  failures.forEach(function (c) {
    console.error(`  normalize(${JSON.stringify(c[0])}) => ${JSON.stringify(C.normalize(c[0]))} (expected ${JSON.stringify(c[1])})`);
  });
  process.exit(1);
}

// The reported sgtest15 fragmentation must collapse without changing the total.
const baseline = { online: 202256, 'Online Store': 13600, pos: 460000, phone: 4800000, manual: 3750000, 'direct-pos': 60000 };
const collapsed = {};
let total = 0;
Object.keys(baseline).forEach(function (k) {
  const ck = C.normalize(k);
  collapsed[ck] = (collapsed[ck] || 0) + baseline[k];
  total += baseline[k];
});
const expectCollapsed = { dtc_online: 215856, in_person: 520000, phone: 4800000, manual: 3750000 };
if (total !== 9285856 || JSON.stringify(collapsed) !== JSON.stringify(expectCollapsed)) {
  console.error('lint-channel-normalization-parity: baseline collapse regressed.');
  console.error(`  total: ${total} (expected 9285856)`);
  console.error(`  collapsed: ${JSON.stringify(collapsed)}`);
  console.error(`  expected:  ${JSON.stringify(expectCollapsed)}`);
  process.exit(1);
}

console.log('lint-channel-normalization-parity: shared/channel-normalization.core.js matches the blessed SHA + contract ✓');
process.exit(0);
