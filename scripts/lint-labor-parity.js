#!/usr/bin/env node
// Labor-cost salary-proration parity tripwire. Run from repo root:
//   node scripts/lint-labor-parity.js
// Exits 0 if clean, 1 on drift.
//
// app/modules/team-v2.js (_burdenEstimateWagesCents) is the CANONICAL admin-UI
// salaried labor formula:
//   laborCostCents = round(monthlyCents * inclusiveDays / 30.4375)
// The MCP tool team_get_labor_cost (mast-mcp-server src/tools/mast-team.ts →
// salaryLaborCents) MUST compute the same thing. They diverged once — the UI
// pro-rated, the MCP returned a flat monthly rate regardless of period
// (QA-spine F7). This guard pins the UI formula so an edit here can't silently
// re-open that divergence; the MCP half is pinned by team-labor-cost.test.ts.
//
// If this fails because you intentionally changed the UI proration:
//   1. make the SAME change to mast-mcp-server salaryLaborCents,
//   2. update its pinned values in mast-mcp-server team-labor-cost.test.ts,
//   3. recompute the hash below and update BLESSED_SHA.
// (Lighter analog of lint-readiness-parity.js — pins the formula, not a whole
// shared file; see also docs/ux-audit/qa-spine for the F6/F7 findings.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// sha256 of the normalized (comment-stripped, whitespace-collapsed) salary
// branch of _burdenEstimateWagesCents. Re-bless when the formula changes.
const BLESSED_SHA = '24bc466dfc8561ddc01abb00696ea700ed5cbde9b5886c5532c126b2bb5222d7';

const TEAM_PATH = path.join(process.cwd(), 'app', 'modules', 'team-v2.js');

if (!fs.existsSync(TEAM_PATH)) {
  console.error(`lint-labor-parity: missing ${TEAM_PATH}`);
  process.exit(1);
}

const src = fs.readFileSync(TEAM_PATH, 'utf8');

// Capture the salary branch: `if (emp.payType === 'salary') { … }` up to its
// 4-space-indented closing brace.
const match = src.match(/if \(emp\.payType === 'salary'\) \{[\s\S]*?\n {4}\}/);
if (!match) {
  console.error('lint-labor-parity: could not find the salary branch in app/modules/team-v2.js');
  console.error('  (_burdenEstimateWagesCents → if (emp.payType === "salary") { … }).');
  console.error('  If the labor estimator moved/renamed, point this guard at it and re-bless.');
  process.exit(1);
}

// Pin the MATH only: strip line comments + collapse whitespace, so comment and
// formatting edits don't trip the guard, but any change to the proration does.
const normalized = match[0]
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const sha = crypto.createHash('sha256').update(normalized).digest('hex');

if (sha !== BLESSED_SHA) {
  console.error('lint-labor-parity: app/modules/team-v2.js salary proration drifted from the blessed formula.');
  console.error(`  expected: ${BLESSED_SHA}`);
  console.error(`  actual:   ${sha}`);
  console.error(`  normalized: ${normalized}`);
  console.error('  If intentional: mirror it in mast-mcp-server salaryLaborCents +');
  console.error('  team-labor-cost.test.ts, then re-bless BLESSED_SHA here. See QA-spine F7.');
  process.exit(1);
}

console.log('lint-labor-parity: app/modules/team-v2.js salary proration matches the blessed formula ✓');
process.exit(0);
