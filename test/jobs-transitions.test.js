/**
 * Unit test for the Jobs (production) status transition table.
 * Run: node test/jobs-transitions.test.js
 *
 * jobs-v2-plan.md §3a: the job-status transition rules must be a serializable,
 * function-free table that the UI (jobs-v2.js), the MCP (production.ts), and the
 * CF all agree on. MastFlow only *renders* this table — it is not the authority.
 *
 * This test pins the canonical table and asserts the UI copy (the JOB_TRANSITIONS
 * literal embedded in app/modules/jobs-v2.js) matches it exactly. It is the seed
 * of the cross-repo snapshot guard: when B2 wires the MCP/CF to the same table,
 * their copies assert against this same CANONICAL object.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }
console.log('Jobs status transition table (§3a)');

// ── CANONICAL: the single source of truth for job-status transitions ──
// Mirrors MCP production.ts JOB_TRANSITIONS. Function-free DATA only.
const CANONICAL = {
  'definition': ['in-progress', 'on-hold', 'cancelled'],
  'in-progress': ['completed', 'on-hold', 'cancelled'],
  'on-hold': ['in-progress', 'cancelled'],
  'completed': [],
  'cancelled': []
};

// Extract the JOB_TRANSITIONS object literal from the UI module source (the
// module is a browser IIFE, so we parse rather than require it).
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'modules', 'jobs-v2.js'), 'utf8');
const m = src.match(/var JOB_TRANSITIONS = (\{[\s\S]*?\});/);
assert.ok(m, 'JOB_TRANSITIONS literal not found in jobs-v2.js');
// eslint-disable-next-line no-new-func
const uiTable = (new Function('return ' + m[1]))();

t('UI table matches the canonical transition table (no drift)', () => {
  assert.deepStrictEqual(uiTable, CANONICAL);
});

t('every state is present', () => {
  assert.deepStrictEqual(Object.keys(uiTable).sort(), Object.keys(CANONICAL).sort());
});

t('terminal states have no outgoing transitions', () => {
  assert.deepStrictEqual(uiTable['completed'], []);
  assert.deepStrictEqual(uiTable['cancelled'], []);
});

t('every transition target is itself a known state', () => {
  const states = new Set(Object.keys(uiTable));
  Object.keys(uiTable).forEach((from) => {
    uiTable[from].forEach((to) => {
      assert.ok(states.has(to), `transition ${from} -> ${to} targets an unknown state`);
    });
  });
});

t('the literal is function-free (serializable)', () => {
  assert.ok(!/function|=>/.test(m[1]), 'transition table must contain no functions');
});

console.log('\n' + pass + ' passed');
