/**
 * Engine-hardening tests for shared/customer-resolver.js — the email-identity
 * resolver that makes "same email → ONE customer by construction" (resolver pkg
 * 1.1.0, vendored into the template at #108). The load-bearing invariant is the
 * gmail-dot/+tag collapse: j.o.hn+promo@googlemail.com and john@gmail.com are the
 * SAME person, so they must resolve to one customer + one byEmail index key. A
 * regression here silently splits a customer's history across duplicate records.
 *
 * Loads the real bundled module into a vm sandbox (the mastdb-fieldpath harness
 * pattern) and exercises canonicalizeEmail / emailKey / resolveCustomer /
 * resolveOrderContact against a fake first-writer-wins storage.
 *
 * Run: node test/customer-resolver.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../shared/customer-resolver.js'), 'utf8');
const sandbox = { console: console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const R = sandbox.MastCustomerResolver;

// ── canonicalizeEmail — the dedup-by-construction invariant ───────────────────
test('canonicalizeEmail: gmail dots + plus-tags + googlemail collapse to one identity', () => {
  assert.strictEqual(R.canonicalizeEmail('j.o.h.n@gmail.com'), 'john@gmail.com');
  assert.strictEqual(R.canonicalizeEmail('john+newsletter@gmail.com'), 'john@gmail.com');
  assert.strictEqual(R.canonicalizeEmail('J.o.h.N+promo@GoogleMail.com'), 'john@gmail.com');
  // THE invariant: every variant of one gmail identity → the SAME canonical form.
  const variants = ['john@gmail.com', 'j.ohn@gmail.com', 'jo.hn+a@gmail.com', 'JOHN+b@googlemail.com', '  john@Gmail.com '];
  const canon = variants.map(R.canonicalizeEmail);
  assert.strictEqual(new Set(canon).size, 1, 'all gmail variants must collapse to one: ' + JSON.stringify(canon));
  assert.strictEqual(canon[0], 'john@gmail.com');
});

test('canonicalizeEmail: non-gmail preserves dots + plus-tags (not Google semantics)', () => {
  assert.strictEqual(R.canonicalizeEmail('j.o.hn+tag@example.com'), 'j.o.hn+tag@example.com');
  assert.strictEqual(R.canonicalizeEmail('John.Doe@Company.COM'), 'john.doe@company.com'); // case/trim only
});

test('canonicalizeEmail: trims/lowercases; tolerates malformed input without throwing', () => {
  assert.strictEqual(R.canonicalizeEmail('  JOHN@Example.COM  '), 'john@example.com');
  assert.strictEqual(R.canonicalizeEmail(null), null);
  assert.strictEqual(R.canonicalizeEmail(''), null);
  assert.strictEqual(R.canonicalizeEmail('   '), null);
  assert.strictEqual(R.canonicalizeEmail('noatsign'), 'noatsign');   // no @ → trimmed, no throw
  assert.strictEqual(R.canonicalizeEmail('@gmail.com'), '@gmail.com'); // @ at index 0 → trimmed
  assert.strictEqual(R.canonicalizeEmail('john@'), 'john@');           // @ at end → trimmed
});

test('emailKey: Firebase-safe (strips . # $ [ ] /) and dedup-stable across gmail variants', () => {
  assert.strictEqual(R.emailKey('john@gmail.com'), 'john@gmail,com'); // '.' → ','
  assert.strictEqual(R.emailKey('j.o.hn+x@gmail.com'), R.emailKey('john@googlemail.com')); // same identity → same key
  assert.ok(!/[.#$\[\]\/]/.test(R.emailKey('a.b/c#d@gmail.com')), 'no Firebase-forbidden chars in a key');
  assert.strictEqual(R.emailKey(null), null);
});

// ── resolveCustomer — dedup / conflict, over a fake first-writer-wins storage ──
function makeStorage() {
  const data = {};
  let n = 0;
  return {
    data,
    get: async (p) => (data[p] !== undefined ? data[p] : null),
    multiUpdate: async (updates) => { Object.keys(updates).forEach((k) => { data[k] = updates[k]; }); },
    pushKey: () => 'id_' + (++n),
    claim: async (p, id) => { if (data[p] !== undefined) return data[p]; data[p] = id; return id; } // atomic
  };
}
const CFG = (storage) => ({ tenantId: 't1', storage });

test('resolveCustomer: two gmail variants resolve to ONE customer (dedup by construction)', async () => {
  const s = makeStorage();
  const cfg = CFG(s);
  const a = await R.resolveCustomer(cfg, { email: 'j.o.hn@gmail.com', source: 'pos' });
  const b = await R.resolveCustomer(cfg, { email: 'john+newsletter@googlemail.com', source: 'web' });
  assert.strictEqual(a.created, true, 'first sighting creates');
  assert.strictEqual(b.created, false, 'gmail variant must attach, not create a 2nd customer');
  assert.strictEqual(a.customerId, b.customerId, 'gmail variants must be ONE customer id');
});

test('resolveCustomer: uid and email pointing at different customers raises a conflict + duplicate flag', async () => {
  const s = makeStorage();
  const cfg = CFG(s);
  await R.resolveCustomer(cfg, { email: 'a@gmail.com', source: 'web' }); // creates C1, claims byEmail
  s.data['t1/admin/customerIndexes/byUid/U9'] = 'other_customer';        // a uid already points elsewhere
  const r = await R.resolveCustomer(cfg, { uid: 'U9', email: 'a@gmail.com', source: 'web' });
  assert.strictEqual(r.conflict, true, 'uid≠email customer must surface conflict:true');
  const dupKeys = Object.keys(s.data).filter((k) => k.indexOf('customerDuplicates') !== -1);
  assert.ok(dupKeys.length >= 1, 'a customerDuplicates flag must be written for triage');
});

test('resolveCustomer: no uid/email/contactId → skipped, writes nothing', async () => {
  const s = makeStorage();
  const r = await R.resolveCustomer(CFG(s), { source: 'pos' });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.customerId, null);
  assert.strictEqual(Object.keys(s.data).length, 0, 'a skipped resolve must not write');
});

test('resolveCustomerSafe: swallows storage errors → null (never throws into the order path)', async () => {
  const bad = { tenantId: 't1', storage: { get: async () => { throw new Error('boom'); }, pushKey: () => 'x', multiUpdate: async () => {}, claim: async () => { throw new Error('boom'); } } };
  const r = await R.resolveCustomerSafe(bad, { email: 'x@gmail.com', source: 'web' });
  assert.strictEqual(r, null);
});

// ── resolveOrderContact — match-or-create a shipping contact by email+address ─
test('resolveOrderContact: matches an existing linked contact by email+address, else creates one', async () => {
  const s = makeStorage();
  const cfg = CFG(s);
  const shipping = { name: 'Mara', address1: '412 Larkspur Lane', city: 'Portland', state: 'OR', zip: '97214' };
  s.data['t1/admin/customers/C1'] = { id: 'C1', displayName: 'Mara', primaryEmail: 'mara@x.com', linkedIds: { contactIds: ['CT1'] } };
  // a linked contact whose match-key (email|normalized-address) equals this order's
  s.data['t1/admin/contacts/CT1'] = { id: 'CT1', email: 'mara@x.com', address: '412 Larkspur Lane, Portland, OR, 97214' };
  const matched = await R.resolveOrderContact(cfg, { customerId: 'C1', email: 'mara@x.com', shipping: shipping });
  assert.strictEqual(matched, 'CT1', 'same email+address must reuse the linked contact, not duplicate');

  // a different address → new contact
  const created = await R.resolveOrderContact(cfg, { customerId: 'C1', email: 'mara@x.com', shipping: Object.assign({}, shipping, { address1: '9 Other St' }) });
  assert.notStrictEqual(created, 'CT1');
  assert.ok(s.data['t1/admin/contacts/' + created], 'a new contact doc must be written');
});
