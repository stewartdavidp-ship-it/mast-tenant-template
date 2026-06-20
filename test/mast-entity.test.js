/** Unit tests for shared/mast-entity.js schema derivations. Run: node test/mast-entity.test.js */
const assert = require('assert');
const E = require('../shared/mast-entity.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }
console.log('MastEntity schema engine');

const ORDER = {
  label: 'Order', labelPlural: 'Orders',
  fields: [
    { name: 'number', label: 'Order', type: 'text', list: true, required: true },
    { name: 'customer', label: 'Customer', type: 'text', list: true },
    { name: 'items', label: 'Items', type: 'number', list: true },
    { name: 'total', label: 'Total', type: 'money', list: true },
    { name: 'placedAt', label: 'Placed', type: 'date' },
    { name: 'status', label: 'Status', type: 'status', list: true, tone: v => v === 'refunded' ? 'danger' : 'amber' },
  ]
};
E.define('order', ORDER);

// registration / validation of the SCHEMA (fail-loud)
t('define returns schema + get retrieves it', () => { assert.strictEqual(E.get('order').label, 'Order'); });
t('define throws on empty fields', () => assert.throws(() => E.define('bad', { fields: [] })));
t('define throws on duplicate field', () => assert.throws(() => E.define('bad', { fields: [{ name: 'a', label: 'A' }, { name: 'a', label: 'A2' }] })));
t('define throws on >1 status field', () => assert.throws(() => E.define('bad', { fields: [{ name: 's1', label: 'S1', type: 'status' }, { name: 's2', label: 'S2', type: 'status' }] })));

// list columns derived from list:true, with align inference + sortable default
t('listColumns picks list:true only, infers right-align for numerics', () => {
  const cols = E.listColumns('order');
  assert.deepStrictEqual(cols.map(c => c.key), ['number', 'customer', 'items', 'total', 'status']);
  assert.strictEqual(cols.find(c => c.key === 'total').align, 'right');
  assert.strictEqual(cols.find(c => c.key === 'items').align, 'right');
  assert.strictEqual(cols.find(c => c.key === 'customer').align, 'left');
  assert.strictEqual(cols[0].sortable, true);
});

// canonical export values — the round-trip guarantee (raw, no symbols)
t('canonicalGet money is raw 2dp (no $/commas)', () => assert.strictEqual(E.canonicalGet(ORDER.fields[3], { total: 102000 }), '102000.00'));
t('canonicalGet date is ISO', () => assert.strictEqual(E.canonicalGet(ORDER.fields[4], { placedAt: '2026-05-01T13:00:00Z' }), '2026-05-01'));
t('canonicalGet number is plain', () => assert.strictEqual(E.canonicalGet(ORDER.fields[2], { items: 12 }), '12'));
t('canonicalGet null → empty', () => assert.strictEqual(E.canonicalGet(ORDER.fields[3], {}), ''));

// exportColumns = every field, canonical (round-trips with import template)
t('exportColumns covers all fields with canonical get', () => {
  const cols = E.exportColumns('order');
  assert.strictEqual(cols.length, 6);
  assert.strictEqual(cols[3].get({ total: 7500 }), '7500.00');
});

// record validation
t('validate flags missing required', () => {
  const r = E.validate('order', { customer: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].includes('Order'));
});
t('validate flags non-numeric money', () => assert.strictEqual(E.validate('order', { number: 'A1', total: 'abc' }).ok, false));
t('validate passes a good record', () => assert.strictEqual(E.validate('order', { number: 'SGTE-1', total: 45 }).ok, true));

// ── conversion-backlog schema: a Faceted Record with computed columns + custom
//    interiors (promotions-v2). Exercises get()-driven list columns + that a
//    schema may declare detail.render/editRender without breaking derivations. ──
const SALE = {
  label: 'Sale', labelPlural: 'Promotions',
  recordId: s => s._key || s.id,
  fields: [
    { name: 'name', label: 'Name', type: 'text', list: true, required: true },
    { name: 'discount', label: 'Discount', type: 'text', list: true, readOnly: true,
      get: s => s.discountType === 'percent' ? s.discountValue + '% off' : '$' + (s.discountValue / 100).toFixed(2) + ' off' },
    { name: 'productCount', label: 'Products', type: 'number', list: true, readOnly: true,
      get: s => (s.products || []).length },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true, options: ['active', 'scheduled', 'ended'] },
  ],
  detail: { render: () => '<custom-read>', editRender: () => '<custom-edit>' },
};
E.define('sale', SALE);
t('schema with detail.render/editRender registers and keeps derivations', () => {
  const s = E.get('sale');
  assert.strictEqual(typeof s.detail.render, 'function');
  assert.strictEqual(typeof s.detail.editRender, 'function');
});
t('list columns honor get() for computed fields', () => {
  const cols = E.listColumns('sale');
  assert.deepStrictEqual(cols.map(c => c.key), ['name', 'discount', 'productCount', 'status']);
  assert.strictEqual(cols.find(c => c.key === 'productCount').align, 'right');
});
t('canonicalGet uses get() for a computed column', () => {
  const f = SALE.fields[1];
  assert.strictEqual(E.canonicalGet(f, { discountType: 'percent', discountValue: 20 }), '20% off');
});
t('validate requires name on the sale schema', () => assert.strictEqual(E.validate('sale', { discountValue: 5 }).ok, false));

