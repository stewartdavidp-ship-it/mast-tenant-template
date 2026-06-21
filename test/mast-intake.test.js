/**
 * Security-invariant unit tests for shared/mast-intake.js — the MastIntake
 * secure-intake engine (API-secret vault + identity-data PII encryption +
 * domain-control). This engine is SECURITY-CRITICAL and previously had NO test;
 * these pin the LOAD-BEARING invariants where a regression is a plaintext-secret
 * leak — not trivial line coverage.
 *
 * The engine is an eager IIFE exposing window.MastIntake (no module.exports), so
 * it is loaded into a vm sandbox (the pattern in test/mastdb-fieldpath.test.js)
 * with stubbed window / firebase.functions().httpsCallable (the vault CFs) /
 * MastDB, plus a minimal jsdom-free element stub so the field-rendering + the
 * delegated save/reveal/revoke flows can be driven without a real DOM.
 *
 * INVARIANTS PINNED (see the engine's own §6 header):
 *   1. NO PLAINTEXT PERSISTENCE — a secret routes ONLY to the vault CF; the
 *      engine performs ZERO client-side writes and stores no raw value in any
 *      DOM attribute/dataset/innerHTML. A non-`ref` CF return is a hard refuse.
 *   2. MASKED DISPLAY — a collected identity value renders as a masked last-4;
 *      the held-secret input is write-only (type=password, never echoed). Reveal
 *      is a SEPARATE admin-gated CF.
 *   3. SENTINEL-REF PROBE — "collected" is derived from the ref; an absent ref
 *      reads as not-collected even if the server reports collected.
 *   4. FAIL-CLOSED — no CF / no tenant / a throw / a ref-less 200 all surface an
 *      error and DO NOT report success or store plaintext. The availability
 *      probe defaults DISABLED, never assumed-good.
 *   5. PROVIDER DEFINITIONS — each held-secret family's regex accepts valid +
 *      rejects malformed; the field key / identity kind match the vault allowlist.
 *
 * Run: node test/mast-intake.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INTAKE_SRC = fs.readFileSync(path.join(ROOT, 'shared/mast-intake.js'), 'utf8');
const PROVIDERS_SRC = fs.readFileSync(path.join(ROOT, 'app/modules/connections-providers.js'), 'utf8');

const MASK = '•'; // U+2022 — the masked glyph the engine refuses on submit.

// ─────────────────────────────────────────────────────────────────────────────
// Minimal jsdom-free DOM stub. We CONSTRUCT element trees explicitly (we do not
// parse innerHTML) — selectors are matched against the descendant tree by class /
// attribute / tag, which is the exact subset the engine queries.
// ─────────────────────────────────────────────────────────────────────────────
function matchSel(el, sel) {
  sel = String(sel).trim();
  const attrs = [];
  sel.replace(/\[([^\]]+)\]/g, (_full, body) => { attrs.push(body); return ''; });
  const rest = sel.replace(/\[[^\]]+\]/g, '');
  const classes = [];
  let tag = null;
  rest.split('.').forEach((part, idx) => {
    if (idx === 0) { if (part) tag = part; } else if (part) classes.push(part);
  });
  if (tag && el.nodeName.toLowerCase() !== tag.toLowerCase()) return false;
  for (const c of classes) if (!el._classes.has(c)) return false;
  for (const a of attrs) {
    const mm = a.match(/^([\w-]+)(?:\s*=\s*["']?([^"']*)["']?)?$/);
    if (!mm) return false;
    if (!(mm[1] in el._attrs)) return false;
    if (mm[2] !== undefined && el._attrs[mm[1]] !== mm[2]) return false;
  }
  return true;
}
function allDesc(root, sel) {
  const out = [];
  (function walk(n) { for (const k of n._kids) { if (matchSel(k, sel)) out.push(k); walk(k); } })(root);
  return out;
}
function makeEl(tag, attrs) {
  const el = {
    nodeName: (tag || 'div').toUpperCase(),
    _attrs: Object.create(null),
    _classes: new Set(),
    _kids: [],
    parentNode: null,
    style: {},
    value: '',
    disabled: false,
    textContent: '',
    _innerHTML: ''
  };
  el.type = tag === 'input' ? 'text' : undefined;
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._classes).join(' '); },
    set(v) { el._classes = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean)); },
    configurable: true
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = String(v == null ? '' : v); },
    configurable: true
  });
  Object.defineProperty(el, 'id', {
    get() { return el._attrs.id || ''; },
    set(v) { el._attrs.id = String(v); },
    configurable: true
  });
  el.classList = {
    contains: (c) => el._classes.has(c),
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c)
  };
  el.getAttribute = (n) => (n in el._attrs ? el._attrs[n] : null);
  el.setAttribute = (n, v) => { el._attrs[n] = String(v); };
  el.removeAttribute = (n) => { delete el._attrs[n]; };
  el.hasAttribute = (n) => n in el._attrs;
  el.appendChild = (c) => { c.parentNode = el; el._kids.push(c); return c; };
  el.insertAdjacentHTML = () => {}; // engine appends revoke-btn/guide via this; tree-irrelevant here
  el.focus = () => {};
  el._matches = (sel) => matchSel(el, sel);
  el.closest = (sel) => { let n = el; while (n) { if (n._matches(sel)) return n; n = n.parentNode; } return null; };
  el.querySelector = (sel) => { const a = allDesc(el, sel); return a.length ? a[0] : null; };
  el.querySelectorAll = (sel) => allDesc(el, sel);
  if (attrs) {
    if (attrs.class) String(attrs.class).split(/\s+/).filter(Boolean).forEach((c) => el._classes.add(c));
    Object.keys(attrs).forEach((k) => { if (k !== 'class') el._attrs[k] = String(attrs[k]); });
  }
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine harness — fresh sandbox per call (isolated registry / probe cache /
// delegated listeners). cf is a map of CF-name → handler(payload) returning the
// `data` object (or a Promise of it, or throwing to reject).
// ─────────────────────────────────────────────────────────────────────────────
function makeEngine(opts) {
  opts = opts || {};
  const cfCalls = [];
  const dbWrites = [];
  const toasts = [];
  const confirms = [];
  const docListeners = Object.create(null);
  const cf = opts.cf || {};
  const win = {};
  win.window = win;

  const document = {
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };

  win.MastDB = { tenantId: () => (('tenantId' in opts) ? opts.tenantId : 't1') };
  // Any client-side write would land here; the engine must NEVER call these for a
  // secret (invariant 1). We record them so a leak is provable, not assumed.
  ['set', 'update', 'create', 'multiUpdate', 'push', 'remove'].forEach((m) => {
    win.MastDB[m] = function () { dbWrites.push({ m: m, args: Array.prototype.slice.call(arguments) }); return Promise.resolve(); };
  });
  if (opts.businessEntity) win.MastDB.businessEntity = opts.businessEntity;

  if (!opts.noFirebase) {
    win.firebase = {
      functions: () => ({
        httpsCallable: (name) => (payload) => {
          cfCalls.push({ name: name, payload: payload });
          return new Promise((resolve, reject) => {
            const h = cf[name];
            if (!h) { resolve({ data: {} }); return; }
            let r;
            try { r = h(payload); } catch (e) { reject(e); return; }
            if (r && typeof r.then === 'function') r.then((d) => resolve({ data: d }), reject);
            else resolve({ data: r });
          });
        }
      })
    };
  }

  win.showToast = (msg, isErr) => { toasts.push({ msg: msg, isErr: !!isErr }); };
  if (opts.mastConfirm !== false) {
    win.mastConfirm = (msg, o) => { confirms.push({ msg: msg, o: o }); return Promise.resolve(opts.confirmResult !== false); };
  }
  if (opts.constants) win.BusinessEntityConstants = opts.constants;
  if (opts.can) win.can = opts.can;
  if (opts.channelConnection) win.ChannelConnection = opts.channelConnection;

  const sandbox = { window: win, document: document, console: console, Promise: Promise, setTimeout: setTimeout, navigator: { clipboard: null } };
  vm.createContext(sandbox);
  vm.runInContext(INTAKE_SRC, sandbox, { filename: 'shared/mast-intake.js' });
  if (opts.loadCatalog) vm.runInContext(PROVIDERS_SRC, sandbox, { filename: 'app/modules/connections-providers.js' });

  const MI = win.MastIntake;
  return {
    win: win, MI: MI, document: document, cfCalls: cfCalls, dbWrites: dbWrites,
    toasts: toasts, confirms: confirms, getDef: MI._internals.getDef,
    click: (e) => (docListeners.click || []).forEach((fn) => fn(e)),
    input: (e) => (docListeners.input || []).forEach((fn) => fn(e)),
    names: () => cfCalls.map((c) => c.name)
  };
}

// Drain chained promise/then microtasks across the vm boundary (host Promise).
async function settle(n) { for (let i = 0; i < (n || 6); i++) await new Promise((r) => setTimeout(r, 0)); }
function extractId(html) { const m = String(html).match(/id="(mastintake-[^"]+)"/); return m ? m[1] : null; }

// Register small, purpose-built defs so engine-behavior tests stay hermetic
// (decoupled from the full provider catalog).
function registerFakes(h, extra) {
  h.MI.register({
    id: 'tesths', label: 'Test Secret', family: 'held-secret', credentialOwner: 'customer',
    fields: [{ key: 'token', label: 'Token', minLen: 8, validate: /^tok_[A-Za-z0-9]{6,}$/, example: 'tok_abc123' }]
  });
  // identity defs are registered with id === kind === field.key (the CF-allowlist
  // key), mirroring the real catalog (ein-ssn / ein-ssn / ein-ssn).
  h.MI.register({
    id: 'testid', label: 'Test ID', family: 'identity-data', authType: 'C', credentialOwner: 'customer',
    vault: { kind: 'testid' },
    fields: [{ key: 'testid', kind: 'testid', label: 'Test ID', mask: true, minLen: 6, example: MASK + MASK + ' 0000' }]
  });
  if (extra) extra.forEach((d) => h.MI.register(d));
}

// Build the held-secret wrapper the engine expects (mirrors secureField's tree).
function buildHeldWrap(provider) {
  const wrap = makeEl('div', { class: 'mastintake-field', 'data-provider': provider, 'data-field': 'token', 'data-state': 'pending' });
  const input = makeEl('input', { class: 'mastintake-input' }); input.type = 'password'; input.disabled = true;
  const save = makeEl('button', { class: 'mastintake-save' }); save.disabled = true; save.textContent = 'Save';
  wrap.appendChild(makeEl('label'));
  wrap.appendChild(input);
  wrap.appendChild(save);
  wrap.appendChild(makeEl('p', { class: 'mastintake-feedback' }));
  wrap.appendChild(makeEl('p', { class: 'mastintake-status mastintake-note' }));
  wrap.appendChild(makeEl('ul', { class: 'mastintake-trust' }));
  return wrap;
}
// Build the identity wrapper with the real domId so _idInstances[wrap.id] resolves.
function buildIdentityWrap(provider, domId) {
  const wrap = makeEl('div', { class: 'mastintake-field', id: domId, 'data-provider': provider, 'data-family': 'identity-data', 'data-field': provider, 'data-state': 'pending' });
  wrap.appendChild(makeEl('div', { class: 'mastintake-id-masked' })).style.display = 'none';
  const entry = makeEl('div', { class: 'mastintake-row mastintake-id-entry' }); entry.style.display = 'none';
  const input = makeEl('input', { class: 'mastintake-input' }); input.type = 'password'; input.disabled = true;
  const save = makeEl('button', { class: 'mastintake-save' }); save.disabled = true; save.textContent = 'Save';
  entry.appendChild(input); entry.appendChild(save);
  wrap.appendChild(entry);
  wrap.appendChild(makeEl('div', { class: 'mastintake-id-actions' }));
  wrap.appendChild(makeEl('p', { class: 'mastintake-feedback' }));
  wrap.appendChild(makeEl('p', { class: 'mastintake-status mastintake-note' }));
  wrap.appendChild(makeEl('ul', { class: 'mastintake-trust' }));
  return wrap;
}
function mountRoot(wrap) { const root = makeEl('div'); root.appendChild(wrap); return root; }
function fireAction(h, wrap, action) {
  const btn = makeEl('button', { 'data-mastintake-action': action });
  wrap.appendChild(btn);
  h.click({ target: btn, preventDefault() {} });
}

// ═════════════════════════════════════════════════════════════════════════════
// A. Contract surface
// ═════════════════════════════════════════════════════════════════════════════
test('A1 — exposes the api-contract surface on window.MastIntake', () => {
  const h = makeEngine();
  ['register', 'secureField', 'collect', 'collectDocument', 'status', 'list', 'revoke', 'hydrate', 'refresh', '_internals']
    .forEach((k) => assert.equal(typeof h.MI[k], k === '_internals' ? 'object' : 'function', 'missing ' + k));
});

// ═════════════════════════════════════════════════════════════════════════════
// B. INVARIANT 5 — provider definitions (validated against the REAL catalog)
// ═════════════════════════════════════════════════════════════════════════════
test('B1 — github PAT regex accepts valid tokens, rejects malformed; field key is the vault key "token"', () => {
  const def = makeEngine({ loadCatalog: true }).getDef('github');
  const re = def.fields[0].validate;
  assert.equal(def.fields[0].key, 'token');
  ['ghp_' + 'A'.repeat(36), 'github_pat_' + 'a'.repeat(22), 'a'.repeat(40)].forEach((v) => assert.ok(re.test(v), 'should accept ' + v.slice(0, 12)));
  ['', 'ghp_short', 'sk_live_' + 'a'.repeat(20), 'GHP_' + 'A'.repeat(36), 'g'.repeat(39)].forEach((v) => assert.ok(!re.test(v), 'should reject ' + v.slice(0, 12)));
});
test('B2 — sendgrid regex accepts SG.<seg>.<seg>, rejects malformed; field key is "apiKey"', () => {
  const def = makeEngine({ loadCatalog: true }).getDef('sendgrid');
  const re = def.fields[0].validate;
  assert.equal(def.fields[0].key, 'apiKey');
  assert.ok(re.test('SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(43)));
  ['SG.short.short', 'SG.' + 'a'.repeat(22), 'sk_live_' + 'a'.repeat(20), 'SG ' + 'a'.repeat(40)].forEach((v) => assert.ok(!re.test(v), 'reject ' + v.slice(0, 10)));
});
test('B3 — shippo regex accepts live/test prefixes only, rejects others; field key is "apiToken"', () => {
  const def = makeEngine({ loadCatalog: true }).getDef('shippo');
  const re = def.fields[0].validate;
  assert.equal(def.fields[0].key, 'apiToken');
  assert.ok(re.test('shippo_live_' + 'a'.repeat(20)));
  assert.ok(re.test('shippo_test_' + 'a'.repeat(20)));
  ['shippo_prod_' + 'a'.repeat(20), 'shippo_live_short', 'shippo_' + 'a'.repeat(20), 'sk_live_' + 'a'.repeat(20)].forEach((v) => assert.ok(!re.test(v), 'reject ' + v.slice(0, 14)));
});
test('B4 — stripe regex accepts sk_(live|test)_ only, rejects pk_/malformed; field key is "secretKey"', () => {
  const def = makeEngine({ loadCatalog: true }).getDef('stripe');
  const re = def.fields[0].validate;
  assert.equal(def.fields[0].key, 'secretKey');
  assert.ok(re.test('sk_live_' + 'a'.repeat(20)));
  assert.ok(re.test('sk_test_' + 'a'.repeat(20)));
  // pk_ is the PUBLISHABLE key — it must NOT validate as a held secret.
  ['pk_live_' + 'a'.repeat(20), 'sk_prod_' + 'a'.repeat(20), 'sk_live_short', 'rk_live_' + 'a'.repeat(20)].forEach((v) => assert.ok(!re.test(v), 'reject ' + v.slice(0, 10)));
});
test('B5 — identity-data fields are mask:true + minLen + no plaintext regex; kind matches the CF allowlist', () => {
  const h = makeEngine({ loadCatalog: true });
  const KINDS = { 'ein-ssn': 'ein-ssn', 'bank-account': 'bank-account', 'license-number': 'license-number', 'insurance-policy': 'insurance-policy', 'tax-registration-id': 'tax-registration-id' };
  Object.keys(KINDS).forEach((id) => {
    const def = h.getDef(id);
    assert.ok(def, id + ' registered');
    assert.equal(def.family, 'identity-data');
    const f = def.fields[0];
    assert.equal(f.kind, KINDS[id], id + ' kind matches allowlist');
    assert.equal(f.mask, true, id + ' is masked');
    assert.ok(f.minLen >= 3, id + ' has a minLen');
    assert.ok(!f.validate, id + ' carries no client-side format regex (PII varies; server is authoritative)');
  });
});
test('B6 — held-secret field keys are pinned to the vault allowlist (a rename must break this test)', () => {
  const h = makeEngine({ loadCatalog: true });
  const MAP = { github: 'token', sendgrid: 'apiKey', shippo: 'apiToken', stripe: 'secretKey' };
  Object.keys(MAP).forEach((id) => {
    const def = h.getDef(id);
    assert.equal(def.family, 'held-secret');
    assert.equal(def.fields[0].key, MAP[id], id + ' → ' + MAP[id]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. register() — concierge forcing (a human must never receive a raw held secret)
// ═════════════════════════════════════════════════════════════════════════════
test('C1 — register FORCES conciergeEligible off for held-secret even when the descriptor asks for it', () => {
  const def = makeEngine().MI.register({ id: 'x', family: 'held-secret', conciergeEligible: true, fields: [{ key: 'k' }] });
  assert.equal(def.conciergeEligible, false);
});
test('C2 — register FORCES conciergeEligible off for identity-data', () => {
  const def = makeEngine().MI.register({ id: 'x', family: 'identity-data', conciergeEligible: true, fields: [{ key: 'k', kind: 'k' }] });
  assert.equal(def.conciergeEligible, false);
});
test('C3 — concierge stays ON only for delegated-auth archetype A (the one safe case)', () => {
  const def = makeEngine().MI.register({ id: 'x', family: 'delegated-auth', authType: 'A', conciergeEligible: true });
  assert.equal(def.conciergeEligible, true);
});
test('C4 — concierge forced off for delegated-auth that is NOT archetype A (e.g. C→A hybrid pastes a key)', () => {
  const def = makeEngine().MI.register({ id: 'x', family: 'delegated-auth', authType: 'C', conciergeEligible: true });
  assert.equal(def.conciergeEligible, false);
});
test('C5 — register without an id is a no-op (getDef → null), never a half-registered def', () => {
  const h = makeEngine();
  h.MI.register({ family: 'held-secret' });
  assert.equal(h.getDef(undefined), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// D. secureField() — initial render is fail-closed; no secret/ref/legacy leaks
// ═════════════════════════════════════════════════════════════════════════════
test('D1 — held-secret field renders a DISABLED password input + pending shell + trust copy (fail-closed initial)', () => {
  const h = makeEngine(); registerFakes(h);
  const html = h.MI.secureField({ provider: 'tesths' });
  assert.match(html, /type="password"/);
  assert.match(html, /data-state="pending"/);
  assert.match(html, /Checking secure storage/);
  assert.ok((html.match(/disabled/g) || []).length >= 2, 'input AND save start disabled');
  assert.match(html, /encrypted channel/i); // derived held-secret trust copy
  assert.doesNotMatch(html, /value=/, 'no value attribute is ever pre-filled');
});
test('D2 — unknown provider yields an error shell, never an entry input', () => {
  const html = makeEngine().MI.secureField({ provider: 'nope' });
  assert.match(html, /data-state="error"/);
  assert.match(html, /unknown provider/i);
  assert.doesNotMatch(html, /type="password"/);
});
test('D3 — identity field hides masked/entry initially, forces the counsel rail, and leaks NEITHER ref NOR legacy plaintext into the DOM string', () => {
  const h = makeEngine({ constants: { IDENTITY_FIELD_COUNSEL_WARNING: { headline: 'Counsel headline', body: 'Counsel body text' } } });
  registerFakes(h);
  const REF = 'idv://secret-ref-zzz';
  const LEGACY = '12-3456789';
  const html = h.MI.secureField({ kind: 'testid', value: REF, legacyValue: LEGACY, onChange: () => {} });
  assert.match(html, /data-family="identity-data"/);
  assert.match(html, /mastintake-id-masked[^>]*display:none/);
  assert.match(html, /Counsel headline/); // forced counsel (design §6.3)
  assert.equal(html.indexOf(REF), -1, 'the idv:// ref must not be embedded in the field HTML');
  assert.equal(html.indexOf(LEGACY), -1, 'legacy plaintext must never enter the DOM string (inbound hygiene)');
});
test('D4 — domain-control field collects NO secret (no password input) and starts in checking state', () => {
  const h = makeEngine();
  h.MI.register({ id: 'dom', family: 'domain-control', label: 'D', fields: [{ key: 'domain', example: 'x.com' }] });
  const html = h.MI.secureField({ provider: 'dom' });
  assert.match(html, /data-family="domain-control"/);
  assert.match(html, /Checking domain status/);
  assert.doesNotMatch(html, /type="password"/);
});
test('D5 — delegated-auth renders a connect CARD (no secret-paste input — the secret never reaches the client)', () => {
  const h = makeEngine();
  h.MI.register({ id: 'da', family: 'delegated-auth', authType: 'A', label: 'DA' });
  const html = h.MI.secureField({ provider: 'da' });
  assert.match(html, /data-family="delegated-auth"/);
  assert.match(html, /mastintake-da-badge/);
  assert.doesNotMatch(html, /type="password"/);
});

// ═════════════════════════════════════════════════════════════════════════════
// E. INVARIANT 4 — the fail-closed availability probe + applyState
// ═════════════════════════════════════════════════════════════════════════════
async function hydrateHeld(opts) {
  const h = makeEngine(opts); registerFakes(h);
  const wrap = buildHeldWrap('tesths');
  h.MI.hydrate(mountRoot(wrap));
  await settle();
  return { h: h, wrap: wrap, input: wrap.querySelector('.mastintake-input'), save: wrap.querySelector('.mastintake-save'), statusText: wrap.querySelector('.mastintake-status').textContent };
}
test('E1 — probe with no firebase keeps the field DISABLED (fail-closed, not assumed-good)', async () => {
  const r = await hydrateHeld({ noFirebase: true });
  assert.equal(r.wrap.getAttribute('data-state'), 'disabled');
  assert.equal(r.input.disabled, true);
  assert.equal(r.save.disabled, true);
  assert.match(r.statusText, /isn.t available/i);
});
test('E2 — probe whose CF throws keeps the field DISABLED', async () => {
  const r = await hydrateHeld({ cf: { mastIntakeVaultStatus: () => { throw new Error('boom'); } } });
  assert.equal(r.wrap.getAttribute('data-state'), 'disabled');
  assert.equal(r.input.disabled, true);
});
test('E3 — probe with no tenant keeps the field DISABLED', async () => {
  const r = await hydrateHeld({ tenantId: null });
  assert.equal(r.wrap.getAttribute('data-state'), 'disabled');
});
test('E4 — a successful probe reporting collected enables the field and shows the vault-stored copy (no secret echoed)', async () => {
  const r = await hydrateHeld({ cf: { mastIntakeVaultStatus: () => ({ state: 'collected' }) } });
  assert.equal(r.wrap.getAttribute('data-state'), 'collected');
  assert.equal(r.input.disabled, false);
  assert.match(r.statusText, /secure vault/i);
  assert.equal(r.input.type, 'password', 'collected input remains write-only');
});
test('E5 — a successful probe reporting not-collected enables entry in the ready state', async () => {
  const r = await hydrateHeld({ cf: { mastIntakeVaultStatus: () => ({ state: 'not-collected' }) } });
  assert.equal(r.wrap.getAttribute('data-state'), 'ready');
  assert.match(r.statusText, /Not collected yet/i);
});
test('E6 — the probe is cached per provider and re-runs only when forced', async () => {
  const h = makeEngine({ cf: { mastIntakeVaultStatus: () => ({ state: 'not-collected' }) } });
  registerFakes(h);
  await h.MI._internals.probe('tesths');
  await h.MI._internals.probe('tesths');
  assert.equal(h.names().filter((n) => n === 'mastIntakeVaultStatus').length, 1, 'second probe hits the cache');
  await h.MI._internals.probe('tesths', true);
  assert.equal(h.names().filter((n) => n === 'mastIntakeVaultStatus').length, 2, 'force re-probes');
});

// ═════════════════════════════════════════════════════════════════════════════
// F. INVARIANT 1 + 4 — held-secret persist routes to the vault CF, ref-only,
//    fail-closed. This is the load-bearing leak surface.
// ═════════════════════════════════════════════════════════════════════════════
async function saveHeld(value, cf, engineOpts) {
  const opts = Object.assign({ cf: cf || {} }, engineOpts || {});
  const h = makeEngine(opts); registerFakes(h);
  const wrap = buildHeldWrap('tesths');
  wrap.setAttribute('data-state', 'ready');
  const input = wrap.querySelector('.mastintake-input');
  input.disabled = false; input.value = value;
  fireAction(h, wrap, 'save');
  await settle();
  return { h: h, wrap: wrap, input: input };
}
const VALID = 'tok_abc123def';
test('F1 — a valid secret routes ONLY to the vault PUT CF (ref-keyed), clears the input, and writes NOTHING locally', async () => {
  const r = await saveHeld(VALID, {
    mastIntakeVaultPut: () => ({ ref: 'vault://ref-1', state: 'collected' }),
    mastIntakeVaultStatus: () => ({ state: 'collected' })
  });
  const puts = r.h.cfCalls.filter((c) => c.name === 'mastIntakeVaultPut');
  assert.equal(puts.length, 1, 'exactly one vault put');
  // Field-by-field (the payload is a cross-realm object built inside the vm).
  assert.equal(puts[0].payload.tenantId, 't1');
  assert.equal(puts[0].payload.provider, 'tesths');
  assert.equal(Object.keys(puts[0].payload.fields).length, 1, 'only the one mapped field is sent');
  assert.equal(puts[0].payload.fields.token, VALID, 'the secret is keyed by the vault field key');
  assert.equal(r.input.value, '', 'the raw value is cleared from the DOM after the put (inbound hygiene)');
  assert.equal(r.h.dbWrites.length, 0, 'the engine performs NO client-side write — the vault CF is the only path');
  // The secret must not be stashed in any attribute / dataset / innerHTML.
  const surface = JSON.stringify(r.wrap._attrs) + JSON.stringify(r.input._attrs) + r.wrap.innerHTML + r.input.innerHTML;
  assert.equal(surface.indexOf(VALID), -1, 'no plaintext secret persisted on any DOM surface');
  assert.equal(r.wrap.getAttribute('data-state'), 'collected', 're-probe flips to collected');
});
test('F2 — a ref-less CF response (200 without a ref) is a HARD refuse, not silent success', async () => {
  const r = await saveHeld(VALID, { mastIntakeVaultPut: () => ({ state: 'collected' }) }); // no ref
  assert.match(r.wrap.querySelector('.mastintake-feedback').textContent, /did not confirm|not saved/i);
  assert.equal(r.input.value, VALID, 'value retained (not cleared) because the save did not succeed');
  assert.equal(r.h.dbWrites.length, 0);
  assert.ok(!r.h.toasts.some((t) => /Saved/.test(t.msg)), 'no success toast on a ref-less response');
  assert.notEqual(r.wrap.getAttribute('data-state'), 'collected');
});
test('F3 — a rejected vault CF fails closed (error surfaced, value retained, no local write)', async () => {
  const r = await saveHeld(VALID, { mastIntakeVaultPut: () => { throw new Error('network'); } });
  assert.ok(r.wrap.querySelector('.mastintake-feedback').textContent.length > 0, 'error surfaced');
  assert.equal(r.input.value, VALID);
  assert.equal(r.h.dbWrites.length, 0);
});
test('F4 — with no firebase the put cannot run: it refuses, never falling back to a local plaintext write', async () => {
  const r = await saveHeld(VALID, {}, { noFirebase: true });
  assert.equal(r.h.cfCalls.length, 0);
  assert.equal(r.h.dbWrites.length, 0, 'no client-side write path exists');
  assert.match(r.wrap.querySelector('.mastintake-feedback').textContent, /unavailable|could not/i);
});
test('F5 — a masked read-back (contains the • glyph) is rejected client-side BEFORE any CF call', async () => {
  const r = await saveHeld('tok_' + MASK + MASK + MASK + MASK + MASK + MASK, { mastIntakeVaultPut: () => ({ ref: 'r' }) });
  assert.equal(r.h.cfCalls.filter((c) => c.name === 'mastIntakeVaultPut').length, 0, 'masked value never reaches the vault');
  assert.match(r.wrap.querySelector('.mastintake-feedback').textContent, /masked|real value/i);
});
test('F6 — a too-short value is blocked before the CF (the minLen hard gate)', async () => {
  const r = await saveHeld('tok_1', { mastIntakeVaultPut: () => ({ ref: 'r' }) });
  assert.equal(r.h.cfCalls.filter((c) => c.name === 'mastIntakeVaultPut').length, 0);
  assert.match(r.wrap.querySelector('.mastintake-feedback').textContent, /too short/i);
});
test('F7 — an empty submit never calls the CF', async () => {
  const r = await saveHeld('', { mastIntakeVaultPut: () => ({ ref: 'r' }) });
  assert.equal(r.h.cfCalls.length, 0);
  assert.match(r.wrap.querySelector('.mastintake-feedback').textContent, /Enter a value/i);
});
test('F8 — inline validation: a format drift is a SOFT hint (no error), but a masked value is a HARD error', async () => {
  const h = makeEngine(); registerFakes(h);
  const wrap = buildHeldWrap('tesths');
  const input = wrap.querySelector('.mastintake-input');
  // format drift (regex miss, not masked, long enough) → soft hint, not flagged error
  input.value = 'wrongprefix_abcdef';
  h.input({ target: input });
  let fb = wrap.querySelector('.mastintake-feedback');
  assert.ok(!fb._classes.has('mastintake-error'), 'regex drift is a non-blocking hint, not an error');
  // masked glyph → hard error
  input.value = 'tok_' + MASK + MASK + MASK + MASK + MASK + MASK;
  h.input({ target: input });
  assert.ok(fb._classes.has('mastintake-error'), 'a masked read-back is flagged as an error');
});

// ═════════════════════════════════════════════════════════════════════════════
// G. INVARIANT 1 + 2 + 3 — identity-data encrypt / reveal / clear
// ═════════════════════════════════════════════════════════════════════════════
function mountIdentity(h, desc) {
  const html = h.MI.secureField(Object.assign({ kind: 'testid' }, desc));
  const domId = extractId(html);
  const wrap = buildIdentityWrap('testid', domId);
  return { wrap: wrap, domId: domId };
}
test('G1 — identity save envelope-encrypts via the CF; the call-site callback receives a REF + masked, never the plaintext', async () => {
  const changes = [];
  const h = makeEngine({
    cf: {
      mastIntakeIdentityEncrypt: () => ({ ref: 'idv://new-ref', masked: MASK + MASK + ' 6789', last4: '6789', state: 'collected' }),
      mastIntakeIdentityStatus: () => ({ state: 'collected', masked: MASK + MASK + ' 6789' })
    }
  });
  registerFakes(h);
  const m = mountIdentity(h, { onChange: (p) => changes.push(p) });
  const input = m.wrap.querySelector('.mastintake-input');
  input.disabled = false; input.value = '123456789';
  fireAction(h, m.wrap, 'id-save');
  await settle();
  const enc = h.cfCalls.filter((c) => c.name === 'mastIntakeIdentityEncrypt');
  assert.equal(enc.length, 1);
  assert.equal(enc[0].payload.tenantId, 't1');
  assert.equal(enc[0].payload.kind, 'testid', 'encrypts under the CF-allowlist kind');
  assert.equal(enc[0].payload.value, '123456789');
  assert.equal(input.value, '', 'plaintext cleared from the input after encryption');
  assert.equal(h.dbWrites.length, 0, 'engine never writes the doc — the call-site persists the ref');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ref, 'idv://new-ref');
  assert.equal(JSON.stringify(changes[0]).indexOf('123456789'), -1, 'the onChange payload carries the ref, NOT the raw value');
});
test('G2 — identity save fails closed on a ref-less response: no callback, value retained', async () => {
  const changes = [];
  const h = makeEngine({ cf: { mastIntakeIdentityEncrypt: () => ({ state: 'collected' }) } }); // no ref
  registerFakes(h);
  const m = mountIdentity(h, { onChange: (p) => changes.push(p) });
  const input = m.wrap.querySelector('.mastintake-input');
  input.disabled = false; input.value = '123456789';
  fireAction(h, m.wrap, 'id-save');
  await settle();
  assert.equal(changes.length, 0, 'no ref → the call-site is NOT told to persist anything');
  assert.equal(input.value, '123456789', 'value retained on failure');
  assert.match(m.wrap.querySelector('.mastintake-feedback').textContent, /did not confirm|not saved/i);
});
test('G3 — identity save fails closed when the encrypt CF rejects', async () => {
  const changes = [];
  const h = makeEngine({ cf: { mastIntakeIdentityEncrypt: () => { throw new Error('kms down'); } } });
  registerFakes(h);
  const m = mountIdentity(h, { onChange: (p) => changes.push(p) });
  const input = m.wrap.querySelector('.mastintake-input');
  input.disabled = false; input.value = '123456789';
  fireAction(h, m.wrap, 'id-save');
  await settle();
  assert.equal(changes.length, 0);
  assert.ok(m.wrap.querySelector('.mastintake-feedback').textContent.length > 0);
});
test('G4 — one-time migration encrypts the legacy plaintext WITHOUT it ever entering an input', async () => {
  const changes = [];
  const h = makeEngine({
    cf: {
      mastIntakeIdentityEncrypt: () => ({ ref: 'idv://migrated', masked: MASK + MASK + ' 6789', state: 'collected' }),
      mastIntakeIdentityStatus: () => ({ state: 'collected', masked: MASK + MASK + ' 6789' })
    }
  });
  registerFakes(h);
  const m = mountIdentity(h, { legacyValue: '987654321', onChange: (p) => changes.push(p) });
  const input = m.wrap.querySelector('.mastintake-input');
  fireAction(h, m.wrap, 'id-migrate');
  await settle();
  const enc = h.cfCalls.filter((c) => c.name === 'mastIntakeIdentityEncrypt');
  assert.equal(enc.length, 1);
  assert.equal(enc[0].payload.value, '987654321', 'the legacy value is sent straight to the CF');
  assert.equal(input.value, '', 'the legacy plaintext never touched the DOM input');
  assert.equal(changes[0].ref, 'idv://migrated');
});
test('G5 — reveal-to-edit is a SEPARATE admin-gated CF; plaintext enters the input only on explicit reveal', async () => {
  const h = makeEngine({ cf: { mastIntakeIdentityReveal: () => ({ value: 'REVEALED-PLAINTEXT' }) } });
  registerFakes(h);
  const m = mountIdentity(h, { value: 'idv://existing' });
  const input = m.wrap.querySelector('.mastintake-input');
  fireAction(h, m.wrap, 'id-reveal');
  await settle();
  const rev = h.cfCalls.filter((c) => c.name === 'mastIntakeIdentityReveal');
  assert.equal(rev.length, 1, 'reveal is its own CF, distinct from status/encrypt');
  assert.equal(rev[0].payload.tenantId, 't1');
  assert.equal(rev[0].payload.ref, 'idv://existing');
  assert.equal(input.value, 'REVEALED-PLAINTEXT');
  assert.equal(input.type, 'text', 'revealed value shown for editing (the one sanctioned plaintext-in-DOM moment)');
  assert.equal(m.wrap.getAttribute('data-state'), 'editing');
});
test('G6 — SENTINEL-REF probe: server "collected" with NO local ref reads as not-collected (never shows masked)', async () => {
  const h = makeEngine({ cf: { mastIntakeIdentityStatus: () => ({ state: 'collected', masked: MASK + MASK + ' 9999' }) } });
  registerFakes(h);
  const m = mountIdentity(h, {}); // no value → inst.ref is null
  h.MI.hydrate(mountRoot(m.wrap));
  await settle();
  assert.notEqual(m.wrap.getAttribute('data-state'), 'collected', 'absent ref ⇒ not-collected, regardless of the server state');
  assert.equal(m.wrap.querySelector('.mastintake-id-masked').style.display, 'none', 'masked block stays hidden without a ref');
});
test('G7 — MASKED DISPLAY: a collected ref renders the masked last-4 (and only that), entry hidden', async () => {
  const h = makeEngine({ cf: { mastIntakeIdentityStatus: () => ({ state: 'collected', masked: MASK + MASK + ' 6789' }) } });
  registerFakes(h);
  const m = mountIdentity(h, { value: 'idv://existing' });
  h.MI.hydrate(mountRoot(m.wrap));
  await settle();
  assert.equal(m.wrap.getAttribute('data-state'), 'collected');
  const masked = m.wrap.querySelector('.mastintake-id-masked');
  assert.equal(masked.style.display, '');
  assert.match(masked.innerHTML, /6789/);
  assert.equal(m.wrap.querySelector('.mastintake-id-entry').style.display, 'none');
});
test('G8 — clear deletes the encrypted record via the CF and tells the call-site to drop the ref (state→not-collected)', async () => {
  const changes = [];
  const h = makeEngine({
    cf: { mastIntakeIdentityDelete: () => ({ ok: true }), mastIntakeIdentityStatus: () => ({ state: 'not-collected' }) }
  });
  registerFakes(h);
  const m = mountIdentity(h, { value: 'idv://existing', onChange: (p) => changes.push(p) });
  fireAction(h, m.wrap, 'id-clear');
  await settle();
  const del = h.cfCalls.filter((c) => c.name === 'mastIntakeIdentityDelete');
  assert.equal(del.length, 1);
  assert.equal(del[0].payload.tenantId, 't1');
  assert.equal(del[0].payload.ref, 'idv://existing');
  assert.equal(changes[changes.length - 1].ref, null);
  assert.equal(changes[changes.length - 1].state, 'not-collected');
});

// ═════════════════════════════════════════════════════════════════════════════
// H. INVARIANT 4 — status() read-back is fail-closed
// ═════════════════════════════════════════════════════════════════════════════
test('H1 — held-secret status maps a vaulted credential to collected', async () => {
  const h = makeEngine({ cf: { mastIntakeVaultStatus: () => ({ state: 'collected', detail: 'ok' }) } });
  registerFakes(h);
  const s = await h.MI.status('tesths');
  assert.equal(s.state, 'collected');
});
test('H2 — held-secret status FAILS CLOSED to error when the CF throws (a throw is never assumed-good)', async () => {
  const h = makeEngine({ cf: { mastIntakeVaultStatus: () => { throw new Error('x'); } } });
  registerFakes(h);
  const s = await h.MI.status('tesths');
  assert.equal(s.state, 'error');
});
test('H3 — held-secret status with no secure storage reports not-collected (never collected/connected)', async () => {
  const h = makeEngine({ noFirebase: true }); registerFakes(h);
  const s = await h.MI.status('tesths');
  assert.equal(s.state, 'not-collected');
  assert.match(s.detail, /unavailable/i);
});
test('H4 — identity status at the provider level is a per-field stub (never reads a CF without a ref)', async () => {
  const h = makeEngine({ cf: { mastIntakeIdentityStatus: () => { throw new Error('should not be called'); } } });
  registerFakes(h);
  const s = await h.MI.status('testid');
  assert.equal(s.state, 'not-collected');
  assert.equal(h.cfCalls.length, 0, 'no ref ⇒ no CF read at provider scope');
});
test('H5 — domain-control status fails closed to ERROR with no records (so the UI never shows an add box over an existing domain)', async () => {
  const h = makeEngine();
  // Real adapters are async; a rejected healthCheck is the fail-closed path the
  // engine's .catch is built for. (A *synchronous* throw inside an adapter would
  // escape Promise.resolve(adapter.healthCheck()) — a minor robustness gap, but
  // not a leak: domain-control collects no secret and has no client write path.)
  h.MI.register({ id: 'dom', family: 'domain-control', label: 'D', adapter: { healthCheck: () => Promise.reject(new Error('dns down')) }, fields: [{ key: 'domain' }] });
  const s = await h.MI.status('dom');
  assert.equal(s.state, 'error');
  assert.equal(s.records.length, 0);
});
test('H6 — delegated-auth status maps the ChannelConnection token vocab (ok→connected, expired/revoked→needs-reauth)', async () => {
  function make(raw) {
    const h = makeEngine({ channelConnection: { getChannelTokenStatus: () => Promise.resolve(raw) } });
    h.MI.register({ id: 'ch', family: 'delegated-auth', authType: 'A', label: 'Ch' }); // no adapter → ChannelConnection fallback
    return h.MI.status('ch');
  }
  assert.equal((await make('ok')).state, 'connected');
  assert.equal((await make('expired')).state, 'needs-reauth');
  assert.equal((await make('revoked')).state, 'needs-reauth');
  // NB: ChannelConnection collapses a genuinely-absent doc to 'ok' (a documented
  // fail-OPEN seam; the second-store correction is carved out per design §8). An
  // unknown vocab value still falls back to not-collected here.
  assert.equal((await make('something-else')).state, 'not-collected');
});

// ═════════════════════════════════════════════════════════════════════════════
// I. INVARIANT 4 — revoke() is fail-closed + idempotent
// ═════════════════════════════════════════════════════════════════════════════
test('I1 — held-secret revoke reports success only when the CF confirms it', async () => {
  const h = makeEngine({ cf: { mastIntakeVaultRevoke: () => ({ success: true, state: 'not-collected' }) } });
  registerFakes(h);
  const r = await h.MI.revoke('tesths');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'not-collected');
});
test('I2 — held-secret revoke FAILS CLOSED when the CF throws (a throw is never reported as ok)', async () => {
  const h = makeEngine({ cf: { mastIntakeVaultRevoke: () => { throw new Error('x'); } } });
  registerFakes(h);
  const r = await h.MI.revoke('tesths');
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
});
test('I3 — held-secret revoke with no secure storage refuses (ok:false)', async () => {
  const h = makeEngine({ noFirebase: true }); registerFakes(h);
  const r = await h.MI.revoke('tesths');
  assert.equal(r.ok, false);
});
test('I4 — provider-level identity revoke is intentionally not wired (delete is per-ref via the field Clear action)', async () => {
  const h = makeEngine(); registerFakes(h);
  const r = await h.MI.revoke('testid');
  assert.equal(r.ok, false);
  assert.match(r.error, /per-field/i);
});

// ═════════════════════════════════════════════════════════════════════════════
// J. Contract stubs
// ═════════════════════════════════════════════════════════════════════════════
test('J1 — list() returns the registered providers (id/family/category) for a status-board consumer', async () => {
  const h = makeEngine(); registerFakes(h);
  const ids = (await h.MI.list()).map((x) => x.id);
  assert.ok(ids.includes('tesths') && ids.includes('testid'));
});
test('J2 — collectDocument() is an explicit not-implemented stub (never a silent success)', async () => {
  const r = await makeEngine().MI.collectDocument();
  assert.equal(r.ok, false);
  assert.equal(r.status, 'error');
});
