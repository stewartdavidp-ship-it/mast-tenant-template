/**
 * Unit test: guided-header branch-choice row (workflow-engine.js).
 * Run: node test/guided-header-branch.test.js
 *
 * The guided rail blocks forward clicks at a branch point (the operator must
 * pick a path), so renderGuidedHeader must surface the branch choices as a
 * pill row — without it the guided header dead-ends (the reason pickship
 * surfaces couldn't opt in). Pins:
 *   1. at a branch point with hard reqs met → row present, one enabled button
 *      per choice, branch-point label shown;
 *   2. at a branch point with hard reqs UNMET → buttons disabled + "to do" hint;
 *   3. NOT at a branch point → no row.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(() => { pass++; console.log('  ✓ ' + name); }); }
console.log('Guided header branch-choice row');

// Load the engine + the pickship spec (a real branching workflow) in a sandbox.
const sandbox = { window: {}, console: console, setTimeout: setTimeout, document: undefined };
vm.createContext(sandbox);
for (const f of ['app/modules/workflows/workflow-engine.js', 'app/modules/workflows/pickship.workflow.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
}
const MastFlow = sandbox.window.MastFlow;
assert.ok(MastFlow && typeof MastFlow.renderGuidedHeader === 'function', 'renderGuidedHeader missing');

// pickship branch point = phase 'picked' (status 'pack'); its hard exit req is
// a chosen shipping method (shipping.method).
const atBranchReady = { id: 'o1', status: 'pack', email: 'b@example.com',
  items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St', method: 'usps' } };
const atBranchBlocked = { id: 'o2', status: 'pack', email: 'b@example.com',
  items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St' } };
const notBranch = { id: 'o3', status: 'confirmed', email: 'b@example.com',
  items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St' } };

(async () => {
  await t('branch point + reqs met → enabled choice pills with branch label', async () => {
    const res = await MastFlow.renderGuidedHeader('pickship', atBranchReady, {});
    assert.ok(res.evaluation.isBranchPoint, 'expected branch point');
    assert.ok(res.html.includes('data-mf-branchrow'), 'branch row missing');
    assert.ok(res.html.includes('How is this order fulfilling?'), 'branch-point label missing');
    for (const label of ['Pack &amp; ship', 'Customer pickup', 'Vendor dropship']) {
      assert.ok(res.html.includes(label), 'choice missing: ' + label);
    }
    // Enabled: the pills must NOT be disabled and must wire the branch handler.
    const row = res.html.split('data-mf-branchrow')[1].split('</div>')[0];
    assert.ok(!/disabled /.test(row), 'choices unexpectedly disabled');
    assert.ok(row.includes('MastFlow.__ui.branch('), 'branch handler not wired');
  });

  await t('branch point + hard reqs unmet → disabled pills with reason', async () => {
    const res = await MastFlow.renderGuidedHeader('pickship', atBranchBlocked, {});
    assert.ok(res.evaluation.isBranchPoint, 'expected branch point');
    const row = res.html.split('data-mf-branchrow')[1].split('</div>')[0];
    assert.ok(/disabled /.test(row), 'choices should be disabled');
    assert.ok(row.includes('to do first'), 'blocked reason missing');
  });

  await t('non-branch phase → no branch row', async () => {
    const res = await MastFlow.renderGuidedHeader('pickship', notBranch, {});
    assert.ok(!res.evaluation.isBranchPoint, 'should not be a branch point');
    assert.ok(!res.html.includes('data-mf-branchrow'), 'branch row should be absent');
  });

  console.log('All ' + pass + ' assertions passed');
})().catch((e) => { console.error('FAIL:', e && e.message); process.exit(1); });