// ── read-only Faceted Record (trips-v2): all columns computed via get(), a
//    detail.render custom interior, and NO onSave (view-only surface). ──
const TRIP = {
  label: 'Trip', labelPlural: 'Trips',
  recordId: t => t.id,
  fields: [
    { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, get: t => t.startTime },
    { name: 'destination', label: 'Destination', type: 'text', list: true, readOnly: true, get: t => (t.destination && t.destination.label) || '—' },
    { name: 'miles', label: 'Miles', type: 'number', list: true, readOnly: true, get: t => t.miles || 0 },
    { name: 'deductible', label: 'Deductible', type: 'money', list: true, readOnly: true, get: t => t.deductibleValue || 0 },
  ],
  detail: { render: () => '<trip-read>' },
};
E.define('trip', TRIP);
t('read-only schema: computed date column + money align, custom render, no onSave', () => {
  const cols = E.listColumns('trip');
  assert.deepStrictEqual(cols.map(c => c.key), ['date', 'destination', 'miles', 'deductible']);
  assert.strictEqual(cols.find(c => c.key === 'deductible').align, 'right');
  assert.strictEqual(typeof E.get('trip').detail.render, 'function');
  assert.strictEqual(E.get('trip').onSave, undefined);
});
t('canonicalGet formats a computed money column from get()', () => {
  assert.strictEqual(E.canonicalGet(TRIP.fields[3], { deductibleValue: 12.5 }), '12.50');
});

// ── Faceted Record with a materialized status badge + custom interiors + onSave
//    (finance-expenses-v2). status is a real property (engine reads it directly
//    for the header badge), amount is cents→dollars via get(). ──
const EXPENSE = {
  label: 'Expense', labelPlural: 'Expenses',
  recordId: e => e._id,
  fields: [
    { name: 'merchant', label: 'Merchant', type: 'text', list: true, readOnly: true },
    { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, get: e => e.date },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
      options: ['approved', 'review'], tone: v => v === 'approved' ? 'success' : 'amber' },
    { name: 'amount', label: 'Amount', type: 'money', list: true, readOnly: true, get: e => (e.amount || 0) / 100 },
  ],
  detail: { render: () => '<exp-read>', editRender: () => '<exp-edit>' },
  onSave: () => true,
};
E.define('expense', EXPENSE);
t('expense schema: single status field, cents→dollars money, custom interiors + onSave', () => {
  const s = E.get('expense');
  const cols = E.listColumns('expense');
  assert.deepStrictEqual(cols.map(c => c.key), ['merchant', 'date', 'status', 'amount']);
  assert.strictEqual(cols.find(c => c.key === 'amount').align, 'right');
  assert.strictEqual(E.canonicalGet(EXPENSE.fields[3], { amount: 4250 }), '42.50');
  assert.strictEqual(typeof s.detail.editRender, 'function');
  assert.strictEqual(typeof s.onSave, 'function');
});
t('expense status tone resolves from the materialized value', () => {
  assert.strictEqual(EXPENSE.fields[2].tone('approved'), 'success');
  assert.strictEqual(EXPENSE.fields[2].tone('review'), 'amber');
});

