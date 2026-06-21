'use strict';

// F5 (W6 QA-spine): in-person POS sales now capture a tax jurisdiction, so they
// appear in sales-tax + nexus reporting instead of being silently dropped
// (finance_get_tax_summary returned missingState for them). The register has no
// shipping address, so it resolves the jurisdiction from the GPS-matched studio
// location, falling back to the seller's home state (config/tax.state).
//
// This locks BOTH the pure resolver AND the wiring that feeds it onto the order's
// taxState — the resolver is harmless unless it actually reaches submitOrder.
// resolvePosTaxState is extracted from the SHIPPED pos/index.html (not hand-copied)
// so the test fails if it regresses.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pos', 'index.html'), 'utf8');

function extractFn(name) {
  // Single-line helper: `function NAME(args) { ... }` up to the closing brace.
  const m = SRC.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[^\\n]*\\}'));
  assert.ok(m, name + ' not found in pos/index.html');
  // eslint-disable-next-line no-eval
  return eval('(' + m[0].replace('function ' + name, 'function') + ')');
}

const resolvePosTaxState = extractFn('resolvePosTaxState');

// ── resolver behavior ─────────────────────────────────────────────────────────

test('studio jurisdiction (GPS-matched) wins over home state', () => {
  assert.strictEqual(resolvePosTaxState('MA', 'NY'), 'MA');
});

test('falls back to seller home state when no studio matched', () => {
  assert.strictEqual(resolvePosTaxState('', 'NY'), 'NY');
  assert.strictEqual(resolvePosTaxState(null, 'CA'), 'CA');
});

test('normalizes case + whitespace to a 2-letter code', () => {
  assert.strictEqual(resolvePosTaxState(' ma ', ''), 'MA');
  assert.strictEqual(resolvePosTaxState('tx', ''), 'TX');
});

test('returns "" (→ triage) when neither yields a valid 2-letter code', () => {
  assert.strictEqual(resolvePosTaxState('', ''), '');
  assert.strictEqual(resolvePosTaxState(null, null), '');
  assert.strictEqual(resolvePosTaxState('Massachusetts', ''), ''); // not a 2-letter code
  assert.strictEqual(resolvePosTaxState('M1', ''), '');
});

// ── wiring regression guards (the resolver only helps if it reaches the order) ──

test('POS sale stamps taxState onto the sale record at build time', () => {
  assert.match(SRC, /taxState:\s*resolvePosTaxState\(posStudioState,\s*posHomeState\)/);
});

test('submitOrder POS payload forwards taxState to the server', () => {
  assert.match(SRC, /channel:\s*'pos',[\s\S]{0,200}taxState:\s*saleRecord\.taxState/);
});

test('GPS studio match captures the studio jurisdiction', () => {
  assert.match(SRC, /posStudioState\s*=\s*resolvePosTaxState\(loc\.state/);
});

test('seller home state is read from config/tax', () => {
  assert.match(SRC, /MastDB\.get\('config\/tax'\)[\s\S]{0,160}posHomeState\s*=\s*resolvePosTaxState/);
});
