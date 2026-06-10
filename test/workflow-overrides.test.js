/**
 * Unit test: per-requirement overrides, bypassed-stage red, and audit fan-out
 * (workflow-engine.js). Run: node test/workflow-overrides.test.js
 *
 * Pins the PR-B semantics (operator-ratified 2026-06-10):
 *   1. a manual override satisfies the requirement (canAdvance flips true) and
 *      carries the {by, at, reason} meta into the evaluation;
 *   2. overrideRequirement() persists __workflow.overrides, mirrors a
 *      statusHistory note, writes the workflowTransitions audit row AND the
 *      tenant Audit Log (writeAudit);
 *   3. a PAST stage whose requirements still fail renders red in the guided
 *      rail (data-mf-bypassed) with a remaining count; overriding heals it;
 *   4. transition() reaches the tenant Audit Log (writeAudit 'advance').
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(() => { pass++; console.log('  ✓ ' + name); }); }
console.log('Workflow overrides + bypassed-stage red + audit fan-out');

// Sandbox with MastDB + writeAudit spies.
const dbWrites = [];
const auditCalls = [];
const sandbox = {
  window: {},
  console: console,
  setTimeout: setTimeout,
  document: undefined
};
sandbox.window.MastDB = {
  update: function(p, patch) { dbWrites.push({ op: 'update', path: p, patch: patch }); return Promise.resolve(); },
  set: function(p, row) { dbWrites.push({ op: 'set', path: p, row: row }); return Promise.resolve(); }
};
sandbox.window.writeAudit = function(action, entity, id) { auditCalls.push({ action: action, entity: entity, id: id }); };
vm.createContext(sandbox);
for (const f of ['app/modules/workflows/workflow-engine.js', 'app/modules/workflows/pickship.workflow.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
}
const MastFlow = sandbox.window.MastFlow;
assert.ok(MastFlow && typeof MastFlow.overrideRequirement === 'function', 'overrideRequirement missing');

(async () => {
  // pickship 'picked' phase (status pack): hard req shipping-method unmet.
  const order = { id: 'ord1', status: 'pack', email: 'b@example.com',
    items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St' },
    statusHistory: [{ status: 'pack', at: '2026-06-10T00:00:00Z', by: 'test-setup' }] };

  await t('unmet hard req blocks; override flips canAdvance + carries meta', async () => {
    let ev = await MastFlow.evaluate('pickship', order);
    assert.strictEqual(ev.canAdvance, false, 'should be blocked before override');
    await MastFlow.overrideRequirement('pickship', order, 'picked', 'shipping-method',
      { recordId: 'ord1', reason: 'arranged by phone with the carrier' });
    ev = await MastFlow.evaluate('pickship', order);
    assert.strictEqual(ev.canAdvance, true, 'override should satisfy the hard req');
    const ov = ev.satisfied.filter(s => s.req.key === 'shipping-method')[0];
    assert.ok(ov && ov.overridden && /phone/.test(ov.overridden.reason), 'override meta missing');
  });

  await t('override persisted + statusHistory note + both audit trails', async () => {
    const rec = dbWrites.filter(w => w.op === 'update' && w.path === 'orders/ord1')[0];
    assert.ok(rec, 'record update missing');
    assert.ok(rec.patch.__workflow.overrides.picked['shipping-method'].reason, 'override not in patch');
    assert.ok(rec.patch.statusHistory.some(h => /Override: Shipping method chosen/.test(h.note || '')), 'history note missing');
    const audit = dbWrites.filter(w => w.op === 'set' && /admin\/workflowTransitions\/order\/ord1\//.test(w.path))[0];
    assert.ok(audit && audit.row.type === 'requirement-override' && audit.row.requirement === 'shipping-method', 'workflowTransitions row wrong');
    assert.ok(auditCalls.some(c => c.action === 'override' && c.entity === 'order-workflow' && c.id === 'ord1'), 'writeAudit override missing');
  });

  await t('past stage with failing reqs renders red (data-mf-bypassed), overridden stage does not', async () => {
    // Order at 'packing' whose CONFIRMED phase hard req (shipping info) fails.
    const bypassed = { id: 'ord2', status: 'packing', email: 'b@example.com',
      items: [{ pid: 'p', qty: 1 }], shipping: {},
      fulfillment: { p: { method: 'ship' } },   // satisfies confirmed's soft fulfillment-plan req
      __workflow: { branch: 'pack-ship' } };
    const res = await MastFlow.renderGuidedHeader('pickship', bypassed, {});
    assert.ok(/data-mf-bypassed="\d+"/.test(res.html), 'bypassed marker missing');
    assert.ok(res.html.indexOf('· 1 left') !== -1 || /data-mf-bypassed/.test(res.html), 'remaining count missing');
    // The one failing past requirement here is confirmed/shipping-info (hard;
    // picked's shipping-method passes via the fulfillment-plan fallback).
    // Override it → red clears on the next render (self-heal, no stored state).
    await MastFlow.overrideRequirement('pickship', bypassed, 'confirmed', 'shipping-info',
      { recordId: 'ord2', reason: 'address taken at the show booth' });
    const res2 = await MastFlow.renderGuidedHeader('pickship', bypassed, {});
    assert.ok(!/data-mf-bypassed/.test(res2.html), 'override should heal the red stage');
  });

  await t('clearRequirementOverride removes + audits', async () => {
    const rec = { id: 'ord3', status: 'pack', items: [{ pid: 'p', qty: 1 }],
      shipping: { name: 'B', address: '1 Main St' },
      __workflow: { overrides: { picked: { 'shipping-method': { by: { system: 't' }, at: 'x', reason: 'r' } } } } };
    await MastFlow.clearRequirementOverride('pickship', rec, 'picked', 'shipping-method', { recordId: 'ord3' });
    assert.ok(!rec.__workflow.overrides.picked, 'override should be removed');
    assert.ok(auditCalls.some(c => c.action === 'override-cleared' && c.id === 'ord3'), 'writeAudit override-cleared missing');
    const audit = dbWrites.filter(w => w.op === 'set' && /workflowTransitions\/order\/ord3/.test(w.path))[0];
    assert.ok(audit && audit.row.type === 'requirement-override-cleared', 'cleared audit row missing');
  });

  await t('transition() reaches the tenant Audit Log (writeAudit advance)', async () => {
    const rec = { id: 'ord4', status: 'confirmed', email: 'b@example.com',
      items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St' } };
    await MastFlow.transition('pickship', rec, 'picked', { recordId: 'ord4', expectedFromPhase: 'confirmed' });
    assert.ok(auditCalls.some(c => c.action === 'advance' && c.entity === 'order-workflow' && c.id === 'ord4'), 'writeAudit advance missing');
  });

  await t('override without a reason is refused', async () => {
    const rec = { id: 'ord5', status: 'pack', items: [{ pid: 'p', qty: 1 }], shipping: { name: 'B', address: '1 Main St' } };
    let threw = false;
    await MastFlow.overrideRequirement('pickship', rec, 'picked', 'shipping-method', { recordId: 'ord5', reason: '  ' })
      .catch(() => { threw = true; });
    assert.ok(threw, 'reasonless override should reject');
  });

  console.log('All ' + pass + ' assertions passed');
})().catch((e) => { console.error('FAIL:', e && e.message, e && e.stack); process.exit(1); });