// ── read-only Faceted Record with an explicit right-aligned TEXT column
//    (team-v2 'pay' is text but align:'right') + materialized status, no onSave. ──
const EMPLOYEE = {
  label: 'Employee', labelPlural: 'Team',
  recordId: e => e._key,
  fields: [
    { name: 'fullName', label: 'Name', type: 'text', list: true, readOnly: true },
    { name: 'jobTitle', label: 'Title', type: 'text', list: true, readOnly: true, get: e => e.jobTitle || '—' },
    { name: 'pay', label: 'Pay', type: 'text', list: true, readOnly: true, align: 'right', get: e => e.payRate ? '$' + e.payRate : 'not set' },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
      options: ['active', 'terminated'], tone: v => v === 'terminated' ? 'danger' : 'success' },
  ],
  detail: { render: () => '<emp-read>' },
};
E.define('employee', EMPLOYEE);
t('employee schema: explicit align overrides type default, custom render, no onSave', () => {
  const cols = E.listColumns('employee');
  // a text column normally left-aligns; explicit align:'right' must win
  assert.strictEqual(cols.find(c => c.key === 'pay').align, 'right');
  assert.strictEqual(cols.find(c => c.key === 'fullName').align, 'left');
  assert.strictEqual(typeof E.get('employee').detail.render, 'function');
  assert.strictEqual(E.get('employee').onSave, undefined);
});

// ── read-only transaction-shaped record with a computed status column derived
//    from line quantities (procurement-v2). status get() collapses to 'partial';
//    total get() sums line items (dollars). ──
const PO = {
  label: 'Purchase order', labelPlural: 'Procurement',
  recordId: po => po.poId,
  fields: [
    { name: 'poNumber', label: 'PO #', type: 'text', list: true, readOnly: true },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
      options: ['draft', 'partially_received', 'received'],
      get: po => po.status === 'partially_received' ? 'partial' : po.status,
      tone: v => v === 'received' ? 'success' : v === 'partial' ? 'amber' : 'neutral' },
    { name: 'total', label: 'Total', type: 'money', list: true, readOnly: true,
      get: po => (po.lines || []).reduce((s, l) => s + (l.qtyOrdered || 0) * (l.unitCost || 0), 0) },
  ],
  detail: { render: () => '<po-read>' },
};
E.define('po', PO);
t('PO schema: derived status column collapses partially_received→partial, total sums lines', () => {
  const f = PO.fields[1];
  assert.strictEqual(f.get({ status: 'partially_received' }), 'partial');
  assert.strictEqual(f.tone('partial'), 'amber');
  assert.strictEqual(E.canonicalGet(PO.fields[2], { lines: [{ qtyOrdered: 3, unitCost: 12.5 }, { qtyOrdered: 2, unitCost: 5 }] }), '47.50');
  assert.strictEqual(E.get('po').onSave, undefined);
});

