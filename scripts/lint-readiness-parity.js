#!/usr/bin/env node
// Product readiness gate parity lint. Run from repo root:
//   node scripts/lint-readiness-parity.js
// Exits 0 if clean, 1 on drift.
//
// shared/product-readiness.core.js is the CANONICAL product readiness gate and
// MUST be byte-identical to src/shared/product-readiness.core.js in
// mast-tenant-mcp-server. Both repos commit this same BLESSED_SHA and verify
// their own copy against it (the MCP does so via a vitest test). That makes the
// AI publish gate and the maker.js UI gate impossible to diverge.
//
// If this fails because you intentionally changed the gate logic:
//   1. make the SAME edit to BOTH repos' product-readiness.core.js,
//   2. recompute the hash (`shasum -a 256 shared/product-readiness.core.js`),
//   3. update BLESSED_SHA here AND in the MCP's product-readiness-parity.test.ts,
//   4. bump MAST_MODULES_V (scripts/bump-modules-version.sh).
// See docs/ux-audit/product-publish-gate-plan.md §7.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// sha256 of the canonical core. Re-bless in BOTH repos when the logic changes.
const BLESSED_SHA = '9dcf533c48b5176b56665f3c9678b12f41428f56eaa5432054a56b9cbaf7b717';

const CORE_PATH = path.join(process.cwd(), 'shared', 'product-readiness.core.js');

if (!fs.existsSync(CORE_PATH)) {
  console.error(`lint-readiness-parity: missing ${CORE_PATH}`);
  process.exit(1);
}

const sha = crypto.createHash('sha256').update(fs.readFileSync(CORE_PATH)).digest('hex');

if (sha !== BLESSED_SHA) {
  console.error('lint-readiness-parity: shared/product-readiness.core.js drifted from the blessed cross-repo SHA.');
  console.error(`  expected: ${BLESSED_SHA}`);
  console.error(`  actual:   ${sha}`);
  console.error('  This file must stay byte-identical to mast-tenant-mcp-server/src/shared/product-readiness.core.js.');
  console.error('  If the change is intentional, update BOTH repos + re-bless the SHA in both parity checks. See §7.');
  process.exit(1);
}

console.log('lint-readiness-parity: shared/product-readiness.core.js matches the blessed SHA ✓');
process.exit(0);