// ── Faceted Record with custom interiors + a delegating onSave (materials-v2);
//    unitCost is dollars, required name, status badge. ──
const MATERIAL = {
  label: 'Material', labelPlural: 'Materials',
  recordId: m => m._key,
  fields: [
    { name: 'name', label: 'Name', type: 'text', list: true, required: true },
    { name: 'unitCost', label: 'Unit cost', type: 'money', list: true, readOnly: true, get: m => m.unitCost || 0 },
    { name: 'onHand', label: 'On hand', type: 'number', list: true, readOnly: true, get: m => m.onHandQty || 0 },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
      options: ['active', 'archived'], tone: v => v === 'archived' ? 'neutral' : 'success' },
  ],
  detail: { render: () => '<mat-read>', editRender: () => '<mat-edit>' },
  onSave: () => true,
};
E.define('material', MATERIAL);
t('material schema: dollar unit cost, required name, custom interiors + delegating onSave', () => {
  assert.strictEqual(E.canonicalGet(MATERIAL.fields[1], { unitCost: 18.5 }), '18.50');
  assert.strictEqual(E.validate('material', { unitCost: 5 }).ok, false);   // name required
  assert.strictEqual(E.validate('material', { name: 'Gold wire' }).ok, true);
  assert.strictEqual(typeof E.get('material').detail.editRender, 'function');
  assert.strictEqual(typeof E.get('material').onSave, 'function');
});

// ── Faceted Record with an interactive thread interior, no onSave (cs-tickets-v2):
//    status is a free-select attribute (not gated), all columns computed. ──
const TICKET = {
  label: 'Ticket', labelPlural: 'Tickets',
  recordId: t => t.id,
  fields: [
    { name: 'subject', label: 'Subject', type: 'text', list: true, readOnly: true, get: t => t.subject || 'No subject' },
    { name: 'from', label: 'From', type: 'text', list: true, readOnly: true, get: t => t.contactName || t.contactEmail || 'Unknown' },
    { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
      options: ['open', 'in_progress', 'waiting', 'resolved', 'closed'], get: t => t.status || 'open',
      tone: v => v === 'resolved' ? 'success' : v === 'in_progress' ? 'amber' : 'info' },
    { name: 'updated', label: 'Updated', type: 'date', list: true, readOnly: true, get: t => t.updatedAt || t.createdAt || null },
  ],
  detail: { render: () => '<ticket-thread>' },
};
E.define('ticket', TICKET);
t('ticket schema: computed subject/from/status columns, interactive thread render, no onSave', () => {
  const cols = E.listColumns('ticket');
  assert.deepStrictEqual(cols.map(c => c.key), ['subject', 'from', 'status', 'updated']);
  assert.strictEqual(E.get('ticket').fields.find(f => f.name === 'status').get({}), 'open');   // default
  assert.strictEqual(E.get('ticket').fields.find(f => f.name === 'subject').get({}), 'No subject');
  assert.strictEqual(typeof E.get('ticket').detail.render, 'function');
  assert.strictEqual(E.get('ticket').onSave, undefined);   // mutations are inline, not via the edit form
});

// ── recordTitle: lead-field title with get() fallback (engine hardening) ──
const TITLED = { label: 'Account', recordId: r => r.id, fields: [
  { name: 'name', label: 'Account', type: 'text', list: true, get: a => a.name || '(unnamed)' },
], detail: { render: () => '' } };
E.define('titled', TITLED);
const TS = E.get('titled');
t('recordTitle: raw lead property wins → "Label: Value"', () => {
  assert.strictEqual(E.recordTitle(TS, { id: 'x1', name: 'Bluestone' }, 'read', 'titled'), 'Account: Bluestone');
});
t('recordTitle: empty lead property falls back to get() (the fix), not the bare id', () => {
  assert.strictEqual(E.recordTitle(TS, { id: 'x1' }, 'read', 'titled'), 'Account: (unnamed)');
});
t('recordTitle: empty lead + no get → stable id fallback', () => {
  const NOGET = { label: 'Thing', recordId: r => r.id, fields: [{ name: 'name', label: 'N', type: 'text' }], detail: { render: () => '' } };
  E.define('noget', NOGET);
  assert.strictEqual(E.recordTitle(E.get('noget'), { id: 'abc' }, 'read', 'noget'), 'Thing: abc');
});
t('recordTitle: create mode → "New Label"', () => {
  assert.strictEqual(E.recordTitle(TS, { id: 'x1' }, 'create', 'titled'), 'New Account');
});

// ── renderParty facet-tab derivation (pure): the optional party facets appear
//    only when the schema supplies that facet's data fn. Overview + Orders always
//    lead; Notes is always last. Mirrors the activity/classes/wallet opt-in
//    pattern + the new certifications facet (cut-plan PR2). ──
function tabKeys(d) { return E.partyTabs(d).map(function (t) { return t.key; }); }
t('partyTabs: a sparse party record = Overview + Orders + Notes only', () => {
  assert.deepStrictEqual(tabKeys({}), ['ov', 'orders', 'notes']);
});
t('partyTabs: each optional facet adds its tab only when its data fn is present', () => {
  assert.deepStrictEqual(tabKeys({ activity: () => [] }), ['ov', 'orders', 'activity', 'notes']);
  assert.deepStrictEqual(tabKeys({ classes: () => [] }), ['ov', 'orders', 'classes', 'notes']);
  assert.deepStrictEqual(tabKeys({ wallet: () => ({}) }), ['ov', 'orders', 'wallet', 'notes']);
});
t('partyTabs: certifications facet adds a Certifications tab between Classes and Wallet', () => {
  assert.deepStrictEqual(tabKeys({ certifications: () => ({}) }), ['ov', 'orders', 'certifications', 'notes']);
  const all = E.partyTabs({ activity: () => [], classes: () => [], certifications: () => ({}), wallet: () => ({}) });
  assert.deepStrictEqual(all.map(t => t.key), ['ov', 'orders', 'activity', 'classes', 'certifications', 'wallet', 'notes']);
  assert.strictEqual(all.find(t => t.key === 'certifications').label, 'Certifications');
});
t('partyTabs: a non-function facet value does NOT add a tab (typeof guard) + null-safe', () => {
  assert.deepStrictEqual(tabKeys({ certifications: true }), ['ov', 'orders', 'notes']);
  assert.deepStrictEqual(tabKeys(null), ['ov', 'orders', 'notes']);
});

console.log('\n' + pass + ' passed');

// header badge honors the status field's get() (channels-v2 "• true" bug)
t('statusBadge uses get() when present', () => {
  E.define('chan', { fields: [
    { name: 'name', label: 'Name', type: 'text', list: true },
    { name: 'isActive', label: 'Status', type: 'status',
      get: r => r.isActive === false ? 'Paused' : 'Active',
      tone: v => v === 'Active' ? 'success' : 'neutral' }
  ]});
  const b = E.statusBadge(E.get('chan'), { name: 'Shopify', isActive: true });
  assert.strictEqual(b[0].label, 'Active');
  assert.strictEqual(b[0].tone, 'success');
});
t('statusBadge falls back to raw value without get()', () => {
  const b = E.statusBadge(E.get('order'), { status: 'refunded' });
  assert.strictEqual(b[0].label, 'refunded');
  assert.strictEqual(b[0].tone, 'danger');
});


// f.format maps a stored status enum to its display label (cs-support-v2
// "Working on it") without changing the stored value tone/sort/filter see.
t('statusBadge honors f.format for the display label, tone gets the raw value', () => {
  E.define('convo', { fields: [
    { name: 'subject', label: 'Subject', type: 'text', list: true },
    { name: 'status', label: 'Status', type: 'status',
      get: r => r.status || 'open',
      format: v => ({ open: 'Open', in_progress: 'Working on it' }[v] || v),
      tone: v => v === 'in_progress' ? 'amber' : 'info' }
  ]});
  const b = E.statusBadge(E.get('convo'), { subject: 'Hi', status: 'in_progress' });
  assert.strictEqual(b[0].label, 'Working on it');
  assert.strictEqual(b[0].tone, 'amber');
});
t('statusBadge without f.format keeps the raw value', () => {
  const b2 = E.statusBadge(E.get('order'), { status: 'refunded' });
  assert.strictEqual(b2[0].label, 'refunded');
});
